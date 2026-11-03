import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import Command, { commands } from '../dist/index.js'
const host = createHost(), views = []
const summary = { name: '照片.jpg', type: 'JPEG', size: 2048, digest: 'a'.repeat(64), canClean: true, hasLocation: true, fields: [{ key: 'GPS:GPSLatitude', value: '31.2' }] }
const result = { success: true, status: 'committed', name: '照片_clean.jpg', size: 1024 }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
async function open(command = Command) { const view = await mount(command); views.push(view); return view }
async function pick(view) { await view.tree().props.filterBar.actions[0].onAction(); await tick() }
async function clean(view) { await view.actions(view.item('media'))[0].props.onAction(); await tick() }
const writes = () => host.ipcCalls.filter(([m, p]) => m === 'media_metadata' && p.action === 'clean')
test.beforeEach(() => {
  host.reset()
  host.ipc.window_show_open_dialog = async p => { assert.equal(typeof p.filters, 'string'); return { canceled: false, filePath: '/tmp/照片.jpg' } }
  host.ipc.window_show_save_dialog = async () => ({ canceled: false, filePath: '/tmp/照片_clean.jpg' })
  host.ipc.media_metadata = async p => p.action === 'inspect' ? { success: true, summary } : result
  host.ipc.media_metadata_cancel = async () => ({ success: true, cancelRequested: true })
})
test.afterEach(() => { views.splice(0).forEach(v => v.unmount()) })
test('选择后显示真实定位状态，成功只在保存回执之后出现', async () => {
  const v = await open(); assert.doesNotMatch(v.text(), /非常安全|已清除|无定位|100%/); await pick(v)
  assert.match(v.text(), /检测到定位标签/)
  const wait = deferred(); host.ipc.media_metadata = () => wait.promise
  const pending = clean(v); await tick(); assert.equal(host.toasts.length, 0)
  wait.resolve(result); await pending; assert.match(host.lastToast().title, /副本已保存/)
  assert.equal(writes()[0][1].mode, 'location'); assert.equal(writes()[0][1].digest, summary.digest)
})
test('下拉清理策略实际传给宿主；副本另存不可关闭', async () => {
  const v = await open(); await pick(v)
  v.tree().props.workbenchPanel.fields[0].onChange('metadata'); await tick(); await clean(v)
  assert.equal(writes()[0][1].mode, 'metadata'); assert.equal(v.tree().props.workbenchPanel.fields.some(f => f.id === 'keepBackup'), false)
})
test('选择取消和保存取消都不清理，读取失败保留已选文件', async () => {
  const v = await open(); host.ipc.window_show_open_dialog = async () => ({ canceled: true }); await pick(v); assert.equal(v.items().length, 0)
  host.ipc.window_show_open_dialog = async () => ({ canceled: false, filePath: '/tmp/照片.jpg' }); await pick(v)
  host.ipc.window_show_save_dialog = async () => ({ canceled: true }); await clean(v); assert.equal(writes().length, 0)
  host.ipc.media_metadata = async () => { throw new Error('照片损坏') }; await pick(v); assert.match(host.lastToast().title, /损坏/); assert.ok(v.item('media'))
})
test('写入失败、未校验回执不报告成功', async () => {
  const v = await open(); await pick(v)
  for (const value of [{ success: false }, { ...result, status: 'unknown' }, { ...result, size: 0 }]) { host.ipc.media_metadata = async () => value; await clean(v); assert.doesNotMatch(host.lastToast().title, /已保存/) }
  host.ipc.media_metadata = async () => { throw new Error('目标已存在') }; await clean(v); assert.match(host.lastToast().title, /已存在/)
})
test('重复 Enter 单次处理，卸载发出取消且迟到结果不显示成功', async () => {
  const v = await open(); await pick(v); const wait = deferred(); host.ipc.media_metadata = () => wait.promise
  const pending = clean(v); await tick(); await clean(v); assert.equal(writes().length, 1)
  v.unmount(); wait.resolve(result); await pending; assert.equal(host.toasts.length, 0); assert.equal(host.ipcCalls.filter(([m]) => m === 'media_metadata_cancel').length, 1)
})
test('选择对话框迟到回执不继续读取', async () => {
  const v = await open(), wait = deferred(); host.ipc.window_show_open_dialog = () => wait.promise
  const pending = pick(v); await tick(); v.unmount(); wait.resolve({ canceled: false, filePath: '/tmp/late.jpg' }); await pending
  assert.equal(host.ipcCalls.filter(([m]) => m === 'media_metadata').length, 0)
})
test('三个命令注册；媒体参数命令只有读取动作', async () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../plugin.json', import.meta.url)))
  assert.deepEqual(Object.keys(commands).sort(), manifest.features.map(f => f.code).sort())
  const v = await open(commands['media-stream-info']); await pick(v)
  assert.deepEqual(v.actions(v.item('media')).map(a => a.props.title), ['查看原始参数'])
})
test('系统窗口不限时、处理仍限时；保存窗口按照片类型限定扩展名，扩展名不符时不清理', async () => {
  const methods = globalThis.__ztoolsElectron.transport.methods, requests = []
  globalThis.__ztoolsElectron.transport.methods = new Proxy(methods, { get(target, method) { return typeof target[method] === 'function' ? request => { requests.push([method, request]); return target[method](request) } : target[method] } })
  try {
    const v = await open(); await pick(v); await clean(v)
    const of = method => requests.filter(([m]) => m === method).map(([, r]) => r)
    assert.equal(Object.hasOwn(of('window_show_open_dialog')[0], 'timeoutMs'), false)
    assert.equal(Object.hasOwn(of('window_show_save_dialog')[0], 'timeoutMs'), false)
    assert.equal(of('media_metadata')[0].timeoutMs, 120000)
    assert.equal(of('window_show_save_dialog')[0].params.filters, 'JPEG 图片|*.jpg;*.jpeg')
    host.ipc.window_show_save_dialog = async () => ({ canceled: false, filePath: '/tmp/照片_clean.png' })
    await clean(v); assert.match(host.lastToast().title, /扩展名/); assert.equal(writes().length, 1)
  } finally { globalThis.__ztoolsElectron.transport.methods = methods }
})
test('HEIF 照片默认另存为 .heif；媒体参数入口不显示清理说明', async () => {
  host.ipc.media_metadata = async p => p.action === 'inspect' ? { success: true, summary: { ...summary, name: '照片.HEIF', type: 'HEIF' } } : result
  const v = await open(); await pick(v); await clean(v)
  const dialog = host.ipcCalls.find(([m]) => m === 'window_show_save_dialog')[1]
  assert.equal(dialog.defaultName, '照片_clean.heif'); assert.equal(dialog.filters, 'HEIF 图片|*.heif;*.heic')
  const info = await open(commands['media-stream-info'])
  assert.deepEqual(info.tree().props.workbenchPanel.fields.map(f => f.id), ['formats'])
})
test('支持范围按命令显示：只读音视频命令不再写照片清理，清理命令只写照片', async () => {
  const scope = view => view.tree().props.workbenchPanel.fields.find(f => f.id === 'formats').value
  const info = await open(commands['media-stream-info'])
  assert.match(scope(info), /MP4/); assert.doesNotMatch(scope(info), /JPEG|清理/)
  // 只读命令选中照片也不提供清理动作
  await pick(info)
  assert.ok(!info.actions(info.item('media')).some(a => /清理/.test(a.props.title)))
  const gps = await open(commands['media-clean-gps-fast'])
  assert.match(scope(gps), /JPEG \/ PNG \/ HEIC/); assert.doesNotMatch(scope(gps), /MP4|音视频/)
  const bench = await open(commands['media-metadata-workbench'])
  assert.match(scope(bench), /JPEG/); assert.match(scope(bench), /音视频/)
})
test('未选文件时 Enter 主动作为“选择文件…”，执行后读取真实元数据；取消选择不读取', async () => {
  for (const code of Object.keys(commands)) {
    const v = await open(commands[code]); assert.equal(v.items().length, 0)
    assert.equal(v.actions(null)[0].props.title, '选择文件…'); views.pop(); v.unmount()
  }
  const v = await open(); host.ipc.window_show_open_dialog = async () => ({ canceled: true })
  await v.run(null, '选择文件…'); assert.equal(host.ipcCalls.filter(([m]) => m === 'media_metadata').length, 0); assert.equal(v.items().length, 0)
  host.ipc.window_show_open_dialog = async () => ({ canceled: false, filePath: '/tmp/照片.jpg' })
  await v.run(null, '选择文件…'); assert.ok(v.item('media')); assert.match(v.text(), /检测到定位标签/)
})
test('旧宿主直接提示升级，不调用 DLL', async () => {
  globalThis.__ztoolsElectron.transport.methods = {}; const v = await open(); await pick(v)
  assert.match(host.lastToast().title, /升级/); assert.equal(host.ipcCalls.length, 0)
})
