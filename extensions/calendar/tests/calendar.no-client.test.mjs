// 不在 ZTools 客户端里运行时：不显示示例日程，新建 / 读取 / 删除如实报不可用，不在内存里假装保存
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import CalendarCommand, {
  NOT_IN_CLIENT_MESSAGE,
  createCalendarEvent,
  deleteCalendarEvent,
  fetchCalendarPage,
  exportCalendarIcs
} from '../dist/index.js'

const host = createHost()

function withoutClient(fn) {
  return async () => {
    const saved = globalThis.__ztoolsElectron
    delete globalThis.__ztoolsElectron
    try {
      await fn()
    } finally {
      globalThis.__ztoolsElectron = saved
    }
  }
}

test('界面只显示“需要在 ZTools 客户端中使用”，没有示例日程，也不发请求、不弹失败提示', withoutClient(async () => {
  host.reset()
  const view = await mount(CalendarCommand, host)
  await tick(10)
  const items = view.items()
  assert.equal(items.length, 1)
  assert.equal(items[0].props.id, 'calendar-client-required')
  assert.equal(items[0].props.title, NOT_IN_CLIENT_MESSAGE)
  assert.equal(view.text().includes('评审'), false)
  assert.equal(host.ipcCalls.length, 0)
  assert.equal(host.toasts.length, 0)
  view.unmount()
}))

test('读取、新建、删除在没有客户端时如实失败，不在内存里假装保存', withoutClient(async () => {
  await assert.rejects(() => fetchCalendarPage('all', ''), /NOT_IN_CLIENT: 需要在 ZTools 客户端中使用/)
  await assert.rejects(
    () => createCalendarEvent({ title: '周会', startTime: '10:00', endTime: '11:00' }),
    /NOT_IN_CLIENT/
  )
  // 校验错误仍然先于“需要客户端”报出
  await assert.rejects(() => createCalendarEvent({ title: '  ', startTime: '10:00', endTime: '11:00' }), /EVENT_TITLE_REQUIRED/)
  assert.equal(await deleteCalendarEvent('evt-arch-sync'), false)
  // 默认导出的是本次会话经客户端保存的日程，没有示例日程
  const ics = await exportCalendarIcs()
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 0)
}))
