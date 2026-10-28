import test from 'node:test'
import assert from 'node:assert/strict'
import { Toast } from '@ztools/declarative-ui'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import { installSecureStorage } from './secure-storage-double.mjs'
import GoogleAuthCommand from '../dist/index.js'
import { parseOTPAuthURL, createAccount, inspectStoredAccounts, corruptBackupKey, ACCOUNTS_STORAGE_KEY } from '../dist/logic.js'

const host = createHost()
let ss
test.beforeEach(() => {
  host.reset()
  ss = installSecureStorage(host)
})

const HOTP_URL = 'otpauth://hotp/HOTPBank:bob?secret=JBSWY3DPEHPK3PXP&issuer=HOTPBank&counter=5'
// 账号保存在加密存储（1.0.2 起）；损坏值按读回后的原值预置（如非 JSON 文本会以字符串形式读回）
const putRaw = (value) => ss.put(ACCOUNTS_STORAGE_KEY, value)
const readMain = () => ss.secure.get(ACCOUNTS_STORAGE_KEY)
const backupKeys = () => [...ss.secure.keys()].filter((k) => k.startsWith(`${ACCOUNTS_STORAGE_KEY}.corrupt-`))
const failures = () => host.toasts.filter((t) => t.style === Toast.Style.Failure)

// ---------- HOTP 链接 ----------

test('HOTP 链接被拒绝，TOTP 链接照常解析', () => {
  assert.throws(() => parseOTPAuthURL(HOTP_URL), /暂不支持 HOTP（计数器型）链接/)
  assert.throws(() => parseOTPAuthURL('OTPAUTH://HOTP/x?secret=JBSWY3DPEHPK3PXP'), /HOTP/, '大小写不影响识别')
  assert.throws(() => parseOTPAuthURL('otpauth://steam/x?secret=JBSWY3DPEHPK3PXP'), /不支持的 OTP 类型/)
  const ok = parseOTPAuthURL('otpauth://totp/GitHub:me?secret=JBSWY3DPEHPK3PXP')
  assert.equal(ok.type, 'totp')
  assert.equal(ok.secret, 'JBSWY3DPEHPK3PXP')
})

test('表单粘贴 HOTP 链接：错误显示在密钥框，不自动填写，保存被拒绝且不写入存储', async () => {
  const view = await mount(GoogleAuthCommand)
  await view.run(null, '添加 2FA 账号')
  const form = await mountPushed(host)
  await form.fill('secret', HOTP_URL)
  assert.match(form.field('secret').props.error, /暂不支持 HOTP/)
  assert.equal(form.field('name').props.value, '', '解析失败时不自动填写名称')
  assert.equal(form.field('name').props.error, undefined, '错误不显示在账号名称下')
  assert.ok(!host.toasts.some((t) => t.style === Toast.Style.Success), '不提示「成功解析」')

  // 用户手动补上名称后仍按回车保存：保存被拒绝
  await form.fill('name', 'bob')
  await form.run(null, '保存账号')
  await tick()
  assert.equal(readMain(), undefined, 'HOTP 账号不写入存储')
  assert.equal(host.pushed.length, 1, '表单保持打开')
  assert.match(host.lastToast().message, /HOTP/)
  assert.equal(view.items()[0].props.id, 'empty-auth')

  // 换成 TOTP 链接后错误消失并可以保存
  await form.fill('secret', 'otpauth://totp/Bank:bob?secret=JBSWY3DPEHPK3PXP&issuer=Bank')
  assert.equal(form.field('secret').props.error, undefined)
  await form.run(null, '保存账号')
  await tick()
  assert.equal(JSON.parse(readMain()).length, 1)
  assert.equal(host.pushed.length, 0)
  view.unmount()
})

// ---------- 存储损坏 / 读取失败时不覆盖原数据 ----------

test('存储值不是 JSON：提示无法读取并备份原值，用户确认前不覆盖', async () => {
  putRaw('{not json')
  const view = await mount(GoogleAuthCommand)
  await tick()
  const item = view.items()[0]
  assert.equal(item.props.title, '已保存的账号数据无法读取')
  assert.notEqual(item.props.title, '还没有 2FA 账号')
  assert.ok(failures().some((t) => t.title === '已保存的账号数据无法读取'), '弹出失败提示')
  const [backup] = backupKeys()
  assert.equal(backup, corruptBackupKey('{not json'))
  assert.equal(JSON.parse(ss.secure.get(backup)), '{not json', '原值原样备份')
  assert.match(item.props.subtitle, /已备份/)

  // 取消确认：不打开表单，原值不变
  host.setConfirm(false)
  await view.run(null, '添加 2FA 账号')
  assert.equal(host.pushed.length, 0)
  assert.equal(JSON.parse(readMain()), '{not json')
  assert.match(host.confirms.at(-1).message, /已备份/)

  // 确认后才允许添加，新列表替换主键，备份仍保留
  host.setConfirm(true)
  await view.run(item, '放弃损坏数据并添加账号')
  const form = await mountPushed(host)
  await form.fill('name', 'victim')
  await form.fill('secret', 'JBSWY3DPEHPK3PXP')
  await form.run(null, '保存账号')
  await tick()
  assert.deepEqual(JSON.parse(readMain()).map((a) => a.name), ['victim'])
  assert.equal(JSON.parse(ss.secure.get(backup)), '{not json')
  view.unmount()
})

test('同一份损坏数据多次打开只备份到同一个键', async () => {
  putRaw({ accounts: 'oops' })
  ;(await mount(GoogleAuthCommand)).unmount()
  await tick()
  ;(await mount(GoogleAuthCommand)).unmount()
  await tick()
  assert.equal(backupKeys().length, 1)
})

test('[故障注入] 读取失败：显示失败原因，禁止添加与删除；重新读取成功后恢复', async () => {
  const saved = [createAccount({ name: 'keep', secret: 'JBSWY3DPEHPK3PXP' })]
  putRaw(saved)
  ss.faults.get = new Error('LevelDB 被占用')
  const view = await mount(GoogleAuthCommand)
  await tick()
  const item = view.items()[0]
  assert.equal(item.props.title, '读取已保存的账号失败')
  assert.match(item.props.subtitle, /LevelDB 被占用/)

  await view.run(null, '添加 2FA 账号')
  assert.equal(host.pushed.length, 0, '读取失败时不打开添加表单')
  assert.match(host.lastToast().title, /暂不能修改/)
  assert.deepEqual(JSON.parse(readMain()), saved, '原数据未被覆盖')

  ss.faults.get = null
  await view.run(item, '重新读取已保存的账号')
  await tick()
  assert.ok(view.items()[0].props.title.startsWith('keep'))
  view.unmount()
})

test('[时序] 读取尚未完成时添加被拒绝，之后保存不会用空列表覆盖原数据', async () => {
  const saved = [createAccount({ name: 'old', secret: 'JBSWY3DPEHPK3PXP' })]
  putRaw(saved)
  // 首次访问系统钥匙串可能要等用户授权：status 迟迟不返回期间保持加载态
  let release
  ss.faults.statusGate = new Promise((resolve) => (release = resolve))
  const view = await mount(GoogleAuthCommand)
  assert.equal(view.items()[0].props.title, '正在读取已保存的账号…')
  assert.match(view.items()[0].props.subtitle, /系统授权弹窗/)
  await view.run(null, '添加 2FA 账号')
  assert.equal(host.pushed.length, 0, '读取中不打开添加表单')
  assert.match(host.lastToast().title, /正在读取/)
  release()
  await tick()

  // 读取完成后再添加：新账号与原账号并存
  await view.run(null, '添加 2FA 账号')
  const form = await mountPushed(host)
  await form.fill('name', 'new')
  await form.fill('secret', 'JBSWY3DPEHPK3PXP')
  await form.run(null, '保存账号')
  await tick()
  assert.deepEqual(JSON.parse(readMain()).map((a) => a.name), ['new', 'old'])
  view.unmount()
})

test('部分条目损坏：其余账号照常显示，先备份原值并提示，后续写入保留备份', async () => {
  const good = createAccount({ name: 'good', secret: 'JBSWY3DPEHPK3PXP' })
  const raw = [good, null, { id: 'b', name: 'bad', secret: '1890!' }]
  putRaw(raw)
  const view = await mount(GoogleAuthCommand)
  await tick()
  assert.ok(view.items()[0].props.title.startsWith('good'))
  assert.ok(failures().some((t) => /2 条已保存的账号数据损坏/.test(t.title)))
  const [backup] = backupKeys()
  assert.deepEqual(JSON.parse(ss.secure.get(backup)), JSON.parse(JSON.stringify(raw)))

  // 备份成功后无需额外确认即可删除，备份不受影响
  await view.run(view.items()[0], '删除该账号')
  assert.equal(host.confirms.length, 1, '只弹删除确认')
  assert.deepEqual(JSON.parse(readMain()), [])
  assert.ok(ss.secure.has(backup))
  view.unmount()
})

test('[故障注入] 部分损坏且备份写入失败：修改前必须再确认，取消则原数据不变', async () => {
  const good = createAccount({ name: 'good', secret: 'JBSWY3DPEHPK3PXP' })
  putRaw([good, 'broken'])
  const before = readMain()
  ss.faults.set = new Error('磁盘已满')
  const view = await mount(GoogleAuthCommand)
  await tick()
  ss.faults.set = null
  assert.equal(backupKeys().length, 0)
  assert.ok(failures().some((t) => /未能备份/.test(t.message)))

  host.setConfirm(false)
  await view.run(view.items()[0], '删除该账号')
  assert.equal(readMain(), before, '取消后原数据不变')
  assert.match(host.confirms[0].message, /永久丢失/)
  view.unmount()
})

test('inspectStoredAccounts 区分无数据、整体损坏与部分损坏', () => {
  assert.deepEqual(inspectStoredAccounts(undefined), { accounts: [], corrupt: false, dropped: 0 })
  assert.deepEqual(inspectStoredAccounts(null), { accounts: [], corrupt: false, dropped: 0 })
  assert.equal(inspectStoredAccounts('{not json').corrupt, true)
  assert.equal(inspectStoredAccounts({}).corrupt, true)
  assert.equal(inspectStoredAccounts(0).corrupt, true)
  assert.deepEqual(inspectStoredAccounts([]), { accounts: [], corrupt: false, dropped: 0 })
  const r = inspectStoredAccounts([createAccount({ name: 'a', secret: 'JBSWY3DPEHPK3PXP' }), 42])
  assert.equal(r.accounts.length, 1)
  assert.equal(r.dropped, 1)
})

test('[回归] 两个旧视图添加账号时合并最新存储，删除不复活其他窗口删除的账号', async () => {
  const initial = createAccount({ name: '旧账号', secret: 'JBSWY3DPEHPK3PXP' })
  putRaw([initial])
  const a = await mount(GoogleAuthCommand)
  const b = await mount(GoogleAuthCommand)
  await a.run(null, '添加 2FA 账号')
  const formA = await mountPushed(host)
  await formA.fill('name', '窗口 A')
  await formA.fill('secret', 'JBSWY3DPEHPK3PXP')
  await formA.run(null, '保存账号')
  await b.run(null, '添加 2FA 账号')
  const formB = await mountPushed(host)
  await formB.fill('name', '窗口 B')
  await formB.fill('secret', 'JBSWY3DPEHPK3PXP')
  await formB.run(null, '保存账号')
  assert.deepEqual(ss.read(ACCOUNTS_STORAGE_KEY).map(i => i.name).sort(), ['旧账号', '窗口 A', '窗口 B'].sort())
  host.setConfirm(true)
  await a.run(a.items().find(i => i.props.id === initial.id), '删除该账号')
  await b.run(b.items().find(i => i.props.title.startsWith('窗口 B  —')), '删除该账号')
  assert.deepEqual(ss.read(ACCOUNTS_STORAGE_KEY).map(i => i.name), ['窗口 A'])
  a.unmount(); b.unmount()
})
