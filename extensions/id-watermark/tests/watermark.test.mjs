import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import Command, { BusinessForm, commands, inspectImageHeader, renderWatermarkOnImage, pickImage, readClipboardImage, resolveTemplate } from '../dist/index.js'

test('初始无假图片；三号布局只有选图和读取剪贴板两个全局动作', async () => {
  const host = createHost(), view = await mount(Command, host)
  try {
    assert.equal(view.items().length, 0)
    assert.ok(view.tree().props.workbenchPanel && view.tree().props.subList)
    assert.deepEqual(view.tree().props.filterBar.actions.map(a => a.id), ['pick', 'clipboard'])
    assert.doesNotMatch(view.text(), /1920|OffscreenCanvas|物理级|智能灰阶/)
  } finally { view.unmount() }
})
test('取消选图无假成功；宿主失败展示错误；畸形回执拒绝', async () => {
  const host = createHost(), view = await mount(Command, host)
  try {
    host.ipc.window_show_open_dialog = async () => ({ canceled: true })
    await view.tree().props.filterBar.actions[0].onAction(); await tick()
    assert.equal(host.toasts.length, 0); assert.equal(view.items().length, 0)
    host.ipc.window_show_open_dialog = async () => { throw new Error('选择器不可用') }
    await view.tree().props.filterBar.actions[0].onAction(); await tick(); assert.match(view.text(), /选择器不可用/)
    host.ipc.window_show_open_dialog = async () => ({ canceled: false })
    await assert.rejects(pickImage(new AbortController().signal), /选择结果/)
  } finally { view.unmount() }
})
test('剪贴板快入口只读取、没有图片明确失败，绝不覆盖剪贴板', async () => {
  const host = createHost(); host.ipc.clipboard_read_image = async () => ({ success: true, useTempFile: false, image: '' })
  const view = await mount(commands['id-watermark-clipboard-fast'], host)
  try { await tick(); assert.match(view.text(), /没有图片/); assert.deepEqual(host.ipcCalls.map(([method]) => method), ['clipboard_read_image']) }
  finally { view.unmount() }
  host.ipc.clipboard_read_image = async () => ({ success: true, useTempFile: true })
  await assert.rejects(readClipboardImage(new AbortController().signal), /文件缺失/)
})
test('选图并发互斥；卸载后不读取迟到选图、不更新状态或弹成功', async () => {
  const host = createHost(), view = await mount(Command, host); let resolve
  host.ipc.window_show_open_dialog = () => new Promise(done => { resolve = done })
  const action = view.tree().props.filterBar.actions[0].onAction
  const pending = action(); await action(); assert.equal(host.ipcCalls.length, 1)
  view.unmount(); resolve({ canceled: false, filePath: '/test.png' }); await pending
  assert.equal(host.ipcCalls.length, 1); assert.equal(host.toasts.length, 0)
})
test('图像边界先于解码：损坏文件头、巨大像素、缺图/伪图不生成替代JPEG', async () => {
  assert.throws(() => inspectImageHeader(new Uint8Array()), /16 MiB/)
  const png = new Uint8Array(33); png.set([137,80,78,71,13,10,26,10]); png.set([73,72,68,82],12)
  const header = new DataView(png.buffer); header.setUint32(16, 99999); header.setUint32(20, 99999)
  assert.throws(() => inspectImageHeader(png), /尺寸/)
  await assert.rejects(renderWatermarkOnImage({ width: 640, height: 480, fileName: '假图.png' }, { text: '测试', opacityPercent: 25 }), /图片/)
  await assert.rejects(renderWatermarkOnImage({}, { text: ' ', opacityPercent: 25 }), /文字/)
})
test('业务名称按字面量替换；Canvas创建失败也关闭已解码位图', async () => {
  assert.equal(resolveTemplate('用途{business}', "$&$`$'", '2026.10.26'), "用途$&$`$'")
  assert.equal(resolveTemplate('用途{business} {date}', '项目 {date}', '2026.10.26'), '用途项目 {date} 2026.10.26')
  const previousBitmap = globalThis.createImageBitmap, previousCanvas = globalThis.OffscreenCanvas
  let closed = 0
  const bytes = new Uint8Array(33); bytes.set([137,80,78,71,13,10,26,10]); bytes.set([73,72,68,82],12)
  const header = new DataView(bytes.buffer); header.setUint32(16, 640); header.setUint32(20, 480)
  globalThis.createImageBitmap = async () => ({ width: 640, height: 480, close() { closed++ } })
  globalThis.OffscreenCanvas = class { constructor() { throw new Error('Canvas创建失败') } }
  try { await assert.rejects(renderWatermarkOnImage({ rawBytes: bytes }, { text: '测试', opacityPercent: 25 }), /Canvas创建失败/); assert.equal(closed, 1) }
  finally { globalThis.createImageBitmap = previousBitmap; globalThis.OffscreenCanvas = previousCanvas }
})
test('用途使用可编辑Form；空值拒绝，填写后保存回传，不使用只读workbench文本', async () => {
  const host = createHost(); let saved
  const form = await mount(() => BusinessForm({ initial: '旧用途', saved: value => { saved = value } }), host)
  try {
    const field = () => form.tree().children.flat(Infinity).find(node => node.type === 'Form.TextField')
    assert.equal(field().props.value, '旧用途')
    field().props.onChange(' '); await tick(); await form.run(null, '保存用途'); assert.equal(saved, undefined); assert.match(field().props.error, /1～80/)
    field().props.onChange('测试单位 $& {date}'); await tick(); await form.run(null, '保存用途'); assert.equal(saved, '测试单位 $& {date}')
  } finally { form.unmount() }
})
