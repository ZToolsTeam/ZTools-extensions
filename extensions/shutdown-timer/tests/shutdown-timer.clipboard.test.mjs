// 界面集成测试：真实声明式运行时 + 模拟客户端（剪贴板、确认框、提示、客户端通道均可注入结果或故障）
// 覆盖：复制命令写入成功才提示成功、失败提示原因；定时关机取消确认时不调用客户端、确认后调用；客户端失败提示原因
import test from 'node:test'
import assert from 'node:assert/strict'
import { getDeclarativeBridge, Toast } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import ShutdownTimerCommand from '../dist/index.js'
import { CANCEL_COMMAND, getCommandForAction } from '../dist/logic.js'

const host = createHost()
const rejections = []
process.on('unhandledRejection', (reason) => rejections.push(reason))

let transportCalls = []
let transportFault = null

test.beforeEach(() => {
  host.reset()
  rejections.length = 0
  transportCalls = []
  transportFault = null
  getDeclarativeBridge().hostTransport = {
    async call(method, params) {
      transportCalls.push([method, params])
      if (transportFault) throw transportFault
      return { success: true, action: method }
    }
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

test('列表不使用颜色，没有定时重启', async () => {
  const view = await mount(ShutdownTimerCommand)
  const text = view.text()
  assert.equal(/tintColor|"color"/.test(text), false)
  assert.equal(/重启/.test(text), false)
  view.unmount()
})

test('取消关机计划：复制取消命令，写入成功后才提示成功', async () => {
  const view = await mount(ShutdownTimerCommand)
  await view.run(view.item('cancel-task'), '复制取消命令')
  await tick(10)
  assert.equal(host.clipboard.text, CANCEL_COMMAND)
  assert.equal(host.lastToast().style, Toast.Style.Success)
  assert.equal(host.lastToast().title, '已复制取消命令')
  assert.equal(transportCalls.length, 0)
  assert.deepEqual(rejections, [])
  view.unmount()
})

test('[故障] 复制命令：宿主拒绝写入时提示「复制失败」与原因，不提示成功、无未处理 rejection', async () => {
  const view = await mount(ShutdownTimerCommand)
  host.clipboard.text = 'SENTINEL'
  host.toasts.length = 0
  const restore = failClipboard(Object.assign(new Error('剪贴板被其他程序占用'), { name: 'HostMethodError', code: 'CLIPBOARD_BUSY' }))
  try {
    await view.run(view.item('shutdown-10m'), '复制等价命令')
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

test('[故障] 宿主抛出非 Error 值（IPC 管道断开）时同样提示失败并带原因', async () => {
  const view = await mount(ShutdownTimerCommand)
  host.toasts.length = 0
  const restore = failClipboard('IPC 管道已断开')
  try {
    await view.run(view.item('cancel-task'), '复制取消命令')
    await tick(10)
  } finally {
    restore()
  }
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.equal(host.lastToast().message, 'IPC 管道已断开')
  assert.deepEqual(rejections, [])
  view.unmount()
})

test('复制等价命令：内容为该倒计时的关机命令', async () => {
  const view = await mount(ShutdownTimerCommand)
  await view.run(view.item('shutdown-30m'), '复制等价命令')
  await tick(10)
  assert.equal(host.clipboard.text, getCommandForAction('shutdown', 1800))
  view.unmount()
})

test('定时关机：用户取消确认时不调用客户端', async () => {
  host.setConfirm(false)
  const view = await mount(ShutdownTimerCommand)
  await view.run(view.item('shutdown-10m'), '设定定时关机（需确认）')
  await tick(10)
  assert.equal(host.confirms.length, 1)
  assert.equal(transportCalls.length, 0)
  assert.equal(host.lastToast().title, '已取消')
  view.unmount()
})

test('定时关机：确认后调用客户端并提示预计时间与取消方法', async () => {
  host.setConfirm(true)
  const view = await mount(ShutdownTimerCommand)
  await view.run(view.item('shutdown-10m'), '设定定时关机（需确认）')
  await tick(10)
  assert.deepEqual(transportCalls, [['system_shutdown', { force: false, timeout: 600 }]])
  assert.equal(host.lastToast().style, Toast.Style.Success)
  assert.equal(host.lastToast().title, '已设定 10 分钟后关机')
  assert.match(host.lastToast().message, /shutdown\.exe \/a/)
  view.unmount()
})

test('[故障] 锁屏：客户端报错时提示失败原因，不提示成功', async () => {
  transportFault = Object.assign(new Error('系统电源操作失败'), { code: 'PROCESS_ERROR' })
  const view = await mount(ShutdownTimerCommand)
  await view.run(view.item('immediate-lock'), '立即锁定屏幕')
  await tick(10)
  assert.equal(host.confirms.length, 0)
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.equal(host.lastToast().message, '系统电源操作失败')
  assert.deepEqual(rejections, [])
  view.unmount()
})
