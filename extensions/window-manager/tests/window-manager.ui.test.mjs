import test from 'node:test'
import assert from 'node:assert/strict'
import { Toast } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import WindowManagementCommand, { WINDOW_ACTIONS } from '../dist/index.js'

const host = createHost()
test.beforeEach(() => {
  host.reset()
  host.ipc.window_manage_list_actions = async () => WINDOW_ACTIONS.filter(action => action.id !== 'restore').map(action => ({ name: action.id }))
})

test('窗口列表：宿主拒绝执行时显示失败原因，绝不静默报成功', async () => {
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

test('窗口列表只展示宿主支持动作，没有无法兑现的偏好与虚构快捷键', async () => {
  host.ipc.window_manage_list_actions = async () => [{ name: 'left-half' }, { name: 'top-left' }, { name: 'next-display' }, { name: 'center-half' }]
  const view = await mount(WindowManagementCommand)
  try {
    assert.deepEqual(view.items().map(item => item.props.id), ['left-half', 'top-left', 'next-display'])
    for (const item of view.items()) assert.equal(view.actions(item).length, 1)
    assert.doesNotMatch(JSON.stringify(view.tree()), /边距|快捷键|sixths|center-half/)
  } finally { view.unmount() }
})

test('动作清单失败时不显示全部；重新读取成功后恢复列表', async () => {
  host.ipc.window_manage_list_actions = async () => { throw new Error('原生接口不可用') }
  const view = await mount(WindowManagementCommand)
  try {
    assert.deepEqual(view.items().map(item => item.props.id), ['no-actions'])
    assert.match(view.tree().props.filterBar.summaryText, /原生接口不可用/)
    host.ipc.window_manage_list_actions = async () => [{ name: 'right-half' }]
    await view.tree().props.filterBar.actions[0].onAction()
    await tick()
    assert.deepEqual(view.items().map(item => item.props.id), ['right-half'])
  } finally { view.unmount() }
})
