import test from 'node:test'
import assert from 'node:assert/strict'
import { setRuntimeLocale } from '@ztools/declarative-ui'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import MemoCommand from '../dist/index.js'

const host = createHost()
test.beforeEach(() => {
  host.reset()
  delete globalThis.localStorage
  setRuntimeLocale('zh-CN')
})

test('i18n: 中英文热切换实时更新列表与表单全部文案，英文模式下无中文残留', async () => {
  const view = await mount(MemoCommand)
  assert.equal(view.items()[0].props.title, '还没有便签')
  assert.match(String(view.tree().props.searchBarPlaceholder), /搜索便签/)

  // 运行时热切换至 en-US
  setRuntimeLocale('en-US')
  await tick()
  assert.equal(view.items()[0].props.title, 'No notes yet')
  assert.match(String(view.tree().props.searchBarPlaceholder), /Search note titles/i)
  assert.ok(!/[\u4e00-\u9fa5]/.test(view.text()), `en-US list should not contain CJK: ${view.text()}`)

  // 打开新建表单并验证英文提示与空提交校验
  await view.run(view.item('empty'), 'New Note')
  const form = await mountPushed(host)
  assert.equal(form.tree().props.navigationTitle, 'New Note')
  await form.run(null, 'Save')
  assert.equal(form.field('title').props.error, 'Title and content cannot both be empty')

  // 表单中保存后验证列表与详情
  await form.fill('title', 'Release Checklist')
  await form.fill('content', '- Run tests')
  await form.run(null, 'Save')
  await tick()
  assert.equal(host.lastToast().title, 'Note saved')
  assert.ok(!/[\u4e00-\u9fa5]/.test(view.text()), `en-US populated list should not contain CJK: ${view.text()}`)

  // 热切换回 zh-CN
  setRuntimeLocale('zh-CN')
  await tick()
  assert.match(String(view.tree().props.searchBarPlaceholder), /搜索便签/)
})
