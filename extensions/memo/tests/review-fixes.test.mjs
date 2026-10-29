// 本轮审查修复的回归用例：从搜索词新建的表单标题、单条动作不重复全局动作、复制失败如实提示、日期显示
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import MemoCommand from '../dist/index.js'
import { createMemo, formatListDate, MEMOS_STORAGE_KEY } from '../dist/logic.js'

const host = createHost()
test.beforeEach(() => {
  host.reset()
  delete globalThis.localStorage
})

const seed = (v) => host.storage.set(MEMOS_STORAGE_KEY, JSON.stringify(v))

test('用搜索词新建时表单是「新建便签」并预填标题，保存后是新增而不是编辑', async () => {
  seed([createMemo([], '已有', '正文')[0]])
  const view = await mount(MemoCommand)
  await view.search('会议记录')
  await view.run(view.item('empty'), '新建便签')
  const form = await mountPushed(host)
  assert.equal(form.tree().props.navigationTitle, '新建便签')
  assert.equal(form.field('title').props.value, '会议记录')
  await form.run(null, '保存')
  await tick()
  assert.deepEqual(JSON.parse(host.storage.get(MEMOS_STORAGE_KEY)).map((m) => m.title).sort(), ['会议记录', '已有'].sort())
})

test('单条便签的动作不再重复 List 级的「新建便签」；空状态条目不另带动作，回退到 List 级', async () => {
  seed([createMemo([], '标题', '正文')[0]])
  const view = await mount(MemoCommand)
  const itemTitles = view.actions(view.items()[0]).map((a) => a.props.title)
  assert.deepEqual(itemTitles, ['复制正文', '编辑便签', '复制标题', '删除便签'])
  assert.deepEqual(view.actions(null).map((a) => a.props.title), ['新建便签'])
  await view.search('没有匹配')
  assert.equal(view.item('empty').props.actions, undefined)
})

test('[边界] 只有标题没有正文：复制正文提示失败，不显示「已复制」，剪贴板不被改写', async () => {
  seed([createMemo([], '只有标题', '')[0]])
  const view = await mount(MemoCommand)
  await view.run(view.items()[0], '复制正文')
  assert.equal(host.lastToast().title, '复制失败')
  assert.match(String(host.lastToast().message), /没有正文/)
  assert.ok(!host.toasts.some((t) => t.title === '已复制正文'))
})

test('[故障注入] 剪贴板拒绝写入（正文超过 8 MiB）时提示复制失败', async () => {
  seed([createMemo([], '超大便签', 'x'.repeat(8 * 1024 * 1024 + 1))[0]])
  const view = await mount(MemoCommand)
  await view.run(view.items()[0], '复制正文')
  assert.equal(host.lastToast().title, '复制失败')
  assert.match(String(host.lastToast().message), /8 MiB/)
})

test('[边界] 列表日期：旧数据无时间不显示、跨年带年份', () => {
  const now = new Date(2026, 9, 28).getTime()
  assert.equal(formatListDate(0, now), '')
  assert.match(formatListDate(new Date(2024, 4, 1).getTime(), now), /2024/)
  assert.doesNotMatch(formatListDate(new Date(2026, 4, 1).getTime(), now), /2026/)
})
