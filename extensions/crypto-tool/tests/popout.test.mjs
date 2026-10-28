// 独立窗口带状态：散列页输入、模式与二级表单草稿由根页面持有并随弹出带走；口令、密钥与 AES 结果不带
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderDeclarativeRoot } from '@ztools/declarative-ui'
import { createHost, mountPushed, tick } from '../../shared/test-harness.mjs'
import CryptoToolCommand from '../dist/index.js'
import { aesEncrypt, calculateHmac } from '../dist/logic.js'

const host = createHost()
test.beforeEach(() => host.reset())

// ---- 模拟宿主的「弹出独立窗口」交接（与 frontend popoutHandoff 一致：只收纯 JSON，路径另行转交授权）----

function descriptors(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => descriptors(n, out))
  else if (node && typeof node === 'object') {
    if (typeof node.type === 'string') out.push(node)
    for (const v of [node.children, ...Object.values(node.props || {})]) if (v && typeof v === 'object') descriptors(Array.isArray(v) ? v : v.type ? v : v.items, out)
  }
  return out
}

/** 按宿主方式挂载根页面；handoffSeed 是独立窗口交接来的初值 */
async function openWindow(Command, handoffSeed) {
  const root = renderDeclarativeRoot(() => Command(), handoffSeed === undefined ? undefined : { handoffSeed })
  await tick(20)
  const win = {
    tree: () => root.forceRender(),
    all: (type) => descriptors(win.tree()).filter((n) => n.type === type),
    async act(title) {
      const a = descriptors(win.tree()).find((n) => n.type.startsWith('Action') && !n.type.startsWith('ActionPanel') && typeof n.props?.title === 'string' && n.props.title.startsWith(title))
      if (!a) throw new Error(`找不到动作「${title}」`)
      await a.props.onAction?.()
      await a.props.onSubmit?.({})
      await tick(20)
    },
    /** 收集根页面状态并按 JSON 往返，返回新窗口的初值、要转交授权的路径与被拒绝的 key */
    popout() {
      const { entries, rejected } = root.collectPopoutState()
      const values = Object.fromEntries(entries.map((e) => [e.key, e.value]))
      const seed = JSON.parse(JSON.stringify(values))
      assert.deepEqual(seed, values, '交接的值必须是纯 JSON，否则宿主会整项拒绝')
      return { seed, rejected, paths: entries.flatMap((e) => e.paths) }
    },
    unmount: () => root.unmount()
  }
  return win
}

const description = (form) => form.tree().children.find((c) => c.type === 'Form.Description').props.text
const actionTitles = (form) => form.actions().map((a) => a.props.title)
async function openForm(win, title) {
  await win.act(title)
  return mountPushed(host)
}

test('弹出闭环：散列页输入与模式带到新窗口，结果与旧窗口一致', async () => {
  const old = await openWindow(CryptoToolCommand)
  old.tree().props.onSearchTextChange('5p6B5a6i')
  old.tree().props.searchBarAccessory.props.onChange('base64-decode')
  await tick()
  const { seed, rejected, paths } = old.popout()
  assert.equal(seed.inputText, '5p6B5a6i')
  assert.equal(seed.mode, 'base64-decode')
  assert.deepEqual(rejected, [])
  assert.deepEqual(paths, [])
  old.unmount()

  const win = await openWindow(CryptoToolCommand, seed)
  assert.equal(win.tree().props.searchText, '5p6B5a6i')
  assert.equal(win.tree().props.searchBarAccessory.props.value, 'base64-decode')
  assert.equal(win.all('List.Item').find((i) => i.props.id === 'decoded').props.title, '极客')
})

test('二级表单的草稿提升到根页面：AES 方向、密文、IV 带走，口令与结果不带；新窗口补上口令即可解密', async () => {
  const old = await openWindow(CryptoToolCommand)
  const cipher = (await aesEncrypt('机密内容', 'secret-pw', { iv: '0123456789abcdef' })).result
  const aes = await openForm(old, 'AES 加解密…')
  await aes.fill('direction', 'decrypt')
  await aes.fill('text', cipher)
  await aes.fill('key', 'secret-pw')
  await aes.fill('iv', '0123456789abcdef')
  await aes.run(null, '解密')
  assert.equal(description(aes), '机密内容')

  const { seed } = old.popout()
  assert.deepEqual(seed.aesDraft, { direction: 'decrypt', text: cipher, iv: '0123456789abcdef' })
  assert.ok(!JSON.stringify(seed).includes('secret-pw'), '口令不能出现在交接内容里')
  assert.ok(!JSON.stringify(seed).includes('机密内容'), '解密结果不能出现在交接内容里')

  host.reset()
  const win = await openWindow(CryptoToolCommand, seed)
  const form = await openForm(win, 'AES 加解密…')
  assert.equal(form.field('direction').props.value, 'decrypt')
  assert.equal(form.field('text').props.value, cipher)
  assert.equal(form.field('iv').props.value, '0123456789abcdef')
  assert.equal(form.field('key').props.value, '')
  assert.match(description(form), /结果显示在这里/)
  assert.deepEqual(actionTitles(form), ['解密'], '没有结果时不出现「复制结果」')
  await form.fill('key', 'secret-pw')
  await form.run(null, '解密')
  assert.equal(description(form), '机密内容')
})

test('HMAC 草稿：算法与消息带走，密钥不带', async () => {
  const old = await openWindow(CryptoToolCommand)
  const hmac = await openForm(old, 'HMAC 计算…')
  await hmac.fill('algorithm', 'sha512')
  await hmac.fill('text', 'msg')
  await hmac.fill('key', 'hmac-key')
  const { seed } = old.popout()
  assert.deepEqual(seed.hmacDraft, { algorithm: 'sha512', text: 'msg' })
  assert.ok(!JSON.stringify(seed).includes('hmac-key'))

  host.reset()
  const win = await openWindow(CryptoToolCommand, seed)
  const form = await openForm(win, 'HMAC 计算…')
  assert.equal(form.field('algorithm').props.value, 'sha512')
  assert.equal(form.field('text').props.value, 'msg')
  assert.equal(form.field('key').props.value, '')
  await form.fill('key', 'hmac-key')
  assert.equal(description(form), calculateHmac('sha512', 'msg', 'hmac-key'))
})

test('[异常] 交接来的值形状不对（旧版本、篡改）时回落到默认值，表单照常可用', async () => {
  const bad = {
    inputText: { evil: true },
    mode: 'rot13',
    aesDraft: { direction: 'rot13', text: 'x', iv: '' },
    hmacDraft: { algorithm: 'sha3', text: 'x' }
  }
  for (const seed of [bad, { aesDraft: { direction: 'encrypt', text: 1, iv: '' }, hmacDraft: ['sha256', 'x'] }, { aesDraft: null, hmacDraft: 'sha1' }]) {
    host.reset()
    const win = await openWindow(CryptoToolCommand, seed)
    assert.equal(win.tree().props.searchText, '')
    assert.equal(win.tree().props.searchBarAccessory.props.value, 'hash')
    const aes = await openForm(win, 'AES 加解密…')
    assert.equal(aes.field('direction').props.value, 'encrypt')
    assert.equal(aes.field('text').props.value, '')
    await aes.fill('text', 'hello')
    await aes.fill('key', 'pw')
    await aes.run(null, '加密')
    assert.equal(description(aes), (await aesEncrypt('hello', 'pw')).result)
    const hmac = await openForm(win, 'HMAC 计算…')
    assert.equal(hmac.field('algorithm').props.value, 'sha256')
    // 坏草稿被新编辑覆盖后，再弹出带走的是合法值
    assert.deepEqual(win.popout().seed.aesDraft, { direction: 'encrypt', text: 'hello', iv: '' })
    win.unmount()
  }
})

test('同一窗口里关掉再打开表单，草稿保留、口令清空', async () => {
  const win = await openWindow(CryptoToolCommand)
  const first = await openForm(win, 'AES 加解密…')
  await first.fill('text', 'draft')
  await first.fill('key', 'pw')
  host.pushed.pop()
  const again = await openForm(win, 'AES 加解密…')
  assert.equal(again.field('text').props.value, 'draft')
  assert.equal(again.field('key').props.value, '')
})
