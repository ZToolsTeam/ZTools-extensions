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
  assert.equal(host.calls[0].params.startTime, '14:00')
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

test('导出 ICS：优先用宿主生成；宿主返回的不是日历格式时用本地生成的', async () => {
  const events = [{ id: 'e1', title: '发布评审', startTime: '10:00', endTime: '11:00', location: '', calendarName: 'Work', notes: '', attendees: [] }]
  const host = hostStub({ calendar_export_ics: { success: true, data: { ics: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR' } } })
  assert.match(await exportCalendarIcs(events, host), /^BEGIN:VCALENDAR/)
  const broken = hostStub({ calendar_export_ics: { success: true, data: '<html>error</html>' } })
  const local = await exportCalendarIcs(events, broken)
  assert.equal(local, buildCalendarIcsContent(events))
  assert.match(local, /SUMMARY:发布评审/)
})
