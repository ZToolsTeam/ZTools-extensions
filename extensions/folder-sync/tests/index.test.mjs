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
test('Windows 不显示废纸篓筛选与计数；macOS 用废纸篓的叫法', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const render = async platform => {
    Object.defineProperty(globalThis, 'navigator', { value: { platform, userAgent: '' }, configurable: true })
    views.splice(0).forEach(view => view.unmount())
    const view = await open(); await compare(view)
    const filters = view.tree().props.searchBarAccessory.children.flat().filter(Boolean).map(child => child.props.value)
    return { filters, card: view.tree().props.workbenchPanel.previewCard.subtitle, text: view.text() }
  }
  try {
    const win = await render('Win32')
    assert.ok(!win.filters.includes('orphan')); assert.doesNotMatch(win.card, /废纸篓|回收/)
    const mac = await render('MacIntel')
    assert.ok(mac.filters.includes('orphan')); assert.match(mac.card, /移入废纸篓 0/)
    assert.match(mac.text, /移入废纸篓的文件需手动勾选/); assert.doesNotMatch(mac.text, /回收站/)
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor); else delete globalThis.navigator
  }
})
test('两个命令按清单注册：比对命令选好两个目录后直接比对，工作台只选目录不比对', async () => {
  const { commands } = await import('../dist/index.js')
  const fs = await import('node:fs')
  const manifest = JSON.parse(fs.readFileSync(new URL('../plugin.json', import.meta.url)))
  assert.deepEqual(Object.keys(commands).sort(), manifest.features.map(f => f.code).sort())
  const cmp = await mount(commands['folder-sync-compare']); views.push(cmp); await tick()
  assert.equal(cmp.tree().props.navigationTitle, '目录比对')
  assert.equal(cmp.actions(null)[0].props.title, '选择目录…')
  await cmp.run(null, '选择目录…'); await tick()
  const calls = host.ipcCalls.filter(([m, p]) => m === 'folder_sync' && p.action === 'compare')
  assert.equal(calls.length, 1); assert.equal(calls[0][1].sourceDir, '/fixture/source'); assert.equal(calls[0][1].targetDir, '/fixture/target')
  assert.equal(rows(cmp).length, 3); assert.match(cmp.text(), /比对完成，共 3 项/)
  cmp.unmount(); views.pop()
})
test('未选目录时主动作为“选择目录…”；选好未比对时主动作为“开始比对”；取消选择不比对', async () => {
  const view = await open()
  assert.deepEqual(view.actions(null).map(a => a.props.title), ['选择目录…'])
  host.ipc.window_show_select_folder_dialog = async () => ({ canceled: true })
  await view.run(null, '选择目录…'); assert.deepEqual(view.actions(null).map(a => a.props.title), ['选择目录…'])
  let picked = 0; host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: picked++ % 2 ? '/fixture/target' : '/fixture/source' })
  await view.run(null, '选择目录…')
  assert.equal(host.ipcCalls.filter(([m]) => m === 'folder_sync').length, 0)
  assert.deepEqual(view.actions(null).map(a => a.props.title), ['开始比对', '重新选择目录…'])
  host.ipc.folder_sync = async () => { throw new Error('源目录无法读取') }
  await view.run(null, '开始比对'); assert.match(host.lastToast().title, /无法读取/); assert.equal(rows(view).length, 0)
  host.ipc.folder_sync = async p => p.action === 'compare' ? plan : done
  await view.run(null, '开始比对'); assert.equal(rows(view).length, 3)
  assert.deepEqual(view.actions(null).map(a => a.props.title), ['重新选择目录…'])
})
test('宿主结果不完整、异常和旧客户端均失败，不回退旧 DLL', async () => {
  const options = { sourceDir: '/s', targetDir: '/t', syncMode: 'incremental', ignoreDevJunk: true }
  host.ipc.folder_sync = async () => ({ success: true })
  await assert.rejects(compareFolderTrees(options, new AbortController().signal), /完整/)
  await assert.rejects(executeFolderSync(plan.planId, ['x'], new AbortController().signal), /完整/)
  globalThis.__ztoolsElectron.transport.methods = {}
  await assert.rejects(compareFolderTrees(options, new AbortController().signal), /升级/)
})
test('镜像模式只在 macOS 显示，Windows 不提供宿主不支持的选项', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const modes = async platform => {
    Object.defineProperty(globalThis, 'navigator', { value: { platform, userAgent: '' }, configurable: true })
    const view = await open()
    return view.tree().props.workbenchPanel.fields[0].options.map(option => option.value)
  }
  try {
    assert.deepEqual(await modes('Win32'), ['incremental', 'two-way'])
    assert.deepEqual(await modes('MacIntel'), ['incremental', 'two-way', 'mirror'])
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor); else delete globalThis.navigator
  }
})
