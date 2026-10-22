import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createHost, mount, mountPushed } from '../../shared/test-harness.mjs'
import CryptoToolCommand from '../dist/index.js'
import { calculateMultiHash, encodeBase64, decodeBase64, aesEncrypt, aesDecrypt, calculateHmac, codeBlockMarkdown, valueMarkdown } from '../dist/logic.js'

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

// ---- 表单动作：不再有「返回」占位（crypto-tool-3）----

const actionTitles = (view) => view.actions().map((a) => a.props.title)
const description = (form) => form.tree().children.find((c) => c.type === 'Form.Description').props.text

async function openForm(title) {
  const view = await mount(CryptoToolCommand)
  await view.run(null, title)
  return mountPushed(host)
}

test('AES / HMAC 表单不再声明「返回」动作：第 1 个动作是执行，⌘↵ 不会落到关闭表单上', async () => {
  const aes = await openForm('AES 加解密…')
  assert.deepEqual(actionTitles(aes), ['加密'])
  assert.equal(aes.actions()[0].type, 'Action.SubmitForm')
  // 提示与实际操作一致：不再写「按回车执行」（多行明文框里回车只会换行）
  assert.doesNotMatch(description(aes), /回车/)
  assert.match(description(aes), /「加密」/)
  await aes.fill('direction', 'decrypt')
  assert.deepEqual(actionTitles(aes), ['解密'])
  assert.match(description(aes), /「解密」/)

  await aes.fill('direction', 'encrypt')
  await aes.fill('text', '重要的明文内容\n第二行')
  await aes.fill('key', 'secret')
  await aes.run(null, '加密')
  assert.deepEqual(actionTitles(aes), ['加密', '复制结果'])
  assert.ok(!actionTitles(aes).includes('返回'))
  // 输入没有被任何动作清掉
  assert.equal(aes.field('text').props.value, '重要的明文内容\n第二行')

  host.reset()
  const hmac = await openForm('HMAC 计算…')
  assert.deepEqual(actionTitles(hmac), ['复制 HMAC'])
  await hmac.fill('text', 'msg')
  await hmac.fill('key', 'k')
  await hmac.run(null, '复制 HMAC')
  assert.equal(host.clipboard.text, crypto.createHmac('sha256', 'k').update('msg').digest('hex'))
  assert.equal(host.pushed.length, 1, '复制后表单仍在，没有被关闭')
})

test('[异常] AES 口令为空时加密失败：只剩执行动作，不出现复制，已填明文保留', async () => {
  const aes = await openForm('AES 加解密…')
  await aes.fill('text', 'hello')
  await aes.run(null, '加密')
  assert.deepEqual(actionTitles(aes), ['加密'])
  assert.match(String(host.lastToast().title), /加密失败/)
  assert.equal(aes.field('text').props.value, 'hello')
})

// ---- AES 结果必须对应当前输入（crypto-tool-v1）----

test('AES：明文、口令、IV、方向任一改变都清空旧结果，「复制结果」随之消失', async () => {
  const aes = await openForm('AES 加解密…')
  const encryptOnce = async () => {
    await aes.fill('text', 'hello')
    await aes.fill('key', 'secret')
    await aes.fill('iv', '')
    await aes.run(null, '加密')
    assert.equal(description(aes), (await aesEncrypt('hello', 'secret')).result)
    assert.ok(actionTitles(aes).includes('复制结果'))
  }
  for (const [field, value] of [['text', 'changed plaintext'], ['key', 'otherkey'], ['iv', '0123456789abcdef'], ['direction', 'decrypt']]) {
    await aes.fill('direction', 'encrypt')
    await encryptOnce()
    await aes.fill(field, value)
    assert.match(description(aes), /结果显示在这里/, `${field} 改变后仍显示旧结果`)
    assert.ok(!actionTitles(aes).includes('复制结果'), `${field} 改变后仍可复制旧结果`)
  }

  // 改完重新执行：复制到的是与当前输入对应的新密文，能用当前口令解回当前明文
  await aes.fill('direction', 'encrypt')
  await aes.fill('text', 'changed plaintext')
  await aes.fill('key', 'otherkey')
  await aes.fill('iv', '')
  await aes.run(null, '加密')
  await aes.run(null, '复制结果')
  assert.equal(host.clipboard.text, (await aesEncrypt('changed plaintext', 'otherkey')).result)
  assert.equal((await aesDecrypt(host.clipboard.text, 'otherkey')).result, 'changed plaintext')
})

test('[异常] AES：成功后再执行失败（密文被篡改）不残留上一次的结果', async () => {
  const aes = await openForm('AES 加解密…')
  await aes.fill('text', 'hello')
  await aes.fill('key', 'secret')
  await aes.run(null, '加密')
  const cipher = description(aes)
  await aes.fill('direction', 'decrypt')
  await aes.fill('text', cipher)
  await aes.run(null, '解密')
  assert.equal(description(aes), 'hello')
  // 密文被篡改：解密失败，结果区回到提示，不再显示上一次解出的明文
  const bad = Buffer.from(cipher, 'base64')
  bad[bad.length - 1] ^= 1
  await aes.fill('text', bad.toString('base64'))
  await aes.run(null, '解密')
  assert.notEqual(description(aes), 'hello')
  assert.ok(!actionTitles(aes).includes('复制结果'))
  assert.match(String(host.lastToast().title), /解密失败/)
})

// ---- 长结果在右侧预览里完整显示（crypto-tool-5）----

function parseFence(markdown) {
  const lines = markdown.split('\n')
  const fence = lines[0]
  assert.match(fence, /^`{3,}$/)
  assert.equal(lines[lines.length - 1], fence)
  const body = lines.slice(1, -1)
  // 内容里不能出现能提前结束代码块的围栏行
  for (const line of body) assert.ok(!(new RegExp('^ {0,3}`{' + fence.length + ',}\\s*$').test(line)), `内容行提前结束代码块：${line}`)
  return body.join('\n')
}

test('Base64 解码：多行长文本在右侧预览里原样完整显示（换行、缩进、Markdown 符号、反引号围栏）', async () => {
  const original = '第一行：' + '较长的中文内容，'.repeat(40) + '\n{"sub":"1234567890","name":"张三"}\n\n  缩进行 *星号* _下划线_ # 井号\n```js\nconsole.log(1)\n```\n````'
  const view = await mount(CryptoToolCommand)
  await view.dropdown('base64-decode')
  await view.search(Buffer.from(original, 'utf8').toString('base64'))
  assert.equal(view.tree().props.isShowingDetail, true)
  const item = view.item('decoded')
  assert.equal(item.props.detail.type, 'List.Item.Detail')
  assert.equal(parseFence(item.props.detail.props.markdown), original)
  await view.run(item, '复制')
  assert.equal(host.clipboard.text, original)

  // 单行长文本（如 JWT payload 的 JSON）用可折行的行内代码，不用横向滚动
  const json = JSON.stringify({ sub: '1234567890', name: '张三', note: '较长的说明'.repeat(30), admin: true })
  await view.search(Buffer.from(json, 'utf8').toString('base64url'))
  assert.equal(view.item('decoded').props.detail.props.markdown, '`' + json + '`')
})

test('[异常] Base64：空输入、非法字符、二进制数据都不开空预览，列表保持全宽', async () => {
  const view = await mount(CryptoToolCommand)
  await view.dropdown('base64-decode')
  assert.equal(view.tree().props.isShowingDetail, false)
  assert.equal(view.item('empty').props.detail, undefined)
  for (const bad of ['!!!not-base64!!!', Buffer.from([0xff, 0xfe, 0x00]).toString('base64')]) {
    await view.search(bad)
    assert.equal(view.items().length, 1)
    assert.equal(view.item('decode-error').props.detail, undefined)
  }
  await view.search('   ')
  assert.equal(view.item('empty').props.detail, undefined)
})

test('散列模式：SHA-512 与长 Base64 / URL 编码在右侧预览里给出完整值（可折行的行内代码）', async () => {
  const input = '中文 & <tag> *x* _y_ ' + 'z'.repeat(500)
  const view = await mount(CryptoToolCommand)
  assert.equal(view.tree().props.isShowingDetail, false, '空输入不开预览')
  await view.search(input)
  assert.equal(view.tree().props.isShowingDetail, true)
  const expected = {
    sha512: crypto.createHash('sha512').update(input).digest('hex'),
    base64: Buffer.from(input).toString('base64'),
    'url-encoded': encodeURIComponent(input)
  }
  for (const [id, value] of Object.entries(expected)) {
    const md = view.item(id).props.detail.props.markdown
    assert.equal(md, '`' + value + '`', id)
  }
  // 每一行都有预览，切换选中项时布局不会在全宽和分栏之间跳动
  for (const it of view.items()) assert.equal(it.props.detail?.type, 'List.Item.Detail', it.props.id)
})

test('[边界] 预览 Markdown：含空白或反引号的值退回围栏代码块，空值不报错', () => {
  assert.equal(valueMarkdown('abc'), '`abc`')
  assert.equal(valueMarkdown('a b *c* # d'), '`a b *c* # d`')
  assert.equal(valueMarkdown('{"sub":"1","name":"张三"}'), '`{"sub":"1","name":"张三"}`')
  for (const ws of ['a  b', ' a', 'a ', 'a\tb', 'a\r\nb']) assert.equal(parseFence(valueMarkdown(ws)), ws)
  assert.equal(parseFence(valueMarkdown('a`b')), 'a`b')
  assert.equal(parseFence(valueMarkdown('')), '')
  assert.equal(parseFence(codeBlockMarkdown('x\n`````\ny')), 'x\n`````\ny')
  assert.equal(codeBlockMarkdown('x\n`````\ny').split('\n')[0], '``````')
  assert.equal(parseFence(codeBlockMarkdown(undefined)), '')
})
