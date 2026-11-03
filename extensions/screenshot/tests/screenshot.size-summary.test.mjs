import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHost, mount } from '../../shared/test-harness.mjs'
import ScreenshotsCommand, { ScreenshotsManager, defaultScreenshotsManager } from '../dist/index.js'

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-screenshot-size-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('筛选后的数量、容量和置顶数属于同一结果集，全库概览保持全库口径', async (t) => {
  const host = createHost()
  const dir = fixture(t)
  const kept = path.join(dir, 'keep.png')
  const hidden = path.join(dir, 'hidden.png')
  fs.writeFileSync(kept, Buffer.alloc(128))
  fs.writeFileSync(hidden, Buffer.alloc(4096))
  host.ipc.screenshots_scan = () => [kept, hidden].map(file => ({
    id: file, path: file, filename: path.basename(file), width: 10, height: 10,
    size: fs.statSync(file).size, pinned: file === hidden
  }))
  await defaultScreenshotsManager.loadScreenshots(true)
  const view = await mount(ScreenshotsCommand, host)
  t.after(() => view.unmount())
  await view.search('keep.png')
  const props = view.tree().props
  assert.match(props.filterBar.summaryText, /共 1 张（128 B） · 已置顶 0 张/)
  // 统计只在状态条出现一次：右栏表头只显示勾选数，左栏不再重复四格统计
  assert.equal(props.subList.subtitle, '已选 0 项')
  assert.equal(props.workbenchPanel.previewCard, undefined)
  const row = view.items()[0]
  assert.doesNotMatch(row.props.subtitle, /10×10|10 × 10|10x10/)
  await view.search('不存在的截图')
  assert.match(view.tree().props.filterBar.summaryText, /共 0 张（0 B） · 已置顶 0 张/)
})

test('截取后从真实落盘文件读取字节数，重新扫描仍计入总量', async (t) => {
  const host = createHost()
  const file = path.join(fixture(t), 'capture.png')
  fs.writeFileSync(file, Buffer.alloc(722997))
  host.ipc.window_hide = () => ({ success: true })
  host.ipc.window_show = () => ({ success: true })
  host.ipc.screen_capture = () => ({ success: true, tempFile: file, width: 1512, height: 982 })
  host.ipc.filesystem_get_file_size = params => {
    assert.deepEqual(params, { path: file })
    return { success: true, size: fs.statSync(params.path).size }
  }
  host.ipc.screenshots_scan = () => []
  const manager = new ScreenshotsManager()
  const result = await manager.captureScreenNow({ copyToClipboard: false })
  assert.equal(result.success, true)
  assert.equal(result.screenshot.sizeBytes, fs.statSync(file).size)
  assert.equal(result.screenshot.formattedSize, '706 KB')
  assert.equal((await manager.loadScreenshots(true))[0].sizeBytes, 722997)
  assert.ok(!host.ipcCalls.some(([method]) => method.startsWith('clipboard_')))
})

test('大小读取失败仍保留已生成截图，并明确标为未知而不是0字节', async () => {
  const host = createHost()
  host.ipc.window_hide = () => ({ success: true })
  host.ipc.window_show = () => ({ success: true })
  host.ipc.screen_capture = () => ({ success: true, tempFile: '/cache/test.png', width: 10, height: 10 })
  host.ipc.filesystem_get_file_size = () => { throw new Error('测试文件读取被拒绝') }
  const result = await new ScreenshotsManager().captureScreenNow({ copyToClipboard: false })
  assert.equal(result.success, true, '截图已经成功生成，仅元数据不可用')
  assert.equal(result.screenshot.sizeBytes, null)
  assert.equal(result.screenshot.formattedSize, '未知大小')
  assert.match(result.message, /大小未知.*测试文件读取被拒绝/)
})

test('未知与非法大小不会冒充0字节或污染容量，真实空文件仍显示0 B', async (t) => {
  const host = createHost()
  host.ipc.screenshots_scan = () => [null, -1, NaN, Infinity, 0].map((size, index) => ({
    id: `size-${index}`, filename: `size-${index}.png`, path: `/test/size-${index}.png`,
    width: 10, height: 10, size
  }))
  const list = (await defaultScreenshotsManager.loadScreenshots(true)).sort((a, b) => a.id.localeCompare(b.id))
  assert.deepEqual(list.map(item => item.sizeBytes), [null, null, null, null, 0])
  assert.deepEqual(list.map(item => item.formattedSize), ['未知大小', '未知大小', '未知大小', '未知大小', '0 B'])
  const view = await mount(ScreenshotsCommand, host)
  t.after(() => view.unmount())
  assert.match(view.tree().props.filterBar.summaryText, /0 B.*4 张大小未知/)
})
