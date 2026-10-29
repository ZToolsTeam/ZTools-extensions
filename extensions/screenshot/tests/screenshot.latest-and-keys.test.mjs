// 回贴最新截图按修改时间（不是置顶优先的第一项）、本次立即截取比扫描结果新时回贴截取的文件；
// 主动作不再声明与客户端固定 ⌘/Ctrl+Enter（复制图片）冲突的快捷键；批量清理确认框按平台写废纸篓 / 回收站
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import ScreenshotsCommand, { ScreenshotsManager, defaultScreenshotsManager, newestScreenshot, trashName } from '../dist/index.js'

const host = createHost()
const DIR = '/Users/me/Desktop'
const shot = (name, mtime, extra = {}) => ({ id: `screenshot-${name}`, filename: name, path: `${DIR}/${name}`, size: 2048, modifiedAt: mtime, pinned: false, ...extra })
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1]).toString('base64')

async function withPlatform(platform, fn) {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { value: { platform, userAgent: platform }, configurable: true, writable: true })
  try { return await fn() } finally {
    if (desc) Object.defineProperty(globalThis, 'navigator', desc)
    else delete globalThis.navigator
  }
}

test.beforeEach(() => host.reset())

test('[边界] newestScreenshot：空列表返回 undefined，按修改时间取最新而不是第一项', () => {
  assert.equal(newestScreenshot([]), undefined)
  const list = [{ id: 'p', modifiedAt: 1, pinned: true }, { id: 'n', modifiedAt: 9 }, { id: 'm', modifiedAt: 5 }]
  assert.equal(newestScreenshot(list).id, 'n')
})

test('宿主回贴最新失败后插件回退：回贴修改时间最新的一张，不是排在最前的置顶截图', async () => {
  host.storage.set('@ztools/screenshots/pinned', JSON.stringify(['screenshot-old-pinned.png']))
  host.ipc.screenshots_scan = async () => [shot('new.png', 20), shot('old-pinned.png', 1)]
  host.ipc.screenshots_paste_latest = async () => { throw new Error('剪贴板被占用') }
  const pasted = []
  host.ipc.filesystem_read_file = async ({ path }) => ({ success: true, content: PNG, path })
  host.ipc.clipboard_hide_and_paste_image = async () => { pasted.push('img'); return { success: true } }
  const mgr = new ScreenshotsManager()
  const list = await mgr.loadScreenshots(true)
  assert.equal(list[0].filename, 'old-pinned.png', '列表置顶优先')
  const res = await mgr.pasteLatestScreenshot()
  assert.equal(res.success, true)
  assert.match(res.message, /new\.png/)
  const read = host.ipcCalls.filter(([m]) => m === 'filesystem_read_file').map(([, p]) => p.path)
  assert.deepEqual(read, [`${DIR}/new.png`])
})

test('本次立即截取比扫描到的截图都新：回贴最新截图回贴截取的文件，不交给只认识扫描目录的宿主', async () => {
  host.ipc.screenshots_scan = async () => [shot('scanned.png', 1)]
  host.ipc.window_hide = async () => ({ success: true })
  host.ipc.window_show = async () => ({ success: true })
  host.ipc.screen_capture = async () => ({ success: true, tempFile: '/cache/cap.png', width: 1, height: 1 })
  host.ipc.filesystem_get_file_size = async () => ({ success: true, size: 10 })
  host.ipc.filesystem_read_file = async () => ({ success: true, content: PNG })
  host.ipc.clipboard_hide_and_paste_image = async () => ({ success: true })
  let hostLatest = 0
  host.ipc.screenshots_paste_latest = async () => { hostLatest++; return { success: true, pasted: true } }
  const mgr = new ScreenshotsManager()
  await mgr.loadScreenshots(true)
  const cap = await mgr.captureScreenNow({ copyToClipboard: false })
  assert.equal(cap.success, true)
  const res = await mgr.pasteLatestScreenshot()
  assert.equal(res.success, true)
  assert.equal(res.screenshot.path, '/cache/cap.png')
  assert.equal(hostLatest, 0)
})

test('主动作「粘贴到活动窗口」不声明 ⌘/Ctrl+Enter（客户端把它固定给次动作「复制图片」）', async () => {
  host.ipc.screenshots_scan = async () => [shot('a.png', 2)]
  host.ipc.filesystem_read_file_chunk = async () => ({ success: true, content: PNG })
  await defaultScreenshotsManager.loadScreenshots(true)
  const view = await mount(ScreenshotsCommand)
  await tick(10)
  const actions = view.actions(view.item('screenshot-a.png'))
  assert.equal(actions[0].props.title.startsWith('粘贴到活动窗口'), true)
  assert.equal(actions[0].props.shortcut, undefined)
  assert.equal(actions[1].props.title.startsWith('复制图片本身'), true)
  assert.ok(!actions.some((a) => a.props.shortcut?.key === 'enter'))
  view.unmount()
})

test('批量清理确认框：macOS 写废纸篓、Windows 写回收站；含本次截取时说明会直接删除', async () => {
  assert.equal(await withPlatform('MacIntel', () => trashName()), '废纸篓')
  assert.equal(await withPlatform('Win32', () => trashName()), '回收站')
  await withPlatform('MacIntel', async () => {
    host.ipc.screenshots_scan = async () => [shot('a.png', 2)]
    host.ipc.filesystem_read_file_chunk = async () => ({ success: true, content: PNG })
    host.ipc.window_hide = async () => ({ success: true })
    host.ipc.window_show = async () => ({ success: true })
    host.ipc.screen_capture = async () => ({ success: true, tempFile: '/cache/c.png', width: 1, height: 1 })
    host.ipc.filesystem_get_file_size = async () => ({ success: true, size: 1 })
    await defaultScreenshotsManager.loadScreenshots(true)
    await defaultScreenshotsManager.captureScreenNow({ copyToClipboard: false })
    const view = await mount(ScreenshotsCommand)
    await tick(10)
    view.tree().props.subList.onCheckChange(true)
    await tick()
    host.setConfirm(false)
    const row = view.item('screenshot-a.png')
    const batch = view.actions(row).find((a) => /批量清理/.test(a.props.title))
    await view.run(row, batch.props.title)
    await tick(5)
    const c = host.confirms[0]
    assert.match(c.message, /移入废纸篓/)
    assert.match(c.message, /1 张本次立即截取的截图会直接删除/)
    assert.equal(c.dismissAction.title, '取消')
    view.unmount()
  })
})
