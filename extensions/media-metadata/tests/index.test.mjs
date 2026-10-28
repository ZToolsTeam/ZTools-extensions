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
test('旧宿主直接提示升级，不调用 DLL', async () => {
  globalThis.__ztoolsElectron.transport.methods = {}; const v = await open(); await pick(v)
  assert.match(host.lastToast().title, /升级/); assert.equal(host.ipcCalls.length, 0)
})
