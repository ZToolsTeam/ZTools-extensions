// otpauth 链接参数校验、复制动作的真实性与密钥复制确认
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import { installSecureStorage } from './secure-storage-double.mjs'
import GoogleAuthCommand from '../dist/index.js'
import { parseOTPAuthURL, createAccount, generateTOTP, ACCOUNTS_STORAGE_KEY } from '../dist/logic.js'

const host = createHost()
let ss
test.beforeEach(() => {
  host.reset()
  ss = installSecureStorage(host)
})
const base = 'otpauth://totp/Svc:me?secret=JBSWY3DPEHPK3PXP'

test('链接里不支持的位数、周期、算法直接拒绝，不悄悄换成默认值', () => {
  for (const [query, pattern] of [['&digits=12', /位口令/], ['&digits=6a', /位口令/], ['&digits=', /位口令/], ['&period=0', /刷新周期/], ['&period=15.5', /刷新周期/], ['&period=301', /刷新周期/], ['&algorithm=MD5', /MD5 算法/]]) {
    assert.throws(() => parseOTPAuthURL(base + query), pattern, query)
  }
  const ok = parseOTPAuthURL(base + '&digits=7&period=15&algorithm=sha256')
  assert.deepEqual([ok.digits, ok.period, ok.algorithm], [7, 15, 'SHA256'])
  assert.deepEqual([parseOTPAuthURL(base).digits, parseOTPAuthURL(base).period, parseOTPAuthURL(base).algorithm], [6, 30, 'SHA1'])
})

test('创建账号时拒绝解不出字节的密钥与超出范围的参数', () => {
  assert.throws(() => createAccount({ name: 'a', secret: 'A' }), /太短/)
  assert.throws(() => createAccount({ name: 'a', secret: 'JBSWY3DPEHPK3PXP', digits: 12 }), /位数/)
  assert.throws(() => createAccount({ name: 'a', secret: 'JBSWY3DPEHPK3PXP', digits: Number.NaN }), /位数/)
  assert.throws(() => createAccount({ name: 'a', secret: 'JBSWY3DPEHPK3PXP', period: 0 }), /刷新周期/)
  assert.throws(() => createAccount({ name: 'a', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'MD5' }), /算法/)
  assert.equal(createAccount({ name: 'a', secret: 'jbsw y3dp-ehpk 3pxp====', digits: 7, period: 15 }).secret, 'JBSWY3DPEHPK3PXP')
})

test('表单粘贴 7 位 / 15 秒链接：下拉框能选中链接里的值，保存后按该参数生成口令', async () => {
  const view = await mount(GoogleAuthCommand)
  await view.run(null, '添加 2FA 账号')
  const form = await mountPushed(host)
  await form.fill('secret', base + '&digits=7&period=15')
  const nodes = JSON.stringify(form.tree(), (k, v) => (typeof v === 'function' ? undefined : v))
  assert.match(nodes, /7 位口令（来自链接）/)
  assert.match(nodes, /15 秒（来自链接）/)
  await form.run(null, '保存账号')
  await tick()
  const stored = ss.read(ACCOUNTS_STORAGE_KEY)
  assert.deepEqual([stored[0].digits, stored[0].period], [7, 15])
  view.unmount()
})

test('Enter 复制按当下时间计算的口令；密钥复制需确认，取消时剪贴板不变', async () => {
  const account = createAccount({ name: 'me', issuer: 'Svc', secret: 'JBSWY3DPEHPK3PXP' })
  ss.put(ACCOUNTS_STORAGE_KEY, [account])
  const view = await mount(GoogleAuthCommand)
  await tick(); await tick()
  const item = view.items().find(i => i.props.id === account.id)
  assert.equal(view.actions(item)[0].props.title, '复制动态口令')
  assert.equal(view.actions(item).filter(a => /复制.*口令/.test(a.props.title)).length, 1, '同一功能只出现一次')
  await view.run(item, '复制动态口令')
  assert.equal(host.clipboard.text, generateTOTP(account.secret))
  const before = host.clipboard.text
  host.setConfirm(false)
  await view.run(item, '复制 Base32 密钥')
  assert.equal(host.clipboard.text, before)
  host.setConfirm(true)
  await view.run(item, '复制 Base32 密钥')
  assert.equal(host.clipboard.text, account.secret)
  view.unmount()
})
