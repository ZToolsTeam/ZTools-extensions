// calendar 现行代码（日程管理，对接宿主 calendar_* 接口）的宿主集成与故障注入测试
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchCalendarEvents,
  createCalendarEvent,
  deleteCalendarEvent,
  exportCalendarIcs,
  buildCalendarIcsContent
} from '../dist/index.js'

/** 宿主桩：按方法名返回 { success, data } 信封，未登记的方法视为宿主不支持 */
function hostStub(handlers) {
  const calls = []
  const transport = {
    call: async (method, params) => {
      calls.push({ method, params })
      if (!(method in handlers)) return { success: false, error: { code: 'NOT_SUPPORTED', message: `不支持 ${method}` } }
      const value = typeof handlers[method] === 'function' ? await handlers[method](params) : handlers[method]
      return value
    }
  }
  return { transport, calls }
}

test('读取宿主日程：时间戳格式化为时分，缺字段时给出可读的默认值', async () => {
  const start = new Date(2026, 9, 20, 9, 30).getTime()
  const host = hostStub({
    calendar_list_events: {
      success: true,
      data: [
        { id: 'a1', title: '周会', startTime: start, endTime: start + 3600_000, location: '3F 会议室', conferenceUrl: 'https://meeting.example/1' },
        { id: 'a2' }
      ]
    }
  })
  const events = await fetchCalendarEvents('all', host)
  assert.equal(host.calls[0].method, 'calendar_list_events')
  assert.equal(events.length, 2)
  assert.equal(events[0].title, '周会')
  assert.equal(events[0].startTime, '09:30')
  assert.equal(events[0].endTime, '10:30')
  assert.equal(events[0].conferenceUrl, 'https://meeting.example/1')
  assert.equal(events[1].title, 'Untitled Event')
  assert.equal(events[1].conferenceUrl, undefined)
})

test('「即将开始」走 calendar_upcoming_events，宿主返回 { events } 包装也能读', async () => {
  const host = hostStub({ calendar_upcoming_events: { success: true, data: { events: [{ id: 'u1', title: '评审' }] } } })
  const events = await fetchCalendarEvents('upcoming', host)
  assert.equal(host.calls[0].method, 'calendar_upcoming_events')
  assert.deepEqual(events.map((e) => e.id), ['u1'])
})

test('创建日程：宿主返回 ID 才算成功，地点留空时不编造「Online」', async () => {
  const host = hostStub({ calendar_create_event: (params) => ({ success: true, data: { ...params, id: 'srv-9' } }) })
  const created = await createCalendarEvent({ title: '  一对一  ', startTime: '14:00', endTime: '15:00' }, host)
  assert.equal(created.id, 'srv-9')
  assert.equal(created.title, '一对一')
  assert.equal(created.location, '')
  // 时间以「今天 + 时分」换算成时间戳发给宿主，不再发文字让宿主猜
  const today = new Date(); today.setHours(14, 0, 0, 0)
  assert.equal(host.calls[0].params.startTime, today.getTime())
  assert.equal(host.calls[0].params.endTime, today.getTime() + 3600_000)
})

test('[故障注入] 宿主创建失败或没返回 ID 时抛错，不能假装创建成功', async () => {
  const failing = hostStub({ calendar_create_event: { success: false, error: { code: 'DB_LOCKED', message: '数据库被占用' } } })
  await assert.rejects(() => createCalendarEvent({ title: '会议', startTime: '10:00', endTime: '11:00' }, failing), /CREATE_EVENT_FAILED: 数据库被占用/)
  const noId = hostStub({ calendar_create_event: { success: true, data: { title: '会议' } } })
  await assert.rejects(() => createCalendarEvent({ title: '会议', startTime: '10:00', endTime: '11:00' }, noId), /CREATE_EVENT_FAILED/)
  const unsupported = hostStub({})
  await assert.rejects(() => createCalendarEvent({ title: '会议', startTime: '10:00', endTime: '11:00' }, unsupported), /CREATE_EVENT_FAILED/)
})

test('[边界] 标题为空或只有空格时直接拒绝，不调用宿主', async () => {
  const host = hostStub({ calendar_create_event: { success: true, data: { id: 'x' } } })
  await assert.rejects(() => createCalendarEvent({ title: '   ', startTime: '10:00', endTime: '11:00' }, host), /EVENT_TITLE_REQUIRED/)
  assert.equal(host.calls.length, 0)
})

test('删除日程：宿主删除成功返回 true；宿主失败返回 false，界面据此提示失败', async () => {
  const ok = hostStub({ calendar_delete_event: { success: true, data: true } })
  assert.equal(await deleteCalendarEvent('srv-9', ok), true)
  assert.deepEqual(ok.calls[0].params, { id: 'srv-9' })
  const failing = hostStub({ calendar_delete_event: { success: false, error: { message: '日程不存在' } } })
  assert.equal(await deleteCalendarEvent('srv-404', failing), false)
  assert.equal(await deleteCalendarEvent('   ', ok), false, '空 ID 不调用宿主')
  assert.equal(ok.calls.length, 1)
})

test('导出 ICS：用宿主生成；宿主返回的不是日历格式或失败时抛错，不退回本地生成', async () => {
  const events = [{ id: 'e1', title: '发布评审', startTime: '10:00', endTime: '11:00', location: '', calendarName: 'Work', notes: '', attendees: [] }]
  const host = hostStub({ calendar_export_ics: { success: true, data: { ics: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR' } } })
  assert.match(await exportCalendarIcs(events, host), /^BEGIN:VCALENDAR/)
  const broken = hostStub({ calendar_export_ics: { success: true, data: '<html>error</html>' } })
  await assert.rejects(() => exportCalendarIcs(events, broken), /EXPORT_ICS_FAILED: 宿主返回的不是 ICS/)
  const locked = hostStub({ calendar_export_ics: { success: false, error: { code: 'INTERNAL_ERROR', message: 'database is locked' } } })
  await assert.rejects(() => exportCalendarIcs(events, locked), /EXPORT_ICS_FAILED: database is locked/)
  // 本地生成（无宿主环境）也带完整时间
  assert.match(buildCalendarIcsContent(events), /DTSTART:\d{8}T\d{6}Z[\s\S]*SUMMARY:发布评审/)
})

test('「全部日程」从今天 0 点起加载并带 limit；计数走 calendar_count_events；旧宿主没有计数接口时按已加载数量', async () => {
  const { fetchCalendarPage, CALENDAR_PAGE_LIMIT } = await import('../dist/index.js')
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const host = hostStub({
    calendar_list_events: { success: true, data: [{ id: 'f1', title: '明天的会' }] },
    calendar_count_events: { success: true, data: { total: 812 } }
  })
  const page = await fetchCalendarPage('all', '', host)
  assert.deepEqual(host.calls[0].params, { startTime: todayStart.getTime(), limit: CALENDAR_PAGE_LIMIT })
  assert.deepEqual(host.calls[1], { method: 'calendar_count_events', params: { startTime: todayStart.getTime() } })
  assert.equal(page.total, 812)
  assert.equal(page.searchedOnHost, false)

  const legacy = hostStub({ calendar_list_events: { success: true, data: [{ id: 'f1' }, { id: 'f2' }] } })
  assert.equal((await fetchCalendarPage('all', '', legacy)).total, 2)
  // 计数小于已加载数量（数据异常）时不采信
  const bogus = hostStub({ calendar_list_events: { success: true, data: [{ id: 'f1' }, { id: 'f2' }] }, calendar_count_events: { success: true, data: { total: 1 } } })
  assert.equal((await fetchCalendarPage('all', '', bogus)).total, 2)
})

test('搜索交给宿主（全部时间范围，含拼音）；「历史日程」限定今天以前并按时间倒序', async () => {
  const { fetchCalendarPage, CALENDAR_PAGE_LIMIT } = await import('../dist/index.js')
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const host = hostStub({
    calendar_list_events: { success: true, data: [{ id: 'p1', title: '架构评审' }] },
    calendar_count_events: { success: true, data: { total: 1 } }
  })
  const searched = await fetchCalendarPage('all', '  jiagou ', host)
  assert.deepEqual(host.calls[0].params, { search: 'jiagou', limit: CALENDAR_PAGE_LIMIT })
  assert.equal(searched.searchedOnHost, true)
  await fetchCalendarPage('past', '', host)
  assert.deepEqual(host.calls[2].params, { endTime: todayStart.getTime() - 1, order: 'desc', limit: CALENDAR_PAGE_LIMIT })
  assert.deepEqual(host.calls[3], { method: 'calendar_count_events', params: { endTime: todayStart.getTime() - 1 } }, '计数请求不带 order，宿主会拒绝未知字段')
  // 「即将开始」仍走 upcoming，不发计数请求
  const upcoming = hostStub({ calendar_upcoming_events: { success: true, data: [] } })
  const up = await fetchCalendarPage('upcoming', '会', upcoming)
  assert.equal(upcoming.calls.length, 1)
  assert.equal(up.searchedOnHost, false)
})

test('创建日程：以宿主实际保存的会议链接与日历为准', async () => {
  const host = hostStub({
    calendar_create_event: (params) => ({ success: true, data: { ...params, id: 'srv-1', conferenceUrl: undefined, calendarName: 'Engineering' } })
  })
  const created = await createCalendarEvent({ title: '写周报', startTime: '10:00', endTime: '11:00', calendarName: 'Engineering', notes: '[链接](https://example.com)' }, host)
  assert.equal(host.calls[0].params.calendarName, 'Engineering')
  assert.equal(created.calendarName, 'Engineering')
  assert.equal(created.conferenceUrl, undefined)
  const detected = hostStub({ calendar_create_event: (params) => ({ success: true, data: { ...params, id: 'srv-2', conferenceUrl: 'https://zoom.us/j/1' } }) })
  assert.equal((await createCalendarEvent({ title: '周会', startTime: '10:00', endTime: '11:00', notes: 'https://zoom.us/j/1' }, detected)).conferenceUrl, 'https://zoom.us/j/1')
})

test('导出 ICS：只把当前列表日程的 id 发给宿主', async () => {
  const events = [{ id: 'e1', title: '健身', startTime: '19:30', endTime: '20:30', location: '', calendarName: 'Personal', notes: '', attendees: [] }]
  const host = hostStub({ calendar_export_ics: { success: true, data: { ics: 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nEND:VEVENT\r\nEND:VCALENDAR', count: 1 } } })
  await exportCalendarIcs(events, host)
  assert.deepEqual(host.calls[0].params, { eventIds: ['e1'] })
  await exportCalendarIcs([], host)
  assert.deepEqual(host.calls[1].params, { eventIds: [] })
})
