import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import { installSecureStorage } from './secure-storage-double.mjs'
import GoogleAuthCommand from '../dist/index.js'
import { generateTOTP, parseOTPAuthURL, sanitizeStoredAccounts, createAccount, ACCOUNTS_STORAGE_KEY } from '../dist/logic.js'

const host = createHost()
let ss
test.beforeEach(() => {
  host.reset()
  ss = installSecureStorage(host)
})

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
  const stored = ss.read(ACCOUNTS_STORAGE_KEY)
  assert.equal(stored.length, 1)
  assert.equal(stored[0].issuer, 'GitHub')
  const item = view.items().find((i) => i.props.title.startsWith('me@x.com'))
  assert.match(item.props.title, /\d{3} \d{3}$/)
  host.setConfirm(false)
  await view.run(item, '删除该账号')
  assert.equal(ss.read(ACCOUNTS_STORAGE_KEY).length, 1, '取消确认时不删除')
  host.setConfirm(true)
  await view.run(view.items().find((i) => i.props.title.startsWith('me@x.com')), '删除该账号')
  assert.equal(ss.read(ACCOUNTS_STORAGE_KEY).length, 0)
  view.unmount()
})

test('[故障注入] 保存失败时不关闭表单、不显示新账号', async () => {
  const view = await mount(GoogleAuthCommand)
  await view.run(null, '添加 2FA 账号')
  const form = await mountPushed(host)
  ss.faults.set = new Error('磁盘已满')
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

test('空列表的主动作与全局动作不重复：添加账号只出现一次，次动作是从剪贴板导入', async () => {
  const view = await mount(GoogleAuthCommand)
  try {
    await tick()
    const itemTitles = view.actions(view.item('empty-auth')).map(a => a.props.title)
    const globalTitles = view.actions(null).map(a => a.props.title)
    assert.deepEqual(itemTitles, ['添加 2FA 账号', '从剪贴板导入 otpauth 链接'])
    assert.ok(!view.text().includes('立即添加'))
    // 宿主按「类型 + 标题」合并列表级动作，标题一致才不会在底栏出现两次
    for (const title of itemTitles) assert.ok(globalTitles.includes(title), title)
  } finally { view.unmount() }
})

test('从剪贴板导入 otpauth 链接：成功写入加密存储；非链接、无效链接不写入并如实提示', async () => {
  const view = await mount(GoogleAuthCommand)
  try {
    await tick()
    host.clipboard.text = '只是普通文字'
    await view.run(view.item('empty-auth'), '从剪贴板导入 otpauth 链接')
    assert.equal(host.lastToast().title, '剪贴板里没有 otpauth:// 链接')
    assert.equal(ss.read(ACCOUNTS_STORAGE_KEY), undefined)

    host.clipboard.text = 'otpauth://hotp/X:y?secret=JBSWY3DPEHPK3PXP&counter=1'
    await view.run(view.item('empty-auth'), '从剪贴板导入 otpauth 链接')
    assert.equal(host.lastToast().title, '无法解析剪贴板里的链接')
    assert.equal(ss.read(ACCOUNTS_STORAGE_KEY), undefined)

    host.clipboard.text = '  otpauth://totp/GitHub:me%40x.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub  '
    await view.run(view.item('empty-auth'), '从剪贴板导入 otpauth 链接')
    const stored = ss.read(ACCOUNTS_STORAGE_KEY)
    assert.equal(stored.length, 1)
    assert.equal(stored[0].issuer, 'GitHub')
    assert.equal(host.lastToast().title, '已添加账号 me@x.com')
    assert.ok(view.items().some(i => i.props.title.startsWith('me@x.com')))
  } finally { view.unmount() }
})

test('[敏感剪贴板] 复制原始密钥走 clipboard_copy_text(sensitive: true)，取消不复制，TOTP 口令复制保持顺手', async () => {
  const acc = createAccount({ name: 'GitHub', secret: 'JBSWY3DPEHPK3PXP' })
  ss.put(ACCOUNTS_STORAGE_KEY, [acc])
  host.ipc.clipboard_copy_text = async () => ({ success: true, clearAfterMs: 30000 })

  const view = await mount(GoogleAuthCommand)
  try {
    await tick()
    const item = view.items().find((i) => i.props.title.startsWith('GitHub'))

    // 取消确认：不调用敏感剪贴板也不写普通剪贴板
    host.setConfirm(false)
    await view.run(item, '复制 Base32 密钥')
    assert.equal(host.ipcCalls.filter(([m]) => m === 'clipboard_copy_text').length, 0)
    assert.equal(host.clipboard.text, '')

    // 确认后走敏感剪贴板
    host.setConfirm(true)
    await view.run(item, '复制 Base32 密钥')
    const sensitiveCalls = host.ipcCalls.filter(([m]) => m === 'clipboard_copy_text')
    assert.equal(sensitiveCalls.length, 1)
    assert.deepEqual(sensitiveCalls[0][1], { text: 'JBSWY3DPEHPK3PXP', sensitive: true })
    assert.equal(host.clipboard.text, '', '走宿主敏感剪贴板时不写普通 Clipboard.copy')
    assert.equal(host.lastToast().title, '已复制密钥')
    assert.match(host.lastToast().message, /30 秒后自动清除/)

    // 切英文验证 i18n 提示
    host.setLocale('en-US')
    await tick()
    await view.run(view.items().find((i) => i.props.title.startsWith('GitHub')), 'Copy Base32 Secret')
    assert.equal(host.lastToast().title, 'Secret Copied')
    assert.match(host.lastToast().message, /30s/)
    host.setLocale('zh-CN')
    await tick()

    // TOTP 动态口令复制保持顺手（无需确认直接复制）
    const confirmsBefore = host.confirms.length
    await view.run(view.items().find((i) => i.props.title.startsWith('GitHub')), '复制动态口令')
    assert.equal(host.confirms.length, confirmsBefore)
    assert.match(host.clipboard.text, /^\d{6}$/)
  } finally { view.unmount() }
})

test('[敏感剪贴板降级与异常] 旧宿主优雅降级 Clipboard.copy，明确权限/写入失败不降级且如实报错', async () => {
  const acc = createAccount({ name: 'AWS', secret: 'JBSWY3DPEHPK3PXP' })
  ss.put(ACCOUNTS_STORAGE_KEY, [acc])
  const view = await mount(GoogleAuthCommand)
  try {
    await tick()
    const item = view.items().find((i) => i.props.title.startsWith('AWS'))

    // 1. 宿主未实现 clipboard_copy_text（NOT_SUPPORTED）-> 优雅降级到 Clipboard.copy
    await view.run(item, '复制 Base32 密钥')
    assert.equal(host.clipboard.text, 'JBSWY3DPEHPK3PXP')
    assert.equal(host.lastToast().title, '已复制密钥')
    assert.match(host.lastToast().message, /手动清空/)

    // 2. 旧宿主成功但未返回 clearAfterMs -> 不重复写 Clipboard.copy，按非敏感提示
    host.clipboard.text = ''
    host.ipc.clipboard_copy_text = async () => ({ success: true })
    await view.run(item, '复制 Base32 密钥')
    assert.equal(host.clipboard.text, '')
    assert.match(host.lastToast().message, /手动清空/)

    // 3. 宿主明确返回非不支持类失败（PERMISSION_DENIED）-> 不降级写普通剪贴板，弹失败提示
    host.clipboard.text = ''
    host.ipc.clipboard_copy_text = async () => {
      throw Object.assign(new Error('剪贴板写入被拒绝'), { code: 'PERMISSION_DENIED' })
    }
    await view.run(item, '复制 Base32 密钥')
    assert.equal(host.clipboard.text, '')
    assert.equal(host.lastToast().title, '复制失败')
    assert.match(host.lastToast().message, /剪贴板写入被拒绝/)
  } finally { view.unmount() }
})
