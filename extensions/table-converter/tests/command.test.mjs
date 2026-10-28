import test from 'node:test'
import assert from 'node:assert/strict'
import { Clipboard } from '@ztools/declarative-ui'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import { TableConverterCommand, commands } from '../dist/index.js'
const action = (view, id) => view.tree().props.filterBar.actions.find(a => a.id === id)

test('空剪贴板显示等待输入，不提供虚构示例或可复制结果', async () => {
  const host = createHost(), view = await mount(TableConverterCommand, host)
  try {
    assert.deepEqual(view.items().map(i => i.props.id), ['empty-input'])
    assert.equal(host.toasts.length, 0)
    assert.doesNotMatch(view.text(), /48500|12800|19200/)
  } finally { view.unmount() }
})

test('JSON 快捷命令首项正确，真实 SDK 复制和粘贴发送完整原类型数据', async () => {
  const host = createHost(), input = [{ name: '001', data: { a: 1 } }]
  host.clipboard.text = JSON.stringify(input)
  const view = await mount(commands['table-to-json'], host)
  try {
    assert.equal(view.items()[0].props.id, 'json')
    await view.run(view.item('json'), '复制转换结果')
    assert.deepEqual(JSON.parse(host.clipboard.text), input)
    await view.run(view.item('json'), '直接上屏粘贴')
    assert.deepEqual(JSON.parse(host.clipboard.pasted[0]), input)
  } finally { view.unmount() }
})

test('解析错误清空转换动作，并在编辑表单保留完整原文', async () => {
  const host = createHost(), input = 'a\n"unterminated'
  const view = await mount(() => TableConverterCommand({ initialRawText: input }), host)
  let form
  try {
    assert.deepEqual(view.items().map(i => i.props.id), ['parse-error'])
    assert.equal(view.item('parse-error').props.actions, undefined)
    await action(view, 'edit-input').onAction(); form = await mountPushed(host)
    assert.equal(form.field('text').props.value, input)
    await form.run(null, '应用输入')
    assert.equal(host.lastToast().style, 'FAILURE')
    assert.equal(host.pushed.length, 1)
    assert.equal(form.field('text').props.value, input)
    await form.fill('text', 'a\nfixed'); await form.fill('sqlTableName', '自定义表')
    await form.run(null, '应用输入'); await tick()
    assert.equal(host.pushed.length, 0)
    await view.run(view.item('sql'), '复制转换结果')
    assert.match(host.clipboard.text, /INSERT INTO "自定义表"/)
  } finally { form?.unmount(); view.unmount() }
})

test('剪贴板读取失败保留前次输入，提示失败不冒充更新成功', async () => {
  const host = createHost(), view = await mount(() => TableConverterCommand({ initialRawText: 'a\nold' }), host)
  const read = Clipboard.readText
  try {
    Clipboard.readText = async () => { throw new Error('读取被拒绝') }
    await action(view, 'read-clipboard').onAction(); await tick()
    assert.equal(host.lastToast().style, 'FAILURE')
    assert.match(view.tree().props.filterBar.summaryText, /保留上一次/)
    await action(view, 'edit-input').onAction(); const form = await mountPushed(host)
    try { assert.equal(form.field('text').props.value, 'a\nold') } finally { form.unmount() }
  } finally { Clipboard.readText = read; view.unmount() }
})

test('迟到的剪贴板读取不能覆盖新读取、手动输入或已退出页面', async () => {
  const host = createHost(), view = await mount(() => TableConverterCommand({ initialRawText: 'a\nold' }), host)
  const read = Clipboard.readText, pending = []
  try {
    Clipboard.readText = () => new Promise(resolve => pending.push(resolve))
    const first = action(view, 'read-clipboard').onAction(), second = action(view, 'read-clipboard').onAction()
    pending[1]('a\nnew'); await second; pending[0]('a\nstale'); await first
    await view.run(view.item('json'), '复制转换结果'); assert.equal(JSON.parse(host.clipboard.text)[0].a, 'new')
    const third = action(view, 'read-clipboard').onAction()
    await action(view, 'edit-input').onAction(); const form = await mountPushed(host)
    try { await form.fill('text', 'a\nmanual'); await form.run(null, '应用输入') } finally { form.unmount() }
    pending[2]('a\nstale-again'); await third
    await view.run(view.item('json'), '复制转换结果'); assert.equal(JSON.parse(host.clipboard.text)[0].a, 'manual')
    const fourth = action(view, 'read-clipboard').onAction()
    view.unmount(); pending[3]('a\nlate'); await fourth
    assert.equal(JSON.parse(host.clipboard.text)[0].a, 'manual')
  } finally { Clipboard.readText = read; view.unmount() }
})

test('格式转换局部失败不能复制空文本，其他格式仍可用', async () => {
  const host = createHost(), view = await mount(() => TableConverterCommand({ initialRawText: '[{"a":"\\u0000"}]' }), host)
  try {
    assert.equal(view.item('sql').props.actions, undefined)
    await view.run(view.item('json'), '复制转换结果')
    assert.equal(JSON.parse(host.clipboard.text)[0].a, '\0')
  } finally { view.unmount() }
})

test('预览截断不影响复制完整内容，围栏按用户内容长度扩展', async () => {
  const host = createHost(), input = [{ a: '```\r\n![x](https://example.invalid/x)\r\n' + 'x'.repeat(35_000) }]
  const view = await mount(() => TableConverterCommand({ initialRawText: JSON.stringify(input) }), host)
  try {
    assert.match(view.item('csv').props.detail.props.markdown, /^````csv/)
    assert.match(view.item('csv').props.detail.props.markdown, /预览已截断/)
    await view.run(view.item('csv'), '复制转换结果')
    assert.ok(host.clipboard.text.length > 35_000)
    assert.ok(host.clipboard.text.endsWith('x'.repeat(100) + '"'))
  } finally { view.unmount() }
})

test('清空剪贴板移除旧结果，快捷入口覆盖清单中的全部命令', async () => {
  const host = createHost()
  for (const [code, first] of [['table-auto', 'markdown'], ['table-to-markdown', 'markdown'], ['table-to-json', 'json'], ['table-to-sql', 'sql']]) {
    host.clipboard.text = 'a\nx'
    const view = await mount(commands[code], host)
    try {
      assert.equal(view.items()[0].props.id, first)
      host.clipboard.text = ''; await action(view, 'read-clipboard').onAction()
      assert.equal(view.items()[0].props.id, 'empty-input')
    } finally { view.unmount() }
  }
})

test('真实 SDK 复制与粘贴失败不提示成功，不触发读取或改写原输入', async () => {
  const host = createHost(), view = await mount(() => TableConverterCommand({ initialRawText: 'a\nkeep' }), host)
  const copy = Clipboard.copy, paste = Clipboard.paste
  try {
    Clipboard.copy = async () => { throw new Error('剪贴板写入被拒绝') }
    Clipboard.paste = async () => { throw new Error('没有可用的粘贴目标') }
    await assert.rejects(view.run(view.item('json'), '复制转换结果'), /拒绝/)
    await assert.rejects(view.run(view.item('json'), '直接上屏粘贴'), /目标/)
    assert.equal(host.toasts.length, 0)
    assert.equal(host.clipboard.text, '')
    assert.match(view.item('json').props.detail.props.markdown, /keep/)
  } finally { Clipboard.copy = copy; Clipboard.paste = paste; view.unmount() }
})
