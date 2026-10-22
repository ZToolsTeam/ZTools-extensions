// calendar 第二轮修复的集成测试：真实声明式运行时 + 按宿主语义模拟的日程库与对话框 / 写文件 IPC，含故障注入
// 覆盖：日期显示与分组（calendar-2）、时间校验（calendar-3）、ICS 导出为文件（calendar-7）、
// 会议链接校验（calendar-8）、Enter / ⌘Enter 作用于选中日程（calendar-10）、删除需确认且不占用 ⌘X（calendar-11）、
// 读取失败如实提示并保留列表（calendar-14）
import test from 'node:test'
import assert from 'node:assert/strict'
import { getComponentFactory } from '@ztools/declarative-ui'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import CalendarCommand, {
  parseEventTimes,
  normalizeConferenceUrl,
  createCalendarEvent,
  fetchCalendarPage,
  exportCalendarIcs,
  exportCalendarIcsToFile,
  buildCalendarIcsContent,
  formatEventRange,
  formatDateKey,
  defaultIcsFileName
} from '../dist/index.js'

const host = createHost()
const HOUR = 3600_000
const DAY = 24 * HOUR

function todayAt(h, m = 0, dayOffset = 0) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + dayOffset)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

/** 按宿主语义模拟的日程库：list / count / create / delete / export 都读写同一个数组 */
function installCalendarHost(db) {
  const filter = (q) =>
    db.filter((e) => {
      if (q.search && !e.title.toLowerCase().includes(String(q.search).toLowerCase())) return false
      if (q.startTime !== undefined && e.endTime < q.startTime) return false
      if (q.endTime !== undefined && e.startTime > q.endTime) return false
      return true
    })
  host.ipc.calendar_list_events = async (q) =>
    filter(q).sort((a, b) => (q.order === 'desc' ? b.startTime - a.startTime : a.startTime - b.startTime)).slice(0, q.limit ?? 50)
  host.ipc.calendar_count_events = async (q) => ({ total: filter(q).length })
  host.ipc.calendar_create_event = async (p) => {
    if (typeof p.startTime !== 'number' || typeof p.endTime !== 'number') throw Object.assign(new Error('宿主内部错误'), { code: 'INTERNAL_ERROR' })
    const saved = { ...p, id: `srv-${db.length + 1}`, calendarName: p.calendarName || 'Calendar' }
    db.push(saved)
    return saved
  }
  host.ipc.calendar_delete_event = async ({ id }) => {
    const idx = db.findIndex((e) => e.id === id)
    if (idx >= 0) db.splice(idx, 1)
    return { success: idx >= 0 }
  }
  host.ipc.calendar_export_ics = async ({ eventIds }) => {
    const picked = db.filter((e) => eventIds.includes(e.id))
    const ics = ['BEGIN:VCALENDAR', ...picked.flatMap((e) => ['BEGIN:VEVENT', `SUMMARY:${e.title}`, `DTSTART:${e.startTime}`, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n')
    return { ics, count: picked.length }
  }
  return db
}

const settle = async () => {
  await tick(10)
}

function sections(view) {
  return view.tree().children.filter((c) => c && c.type === 'List.Section')
}

async function openCreateForm(view) {
  const create = view.tree().props.filterBar.actions.find((a) => a.id === 'create-calendar-event')
  create.onAction()
  await tick()
  // 与宿主一样按组件工厂挂载被 push 的表单，表单状态才能响应输入
  const last = host.pushed.length - 1
  host.pushed[last] = getComponentFactory(host.pushed[last]) || host.pushed[last]
  return mountPushed(host)
}

test.beforeEach(() => host.reset())

// ---------------------------------------------------------------------------
// calendar-2：日期
// ---------------------------------------------------------------------------

test('[calendar-2] 列表按「今天 / 明天 / 具体日期」分组，已结束的日程带「已结束」，摘要与详情带日期', async () => {
  const todayStart = todayAt(0)
  installCalendarHost([
    { id: 'ended', title: '晨会站会', startTime: todayStart, endTime: todayStart + 1, calendarName: 'Work' },
    { id: 'tomorrow', title: '跨午夜测试', startTime: todayAt(1, 0, 1), endTime: todayAt(2, 0, 1), calendarName: 'Work' },
    { id: 'later', title: '未来日程', startTime: todayAt(14, 0, 3), endTime: todayAt(15, 0, 3), calendarName: 'Work', location: '3F' }
  ])
  const view = await mount(CalendarCommand)
  await settle()
  const secs = sections(view)
  assert.equal(secs.length, 3)
  assert.match(secs[0].props.title, /^今天 · \d+月\d+日 周. · 1 场$/)
  assert.match(secs[1].props.title, /^明天 · /)
  assert.doesNotMatch(secs[2].props.title, /^(今天|明天)/)
  assert.match(secs[2].props.title, new RegExp(`${new Date(todayAt(14, 0, 3)).getDate()}日`))

  assert.deepEqual(view.item('ended').props.accessories[0], { tag: '已结束' })
  assert.ok(!view.item('tomorrow').props.accessories.some((a) => a.tag), '未结束的不带标签')
  assert.equal(view.item('tomorrow').props.accessories.at(-1).text, '01:00 - 02:00')

  const laterKey = formatDateKey(todayAt(14, 0, 3))
  assert.match(view.item('later').props.detail.props.markdown, new RegExp(laterKey))
  await view.run(view.item('later'), '复制日程摘要')
  assert.match(host.clipboard.text, new RegExp(`^未来日程 \\(${laterKey} 周. 14:00 - 15:00\\) @ 3F$`))
  view.unmount()
})

test('[calendar-2] 跨天日程的时间段带结束日期；地点为空时摘要不拼「@」', async () => {
  const evt = { id: 'x', title: '通宵', startTime: '23:00', endTime: '01:00', startAt: todayAt(23), endAt: todayAt(1, 0, 1), location: '', calendarName: 'Work', notes: '', attendees: [] }
  const tomorrow = new Date(todayAt(1, 0, 1))
  assert.equal(formatEventRange(evt), `23:00 - ${tomorrow.getMonth() + 1}月${tomorrow.getDate()}日 01:00`)
  assert.equal(formatEventRange({ ...evt, isAllDay: true }), '全天')
  // 旧数据只有时分时仍能显示
  assert.equal(formatEventRange({ ...evt, startAt: undefined, endAt: undefined }), '23:00 - 01:00')
})

test('[calendar-2] 表单有日期字段（默认今天），选其他日期后按该日期保存，并出现在对应日期分组里', async () => {
  const db = installCalendarHost([])
  const view = await mount(CalendarCommand)
  await settle()
  const form = await openCreateForm(view)
  assert.equal(form.field('date').props.value, formatDateKey(Date.now()))
  const target = todayAt(14, 0, 3)
  await form.fill('title', '未来日程-评审')
  await form.fill('date', formatDateKey(target))
  await form.fill('startTime', '14:00')
  await form.fill('endTime', '15:30')
  await form.run(undefined, '保存日程')
  await settle()
  assert.equal(db.length, 1)
  assert.equal(db[0].startTime, target)
  assert.equal(db[0].endTime, target + 1.5 * HOUR)
  assert.equal(host.lastToast().title, '已创建日程: 未来日程-评审')
  assert.match(host.lastToast().message, new RegExp(formatDateKey(target)))
  assert.equal(host.pushed.length, 0, '保存成功后返回列表')
  const secs = sections(view)
  assert.equal(secs.length, 1)
  assert.doesNotMatch(secs[0].props.title, /^今天/)
  form.unmount()
  view.unmount()
})

// ---------------------------------------------------------------------------
// calendar-3：时间校验
// ---------------------------------------------------------------------------

test('[calendar-3] 时间解析：HH:MM 范围、日期合法性、先后顺序与跨天写法', () => {
  const date = formatDateKey(todayAt(0))
  const ok = parseEventTimes({ date, startTime: '09:30', endTime: '10:00' })
  assert.deepEqual(ok, { ok: true, startAt: todayAt(9, 30), endAt: todayAt(10) })
  assert.equal(parseEventTimes({ date, startTime: '9：05', endTime: '10:00' }).startAt, todayAt(9, 5), '全角冒号也认')

  const bad = parseEventTimes({ date, startTime: 'abc', endTime: 'xyz' })
  assert.equal(bad.ok, false)
  assert.match(bad.errors.startTime, /开始时间格式应为 HH:MM/)
  assert.match(bad.errors.endTime, /结束时间格式应为 HH:MM/)

  const overflow = parseEventTimes({ date, startTime: '25:00', endTime: '26:00' })
  assert.match(overflow.errors.startTime, /00:00 - 23:59/)
  assert.match(parseEventTimes({ date, startTime: '10:60', endTime: '11:00' }).errors.startTime, /HH:MM/)

  const reversed = parseEventTimes({ date, startTime: '16:00', endTime: '15:00' })
  assert.match(reversed.errors.endTime, /结束时间必须晚于开始时间/)
  assert.match(parseEventTimes({ date, startTime: '16:00', endTime: '16:00' }).errors.endTime, /晚于/)

  const crossDay = parseEventTimes({ date, startTime: '23:00', endTime: `${formatDateKey(todayAt(0, 0, 1))} 01:00` })
  assert.deepEqual(crossDay, { ok: true, startAt: todayAt(23), endAt: todayAt(1, 0, 1) })

  assert.match(parseEventTimes({ date: '2026-02-30', startTime: '10:00', endTime: '11:00' }).errors.date, /YYYY-MM-DD/)
  assert.match(parseEventTimes({ date: '', startTime: '10:00', endTime: '11:00' }).errors.date, /请填写日期/)
  assert.match(parseEventTimes({ date, startTime: '', endTime: '11:00' }).errors.startTime, /请填写开始时间/)
  // 时间字段自带日期时不受日期字段影响
  assert.equal(parseEventTimes({ date: 'bad', startTime: '2026-10-25 14:00', endTime: '2026-10-25 15:00' }).ok, true)
})

test('[calendar-3] 表单里填非法时间：不调用宿主、字段标红、提示失败、停留在表单；改正后能保存', async () => {
  const db = installCalendarHost([])
  const view = await mount(CalendarCommand)
  await settle()
  const form = await openCreateForm(view)
  await form.fill('title', '无效时间测试')

  for (const [start, end, field, pattern] of [
    ['abc', 'xyz', 'startTime', /HH:MM/],
    ['25:00', '26:00', 'startTime', /23:59/],
    ['16:00', '15:00', 'endTime', /晚于开始时间/]
  ]) {
    await form.fill('startTime', start)
    await form.fill('endTime', end)
    await form.run(undefined, '保存日程')
    assert.match(form.field(field).props.error || '', pattern, `${start}-${end}`)
    assert.equal(host.lastToast().title, '请先修正标红的字段')
    assert.equal(host.lastToast().style, 'FAILURE')
  }
  assert.equal(host.ipcCalls.filter(([m]) => m === 'calendar_create_event').length, 0, '非法时间不发给宿主')
  assert.equal(db.length, 0)
  assert.equal(host.pushed.length, 1, '停留在表单')

  // 修改时间字段后错误清掉，提交成功
  await form.fill('endTime', '17:00')
  assert.equal(form.field('endTime').props.error, undefined)
  await form.run(undefined, '保存日程')
  await settle()
  assert.equal(db.length, 1)
  assert.equal(db[0].startTime, todayAt(16))
  form.unmount()
  view.unmount()
})

test('[calendar-3][故障注入] 宿主创建失败时提示中文原因，不带错误码，表单保留', async () => {
  installCalendarHost([])
  host.ipc.calendar_create_event = async () => {
    throw Object.assign(new Error('database is locked'), { code: 'INTERNAL_ERROR' })
  }
  const view = await mount(CalendarCommand)
  await settle()
  const form = await openCreateForm(view)
  await form.fill('title', '锁定期间创建')
  await form.run(undefined, '保存日程')
  await settle()
  assert.equal(host.lastToast().title, '创建日程失败')
  assert.equal(host.lastToast().message, 'database is locked')
  assert.equal(host.pushed.length, 1)
  // 直接调用接口时也先校验，非法时间不触达宿主
  host.ipcCalls.length = 0
  await assert.rejects(() => createCalendarEvent({ title: 'x', startTime: 'abc', endTime: '11:00' }), /INVALID_EVENT_TIME/)
  assert.equal(host.ipcCalls.length, 0)
  form.unmount()
  view.unmount()
})

// ---------------------------------------------------------------------------
// calendar-7：导出 ICS 文件
// ---------------------------------------------------------------------------

function installFileHost({ pick = '/Users/test/Desktop/ztools-calendar.ics', writeError = null, dialogError = null } = {}) {
  const writes = []
  host.ipc.window_show_save_dialog = async (params) => {
    if (dialogError) throw dialogError
    return pick ? { canceled: false, filePath: pick, fileUrl: 'ztools-file://x' } : { canceled: true }
  }
  host.ipc.filesystem_write_file = async (params) => {
    if (writeError) throw writeError
    writes.push(params)
    return { success: true }
  }
  return writes
}

test('[calendar-7] ⌘E 弹出另存为并写入 .ics 文件（内容来自宿主），提示保存路径；剪贴板不变', async () => {
  installCalendarHost([
    { id: 'a', title: '周会', startTime: todayAt(20), endTime: todayAt(21) },
    { id: 'b', title: '复盘', startTime: todayAt(10, 0, 1), endTime: todayAt(11, 0, 1) }
  ])
  const writes = installFileHost()
  host.clipboard.text = 'SENTINEL'
  const view = await mount(CalendarCommand)
  await settle()
  const action = view.actions(view.item('a')).find((a) => a.props.title === '导出当前列表为 ICS 文件...')
  assert.deepEqual(action.props.shortcut, { modifiers: ['ctrl'], key: 'e' })
  await view.run(view.item('a'), '导出当前列表为 ICS 文件...')
  await settle()
  const dialogCall = host.ipcCalls.find(([m]) => m === 'window_show_save_dialog')
  assert.equal(dialogCall[1].filters, 'iCalendar 日历|ics')
  assert.match(dialogCall[1].defaultName, /^ztools-calendar-\d{8}\.ics$/)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].path, '/Users/test/Desktop/ztools-calendar.ics')
  assert.equal(writes[0].encoding, 'utf8')
  assert.equal((writes[0].content.match(/BEGIN:VEVENT/g) || []).length, 2)
  assert.equal(host.lastToast().title, '已导出 2 个日程到 ICS 文件')
  assert.equal(host.lastToast().message, '/Users/test/Desktop/ztools-calendar.ics')
  assert.equal(host.clipboard.text, 'SENTINEL')

  // 单条导出：默认文件名用日程标题
  await view.run(view.item('b'), '导出此日程为 ICS 文件...')
  await settle()
  const second = host.ipcCalls.filter(([m]) => m === 'window_show_save_dialog').at(-1)
  assert.equal(second[1].defaultName, '复盘.ics')
  assert.equal((writes[1].content.match(/BEGIN:VEVENT/g) || []).length, 1)
  view.unmount()
})

test('[calendar-7][故障注入] 宿主导出失败：提示失败，不弹另存为、不写文件、不改剪贴板；取消另存为不提示成功；写文件失败如实提示', async () => {
  installCalendarHost([{ id: 'a', title: '周会', startTime: todayAt(20), endTime: todayAt(21) }])
  const writes = installFileHost()
  host.clipboard.text = 'SENTINEL'
  host.ipc.calendar_export_ics = async () => {
    throw Object.assign(new Error('database is locked'), { code: 'INTERNAL_ERROR' })
  }
  const view = await mount(CalendarCommand)
  await settle()
  await view.run(view.item('a'), '导出当前列表为 ICS 文件...')
  await settle()
  assert.equal(host.lastToast().title, '导出 ICS 文件失败')
  assert.equal(host.lastToast().message, 'database is locked')
  assert.ok(!host.ipcCalls.some(([m]) => m === 'window_show_save_dialog'))
  assert.equal(writes.length, 0)

  await view.run(view.item('a'), '复制当前列表的 ICS 文本')
  await settle()
  assert.equal(host.lastToast().title, '复制 ICS 文本失败')
  assert.equal(host.clipboard.text, 'SENTINEL', '失败时不能把本地拼的缺时间 ICS 放进剪贴板')

  // 恢复导出，用户取消另存为
  installCalendarHost([{ id: 'a', title: '周会', startTime: todayAt(20), endTime: todayAt(21) }])
  installFileHost({ pick: null })
  const before = host.toasts.length
  await view.run(view.item('a'), '导出当前列表为 ICS 文件...')
  await settle()
  assert.equal(host.toasts.length, before, '取消时不提示')

  // 写文件失败
  installFileHost({ writeError: Object.assign(new Error('没有写入权限'), { code: 'PERMISSION_DENIED' }) })
  await view.run(view.item('a'), '导出当前列表为 ICS 文件...')
  await settle()
  assert.equal(host.lastToast().title, '导出 ICS 文件失败')
  assert.equal(host.lastToast().message, '没有写入权限')
  view.unmount()
})

test('[calendar-7] 复制 ICS 文本作为次要动作；本地生成的 ICS 带 DTSTAMP / DTSTART / DTEND、转义并折行', async () => {
  installCalendarHost([{ id: 'a', title: '周会', startTime: todayAt(20), endTime: todayAt(21) }])
  const view = await mount(CalendarCommand)
  await settle()
  await view.run(view.item('a'), '复制当前列表的 ICS 文本')
  assert.match(host.clipboard.text, /^BEGIN:VCALENDAR[\s\S]*SUMMARY:周会/)
  assert.equal(host.lastToast().title, '已复制 ICS 日历文本')
  view.unmount()

  const longNotes = '议程'.repeat(60)
  const ics = buildCalendarIcsContent(
    [{ id: 'e1', title: '评审; A, B\\C', startTime: '10:00', endTime: '11:00', startAt: Date.UTC(2026, 9, 25, 6), endAt: Date.UTC(2026, 9, 25, 7), location: '', calendarName: 'Work', notes: longNotes, attendees: [] }],
    Date.UTC(2026, 9, 22, 0, 0, 0)
  )
  assert.match(ics, /DTSTAMP:20261022T000000Z/)
  assert.match(ics, /DTSTART:20261025T060000Z/)
  assert.match(ics, /DTEND:20261025T070000Z/)
  assert.match(ics, /SUMMARY:评审\\; A\\, B\\\\C/)
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `行过长: ${line}`)
  assert.ok(ics.includes('\r\n '), '长行已折行')
  assert.equal(ics.split('\r\n').map((l, i) => (i > 0 && l.startsWith(' ') ? l.slice(1) : '\n' + l)).join('').includes(`DESCRIPTION:${longNotes}`), true, '折行后能还原')
})

test('[calendar-7] 文件名去掉非法字符；没有宿主环境时导出文件直接报不支持', async () => {
  assert.equal(defaultIcsFileName([{ id: 'x', title: 'a/b:c*?', startTime: '', endTime: '', location: '', calendarName: '', notes: '', attendees: [] }]), 'a_b_c_.ics')
  const stub = {
    calendar_export_ics: async () => ({ success: true, data: { ics: 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nEND:VEVENT\r\nEND:VCALENDAR' } }),
    window_show_save_dialog: async () => ({ success: false, error: { message: '对话框已被其他窗口占用' } })
  }
  await assert.rejects(() => exportCalendarIcsToFile([{ id: 'x', title: '周会' }], stub), /SAVE_DIALOG_FAILED: 对话框已被其他窗口占用/)
})

// ---------------------------------------------------------------------------
// calendar-8：会议链接
// ---------------------------------------------------------------------------

test('[calendar-8] 会议链接规范化：缺协议补 https://，非 http/https、带凭据、含空格的拒绝', () => {
  assert.deepEqual(normalizeConferenceUrl(''), {})
  assert.deepEqual(normalizeConferenceUrl('  '), {})
  assert.deepEqual(normalizeConferenceUrl('vc.feishu.cn/j/999'), { url: 'https://vc.feishu.cn/j/999' })
  assert.deepEqual(normalizeConferenceUrl('vc.feishu.cn:8443/j/1'), { url: 'https://vc.feishu.cn:8443/j/1' })
  assert.deepEqual(normalizeConferenceUrl('https://zoom.us/j/1'), { url: 'https://zoom.us/j/1' })
  assert.deepEqual(normalizeConferenceUrl('HTTP://meet.example.com/x'), { url: 'HTTP://meet.example.com/x' })
  assert.match(normalizeConferenceUrl('zoommtg://zoom.us/join?confno=123456').error, /不支持「zoommtg:」/)
  assert.match(normalizeConferenceUrl('javascript:alert(1)').error, /不支持/)
  assert.match(normalizeConferenceUrl('https://user:pw@zoom.us/j/1').error, /用户名或密码/)
  assert.match(normalizeConferenceUrl('https://zoom.us/j/1 2').error, /http/)
  assert.match(normalizeConferenceUrl('会议室').error, /http/)
})

test('[calendar-8] 表单填 zoommtg:// 时字段报错不保存；没写协议时自动补 https:// 再保存', async () => {
  const db = installCalendarHost([])
  const view = await mount(CalendarCommand)
  await settle()
  const form = await openCreateForm(view)
  await form.fill('title', '会议深链')
  await form.fill('conferenceUrl', 'zoommtg://zoom.us/join?confno=123456')
  await form.run(undefined, '保存日程')
  assert.match(form.field('conferenceUrl').props.error, /zoommtg/)
  assert.equal(db.length, 0)

  await form.fill('conferenceUrl', 'vc.feishu.cn/j/999')
  assert.equal(form.field('conferenceUrl').props.error, undefined)
  await form.run(undefined, '保存日程')
  await settle()
  assert.equal(db.length, 1)
  assert.equal(db[0].conferenceUrl, 'https://vc.feishu.cn/j/999')
  const join = view.actions(view.item('srv-1'))[0]
  assert.equal(join.type, 'Action.OpenInBrowser')
  assert.equal(join.props.url, 'https://vc.feishu.cn/j/999')
  form.unmount()
  view.unmount()
})

test('[calendar-8] 宿主里旧的非网址会议链接不标「可一键入会」，只在详情里如实展示；缺协议的旧链接补 https://', async () => {
  installCalendarHost([
    { id: 'deep', title: '会议深链', startTime: todayAt(20), endTime: todayAt(21), conferenceUrl: 'zoommtg://zoom.us/join?confno=123456' },
    { id: 'bare', title: '飞书会', startTime: todayAt(21), endTime: todayAt(22), conferenceUrl: 'vc.feishu.cn/j/999' }
  ])
  const view = await mount(CalendarCommand)
  await settle()
  const deep = view.item('deep')
  assert.ok(!view.actions(deep).some((a) => a.type === 'Action.OpenInBrowser'))
  assert.equal(deep.props.icon, 'calendar')
  assert.doesNotMatch(JSON.stringify(deep.props.detail), /Join Ready/)
  assert.match(deep.props.detail.props.markdown, /无法直接打开.*zoommtg:\/\/zoom\.us/)
  const bare = view.actions(view.item('bare'))[0]
  assert.equal(bare.type, 'Action.OpenInBrowser')
  assert.equal(bare.props.url, 'https://vc.feishu.cn/j/999')
  // 「视频会议」范围不含无法打开的链接
  await view.dropdown('meetings')
  await settle()
  assert.deepEqual(view.items().map((i) => i.props.id), ['bare'])
  view.unmount()
})

// ---------------------------------------------------------------------------
// calendar-10 / calendar-11：动作顺序与删除
// ---------------------------------------------------------------------------

test('[calendar-10] Enter / ⌘Enter 作用于选中日程：会议是「加入 / 复制会议链接」，普通日程是「复制摘要 / 导出此日程」；新建与导出全部排在后面', async () => {
  installCalendarHost([
    { id: 'm', title: '架构评审', startTime: todayAt(20), endTime: todayAt(21), conferenceUrl: 'https://zoom.us/j/111' },
    { id: 'gym', title: '健身', startTime: todayAt(21), endTime: todayAt(22), location: '健身房' }
  ])
  const view = await mount(CalendarCommand)
  await settle()
  const meeting = view.actions(view.item('m'))
  assert.equal(meeting[0].type, 'Action.OpenInBrowser')
  assert.equal(meeting[1].type, 'Action.CopyToClipboard')
  assert.equal(meeting[1].props.content, 'https://zoom.us/j/111')

  const gym = view.actions(view.item('gym'))
  assert.equal(gym[0].props.title, '复制日程摘要')
  assert.equal(gym[1].props.title, '导出此日程为 ICS 文件...')
  for (const list of [meeting, gym]) {
    const titles = list.map((a) => a.props.title)
    const firstGlobal = titles.indexOf('新建日程事件 (Create Event)...')
    assert.ok(firstGlobal >= 2, '新建不占 Enter / ⌘Enter')
    assert.ok(titles.indexOf('导出当前列表为 ICS 文件...') > firstGlobal)
  }
  // Enter（第 1 个动作）复制的是选中日程自己的摘要
  await view.run(view.item('gym'), gym[0].props.title)
  assert.match(host.clipboard.text, /^健身 \(.* 21:00 - 22:00\) @ 健身房$/)
  view.unmount()
})

test('[calendar-11] 删除不再占用 ⌘X，改为 ⌘⇧⌫，且必须确认；取消确认不删除，确认后删除', async () => {
  const db = installCalendarHost([
    { id: 'a', title: '周会', startTime: todayAt(20), endTime: todayAt(21) },
    { id: 'b', title: '复盘', startTime: todayAt(21), endTime: todayAt(22) }
  ])
  const view = await mount(CalendarCommand)
  await settle()
  const all = view.actions(view.item('a'))
  assert.ok(!all.some((a) => a.props.shortcut?.key === 'x'), '没有动作绑定 X')
  const del = all.find((a) => a.props.title === '删除此日程...')
  assert.deepEqual(del.props.shortcut, { modifiers: ['ctrl', 'shift'], key: 'backspace' })

  host.setConfirm(false)
  await view.run(view.item('a'), '删除此日程...')
  await settle()
  assert.equal(host.confirms.length, 1)
  assert.match(host.confirms[0].title, /周会/)
  assert.equal(host.confirms[0].primaryAction.style, 'destructive')
  assert.ok(!host.ipcCalls.some(([m]) => m === 'calendar_delete_event'), '取消时不调用宿主')
  assert.equal(db.length, 2)
  assert.ok(view.items().some((i) => i.props.id === 'a'))

  host.setConfirm(true)
  await view.run(view.item('a'), '删除此日程...')
  await settle()
  assert.equal(db.length, 1)
  assert.ok(!view.items().some((i) => i.props.id === 'a'))
  assert.equal(host.lastToast().title, '已删除日程: 周会')

  // 顶栏「删除选中日程」同样要确认
  host.setConfirm(false)
  await view.tree().props.filterBar.actions.find((a) => a.id === 'delete-selected-event').onAction()
  await settle()
  assert.equal(db.length, 1)
  view.unmount()
})

test('[calendar-11][故障注入] 确认删除后宿主失败：提示失败并保留条目', async () => {
  installCalendarHost([{ id: 'a', title: '周会', startTime: todayAt(20), endTime: todayAt(21) }])
  host.ipc.calendar_delete_event = async () => {
    throw Object.assign(new Error('database is locked'), { code: 'INTERNAL_ERROR' })
  }
  const view = await mount(CalendarCommand)
  await settle()
  await view.run(view.item('a'), '删除此日程...')
  await settle()
  assert.equal(host.lastToast().title, '删除日程失败')
  assert.ok(view.items().some((i) => i.props.id === 'a'))
  view.unmount()
})

// ---------------------------------------------------------------------------
// calendar-14：读取失败
// ---------------------------------------------------------------------------

test('[calendar-14][故障注入] 首次读取失败：提示失败，空状态是「读取失败，按 Enter 重试」而不是「暂无日程」；重试成功后恢复', async () => {
  const db = [{ id: 'a', title: '周会', startTime: todayAt(20), endTime: todayAt(21) }]
  installCalendarHost(db)
  const realList = host.ipc.calendar_list_events
  host.ipc.calendar_list_events = async () => {
    throw Object.assign(new Error('database is locked'), { code: 'INTERNAL_ERROR' })
  }
  const view = await mount(CalendarCommand)
  await settle()
  assert.equal(host.lastToast().title, '读取日程失败')
  assert.equal(host.lastToast().message, 'database is locked')
  const ids = view.items().map((i) => i.props.id)
  assert.deepEqual(ids, ['calendar-load-error'])
  assert.match(view.tree().props.filterBar.summaryText, /读取日程失败：database is locked/)
  assert.doesNotMatch(view.text(), /当前暂无日程安排/)

  host.ipc.calendar_list_events = realList
  await view.run(view.item('calendar-load-error'), '重新读取日程')
  await settle()
  assert.deepEqual(view.items().map((i) => i.props.id), ['a'])
  assert.doesNotMatch(view.tree().props.filterBar.summaryText, /读取日程失败/)
  view.unmount()
})

test('[calendar-14][故障注入] 已有列表时切换范围读取失败：保留原列表并在状态条说明，⌘R 重新读取', async () => {
  const db = [
    { id: 'a', title: '周会', startTime: todayAt(20), endTime: todayAt(21), conferenceUrl: 'https://zoom.us/j/1' },
    { id: 'b', title: '健身', startTime: todayAt(21), endTime: todayAt(22) }
  ]
  installCalendarHost(db)
  const realList = host.ipc.calendar_list_events
  const view = await mount(CalendarCommand)
  await settle()
  assert.equal(view.items().length, 2)

  host.ipc.calendar_list_events = async () => ({ unexpected: true })
  await view.dropdown('past')
  await settle()
  assert.equal(host.lastToast().title, '读取日程失败')
  assert.match(host.lastToast().message, /格式无法识别/)
  assert.deepEqual(view.items().map((i) => i.props.id).sort(), ['a', 'b'], '保留上次的列表')
  assert.match(view.tree().props.filterBar.summaryText, /上次读取的结果/)

  host.ipc.calendar_list_events = realList
  const reload = view.actions(view.item('a')).find((a) => a.props.title === '重新读取日程')
  assert.deepEqual(reload.props.shortcut, { modifiers: ['ctrl'], key: 'r' })
  await view.run(view.item('a'), '重新读取日程')
  await settle()
  assert.doesNotMatch(view.tree().props.filterBar.summaryText, /读取日程失败/)
  view.unmount()
})

test('[calendar-14] fetchCalendarPage：宿主失败或格式不对时抛 LOAD_EVENTS_FAILED，宿主返回空数组时就是空', async () => {
  const stub = (value) => ({ calendar_list_events: async () => value, calendar_count_events: async () => ({ success: true, data: { total: 0 } }) })
  await assert.rejects(() => fetchCalendarPage('all', '', stub({ success: false, error: { message: 'database is locked' } })), /LOAD_EVENTS_FAILED: database is locked/)
  await assert.rejects(() => fetchCalendarPage('all', '', stub({ success: true, data: { foo: 1 } })), /LOAD_EVENTS_FAILED: 宿主返回的日程格式无法识别/)
  const empty = await fetchCalendarPage('all', '', stub({ success: true, data: [] }))
  assert.deepEqual(empty.events, [], '空数组不回退到演示数据')
  await assert.rejects(
    () => fetchCalendarPage('upcoming', '', { calendar_upcoming_events: async () => { throw new Error('boom') } }),
    /LOAD_EVENTS_FAILED: boom/
  )
  // 导出也不回退
  await assert.rejects(() => exportCalendarIcs([{ id: 'a' }], { calendar_export_ics: async () => ({ success: false, error: { message: 'x' } }) }), /EXPORT_ICS_FAILED/)
})
