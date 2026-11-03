import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, mountPushed } from '../../shared/test-harness.mjs'
import CryptoToolCommand, { cipherHmac, genUuid } from '../dist/index.js'

const host = createHost()
test.beforeEach(() => { host.reset(); delete globalThis.window?.__ztoolsLaunchContext })

const titles = (view, node) => view.actions(node).map((a) => a.props.title)

test('空状态提示行主动作是「从剪贴板粘贴」，不挂 AES / HMAC；AES 仍在列表级动作面板里', async () => {
  for (const mode of ['hash', 'url', 'unicode', 'hex', 'base64-decode']) {
    const view = await mount(CryptoToolCommand)
    try {
      await view.dropdown(mode)
      assert.deepEqual(titles(view, view.item('empty')), ['从剪贴板粘贴'], mode)
      assert.ok(titles(view, null).includes('AES 加解密…'), mode)
    } finally { view.unmount() }
  }
})

test('从剪贴板粘贴：有文字填入搜索框；剪贴板为空时提示失败且不改输入', async () => {
  const view = await mount(CryptoToolCommand)
  try {
    await view.run(view.item('empty'), '从剪贴板粘贴')
    assert.equal(view.tree().props.searchText, '')
    assert.match(host.lastToast().title, /没有文字/)
    host.clipboard.text = 'abc'
    await view.run(view.item('empty'), '从剪贴板粘贴')
    assert.equal(view.tree().props.searchText, 'abc')
    assert.equal(view.item('sha256').props.title, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  } finally { view.unmount() }
})

test('结果行：回车复制、⌘/Ctrl+Enter 是清空输入，AES 排在后面', async () => {
  const view = await mount(CryptoToolCommand)
  try {
    await view.search('abc')
    const t = titles(view, view.item('sha256'))
    assert.deepEqual(t.slice(0, 2), ['复制', '清空输入'])
  } finally { view.unmount() }
})

test('codec-base64 打开后编码与解码都能用', async () => {
  globalThis.window = globalThis.window || {}
  globalThis.window.__ztoolsLaunchContext = { featureCode: 'codec-base64' }
  const view = await mount(CryptoToolCommand)
  try {
    await view.search('中文')
    assert.equal(view.item('encoded').props.title, Buffer.from('中文').toString('base64'))
    await view.search(Buffer.from('极客').toString('base64'))
    assert.equal(view.item('decoded').props.title, '极客')
    assert.ok(view.item('encoded'))
    assert.ok(!view.text().includes('Base64 解码"'), '模式名改为编解码')
  } finally { view.unmount() }
})

test('分组标题不再全大写', async () => {
  const view = await mount(CryptoToolCommand)
  try {
    await view.dropdown('unicode')
    assert.ok(view.text().includes('Unicode 编解码'))
    assert.ok(!view.text().includes('UNICODE'))
    await view.search('a')
    assert.equal(view.item('encode').props.subtitle, 'Unicode 编码')
  } finally { view.unmount() }
})

test('HMAC：消息与密钥都为空时显示中性提示、不能复制；只填密钥（空消息）是合法 HMAC', async () => {
  host.pushed.push(cipherHmac)
  const form = await mountPushed(host)
  try {
    const desc = () => form.tree().children.find((c) => c.type === 'Form.Description').props.text
    assert.equal(desc(), '填写消息和密钥后，结果显示在这里')
    assert.deepEqual(titles(form, null), [])
    await form.fill('key', 'k')
    const crypto = await import('node:crypto')
    assert.equal(desc(), crypto.createHmac('sha256', 'k').update('').digest('hex'))
    assert.deepEqual(titles(form, null), ['复制 HMAC'])
  } finally { form.unmount() }
})

test('UUID：搜索框默认留空显示占位；留空生成 1 个；非法数量仍报错', async () => {
  const view = await mount(genUuid)
  try {
    assert.equal(view.tree().props.searchText, '')
    await view.run(view.item('uuid-result'), '生成 UUID')
    assert.match(view.item('uuid-result').props.title, /已生成 1 个/)
    await view.search('abc')
    await view.run(view.item('uuid-result'), '生成 UUID')
    assert.match(host.lastToast().title, /失败/)
  } finally { view.unmount() }
})

// 按客户端渲染器的规则取 Enter / ⌘↵：条目动作在前，再合并列表级动作；子菜单里的动作不参与主次动作
function directActions(view, item) {
  const out = []
  const visit = (node, inSubmenu) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach((n) => visit(n, inSubmenu))
    if (node.type === 'ActionPanel.Submenu') return visit(node.children, true)
    if (node.type === 'ActionPanel' || node.type === 'ActionPanel.Section') return visit(node.children, inSubmenu)
    if (node.type && node.type.startsWith('Action') && !inSubmenu && !out.includes(node.props.title)) out.push(node.props.title)
  }
  visit(item?.props?.actions, false)
  visit(view.tree().props.actions, false)
  return out
}

test('各模式的次动作（⌘↵）都与当前任务相关，不再是 AES 加解密；AES 仍可从动作面板打开', async () => {
  for (const mode of ['hash', 'url', 'unicode', 'hex', 'base64-decode']) {
    const view = await mount(CryptoToolCommand)
    try {
      await view.dropdown(mode)
      const empty = directActions(view, view.item('empty'))
      assert.equal(empty[0], '从剪贴板粘贴', mode)
      assert.ok(!empty.slice(0, 2).some((t) => /AES|HMAC|UUID/.test(t)), `${mode} 空状态：${empty.join('|')}`)
      await view.search(mode === 'hex' ? 'zz' : mode === 'base64-decode' ? '###' : mode === 'url' ? '%E4%' : 'abc')
      for (const item of view.items()) {
        const two = directActions(view, item).slice(0, 2)
        assert.ok(two.length > 0, `${mode} ${item.props.id} 没有主动作`)
        assert.ok(!two.some((t) => /AES|HMAC|UUID/.test(t)), `${mode} ${item.props.id}：${two.join('|')}`)
      }
      assert.ok(titles(view, null).includes('AES 加解密…'), mode)
      await view.run(null, 'AES 加解密…')
      assert.equal(host.pushed.length > 0, true)
    } finally { view.unmount() }
  }
})

test('分组标题不重复下拉框里的模式名', async () => {
  const dropdownTitles = ['散列与编码', 'Base64 编解码', 'URL 编解码', 'Unicode 编解码', 'Hex 编解码（UTF-8）', 'Hex 编解码']
  for (const mode of ['hash', 'url', 'unicode', 'hex', 'base64-decode']) {
    const view = await mount(CryptoToolCommand)
    try {
      await view.dropdown(mode)
      const sections = []
      const walk = (n) => { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(walk); if (n.type === 'List.Section') sections.push(n.props.title); walk(n.children) }
      walk(view.tree())
      await view.search('abc')
      walk(view.tree())
      for (const t of sections) assert.ok(!dropdownTitles.some((d) => t.startsWith(d)), `${mode}：${t}`)
    } finally { view.unmount() }
  }
})
