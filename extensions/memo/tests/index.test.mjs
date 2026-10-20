import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import MemoCommand from '../dist/index.js'
import { readLegacyMemos, sanitizeStoredMemos, MEMOS_STORAGE_KEY, LEGACY_LOCALSTORAGE_KEY, createMemo } from '../dist/logic.js'

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
