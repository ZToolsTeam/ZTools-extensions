import test from 'node:test'
import assert from 'node:assert/strict'
import { encryptVaultEntries, decryptVaultEntries, createVaultEntry, validateMasterPassword, PBKDF2_ITERATIONS } from '../dist/index.js'

const entry = () => createVaultEntry({ title: '测试凭据', category: 'login', username: 'fixture', secretPlain: 'not-a-real-secret' })

/** 按升级前的第 1 版格式加密：PBKDF2-SHA256 固定 10 万次，信封不记录迭代次数 */
async function legacyEnvelope(password, entries) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12))
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt'])
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, new TextEncoder().encode(JSON.stringify({ magic: 'ZTOOLS_VAULT_V1', entries })))
  const b64 = bytes => Buffer.from(bytes).toString('base64')
  return { version: 1, saltBase64: b64(salt), ivBase64: b64(iv), cipherTextBase64: b64(new Uint8Array(cipher)) }
}

test('新密文使用第 2 版信封并记录 60 万次迭代，可正常解密', async () => {
  const envelope = await encryptVaultEntries('new-passphrase', [entry()])
  assert.equal(envelope.version, 2)
  assert.equal(envelope.kdfIterations, 600000)
  assert.equal(PBKDF2_ITERATIONS, 600000)
  assert.equal((await decryptVaultEntries('new-passphrase', envelope))[0].title, '测试凭据')
})

test('升级前的第 1 版密文（10 万次、6 位主密码）仍能解密，保存后升级为第 2 版', async () => {
  const legacy = await legacyEnvelope('abc123', [entry()])
  const entries = await decryptVaultEntries('abc123', legacy)
  assert.equal(entries[0].title, '测试凭据')
  const upgraded = await encryptVaultEntries('abc123', entries)
  assert.equal(upgraded.version, 2)
  assert.equal((await decryptVaultEntries('abc123', upgraded))[0].title, '测试凭据')
  await assert.rejects(decryptVaultEntries('wrong-pass', legacy), /主密码错误|已被篡改/)
})

test('[破坏性] 第 2 版信封的迭代次数缺失、过小、过大或非整数一律视为损坏，不尝试解密', async () => {
  const envelope = await encryptVaultEntries('new-passphrase', [entry()])
  for (const kdfIterations of [undefined, 0, 1000, 99999, 5000001, 600000.5, '600000']) {
    await assert.rejects(decryptVaultEntries('new-passphrase', { ...envelope, kdfIterations }), /密钥派生参数非法/, String(kdfIterations))
  }
  await assert.rejects(decryptVaultEntries('new-passphrase', { ...envelope, version: 3 }), /数据结构不完整或已损坏/)
})

test('新建保险箱的主密码至少 8 位；已有保险箱沿用 6 位规则', () => {
  assert.equal(validateMasterPassword('1234567', { isNewVault: true }).valid, false)
  assert.match(validateMasterPassword('1234567', { isNewVault: true }).error, /至少需要 8 位/)
  assert.equal(validateMasterPassword('12345678', { isNewVault: true }).valid, true)
  assert.equal(validateMasterPassword('abc123').valid, true)
  assert.equal(validateMasterPassword('abc12').valid, false)
})
