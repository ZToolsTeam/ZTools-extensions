import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import Command, { genUuid, cipherAes } from '../dist/index.js'
import { encodeText, decodeText, generateUuids } from '../dist/codecs.js'
const host = createHost()
test.beforeEach(() => host.reset())

test('URL/Unicode/UTF-8 Hex 可往返中文与非 BMP；异常编码明确失败', () => {
  for (const mode of ['url', 'unicode', 'hex']) for (const text of ['hello', '中文😀', '', '\n\\u1234']) assert.equal(decodeText(encodeText(text, mode), mode), text)
  for (const [text, mode] of [['%FF', 'url'], ['%xx', 'url'], ['\\uXYZ1', 'unicode'], ['123', 'hex'], ['gg', 'hex'], ['ff', 'hex']]) assert.throws(() => decodeText(text, mode))
})

test('URL 深链进入编解码模式，UUID 子命令生成可复制的 v4 批量结果', async () => {
  globalThis.window.__ztoolsLaunchContext = { featureCode: 'codec-url' }
  const view = await mount(Command)
  try {
    await view.search('%E4%B8%AD')
    assert.equal(view.item('decode').props.title, '中')
    await view.run(view.item('decode'), '复制')
    assert.equal(host.clipboard.text, '中')
  } finally { view.unmount(); delete globalThis.window.__ztoolsLaunchContext }
  const uuidView = await mount(genUuid)
  try {
    await uuidView.search('10'); await uuidView.run(uuidView.item('uuid-result'), '生成 UUID')
    await uuidView.run(uuidView.item('uuid-result'), '复制全部 UUID')
    const list = host.clipboard.text.split('\n')
    assert.equal(list.length, 10); assert.equal(new Set(list).size, 10)
    list.forEach(id => assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/))
    await uuidView.search('0'); await uuidView.run(uuidView.item('uuid-result'), '生成 UUID')
    assert.equal(uuidView.actions(uuidView.item('uuid-result')).some(a => a.props.title === '复制全部 UUID'), false)
    assert.match(host.lastToast().title, /失败/)
  } finally { uuidView.unmount() }
})

test('UUID 数量边界及随机源失败都不产生伪随机结果', () => {
  assert.equal(generateUuids('1000').length, 1000)
  for (const count of ['0', '-1', '1.5', '1001', '1e2', '']) assert.throws(() => generateUuids(count))
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  try { Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} }); assert.throws(() => generateUuids('1'), /安全随机数/) }
  finally { Object.defineProperty(globalThis, 'crypto', descriptor) }
})

test('AES 在途输入变化与卸载后不发布旧结果或成功提示', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  const real = webcrypto.subtle
  let release
  const gate = new Promise(resolve => { release = resolve })
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { subtle: {
    importKey: (...args) => real.importKey(...args), encrypt: async (...args) => { await gate; return real.encrypt(...args) }, decrypt: (...args) => real.decrypt(...args)
  } } })
  host.pushed.push(cipherAes)
  const form = await mountPushed(host)
  try {
    await form.fill('text', '旧内容'); await form.fill('key', 'test-password')
    const pending = form.actions(null).find(a => a.props.onSubmit).props.onSubmit({})
    await form.fill('text', '新内容')
    release(); await pending; await tick()
    assert.ok(!form.actions(null).some(a => a.props.title === '复制结果'))
    assert.ok(!host.toasts.some(t => t.title === '加密完成'))
    await form.run(null, '加密')
    assert.ok(form.actions(null).some(a => a.props.title === '复制结果'))
    host.toasts.length = 0
    const second = form.actions(null).find(a => a.props.onSubmit).props.onSubmit({})
    form.unmount(); await second
    assert.equal(host.toasts.length, 0)
  } finally { release(); form.unmount(); Object.defineProperty(globalThis, 'crypto', descriptor) }
})
