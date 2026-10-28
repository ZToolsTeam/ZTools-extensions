import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import Command, { commands } from '../dist/index.js'
const host = createHost(), views = []
const input = { path: '/tmp/测试.docx', displayName: '测试.docx' }
const output = { path: '/tmp/测试_slim.docx', displayName: '测试_slim.docx' }
const summary = { name: input.displayName, size: 2048, type: 'docx', digest: 'a'.repeat(64), images: [{ name: 'word/media/image.png', size: 200 }], hasAuthor: true, hasComments: true }
const result = { success: true, status: 'committed', name: output.displayName, size: 1024, originalSize: 2048, imageCount: 1 }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const open = async (command = Command) => { const view = await mount(command); views.push(view); return view }
const pick = async view => { await view.tree().props.filterBar.actions[0].onAction(); await tick() }
const process = async view => { await view.actions(view.item('document'))[0].props.onAction(); await tick() }
const writes = () => host.ipcCalls.filter(([method, params]) => method === 'office_document' && params.action !== 'inspect')
test.beforeEach(() => {
  host.reset();
  host.ipc.window_show_open_dialog = async params => { assert.equal(typeof params.filters, 'string'); return { canceled: false, filePath: input.path } }
  host.ipc.window_show_save_dialog = async () => ({ canceled: false, filePath: output.path })
  host.ipc.office_document = async params => params.action === 'inspect' ? { success: true, summary } : result
  host.ipc.office_cancel = async () => ({ success: true, cancelRequested: true })
})
test.afterEach(() => { for (const view of views.splice(0)) view.unmount() })
test('选择文档后显示真实检查结果；Enter 等保存完成再成功，不出现预估或无损画质承诺', async () => {
  const view = await open(); assert.equal(view.items().length, 0)
  await pick(view); assert.match(view.text(), /2.0 KB|2.00 KB/)
  const pending = deferred(); host.ipc.office_document = () => pending.promise
  const running = process(view); await tick(); assert.equal(host.toasts.length, 0)
  pending.resolve(result); await running
  assert.equal(host.lastToast().title, '新副本已保存并通过校验')
  const { operationId, ...params } = writes()[0][1]; assert.match(operationId, /^job_/); assert.deepEqual(params, { action: 'slim', path: input.path, outputPath: output.path, digest: summary.digest, cleanMetadata: true })
  assert.doesNotMatch(view.text(), /预计|80%|65%|无损画质|无残留/)
  assert.equal(view.tree().props.filterBar.actions.length, 1)
})
test('取消选择或保存零写入，失败消息保留，重试不会覆盖原文件', async () => {
  const view = await open()
  host.ipc.window_show_open_dialog = async () => ({ canceled: true, filePaths: [] })
  await pick(view); assert.equal(writes().length, 0)
  host.ipc.window_show_open_dialog = async () => ({ canceled: false, filePath: input.path }); await pick(view)
  host.ipc.window_show_save_dialog = async () => ({ canceled: true, filePaths: [] }); await process(view)
  assert.equal(writes().length, 0)
  host.ipc.window_show_save_dialog = async () => ({ canceled: false, filePath: output.path })
  host.ipc.office_document = async () => { throw new Error('目标已存在，请换个名字') }
  await process(view); assert.match(host.lastToast().title, /目标已存在/); assert.ok(view.item('document'))
})
test('假成功、未知保存状态、读取失败均不显示成功', async () => {
  const view = await open(); await pick(view)
  for (const response of [{ success: false }, { ...result, status: 'unknown' }, { ...result, size: NaN }]) {
    host.ipc.office_document = async () => response; await process(view)
    assert.doesNotMatch(host.lastToast().title, /通过校验/)
  }
  host.ipc.office_document = async () => { throw new Error('CRC 校验失败') }; await pick(view)
  assert.match(host.lastToast().title, /CRC/)
})
test('重复 Enter 只处理一次；卸载取消，在途结果不更新 UI 或提示成功', async () => {
  const view = await open(); await pick(view)
  const pending = deferred(); host.ipc.office_document = async () => pending.promise
  const running = process(view); await tick(); await process(view); assert.equal(writes().length, 1)
  view.unmount(); pending.resolve(result); await running
  assert.equal(host.toasts.length, 0); assert.equal(host.ipcCalls.filter(([method]) => method === 'office_cancel').length, 1)
})
test('卸载后迟到的选文件结果不读取', async () => {
  const view = await open(), pending = deferred(); host.ipc.window_show_open_dialog = () => pending.promise
  const running = pick(view); await tick(); view.unmount(); pending.resolve({ canceled: false, filePath: input.path }); await running
  assert.equal(host.ipcCalls.filter(([method]) => method === 'office_document').length, 0)
})
test('三个命令显式注册，导出原图入口写 ZIP', async () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../plugin.json', import.meta.url)))
  assert.deepEqual(Object.keys(commands).sort(), manifest.features.map(f => f.code).sort())
  const view = await open(commands['office-extract-images']); await pick(view); await process(view)
  assert.equal(writes()[0][1].action, 'extract')
  assert.match(host.ipcCalls.find(([method]) => method === 'window_show_save_dialog')[1].defaultName, /_images.zip$/)
})
test('旧客户端明确提示升级，不回退到 DLL', async () => {
  globalThis.__ztoolsElectron.transport.methods = {}
  const view = await open(); await pick(view)
  assert.match(host.lastToast().title, /升级/); assert.equal(host.ipcCalls.length, 0)
})
