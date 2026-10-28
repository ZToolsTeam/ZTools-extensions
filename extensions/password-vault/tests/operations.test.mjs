import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { getDeclarativeBridge } from '@ztools/declarative-ui'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import Vault, { encryptVaultEntries, decryptVaultEntries, createVaultEntry, commands } from '../dist/index.js'
const key = 'ztools.password-vault.envelope.v1', password = 'audit-only-passphrase'
let host, views, originalEntry
beforeEach(async () => {
  host = createHost(); views = []; originalEntry = createVaultEntry({ title: '原有假凭据', category: 'login', username: 'fixture-user', secretPlain: 'not-a-real-secret' })
  await store([originalEntry])
  host.ipc.clipboard_copy_text = async params => { host.clipboard.text = params.text; return { success: true, clearAfterMs: 30000 } }
})
afterEach(async () => { for (const view of views) view.unmount(); await tick() })
async function store(entries) { host.storage.set(key, JSON.stringify(JSON.stringify(await encryptVaultEntries(password, entries)))) }
const read = () => decryptVaultEntries(password, JSON.parse(JSON.parse(host.storage.get(key))))
function field(value, id) {
  if (!value || typeof value !== 'object') return
  if (value.props?.id === id) return value
  for (const child of Object.values(value)) { const found = field(child, id); if (found) return found }
}
async function open(Command = Vault) {
  const v = await mount(Command, host); views.push(v)
  field(v.tree(), 'masterPassword').props.onChange(password); await tick(); await v.run(null, '解锁保险箱'); return v
}
async function form() { const f = await mountPushed(host); views.push(f); return f }
const globalAction = (v, id) => v.tree().props.filterBar.actions.find(a => a.id === id).onAction()
const save = f => f.run(null, '加密保存至保险箱')
async function editEntry(view, id) {
  const action = view.actions(view.item(id)).find(a => a.props.title === '编辑此凭据')
  assert.equal(action.type, 'Action.Push')
  host.pushed.push(action.props.target); await tick(); return form()
}
test('新建、编辑、锁定重开、删除使用真实加密和CAS，保留其他条目', async () => {
  const v = await open(); await globalAction(v, 'new-entry'); const f = await form()
  await f.fill('title', '新增假账号'); await f.fill('secretPlain', 'new-dummy-secret'); await save(f)
  assert.equal((await read()).length, 2); assert.ok(!host.storage.get(key).includes('new-dummy-secret'))
  const created = (await read()).find(e => e.title === '新增假账号')
  const edit = await editEntry(v, created.id)
  assert.equal(edit.field('secretPlain').props.value, 'new-dummy-secret')
  await edit.fill('title', '改名假账号'); await edit.fill('secretPlain', 'updated-dummy-secret'); await save(edit)
  const saved = await read(); assert.equal(saved.find(e => e.id === created.id).secretPlain, 'updated-dummy-secret'); assert.deepEqual(saved.find(e => e.id === originalEntry.id), originalEntry)
  await globalAction(v, 'lock-vault'); assert.match(v.text(), /解锁密码保险箱/)
  const reopened = await open(); assert.ok(reopened.item(created.id)); await reopened.run(reopened.item(created.id), '删除此凭据')
  assert.deepEqual(await read(), [originalEntry])
})
test('另一窗口修改后，旧窗口删除或保存不得覆盖新密文，必须重新读取', async () => {
  const v = await open(), added = createVaultEntry({ title: '另一窗口新增', category: 'apikey', secretPlain: 'new-foreign-fixture' })
  await store([originalEntry, added]); const before = host.storage.get(key)
  await v.run(v.item(originalEntry.id), '删除此凭据')
  assert.equal(host.storage.get(key), before); assert.equal(host.lastToast().style, 'FAILURE'); assert.match(v.text(), /重新读取/)
  await v.run(null, '重新读取保险箱'); field(v.tree(), 'masterPassword').props.onChange(password); await tick(); await v.run(null, '解锁保险箱')
  assert.ok(v.item(added.id)); const edit = await editEntry(v, originalEntry.id)
  await edit.fill('secretPlain', 'my-edit'); await store([added]); const changed = host.storage.get(key); await save(edit)
  assert.equal(host.storage.get(key), changed); assert.equal(host.pushed.length, 1); assert.equal(host.lastToast().style, 'FAILURE')
})
test('延迟CAS期间拒绝锁定与重复保存，写完再解锁读取完整结果', async () => {
  const v = await open(); await globalAction(v, 'new-entry'); const f = await form()
  await f.fill('title', '延迟提交'); await f.fill('secretPlain', 'delayed-fixture')
  const original = getDeclarativeBridge().storageCompareAndSet; let resume, started = false, writes = 0
  getDeclarativeBridge().storageCompareAndSet = async (...args) => { writes++; started = true; await new Promise(r => { resume = r }); return original(...args) }
  const pending = save(f); for (let n = 0; n < 100 && !started; n++) await tick(1)
  assert.ok(started); await save(f); await globalAction(v, 'lock-vault'); assert.match(host.lastToast().title, /正在保存/)
  resume(); await pending; assert.equal(writes, 1); assert.equal((await read()).length, 2)
  await globalAction(v, 'lock-vault'); const reopened = await open(); assert.equal(reopened.items().length, 2)
})
test('表单提交遇到写入失败保留输入且不成功退出，退出父页面后不提交迟到的加密结果', async () => {
  const v = await open(); await globalAction(v, 'new-entry'); const f = await form()
  await f.fill('title', '未保存数据'); await f.fill('secretPlain', 'unsaved-fixture')
  const before = host.storage.get(key); host.faults.storageWrite = Error('磁盘不可写'); await save(f)
  assert.equal(host.storage.get(key), before); assert.equal(host.pushed.length, 1); assert.equal(f.field('secretPlain').props.value, 'unsaved-fixture')
  host.faults.storageWrite = null; const pending = save(f); v.unmount(); await pending
  assert.equal(host.storage.get(key), before); assert.equal(host.lastToast().style, 'FAILURE')
})
test('复制与生成只走宿主敏感接口，退出页面不取消任务，缺失到期回执不得报成功', async () => {
  const v = await open(); await v.run(v.item(originalEntry.id), '复制密码 / Secret（30秒后自动清剪贴板）')
  const request = host.ipcCalls.at(-1); assert.equal(request[0], 'clipboard_copy_text'); assert.deepEqual(request[1], { text: originalEntry.secretPlain, sensitive: true })
  assert.equal(host.clipboard.text, originalEntry.secretPlain); v.unmount(); assert.equal(host.ipcCalls.length, 1)
  const another = await open(); await another.run(another.item(originalEntry.id), '立即生成 20 位高强度随机密码并复制')
  assert.equal(host.ipcCalls.at(-1)[1].sensitive, true); assert.equal(host.clipboard.text.length, 20)
  host.ipc.clipboard_copy_text = async () => ({ success: true }); const before = host.toasts.length
  await assert.rejects(another.run(another.item(originalEntry.id), '复制密码 / Secret（30秒后自动清剪贴板）'), /未确认自动清除/)
  assert.equal(host.toasts.length, before)
})
test('删除前必须确认：取消时不改密文、条目保留；确认框标明删除后无法恢复', async () => {
  const v = await open(); const before = host.storage.get(key)
  host.setConfirm(false)
  await v.run(v.item(originalEntry.id), '删除此凭据')
  assert.equal(host.storage.get(key), before); assert.ok(v.item(originalEntry.id))
  assert.equal(host.confirms.length, 1); assert.match(host.confirms[0].title, /原有假凭据/); assert.match(host.confirms[0].message, /无法恢复/)
  assert.equal(host.confirms[0].primaryAction.style, 'destructive')
  host.setConfirm(true)
  await v.run(v.item(originalEntry.id), '删除此凭据')
  assert.deepEqual(await read(), [])
})
test('两个入口通过 commands 区分：「随机密码」入口新建凭据时预填 20 位随机密码，列表入口不预填', async () => {
  assert.equal(typeof commands['vault-list'], 'function'); assert.equal(typeof commands['vault-generator'], 'function')
  const gen = await open(commands['vault-generator']); await globalAction(gen, 'new-entry'); const genForm = await form()
  assert.equal(genForm.field('secretPlain').props.value.length, 20)
  gen.unmount(); host.pushed.length = 0
  const list = await open(commands['vault-list']); await globalAction(list, 'new-entry'); const listForm = await form()
  assert.equal(listForm.field('secretPlain').props.value, '')
})
