import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import Command, { commands } from '../dist/index.js'
import { scanStartup } from '../dist/mac-service.js'
const item = (extra = {}) => ({ id: 'a'.repeat(64), label: 'cn.test.worker', file: '/tmp/worker.plist', domain: 'gui/501', scope: 'user-agent', program: '/bin/echo', args: ['echo', 'test'], scheduled: false, enabled: true, loaded: true, running: true, pid: 123, programState: 'available', requiresAdmin: false, blockedReason: null, ...extra })
const report = () => ({ success: true, items: [item(), item({ id: 'b'.repeat(64), label: 'cn.test.task', file: '/tmp/task.plist', scope: 'daemon', scheduled: true, requiresAdmin: true })], warnings: [], backups: [] })
let host, views
beforeEach(() => {
  host = createHost(); views = []
  host.ipc.system_get_platform = async () => ({ success: true, platform: 'macos' })
  host.ipc.startup_manager = async p => p.action === 'scan' ? report() : p.action === 'cancel' ? { success: true, cancelled: true } : { success: true, enabled: p.enabled, backupId: 'test-backup', message: '下一次加载生效' }
})
afterEach(async () => { views.forEach(v => v.unmount()); await tick() })
async function open(command = Command) { const v = await mount(command, host); views.push(v); await tick(); return v }
const calls = action => host.ipcCalls.filter(([method, params]) => method === 'startup_manager' && params.action === action)
test('真实 SDK 布局一显示运行和自启状态；Enter 走新宿主，次动作复制路径', async () => {
  const view = await open(); assert.equal(view.tree().props.isShowingDetail, false); assert.equal(calls('scan').length, 1)
  assert.match(view.text(), /允许自启/); assert.match(view.text(), /运行中/)
  const row = view.item('a'.repeat(64)); assert.equal(view.actions(row)[0].props.title, '禁止后续自启')
  assert.ok(!view.actions(row).some(action => action.props.title.includes('失效配置')))
  await view.run(row, '禁止后续自启'); assert.equal(calls('set-enabled').length, 1); assert.equal(calls('scan').length, 2)
  assert.equal(calls('set-enabled')[0][1].enabled, false); assert.match(host.lastToast().message, /下一次加载/)
  await view.run(view.item('a'.repeat(64)), '复制程序路径'); assert.equal(host.clipboard.text, '/bin/echo')
  assert.ok(!host.ipcCalls.some(([m]) => m === 'dllplugin_call'))
})
test('服务与计划任务入口正确过滤；唯一筛选和全局动作不重复', async () => {
  const service = await open(commands['startup-services']); assert.equal(service.items().length, 1); assert.match(service.text(), /cn.test.task/)
  const task = await open(commands['startup-tasks']); assert.equal(task.items().length, 1)
  await task.dropdown('all'); await task.search('worker'); assert.equal(task.items().length, 1)
  assert.equal(task.tree().props.filterBar.actions.length, 2)
})
test('扫描与写入失败不报成功；畸形响应不能当成没有启动项', async () => {
  const view = await open(); host.ipc.startup_manager = async () => { throw new Error('系统拒绝修改') }
  await view.run(view.item('a'.repeat(64)), '禁止后续自启'); assert.match(view.text(), /系统拒绝修改/)
  assert.equal(host.toasts.filter(t => t.style === 'success').length, 0)
  for (const patch of [{ items: null }, { items: [item({ enabled: 'false' })] }, { items: [item(), item()] }, { backups: [{ id: 'x', label: 'x', createdAt: 'bad' }] }]) {
    host.ipc.startup_manager = async () => ({ ...report(), ...patch }); await assert.rejects(scanStartup('id'), /无效|不完整/)
  }
})
test('卸载取消在途扫描，迟到结果和写入成功均不再显示', async () => {
  const view = await open(); let finish
  host.ipc.startup_manager = async p => p.action === 'set-enabled' ? new Promise(resolve => { finish = resolve }) : { success: true, cancelled: true }
  const job = view.run(view.item('a'.repeat(64)), '禁止后续自启'); await tick()
  view.unmount(); views = []; await tick(); assert.equal(calls('cancel').length, 1)
  finish({ success: true, enabled: false, backupId: 'test-backup', message: '完成' }); await job; await tick()
  assert.equal(calls('scan').length, 1); assert.equal(host.toasts.length, 0)
})
test('失效配置清理先确认；正常项不显示清理；恢复使用原备份 ID', async () => {
  const backup = { id: 'c'.repeat(36), kind: 'remove', label: 'cn.test.worker', createdAt: new Date().toISOString(), beforeEnabled: true, afterEnabled: true }
  let removed = false
  host.ipc.startup_manager = async p => {
    if (p.action === 'scan') return { ...report(), items: removed ? [] : [item({ programState: 'missing' })], backups: removed ? [backup] : [] }
    if (p.action === 'remove') { removed = true; return { success: true, removed: true, backupId: backup.id, message: '可恢复' } }
    if (p.action === 'restore') { removed = false; return { success: true, restored: true, backupId: p.id, message: '已恢复' } }
    throw new Error('未预期的操作')
  }
  const view = await open(), row = view.item('a'.repeat(64))
  host.setConfirm(false)
  await view.run(row, '移除失效配置（可恢复）'); assert.equal(calls('remove').length, 0)
  host.setConfirm(true)
  await view.run(row, '移除失效配置（可恢复）'); assert.equal(calls('remove').length, 1); assert.match(host.confirms.at(-1).message, /不会结束/)
  await view.dropdown('backups'); await view.run(view.item(backup.id), '恢复启动配置')
  assert.equal(calls('restore')[0][1].id, backup.id); assert.match(host.lastToast().title, /恢复/)
})
