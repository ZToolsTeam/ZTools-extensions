// 复制内网地址的集成测试：真实声明式运行时 + 测试宿主剪贴板（可注入写入失败）
// 顶栏「复制内网主页地址」按钮由宿主直接调用、不兜底 rejected promise，必须由插件自己提示失败
// 覆盖：写入成功才提示「已复制…」；宿主拒绝写入时提示「复制失败」与原因，不提示成功、不留下未处理的 rejection
import test from 'node:test'
import assert from 'node:assert/strict'
import { getDeclarativeBridge, Toast } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
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

/** 按宿主 ListRenderer 的方式点击顶栏按钮：直接调用 onAction()，不 await、不 catch */
async function clickFilterBar(view, id) {
  const action = view.tree().props.filterBar.actions.find((a) => a.id === id)
  assert.ok(action, `顶栏缺少按钮 ${id}`)
  action.onAction()
  await tick(10)
}

const portalItem = (view) => view.item('lan-portal-entry')
const portalUrlOf = (view) => view.tree().props.filterBar.summaryText.match(/https?:\/\/\S+/)[0]

test('顶栏复制内网主页地址：写入成功后才提示「已复制内网访问地址」', async () => {
  const view = await mount(LanShareCommand)
  await tick(20)
  host.toasts.length = 0
  await clickFilterBar(view, 'copy-portal')
  assert.equal(host.clipboard.text, portalUrlOf(view))
  assert.equal(host.lastToast().style, Toast.Style.Success)
  assert.equal(host.lastToast().title, '已复制内网访问地址')
  assert.deepEqual(rejections, [])
  view.unmount()
})

test('[故障] 顶栏复制内网主页地址：宿主拒绝写入时提示「复制失败」与原因，不提示成功、无未处理 rejection', async () => {
  const view = await mount(LanShareCommand)
  await tick(20)
  host.clipboard.text = 'SENTINEL'
  host.toasts.length = 0
  const restore = failClipboard(Object.assign(new Error('剪贴板被其他程序占用'), { name: 'HostMethodError', code: 'CLIPBOARD_BUSY' }))
  try {
    await clickFilterBar(view, 'copy-portal')
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

test('复制局域网直连下载 URL：成功提示成功；宿主抛出非 Error 值时提示失败并带原因', async () => {
  const view = await mount(LanShareCommand)
  await tick(20)
  host.toasts.length = 0
  await view.run(portalItem(view), '复制局域网直连下载 URL')
  assert.match(host.clipboard.text, /^https?:\/\//)
  assert.equal(host.lastToast().style, Toast.Style.Success)
  assert.equal(host.lastToast().title, '已复制内网直连链接')

  host.toasts.length = 0
  const restore = failClipboard('IPC 管道已断开')
  try {
    await view.run(portalItem(view), '复制局域网直连下载 URL')
  } finally {
    restore()
  }
  assert.equal(host.toasts.length, 1)
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.equal(host.lastToast().title, '复制失败')
  assert.equal(host.lastToast().message, 'IPC 管道已断开')
  assert.deepEqual(rejections, [])
  view.unmount()
})
