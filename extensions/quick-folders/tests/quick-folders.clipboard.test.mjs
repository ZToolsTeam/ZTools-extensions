// 复制完整路径的集成测试：真实声明式运行时 + 测试宿主剪贴板（可注入写入失败）
// 覆盖：写入成功才提示「已复制路径」；宿主拒绝写入时提示「复制失败」与原因，不提示成功、不留下未处理的 rejection
import test from 'node:test'
import assert from 'node:assert/strict'
import { getDeclarativeBridge, Toast } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import QuickFoldersCommand from '../dist/index.js'

const host = createHost()
const rejections = []
process.on('unhandledRejection', (reason) => rejections.push(reason))
const COPY = '复制完整路径'

test.beforeEach(() => {
  host.reset()
  rejections.length = 0
  host.ipc.system_get_path = async ({ name }) => {
    if (name === 'home') return { success: true, path: '/Users/bob' }
    const child = { desktop: 'Desktop', downloads: 'Downloads', documents: 'Documents', pictures: 'Pictures', videos: 'Movies', music: 'Music', appData: 'Library/Application Support' }[name]
    return child ? { success: true, path: `/Users/bob/${child}` } : { success: false }
  }
})

/** 让宿主剪贴板写入抛错（模拟 HostMethodError：剪贴板被占用 / IPC 断开），返回恢复函数 */
function failClipboard(error) {
  const bridge = getDeclarativeBridge()
  const original = bridge.copyToClipboard
  bridge.copyToClipboard = async () => {
    throw error
  }
  return () => {
    bridge.copyToClipboard = original
  }
}

test('复制完整路径：写入成功后才提示「已复制路径」，内容为该目录真实路径', async () => {
  const view = await mount(QuickFoldersCommand)
  await tick(10)
  await view.run(view.item('downloads'), COPY)
  await tick(10)
  assert.equal(host.clipboard.text, '/Users/bob/Downloads')
  assert.equal(host.lastToast().style, Toast.Style.Success)
  assert.equal(host.lastToast().title, '已复制路径')
  assert.equal(host.lastToast().message, '/Users/bob/Downloads')
  assert.deepEqual(rejections, [])
  view.unmount()
})

test('[故障] 宿主拒绝写入时提示「复制失败」与原因，不提示成功、无未处理 rejection', async () => {
  const view = await mount(QuickFoldersCommand)
  await tick(10)
  host.clipboard.text = 'SENTINEL'
  host.toasts.length = 0
  const restore = failClipboard(Object.assign(new Error('剪贴板被其他程序占用'), { name: 'HostMethodError', code: 'CLIPBOARD_BUSY' }))
  try {
    await view.run(view.item('downloads'), COPY)
    await tick(10)
  } finally {
    restore()
  }
  assert.equal(host.clipboard.text, 'SENTINEL')
  assert.equal(host.toasts.length, 1)
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.equal(host.lastToast().title, '复制失败')
  assert.equal(host.lastToast().message, '剪贴板被其他程序占用')
  assert.deepEqual(rejections, [])
  view.unmount()
})

test('[故障] 宿主抛出非 Error 值（IPC 管道断开）时同样提示失败并带原因；恢复后再次复制成功', async () => {
  const view = await mount(QuickFoldersCommand)
  await tick(10)
  host.toasts.length = 0
  const restore = failClipboard('IPC 管道已断开')
  try {
    await view.run(view.item('desktop'), COPY)
    await tick(10)
  } finally {
    restore()
  }
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.equal(host.lastToast().message, 'IPC 管道已断开')
  await view.run(view.item('desktop'), COPY)
  await tick(10)
  assert.equal(host.clipboard.text, '/Users/bob/Desktop')
  assert.equal(host.lastToast().style, Toast.Style.Success)
  assert.deepEqual(rejections, [])
  view.unmount()
})
