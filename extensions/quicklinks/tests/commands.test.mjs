import assert from 'node:assert/strict'
import test from 'node:test'
import { createHost, mount, mountPushed } from '../../shared/test-harness.mjs'
import QuicklinksCommand, { commands, getQuicklinks, saveQuicklinks, DEFAULT_QUICKLINKS } from '../dist/index.js'

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
      assert.equal(view.items().length, DEFAULT_QUICKLINKS.length)
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

test('打开网址：宿主返回失败时抛错，不提示已打开；工作流中途失败说明已打开数量', async () => {
  const { launchQuicklink } = await import('../dist/quicklinks-storage.js')
  const previous = globalThis.ztools
  try {
    globalThis.ztools = { shell: { openExternal: async () => false } }
    await assert.rejects(launchQuicklink({ id: 'a', title: 'A', link: 'https://example.com/' }), /系统未能打开/)
    let calls = 0
    globalThis.ztools = { shell: { openExternal: async () => ++calls === 1 } }
    await assert.rejects(
      launchQuicklink({ id: 'g', title: 'G', link: '', isGroup: true, urls: ['https://a.example/', 'https://b.example/'] }),
      /已打开 1 个，第 2 个打开失败/
    )
    globalThis.ztools = undefined
    globalThis.__ztoolsElectron = { transport: { methods: { shell_open_external: async (request) => ({ success: request.params?.url === 'https://example.com/' }) } } }
    assert.deepEqual(await launchQuicklink({ id: 'a', title: 'A', link: 'https://example.com/' }), ['https://example.com/'])
    globalThis.__ztoolsElectron = undefined
    await assert.rejects(launchQuicklink({ id: 'a', title: 'A', link: 'https://example.com/' }), /不支持打开网址/)
  } finally {
    globalThis.ztools = previous
    delete globalThis.__ztoolsElectron
  }
})

test('网址校验：缺域名、带账号密码、空网址拒绝；带属性占位符算搜索类', async () => {
  const { validateQuicklinkUrlPattern, inferQuicklinkCategory, parseGroupUrls } = await import('../dist/quicklinks-storage.js')
  assert.equal(validateQuicklinkUrlPattern('https://').valid, false)
  assert.match(validateQuicklinkUrlPattern('https://user:pw@example.com/').error, /账号或密码/)
  assert.equal(validateQuicklinkUrlPattern('https://{query}.example.com/').valid, true)
  assert.equal(inferQuicklinkCategory({ link: 'https://a.example/?q={query default="x"}' }), 'search')
  assert.equal(inferQuicklinkCategory({ link: 'https://a.example/' }), 'direct')
  assert.match(parseGroupUrls('https://a.example/\n\njavascript:alert(1)').error, /第 2 行/)
  assert.match(parseGroupUrls('  \n ').error, /至少需要一个/)
  assert.deepEqual(parseGroupUrls('a.example\nhttps://b.example/').urls, ['https://a.example', 'https://b.example/'])
})

test('新建与编辑拒绝重复别名和含空格别名，不写入存储', async () => {
  const { host, data } = setup()
  const view = await mount(commands['quicklinks-new'])
  const form = await mountPushed(host)
  try {
    await form.fill('title', '重复'); await form.fill('link', 'https://example.com/'); await form.fill('keyword', 'GH')
    await form.run(null, '保存快捷链接')
    assert.equal(host.lastToast().style, 'FAILURE'); assert.match(host.lastToast().title, /已被/)
    await form.fill('keyword', 'a b'); await form.run(null, '保存快捷链接')
    assert.match(host.lastToast().title, /空格/)
    assert.equal(data.get(key), undefined); assert.equal(host.pushed.length, 1)
  } finally { form.unmount(); view.unmount() }
  const list = await mount(QuicklinksCommand)
  await list.run(list.item('ql-2'), '编辑此快捷链接')
  const edit = await mountPushed(host)
  try {
    await edit.fill('keyword', 'gh'); await edit.run(null, '保存修改')
    assert.match(host.lastToast().title, /已被/); assert.equal(data.get(key), undefined)
    await edit.fill('keyword', 'zh'); await edit.run(null, '保存修改')
    assert.equal((await getQuicklinks()).find((i) => i.id === 'ql-2').alias, 'zh')
  } finally { edit.unmount(); list.unmount() }
})

test('编辑直达链接加上 {query} 后归入搜索类；编辑网址组修改的是组内网址', async () => {
  const { host } = setup()
  const view = await mount(QuicklinksCommand)
  try {
    await view.run(view.item('ql-4'), '编辑此快捷链接')
    let form = await mountPushed(host)
    await form.fill('link', 'https://chat.deepseek.com/?q={query}'); await form.run(null, '保存修改'); form.unmount()
    assert.equal((await getQuicklinks()).find((i) => i.id === 'ql-4').category, 'search')
    await view.dropdown('search')
    assert.ok(view.items().some((i) => i.props.id === 'ql-4'))
    await view.dropdown('all')
    await view.run(view.item('ql-5'), '编辑此快捷链接')
    form = await mountPushed(host)
    assert.equal(form.field('urls').props.value.split('\n').length, 3)
    await form.fill('urls', 'https://a.example/\nbad url'); await form.run(null, '保存修改')
    assert.match(host.lastToast().title, /第 2 行/); assert.equal(host.pushed.length, 1)
    await form.fill('urls', 'https://a.example/\nb.example'); await form.run(null, '保存修改'); form.unmount()
    const group = (await getQuicklinks()).find((i) => i.id === 'ql-5')
    assert.deepEqual(group.urls, ['https://a.example/', 'https://b.example'])
    assert.equal(group.category, 'group')
    const opened = []
    const { launchQuicklink } = await import('../dist/quicklinks-storage.js')
    await launchQuicklink(group, '', (u) => { opened.push(u) })
    assert.deepEqual(opened, group.urls)
    const copy = view.actions(view.item('ql-5')).find((a) => a.props.title === '复制组内全部网址')
    assert.equal(copy.props.content, 'https://a.example/\nhttps://b.example')
  } finally { view.unmount() }
})

test('删除需确认，取消不删；存储失败如实抛错保留列表', async () => {
  const { host, fault } = setup()
  const view = await mount(QuicklinksCommand)
  try {
    host.setConfirm(false)
    await view.run(view.item('ql-1'), '删除此快捷链接')
    assert.ok(view.item('ql-1')); assert.equal(host.confirms.length, 1)
    host.setConfirm(true); fault.write = true
    await assert.rejects(view.run(view.item('ql-1'), '删除此快捷链接'), /保存失败/)
    assert.ok(view.item('ql-1'))
    fault.write = false
    await view.run(view.item('ql-1'), '删除此快捷链接')
    assert.ok(!view.items().some((i) => i.props.id === 'ql-1'))
    assert.ok(!(await getQuicklinks()).some((i) => i.id === 'ql-1'))
  } finally { view.unmount() }
})

test('恢复默认需确认；保存失败提示失败且不显示成功', async () => {
  const { host, data, fault } = setup()
  await saveQuicklinks([{ id: 'mine', title: '自定义', link: 'https://example.com/' }])
  const before = data.get(key)
  const view = await mount(QuicklinksCommand)
  const reset = () => view.tree().props.filterBar.actions.find((a) => a.id === 'reset-default').onAction()
  try {
    host.setConfirm(false); await reset()
    assert.equal(data.get(key), before); assert.equal(host.toasts.length, 0)
    host.setConfirm(true); fault.write = true; await reset()
    assert.equal(data.get(key), before); assert.equal(host.lastToast().style, 'FAILURE')
    assert.deepEqual(view.items().map((i) => i.props.id), ['mine'])
    fault.write = false; await reset(); await new Promise((r) => setTimeout(r, 0))
    assert.equal(view.items().length, DEFAULT_QUICKLINKS.length); assert.equal(host.lastToast().style, 'SUCCESS')
  } finally { view.unmount() }
})

test('默认预设不含维护者内部网址；搜索预设与命令说明列出的平台一致', async () => {
  const text = JSON.stringify(DEFAULT_QUICKLINKS)
  assert.doesNotMatch(text, /ZToolsTeam|ztools\.cn|catalog\.json/i)
  const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../plugin.json', import.meta.url), 'utf8'))
  const explain = manifest.features.find((f) => f.code === 'quicklinks-search-engines').explain
  const titles = DEFAULT_QUICKLINKS.filter((i) => i.category === 'search').map((i) => i.title).join(' ')
  for (const [mention, title] of [['知乎', '知乎'], ['GitHub', 'GitHub'], ['B站', '哔哩哔哩'], ['谷歌', '谷歌'], ['小红书', '小红书']]) {
    if (explain.includes(mention)) assert.match(titles, new RegExp(title), `说明提到 ${mention} 但没有对应预设`)
  }
  for (const item of DEFAULT_QUICKLINKS) assert.doesNotMatch(item.title, /\([A-Za-z]/, item.title)
})

test('已有用户数据不会被新的默认预设改写', async () => {
  const { data } = setup()
  const legacy = [{ id: 'ql-5', title: '晨会研发看板与流水线网址组', link: 'https://example.com/', isGroup: true, urls: ['https://example.com/a'] }]
  data.set(key, JSON.stringify(legacy))
  const items = await getQuicklinks()
  assert.equal(items.length, 1); assert.equal(items[0].title, '晨会研发看板与流水线网址组')
})

test('新建表单可创建网址组：逐行校验，保存后归入网址组并能按顺序打开', async () => {
  const { host } = setup()
  await saveQuicklinks([])
  const view = await mount(commands['quicklinks-open-groups'])
  try {
    const create = view.tree().props.filterBar.actions.find((a) => a.id === 'create')
    assert.equal(create.title, '新建快捷链接')
    await create.onAction()
    const form = await mountPushed(host)
    try {
      assert.equal(form.field('kind').props.value, 'group')
      await form.fill('title', '上班网页')
      await form.fill('urls', 'https://a.example/\nnot a url')
      await form.run(null, '保存快捷链接')
      assert.match(host.lastToast().title, /第 2 行/); assert.deepEqual(await getQuicklinks(), [])
      await form.fill('urls', 'https://a.example/\nb.example')
      await form.fill('keyword', 'work')
      await form.run(null, '保存快捷链接')
    } finally { form.unmount() }
    const [group] = await getQuicklinks()
    assert.equal(group.isGroup, true); assert.equal(group.category, 'group')
    assert.deepEqual(group.urls, ['https://a.example/', 'https://b.example'])
    assert.equal(view.item(group.id).props.title, '上班网页')
    const opened = []
    const { launchQuicklink } = await import('../dist/quicklinks-storage.js')
    await launchQuicklink(group, '', (u) => { opened.push(u) })
    assert.deepEqual(opened, group.urls)
  } finally { view.unmount() }
})
