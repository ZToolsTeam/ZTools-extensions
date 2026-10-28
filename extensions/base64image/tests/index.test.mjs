import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount } from '../../shared/test-harness.mjs'
import Base64ImageCommand from '../dist/index.js'
import { parseBase64Image, encodeSvgOrTextToBase64 } from '../dist/logic.js'

const host = createHost()
test.beforeEach(() => host.reset())

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

test('选择图片文件：读取后生成 Data URL，并能一键复制', async () => {
  host.ipc.window_show_open_dialog = async () => ({ canceled: false, filePath: '/Users/me/截图 1.png' })
  host.ipc.filesystem_get_file_size = async () => ({ success: true, size: 70 })
  host.ipc.filesystem_read_file = async (p) => {
    assert.equal(p.encoding, 'base64')
    return { success: true, content: PNG_B64, size: 70 }
  }
  const view = await mount(Base64ImageCommand)
  await view.run(view.item('start-pick'), '选择图片文件…')
  const dataUri = view.item('export-datauri')
  assert.equal(dataUri.props.subtitle.startsWith('data:image/png;base64,iVBOR'), true)
  await view.run(dataUri, '复制 Data URL')
  assert.equal(host.clipboard.text, `data:image/png;base64,${PNG_B64}`)
  // 右侧预览显示真实图片
  assert.ok(JSON.stringify(dataUri.props.detail).includes(`![preview](data:image/png;base64,${PNG_B64})`))
})

test('粘贴截图：剪贴板图片直接转换；剪贴板没有图片时读取文字', async () => {
  host.ipc.clipboard_read_image = async () => ({ success: true, image: `data:image/png;base64,${PNG_B64}`, useTempFile: false })
  let view = await mount(Base64ImageCommand)
  await view.run(view.item('start-paste'), '粘贴剪贴板图片或文字')
  assert.ok(view.items().some((i) => i.props.id === 'export-datauri'))
  view.unmount()

  host.ipc.clipboard_read_image = async () => ({ success: true, image: '', useTempFile: false })
  host.clipboard.text = `data:image/png;base64,${PNG_B64}`
  view = await mount(Base64ImageCommand)
  await view.run(view.item('start-paste'), '粘贴剪贴板图片或文字')
  assert.equal(view.tree().props.searchText, host.clipboard.text)
})

test('[边界] 大截图走临时文件读取；超过 10 MB 的图片拒绝并提示', async () => {
  host.ipc.clipboard_read_image = async () => ({ success: true, useTempFile: true, tempFile: '/cache/clip.png', size: 600 * 1024 })
  host.ipc.filesystem_read_file = async (p) => (assert.equal(p.path, '/cache/clip.png'), { success: true, content: PNG_B64 })
  let view = await mount(Base64ImageCommand)
  await view.run(view.item('start-paste'), '粘贴剪贴板图片或文字')
  assert.ok(view.items().some((i) => i.props.id === 'export-datauri'))
  view.unmount()

  host.ipc.window_show_open_dialog = async () => ({ canceled: false, filePath: '/big.png' })
  host.ipc.filesystem_get_file_size = async () => ({ success: true, size: 11 * 1024 * 1024 })
  host.ipc.filesystem_read_file = async () => assert.fail('超大文件不应被读取')
  view = await mount(Base64ImageCommand)
  await view.run(view.item('start-pick'), '选择图片文件…')
  assert.match(String(host.lastToast().message || host.lastToast().title), /10 MB/)
})

test('[故障注入] 用户取消选择不报错；读文件失败、不是图片都给出提示', async () => {
  host.ipc.window_show_open_dialog = async () => ({ canceled: true })
  let view = await mount(Base64ImageCommand)
  await view.run(view.item('start-pick'), '选择图片文件…')
  assert.equal(host.toasts.length, 0)

  host.ipc.window_show_open_dialog = async () => ({ canceled: false, filePath: '/x.png' })
  host.ipc.filesystem_get_file_size = async () => ({ success: true, size: 10 })
  host.ipc.filesystem_read_file = async () => { throw Object.assign(new Error('路径未由当前窗口授权'), { code: 'PERMISSION_DENIED' }) }
  await view.run(view.item('start-pick'), '选择图片文件…')
  assert.match(String(host.lastToast().title), /读取图片失败/)

  host.ipc.filesystem_read_file = async () => ({ success: true, content: Buffer.from('not an image').toString('base64') })
  await view.run(view.item('start-pick'), '选择图片文件…')
  assert.match(String(host.lastToast().title), /不是支持的图片/)
})

test('解析：识别格式与大小，拒绝非法与超大输入', () => {
  const ok = parseBase64Image(`data:image/png;base64,${PNG_B64}`)
  assert.equal(ok.valid, true)
  assert.equal(ok.format, 'png')
  for (const bad of ['', 'data:text/plain;base64,AAAA', '!!!!', Buffer.from('hello').toString('base64'), '中文']) {
    assert.equal(parseBase64Image(bad).valid, false, bad)
  }
  assert.equal(parseBase64Image('A'.repeat(16 * 1024 * 1024 + 4)).valid, false)
  assert.equal(encodeSvgOrTextToBase64('<svg xmlns="http://www.w3.org/2000/svg"/>').mimeType, 'image/svg+xml')
})
