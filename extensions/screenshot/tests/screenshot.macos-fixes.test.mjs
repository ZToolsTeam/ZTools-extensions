// macOS 真机复测问题的回归：复制/回贴参数与回退、真实图片尺寸、立即截取、批量清理范围与确认、
// 定位/打开/删除如实报告失败、OCR 平台门控、插件元数据与工作台不再承诺未实现的功能
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Toast } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import ScreenshotsCommand, { ScreenshotsManager, defaultScreenshotsManager, describeHostError } from '../dist/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const host = createHost()
const DIR = '/Users/me/Desktop'
const DENIED = '路径未由当前窗口授权'

function pngHeader(w, h) {
  const b = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]).copy(b, 0)
  b.writeUInt32BE(w, 16)
  b.writeUInt32BE(h, 20)
  return b.toString('base64')
}
function jpegHeader(w, h) {
  // SOI + APP0(长度 16) + SOF0
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...Array(14).fill(0)]
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  return Buffer.from([0xff, 0xd8, ...app0, ...sof]).toString('base64')
}
const shot = (name, mtime, extra = {}) => ({ id: `screenshot-${name}`, filename: name, path: `${DIR}/${name}`, size: 2048, modifiedAt: mtime, pinned: false, ...extra })
const fail = (message, code = 'PERMISSION_DENIED') => Object.assign(new Error(message), { code })
const calls = (m) => host.ipcCalls.filter(([name]) => name === m)

async function withPlatform(platform, fn) {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { value: { platform, userAgent: platform }, configurable: true, writable: true })
  try {
    return await fn()
  } finally {
    if (desc) Object.defineProperty(globalThis, 'navigator', desc)
    else delete globalThis.navigator
  }
}

/** 文件内容表：path -> base64；不在表里的路径按「未授权」处理 */
function installFiles(files) {
  host.ipc.filesystem_read_file_chunk = async (params) => {
    assert.deepEqual(Object.keys(params).sort(), ['length', 'offset', 'path'])
    if (!(params.path in files)) throw fail(DENIED)
    return { success: true, content: files[params.path], offset: 0, size: 1, totalSize: 1 }
  }
  host.ipc.filesystem_read_file = async (params) => {
    assert.deepEqual(Object.keys(params).sort(), ['encoding', 'path'])
    if (!(params.path in files)) throw fail(DENIED)
    return { success: true, content: files[params.path], size: 1 }
  }
}

test.beforeEach(() => host.reset())

test('复制图片：只发宿主认可的字段；未授权时失败并提示授权，不再提示成功', async () => {
  const mgr = new ScreenshotsManager()
  const item = { id: 'a', filename: 'a.png', path: `${DIR}/a.png` }
  installFiles({ [item.path]: pngHeader(10, 10) })
  host.ipc.clipboard_copy_image = async (params) => {
    assert.deepEqual(Object.keys(params), ['image'])
    return { success: true }
  }
  const ok = await mgr.copyImageToClipboard(item)
  assert.equal(ok.success, true)
  assert.equal(calls('clipboard_copy_file').length, 0)

  // 图片格式宿主不支持 → 退回复制文件引用，参数只有 filePath（宿主 rejectUnknownKeys）
  host.ipc.clipboard_copy_image = async () => { throw fail('image 不是受支持的 Base64 图片', 'INVALID_REQUEST') }
  host.ipc.clipboard_copy_file = async (params) => {
    assert.deepEqual(params, { filePath: item.path })
    return { success: true, count: 1 }
  }
  assert.equal((await mgr.copyImageToClipboard(item)).success, true)

  // 两条路都失败：报告图片本身的问题，而不是成功
  host.ipc.clipboard_copy_file = async () => { throw fail('Mac clipboard helper unavailable', 'NATIVE_HOST_UNAVAILABLE') }
  const bad = await mgr.copyImageToClipboard(item)
  assert.equal(bad.success, false)
  assert.match(bad.message, /image 不是受支持的 Base64 图片/)

  // 未授权：不触碰剪贴板，提示去动作面板授权
  host.ipcCalls.length = 0
  const denied = await mgr.copyImageToClipboard({ ...item, path: '/Users/me/Elsewhere/x.png' })
  assert.equal(denied.success, false)
  assert.match(denied.message, /授权访问截图目录/)
  assert.equal(calls('clipboard_copy_image').length + calls('clipboard_copy_file').length, 0)
  assert.ok(host.ipcCalls.every(([, p]) => !('path' in p && 'filePath' in p)))
})

test('回贴：能自动粘贴时走 hide_and_paste_image；macOS 未授权辅助功能时退回复制并提示 ⌘V；读不到文件时失败', async () => {
  await withPlatform('MacIntel', async () => {
    const mgr = new ScreenshotsManager()
    const item = { id: 'a', filename: 'a.png', path: `${DIR}/a.png` }
    installFiles({ [item.path]: pngHeader(10, 10) })
    host.ipc.clipboard_hide_and_paste_image = async (params) => {
      assert.deepEqual(Object.keys(params), ['image'])
      return { success: true }
    }
    assert.match((await mgr.pasteToActiveWindow(item)).message, /回贴到前台活动窗口/)

    host.ipc.clipboard_hide_and_paste_image = async () => {
      throw fail('已复制，但无法自动粘贴：请在系统设置 -> 隐私与安全性 -> 辅助功能中授权 ZTools')
    }
    host.ipc.clipboard_copy_image = async () => ({ success: true })
    const copied = await mgr.pasteToActiveWindow(item)
    assert.equal(copied.success, true)
    assert.match(copied.message, /请按 ⌘V 粘贴.*辅助功能/)

    // 剪贴板整体不可用：如实失败
    host.ipc.clipboard_copy_image = async () => { throw fail('剪贴板不可用', 'INTERNAL_ERROR') }
    host.ipc.clipboard_copy_file = async () => { throw fail('剪贴板不可用', 'INTERNAL_ERROR') }
    const broken = await mgr.pasteToActiveWindow(item)
    assert.equal(broken.success, false)
    assert.match(broken.message, /^回贴截图失败/)

    const denied = await mgr.pasteToActiveWindow({ ...item, path: '/nope/x.png' })
    assert.equal(denied.success, false)
    assert.equal(denied.error, 'PERMISSION_DENIED')
  })
})

test('界面：失败的复制、回贴、定位、打开用失败样式提示', async () => {
  host.ipc.screenshots_scan = async () => [shot('Screenshot 1.png', 2)]
  installFiles({})
  host.ipc.shell_show_item_in_folder = async () => { throw fail(DENIED) }
  host.ipc.shell_open_path = async () => { throw fail(DENIED) }
  await defaultScreenshotsManager.loadScreenshots(true)
  const view = await mount(ScreenshotsCommand)
  await tick(10)
  const row = view.item('screenshot-Screenshot 1.png')
  for (const title of [
    '粘贴到活动窗口',
    '复制图片本身',
    '在访达中显示',
    '用默认图片查看器打开'
  ]) {
    await view.run(row, title)
    await tick(10)
    const t = host.lastToast()
    assert.equal(t.style, Toast.Style.Failure, `${title} 应使用失败样式`)
    assert.match(`${t.title} ${t.message || ''}`, /授权访问截图目录/)
  }
  view.unmount()
})

test('尺寸：按图片头读取真实宽高（PNG/JPEG），未授权或损坏时显示「未知尺寸」，同目录未授权只探测一次', async () => {
  const mgr = new ScreenshotsManager()
  host.ipc.screenshots_scan = async () => [
    shot('a.png', 5),
    shot('b.jpg', 4),
    shot('broken.png', 3),
    { ...shot('x.png', 2), path: '/Users/me/Locked/x.png' },
    { ...shot('y.png', 1), path: '/Users/me/Locked/y.png' }
  ]
  installFiles({
    [`${DIR}/a.png`]: pngHeader(1350, 1988),
    [`${DIR}/b.jpg`]: jpegHeader(1024, 768),
    [`${DIR}/broken.png`]: Buffer.from('not an image').toString('base64')
  })
  const list = await mgr.loadScreenshots(true)
  const dims = Object.fromEntries(list.map((s) => [s.filename, s.dimensions]))
  assert.deepEqual(dims, {
    'a.png': '1350 x 1988',
    'b.jpg': '1024 x 768',
    'broken.png': '未知尺寸',
    'x.png': '未知尺寸',
    'y.png': '未知尺寸'
  })
  assert.ok(!list.some((s) => s.dimensions.includes('1920 x 1080')))
  assert.equal(calls('filesystem_read_file_chunk').filter(([, p]) => p.path.startsWith('/Users/me/Locked/')).length, 1)
  assert.equal(calls('filesystem_read_file').length, 0, '不再用 filesystem_read_file + maxBytes 探测尺寸')
  // 按真实尺寸可以搜索
  assert.deepEqual(mgr.filterScreenshots(list, '1350').map((s) => s.filename), ['a.png'])
})

test('立即截取：screen_capture 不带未知参数，读取 tempFile 加入列表并复制；截取前后隐藏/恢复窗口', async () => {
  const mgr = new ScreenshotsManager()
  const temp = '/cache/screenshots/screen_1.png'
  const order = []
  host.ipc.screenshots_scan = async () => [shot('old.png', 1)]
  installFiles({ [temp]: pngHeader(1800, 1169) })
  host.ipc.window_hide = async () => { order.push('hide'); return { success: true } }
  host.ipc.window_show = async () => { order.push('show'); return { success: true } }
  host.ipc.screen_capture = async (params) => {
    order.push('capture')
    assert.deepEqual(params, {})
    return { success: true, tempFile: temp, width: 1800, height: 1169 }
  }
  host.ipc.clipboard_copy_image = async () => ({ success: true })
  const res = await mgr.captureScreenNow({ copyToClipboard: true })
  assert.equal(res.success, true)
  assert.match(res.message, /1800 x 1169.*复制到剪贴板/)
  assert.deepEqual(order, ['hide', 'capture', 'show'])
  assert.equal(res.screenshot.path, temp)
  assert.equal(res.screenshot.source, 'capture')

  // 重新扫描后本次截取的截图仍在列表中（宿主扫描不到缓存目录）
  const list = await mgr.loadScreenshots(true)
  assert.deepEqual(list.map((s) => s.filename).filter((n) => n !== 'old.png').length, 1)
  assert.ok(list.some((s) => s.path === temp))

  // 仅加入列表：不碰剪贴板
  host.ipcCalls.length = 0
  assert.equal((await mgr.captureScreenNow({ copyToClipboard: false })).success, true)
  assert.equal(calls('clipboard_copy_image').length, 0)

  // 截图的缓存文件删除走 filesystem_delete_file（screenshots_delete 只认扫描结果）
  host.ipc.filesystem_delete_file = async ({ path: p }) => {
    assert.equal(p, temp)
    return { success: true }
  }
  assert.equal((await mgr.deleteScreenshot(res.screenshot)).success, true)
  assert.ok(!(await mgr.loadScreenshots(true)).some((s) => s.path === temp))
})

test('立即截取异常：宿主截屏失败/没给文件/复制失败都如实报告，且窗口一定恢复显示', async () => {
  const mgr = new ScreenshotsManager()
  let shown = 0
  host.ipc.window_hide = async () => ({ success: true })
  host.ipc.window_show = async () => { shown++; return { success: true } }

  host.ipc.screen_capture = async () => { throw fail('需要屏幕录制权限') }
  const denied = await mgr.captureScreenNow()
  assert.equal(denied.success, false)
  assert.match(denied.message, /截屏失败: 需要屏幕录制权限/)

  host.ipc.screen_capture = async () => ({ success: true })
  const empty = await mgr.captureScreenNow()
  assert.equal(empty.success, false)
  assert.equal(empty.error, 'CAPTURE_NO_FILE')

  host.ipc.screen_capture = async () => ({ success: true, tempFile: '/cache/s2.png', width: 10, height: 10 })
  installFiles({})
  host.ipc.clipboard_copy_file = async () => { throw fail('Mac clipboard helper unavailable', 'NATIVE_HOST_UNAVAILABLE') }
  const copyFailed = await mgr.captureScreenNow()
  assert.equal(copyFailed.success, false)
  assert.equal(copyFailed.error, 'CAPTURE_COPY_FAILED')
  assert.equal(copyFailed.screenshot.path, '/cache/s2.png', '截图本身已生成，仍加入列表')
  assert.equal(shown, 3)
})

test('批量清理：默认不勾选；只清理当前可见且已勾选的；需要确认；取消不删；失败逐项报告且保留行', async () => {
  const deleted = []
  host.ipc.screenshots_scan = async () => [shot('keep-a.png', 4), shot('keep-b.png', 3), shot('old-1.png', 2), shot('old-2.png', 1)]
  installFiles({})
  host.ipc.screenshots_delete = async ({ filePath }) => {
    if (filePath.endsWith('old-2.png')) throw fail('文件不存在', 'FILE_ERROR')
    deleted.push(filePath)
    return { success: true }
  }
  await defaultScreenshotsManager.loadScreenshots(true)
  const view = await mount(ScreenshotsCommand)
  await tick(10)
  const queue = () => view.tree().props.subList
  assert.equal(queue().items.filter((i) => i.props.checked).length, 0, '默认不勾选')

  // 全选全部 4 张，再搜索只显示 old-*
  queue().onCheckChange(true)
  await tick()
  assert.equal(queue().items.filter((i) => i.props.checked).length, 4)
  await view.search('old-')
  const batchTitle = (n) => `批量清理已勾选截图（${n} 项）`
  const row = view.item('screenshot-old-1.png')
  assert.ok(view.actions(row).some((a) => a.props.title === batchTitle(2)))

  // 取消确认：什么都不删
  host.setConfirm(false)
  await view.run(row, batchTitle(2))
  await tick(10)
  assert.equal(host.confirms.length, 1)
  assert.match(host.confirms[0].title, /2 张/)
  assert.equal(deleted.length, 0)

  host.setConfirm(true)
  await view.run(view.item('screenshot-old-1.png'), batchTitle(2))
  await tick(20)
  assert.deepEqual(deleted, [`${DIR}/old-1.png`], '隐藏的 keep-* 不会被清理')
  const t = host.lastToast()
  assert.equal(t.style, Toast.Style.Failure)
  assert.match(t.title, /已清理 1 张，1 张失败/)
  assert.match(t.message, /old-2.png: 文件不存在/)
  view.unmount()
})

test('定位/打开/删除：宿主失败时返回失败与原因，删除失败不删行；成功时才移除', async () => {
  const mgr = new ScreenshotsManager()
  host.ipc.screenshots_scan = async () => [shot('a.png', 2), shot('b.png', 1)]
  installFiles({})
  const list = await mgr.loadScreenshots(true)
  const a = list.find((s) => s.filename === 'a.png')

  host.ipc.shell_show_item_in_folder = async () => { throw fail(DENIED) }
  host.ipc.shell_open_path = async () => { throw fail('文件不存在', 'FILE_ERROR') }
  host.ipc.screenshots_delete = async () => { throw fail('文件不存在', 'FILE_ERROR') }
  for (const res of [await mgr.showInExplorer(a), await mgr.openWithDefaultApp(a), await mgr.deleteScreenshot(a)]) {
    assert.equal(res.success, false)
  }
  assert.equal((await mgr.loadScreenshots(false)).length, 2, '删除失败不移除行')

  host.ipc.shell_show_item_in_folder = async (p) => { assert.deepEqual(p, { fullPath: a.path }); return { success: true } }
  host.ipc.shell_open_path = async () => ({ success: true })
  host.ipc.screenshots_delete = async (p) => { assert.deepEqual(p, { filePath: a.path }); return { success: true } }
  assert.equal((await mgr.showInExplorer(a)).success, true)
  assert.equal((await mgr.openWithDefaultApp(a)).success, true)
  assert.equal((await mgr.deleteScreenshot(a)).success, true)
  const after = await mgr.loadScreenshots(false)
  assert.deepEqual(after.map((s) => s.filename), ['b.png'])
  // 删除经宿主 screenshots_delete（限定扫描结果），不再直接调用 shell_trash_item
  assert.equal(calls('shell_trash_item').length, 0)
})

test('OCR：macOS 隐藏 OCR 动作与分类且不发 dllplugin_call；Windows 保留', async () => {
  host.ipc.screenshots_scan = async () => [shot('a.png', 1)]
  installFiles({})
  await withPlatform('MacIntel', async () => {
    await defaultScreenshotsManager.loadScreenshots(true)
    const view = await mount(ScreenshotsCommand)
    await tick(10)
    const row = view.item('screenshot-a.png')
    assert.ok(!view.actions(row).some((a) => /提取的文字/.test(a.props.title)))
    assert.ok(!view.text().includes('包含提取文字'))
    await assert.rejects(() => defaultScreenshotsManager.extractOcr({ id: 'a', filename: 'a.png', path: `${DIR}/a.png` }), /OCR_NOT_SUPPORTED/)
    assert.equal(calls('dllplugin_call').length, 0)
    view.unmount()
  })
  await withPlatform('Win32', async () => {
    const view = await mount(ScreenshotsCommand)
    await tick(10)
    assert.ok(view.actions(view.item('screenshot-a.png')).some((a) => /提取的文字/.test(a.props.title)))
    assert.ok(view.text().includes('包含提取文字'))
    view.unmount()
  })
})

test('元数据与工作台：不再承诺区域截图/标注/悬浮贴图，工作台只留真实生效的选项', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../plugin.json'), 'utf8'))
  const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8')
  for (const text of [manifest.name, manifest.description]) {
    assert.doesNotMatch(text, /区域截图|置顶贴图|悬浮贴图|标注|选区|Pin\)|马赛克/)
  }
  assert.doesNotMatch(readme, /ScreenCapturePlugin|\.dll`\)/)

  host.ipc.screenshots_scan = async () => []
  await defaultScreenshotsManager.loadScreenshots(true)
  const view = await mount(ScreenshotsCommand)
  await tick(10)
  const wb = view.tree().props.workbenchPanel
  const ids = wb.fields.map((f) => f.id)
  assert.ok(!ids.some((id) => /capture-region|image-format|window-shadow|hash-dedupe/.test(id)))
  assert.equal(wb.previewCard, undefined)
  assert.doesNotMatch(JSON.stringify(wb), /Pictures\\\\Screenshots/)
  view.unmount()
})

test('describeHostError：仅未授权错误追加授权提示', () => {
  assert.match(describeHostError('路径未由当前窗口授权', 'x'), /授权访问截图目录/)
  assert.equal(describeHostError('文件不存在', 'x'), '文件不存在')
  assert.equal(describeHostError(undefined, '兜底'), '兜底')
})

test('动作标题、筛选下拉与说明不带英文括注，避免底栏截断', async () => {
  const host = createHost()
  host.ipc.screenshots_scan = async () => [{ id: 'a', path: '/test/a.png', filename: 'a.png', width: 10, height: 10, size: 1 }]
  await defaultScreenshotsManager.loadScreenshots(true)
  const view = await mount(ScreenshotsCommand, host)
  try {
    await tick(10)
    const titles = view.actions(view.items()[0]).map((a) => a.props.title)
    assert.ok(titles.includes('粘贴到活动窗口'))
    const dropdown = view.tree().props.searchBarAccessory.children.map((it) => it.props.title)
    assert.ok(dropdown.includes('全部截图'))
    for (const title of [...titles, ...dropdown]) assert.doesNotMatch(title, /\([A-Za-z]/, title)
    for (const field of view.tree().props.workbenchPanel.fields) {
      if (field.type === 'info') assert.ok(field.value.length <= 12, field.value)
    }
  } finally { view.unmount() }
})
