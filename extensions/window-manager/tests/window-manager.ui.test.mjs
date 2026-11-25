import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Toast } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import WindowManagementCommand, { WINDOW_ACTIONS, commands } from '../dist/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin.json'), 'utf8'))

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
    assert.match(host.lastToast().message, /窗口操作未获宿主确认/)
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

test('高频直达命令：plugin.json 声明 5 个 no-view 入口并与 en-US 同步，执行成功返回 HUD 文案', async () => {
  const directCodes = [
    ['win-left-half', 'left-half'],
    ['win-right-half', 'right-half'],
    ['win-maximize', 'maximize'],
    ['win-center', 'center'],
    ['win-next-display', 'next-display']
  ]
  for (const [code, actionId] of directCodes) {
    const feature = manifest.features.find(f => f.code === code)
    assert.ok(feature, `缺少 feature: ${code}`)
    assert.equal(feature.mode, 'no-view')
    assert.ok(manifest.i18n['en-US'].features[code], `缺少 en-US 翻译: ${code}`)

    host.reset()
    host.ipc.window_manage_action = async (payload) => {
      assert.deepEqual(payload, { action: actionId })
      return { success: true }
    }
    const msg = await commands[code]()
    assert.match(msg, /已调整/)
  }
})

test('高频直达命令：宿主拒绝时抛错并弹失败 Toast，绝不静默报成功', async () => {
  host.ipc.window_manage_action = async () => ({ success: false, error: '当前无活动窗口' })
  await assert.rejects(commands['win-maximize'](), /当前无活动窗口/)
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.equal(host.lastToast().title, '窗口操作失败')
})

test('featureCode 视图兼容：win-display 默认筛选显示器，win-center 挂载时自动触发一次居中', async () => {
  const executed = []
  host.ipc.window_manage_action = async (payload) => {
    executed.push(payload.action)
    return { success: true }
  }
  const displayView = await mount(commands['win-display'])
  try {
    assert.deepEqual(displayView.items().map(item => item.props.id), ['next-display', 'previous-display'])
  } finally { displayView.unmount() }

  const directView = await mount(() => WindowManagementCommand({ featureCode: 'win-center' }))
  try {
    await tick()
    assert.deepEqual(executed, ['center'])
    assert.ok(directView.items().length > 1, '仍保留完整列表视图')
  } finally { directView.unmount() }
})
