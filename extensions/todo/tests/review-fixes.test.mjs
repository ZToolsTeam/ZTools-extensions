// 本轮审查修复的回归用例：重复动作、表单预填、连按回车、损坏数据可备份恢复、日期显示
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import TodoCommand from '../dist/index.js'
import { createTodo, formatListDate, readStoredTodos, CorruptTodosError, TODOS_STORAGE_KEY } from '../dist/logic.js'

const host = createHost()
test.beforeEach(() => host.reset())

const seed = (v) => host.storage.set(TODOS_STORAGE_KEY, JSON.stringify(v))
const saved = () => JSON.parse(host.storage.get(TODOS_STORAGE_KEY))

test('单条待办的动作不再重复 List 级的「新建 / 清空已完成」（客户端会把 List 级动作附在后面）', async () => {
  seed([createTodo('任务')])
  const view = await mount(TodoCommand)
  const itemTitles = view.actions(view.items()[0]).map((a) => a.props.title)
  const globalTitles = view.actions(null).map((a) => a.props.title)
  assert.deepEqual(itemTitles, ['标为已完成', '复制待办标题', '删除此待办'])
  for (const t of itemTitles) assert.equal(globalTitles.includes(t), false, `「${t}」重复出现在全局动作里`)
})

test('空状态条目直接复用 List 级动作，不另造一份同名动作', async () => {
  const view = await mount(TodoCommand)
  const titles = (n) => view.actions(n).map((a) => a.props.title)
  assert.deepEqual(titles(view.items()[0]), titles(null))
  assert.deepEqual(titles(null), ['新建待办事项'])
})

test('「填写详情后添加」把搜索框里的文字预填为标题；表单只有「保存」一个动作', async () => {
  const view = await mount(TodoCommand)
  await view.search('写周报')
  await view.run(view.item('quick-add'), '填写详情后添加…')
  const form = await mountPushed(host)
  assert.equal(form.field('title').props.value, '写周报')
  assert.deepEqual(form.actions(null).map((a) => a.props.title), ['保存待办'])
  await form.fill('priority', 'high')
  await form.run(null, '保存待办')
  await tick()
  assert.deepEqual(saved().map((t) => [t.title, t.priority]), [['写周报', 'high']])
})

test('[并发] 连按两次回车只添加一条', async () => {
  const view = await mount(TodoCommand)
  await view.search('只添加一次')
  const add = view.actions(view.item('quick-add'))[0]
  await Promise.all([add.props.onAction(), add.props.onAction()])
  await tick()
  assert.equal(saved().length, 1)
})

test('[并发] 表单保存进行中再次提交不会重复创建', async () => {
  const view = await mount(TodoCommand)
  await view.run(null, '新建待办事项')
  const form = await mountPushed(host)
  await form.fill('title', '表单任务')
  const submit = form.actions(null)[0]
  await Promise.all([submit.props.onSubmit({}), submit.props.onSubmit({})])
  await tick()
  assert.equal(saved().length, 1)
})

test('[数据损坏] 读回损坏数据：暂停修改，确认后完整备份原值再从空列表开始', async () => {
  const broken = [createTodo('好条目'), { id: 'bad', title: '' }]
  seed(broken)
  const view = await mount(TodoCommand)
  assert.equal(view.items()[0].props.title, '待办数据已损坏，已暂停修改')
  // 取消确认：原数据不动
  host.setConfirm(false)
  await view.run(null, '备份原数据并重新开始')
  assert.deepEqual(saved(), broken)
  host.setConfirm(true)
  await view.run(null, '备份原数据并重新开始')
  await tick()
  assert.deepEqual(saved(), [])
  const backupKey = [...host.storage.keys()].find((k) => k.startsWith(`${TODOS_STORAGE_KEY}.backup-`))
  assert.ok(backupKey, '应写入备份项')
  assert.deepEqual(JSON.parse(host.storage.get(backupKey)), broken)
  assert.equal(view.items()[0].props.title, '还没有待办')
})

test('[故障注入] 备份写入失败时不清空原数据，并如实提示', async () => {
  const broken = 'not-an-array'
  seed(broken)
  const view = await mount(TodoCommand)
  host.setConfirm(true)
  host.faults.storageWrite = new Error('磁盘已满')
  await view.run(null, '备份原数据并重新开始')
  assert.equal(saved(), broken)
  assert.match(String(host.lastToast().title), /备份或重置失败，原数据未改动/)
})

test('[竞态] 备份前数据已被其他窗口改动：拒绝重置，不覆盖新数据', async () => {
  seed('broken')
  const view = await mount(TodoCommand)
  const fresh = [createTodo('其他窗口刚写入')]
  seed(fresh)
  host.setConfirm(true)
  await view.run(null, '备份原数据并重新开始')
  assert.deepEqual(saved(), fresh)
  assert.match(String(host.lastToast().message), /已变化/)
})

test('[数据损坏] 读取正常但保存时发现其他窗口写坏了数据：不写入，转入可备份状态', async () => {
  seed([createTodo('原有')])
  const view = await mount(TodoCommand)
  seed({ broken: true })
  await view.search('新任务')
  await view.run(view.item('quick-add'), '添加待办')
  assert.deepEqual(saved(), { broken: true })
  assert.match(String(host.lastToast().title), /保存失败/)
  assert.ok(view.actions(null).some((a) => a.props.title === '备份原数据并重新开始'))
})

test('readStoredTodos：未存过返回空列表，结构不对抛带原值的 CorruptTodosError', () => {
  assert.deepEqual(readStoredTodos(undefined), [])
  assert.throws(() => readStoredTodos(null), (e) => e instanceof CorruptTodosError && e.raw === null)
  assert.throws(() => readStoredTodos([{ id: 1 }]), CorruptTodosError)
})

test('[边界] 列表日期：无时间不显示、跨年带年份、今年只显示月日', async () => {
  const now = new Date(2026, 9, 28).getTime()
  assert.equal(formatListDate(0, now), '')
  assert.equal(formatListDate(NaN, now), '')
  assert.match(formatListDate(new Date(2025, 11, 31).getTime(), now), /2025/)
  assert.doesNotMatch(formatListDate(new Date(2026, 0, 2).getTime(), now), /2026/)
  seed([{ id: 'old', title: '没有创建时间的旧待办', completed: false, priority: 'medium' }])
  const view = await mount(TodoCommand)
  assert.deepEqual(view.item('old').props.accessories.map((a) => a.text), ['待处理'])
})

test('只有存在已完成待办时才提供「清空已完成待办」，清空后再次隐藏', async () => {
  seed([createTodo('任务')])
  const view = await mount(TodoCommand)
  const has = () => view.actions(null).some((a) => a.props.title === '清空已完成待办')
  assert.equal(has(), false)
  await view.run(view.items()[0], '标为已完成'); await tick()
  assert.equal(has(), true)
  await view.run(null, '清空已完成待办'); await tick()
  assert.deepEqual(saved(), [])
  assert.equal(has(), false)
})
