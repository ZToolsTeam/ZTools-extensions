import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount } from '../../shared/test-harness.mjs'
import Command from '../dist/index.js'
const host = createHost()
test.beforeEach(() => host.reset())

test('7 MiB 合法 SVG 的超限结果可完整另存文件，不再暴露必败的复制主动作', async () => {
  const start = '<svg xmlns="http://www.w3.org/2000/svg"><!--'; const end = '--></svg>'
  const svg = start + 'x'.repeat(7 * 1024 * 1024 - start.length - end.length) + end
  const base64 = Buffer.from(svg).toString('base64')
  host.ipc.window_show_open_dialog = async () => ({ canceled: false, filePath: '/test.svg' })
  host.ipc.filesystem_get_file_size = async () => ({ size: Buffer.byteLength(svg) })
  host.ipc.filesystem_read_file = async () => ({ content: base64 })
  host.ipc.window_show_save_dialog = async () => ({ canceled: false, filePath: '/转换结果.txt' })
  let saved
  host.ipc.filesystem_write_file = async params => { saved = params; return { success: true } }
  const view = await mount(Command)
  try {
    await view.run(view.item('start-pick'), '选择图片文件…')
    const item = view.item('export-raw-base64')
    assert.equal(view.actions(item)[0].props.title, '保存为文本文件…')
    assert.ok(!view.actions(item).some(a => a.props.title.startsWith('复制')))
    await view.run(item, '保存为文本文件…')
    assert.deepEqual(saved, { path: '/转换结果.txt', content: base64, encoding: 'utf8' })
    assert.match(host.lastToast().title, /已保存/)
  } finally { view.unmount() }
})

test('保存取消不写文件，写失败不提示成功；小结果仍可复制', async () => {
  const view = await mount(Command)
  try {
    await view.run(view.item('start-sample'), '载入示例')
    const item = view.item('export-datauri')
    await view.run(item, '复制 Data URL')
    assert.match(host.clipboard.text, /^data:image\/png;base64,/)
    host.toasts.length = 0
    host.ipc.window_show_save_dialog = async () => ({ canceled: true })
    host.ipc.filesystem_write_file = async () => assert.fail('取消不应写入')
    await view.run(item, '保存为文本文件…')
    assert.equal(host.toasts.length, 0)
    host.ipc.window_show_save_dialog = async () => ({ canceled: false, filePath: '/full.txt' })
    host.ipc.filesystem_write_file = async () => { throw new Error('磁盘已满') }
    await view.run(item, '保存为文本文件…')
    assert.equal(host.lastToast().title, '保存失败')
    assert.match(host.lastToast().message, /磁盘已满/)
  } finally { view.unmount() }
})
