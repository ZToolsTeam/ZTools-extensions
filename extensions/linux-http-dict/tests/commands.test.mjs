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

test('端口排查命令按系统区分（macOS 没有 ss），动作不再占用系统复制快捷键 ⌘/Ctrl+C', async () => {
  const host = createHost()
  const view = await mount(commands['port-dict'])
  try {
    await view.search('6379')
    const item = view.item('6379')
    const titles = view.actions(item).map(a => a.props.title)
    assert.deepEqual(titles.slice(0, 2), ['复制端口号', '复制 Linux 端口排查命令'])
    await view.run(item, '复制 macOS 端口排查命令')
    assert.equal(host.clipboard.text, 'sudo lsof -nP -iTCP:6379 -sTCP:LISTEN')
    await view.run(item, '复制 Windows 端口排查命令')
    assert.equal(host.clipboard.text, 'netstat -ano | findstr :6379')
    await view.search('53')
    await view.run(view.item('53'), '复制 macOS 端口排查命令')
    assert.equal(host.clipboard.text, 'sudo lsof -nP -i :53', 'TCP/UDP 端口不能只查 TCP 监听')
    for (const feature of ['port-dict', 'http-status']) {
      const v = await mount(commands[feature])
      try {
        for (const node of v.items()) for (const action of v.actions(node)) {
          const sc = action.props.shortcut
          assert.ok(!(sc && sc.key === 'c' && sc.modifiers.length === 1), `${action.props.title} 不能用 ⌘/Ctrl+C`)
        }
      } finally { v.unmount() }
    }
  } finally { view.unmount() }
})

test('详情栏不重复列表已显示的标题、副标题与标签（界面红线 6）', async () => {
  const { commands } = await import('../dist/index.js')
  const { mount: mountView } = await import('../../shared/test-harness.mjs')
  const strip = (s) => String(s ?? '').replace(/`/g, '')
  for (const code of ['linux-commands', 'http-status', 'port-dict']) {
    const view = await mountView(commands[code])
    try {
      const items = view.items()
      assert.ok(items.length > 0, code)
      for (const item of items) {
        const detail = item.props.detail.props
        const md = strip(detail.markdown)
        // Linux 命令名本来就会出现在示例命令里，只检查详情不再以标题行开头
        assert.ok(!/^###\s/.test(md), `${code}/${item.props.id} 详情以重复的标题行开头`)
        if (code !== 'linux-commands') assert.ok(!md.includes(strip(item.props.title)), `${code}/${item.props.id} 详情重复标题`)
        if (item.props.subtitle) assert.ok(!md.includes(strip(item.props.subtitle)), `${code}/${item.props.id} 详情重复副标题`)
        const meta = (detail.metadata?.children || []).filter((c) => c.props?.text).map((c) => c.props.text)
        for (const acc of item.props.accessories || []) {
          const tag = typeof acc.tag === 'object' ? acc.tag.value : acc.tag
          assert.ok(!meta.includes(tag), `${code}/${item.props.id} 属性栏重复标签 ${tag}`)
        }
        assert.ok(!/\((Root Causes|Troubleshooting)\)/.test(md))
      }
      if (code === 'port-dict') assert.ok(items.every((i) => /lsof|netstat|ss /.test(i.props.detail.props.markdown)), '端口排查命令仍在详情里')
    } finally { view.unmount() }
  }
})

test('tar 第三条示例缩短后仍可按 node_modules 搜到，详情与复制内容一致', async () => {
  const { LINUX_COMMANDS_DICT, searchLinuxCommands } = await import('../dist/dict-service.js')
  const tar = LINUX_COMMANDS_DICT.find((c) => c.id === 'cmd-tar')
  const third = tar.examples[2]
  assert.equal(third.cmd, 'tar --exclude=node_modules -zcvf backup.tar.gz ./project')
  assert.ok(third.cmd.length <= 60 && third.title.length <= 20)
  assert.ok(searchLinuxCommands('node_modules').some((c) => c.id === 'cmd-tar'))
  const host = createHost()
  const view = await mount(commands['linux-commands'])
  try {
    await view.search('tar')
    assert.match(view.item('cmd-tar').props.detail.props.markdown, /tar --exclude=node_modules -zcvf backup\.tar\.gz \.\/project/)
  } finally { view.unmount() }
  assert.ok(host)
})
