import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
  getRescueActions,
  getFullRescueScript
} from '../dist/logic.js'

const require = createRequire(import.meta.url)
const Command = require('../dist/index.js').default

test('NetworkRescue 声明式视图渲染与 Shell 故障注入测试', async () => {
  const view = Command()
  assert.ok(view, '应返回声明式视图描述符')
  assert.equal(view.type, 'List')
  const section = view.children[0]
  assert.equal(section.type, 'List.Section')
  assert.ok(section.children.length >= 5, '应渲染全部预设急救动作项')

  const firstItem = section.children[0]
  assert.equal(firstItem.type, 'List.Item')
  assert.ok(firstItem.props.actions, '每个列表项必须挂载 ActionPanel')

  // 触发底层 Shell 执行失败异常注入，验证不崩溃自愈
  globalThis.ztools = {
    shell: {
      exec: async () => {
        throw new Error('ACCESS_DENIED_ELEVATION_REQUIRED')
      }
    }
  }
  try {
    const primaryAction = firstItem.props.actions.children[0]
    await assert.doesNotReject(async () => {
      await primaryAction.props.onAction()
    })
  } finally {
    delete globalThis.ztools
  }
})

test('NetworkRescue 命令与权限属性测试', () => {
  const actions = getRescueActions()
  assert.ok(actions.length >= 5, '应提供至少5项急救命令')

  const dns = actions.find(a => a.id === 'flush-dns')
  assert.ok(dns)
  assert.equal(dns.command, 'ipconfig /flushdns')
  assert.equal(dns.requiresAdmin, false)

  const winsock = actions.find(a => a.id === 'reset-winsock')
  assert.ok(winsock)
  assert.equal(winsock.command, 'netsh winsock reset')
  assert.equal(winsock.requiresAdmin, true)
})

test('NetworkRescue 一键全面急救脚本测试', () => {
  const script = getFullRescueScript()
  assert.ok(script.includes('ipconfig /flushdns'))
  assert.ok(script.includes('netsh winsock reset'))
  assert.ok(script.includes('ipconfig /release'))
  assert.ok(script.includes('ipconfig /renew'))
})
