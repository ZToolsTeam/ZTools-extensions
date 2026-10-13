import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseHosts,
  stringifyHosts,
  toggleRule,
  addRule,
  deleteRule
} from '../dist/logic.js'

test('Hosts 集成与边界测试 - 正常解析与序列化', () => {
  const sample = `
# 测试 Hosts
127.0.0.1 localhost myhost.local # 本地主机
::1 localhost
# 192.168.1.100 test.server.internal
`
  const rules = parseHosts(sample)
  assert.ok(rules.length >= 3, '应解析出至少3条域名规则')

  const myhost = rules.find(r => r.domain === 'myhost.local')
  assert.ok(myhost, '应包含 myhost.local')
  assert.equal(myhost.enabled, true)
  assert.equal(myhost.ip, '127.0.0.1')
  assert.equal(myhost.comment, '本地主机')

  const disabled = rules.find(r => r.domain === 'test.server.internal')
  assert.ok(disabled, '应解析出被注释禁用的规则')
  assert.equal(disabled.enabled, false)

  // 序列化回文本
  const serialized = stringifyHosts(rules)
  assert.ok(serialized.includes('127.0.0.1 myhost.local # 本地主机'))
  assert.ok(serialized.includes('# 192.168.1.100 test.server.internal'))
})

test('Hosts 交互与状态变更测试', () => {
  let rules = parseHosts('127.0.0.1 foo.bar')
  assert.equal(rules[0].enabled, true)

  // 切换禁用
  rules = toggleRule(rules, rules[0].id)
  assert.equal(rules[0].enabled, false)

  // 切换启用
  rules = toggleRule(rules, rules[0].id)
  assert.equal(rules[0].enabled, true)

  // 新增规则
  rules = addRule(rules, '10.0.0.1', 'intranet.corp', '内网入口')
  assert.equal(rules.length, 2)
  assert.equal(rules[0].domain, 'intranet.corp')

  // 删除规则
  rules = deleteRule(rules, rules[0].id)
  assert.equal(rules.length, 1)
  assert.equal(rules[0].domain, 'foo.bar')
})

test('Hosts 破坏性异常边界测试', () => {
  // 1. 空内容
  assert.deepEqual(parseHosts(''), [])
  assert.deepEqual(parseHosts('   \n\n  \t\n'), [])

  // 2. 纯注释与无效行
  const commentOnly = parseHosts('# 纯注释\n# 没有 IP 域名\n# 1234')
  assert.deepEqual(commentOnly, [])

  // 3. 畸形非法行
  const malformed = parseHosts('invalid_line_without_domain\n127.0.0.1')
  assert.deepEqual(malformed, [])

  // 4. 删除不存在的 ID
  const rules = parseHosts('127.0.0.1 a.com')
  const untouched = deleteRule(rules, 'non-existent-id')
  assert.equal(untouched.length, 1)

  // 5. 切换不存在的 ID
  const toggled = toggleRule(rules, 'non-existent-id')
  assert.equal(toggled[0].enabled, true)
})
