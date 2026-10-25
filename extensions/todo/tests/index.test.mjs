import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import TodoCommand from '../dist/index.js'
import { sanitizeStoredTodos, TODOS_STORAGE_KEY, createTodo, filterAndSearchTodos } from '../dist/logic.js'

const host = createHost()
test.beforeEach(() => host.reset())

test('首次打开没有示例数据，显示空状态', async () => {
  const view = await mount(TodoCommand)
  assert.equal(view.items().length, 1)
  assert.equal(view.items()[0].props.title, '还没有待办')
  assert.ok(!view.text().includes('全面落地纯声明式'))
})

test('输入后回车直接添加，写入插件存储；重新打开仍在', async () => {
  let view = await mount(TodoCommand)
  await view.search('买牛奶')
  await view.run(view.item('quick-add'), '添加待办')
  assert.equal(host.storage.has(TODOS_STORAGE_KEY), true)
  const saved = JSON.parse(host.storage.get(TODOS_STORAGE_KEY))
  assert.equal(saved[0].title, '买牛奶')
  view.unmount()
  view = await mount(TodoCommand)
  assert.ok(view.items().some((i) => i.props.title === '买牛奶'))
})

test('通过表单添加：高优先级排在前面；切换完成状态与清空已完成都持久化', async () => {
  host.storage.set(TODOS_STORAGE_KEY, JSON.stringify([createTodo('普通任务', 'low')]))
  const view = await mount(TodoCommand)
  await view.run(null, '新建待办事项')
  const form = await mountPushed(host)
  await form.fill('title', '紧急任务')
  await form.fill('priority', 'high')
  await form.run(null, '保存待办')
  await tick()
  let titles = view.items().map((i) => i.props.title)
  assert.deepEqual(titles.slice(0, 2), ['紧急任务', '普通任务'])
  await view.run(view.item((i) => i.props.title === '紧急任务'), '标为已完成')
  assert.equal(JSON.parse(host.storage.get(TODOS_STORAGE_KEY)).find((t) => t.title === '紧急任务').completed, true)
  await view.run(null, '清空已完成待办')
  titles = JSON.parse(host.storage.get(TODOS_STORAGE_KEY)).map((t) => t.title)
  assert.deepEqual(titles, ['普通任务'])
})

test('[故障注入] 存储写入失败时界面不变，并提示保存失败', async () => {
  const view = await mount(TodoCommand)
  host.faults.storageWrite = new Error('磁盘已满')
  await view.search('写不进去的待办')
  await view.run(view.item('quick-add'), '添加待办')
  assert.equal(view.items().some((i) => i.props.title === '写不进去的待办'), false)
  assert.match(String(host.lastToast().title), /保存失败/)
})

test('[故障注入] 存储读取失败时提示，并保持可用的空列表', async () => {
  host.faults.storageRead = new Error('数据库被占用')
  const view = await mount(TodoCommand)
  assert.ok(host.toasts.some((t) => /读取待办失败/.test(String(t.title))))
  assert.equal(view.items()[0].props.id, 'empty-item')
})

test('[数据损坏] 存储里的脏数据被过滤，不导致崩溃', () => {
  const ok = createTodo('正常')
  const out = sanitizeStoredTodos([ok, null, 42, { id: 'x' }, { id: ok.id, title: '重复 ID' }, { id: 'y', title: '   ' }, { id: 'z', title: '未知优先级', priority: 'urgent' }])
  assert.deepEqual(out.map((t) => t.title), ['正常', '未知优先级'])
  assert.equal(out[1].priority, 'medium')
  assert.deepEqual(sanitizeStoredTodos('not-array'), [])
  assert.deepEqual(sanitizeStoredTodos(undefined), [])
})

test('[边界] 空标题拒绝；搜索与筛选组合', () => {
  assert.throws(() => createTodo('   '), /不能为空/)
  const list = [createTodo('A 任务', 'low'), { ...createTodo('B 任务', 'high'), completed: true }]
  assert.deepEqual(filterAndSearchTodos(list, 'active').map((t) => t.title), ['A 任务'])
  assert.deepEqual(filterAndSearchTodos(list, 'all', 'b').map((t) => t.title), ['B 任务'])
})

// 宿主在搜索词变化后选中第一项，回车执行它的第一个动作
async function pressEnter(view) {
  const first = view.items()[0]
  const primary = view.actions(first)[0]
  await view.run(first, primary.props.title)
  return { first, primary }
}

function seed(list) {
  host.storage.set(TODOS_STORAGE_KEY, JSON.stringify(list))
}

function saved() {
  return JSON.parse(host.storage.get(TODOS_STORAGE_KEY))
}

test('[todo-1] 输入内容是已有待办标题的一部分：「添加待办」排第一，回车添加新待办且不改动已有待办', async () => {
  const milk = { ...createTodo('买牛奶'), id: 'a' }
  seed([milk])
  const view = await mount(TodoCommand)
  await view.search('牛奶')
  const ids = view.items().map((i) => i.props.id)
  assert.deepEqual(ids, ['quick-add', 'a'], '部分匹配的已有待办排在「添加待办」后面，仍可用 ↓ 选中')
  const { primary } = await pressEnter(view)
  assert.equal(primary.props.title, '添加待办')
  const list = saved()
  assert.deepEqual(list.map((t) => t.title), ['牛奶', '买牛奶'])
  assert.equal(list.find((t) => t.id === 'a').completed, false, '已有待办不能被标为完成')
  assert.ok(!host.toasts.some((t) => /已标为完成/.test(String(t.title))))
  assert.match(String(host.lastToast().title), /已添加待办/)
})

test('[todo-1] 英文大小写不同的部分匹配同样走添加；标题完全相同（忽略大小写与首尾空格）时不重复添加', async () => {
  seed([{ ...createTodo('Write report', 'high'), id: 'b' }, { ...createTodo('write'), id: 'w' }])
  const view = await mount(TodoCommand)
  await view.search('REPORT')
  assert.equal(view.items()[0].props.id, 'quick-add')
  await view.search('  WRITE ')
  const ids = view.items().map((i) => i.props.id)
  assert.equal(ids.includes('quick-add'), false, '完全同名时不再提供添加')
  assert.equal(ids[0], 'w', '完全同名的条目排在最前，即使另一条优先级更高')
})

test('[todo-1][边界] 只输入空格：不展示待办、回车不改动任何数据', async () => {
  const items = [{ ...createTodo('第一条', 'high'), id: 'x' }, { ...createTodo('第二条'), id: 'y' }]
  seed(items)
  const before = host.storage.get(TODOS_STORAGE_KEY)
  const view = await mount(TodoCommand)
  for (const blank of ['   ', '\t', ' 　 ']) {
    await view.search(blank)
    const shown = view.items()
    assert.deepEqual(shown.map((i) => i.props.id), ['empty-item'])
    assert.equal(shown[0].props.title, '请输入待办内容')
    const { primary } = await pressEnter(view)
    assert.equal(primary.props.title, '新建待办', '主动作只打开表单，不写数据')
    host.pushed.length = 0
  }
  assert.equal(host.storage.get(TODOS_STORAGE_KEY), before)
  assert.ok(!host.toasts.some((t) => /已标为|已添加/.test(String(t.title))))
})

test('[todo-1][故障注入] 部分匹配时添加遇到写入失败：已有待办与存储都保持原样', async () => {
  seed([{ ...createTodo('买牛奶'), id: 'a' }])
  const before = host.storage.get(TODOS_STORAGE_KEY)
  const view = await mount(TodoCommand)
  host.faults.storageWrite = new Error('磁盘已满')
  await view.search('牛奶')
  await pressEnter(view)
  assert.equal(host.storage.get(TODOS_STORAGE_KEY), before)
  assert.match(String(host.lastToast().title), /保存失败/)
  assert.deepEqual(view.items().map((i) => i.props.id), ['quick-add', 'a'], '失败后输入保留，可重试')
  assert.equal(view.item('a').props.accessories[0].text, '待处理')
})

test('[回归] 读取失败后禁止添加，恢复读取后保留原待办', async () => {
  const previous = [createTodo('不能丢失的待办')]
  seed(previous)
  host.faults.storageRead = new Error('暂时无法读取')
  const view = await mount(TodoCommand)
  await view.search('新待办')
  assert.equal(view.items().some(i => i.props.id === 'quick-add'), false)
  await view.run(null, '新建待办事项')
  assert.equal(host.pushed.length, 0)
  assert.deepEqual(saved(), previous)
  host.faults.storageRead = null
  await view.run(null, '重新读取待办')
  await tick()
  await view.run(view.item('quick-add'), '添加待办')
  assert.deepEqual(saved().map(i => i.title).sort(), ['不能丢失的待办', '新待办'].sort())
  view.unmount()
})

test('[回归] 两个窗口同时添加，冲突后重读合并而非覆盖快照', async () => {
  seed([createTodo('原有待办')])
  const a = await mount(TodoCommand)
  const b = await mount(TodoCommand)
  await a.search('窗口 A')
  await b.search('窗口 B')
  await Promise.all([a.run(a.item('quick-add'), '添加待办'), b.run(b.item('quick-add'), '添加待办')])
  assert.deepEqual(saved().map(i => i.title).sort(), ['原有待办', '窗口 A', '窗口 B'].sort())
  a.unmount(); b.unmount()
})

test('[回归] 旧窗口执行标为完成按明确意图更新，不反转其他窗口已完成的状态', async () => {
  const item = createTodo('同一个任务')
  seed([item])
  const a = await mount(TodoCommand), b = await mount(TodoCommand)
  await a.run(a.item(item.id), '标为已完成')
  await b.run(b.item(item.id), '标为已完成')
  assert.equal(saved()[0].completed, true)
  a.unmount(); b.unmount()
})
