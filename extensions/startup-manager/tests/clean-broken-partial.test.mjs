import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { removeBrokenStartupItems, describeCleanBrokenResult } = require('../dist/startup-service.js')

const reg = { id: 'reg:HKCU:Ghost', name: 'Ghost', command: '"C:\\gone\\ghost.exe"', exePath: 'C:\\gone\\ghost.exe', source: 'registry', sourceLabel: '注册表', scope: 'HKCU', enabled: true, fileMissing: true }
const task = { id: 'task:\\Old\\Updater', name: 'OldUpdater', command: '"C:\\gone\\up.exe"', exePath: 'C:\\gone\\up.exe', source: 'task', sourceLabel: '计划任务', taskPath: '\\Old\\Updater', enabled: true, fileMissing: true }
const valid = { id: 'reg:HKCU:Valid', name: 'Valid', command: '"C:\\app\\ok.exe"', exePath: 'C:\\app\\ok.exe', source: 'registry', sourceLabel: '注册表', scope: 'HKCU', enabled: true, fileMissing: false }

/** 宿主替身：按真实 dllplugin_call 形态返回 { success: true, data }，记录调用参数 */
function bridge(data, calls = []) {
  return { async dllplugin_call(payload) { calls.push(payload); return typeof data === 'function' ? data(payload) : { success: true, data } } }
}

test('部分成功：宿主 success:true + partial，只移除 removedIds，failed 原因兼容 error / reason / code 字段', async () => {
  const calls = []
  const res = await removeBrokenStartupItems([reg, task], [valid, reg, task], bridge({
    ok: true, success: true, partial: true, removedIds: [reg.id],
    failed: [{ id: task.id, code: 'UNSUPPORTED_SOURCE', reason: '计划任务不支持作为残留项删除' }],
    errorCode: 'PARTIAL_FAILED', error: 'PARTIAL_FAILED: task:\\Old\\Updater：计划任务不支持作为残留项删除'
  }, calls))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].func, 'removeBroken')
  assert.equal(res.ok, true)
  assert.equal(res.partial, true)
  assert.equal(res.removedCount, 1)
  assert.deepEqual(res.removedIds, [reg.id])
  assert.deepEqual(res.remainingItems.map((i) => i.id), [valid.id, task.id])
  assert.deepEqual(res.failed, [{ id: task.id, errorCode: 'UNSUPPORTED_SOURCE', error: '计划任务不支持作为残留项删除' }])
  assert.equal(res.errorCode, 'PARTIAL_FAILED')
  const notice = describeCleanBrokenResult(res, [valid, reg, task])
  assert.equal(notice.title, '已清理 1 个，1 个未清理')
  assert.equal(notice.message, 'OldUpdater：计划任务不支持作为残留项删除')
})

test('部分成功：宿主只带 failed 不带 partial / error 时同样识别为部分成功并生成原因', async () => {
  const res = await removeBrokenStartupItems([reg, task], [reg, task], bridge({
    ok: true, removedIds: [reg.id], failed: [{ id: task.id, errorCode: 'ADMIN_REQUIRED', error: '拒绝访问' }, { id: 'x' }]
  }))
  assert.equal(res.partial, true)
  assert.equal(res.errorCode, 'PARTIAL_FAILED')
  assert.match(res.error, /^PARTIAL_FAILED: task:\\Old\\Updater：拒绝访问/)
  // 没有原因字段的失败条目不吞掉：用错误码或“未说明原因”占位
  assert.deepEqual(res.failed[1], { id: 'x', errorCode: '', error: '未说明原因' })
})

test('故障注入：宿主声称删除了未提交清理的条目时不会把无关条目从列表移除，重复 id 只计一次', async () => {
  const res = await removeBrokenStartupItems([reg], [valid, reg], bridge({ ok: true, success: true, removedIds: [reg.id, reg.id, valid.id] }))
  assert.equal(res.ok, true)
  assert.equal(res.partial, undefined)
  assert.equal(res.removedCount, 1)
  assert.deepEqual(res.remainingItems.map((i) => i.id), [valid.id])
  assert.deepEqual(describeCleanBrokenResult(res), { title: '已清理 1 个无效残留启动项' })
})

test('全部失败：宿主 success:false 时传输层丢弃数据，如实失败且列表不变；调用抛错同样失败', async () => {
  const allFailed = await removeBrokenStartupItems([reg, task], [reg, task], bridge(() => ({ success: true, data: { ok: false, success: false, removedIds: [], failed: [{ id: reg.id, errorCode: 'ADMIN_REQUIRED', error: '拒绝访问' }], errorCode: 'ADMIN_REQUIRED', error: 'ADMIN_REQUIRED: 拒绝访问' } })))
  assert.equal(allFailed.ok, false)
  assert.equal(allFailed.removedCount, 0)
  assert.equal(allFailed.remainingItems.length, 2)
  assert.match(allFailed.error, /拒绝访问/)
  assert.deepEqual(describeCleanBrokenResult(allFailed), { title: '批量清理残留启动项失败', message: allFailed.error })
  const thrown = await removeBrokenStartupItems([reg], [reg], { async dllplugin_call() { throw new Error('IPC 通道已关闭') } })
  assert.equal(thrown.ok, false)
  assert.equal(thrown.removedCount, 0)
  assert.deepEqual(thrown.remainingItems.map((i) => i.id), [reg.id])
})

test('宿主返回 ok:true 但没有 removedIds：视为未删除任何条目，列表不变', async () => {
  const res = await removeBrokenStartupItems([reg], [reg], bridge({ ok: true, success: true }))
  assert.equal(res.ok, true)
  assert.equal(res.removedCount, 0)
  assert.deepEqual(res.remainingItems.map((i) => i.id), [reg.id])
})

test('界面：一键清理部分成功时提示“已清理 X 个，Y 个未清理”并列出原因，列表只移除已删除条目', async () => {
  const { createHost, mount, tick } = await import('../../shared/test-harness.mjs')
  const { default: WindowsCommand } = await import('../dist/windows-command.js')
  const host = createHost()
  const removeCalls = []
  host.ipc.dllplugin_call = async ({ func, params }) => {
    if (func === 'listAll') return { ok: true, items: [valid, reg, task] }
    if (func === 'removeBroken') {
      removeCalls.push(params)
      return { ok: true, success: true, partial: true, removedIds: [reg.id], failed: [{ id: task.id, errorCode: 'UNSUPPORTED_SOURCE', error: '计划任务不支持作为残留项删除，请在系统中卸载对应程序' }], errorCode: 'PARTIAL_FAILED', error: 'PARTIAL_FAILED: 部分条目未清理' }
    }
    throw new Error(`未预期的调用 ${func}`)
  }
  const view = await mount(() => WindowsCommand({}), host)
  await tick()
  try {
    assert.deepEqual(view.items().map((i) => i.props.id).sort(), [reg.id, task.id, valid.id].sort())
    const clean = view.tree().props.filterBar.actions.find((a) => a.id === 'clean-broken')
    clean.onAction()
    await tick(10)
    assert.equal(removeCalls.length, 1)
    assert.deepEqual(removeCalls[0].items.map((i) => i.id), [reg.id, task.id])
    const toast = host.lastToast()
    assert.equal(toast.title, '已清理 1 个，1 个未清理')
    assert.equal(toast.style, 'FAILURE')
    assert.equal(toast.message, 'OldUpdater：计划任务不支持作为残留项删除，请在系统中卸载对应程序')
    assert.ok(!host.toasts.some((t) => String(t.style).toUpperCase() === 'SUCCESS'))
    assert.deepEqual(view.items().map((i) => i.props.id).sort(), [task.id, valid.id].sort())
  } finally {
    view.unmount()
    await tick()
  }
})

test('界面：复制命令行或定位程序失败时如实提示失败，不显示成功', async () => {
  const { createHost, mount, tick } = await import('../../shared/test-harness.mjs')
  const { default: WindowsCommand } = require('../dist/windows-command.js')
  const host = createHost()
  const override = {
    async dllplugin_call() { return { success: true, data: { ok: true, items: [valid] } } },
    async clipboard_copy_text() { throw new Error('剪贴板被占用') },
    async clipboard_write_text() { return { success: false, error: '剪贴板被占用' } },
    async shell_show_item_in_folder() { throw new Error('路径不存在') },
    async shell_open_path() { return { success: false, error: '路径不存在' } }
  }
  const view = await mount(() => WindowsCommand({ hostOverride: override }), host)
  await tick()
  const row = view.item(valid.id)
  await view.run(row, '复制启动命令行'); await tick()
  assert.equal(host.lastToast().title, '复制启动命令行失败')
  await view.run(row, '在资源管理器中定位程序'); await tick()
  assert.equal(host.lastToast().title, '无法定位程序文件')
  assert.equal(host.toasts.filter((t) => t.style === 'success').length, 0)
  view.unmount()
})
