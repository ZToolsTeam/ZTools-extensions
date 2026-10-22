import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import MemoCommand from '../dist/index.js'
import { readLegacyMemos, readLegacyNotes, sanitizeStoredMemos, MEMOS_STORAGE_KEY, LEGACY_LOCALSTORAGE_KEY, LEGACY_NOTES_LOCALSTORAGE_KEY, createMemo } from '../dist/logic.js'

const host = createHost()
test.beforeEach(() => {
  host.reset()
  delete globalThis.localStorage
})

test('首次打开没有示例便签', async () => {
  const view = await mount(MemoCommand)
  assert.ok(!view.text().includes('ZTools 架构设计核心准则'))
  assert.equal(view.items()[0].props.title, '还没有便签')
})

test('新建、编辑、删除（需确认）都写入插件存储', async () => {
  const view = await mount(MemoCommand)
  await view.run(view.item('empty'), '新建便签')
  let form = await mountPushed(host)
  await form.fill('title', '会议纪要')
  await form.fill('content', '- 第一项\n- 第二项')
  await form.fill('tag', '工作')
  await form.run(null, '保存')
  await tick()
  let stored = JSON.parse(host.storage.get(MEMOS_STORAGE_KEY))
  assert.equal(stored[0].title, '会议纪要')
  const item = view.items().find((i) => i.props.title === '会议纪要')
  assert.ok(JSON.stringify(item.props.detail).includes('第一项'))

  await view.run(item, '编辑便签')
  form = await mountPushed(host)
  await form.fill('title', '会议纪要（改）')
  await form.run(null, '保存')
  await tick()
  stored = JSON.parse(host.storage.get(MEMOS_STORAGE_KEY))
  assert.equal(stored.length, 1)
  assert.equal(stored[0].title, '会议纪要（改）')

  host.setConfirm(false)
  await view.run(view.items()[0], '删除便签')
  assert.equal(JSON.parse(host.storage.get(MEMOS_STORAGE_KEY)).length, 1)
  host.setConfirm(true)
  await view.run(view.items()[0], '删除便签')
  assert.equal(JSON.parse(host.storage.get(MEMOS_STORAGE_KEY)).length, 0)
})

test('表单只有「保存」一个动作：宿主表单里 ⌘↵ 执行的是保存，不会因为第 2 个「返回」动作丢掉输入', async () => {
  const view = await mount(MemoCommand)
  await view.run(view.item('empty'), '新建便签')
  const form = await mountPushed(host)
  const actions = form.actions(null)
  assert.deepEqual(actions.map((a) => a.props.title), ['保存'])
  assert.equal(actions[0].type, 'Action.SubmitForm')
})

test('[迁移] 旧版存在浏览器缓存里的便签迁移过来，示例便签不迁移', async () => {
  const mine = createMemo([], '我的旧便签', '内容', '')[0]
  const legacy = [mine, { id: 'memo-1', title: 'ZTools 架构设计核心准则', content: 'x', tag: '工作', createTime: 1, updateTime: 1 }]
  globalThis.localStorage = { getItem: (k) => (k === LEGACY_LOCALSTORAGE_KEY ? JSON.stringify(legacy) : null) }
  const view = await mount(MemoCommand)
  await tick()
  const titles = view.items().map((i) => i.props.title)
  assert.deepEqual(titles, ['我的旧便签'])
  assert.equal(JSON.parse(host.storage.get(MEMOS_STORAGE_KEY))[0].title, '我的旧便签')
})

test('[故障注入] 保存失败时表单不关闭；旧数据损坏时不迁移也不崩溃', async () => {
  const view = await mount(MemoCommand)
  await view.run(view.item('empty'), '新建便签')
  const form = await mountPushed(host)
  host.faults.storageWrite = new Error('磁盘已满')
  await form.fill('title', 'x')
  await form.run(null, '保存')
  assert.equal(host.pushed.length, 1)
  assert.match(String(host.lastToast().title), /保存失败/)

  assert.deepEqual(readLegacyMemos({ getItem: () => '{broken json' }), [])
  assert.deepEqual(readLegacyMemos({ getItem: () => { throw new Error('denied') } }), [])
  assert.deepEqual(sanitizeStoredMemos([null, { id: 1 }, { id: 'a', title: 't', content: 'c' }]).map((m) => m.id), ['a'])
})

test('[边界] 标题和正文都为空时不保存', async () => {
  const view = await mount(MemoCommand)
  await view.run(view.item('empty'), '新建便签')
  const form = await mountPushed(host)
  await form.run(null, '保存')
  assert.equal(host.storage.has(MEMOS_STORAGE_KEY), false)
  assert.equal(form.field('title').props.error, '标题和正文不能都为空')
})

test('[迁移] 已合并进来的旧「轻量便签记事」笔记一并导入便签，示例笔记不导入，与旧便签同时存在时都保留', async () => {
  const notes = [
    { id: 'note-1', title: 'ZTools 架构设计纲领', content: '示例', pinned: true, createdAt: 1, updatedAt: 2, tags: ['architecture'] },
    { id: 'n-42', title: '周会记录', content: '- 讨论插件平台', pinned: false, createdAt: 100, updatedAt: 200, tags: ['工作', '会议'] }
  ]
  const memo = createMemo([], '旧便签', '内容', '')[0]
  // 旧 notes 插件把 JSON 字符串又序列化了一次
  globalThis.localStorage = {
    getItem: (k) => (k === LEGACY_NOTES_LOCALSTORAGE_KEY ? JSON.stringify(JSON.stringify(notes)) : k === LEGACY_LOCALSTORAGE_KEY ? JSON.stringify([memo]) : null)
  }
  const view = await mount(MemoCommand)
  await tick()
  const titles = view.items().map((i) => i.props.title).sort()
  assert.deepEqual(titles, ['周会记录', '旧便签'].sort())
  const stored = JSON.parse(host.storage.get(MEMOS_STORAGE_KEY))
  const meeting = stored.find((m) => m.title === '周会记录')
  assert.equal(meeting.tag, '工作 会议')
  assert.equal(meeting.updateTime, 200)
  assert.match(String(host.lastToast().title), /已迁移 2 条/)
  // 已有存储时不再重复导入
  globalThis.localStorage.getItem = () => { throw new Error('不应再读旧数据') }
  const again = await mount(MemoCommand)
  await tick()
  assert.equal(again.items().length, 2)
})

test('[破坏性] 旧笔记数据损坏、只有一层序列化、条目结构不对时不崩溃，只导入合法条目', () => {
  const read = (value) => readLegacyNotes({ getItem: () => value })
  assert.deepEqual(read('{broken'), [])
  assert.deepEqual(read(JSON.stringify(JSON.stringify('不是数组'))), [])
  assert.deepEqual(readLegacyNotes({ getItem: () => { throw new Error('denied') } }), [])
  assert.deepEqual(readLegacyNotes(undefined), [])
  const once = read(JSON.stringify([{ id: 'a', title: 't', content: 'c', tags: [1, '', 'x'] }, { id: 7 }, null, { id: 'b', title: 'no content' }]))
  assert.deepEqual(once.map((m) => [m.id, m.tag]), [['notes-a', 'x']])
})


// ---- memo-1：读取失败 / 数据损坏时不能覆盖原数据 ----

const seed = (list) => host.storage.set(MEMOS_STORAGE_KEY, JSON.stringify(list))
const stored = () => JSON.parse(host.storage.get(MEMOS_STORAGE_KEY))
const memoOf = (id, title, updateTime = 1000) => ({ id, title, content: `${title}的正文`, tag: '', createTime: 1, updateTime })
const createVia = async (view, title) => {
  await view.run(null, '新建便签')
  const form = await mountPushed(host)
  await form.fill('title', title)
  await form.run(null, '保存')
  await tick()
}

test('[memo-1 故障注入] 读取报错（DATA_CORRUPT 等）时显示错误行、只有「重试」，不提供新建/编辑/删除，存储不被改动；重试成功后恢复列表', async () => {
  const original = [memoOf('keep-1', '重要便签一'), memoOf('keep-2', '重要便签二')]
  seed(original)
  const before = host.storage.get(MEMOS_STORAGE_KEY)
  host.faults.storageRead = Object.assign(new Error('数据库文本不是有效 UTF-8'), { code: 'DATA_CORRUPT' })
  const view = await mount(MemoCommand)
  await tick()
  const items = view.items()
  assert.equal(items.length, 1)
  assert.equal(items[0].props.id, 'load-error')
  assert.match(items[0].props.title, /读取便签失败/)
  assert.ok(!view.text().includes('还没有便签'), '不能伪装成正常的空列表')
  // 行动作与列表级动作都只剩「重试」：读不到原值，不能备份重置
  assert.deepEqual(view.actions(items[0]).map((a) => a.props.title), ['重试'])
  assert.deepEqual(view.actions(null).map((a) => a.props.title), ['重试'])
  assert.match(String(host.lastToast().title), /读取便签失败/)
  // 按 Enter（主动作）只会重试；仍失败则仍是错误行
  await view.run(items[0], '重试')
  await tick()
  assert.equal(view.items()[0].props.id, 'load-error')
  assert.equal(host.storage.get(MEMOS_STORAGE_KEY), before)
  assert.equal(host.pushed.length, 0)

  host.faults.storageRead = null
  await view.run(view.items()[0], '重试')
  await tick()
  assert.deepEqual(view.items().map((i) => i.props.title).sort(), ['重要便签一', '重要便签二'])
  assert.equal(host.storage.get(MEMOS_STORAGE_KEY), before)
})

test('[memo-1 破坏性] 存储里是截断的 JSON（读回成字符串）时进入错误状态；可先备份原值再重新开始，取消则什么都不改', async () => {
  const truncated = JSON.stringify([memoOf('keep-1', '重要便签一'), memoOf('keep-2', '重要便签二')]).slice(0, -20)
  host.storage.set(MEMOS_STORAGE_KEY, JSON.stringify(truncated))
  const before = host.storage.get(MEMOS_STORAGE_KEY)
  const view = await mount(MemoCommand)
  await tick()
  const row = view.items()[0]
  assert.equal(row.props.id, 'load-error')
  assert.match(row.props.subtitle, /已损坏/)
  assert.deepEqual(view.actions(row).map((a) => a.props.title), ['重试', '备份原数据并重新开始'])

  host.setConfirm(false)
  await view.run(row, '备份原数据并重新开始')
  assert.equal(host.storage.get(MEMOS_STORAGE_KEY), before)
  assert.equal([...host.storage.keys()].length, 1)
  assert.equal(view.items()[0].props.id, 'load-error')

  // 备份写入失败：原数据不动
  host.setConfirm(true)
  host.faults.storageWrite = new Error('磁盘已满')
  await view.run(view.items()[0], '备份原数据并重新开始')
  assert.equal(host.storage.get(MEMOS_STORAGE_KEY), before)
  assert.match(String(host.lastToast().title), /备份失败/)
  host.faults.storageWrite = null

  await view.run(view.items()[0], '备份原数据并重新开始')
  await tick()
  const backupKey = [...host.storage.keys()].find((k) => k.startsWith(`${MEMOS_STORAGE_KEY}.backup-`))
  assert.ok(backupKey, '原值必须先备份')
  assert.equal(JSON.parse(host.storage.get(backupKey)), truncated)
  assert.deepEqual(stored(), [])
  assert.equal(view.items()[0].props.title, '还没有便签')
  await createVia(view, '重新开始后的第一条')
  assert.deepEqual(stored().map((m) => m.title), ['重新开始后的第一条'])
  assert.equal(JSON.parse(host.storage.get(backupKey)), truncated)
})

test('[memo-1 破坏性] null、对象等非数组值同样视为损坏，不提供新建', async () => {
  for (const bad of [null, { items: [] }, 42]) {
    host.reset()
    host.storage.set(MEMOS_STORAGE_KEY, JSON.stringify(bad))
    const view = await mount(MemoCommand)
    await tick()
    assert.equal(view.items()[0].props.id, 'load-error', `值 ${JSON.stringify(bad)} 应进入错误状态`)
    assert.ok(!view.actions(null).some((a) => a.props.title === '新建便签'))
  }
})

test('[memo-1 边界] 格式无法识别的条目不显示，但保存时原样保留、不会被删掉', async () => {
  const weird = { id: 'weird-1', title: '正文不是字符串', content: { rich: true }, updateTime: 5 }
  seed([memoOf('ok-1', '正常便签'), weird, 'garbage'])
  const view = await mount(MemoCommand)
  await tick()
  assert.deepEqual(view.items().map((i) => i.props.title), ['正常便签'])
  assert.match(String(host.lastToast().title), /2 条便签格式无法识别/)
  await createVia(view, '新的一条')
  const after = stored()
  assert.equal(after.length, 4)
  assert.deepEqual(after.find((m) => m && m.id === 'weird-1'), weird)
  assert.ok(after.includes('garbage'))
  // 删除正常便签也不碰无法识别的条目
  await view.run(view.items().find((i) => i.props.title === '正常便签'), '删除便签')
  assert.deepEqual(stored().filter((m) => m && m.id === 'weird-1'), [weird])
})

test('[memo-1 故障注入] 打开后存储才损坏或读取报错：保存被拒绝，原数据不变，表单不关闭', async () => {
  seed([memoOf('keep-1', '重要便签一')])
  const view = await mount(MemoCommand)
  await tick()
  await view.run(null, '新建便签')
  let form = await mountPushed(host)
  await form.fill('title', '读取报错时保存')
  host.faults.storageRead = new Error('数据库忙')
  await form.run(null, '保存')
  assert.deepEqual(stored().map((m) => m.title), ['重要便签一'])
  assert.equal(host.pushed.length, 1)
  assert.match(String(host.lastToast().message), /读取最新便签失败/)
  host.faults.storageRead = null

  const corrupt = JSON.stringify('[{"id":"keep-1","title":"重要')
  host.storage.set(MEMOS_STORAGE_KEY, corrupt)
  await form.run(null, '保存')
  assert.equal(host.storage.get(MEMOS_STORAGE_KEY), corrupt)
  assert.equal(host.pushed.length, 1)
  assert.match(String(host.lastToast().message), /已损坏/)
  // 列表切到错误状态，不再提供新建
  assert.equal(view.items()[0].props.id, 'load-error')
})

// ---- memo-2：两个窗口同时打开时不能互相覆盖 ----

test('[memo-2 并发] 两个窗口各自打开后分别新建：两条都保留，后保存的窗口列表也能看到对方的便签', async () => {
  seed([memoOf('old-1', '原有便签')])
  const main = await mount(MemoCommand)
  const popout = await mount(MemoCommand)
  await tick()
  await createVia(popout, '独立窗口新建')
  await createVia(main, '主窗口新建')
  assert.deepEqual(stored().map((m) => m.title).sort(), ['主窗口新建', '原有便签', '独立窗口新建'].sort())
  assert.deepEqual(main.items().map((i) => i.props.title).sort(), ['主窗口新建', '原有便签', '独立窗口新建'].sort())
})

test('[memo-2 并发] 本窗口打开期间别处写入的便签，在本窗口编辑/删除其他便签后仍然保留', async () => {
  seed([memoOf('a', '便签甲', 2000), memoOf('b', '便签乙', 1000)])
  const view = await mount(MemoCommand)
  await tick()
  seed([memoOf('x', '另一窗口写入的便签', 3000), ...stored()])

  await view.run(view.items().find((i) => i.props.title === '便签甲'), '编辑便签')
  const form = await mountPushed(host)
  await form.fill('title', '便签甲（改）')
  await form.run(null, '保存')
  await tick()
  assert.deepEqual(stored().map((m) => m.title).sort(), ['便签甲（改）', '便签乙', '另一窗口写入的便签'].sort())

  await view.run(view.items().find((i) => i.props.title === '便签乙'), '删除便签')
  assert.deepEqual(stored().map((m) => m.title).sort(), ['便签甲（改）', '另一窗口写入的便签'].sort())
})

test('[memo-2 竞态] 正在编辑的便签被另一窗口删除：保存时保留用户输入；另一窗口新建/删除的结果不被撤销', async () => {
  seed([memoOf('a', '便签甲'), memoOf('b', '便签乙')])
  const view = await mount(MemoCommand)
  await tick()
  await view.run(view.items().find((i) => i.props.title === '便签甲'), '编辑便签')
  const form = await mountPushed(host)
  // 另一窗口：删掉便签甲和便签乙，新建便签丙
  seed([memoOf('c', '便签丙')])
  await form.fill('content', '我刚写的内容')
  await form.run(null, '保存')
  await tick()
  const after = stored()
  assert.deepEqual(after.map((m) => m.title).sort(), ['便签丙', '便签甲'].sort())
  assert.equal(after.find((m) => m.id === 'a').content, '我刚写的内容')
})

test('[memo-2 竞态] 同一窗口两次保存同时发起会排队执行，两条都写入', async () => {
  const view = await mount(MemoCommand)
  await tick()
  await view.run(null, '新建便签')
  const f1 = await mountPushed(host)
  await view.run(null, '新建便签')
  const f2 = await mountPushed(host)
  await f1.fill('title', '并发一')
  await f2.fill('title', '并发二')
  const s1 = f1.actions(null)[0].props.onSubmit({})
  const s2 = f2.actions(null)[0].props.onSubmit({})
  await Promise.all([s1, s2])
  await tick()
  assert.deepEqual(stored().map((m) => m.title).sort(), ['并发一', '并发二'])
})
