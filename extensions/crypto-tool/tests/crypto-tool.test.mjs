import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Command = require('../dist/index.js').default
const logic = require('../dist/logic.js')

test('crypto-tool 声明式视图渲染与多算法哈希/AES 加解密集成测试', () => {
  const view = Command()
  assert.ok(view && view.type === 'List')
  const hashes = logic.calculateMultiHash('ztools-2026')
  assert.equal(hashes.sha256.length, 64)
  const b64 = logic.encodeBase64('极客效率')
  const decB64 = logic.decodeBase64(b64)
  assert.equal(decB64.success, true)
  assert.equal(decB64.result, '极客效率')
  const enc = logic.aesEncrypt('secret-payload', 'master-key')
  assert.equal(enc.success, true)
  const dec = logic.aesDecrypt(enc.result, 'master-key')
  assert.equal(dec.success, true)
  assert.equal(dec.result, 'secret-payload')
})

test('crypto-tool 错误密钥解密与畸形密文拦截测试 (Beyond Happy Path)', () => {
  const enc = logic.aesEncrypt('sensitive-data', 'correct-key')
  const wrongKeyRes = logic.aesDecrypt(enc.result, 'wrong-key')
  assert.equal(wrongKeyRes.success, false)
  assert.ok(wrongKeyRes.error)
  const corruptedRes = logic.aesDecrypt('corrupted:payload:data', 'correct-key')
  assert.equal(corruptedRes.success, false)
  const emptyRes = logic.aesDecrypt('', 'correct-key')
  assert.equal(emptyRes.success, false)
  const badB64 = logic.decodeBase64('!!!not-base64!!!')
  assert.equal(badB64.success, false)
})
