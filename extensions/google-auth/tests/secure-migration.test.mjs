// 2FA 密钥迁移到加密存储的集成测试：真实声明式运行时 + 真实 SDK SecureStorage（key 校验、宿主注入）
// + 按前端语义实现的加密存储替身（明文一侧是测试宿主的插件 LocalStorage），含故障注入、重入、降级合并与只读兜底。
import test from 'node:test'
import assert from 'node:assert/strict'
import { Toast } from '@ztools/declarative-ui'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import { installSecureStorage } from './secure-storage-double.mjs'
import GoogleAuthCommand from '../dist/index.js'
import { createAccount, corruptBackupKey, mergeLegacyAccounts, ACCOUNTS_STORAGE_KEY as KEY } from '../dist/logic.js'

const host = createHost()
let ss
test.beforeEach(() => {
  host.reset()
  ss = installSecureStorage(host)
})

const SECRET = 'JBSWY3DPEHPK3PXP'
const acc = (name, issuer = 'GitHub', secret = SECRET) => createAccount({ name, issuer, secret })
// 旧版插件写在插件 LocalStorage（宿主库 ls: 键）里的明文
const putPlain = (key, value) => host.storage.set(key, JSON.stringify(value))
const plain = (key = KEY) => (host.storage.has(key) ? JSON.parse(host.storage.get(key)) : undefined)
const names = (view) => view.items().filter((i) => i.props.id !== 'empty-auth').map((i) => i.props.title.split('  —  ')[0])
const failures = () => host.toasts.filter((t) => t.style === Toast.Style.Failure)
const open = async () => {
  const view = await mount(GoogleAuthCommand)
  await tick(10)
  return view
}
async function addAccount(view, name) {
  await view.run(null, '添加 2FA 账号')
  if (host.pushed.length === 0) return false
  const form = await mountPushed(host)
  await form.fill('name', name)
  await form.fill('secret', SECRET)
  await form.run(null, '保存账号')
  await tick()
  return true
}

test('首次打开：旧明文账号迁入加密存储并删除明文，账号照常显示；重开仍在且不再迁移', async () => {
  const old = [acc('alice'), acc('bob', 'Google')]
  putPlain(KEY, old)
  let view = await open()
  assert.deepEqual(names(view), ['alice', 'bob'])
  assert.deepEqual(ss.read(KEY), JSON.parse(JSON.stringify(old)), '加密存储里是完整账号')
  assert.equal(plain(), undefined, '明文已删除')
  assert.deepEqual(failures(), [])
  view.unmount()

  ss.calls.length = 0
  view = await open()
  assert.deepEqual(names(view), ['alice', 'bob'])
  assert.deepEqual(ss.writes(), [], '再次打开不重复写入')
  view.unmount()
})

test('迁移后新增、删除账号只写加密存储，明文一侧不再出现账号', async () => {
  putPlain(KEY, [acc('alice')])
  const view = await open()
  assert.ok(await addAccount(view, 'carol'))
  assert.deepEqual(ss.read(KEY).map((a) => a.name), ['carol', 'alice'])
  await view.run(view.items().find((i) => i.props.title.startsWith('alice')), '删除该账号')
  assert.deepEqual(ss.read(KEY).map((a) => a.name), ['carol'])
  assert.equal(host.storage.size, 0, '没有任何明文条目')
  view.unmount()
})

test('[故障注入] 写入加密存储失败：明文保留不删，进入可重试的错误状态，添加与删除都被拦截', async () => {
  const old = [acc('alice')]
  putPlain(KEY, old)
  ss.faults.set = new Error('钥匙串写入失败')
  const view = await open()
  assert.deepEqual(plain(), JSON.parse(JSON.stringify(old)), '明文保留')
  assert.equal(ss.read(KEY), undefined)
  assert.deepEqual(names(view), ['alice'], '仍能看到旧账号的口令')
  assert.ok(failures().some((t) => t.title === '读取已保存的账号失败'))
  assert.equal(await addAccount(view, 'x'), false, '不打开添加表单')
  assert.match(host.lastToast().title, /暂不能修改/)

  // 故障消除后重新读取：完成迁移
  ss.faults.set = null
  await view.run(view.items()[0], '添加新账号') // 仍被拦截（状态未刷新）
  assert.deepEqual(plain(), JSON.parse(JSON.stringify(old)))
  view.unmount()
  const again = await open()
  assert.equal(plain(), undefined)
  assert.deepEqual(ss.read(KEY).map((a) => a.name), ['alice'])
  again.unmount()
})

test('[故障注入] 读回校验不一致：不删除明文，不写主键之外的数据，状态可重试', async () => {
  putPlain(KEY, [acc('alice')])
  ss.faults.verifyMismatch = true
  const view = await open()
  assert.ok(plain(), '明文保留')
  const item = view.items().find((i) => i.props.title.startsWith('alice'))
  assert.ok(item, '旧账号仍显示')
  assert.equal(await addAccount(view, 'x'), false)
  assert.deepEqual(ss.writes(), [KEY], '只有迁移那一次写入')
  view.unmount()
})

test('[故障注入] 删除明文失败（迁移中途中断）：加密存储已有数据、明文仍在；下次打开两边相同直接删明文', async () => {
  putPlain(KEY, [acc('alice')])
  ss.faults.discard = new Error('LevelDB 被占用')
  let view = await open()
  assert.ok(ss.read(KEY), '加密存储已写入')
  assert.ok(plain(), '明文仍在，不会出现两边都没有')
  assert.deepEqual(names(view), ['alice'])
  view.unmount()

  ss.faults.discard = null
  ss.calls.length = 0
  view = await open()
  assert.equal(plain(), undefined)
  assert.deepEqual(ss.writes(), [], '内容相同无需再写')
  assert.deepEqual(names(view), ['alice'])
  view.unmount()
})

test('[重入/降级] 加密存储与明文都有且不同：以加密存储为准，合并明文里新增的账号（按 secret+issuer+name 去重）后删明文', async () => {
  const alice = acc('alice')
  ss.put(KEY, [alice])
  // 用户降级到旧版插件又加了 bob；alice 在旧版里是另一个 id 的同一个账号
  putPlain(KEY, [{ ...alice, id: 'auth_other_id' }, acc('bob')])
  const view = await open()
  assert.deepEqual(ss.read(KEY).map((a) => a.name), ['alice', 'bob'])
  assert.equal(ss.read(KEY)[0].id, alice.id, '加密存储里的条目原样保留')
  assert.equal(plain(), undefined)
  assert.deepEqual(names(view), ['alice', 'bob'])
  view.unmount()
})

test('[重入] 明文里的账号都已在加密存储：不写入，只删明文', async () => {
  const alice = acc('alice')
  ss.put(KEY, [alice, acc('bob')])
  putPlain(KEY, [{ ...alice, id: 'dup', createdAt: 1 }])
  const view = await open()
  assert.deepEqual(ss.writes(), [])
  assert.equal(plain(), undefined)
  assert.deepEqual(names(view), ['alice', 'bob'])
  view.unmount()
})

test('[故障注入] 合并写入失败：照常使用加密存储里的账号并提示，明文保留到下次合并；之后的写入不丢明文账号', async () => {
  ss.put(KEY, [acc('alice')])
  putPlain(KEY, [acc('bob')])
  ss.faults.set = (key) => (key === KEY ? new Error('磁盘已满') : null)
  let view = await open()
  assert.deepEqual(names(view), ['alice'])
  assert.ok(failures().some((t) => t.title === '旧数据迁移未完成' && /明文已保留/.test(t.message)))
  assert.deepEqual(plain().map((a) => a.name), ['bob'])
  ss.faults.set = null
  assert.ok(await addAccount(view, 'carol'), '加密存储可用，允许继续添加')
  view.unmount()

  view = await open()
  assert.deepEqual(ss.read(KEY).map((a) => a.name), ['carol', 'alice', 'bob'])
  assert.equal(plain(), undefined)
  view.unmount()
})

test('[数据损坏] 合并时明文含损坏条目：明文原值先备份进加密存储，再删明文；加密存储本身损坏时不合并、明文保留', async () => {
  ss.put(KEY, [acc('alice')])
  const legacyRaw = [acc('bob'), null, { id: 'b', name: 'bad', secret: '1890!' }]
  putPlain(KEY, legacyRaw)
  let view = await open()
  const backup = corruptBackupKey(JSON.parse(JSON.stringify(legacyRaw)))
  assert.deepEqual(ss.read(backup), JSON.parse(JSON.stringify(legacyRaw)))
  assert.deepEqual(ss.read(KEY).map((a) => a.name), ['alice', 'bob'])
  assert.equal(plain(), undefined)
  view.unmount()

  host.reset()
  ss = installSecureStorage(host)
  ss.put(KEY, '{not json')
  putPlain(KEY, [acc('bob')])
  view = await open()
  assert.equal(view.items()[0].props.title, '已保存的账号数据无法读取')
  assert.ok(ss.read(corruptBackupKey('{not json')), '加密存储里的损坏值备份到加密存储')
  assert.deepEqual(plain().map((a) => a.name), ['bob'], '明文不删，等加密存储恢复后再合并')
  assert.equal(host.storage.size, 1, '备份不写明文')
  view.unmount()
})

test('旧版明文里的损坏数据备份逐个迁入加密存储并删除明文；无关键与非法键不动；迁移失败时提示并保留明文', async () => {
  const a = '{broken-a'
  const b = { accounts: 'oops' }
  const keyA = corruptBackupKey(a)
  const keyB = corruptBackupKey(b)
  putPlain(keyA, a)
  putPlain(keyB, b)
  putPlain('other.plugin.key', 'keep-me')
  putPlain(`${KEY}.corrupt-NOT-HEX`, 'odd')
  let view = await open()
  assert.equal(ss.read(keyA), a)
  assert.deepEqual(ss.read(keyB), b)
  assert.equal(plain(keyA), undefined)
  assert.equal(plain(keyB), undefined)
  assert.equal(plain('other.plugin.key'), 'keep-me')
  assert.equal(plain(`${KEY}.corrupt-NOT-HEX`), 'odd')
  view.unmount()

  host.reset()
  ss = installSecureStorage(host)
  putPlain(keyA, a)
  ss.faults.set = (key) => (key === keyA ? new Error('钥匙串拒绝') : null)
  view = await open()
  assert.ok(failures().some((t) => t.title === '损坏数据的备份未能迁移到加密存储'))
  assert.equal(plain(keyA), a, '失败时保留明文')
  view.unmount()
})

test('[只读] 系统加密存储不可用：显示旧明文账号、提示原因，添加与删除被拦截，不写加密存储也不改写明文', async () => {
  const old = [acc('alice')]
  putPlain(KEY, old)
  ss.state.status = { available: false, reason: 'encryption-unavailable' }
  const view = await open()
  assert.deepEqual(names(view), ['alice'])
  assert.match(view.text(), /已配置账号 \(1\) · 只读：系统加密存储不可用/)
  assert.ok(failures().some((t) => t.title === '为保护密钥已暂停保存' && /钥匙串/.test(t.message)))
  assert.equal(await addAccount(view, 'x'), false)
  assert.equal(host.lastToast().title, '为保护密钥已暂停保存')
  await view.run(view.items()[0], '删除该账号')
  assert.equal(host.confirms.length, 0, '删除在确认前就被拦截')
  assert.deepEqual(ss.writes(), [])
  assert.deepEqual(plain(), JSON.parse(JSON.stringify(old)), '明文原样保留')
  view.unmount()
})

test('[只读] 各种不可用原因都有明确说明；没有旧账号时空状态说明不能添加', async () => {
  for (const [reason, expected] of [
    ['insecure-backend', /不安全的明文/],
    ['backend-unknown', /无法确认系统加密后端/],
    ['identity-required', /无法确认插件身份/],
    ['something-new', /something-new/]
  ]) {
    host.reset()
    ss = installSecureStorage(host, { status: { available: false, reason } })
    const view = await open()
    const item = view.items()[0]
    assert.equal(item.props.title, '系统加密存储不可用，暂不能添加账号')
    assert.match(item.props.subtitle, expected)
    view.unmount()
  }
})

test('[宿主过旧] 宿主没有提供加密存储：SDK 报 host-unsupported，只读显示旧账号并提示升级', async () => {
  putPlain(KEY, [acc('alice')])
  ss.uninstall()
  const view = await open()
  assert.deepEqual(names(view), ['alice'])
  assert.ok(failures().some((t) => /请升级 ZTools/.test(t.message)))
  assert.equal(await addAccount(view, 'x'), false)
  assert.ok(plain(), '明文不动')
  view.unmount()
})

test('[故障注入] 状态查询失败（IPC 超时）：可重试的错误状态，不写入；重新读取成功后正常迁移', async () => {
  putPlain(KEY, [acc('alice')])
  ss.faults.status = Object.assign(new Error('调用超时'), { code: 'REQUEST_TIMEOUT' })
  const view = await open()
  const item = view.items()[0]
  assert.match(item.props.title, /^alice/)
  assert.equal(await addAccount(view, 'x'), false)
  assert.deepEqual(ss.writes(), [])
  ss.faults.status = null
  view.unmount()
  const again = await open()
  assert.equal(plain(), undefined)
  assert.deepEqual(names(again), ['alice'])
  again.unmount()
})

test('[故障注入] 加密数据被篡改（DATA_CORRUPT）：不覆盖加密存储，进入错误状态并显示原因', async () => {
  ss.put(KEY, [acc('alice')])
  ss.faults.get = Object.assign(new Error('凭据数据损坏'), { code: 'DATA_CORRUPT' })
  const view = await open()
  const item = view.items()[0]
  assert.equal(item.props.title, '读取已保存的账号失败')
  assert.match(item.props.subtitle, /凭据数据损坏/)
  assert.equal(await addAccount(view, 'x'), false)
  assert.deepEqual(ss.writes(), [])
  view.unmount()
})

test('[边界] 账号列表超过加密存储 64 KiB 上限：保存失败如实提示，表单保持打开，原数据不变', async () => {
  const many = Array.from({ length: 400 }, (_, i) => acc(`user-${i}-${'x'.repeat(80)}`))
  ss.put(KEY, many)
  const view = await open()
  assert.equal(names(view).length, 400)
  await view.run(null, '添加 2FA 账号')
  const form = await mountPushed(host)
  await form.fill('name', 'one-more')
  await form.fill('secret', SECRET)
  await form.run(null, '保存账号')
  await tick()
  assert.equal(host.pushed.length, 1, '表单仍然打开')
  assert.ok(failures().some((t) => t.title === '保存失败' && /64 KiB/.test(t.message)))
  assert.equal(ss.read(KEY).length, 400)
  view.unmount()
})

test('mergeLegacyAccounts：保留加密存储原始条目（含损坏条目），只追加新账号', () => {
  const a = acc('a')
  const { merged, added } = mergeLegacyAccounts([a, null], [{ ...a, id: 'x', secret: 'jbsw y3dp ehpk 3pxp' }, acc('b')])
  assert.equal(added, 1)
  assert.equal(merged.length, 3)
  assert.equal(merged[1], null)
  assert.equal(merged[2].name, 'b')
  assert.deepEqual(mergeLegacyAccounts([], []), { merged: [], added: 0 })
})
