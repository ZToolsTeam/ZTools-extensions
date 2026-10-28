import test from 'node:test'
import assert from 'node:assert/strict'
import { getDeclarativeBridge } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import Vault, { encryptVaultEntries, decryptVaultEntries, createVaultEntry } from '../dist/index.js'

const key = 'ztools.password-vault.envelope.v1'
const password = 'audit-only-passphrase'
let host
test.beforeEach(() => { host = createHost() })

function field(view, id) {
  function visit(value) {
    if (!value || typeof value !== 'object') return undefined
    if (value.props?.id === id) return value
    for (const child of Object.values(value)) {
      const found = visit(child)
      if (found) return found
    }
  }
  const found = visit(view.tree())
  assert.ok(found, `缺少表单字段 ${id}`)
  return found
}

async function fillPassword(view, value = password) {
  field(view, 'masterPassword').props.onChange(value)
  await tick()
}

function seed(value) {
  const stored = JSON.stringify(value)
  host.storage.set(key, stored)
  return stored
}

test('损坏、空值和未知版本一律保留原数据，不提供初始化动作', async () => {
  for (const raw of ['{broken', '', 'null', 'false', '0', '[]', '{}', null, false, 0,
    { version: 2, saltBase64: 'a', ivBase64: 'b', cipherTextBase64: 'c' }]) {
    const original = seed(raw)
    const view = await mount(Vault)
    try {
      assert.match(view.text(), /保险箱暂不可用|原数据未被修改/)
      assert.deepEqual(view.actions().map(a => a.props.title), ['重新读取保险箱'])
      await view.run(null, '重新读取保险箱')
      assert.equal(host.storage.get(key), original)
      assert.doesNotMatch(view.text(), /设置主密码并创建保险箱/)
    } finally { view.unmount() }
  }
})

test('存储暂时读取失败时可重试并解锁原保险箱，全程不重写密文', async () => {
  const entry = createVaultEntry({ title: '验收用假账号', category: 'login', secretPlain: 'not-a-real-secret' })
  const envelope = await encryptVaultEntries(password, [entry])
  const original = seed(JSON.stringify(envelope))
  host.faults.storageRead = new Error('临时读取失败')
  const view = await mount(Vault)
  try {
    assert.doesNotMatch(view.text(), /设置主密码并创建保险箱/)
    assert.equal(host.storage.get(key), original)
    host.faults.storageRead = null
    await view.run(null, '重新读取保险箱')
    await fillPassword(view)
    await view.run(null, '解锁保险箱')
    assert.match(view.text(), /验收用假账号/)
    assert.equal(host.storage.get(key), original)
  } finally { view.unmount() }
})

test('仅存储项不存在时创建加密保险箱，重复提交只创建一次', async () => {
  const view = await mount(Vault)
  try {
    await fillPassword(view)
    const submit = view.actions().find(a => a.props.title === '设置主密码并创建保险箱').props.onSubmit
    await Promise.all([submit({}), submit({})])
    await tick()
    const envelope = JSON.parse(JSON.parse(host.storage.get(key)))
    assert.deepEqual(await decryptVaultEntries(password, envelope), [])
    assert.equal(host.toasts.filter(t => t.title === '加密保险箱初始化完成').length, 1)
    assert.equal(host.storage.get(key).includes(password), false)
  } finally { view.unmount() }
})

test('读取后另一个窗口写入数据时，初始化原子拒绝覆盖并提供重试', async () => {
  const view = await mount(Vault)
  try {
    await fillPassword(view)
    const original = seed('另一个窗口刚写入的验收数据')
    await view.run(null, '设置主密码并创建保险箱')
    assert.equal(host.storage.get(key), original)
    assert.equal(host.lastToast().style, 'FAILURE')
    assert.match(view.text(), /原数据未被覆盖/)
    assert.deepEqual(view.actions().map(a => a.props.title), ['重新读取保险箱'])
  } finally { view.unmount() }
})

test('写入失败不会解锁或宣称创建成功，重试读取后才能再次创建', async () => {
  const view = await mount(Vault)
  try {
    await fillPassword(view)
    host.faults.storageWrite = new Error('磁盘不可写')
    await view.run(null, '设置主密码并创建保险箱')
    assert.equal(host.storage.has(key), false)
    assert.equal(host.lastToast().style, 'FAILURE')
    assert.match(view.text(), /磁盘不可写/)
    host.faults.storageWrite = null
    await view.run(null, '重新读取保险箱')
    await view.run(null, '设置主密码并创建保险箱')
    assert.equal(host.lastToast().title, '加密保险箱初始化完成')
  } finally { view.unmount() }
})

test('错误主密码与篡改密文只报解锁失败，不进入初始化或修改原文', async () => {
  const envelope = await encryptVaultEntries(password, [])
  const bytes = Buffer.from(envelope.cipherTextBase64, 'base64')
  bytes[0] ^= 1
  for (const [raw, pwd] of [[envelope, 'wrong-password'], [{ ...envelope, cipherTextBase64: bytes.toString('base64') }, password]]) {
    const original = seed(JSON.stringify(raw))
    const view = await mount(Vault)
    try {
      await fillPassword(view, pwd)
      await view.run(null, '解锁保险箱')
      assert.equal(host.lastToast().style, 'FAILURE')
      assert.equal(host.storage.get(key), original)
      assert.doesNotMatch(view.text(), /设置主密码并创建保险箱/)
    } finally { view.unmount() }
  }
})

test('读取期间不提供初始化；关闭页面后迟到结果不写入或弹成功提示', async () => {
  let resolveRead
  getDeclarativeBridge().storageGetItem = () => new Promise(resolve => { resolveRead = resolve })
  const view = await mount(Vault)
  assert.equal(view.tree().props.isLoading, true)
  assert.deepEqual(view.actions(), [])
  assert.doesNotMatch(view.text(), /设置主密码并创建保险箱/)
  view.unmount()
  resolveRead(undefined)
  await tick()
  assert.equal(host.storage.size, 0)
  assert.equal(host.toasts.length, 0)
})

test('兼容有效对象形式的旧加密信封，解锁时不改写存储格式', async () => {
  const envelope = await encryptVaultEntries(password, [])
  const original = seed(envelope)
  const view = await mount(Vault)
  try {
    await fillPassword(view)
    await view.run(null, '解锁保险箱')
    assert.equal(host.lastToast().title, '保险箱已解锁')
    assert.equal(host.storage.get(key), original)
  } finally { view.unmount() }
})
