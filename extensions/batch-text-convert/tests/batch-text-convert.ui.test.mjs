import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { getDeclarativeBridge, Toast } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import BatchTextConvertCommand, { MAX_CLIPBOARD_SOURCE_CHARS } from '../dist/index.js'

const host = createHost()
test.beforeEach(() => host.reset())

const sectionTitle = (view) => view.tree().children.find((c) => c.type === 'List.Section').props.title
const ids = (view) => view.items().map((i) => i.props.id)
const encodedOf = (view, id) => view.item(id).props.title

test('[issue-1] 打开时搜索框为空，只显示引导项，不拿看不见的示例冒充结果', async () => {
  const view = await mount(BatchTextConvertCommand)
  assert.equal(view.tree().props.searchText, '')
  assert.deepEqual(ids(view), ['empty-guide'])
  assert.doesNotMatch(view.text(), /你好世界|ZTools/)
  assert.doesNotMatch(sectionTitle(view), /0 种格式/)

  // 引导项的主动作是读取剪贴板，剪贴板为空时明确提示，不复制任何内容
  await view.run(view.item('empty-guide'), '读取剪贴板文本（保留换行）')
  assert.equal(host.clipboard.text, '')
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.match(host.lastToast().title, /没有文本/)
  assert.deepEqual(ids(view), ['empty-guide'])
})

test('[issue-1] 输入后显示 4 种结果，清空后回到同一个引导项（不出现“未找到”）', async () => {
  const view = await mount(BatchTextConvertCommand)
  await view.search('你好')
  assert.deepEqual(ids(view), ['unicode-escape', 'utf8-hex', 'base64', 'url-encode'])
  assert.equal(view.tree().props.searchText, '你好')
  assert.equal(encodedOf(view, 'utf8-hex'), 'E4 BD A0 E5 A5 BD')
  assert.equal(encodedOf(view, 'base64'), Buffer.from('你好').toString('base64'))
  await view.search('')
  assert.deepEqual(ids(view), ['empty-guide'])
  assert.equal(view.tree().props.searchText, '')
})

test('[issue-2] 清单描述与关键字只写真实能力，能按 base64 / hex / url 搜到，不再出现 GBK、ASCII、互转、批量', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../plugin.json', import.meta.url), 'utf8'))
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  for (const desc of [manifest.description, pkg.description]) {
    assert.doesNotMatch(desc, /GBK|ASCII|互转|批量|文件/i)
    for (const word of ['Unicode', 'Hex', 'Base64', 'URL']) assert.match(desc, new RegExp(word, 'i'))
  }
  const kw = manifest.keywords.map((k) => k.toLowerCase())
  for (const word of ['base64', 'hex', 'url', 'unicode', 'url编码']) assert.ok(kw.includes(word), `缺少关键字 ${word}`)
  assert.ok(!kw.some((k) => /gbk|ascii/.test(k)))
  assert.equal(pkg.version, manifest.version)
})

test('[issue-3] 次动作不再绑定 ctrl+c / ⌘C，任何动作都没有快捷键覆盖系统复制', async () => {
  const view = await mount(BatchTextConvertCommand)
  await view.search('hello world')
  for (const item of view.items()) {
    const actions = view.actions(item)
    assert.equal(actions[1].props.title, '复制格式名称', '次动作仍是复制格式名称（⌘↵ 触发）')
    for (const a of actions) assert.equal(a.props.shortcut, undefined, `${a.props.title} 不应声明快捷键`)
  }
  await view.run(view.item('base64'), '复制格式名称')
  assert.equal(host.clipboard.text, 'Base64 编码')
  assert.equal(host.lastToast().style, Toast.Style.Success)
})

test('[issue-7] 复制成功后才提示“已复制”，内容与列表显示一致', async () => {
  const view = await mount(BatchTextConvertCommand)
  await view.search('a b')
  await view.run(view.item('url-encode'), '复制编码结果')
  assert.equal(host.clipboard.text, 'a%20b')
  assert.equal(host.toasts.length, 1)
  assert.equal(host.lastToast().style, Toast.Style.Success)
  assert.match(host.lastToast().title, /已复制 URL 编码/)
})

test('[issue-7][故障] 宿主拒绝写入（超过 8 MiB）时提示复制失败，不提示成功、不抛未处理异常', async () => {
  const view = await mount(BatchTextConvertCommand)
  // 300 万个 a 的 Hex 结果约 9M 字符，超过宿主 8 MiB 上限
  await view.search('a'.repeat(3_000_000))
  host.clipboard.text = 'SENTINEL'
  await view.run(view.item('utf8-hex'), '复制编码结果')
  assert.equal(host.clipboard.text, 'SENTINEL')
  assert.equal(host.toasts.length, 1)
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.equal(host.lastToast().title, '复制失败')
  assert.match(host.lastToast().message, /8 MiB/)
})

test('[issue-7][故障] 宿主 IPC 抛出非标准错误时，次动作同样提示失败', async () => {
  const view = await mount(BatchTextConvertCommand)
  await view.search('x')
  const bridge = getDeclarativeBridge()
  const original = bridge.copyToClipboard
  bridge.copyToClipboard = async () => {
    throw 'IPC 管道已断开'
  }
  try {
    await view.run(view.item('unicode-escape'), '复制格式名称')
  } finally {
    bridge.copyToClipboard = original
  }
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.equal(host.lastToast().message, 'IPC 管道已断开')
  assert.ok(!host.toasts.some((t) => t.style === Toast.Style.Success))
})

test('[issue-v1] 读取剪贴板多行文本，保留 \\n 与 \\r\\n 后再编码，并提示含换行', async () => {
  const view = await mount(BatchTextConvertCommand)
  const source = 'line1\nline2\r\nline3'
  host.clipboard.text = source
  await view.run(view.item('empty-guide'), '读取剪贴板文本（保留换行）')
  assert.equal(view.tree().props.searchText, source)
  assert.equal(encodedOf(view, 'base64'), Buffer.from(source).toString('base64'))
  assert.equal(encodedOf(view, 'url-encode'), encodeURIComponent(source))
  assert.match(encodedOf(view, 'url-encode'), /%0A.*%0D%0A/)
  assert.match(encodedOf(view, 'utf8-hex'), /0A 6C .* 0D 0A/)
  assert.match(sectionTitle(view), /含 2 处换行/)
  assert.equal(host.lastToast().style, Toast.Style.Success)
  assert.match(host.lastToast().message, /含 2 处换行/)

  // 复制结果是保留换行的版本
  await view.run(view.item('base64'), '复制编码结果')
  assert.equal(host.clipboard.text, Buffer.from(source).toString('base64'))

  // 在搜索框继续输入（单行输入框已去掉换行）后改为单行结果，提示消失
  await view.search('line1line2line3x')
  assert.doesNotMatch(sectionTitle(view), /换行/)
  assert.equal(encodedOf(view, 'url-encode'), 'line1line2line3x')
})

test('[issue-v1] 从任意结果行的动作面板也能读取剪贴板，替换当前输入', async () => {
  const view = await mount(BatchTextConvertCommand)
  await view.search('old')
  host.clipboard.text = '{\n  "a": 1\n}'
  await view.run(view.item('unicode-escape'), '读取剪贴板文本（保留换行）')
  assert.equal(encodedOf(view, 'url-encode'), encodeURIComponent('{\n  "a": 1\n}'))
})

test('[issue-v1][故障] 剪贴板读取失败 / 为空 / 过长时提示原因，保留原输入', async () => {
  const view = await mount(BatchTextConvertCommand)
  await view.search('keep')
  const bridge = getDeclarativeBridge()
  const original = bridge.readClipboardText
  bridge.readClipboardText = async () => {
    throw Object.assign(new Error('剪贴板被其他程序占用'), { code: 'FAILED' })
  }
  try {
    await view.run(view.items()[0], '读取剪贴板文本（保留换行）')
  } finally {
    bridge.readClipboardText = original
  }
  assert.equal(host.lastToast().title, '读取剪贴板失败')
  assert.match(host.lastToast().message, /占用/)
  assert.equal(view.tree().props.searchText, 'keep')

  host.clipboard.text = ''
  await view.run(view.items()[0], '读取剪贴板文本（保留换行）')
  assert.match(host.lastToast().title, /没有文本/)
  assert.equal(view.tree().props.searchText, 'keep')

  host.clipboard.text = 'x'.repeat(MAX_CLIPBOARD_SOURCE_CHARS + 1)
  await view.run(view.items()[0], '读取剪贴板文本（保留换行）')
  assert.equal(host.lastToast().title, '剪贴板文本过长')
  assert.equal(view.tree().props.searchText, 'keep')

  // 恰好等于上限可以读取
  host.clipboard.text = 'y'.repeat(MAX_CLIPBOARD_SOURCE_CHARS)
  await view.run(view.items()[0], '读取剪贴板文本（保留换行）')
  await tick()
  assert.equal(view.tree().props.searchText.length, MAX_CLIPBOARD_SOURCE_CHARS)
  assert.equal(host.lastToast().style, Toast.Style.Success)
})

test('[并发] 连续快速交替输入与清空，最终结果只对应最后一次输入', async () => {
  const view = await mount(BatchTextConvertCommand)
  const tree = view.tree()
  for (let i = 0; i < 10; i++) tree.props.onSearchTextChange(i % 2 ? '' : `t${i}`)
  view.tree().props.onSearchTextChange('final')
  await tick()
  assert.equal(encodedOf(view, 'url-encode'), 'final')
  view.tree().props.onSearchTextChange('')
  await tick()
  assert.deepEqual(ids(view), ['empty-guide'])
})

test('同一动作只出现一次：引导项只有读取剪贴板，结果行为 复制结果(↵) / 复制名称(⌘↵) / 读取剪贴板(⌘K)，无列表级重复动作', async () => {
  const view = await mount(BatchTextConvertCommand)
  assert.equal(view.tree().props.actions, undefined)
  assert.deepEqual(view.actions(view.item('empty-guide')).map((a) => a.props.title), ['读取剪贴板文本（保留换行）'])
  await view.search('x')
  assert.deepEqual(view.actions(view.item('base64')).map((a) => a.props.title), ['复制编码结果', '复制格式名称', '读取剪贴板文本（保留换行）'])
})
