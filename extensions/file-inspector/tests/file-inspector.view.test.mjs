import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import { FileInspectorCommand, inspectFileFromBuffer } from '../dist/index.js'

const host = createHost()
test.beforeEach(() => host.reset())
const pick = async view => { view.tree().props.filterBar.actions[0].onAction(); await tick() }
const load = bytes => {
  host.ipc.window_show_open_dialog = () => ({ canceled: false, filePath: '/tmp/sample.fake' })
  host.ipc.filesystem_read_file = () => ({ success: true, size: bytes.length, content: Buffer.from(bytes).toString('base64') })
}

test('界面自动识别 GBK，手动选择 Big5 后按该字符集保存，取消保存无成功提示', async () => {
  load(Buffer.from('a4a4a4e5', 'hex'))
  const view = await mount(FileInspectorCommand)
  try {
    await pick(view)
    view.tree().props.workbenchPanel.fields.find(f => f.id === 'previewEncoding').onChange('Big5')
    await tick()
    assert.match(view.text(), /中文/)
    host.ipc.window_show_save_dialog = () => ({ filePath: '/tmp/out.txt', canceled: false })
    host.ipc.filesystem_write_file = p => {
      const bytes = Buffer.from(p.content, 'base64')
      assert.equal(bytes.toString(), '\ufeff中文')
      return { success: true, size: bytes.length }
    }
    await view.run(view.item('line-1'), '另存为 UTF-8-BOM')
    assert.equal(host.lastToast().title, '转码文件已保存')
    const count = host.toasts.length
    host.ipc.window_show_save_dialog = () => ({ canceled: true })
    await view.run(view.item('line-1'), '另存为 UTF-8-BOM')
    assert.equal(host.toasts.length, count)
    assert.equal(view.tree().props.isLoading, false)
  } finally { view.unmount() }
})

test('二进制文件不能转码，后缀修正成功更新当前路径并移除重复修正动作', async () => {
  load(Buffer.from('89504e470d0a1a0a', 'hex'))
  host.ipc.window_show_select_folder_dialog = params => ({ canceled: false, folderPath: params.defaultPath })
  host.ipc.filesystem_move_file_no_replace = () => ({ success: true })
  const view = await mount(FileInspectorCommand)
  try {
    await pick(view)
    assert.deepEqual(view.tree().props.filterBar.actions.map(a => a.id), ['pick-file'])
    assert.ok(!view.actions(view.item('line-1')).some(a => a.props.title.includes('UTF-8')))
    await view.run(view.item('line-1'), '修正扩展名为 .png')
    assert.match(view.text(), /sample.png/)
    assert.ok(!view.actions(view.item('line-1')).some(a => a.props.title.includes('修正')))
  } finally { view.unmount() }
})

test('转换错误正常显示并结束忙碌状态，不把预览的100行当成完整文件保存', async () => {
  const info = inspectFileFromBuffer(Buffer.from('test'), '/tmp/sample.txt')
  const view = await mount(() => FileInspectorCommand({ initialDiagnostic: info }))
  try {
    await view.run(view.item('line-1'), '另存为 UTF-8-BOM')
    assert.equal(host.lastToast().style, 'FAILURE')
    assert.equal(host.ipcCalls.length, 0)
    assert.equal(view.tree().props.isLoading, false)
  } finally { view.unmount() }
})

test('选择文件等待期间拒绝重复动作，离开插件后迟到结果不显示成功提示', async () => {
  let resolve
  host.ipc.window_show_open_dialog = () => new Promise(r => { resolve = r })
  const view = await mount(FileInspectorCommand)
  await pick(view)
  await pick(view)
  assert.equal(host.ipcCalls.length, 1)
  assert.equal(view.tree().props.isLoading, true)
  view.unmount()
  resolve({ canceled: true })
  await tick()
  assert.equal(host.toasts.length, 0)
})

test('状态条写明编码判断依据，不显示编造的置信度；扩展名不符的标签不用红色', async () => {
  load(Buffer.from('d6d0cec4', 'hex'))
  const view = await mount(FileInspectorCommand)
  try {
    await pick(view)
    const summary = view.tree().props.filterBar.summaryText
    assert.match(summary, /GBK/)
    assert.match(summary, /按 GBK \/ GB18030 推测/)
    assert.doesNotMatch(view.text(), /置信度/)
  } finally { view.unmount() }
  host.reset()
  load(Buffer.from('89504e470d0a1a0a', 'hex'))
  const png = await mount(FileInspectorCommand)
  try {
    await pick(png)
    const tag = png.item('line-1').props.accessories[0].tag
    assert.equal(tag, '应为 .png')
    assert.doesNotMatch(png.text(), /"color"/)
  } finally { png.unmount() }
})
