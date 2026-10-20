import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createHost, mount, mountPushed } from '../../shared/test-harness.mjs'
import CryptoToolCommand from '../dist/index.js'
import { calculateMultiHash, encodeBase64, decodeBase64, aesEncrypt, aesDecrypt, calculateHmac } from '../dist/logic.js'

const host = createHost()
test.beforeEach(() => host.reset())

test('摘要与 HMAC 与 Node 标准实现逐字节一致（含中文、Emoji、空串）', () => {
  for (const text of ['', 'abc', '中文😀', 'x'.repeat(1000)]) {
    const h = calculateMultiHash(text)
    for (const alg of ['md5', 'sha1', 'sha256', 'sha512']) {
      assert.equal(h[alg], crypto.createHash(alg).update(text, 'utf8').digest('hex'), `${alg}(${text.slice(0, 8)})`)
      assert.equal(calculateHmac(alg, text, 'k'), crypto.createHmac(alg, 'k').update(text, 'utf8').digest('hex'))
    }
    assert.equal(h.base64, Buffer.from(text, 'utf8').toString('base64'))
  }
})

test('AES-256-CBC 与 Node 标准实现一致，可互相解密', async () => {
  const key = 'master-key'
  const kb = crypto.createHash('sha256').update(key).digest()
  const c = crypto.createCipheriv('aes-256-cbc', kb, kb.subarray(0, 16))
  const expected = c.update('机密内容', 'utf8', 'base64') + c.final('base64')
  const enc = await aesEncrypt('机密内容', key)
  assert.equal(enc.result, expected)
  assert.equal((await aesDecrypt(expected, key)).result, '机密内容')
})

test('[篡改] 口令错误、密文损坏、格式非法时拒绝，不输出乱码', async () => {
  const enc = await aesEncrypt('sensitive', 'right')
  assert.equal((await aesDecrypt(enc.result, 'wrong')).success, false)
  const tampered = Buffer.from(enc.result, 'base64')
  tampered[tampered.length - 1] ^= 1
  assert.equal((await aesDecrypt(tampered.toString('base64'), 'right')).success, false)
  for (const bad of ['', '!!!', 'AAAA', 'abc']) assert.equal((await aesDecrypt(bad, 'right')).success, false)
  assert.equal((await aesEncrypt('x', '')).success, false)
})

test('Base64 解码严格校验：非法字符报错，二进制数据不当作文本显示', () => {
  assert.equal(decodeBase64(encodeBase64('极客效率')).result, '极客效率')
  assert.equal(decodeBase64('!!!not-base64!!!').success, false)
  assert.equal(decodeBase64(Buffer.from([0xff, 0xfe, 0x00]).toString('base64')).success, false)
  assert.equal(decodeBase64('5p6B5a6i').result, '极客')
})

test('界面：打开不再崩溃；默认为空；输入后显示正确的 SHA-256 并可复制', async () => {
  const view = await mount(CryptoToolCommand)
  assert.equal(view.tree().props.searchText, '')
  await view.search('abc')
  const sha = view.item('sha256')
  assert.equal(sha.props.title, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  await view.run(sha, '复制')
  assert.equal(host.clipboard.text, sha.props.title)
})

test('界面：AES 表单加密后可解密回原文', async () => {
  const view = await mount(CryptoToolCommand)
  await view.run(null, 'AES 加解密…')
  const form = await mountPushed(host)
  await form.fill('text', 'hello')
  await form.fill('key', 'pw')
  await form.run(null, '加密')
  const expected = (await aesEncrypt('hello', 'pw')).result
  const result = () => form.tree().children.find((c) => c.type === 'Form.Description').props.text
  assert.equal(result(), expected)
  await form.fill('direction', 'decrypt')
  await form.fill('text', expected)
  await form.run(null, '解密')
  assert.equal(result(), 'hello')
  await form.fill('key', 'wrong')
  await form.run(null, '解密')
  assert.notEqual(result(), 'hello')
  assert.match(String(host.lastToast().title), /解密失败/)
})
