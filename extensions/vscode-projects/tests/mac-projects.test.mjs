import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import Command, { commands } from '../dist/index.js'
import { scanMacProjects, openMacProject } from '../dist/mac-service.js'
const project = (editor = 'cursor', state = 'available') => ({ id: (editor === 'cursor' ? 'a' : 'b').repeat(64), name: '工程 $&', path: '/tmp/工程 $&', editor, editorName: editor === 'cursor' ? 'Cursor' : 'GoLand', family: editor === 'cursor' ? 'vsc' : 'jetbrains', kind: 'folder', lastOpenedMs: null, gitBranch: 'feature/工作树', pathState: state, pathError: null })
const report = () => ({ success: true, projects: [project(), project('goland', 'missing')], sourcesRead: 2, skippedRemote: 1, warnings: [] })
let host, views
beforeEach(() => { host = createHost(); views = []; host.ipc.system_get_platform = async () => ({ success: true, platform: 'macos' }); host.ipc.recent_projects = async p => p.action === 'scan' ? report() : p.action === 'cancel' ? { success: true, cancelled: true } : { success: true, id: p.id, action: p.action, accepted: true } })
afterEach(async () => { for (const v of views) v.unmount(); await tick() })
async function open(command = Command) { const v = await mount(command, host); views.push(v); await tick(); return v }
const calls = action => host.ipcCalls.filter(([m,p]) => m === 'recent_projects' && p.action === action)
test('真实 SDK 首屏扫描、宽列表和主次动作；不走 DLL、不伪造时间', async () => {
  const v = await open(); assert.equal(calls('scan').length, 1); assert.equal(v.tree().props.isShowingDetail, false); assert.match(v.text(), /跳过 1 条远程/); assert.doesNotMatch(v.text(), /刚刚打开|分钟前/)
  assert.ok(!host.ipcCalls.some(([m]) => m === 'dllplugin_call'))
  const item = v.item('a'.repeat(64)), actions = v.actions(item)
  assert.match(actions[0].props.title, /Cursor/); assert.equal(actions[1].props.title, '在终端打开'); assert.deepEqual(actions[1].props.shortcut, { modifiers: ['cmd'], key: 'enter' })
  await v.run(item, '用 Cursor 打开项目'); assert.equal(calls('open').length, 1); await v.run(item, '在终端打开'); assert.equal(calls('terminal').length, 1)
  await v.run(item, '复制项目路径'); assert.equal(host.clipboard.text, project().path)
})
test('三个入口正确分组，搜索、隐藏失效与恢复不写入编辑器历史', async () => {
  const v = await open(commands['projects-jetbrains']); assert.equal(v.items().length, 1); assert.match(v.text(), /GoLand/)
  await v.tree().props.filterBar.actions[1].onAction(); await tick(); assert.match(v.text(), /没有匹配/)
  await v.tree().props.filterBar.actions[1].onAction(); await tick(); assert.match(v.text(), /路径不存在/)
  await v.dropdown('all'); await v.search('feature/工作树'); assert.equal(v.items().length, 2)
  const other = await open(commands['projects-vscode-cursor']); assert.equal(other.items().length, 1); assert.match(other.text(), /Cursor/)
  assert.equal(host.storage.size, 0); assert.equal(calls('open').length, 0)
})
test('扫描/打开失败真实显示，重扫移除旧结果，错误回执不能报成功', async () => {
  const v = await open(); host.ipc.recent_projects = async () => { throw new Error('数据库权限不足') }
  await v.run(v.item('a'.repeat(64)), '用 Cursor 打开项目'); assert.match(host.lastToast().message, /权限不足/)
  await v.tree().props.filterBar.actions[0].onAction(); await tick(); assert.match(v.text(), /权限不足/); assert.equal(v.items().length, 1)
  host.ipc.recent_projects = async () => ({ success: true }); await assert.rejects(openMacProject(project(), 'open'), /未确认/)
})
test('严格响应校验，数组平台和枚举不冒充字符串', async () => {
  for (const patch of [{ projects: null }, { sourcesRead: -1 }, { projects: [project(), project()] }, { projects: [{ ...project(), family: ['vsc'] }] }, { projects: [{ ...project(), pathState: ['available'] }] }]) {
    host.ipc.recent_projects = async () => ({ ...report(), ...patch }); await assert.rejects(scanMacProjects('test'), /无效|不完整/)
  }
  host.ipc.system_get_platform = async () => ({ success: true, platform: ['macos'] }); const v = await open(); assert.match(v.text(), /不支持/)
})
test('重复扫描互斥，取消及卸载不会展示迟到结果', async () => {
  const v = await open(); let finish
  host.ipc.recent_projects = async p => p.action === 'scan' ? new Promise(resolve => { finish = resolve }) : { success: true, cancelled: true }
  const action = v.tree().props.filterBar.actions[0]; const pending = action.onAction(); await tick(); await action.onAction(); assert.equal(calls('scan').length, 2)
  await v.tree().props.filterBar.actions[0].onAction(); finish(report()); await pending; await tick(); assert.match(v.text(), /已停止/)
  const next = v.tree().props.filterBar.actions[0].onAction(); await tick(); v.unmount(); views = []; finish(report()); await next; assert.equal(calls('cancel').length, 2)
})
test('离开页面会取消打开任务，迟到成功不产生 Toast；打开中的按钮正确标注取消', async () => {
  const v = await open(); let finish
  host.ipc.recent_projects = async p => p.action === 'open' ? new Promise(resolve => { finish = resolve }) : { success: true, cancelled: true }
  const job = v.run(v.item('a'.repeat(64)), '用 Cursor 打开项目'); await tick()
  assert.equal(v.tree().props.filterBar.actions[0].title, '取消打开')
  const before = host.toasts.length; v.unmount(); views = []; await tick()
  assert.equal(calls('cancel').at(-1)[1].operationId, 'a'.repeat(64))
  finish({ success: true, id: 'a'.repeat(64), action: 'open', accepted: true }); await job; await tick(); assert.equal(host.toasts.length, before)
})
