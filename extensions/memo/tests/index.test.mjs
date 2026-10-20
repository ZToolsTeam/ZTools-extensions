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
