import assert from 'node:assert/strict'
import test from 'node:test'
import { createHost, mount } from '../../shared/test-harness.mjs'
import DefaultCommand, { commands } from '../dist/index.js'

test('各快捷入口按对应分类查询，并复制该条目的真实内容', async () => {
  for (const [feature, category, query, id, action, expected] of [
    ['linux-commands', 'linux', 'tar', 'cmd-tar', '复制首选推荐命令', 'tar -zxvf archive.tar.gz'],
    ['http-status', 'http', '502', '502', '仅复制状态码数字', '502'],
    ['port-dict', 'port', 'redis', '6379', '复制端口号', '6379']
  ]) {
    const host = createHost()
    const view = await mount(commands[feature])
    try {
      assert.equal(view.tree().props.searchBarAccessory.props.value, category)
      await view.search(query)
      assert.ok(view.item(id), `搜索 ${query} 必须包含 ${id}`)
      await view.run(view.item(id), action)
      assert.equal(host.clipboard.text, expected)
      await view.search('MAC-AUDIT-no-such-entry')
      assert.equal(view.items().length, 0)
    } finally { view.unmount() }
  }
})

test('从不同字典切换时清除上个字典的搜索词，默认入口仍是命令库', async () => {
  createHost()
  const view = await mount(DefaultCommand)
  try {
    assert.equal(view.tree().props.searchBarAccessory.props.value, 'linux')
    await view.search('tar')
    await view.dropdown('http')
    assert.equal(view.tree().props.searchText, '')
    assert.ok(view.items().length > 1)
    await view.search('502')
    await view.dropdown('port')
    assert.equal(view.tree().props.searchText, '')
    assert.ok(view.items().length > 1)
  } finally { view.unmount() }
})
