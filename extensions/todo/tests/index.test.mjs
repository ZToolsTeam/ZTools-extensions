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
