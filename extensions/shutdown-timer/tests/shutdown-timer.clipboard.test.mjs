// 复制系统命令的集成测试：真实声明式运行时 + 测试宿主剪贴板（可注入写入失败）
// 覆盖：写入成功才提示「已复制命令」；宿主拒绝写入时提示「复制失败」与原因，不提示成功、不留下未处理的 rejection
import test from 'node:test'
import assert from 'node:assert/strict'
import { getDeclarativeBridge, Toast } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import ShutdownTimerCommand from '../dist/index.js'
import { getCommandForAction, getQuickScheduleOptions } from '../dist/logic.js'

const host = createHost()
const rejections = []
process.on('unhandledRejection', (reason) => rejections.push(reason))
const COPY = '复制系统命令'

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

const first = getQuickScheduleOptions()[0]
const expectedCmd = getCommandForAction(first.action, first.seconds)
const firstItem = (view) => view.item((it) => it.props.title === first.title)

test('复制系统命令：写入成功后才提示「已复制命令」，内容为该电源动作的命令', async () => {
  const view = await mount(ShutdownTimerCommand)
  await view.run(firstItem(view), COPY)
  await tick(10)
  assert.equal(host.clipboard.text, expectedCmd)
  assert.equal(host.lastToast().style, Toast.Style.Success)
  assert.equal(host.lastToast().title, '已复制命令')
  assert.equal(host.lastToast().message, expectedCmd)
  assert.deepEqual(rejections, [])
  view.unmount()
})

test('[故障] 宿主拒绝写入时提示「复制失败」与原因，不提示成功、无未处理 rejection', async () => {
  const view = await mount(ShutdownTimerCommand)
  host.clipboard.text = 'SENTINEL'
  host.toasts.length = 0
  const restore = failClipboard(Object.assign(new Error('剪贴板被其他程序占用'), { name: 'HostMethodError', code: 'CLIPBOARD_BUSY' }))
  try {
    await view.run(firstItem(view), COPY)
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
    await view.run(firstItem(view), COPY)
    await tick(10)
  } finally {
    restore()
  }
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.equal(host.lastToast().message, 'IPC 管道已断开')
  assert.deepEqual(rejections, [])
  view.unmount()
})
