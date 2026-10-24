// 回贴最新截图的结果如实呈现 + 同目录截图 id 唯一（置顶 / 删除只命中一张）+ 旧版撞车 id 的置顶记录迁移
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost } from '../../shared/test-harness.mjs'
import { ScreenshotsManager } from '../dist/screenshots-service.js'

const host = createHost()
test.beforeEach(() => host.reset())

const DIR = '/Users/me/Desktop'
function hostShot(name, mtime, id) {
  return { ...(id ? { id } : {}), filename: name, path: `${DIR}/${name}`, size: 1024, modifiedAt: mtime, pinned: false }
}

test('回贴最新截图：宿主只复制未粘贴时提示手动粘贴；宿主返回失败时不提示成功', async () => {
  const mgr = new ScreenshotsManager()
  host.ipc.screenshots_paste_latest = async () => ({
    success: true, copied: true, pasted: false,
    screenshot: hostShot('Screenshot new.png', 2),
    message: '已复制最新截图: Screenshot new.png，请按 ⌘V 粘贴'
  })
  const copied = await mgr.pasteLatestScreenshot()
  assert.equal(copied.success, true)
  assert.match(copied.message, /已复制最新截图.*请按 ⌘V 粘贴/)

  // 宿主返回失败（未粘贴也未复制）：不能提示成功；没有截图时如实提示
  host.ipc.screenshots_paste_latest = async () => ({ success: false, code: 'NO_SCREENSHOTS', message: '未找到近期截图' })
  host.ipc.screenshots_scan = async () => []
  const none = await mgr.pasteLatestScreenshot()
  assert.equal(none.success, false)
  assert.equal(none.error, 'NO_SCREENSHOTS')
  assert.ok(!host.ipcCalls.some(([m]) => m === 'clipboard_hide_and_paste_file'))
})

test('同目录多张截图：宿主 id 唯一时置顶与删除只命中一张；宿主没给 id 时按完整路径生成 id', async () => {
  host.ipc.screenshots_scan = async () => [
    hostShot('Screenshot 1.png', 4, 'screenshot-aaaaaaaaaaaaaaaaaaaaaaaa'),
    hostShot('Screenshot 2.png', 3, 'screenshot-bbbbbbbbbbbbbbbbbbbbbbbb'),
    hostShot('截屏 3.png', 2),
    hostShot('屏幕 3.png', 1)
  ]
  host.ipc.filesystem_read_file = async () => ''
  host.ipc.screenshots_delete = async () => ({ success: true })
  const mgr = new ScreenshotsManager()
  const list = await mgr.loadScreenshots(true)
  assert.equal(list.length, 4)
  assert.equal(new Set(list.map((s) => s.id)).size, 4)

  const second = list.find((s) => s.filename === 'Screenshot 2.png')
  const pinned = await mgr.togglePinScreenshot(second)
  assert.equal(pinned.success, true)
  const afterPin = await mgr.loadScreenshots(false)
  assert.deepEqual(afterPin.filter((s) => s.pinned).map((s) => s.filename), ['Screenshot 2.png'])

  const victim = afterPin.find((s) => s.filename === '截屏 3.png')
  await mgr.deleteScreenshot(victim)
  const afterDelete = await mgr.loadScreenshots(false)
  assert.deepEqual(afterDelete.map((s) => s.filename).sort(), ['Screenshot 1.png', 'Screenshot 2.png', '屏幕 3.png'].sort())
})

test('[迁移] 旧版宿主撞车 id 的置顶记录被丢弃，不会让同目录所有截图都显示已置顶；新 id 的置顶保留', async () => {
  host.storage.set('@ztools/screenshots/pinned', JSON.stringify(['screenshot-L3ByaXZhdGUvdG1w', 'screenshot-bbbbbbbbbbbbbbbbbbbbbbbb']))
  host.ipc.screenshots_scan = async () => [
    hostShot('Screenshot 1.png', 2, 'screenshot-aaaaaaaaaaaaaaaaaaaaaaaa'),
    hostShot('Screenshot 2.png', 1, 'screenshot-bbbbbbbbbbbbbbbbbbbbbbbb')
  ]
  host.ipc.filesystem_read_file = async () => ''
  const mgr = new ScreenshotsManager()
  const list = await mgr.loadScreenshots(true)
  assert.deepEqual(list.filter((s) => s.pinned).map((s) => s.filename), ['Screenshot 2.png'])
  assert.deepEqual(JSON.parse(host.storage.get('@ztools/screenshots/pinned')), ['screenshot-bbbbbbbbbbbbbbbbbbbbbbbb'])
})
