import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import FolderSync from '../dist/index.js'
import { chooseFolder, compareFolderTrees, executeFolderSync, revealRecovery } from '../dist/sync-service.js'
const host = createHost(), views = []
const item = (relPath, direction, diffType) => ({ relPath, direction, diffType, actionBadge: direction, reasonText: '真实清单说明', sizeBytes: 3, sourceFullPath: '/fixture/source/' + relPath, targetFullPath: '/fixture/target/' + relPath })
const diffs = [item('new.txt', 'src-to-dst', 'added'), item('old.txt', 'delete-dst', 'orphan'), item('conflict.txt', 'conflict', 'conflict')]
const plan = { success: true, ok: true, planId: '12345678-1234-1234-1234-123456789abc', diffs }
const done = { success: true, ok: true, syncedCount: 1, deletedCount: 0, transferredBytes: 3, remainingCount: 0, failures: [], recoveryPaths: ['/fixture/target/.ztools-sync-backups/run'] }
const deferred = () => { let resolve; return { promise: new Promise(r => { resolve = r }), resolve: v => resolve(v) } }
async function open() { const view = await mount(FolderSync); views.push(view); await tick(); return view }
const top = (view, id) => view.tree().props.filterBar.actions.find(action => action.id === id)
const rows = view => view.tree().props.subList.items
async function compare(view) { await top(view, 'pick').onAction(); await tick(); await top(view, 'compare').onAction(); await tick() }
const primary = view => rows(view)[0].props.actions.children[0].props.onAction()
test.beforeEach(() => {
  host.reset(); let picked = 0
  host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: picked++ % 2 ? '/fixture/target' : '/fixture/source' })
  host.ipc.folder_sync = async p => p.action === 'compare' ? plan : done
  host.ipc.folder_sync_cancel = async () => ({ success: true, cancelRequested: true })
  host.ipc.shell_show_item_in_folder = async () => ({ success: true })
})
test.afterEach(() => { views.splice(0).forEach(view => view.unmount()) })
test('初始不假称比对完成，目录选择走读写授权接口，取消不提交路径', async () => {
  const view = await open(); assert.doesNotMatch(view.text(), /比对完成|完全一致/)
  await compare(view)
  assert.equal(host.ipcCalls.filter(([method]) => method === 'window_show_select_folder_dialog').length, 2)
  assert.ok(!host.ipcCalls.some(([method]) => /dllplugin|dialog_show_open/.test(method)))
  const call = host.ipcCalls.find(([method]) => method === 'folder_sync')[1]
  assert.equal(call.sourceDir, '/fixture/source'); assert.equal(call.targetDir, '/fixture/target')
  host.ipc.window_show_select_folder_dialog = async () => ({ canceled: true }); assert.equal(await chooseFolder('source'), undefined)
})
test('执行只提交已展示计划和勾选文件，回收不默认选中且冲突不可选', async () => {
  const view = await open(); await compare(view)
  assert.equal(rows(view)[0].props.checked, true); assert.equal(rows(view)[1].props.checked, false)
  assert.equal(rows(view)[2].props.checkable, false)
  await primary(view); await tick()
  const p = host.ipcCalls.find(([method, params]) => method === 'folder_sync' && params.action === 'execute')[1]
  assert.equal(p.planId, plan.planId); assert.deepEqual(p.selectedRelPaths, ['new.txt']); assert.equal(p.sourceDir, undefined)
  assert.match(view.text(), /已写入 1 项/)
})
test('改模式失效旧计划，执行时修改设置不改在途清单', async () => {
  const view = await open(); await compare(view)
  view.tree().props.workbenchPanel.fields[0].onChange('two-way'); await tick()
  assert.equal(rows(view).length, 0); assert.match(view.text(), /重新比对/)
  await top(view, 'compare').onAction(); await tick()
  const waiting = deferred(); host.ipc.folder_sync = () => waiting.promise
  const work = primary(view); await tick(); view.tree().props.workbenchPanel.fields[0].onChange('mirror'); await tick()
  assert.equal(view.tree().props.workbenchPanel.fields[0].value, 'two-way')
  waiting.resolve(done); await work
})
test('失败与部分完成明确显示实际错误及备份，不把任意错误解释成文件占用', async () => {
  const view = await open(); await compare(view)
  host.ipc.folder_sync = async () => ({ ...done, ok: false, remainingCount: 1, error: '备份校验失败', failures: [{ relPath: 'a', error: '备份校验失败' }] })
  await primary(view); await tick()
  assert.match(view.text(), /备份校验失败/); assert.match(view.text(), /未完成 1 项/); assert.doesNotMatch(view.text(), /被占用跳过/)
  await revealRecovery(done.recoveryPaths[0])
  assert.deepEqual(host.ipcCalls.find(([method]) => method === 'shell_show_item_in_folder')[1], { fullPath: done.recoveryPaths[0] })
})
test('卸载取消在途任务，迟到结果不弹成功提示', async () => {
  const view = await open(); await compare(view)
  const waiting = deferred(); host.ipc.folder_sync = () => waiting.promise
  const work = primary(view); await tick(); view.unmount(); waiting.resolve(done); await work
  assert.ok(host.ipcCalls.some(([method]) => method === 'folder_sync_cancel'))
  assert.equal(host.toasts.length, 0)
})
test('宿主结果不完整、异常和旧客户端均失败，不回退旧 DLL', async () => {
  const options = { sourceDir: '/s', targetDir: '/t', syncMode: 'incremental', ignoreDevJunk: true }
  host.ipc.folder_sync = async () => ({ success: true })
  await assert.rejects(compareFolderTrees(options, new AbortController().signal), /完整/)
  await assert.rejects(executeFolderSync(plan.planId, ['x'], new AbortController().signal), /完整/)
  globalThis.__ztoolsElectron.transport.methods = {}
  await assert.rejects(compareFolderTrees(options, new AbortController().signal), /升级/)
})
