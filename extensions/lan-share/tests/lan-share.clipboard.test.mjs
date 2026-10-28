// 复制地址的集成测试：真实声明式运行时 + 测试宿主剪贴板（可注入写入失败）+ 模拟客户端共享服务
// 覆盖：写入成功才提示「已复制…」；宿主拒绝写入时提示「复制失败」与原因，不提示成功、不留下未处理的 rejection；
// 服务未运行时不提供复制地址
import test from 'node:test'
import assert from 'node:assert/strict'
import { getDeclarativeBridge, Toast } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import { installLanHost } from './lan-host-fake.mjs'
import LanShareCommand from '../dist/index.js'

const host = createHost()
const rejections = []
process.on('unhandledRejection', (reason) => rejections.push(reason))

test.beforeEach(() => {
  host.reset()
  rejections.length = 0
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

async function mountRunning() {
  const state = installLanHost(host, { existing: ['D:\\Share\\a.txt'] })
  state.running = true
  state.files.set('id1', { id: 'id1', name: 'a.txt', path: 'D:\\Share\\a.txt', size: 10, sizeBytes: 10, shared: true, isDirectory: false })
  const view = await mount(LanShareCommand)
  await tick(20)
  host.toasts.length = 0
  return view
}

test('复制访问地址：写入成功后才提示「已复制访问地址」', async () => {
  const view = await mountRunning()
  await view.run(view.item('lan-service'), '复制访问地址')
  await tick(10)
  assert.equal(host.clipboard.text, 'http://192.168.1.20:8765')
  assert.equal(host.lastToast().style, Toast.Style.Success)
  assert.equal(host.lastToast().title, '已复制访问地址')
  assert.deepEqual(rejections, [])
  view.unmount()
})

test('复制下载地址：地址与客户端共享网页的下载链接一致', async () => {
  const view = await mountRunning()
  await view.run(view.item('lan-file-id1'), '复制下载地址')
  await tick(10)
  assert.equal(host.clipboard.text, 'http://192.168.1.20:8765/download/id1/a.txt')
  assert.equal(host.lastToast().title, '已复制下载地址')
  view.unmount()
})

test('[故障] 复制访问地址：宿主拒绝写入时提示「复制失败」与原因，不提示成功、无未处理 rejection', async () => {
  const view = await mountRunning()
  host.clipboard.text = 'SENTINEL'
  const restore = failClipboard(Object.assign(new Error('剪贴板被其他程序占用'), { name: 'HostMethodError', code: 'CLIPBOARD_BUSY' }))
  try {
    await view.run(view.item('lan-service'), '复制访问地址')
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

test('[故障] 复制下载地址：宿主抛出非 Error 值时提示失败并带原因', async () => {
  const view = await mountRunning()
  const restore = failClipboard('IPC 管道已断开')
  try {
    await view.run(view.item('lan-file-id1'), '复制下载地址')
    await tick(10)
  } finally {
    restore()
  }
  assert.equal(host.toasts.length, 1)
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.equal(host.lastToast().message, 'IPC 管道已断开')
  assert.deepEqual(rejections, [])
  view.unmount()
})

test('[边界] 服务未运行时不提供复制地址，文件行也没有下载地址', async () => {
  const state = installLanHost(host)
  state.files.set('id1', { id: 'id1', name: 'a.txt', path: 'D:\\Share\\a.txt', size: 10, sizeBytes: 10, shared: true, isDirectory: false })
  const view = await mount(LanShareCommand)
  await tick(20)
  const titles = view.actions(view.item('lan-service')).map((a) => a.props.title)
  assert.deepEqual(titles, ['启动共享服务'])
  const fileTitles = view.actions(view.item('lan-file-id1')).map((a) => a.props.title)
  assert.equal(fileTitles.includes('复制下载地址'), false)
  assert.equal(/http:\/\//.test(view.tree().props.filterBar.summaryText), false)
  view.unmount()
})
