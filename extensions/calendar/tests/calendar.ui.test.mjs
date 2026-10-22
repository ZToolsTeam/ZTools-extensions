// calendar 界面集成测试：真实声明式运行时 + 按宿主语义（时间窗口 / 搜索 / limit / 计数 / 按 id 导出）模拟的日程库
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import CalendarCommand from '../dist/index.js'

const host = createHost()
const HOUR = 3600_000
const DAY = 24 * HOUR

function seedDb() {
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const db = []
  for (let i = 0; i < 45; i++) {
    const start = todayStart.getTime() - (60 - i) * DAY
    db.push({ id: `old-${i}`, title: `历史日程 ${i}`, startTime: start, endTime: start + HOUR, calendarName: 'Calendar' })
  }
  for (let i = 0; i < 9; i++) {
    const start = todayStart.getTime() + 8 * HOUR + i * HOUR
    db.push({ id: `today-${i}`, title: `今天日程 ${i}`, startTime: start, endTime: start + HOUR, calendarName: 'Work' })
  }
  const tomorrow = todayStart.getTime() + DAY + HOUR
  db.push({ id: 'overflow', title: 'V溢出 跨午夜测试', startTime: tomorrow, endTime: tomorrow + HOUR, calendarName: 'Engineering' })
  db.push({ id: 'gym', title: '健身', startTime: tomorrow + 2 * HOUR, endTime: tomorrow + 3 * HOUR, calendarName: 'Personal' })
  return db
}

function filterDb(db, q) {
  return db.filter((e) => {
    if (q.search && !e.title.toLowerCase().includes(String(q.search).toLowerCase())) return false
    if (q.startTime !== undefined && e.endTime < q.startTime) return false
    if (q.endTime !== undefined && e.startTime > q.endTime) return false
    return true
  })
}

function installCalendarHost(db, { limitCap = 50 } = {}) {
  host.ipc.calendar_list_events = async (q) => {
    const sorted = filterDb(db, q).sort((a, b) => (q.order === 'desc' ? b.startTime - a.startTime : a.startTime - b.startTime))
    return sorted.slice(0, Math.min(q.limit ?? 50, limitCap))
  }
  host.ipc.calendar_count_events = async (q) => ({ total: filterDb(db, q).length })
  host.ipc.calendar_export_ics = async ({ eventIds }) => {
    const picked = db.filter((e) => eventIds.includes(e.id))
    const ics = ['BEGIN:VCALENDAR', ...picked.flatMap((e) => ['BEGIN:VEVENT', `SUMMARY:${e.title}`, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n')
    return { ics, count: picked.length }
  }
}

test.beforeEach(() => host.reset())

test('日程超过 50 条：默认只列今天起的日程，搜索明天的日程能找到，搜索结果导出只含 1 个 VEVENT', async () => {
  installCalendarHost(seedDb(), { limitCap: 1000 })
  const view = await mount(CalendarCommand)
  await tick(10)
  const ids = view.items().map((i) => i.props.id)
  assert.ok(ids.includes('overflow'), '明天的日程在列表中')
  assert.ok(!ids.some((id) => id.startsWith('old-')), '历史日程不混在默认列表里')
  assert.equal(ids.length, 11)
  assert.equal(view.item('overflow').props.accessories[0].text, 'Engineering')

  await view.search('V溢出')
  await new Promise((r) => setTimeout(r, 300))
  await tick(10)
  assert.deepEqual(view.items().map((i) => i.props.id), ['overflow'])
  const listCall = host.ipcCalls.filter(([m]) => m === 'calendar_list_events').at(-1)
  assert.equal(listCall[1].search, 'V溢出')

  await view.search('健身')
  await new Promise((r) => setTimeout(r, 300))
  await tick(10)
  await view.run(view.item('gym'), '复制当前列表的 ICS 文本')
  assert.equal((host.clipboard.text.match(/BEGIN:VEVENT/g) || []).length, 1)
  assert.match(host.lastToast().message ?? '', /包含 1 个日程事件/)
  view.unmount()
})

test('[边界] 加载数量少于总数时状态条如实提示「仅显示前 N 条」；「历史日程」能看到今天以前的日程', async () => {
  installCalendarHost(seedDb(), { limitCap: 5 })
  const view = await mount(CalendarCommand)
  await tick(10)
  assert.match(view.tree().props.filterBar.summaryText, /仅显示前 5 条（共 11 条）/)
  await view.dropdown('past')
  await tick(10)
  const ids = view.items().map((i) => i.props.id)
  assert.deepEqual(ids, ['old-44', 'old-43', 'old-42', 'old-41', 'old-40'])
  view.unmount()
})

test('[故障注入] 计数接口失败时不影响列表显示；搜索请求连续输入时只采用最后一次结果', async () => {
  const db = seedDb()
  installCalendarHost(db, { limitCap: 1000 })
  host.ipc.calendar_count_events = async () => { throw Object.assign(new Error('db busy'), { code: 'DATABASE_LOCKED' }) }
  const view = await mount(CalendarCommand)
  await tick(10)
  assert.equal(view.items().length, 11)
  assert.doesNotMatch(view.tree().props.filterBar.summaryText, /仅显示前/)

  await view.search('今')
  await view.search('今天')
  await view.search('V溢')
  await new Promise((r) => setTimeout(r, 300))
  await tick(10)
  assert.deepEqual(view.items().map((i) => i.props.id), ['overflow'])
  const searches = host.ipcCalls.filter(([m, p]) => m === 'calendar_list_events' && p.search).map(([, p]) => p.search)
  assert.deepEqual(searches, ['V溢'], '中间输入不发请求')
  view.unmount()
})

test('顶栏不放针对单条日程的「加入会议」；每条会议日程的主动作打开它自己的会议链接，文案不含彩色 Emoji', async () => {
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const base = todayStart.getTime() + 20 * HOUR
  installCalendarHost([
    { id: 'm1', title: '晨会站会', startTime: base, endTime: base + HOUR, calendarName: 'Work', conferenceUrl: 'https://zoom.us/j/111222333' },
    { id: 'm2', title: '会议深链', startTime: base + 2 * HOUR, endTime: base + 3 * HOUR, calendarName: 'Work', conferenceUrl: 'https://meet.example.com/deep' },
    { id: 'gym', title: '健身', startTime: base + 4 * HOUR, endTime: base + 5 * HOUR, calendarName: 'Personal' }
  ], { limitCap: 1000 })
  const view = await mount(CalendarCommand)
  await tick(10)
  const fb = view.tree().props.filterBar
  assert.ok(!fb.actions.some((a) => /加入/.test(a.title || a.label || '')), '顶栏不应有加入会议')
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u
  assert.doesNotMatch(fb.summaryText, emoji)
  for (const a of fb.actions) assert.doesNotMatch(String(a.title || a.label), emoji)
  const first = view.actions(view.item('m2'))[0]
  assert.equal(first.type, 'Action.OpenInBrowser')
  assert.equal(first.props.url, 'https://meet.example.com/deep')
  assert.ok(!view.actions(view.item('gym')).some((a) => a.type === 'Action.OpenInBrowser'))
  assert.doesNotMatch(view.item('m2').props.detail.props.markdown, emoji)
  view.unmount()
})
