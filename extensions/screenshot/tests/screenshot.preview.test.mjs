// 截图预览只显示真实图片：不再生成「红黄绿圆点 + 假内容条」的窗口示意图；
// 读不到、不是图片、过大时如实写明原因并只列真实元数据；定位动作按平台显示「访达 / 资源管理器」
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import ScreenshotsCommand, {
  ScreenshotsManager,
  ScreenshotDetailView,
  defaultScreenshotsManager,
  buildScreenshotDetailMarkdown,
  fileManagerName,
  sniffImageMime,
  SCREENSHOT_PREVIEW_MAX_BYTES,
  INITIAL_SCREENSHOTS
} from '../dist/index.js'
import * as service from '../dist/screenshots-service.js'

const host = createHost()
const DIR = '/Users/me/Desktop'
const DENIED = '路径未由当前窗口授权'
const fail = (message, code = 'PERMISSION_DENIED') => Object.assign(new Error(message), { code })
const calls = (m) => host.ipcCalls.filter(([name]) => name === m)

function png(w, h) {
  const b = Buffer.alloc(64)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]).copy(b, 0)
  b.writeUInt32BE(w, 16)
  b.writeUInt32BE(h, 20)
  return b.toString('base64')
}

function installFiles(files) {
  const handler = async (params) => {
    if (!(params.path in files)) throw fail(DENIED)
    const v = files[params.path]
    if (v instanceof Error) throw v
    return { success: true, content: v, size: 1 }
  }
  host.ipc.filesystem_read_file = handler
  host.ipc.filesystem_read_file_chunk = handler
}

const item = (name, extra = {}) => ({
  id: `screenshot-${name}`,
  filename: name,
  path: `${DIR}/${name}`,
  width: 0,
  height: 0,
  dimensions: '未知尺寸',
  sizeBytes: 2048,
  formattedSize: '2.00 KB',
  createdAt: 1,
  modifiedAt: 1,
  formattedDate: '10:00:00',
  pinned: false,
  ocrText: '',
  ocrStatus: 'pending',
  ...extra
})

test.beforeEach(() => host.reset())

test('假示意图生成函数与 thumbnailSvg 字段已删除，扫描结果与示例数据都不再带 SVG 示意图', async () => {
  assert.equal(service.generateScreenshotThumbnailSvg, undefined)
  for (const s of INITIAL_SCREENSHOTS) assert.equal('thumbnailSvg' in s, false)

  host.ipc.screenshots_scan = async () => [{ id: 'screenshot-a', filename: 'a.png', path: `${DIR}/a.png`, size: 10, createdAt: 1, modifiedAt: 2, pinned: false }]
  installFiles({})
  const list = await new ScreenshotsManager().loadScreenshots(true)
  assert.equal(list.length, 1)
  assert.equal('thumbnailSvg' in list[0], false)
  assert.equal(JSON.stringify(list).includes('svg'), false)
  // 读不到图片头：尺寸如实为未知，不填默认值
  assert.equal(list[0].width, 0)
  assert.equal(list[0].dimensions, '未知尺寸')
})

test('loadPreviewDataUrl：读取真实图片内容，按文件头魔数确定类型（不信任扩展名）', async () => {
  const content = png(1350, 1988)
  installFiles({ [`${DIR}/shot.jpg`]: content })
  const res = await new ScreenshotsManager().loadPreviewDataUrl(item('shot.jpg'))
  assert.equal(res.ok, true)
  assert.equal(res.mime, 'image/png')
  assert.equal(res.dataUrl, `data:image/png;base64,${content}`)
  assert.deepEqual(calls('filesystem_read_file').map(([, p]) => p), [{ path: `${DIR}/shot.jpg`, encoding: 'base64' }])
})

test('loadPreviewDataUrl：未授权、非图片、空内容、宿主异常都返回失败原因，不返回任何图片', async () => {
  installFiles({
    [`${DIR}/text.png`]: Buffer.from('this is not an image at all').toString('base64'),
    [`${DIR}/empty.png`]: '',
    [`${DIR}/boom.png`]: fail('EIO: i/o error', 'FILE_ERROR')
  })
  const mgr = new ScreenshotsManager()

  const denied = await mgr.loadPreviewDataUrl(item('locked.png'))
  assert.equal(denied.ok, false)
  assert.match(denied.reason, /读取图片失败/)
  assert.match(denied.reason, /授权访问截图目录/)

  const text = await mgr.loadPreviewDataUrl(item('text.png'))
  assert.equal(text.ok, false)
  assert.match(text.reason, /不是可识别的图片格式/)

  const empty = await mgr.loadPreviewDataUrl(item('empty.png'))
  assert.equal(empty.ok, false)
  assert.match(empty.reason, /内容为空/)

  const boom = await mgr.loadPreviewDataUrl(item('boom.png'))
  assert.equal(boom.ok, false)
  assert.match(boom.reason, /EIO/)

  const invalid = await mgr.loadPreviewDataUrl({ ...item('x.png'), path: '' })
  assert.deepEqual(invalid, { ok: false, reason: '无效的文件路径' })
})

test('loadPreviewDataUrl：已知大小超过上限时不读取文件；读到的内容超过上限同样拒绝内联', async () => {
  installFiles({ [`${DIR}/big.png`]: png(10, 10), [`${DIR}/grown.png`]: Buffer.alloc(SCREENSHOT_PREVIEW_MAX_BYTES + 16, 0x89).toString('base64') })
  const mgr = new ScreenshotsManager()

  const big = await mgr.loadPreviewDataUrl(item('big.png', { sizeBytes: SCREENSHOT_PREVIEW_MAX_BYTES + 1 }))
  assert.equal(big.ok, false)
  assert.match(big.reason, /超过预览上限/)
  assert.equal(calls('filesystem_read_file').length, 0)

  // 扫描时大小未知（或扫描后文件变大）：读到后按真实长度判断
  const grown = await mgr.loadPreviewDataUrl(item('grown.png', { sizeBytes: null }))
  assert.equal(grown.ok, false)
  assert.match(grown.reason, /超过预览上限/)
})

test('sniffImageMime：只认真实图片魔数', () => {
  assert.equal(sniffImageMime(Buffer.from(png(1, 1), 'base64')), 'image/png')
  assert.equal(sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg')
  assert.equal(sniffImageMime(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])), 'image/gif')
  assert.equal(sniffImageMime(new Uint8Array([0x42, 0x4d, 0, 0])), 'image/bmp')
  assert.equal(sniffImageMime(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp')
  assert.equal(sniffImageMime(Buffer.from('<svg xmlns=')), null)
  assert.equal(sniffImageMime(new Uint8Array([])), null)
})

test('详情 Markdown：成功时只嵌真实图片；失败时写原因、无图片语法；未知尺寸如实显示', () => {
  const it = item('we[ird]`name.png', { path: `${DIR}/a\`b.png` })
  const ready = buildScreenshotDetailMarkdown(it, { status: 'ready', dataUrl: 'data:image/png;base64,AAAA' }, false)
  assert.match(ready, /^!\[we ird `name\.png\]\(data:image\/png;base64,AAAA\)/)
  assert.ok(!ready.includes('svg'))
  assert.match(ready, /\*\*分辨率\*\*: 未知尺寸/)
  assert.ok(ready.includes("`/Users/me/Desktop/a'b.png`"))

  const bad = buildScreenshotDetailMarkdown(it, { status: 'unavailable', reason: '读取图片失败: 无权限\n第二行' }, false)
  assert.ok(!bad.includes(']('), '失败时不能出现图片语法')
  assert.match(bad, /> 预览不可用：读取图片失败: 无权限 第二行/)

  const loading = buildScreenshotDetailMarkdown(it, { status: 'loading' }, false)
  assert.ok(!loading.includes(']('))

  const withOcr = buildScreenshotDetailMarkdown({ ...it, ocrText: '真实识别文字' }, { status: 'loading' }, true)
  assert.match(withOcr, /真实识别文字/)
  assert.ok(!buildScreenshotDetailMarkdown({ ...it, ocrText: '真实识别文字' }, { status: 'loading' }, false).includes('真实识别文字'))
})

test('界面：详情页读取真实图片并显示；读取失败显示原因与真实元数据', async () => {
  const content = png(800, 600)
  installFiles({ [`${DIR}/ok.png`]: content })

  const okView = await mount(() => ScreenshotDetailView({ item: item('ok.png', { width: 800, height: 600, dimensions: '800 x 600' }) }))
  await tick(10)
  const okTree = okView.tree()
  assert.equal(okTree.props.isLoading, false)
  assert.ok(okTree.props.markdown.includes(`(data:image/png;base64,${content})`))
  assert.ok(!okView.text().includes('svg+xml'))
  okView.unmount()

  const badView = await mount(() => ScreenshotDetailView({ item: item('locked.png') }))
  await tick(10)
  const badTree = badView.tree()
  assert.equal(badTree.props.isLoading, false)
  assert.ok(!badTree.props.markdown.includes(']('))
  assert.match(badTree.props.markdown, /预览不可用：读取图片失败/)
  assert.match(badView.text(), /未知尺寸/)
  badView.unmount()

  // 预览读取过程本身抛错：同样显示原因，不停留在加载状态
  const throwing = { loadPreviewDataUrl: async () => { throw new Error('预览服务崩溃') } }
  const errView = await mount(() => ScreenshotDetailView({ item: item('ok.png'), manager: throwing }))
  await tick(10)
  assert.equal(errView.tree().props.isLoading, false)
  assert.match(errView.tree().props.markdown, /预览不可用：预览服务崩溃/)
  errView.unmount()
})

test('界面：列表动作「查看截图预览」打开真实图片详情；定位动作按平台显示访达 / 资源管理器', async () => {
  const content = png(320, 180)
  host.ipc.screenshots_scan = async () => [
    { id: 'screenshot-mac', filename: 'mac.png', path: `${DIR}/mac.png`, size: 64, createdAt: 1, modifiedAt: 3, pinned: false },
    { id: 'screenshot-win', filename: 'win.png', path: 'C:\\Users\\me\\Pictures\\Screenshots\\win.png', size: 64, createdAt: 1, modifiedAt: 2, pinned: false }
  ]
  installFiles({ [`${DIR}/mac.png`]: content })
  await defaultScreenshotsManager.loadScreenshots(true)
  const view = await mount(ScreenshotsCommand)
  await tick(10)

  const macRow = view.item('screenshot-mac')
  const macTitles = view.actions(macRow).map((a) => a.props.title)
  assert.ok(macTitles.includes('在访达中显示'))
  assert.ok(!macTitles.some((t) => /资源管理器|Explorer/.test(t)))
  const winTitles = view.actions(view.item('screenshot-win')).map((a) => a.props.title)
  assert.ok(winTitles.includes('在资源管理器中显示'))
  assert.ok(!winTitles.includes('在访达中显示'))

  const push = view.actions(macRow).find((a) => a.props.title === '查看截图预览')
  assert.equal(push.type, 'Action.Push')
  host.pushed.push(push.props.target)
  const detail = await mountPushed(host)
  await tick(10)
  assert.ok(detail.tree().props.markdown.includes(`(data:image/png;base64,${content})`))
  assert.match(detail.tree().props.markdown, /320 x 180/)
  detail.unmount()
  view.unmount()
})

test('fileManagerName：Windows 盘符 / UNC 路径为资源管理器，其余为访达', () => {
  assert.equal(fileManagerName('C:\\a\\b.png'), '资源管理器')
  assert.equal(fileManagerName('d:/a/b.png'), '资源管理器')
  assert.equal(fileManagerName('\\\\server\\share\\b.png'), '资源管理器')
  assert.equal(fileManagerName('/Users/me/b.png'), '访达')
  assert.equal(fileManagerName(''), '访达')
})

test('定位成功提示使用对应平台的文件管理器名称', async () => {
  host.ipc.shell_show_item_in_folder = async () => ({ success: true })
  const mgr = new ScreenshotsManager()
  assert.equal((await mgr.showInExplorer(item('a.png'))).message, '已在访达中定位: a.png')
  assert.equal((await mgr.showInExplorer({ ...item('b.png'), path: 'C:\\x\\b.png' })).message, '已在资源管理器中定位: b.png')
})
