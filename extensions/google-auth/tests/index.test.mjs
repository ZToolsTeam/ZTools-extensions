import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import GoogleAuthCommand from '../dist/index.js'
import { generateTOTP, parseOTPAuthURL, sanitizeStoredAccounts, createAccount, ACCOUNTS_STORAGE_KEY } from '../dist/logic.js'

const host = createHost()
test.beforeEach(() => host.reset())

const b32 = (ascii) => {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of Buffer.from(ascii)) bits += c.toString(2).padStart(8, '0')
  let o = ''
  for (let i = 0; i < bits.length; i += 5) o += A[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]
  return o
}

test('RFC 6238 附录 B 全部 18 组标准向量', () => {
  const keys = { SHA1: b32('12345678901234567890'), SHA256: b32('12345678901234567890123456789012'), SHA512: b32('1234567890123456789012345678901234567890123456789012345678901234') }
  const V = [[59, '94287082', '46119246', '90693936'], [1111111109, '07081804', '68084774', '25091201'], [1111111111, '14050471', '67062674', '99943326'], [1234567890, '89005924', '91819424', '93441116'], [2000000000, '69279037', '90698825', '38618901'], [20000000000, '65353130', '77737706', '47863826']]
  for (const [t, a, b, c] of V) {
    assert.equal(generateTOTP(keys.SHA1, { nowMs: t * 1000, digits: 8, algorithm: 'SHA1' }), a)
    assert.equal(generateTOTP(keys.SHA256, { nowMs: t * 1000, digits: 8, algorithm: 'SHA256' }), b)
    assert.equal(generateTOTP(keys.SHA512, { nowMs: t * 1000, digits: 8, algorithm: 'SHA512' }), c)
  }
})

test('首次打开没有示例账号，口令不显示 ERR', async () => {
  const view = await mount(GoogleAuthCommand)
  assert.ok(!view.text().includes('octocat'))
  assert.equal(view.items()[0].props.title, '还没有 2FA 账号')
  view.unmount()
})

test('粘贴 otpauth 链接添加账号，写入存储；删除需要确认', async () => {
  const view = await mount(GoogleAuthCommand)
  await view.run(null, '添加 2FA 账号')
  const form = await mountPushed(host)
  await form.fill('secret', 'otpauth://totp/GitHub:me%40x.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub')
  await form.run(null, '保存账号')
  await tick()
  const stored = JSON.parse(host.storage.get(ACCOUNTS_STORAGE_KEY))
  assert.equal(stored.length, 1)
  assert.equal(stored[0].issuer, 'GitHub')
  const item = view.items().find((i) => i.props.title.startsWith('me@x.com'))
  assert.match(item.props.title, /\d{3} \d{3}$/)
  host.setConfirm(false)
  await view.run(item, '删除该账号')
  assert.equal(JSON.parse(host.storage.get(ACCOUNTS_STORAGE_KEY)).length, 1, '取消确认时不删除')
  host.setConfirm(true)
  await view.run(view.items().find((i) => i.props.title.startsWith('me@x.com')), '删除该账号')
  assert.equal(JSON.parse(host.storage.get(ACCOUNTS_STORAGE_KEY)).length, 0)
  view.unmount()
})

test('[故障注入] 保存失败时不关闭表单、不显示新账号', async () => {
  const view = await mount(GoogleAuthCommand)
  await view.run(null, '添加 2FA 账号')
  const form = await mountPushed(host)
  host.faults.storageWrite = new Error('磁盘已满')
  await form.fill('name', 'a')
  await form.fill('secret', 'JBSWY3DPEHPK3PXP')
  await form.run(null, '保存账号')
  assert.equal(host.pushed.length, 1, '表单仍然打开')
  assert.equal(view.items()[0].props.id, 'empty-auth')
  view.unmount()
})

test('[数据损坏] 存储里的坏条目被丢弃，非法密钥报错而不是显示假口令', () => {
  const good = createAccount({ name: 'ok', secret: 'JBSWY3DPEHPK3PXP' })
  const out = sanitizeStoredAccounts([good, null, { id: 'x', name: 'bad', secret: '1890!' }, 'str'])
  assert.deepEqual(out.map((a) => a.name), ['ok'])
  assert.throws(() => createAccount({ name: 'x', secret: '0189' }), /Base32/)
  assert.throws(() => parseOTPAuthURL('https://example.com'), /otpauth/)
  assert.throws(() => generateTOTP(''), /不能为空/)
})
