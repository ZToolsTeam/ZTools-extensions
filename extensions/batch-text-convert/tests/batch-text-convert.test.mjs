import test from 'node:test'
import assert from 'node:assert/strict'
import {
  toUnicodeEscape,
  fromUnicodeEscape,
  toUtf8Hex,
  toBase64,
  convertTextToAllEncodings
} from '../dist/logic.js'

test('BatchTextConvert 编码转换与互逆性测试', () => {
  const original = '你好'

  // 1. Unicode 转义与还原
  const escaped = toUnicodeEscape(original)
  assert.equal(escaped, '\\u4f60\\u597d')
  assert.equal(fromUnicodeEscape(escaped), original)

  // 2. Base64
  const b64 = toBase64(original)
  assert.ok(b64.length > 0)

  // 3. 多格式组合
  const results = convertTextToAllEncodings('Hello')
  assert.equal(results.length, 4)
  assert.ok(results.some(r => r.id === 'unicode-escape'))
  assert.ok(results.some(r => r.id === 'base64'))
})

test('BatchTextConvert 边界与极端输入测试', () => {
  // 1. 空输入
  assert.deepEqual(convertTextToAllEncodings(''), [])

  // 2. 纯 ASCII
  const ascii = toUnicodeEscape('ABC 123')
  assert.equal(ascii, 'ABC 123', 'ASCII 字符不应被不必要转义')

  // 3. 特殊字符与 Emoji
  const special = convertTextToAllEncodings('🚀 符号')
  assert.ok(special.length > 0)
})
