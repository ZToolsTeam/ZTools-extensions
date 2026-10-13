import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getRescueActions,
  getFullRescueScript
} from '../dist/logic.js'

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
