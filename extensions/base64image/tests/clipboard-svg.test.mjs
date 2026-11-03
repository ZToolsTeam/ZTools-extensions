import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import Base64ImageCommand from '../dist/index.js'
import { parseBase64Image, detectImageFormat, isSvgSource } from '../dist/logic.js'

const host = createHost()
test.beforeEach(() => host.reset())

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const JPEG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]).toString('base64')
const GIF_B64 = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1').toString('base64')
const DOCTYPE_SVG = '<?xml version="1.0" encoding="utf-8" standalone="no"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"\n  "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40"/></svg>'

const sectionTitles = (view) => {
  const out = []
  const walk = (n) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(walk)
    if (n.type === 'List.Section') out.push(n.props.title)
    walk(n.children)
    walk(n.props?.children)
  }
  walk(view.tree())
  return out.length ? out : JSON.stringify(view.tree()).match(/"title":"(已载入[^"]*|转换结果[^"]*|无法识别|开始)"/g)
}
const toastText = (t) => `${t?.title ?? ''} ${t?.message ?? ''}`

/** 模拟一个按路径读取的文件系统：只返回登记过的文件，其余报 PERMISSION_DENIED */
function fakeFiles(files) {
  host.ipc.filesystem_get_file_size = async ({ path }) => {
    if (!(path in files)) throw Object.assign(new Error('路径未由当前窗口授权'), { code: 'PERMISSION_DENIED' })
    return { success: true, size: files[path].size ?? Buffer.from(files[path].content, 'base64').length }
  }
  host.ipc.filesystem_read_file = async ({ path, encoding }) => {
    assert.equal(encoding, 'base64')
    if (!(path in files)) throw Object.assign(new Error('路径未由当前窗口授权'), { code: 'PERMISSION_DENIED' })
    return { success: true, content: files[path].content }
  }
}
const readPaths = () => host.ipcCalls.filter(([m]) => m === 'filesystem_read_file').map(([, p]) => p.path)

// ---------- 访达 / 资源管理器里复制的图片文件读原文件 ----------

test('访达复制的 JPEG：读原文件字节，保留格式与文件名，不走剪贴板重编码', async () => {
  host.ipc.clipboard_read_files = async () => ({ success: true, files: ['/Users/me/Pictures/photo.jpg'] })
  host.ipc.clipboard_read_image = async () => assert.fail('有图片文件时不应读取重编码的剪贴板图片')
  fakeFiles({ '/Users/me/Pictures/photo.jpg': { content: JPEG_B64 } })
  const view = await mount(Base64ImageCommand)
  await view.run(view.item('start-paste'), '粘贴剪贴板图片或文字')
  assert.deepEqual(readPaths(), ['/Users/me/Pictures/photo.jpg'])
  assert.ok(String(sectionTitles(view)).includes('已载入 photo.jpg'), String(sectionTitles(view)))
  const dataUri = view.item('export-datauri')
  assert.equal(dataUri.props.subtitle.startsWith('data:image/jpeg;base64,'), true)
  await view.run(dataUri, '复制 Data URL')
  assert.equal(host.clipboard.text, `data:image/jpeg;base64,${JPEG_B64}`)
  assert.match(toastText(host.toasts.find((t) => /已转换/.test(t.title))), /photo\.jpg/)
})

test('复制了多个文件：跳过非图片，取第一个图片文件（扩展名不区分大小写）', async () => {
  host.ipc.clipboard_read_files = async () => ({ success: true, files: ['/a/readme.txt', '/a/动图 1.GIF', '/a/b.png'] })
  host.ipc.clipboard_read_image = async () => assert.fail('不应读取剪贴板图片')
  fakeFiles({ '/a/动图 1.GIF': { content: GIF_B64 }, '/a/b.png': { content: PNG_B64 } })
  const view = await mount(Base64ImageCommand)
  await view.run(view.item('start-paste'), '粘贴剪贴板图片或文字')
  assert.deepEqual(readPaths(), ['/a/动图 1.GIF'])
  assert.equal(view.item('export-datauri').props.subtitle.startsWith('data:image/gif;base64,'), true)
})

test('[故障注入] 文件剪贴板不可用或为空时回退到剪贴板图片（截图）', async () => {
  for (const readFiles of [
    async () => { throw Object.assign(new Error('Mac clipboard helper unavailable'), { code: 'NATIVE_HOST_UNAVAILABLE' }) },
    async () => ({ success: true, files: [] }),
    async () => ({ success: true, files: 'not-an-array' }),
    undefined // 旧宿主未实现 clipboard_read_files
  ]) {
    host.reset()
    if (readFiles) host.ipc.clipboard_read_files = readFiles
    host.ipc.clipboard_read_image = async () => ({ success: true, image: `data:image/png;base64,${PNG_B64}`, useTempFile: false })
    const view = await mount(Base64ImageCommand)
    await view.run(view.item('start-paste'), '粘贴剪贴板图片或文字')
    assert.ok(String(sectionTitles(view)).includes('已载入 剪贴板图片.png'))
    assert.ok(host.ipcCalls.some(([m]) => m === 'clipboard_read_image'))
    view.unmount()
  }
})

test('[边界] 复制的文件都不是图片 / 图片文件超过 10 MB / 文件读不到：提示真实原因，不读重编码图片', async () => {
  host.ipc.clipboard_read_image = async () => assert.fail('不应读取剪贴板图片')
  host.ipc.clipboard_read_files = async () => ({ success: true, files: ['/a/报告.pdf', '/a/notes'] })
  fakeFiles({})
  let view = await mount(Base64ImageCommand)
  await view.run(view.item('start-paste'), '粘贴剪贴板图片或文字')
  assert.match(toastText(host.lastToast()), /读取复制的图片文件失败.*不是支持的图片.*报告\.pdf/)
  assert.deepEqual(readPaths(), [])
  view.unmount()

  host.reset()
  host.ipc.clipboard_read_image = async () => assert.fail('不应读取剪贴板图片')
  host.ipc.clipboard_read_files = async () => ({ success: true, files: ['/a/huge.jpg'] })
  fakeFiles({ '/a/huge.jpg': { content: JPEG_B64, size: 12 * 1024 * 1024 } })
  view = await mount(Base64ImageCommand)
  await view.run(view.item('start-paste'), '粘贴剪贴板图片或文字')
  assert.match(toastText(host.lastToast()), /10 MB（12\.0 MB）/)
  assert.deepEqual(readPaths(), [], '超大文件不应被读取')
  view.unmount()

  host.reset()
  host.ipc.clipboard_read_files = async () => ({ success: true, files: ['/a/gone.png'] })
  fakeFiles({})
  view = await mount(Base64ImageCommand)
  await view.run(view.item('start-paste'), '粘贴剪贴板图片或文字')
  assert.match(toastText(host.lastToast()), /读取复制的图片文件失败.*未由当前窗口授权/)
  assert.ok(String(sectionTitles(view)).includes('开始'))
})

test('[故障注入] 扩展名是图片但内容不是图片：提示不是支持的图片', async () => {
  host.ipc.clipboard_read_files = async () => ({ success: true, files: ['/a/fake.png'] })
  fakeFiles({ '/a/fake.png': { content: Buffer.from('not an image').toString('base64') } })
  const view = await mount(Base64ImageCommand)
  await view.run(view.item('start-paste'), '粘贴剪贴板图片或文字')
  assert.match(String(host.lastToast().title), /不是支持的图片/)
  assert.ok(String(sectionTitles(view)).includes('开始'))
})

// ---------- 剪贴板图片读取失败要提示真实原因 ----------

test('剪贴板图片超过 10 MB：提示真实原因与替代办法，不落到「没有图片或文字」', async () => {
  host.clipboard.text = 'should-not-be-used'
  host.ipc.clipboard_read_image = async () => ({ success: true, useTempFile: true, tempFile: '/cache/clip.png', size: 11153135 })
  host.ipc.filesystem_read_file = async () => assert.fail('超大图片不应被读取')
  const view = await mount(Base64ImageCommand)
  await view.run(view.item('start-paste'), '粘贴剪贴板图片或文字')
  const t = host.lastToast()
  assert.equal(t.title, '读取剪贴板图片失败')
  assert.match(String(t.message), /超过 10 MB（10\.6 MB）.*选择图片文件/)
  assert.equal(host.toasts.some((x) => /没有图片或文字/.test(toastText(x))), false)
  assert.equal(view.tree().props.searchText, '', '读图失败时不应改读剪贴板文字')
})

test('[故障注入] 宿主读图抛错（超 16 MiB / 像素超限 / 其他错误）都把宿主原因带给用户', async () => {
  const cases = [
    [{ code: 'FILE_TOO_LARGE', message: '剪贴板图片超过16MiB上限' }, /剪贴板图片超过16MiB上限；原图文件可改用「选择图片文件」/],
    [{ code: 'FILE_TOO_LARGE', message: '剪贴板图片尺寸超出上限' }, /尺寸超出上限/],
    [{ code: 'CLIPBOARD_ERROR', message: '剪贴板被其他程序占用' }, /^剪贴板被其他程序占用$/]
  ]
  for (const [error, expected] of cases) {
    host.reset()
    host.clipboard.text = 'aGVsbG8='
    host.ipc.clipboard_read_image = async () => { throw Object.assign(new Error(error.message), { code: error.code }) }
    const view = await mount(Base64ImageCommand)
    await view.run(view.item('start-paste'), '粘贴剪贴板图片或文字')
    assert.equal(host.lastToast().title, '读取剪贴板图片失败')
    assert.match(String(host.lastToast().message), expected)
    assert.equal(view.tree().props.searchText, '')
    view.unmount()
  }
})

test('剪贴板确实没有图片：读文字；文字也为空才提示「没有图片或文字」；读文字失败单独提示', async () => {
  host.ipc.clipboard_read_image = async () => ({ success: true, image: '', useTempFile: false })
  let view = await mount(Base64ImageCommand)
  await view.run(view.item('start-paste'), '粘贴剪贴板图片或文字')
  assert.equal(host.lastToast().title, '剪贴板里没有图片或文字')
  view.unmount()

  host.clipboard.text = `  data:image/png;base64,${PNG_B64}\n`
  view = await mount(Base64ImageCommand)
  await view.run(view.item('start-paste'), '粘贴剪贴板图片或文字')
  assert.equal(view.tree().props.searchText, `data:image/png;base64,${PNG_B64}`)
  view.unmount()

  // 读剪贴板文字失败
  Object.defineProperty(host.clipboard, 'text', { configurable: true, get() { throw new Error('剪贴板被占用') }, set() {} })
  try {
    view = await mount(Base64ImageCommand)
    await view.run(view.item('start-paste'), '粘贴剪贴板图片或文字')
    assert.equal(host.lastToast().title, '读取剪贴板失败')
    assert.match(String(host.lastToast().message), /剪贴板被占用/)
  } finally {
    Object.defineProperty(host.clipboard, 'text', { configurable: true, writable: true, enumerable: true, value: '' })
  }
})

test('[互斥] 连按两次粘贴只发起一次读取，读取结束后可再次读取', async () => {
  let release
  host.ipc.clipboard_read_image = () => new Promise((r) => { release = () => r({ success: true, image: `data:image/png;base64,${PNG_B64}` }) })
  const view = await mount(Base64ImageCommand)
  const item = view.item('start-paste')
  const first = view.run(item, '粘贴剪贴板图片或文字')
  const second = view.run(item, '粘贴剪贴板图片或文字')
  await tick()
  release()
  await Promise.all([first, second])
  await tick()
  assert.equal(host.ipcCalls.filter(([m]) => m === 'clipboard_read_image').length, 1)
  assert.ok(String(sectionTitles(view)).includes('已载入 剪贴板图片.png'))

  host.ipc.clipboard_read_image = async () => ({ success: true, image: '', useTempFile: false })
  await view.run(view.item('export-datauri'), '粘贴剪贴板图片或文字')
  assert.equal(host.ipcCalls.filter(([m]) => m === 'clipboard_read_image').length, 2)
})

// ---------- 带 DOCTYPE / 注释 / 大写的 SVG ----------

test('选择带 <!DOCTYPE svg> 的 SVG 文件（matplotlib 导出）：识别为 SVG', async () => {
  const content = Buffer.from('﻿' + DOCTYPE_SVG).toString('base64')
  host.ipc.window_show_open_dialog = async () => ({ canceled: false, filePath: '/Users/me/plot.svg' })
  fakeFiles({ '/Users/me/plot.svg': { content } })
  const view = await mount(Base64ImageCommand)
  await view.run(view.item('start-pick'), '选择图片文件…')
  assert.ok(String(sectionTitles(view)).includes('已载入 plot.svg'))
  assert.equal(view.item('export-datauri').props.subtitle.startsWith('data:image/svg+xml;base64,'), true)
})

test('输入框粘贴以 DOCTYPE / 注释开头或大写 <SVG> 的源码：按 SVG 源码转换', async () => {
  const view = await mount(Base64ImageCommand)
  for (const src of [
    '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>',
    '<!-- 由 Inkscape 导出 -->\n<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    '<SVG xmlns="http://www.w3.org/2000/svg"></SVG>',
    DOCTYPE_SVG
  ]) {
    await view.search(src)
    const item = view.item('export-datauri')
    assert.equal(item.props.subtitle.startsWith('data:image/svg+xml;base64,'), true, src)
    assert.match(view.item('export-html').props.subtitle, /^<img /)
  }
  // 普通 Base64 与非法内容不受影响
  await view.search(PNG_B64)
  assert.equal(view.item('export-datauri').props.subtitle.startsWith('data:image/png;base64,'), true)
  await view.search('<!-- only a comment -->')
  assert.match(view.item('item-error').props.title, /不是 SVG 图片/)
  await view.search('!!!!')
  assert.equal(view.item('item-error').props.title, 'Base64 字符内容非法或填充位数不正确')
})

test('[边界] isSvgSource：前导组合、内部子集、BOM；拒绝非 SVG 与未闭合前导；超长输入不卡顿', () => {
  const yes = [
    '<svg/>',
    '﻿\n  <svg>',
    DOCTYPE_SVG,
    '<?xml version="1.0"?><?xml-stylesheet href="a.css"?><!-- a --><!-- b --><!DOCTYPE svg [ <!ENTITY x "y"> ]><svg>'
  ]
  const no = ['', '<svgx>', '<html><svg></svg></html>', '<!-- 未闭合 <svg>', '<?xml version="1.0"?><note/>', 'PHN2Zz4=', '<!DOCTYPE svg']
  for (const s of yes) assert.equal(isSvgSource(s), true, s)
  for (const s of no) assert.equal(isSvgSource(s), false, s)
  assert.equal(detectImageFormat(new TextEncoder().encode(DOCTYPE_SVG)), 'svg')
  assert.equal(parseBase64Image(Buffer.from(DOCTYPE_SVG).toString('base64')).format, 'svg')
  assert.equal(detectImageFormat(Uint8Array.from([0xc3, 0x28, 0x3c, 0x73])), undefined, '非 UTF-8 字节不是 SVG')

  const started = Date.now()
  assert.equal(isSvgSource('<!--' + 'a'.repeat(4 * 1024 * 1024)), false)
  assert.equal(isSvgSource('<!---->'.repeat(100_000) + '<svg>'), false, '前导部分数量有上限')
  assert.ok(Date.now() - started < 1000, '超长输入应在 1 秒内返回')
})

test('[边界] 粘贴非 SVG 的 XML / HTML：明确提示不是 SVG 图片，不生成 text/plain 的「图片」写法', async () => {
  for (const src of ['<?xml version="1.0"?><note>hi</note>', '<html><body><svg></svg></body></html>', '  <div>x</div>']) {
    const view = await mount(Base64ImageCommand)
    await view.search(src)
    assert.deepEqual(view.items().map((i) => i.props.id), ['item-error'], src)
    assert.match(view.item('item-error').props.title, /不是 SVG 图片/)
    assert.equal(view.items().some((i) => i.props.id === 'export-datauri'), false)
    view.unmount()
  }
})
