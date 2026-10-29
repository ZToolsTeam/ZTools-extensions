import test from 'node:test'
import assert from 'node:assert/strict'
import { generateSecurePassword } from '../dist/vault-crypto.js'

test('随机密码：长度夹在 8–64，四类字符齐全，不含易混淆字符', () => {
  for (const [len, expected] of [[20, 20], [3, 8], [999, 64], ['x', 20]]) {
    const pwd = generateSecurePassword(len, true)
    assert.equal(pwd.length, expected)
    assert.match(pwd, /[A-Z]/); assert.match(pwd, /[a-z]/); assert.match(pwd, /[2-9]/); assert.match(pwd, /[!@#$%^&*()\-_=+[\]{}]/)
    assert.doesNotMatch(pwd, /[0O1lI]/)
  }
  assert.doesNotMatch(generateSecurePassword(64, false), /[!@#$%^&*()\-_=+[\]{}]/)
})

test('随机密码：字符分布无取模偏差（原实现前 31 个字符出现概率高约 25%）', () => {
  const counts = new Map()
  let total = 0
  for (let i = 0; i < 4000; i++) for (const ch of generateSecurePassword(64, true)) { counts.set(ch, (counts.get(ch) || 0) + 1); total++ }
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()-_=+[]{}'
  assert.equal(counts.size, charset.length)
  // 前 31 个与后 44 个字符的平均频率之比；有偏实现约 1.25，无偏约 1.0（类别保底会略微抬高数字与符号）
  const avg = (chars) => [...chars].reduce((s, c) => s + counts.get(c), 0) / chars.length
  const ratio = avg(charset.slice(0, 31)) / avg(charset.slice(31))
  assert.ok(ratio < 1.1, `前段字符频率偏高：${ratio.toFixed(3)}`)
})

test('随机源不可用时拒绝生成，不退回 Math.random', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true })
  try { assert.throws(() => generateSecurePassword(20), /VAULT_CRYPTO_UNAVAILABLE/) }
  finally { Object.defineProperty(globalThis, 'crypto', original) }
})
