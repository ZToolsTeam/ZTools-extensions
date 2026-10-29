import test from 'node:test'
import assert from 'node:assert/strict'
import { Toast, getComponentFactory } from '@ztools/declarative-ui'
import { createHost, mount } from '../../shared/test-harness.mjs'
import WindowManagementCommand from '../dist/index.js'

const host = createHost()
test.beforeEach(() => host.reset())

test('窗口列表：原生进程不可用时显示失败原因，不静默吞掉执行结果', async () => {
  host.ipc.window_manage_action = async () => ({ success: false, error: 'UIAccess sidecar is not running' })
  const view = await mount(WindowManagementCommand)
  try {
    await view.run(view.item('left-half'), '执行 左半屏 (Left Half)')
    assert.equal(host.lastToast().style, Toast.Style.Failure)
    assert.equal(host.lastToast().title, '窗口操作失败')
    assert.match(host.lastToast().message, /UIAccess sidecar is not running/)
    assert.deepEqual(host.ipcCalls.find(([m]) => m === 'window_manage_action')[1], { action: 'left-half' })
  } finally { view.unmount() }
})

test('窗口详情：宿主拒绝动作时同样显示真实失败原因', async () => {
  host.ipc.window_manage_action = async () => ({ success: false, error: '不支持的窗口调度动作' })
  const view = await mount(WindowManagementCommand)
  let detail
  try {
    const target = view.actions(view.item('left-half')).find(a => a.props.title === '全屏查看动作详情与底层说明').props.target
    detail = await mount(getComponentFactory(target) || (() => target))
    await detail.run(null, '立即执行: 左半屏 (Left Half)')
    assert.equal(host.lastToast().style, Toast.Style.Failure)
    assert.match(host.lastToast().message, /不支持的窗口调度动作/)
  } finally { detail?.unmount(); view.unmount() }
})
