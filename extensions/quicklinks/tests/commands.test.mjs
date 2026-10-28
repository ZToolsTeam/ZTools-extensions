import assert from 'node:assert/strict'
import test from 'node:test'
import { createHost, mount, mountPushed } from '../../shared/test-harness.mjs'
import QuicklinksCommand, { commands, getQuicklinks, saveQuicklinks } from '../dist/index.js'

const key = 'ztools:quicklinks:data'
function setup() {
  const host = createHost()
  const data = new Map()
  const fault = { read: false, write: false }
  globalThis.localStorage = {
    getItem(key) { if (fault.read) throw new Error('读取失败'); return data.get(key) ?? null },
    setItem(key, value) { if (fault.write) throw new Error('保存失败'); data.set(key, value) }
  }
  return { host, data, fault }
}

test('新建入口无参可渲染表单，保存自定义链接保留已有项', async () => {
  const { host, data } = setup()
  data.set(key, JSON.stringify([{ id: 'old', title: '原有', link: 'https://example.com/' }]))
  const view = await mount(commands['quicklinks-new'])
  const form = await mountPushed(host)
  try {
    assert.equal(form.tree().type, 'Form')
    await form.fill('title', '本地搜索')
    await form.fill('link', 'http://127.0.0.1:65304/?q={query}')
    await form.fill('keyword', 'audit')
    await form.run(null, '保存快捷链接')
    assert.equal(host.pushed.length, 0)
    assert.deepEqual((await getQuicklinks()).map((item) => item.title), ['本地搜索', '原有'])
    assert.deepEqual(view.items().map((item) => item.props.title), ['本地搜索', '原有'])
    assert.equal(host.pushed.length, 0, '保存后不能再次打开同一表单')
  } finally { form.unmount(); view.unmount() }
})

test('保存失败保留表单和原数据，不弹成功提示；空列表不恢复默认', async () => {
  const { host, data, fault } = setup()
  await saveQuicklinks([])
  assert.deepEqual(await getQuicklinks(), [])
  const before = data.get(key)
  const view = await mount(commands['quicklinks-new'])
  const form = await mountPushed(host)
  try {
    await form.fill('title', '不会保存')
    await form.fill('link', 'https://example.com/')
    fault.write = true
    await assert.rejects(form.run(null, '保存快捷链接'), /保存失败/)
    assert.equal(data.get(key), before)
    assert.equal(host.pushed.length, 1)
    assert.equal(host.toasts.length, 0)
  } finally { form.unmount(); view.unmount() }
})

test('损坏数据和读取失败不替换为默认；新建无法覆盖原数据', async () => {
  for (const corrupt of [false, true]) {
    const { host, data, fault } = setup()
    data.set(key, corrupt ? '{invalid' : '[]')
    fault.read = !corrupt
    const before = data.get(key)
    const view = await mount(commands['quicklinks-new'])
    try {
      assert.match(view.text(), /无法读取快捷链接/)
      assert.equal(view.tree().props.filterBar, undefined)
      assert.equal(host.pushed.length, 0)
      assert.equal(data.get(key), before)
    } finally { view.unmount() }
  }
})

test('搜索与网址组快捷入口按类型筛选，切换类型清理旧查询', async () => {
  for (const [feature, category] of [['quicklinks-search-engines', 'search'], ['quicklinks-open-groups', 'group']]) {
    setup()
    const view = await mount(commands[feature])
    try {
      assert.equal(view.tree().props.searchBarAccessory.props.value, category)
      assert.ok(view.items().length > 0)
      await view.search('无结果'); await view.dropdown('all')
      assert.equal(view.tree().props.searchText, '')
      assert.equal(view.items().length, 5)
    } finally { view.unmount() }
  }
})

test('编辑存储失败保留表单，成功后列表和持久化同步更新', async () => {
  const { host, fault } = setup()
  const view = await mount(QuicklinksCommand)
  await view.run(view.item('ql-1'), '编辑此快捷链接')
  const form = await mountPushed(host)
  try {
    await form.fill('title', '更新标题')
    fault.write = true
    await assert.rejects(form.run(null, '保存修改'), /保存失败/)
    assert.equal(host.pushed.length, 1)
    assert.notEqual(view.item('ql-1').props.title, '更新标题')
    fault.write = false
    await form.run(null, '保存修改')
    assert.equal(view.item('ql-1').props.title, '更新标题')
    assert.equal((await getQuicklinks())[0].title, '更新标题')
    assert.equal(host.pushed.length, 0)
  } finally { form.unmount(); view.unmount() }
})
