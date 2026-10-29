import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount } from '../../shared/test-harness.mjs'
import ColorPickerCommand, { commands, splitColorInputs } from '../dist/index.js'

const host = createHost()
test.beforeEach(() => host.reset())

test('对比度命令与色值转换不是同一个界面', () => {
  assert.notEqual(commands['contrast-check'], commands['convert-color'])
})

test('拆分前景色与背景色：括号内空格逗号不拆，on / vs 作为分隔词', () => {
  assert.deepEqual(splitColorInputs('rgb(10, 132, 255) on white'), ['rgb(10, 132, 255)', 'white'])
  assert.deepEqual(splitColorInputs('#333 / #fff'), ['#333', '#fff'])
  assert.deepEqual(splitColorInputs('hsl(210 100% 52%),#000'), ['hsl(210 100% 52%)', '#000'])
  assert.deepEqual(splitColorInputs('   '), [])
})

test('两种颜色：计算两者之间的对比度并可交换、复制', async () => {
  const view = await mount(commands['contrast-check'])
  try {
    assert.equal(view.tree().props.isShowingDetail, true)
    assert.ok(view.item('hint').props.detail.props.markdown.length > 0, '空状态详情有用法说明')
    await view.search('#000000 #FFFFFF')
    const pair = view.item('pair')
    assert.equal(pair.props.subtitle, '对比度 21:1')
    assert.equal(pair.props.accessories[0].text, 'AAA 通过')
    await view.run(pair, '复制对比度')
    assert.equal(host.clipboard.text, '21:1')
    await view.search('#777777 #FFFFFF')
    const mid = view.item('pair')
    assert.equal(mid.props.accessories[0].text, '仅大字 AA 通过')
    assert.match(mid.props.detail.props.markdown, /正文 AA（≥ 4.5:1）：不通过/)
    await view.run(mid, '交换前景色与背景色')
    assert.match(view.item('pair').props.title, /^#FFFFFF 在 #777777 上$/)
  } finally { view.unmount() }
})

test('一种颜色：分别给出白底与黑底的对比度', async () => {
  const view = await mount(commands['contrast-check'])
  try {
    await view.search('#FFFFFF')
    assert.equal(view.item('on-white').props.subtitle, '对比度 1:1')
    assert.equal(view.item('on-white').props.accessories[0].text, '不通过')
    assert.equal(view.item('on-black').props.subtitle, '对比度 21:1')
  } finally { view.unmount() }
})

test('异常输入：无法识别、超过两种颜色时给出提示且不开空白详情栏', async () => {
  const view = await mount(commands['contrast-check'])
  try {
    await view.search('#000 nonsense')
    assert.equal(view.item('invalid').props.title, '无法识别「nonsense」')
    assert.equal(view.tree().props.isShowingDetail, false)
    assert.equal(view.actions(view.item('invalid')).length, 0)
    await view.search('#000 #fff #333')
    assert.ok(view.item('too-many'))
    assert.equal(view.tree().props.isShowingDetail, false)
  } finally { view.unmount() }
})

test('色值转换空输入时不展示空白详情栏；无法识别时也不空白', async () => {
  const view = await mount(ColorPickerCommand)
  try {
    assert.equal(view.tree().props.isShowingDetail, false)
    await view.search('nonsense')
    assert.equal(view.tree().props.isShowingDetail, false)
    await view.search('#0A84FF')
    assert.equal(view.tree().props.isShowingDetail, true)
    assert.ok(!view.text().includes('⌘/Ctrl'), '快捷键文案按平台只写一种')
  } finally { view.unmount() }
})
