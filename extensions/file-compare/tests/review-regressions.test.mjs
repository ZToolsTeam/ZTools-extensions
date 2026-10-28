import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, mountPushed } from '../../shared/test-harness.mjs'
import Command from '../dist/index.js'
const host = createHost()
test.beforeEach(() => host.reset())

test('提交空文本仍代表已载入：整篇新增、删除和两侧为空', async () => {
  for (const [left, right, expected] of [['原文', '', '-原文'], ['', '新文', '+新文'], ['', '', null]]) {
    const view = await mount(Command)
    try {
      await view.run(null, '编辑两段文本…')
      const form = await mountPushed(host)
      try { await form.fill('left', left); await form.fill('right', right); await form.run(null, '开始对比') }
      finally { form.unmount() }
      if (expected) { await view.run(view.item('hunk-0'), '复制差异报告'); assert.ok(host.clipboard.text.includes(expected)) }
      else assert.match(view.item('identical').props.title, /相同/)
      await view.run(null, '清空')
      assert.equal(view.items()[0].props.id, 'start-edit')
    } finally { view.unmount() }
  }
})

test('零字节文件可作为已载入一侧；取消第二个文件不误判为已载入', async () => {
  host.ipc.window_show_open_dialog = async () => ({ canceled: false, filePath: '/空 文件.txt' })
  host.ipc.filesystem_get_file_size = async () => ({ size: 0 })
  host.ipc.filesystem_read_file = async () => ({ content: '', size: 0 })
  const view = await mount(Command)
  try {
    await view.run(null, '选择文件作为左侧…')
    assert.match(view.item('need-other').props.title, /右侧/)
    host.ipc.window_show_open_dialog = async () => ({ canceled: true })
    await view.run(null, '选择文件作为右侧…')
    assert.match(view.item('need-other').props.title, /右侧/)
    host.clipboard.text = '新增'
    await view.run(null, '剪贴板内容设为右侧')
    assert.ok(view.item('hunk-0'))
  } finally { view.unmount() }
})
