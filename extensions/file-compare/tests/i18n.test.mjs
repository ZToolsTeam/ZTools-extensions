import test from 'node:test'
import assert from 'node:assert/strict'
import { setRuntimeLocale } from '@ztools/declarative-ui'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import FileCompareCommand from '../dist/index.js'

const host = createHost()
test.beforeEach(() => {
  host.reset()
  setRuntimeLocale('zh-CN')
})

test('i18n: 中英文热切换实时更新首屏、编辑表单与差异结果，英文模式下无中文残留', async () => {
  const view = await mount(FileCompareCommand)
  assert.equal(view.tree().props.navigationTitle, '文本对比')
  assert.equal(view.item('start-edit').props.title, '粘贴两段文本进行对比')

  // 运行时热切换至 en-US
  setRuntimeLocale('en-US')
  await tick()
  assert.equal(view.tree().props.navigationTitle, 'Text Diff')
  assert.equal(view.item('start-edit').props.title, 'Paste two texts to compare')
  assert.ok(!/[\u4e00-\u9fa5]/.test(view.text()), `en-US start view should not contain CJK: ${view.text()}`)

  // 打开表单、填入文本并对比
  await view.run(view.item('start-edit'), 'Edit Both Texts…')
  const form = await mountPushed(host)
  assert.equal(form.tree().props.navigationTitle, 'Enter Two Texts to Compare')
  await form.fill('left', 'alpha\nbeta')
  await form.fill('right', 'alpha\nBETA')
  await form.run(null, 'Compare')
  await tick()

  const hunk = view.item('hunk-0')
  assert.match(String(hunk.props.title), /Around line 1/)
  assert.match(String(hunk.props.subtitle), /-1 line\(s\), \+1 line\(s\)/)
  assert.ok(!/[\u4e00-\u9fa5]/.test(view.text()), `en-US diff view should not contain CJK: ${view.text()}`)

  // 复制差异报告应使用英文侧名
  await view.run(hunk, 'Copy Diff Report')
  assert.ok(host.clipboard.text.startsWith('--- Left\n+++ Right\n'))
  assert.equal(host.lastToast().title, 'Copied unified diff report')

  // 热切换回 zh-CN
  setRuntimeLocale('zh-CN')
  await tick()
  assert.equal(view.tree().props.navigationTitle, '文本对比')
  assert.match(String(view.item('hunk-0').props.subtitle), /删除 1 行，新增 1 行/)
})
