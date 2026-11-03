// macOS 真机审查：calc-unit 只列单位换算示例、分组标题与汇率来源不中英混排
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount } from '../../shared/test-harness.mjs'
import CalculatorCommand, { calcUnit, calcCurrency } from '../dist/index.js'

const HISTORY_KEY = 'ztools-calculator-history-v1'
const host = createHost()
test.beforeEach(() => host.reset())

const allTitles = (view) => {
  const out = []
  JSON.parse(view.text(), (k, v) => { if (k === 'title' && typeof v === 'string') out.push(v); return v })
  return out
}

test('calc-unit 命令只列单位换算示例，不出现通用算式示例', async () => {
  const view = await mount(calcUnit)
  const titles = allTitles(view)
  assert.ok(titles.includes('10km to miles'))
  assert.ok(titles.includes('100c to f'))
  assert.ok(!titles.includes('1024 * 768'), '不应出现四则运算示例')
  assert.ok(!titles.includes('sqrt(65536)'))
  assert.ok(!titles.includes('0xFF to dec'), '进制转换不是单位换算')
  assert.ok(titles.includes('单位换算示例'))
  assert.match(view.tree().props.searchBarPlaceholder, /km to miles/)
  // 仍是完整计算器：输入换算能直接算出结果
  await view.search('1km to m')
  assert.equal(view.item('calc-success').props.title, '= 1000 m')
  view.unmount()
})

test('主命令保留全部示例，分组标题不带英文括注，历史类型标签为中文', async () => {
  host.storage.set(HISTORY_KEY, JSON.stringify([
    { id: 'h-pin', expression: '7*6', answer: '42', type: 'math', pinned: true, timestamp: 2 },
    { id: 'h-u', expression: '1km to m', answer: '1,000', type: 'unit', timestamp: 1 }
  ]))
  const view = await mount(CalculatorCommand)
  const titles = allTitles(view)
  assert.ok(titles.includes('1024 * 768'))
  for (const t of titles) assert.doesNotMatch(t, /\((Examples|Pinned|Recent History)\)/)
  assert.deepEqual(view.item('h-u').props.accessories, [{ text: '换算' }])
  view.unmount()
})

test('[异常] 历史里出现未知类型时标签退回“计算”而不是空白或英文', async () => {
  // 未知类型在读取校验时会被拒绝，整份历史保持为空，界面不崩
  host.storage.set(HISTORY_KEY, JSON.stringify([{ id: 'x', expression: '1', answer: '1', type: 'weird', timestamp: 1 }]))
  const view = await mount(CalculatorCommand)
  assert.equal(view.items().find((it) => it.props.id === 'x'), undefined)
  view.unmount()
})

test('汇率来源条目使用中文标题', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('offline') }
  try {
  const view = await mount(calcCurrency)
  const src = view.item('currency-source')
  assert.equal(src.props.title, '汇率来源：ExchangeRate-API')
  view.unmount()
  } finally { globalThis.fetch = realFetch }
})

test('calc-unit 示例行不再带与主动作重复的“换算”标签；主命令的混合示例仍按分类标注', async () => {
  const view = await mount(calcUnit)
  const egs = view.items().filter(i => String(i.props.id).startsWith('eg-'))
  assert.ok(egs.length > 0)
  for (const item of egs) {
    assert.deepEqual(item.props.accessories, [])
    assert.equal(view.actions(item)[0].props.title, '填入搜索框并计算')
  }
  view.unmount()
  const main = await mount(CalculatorCommand)
  const mixed = main.items().filter(i => String(i.props.id).startsWith('eg-'))
  assert.ok(new Set(mixed.map(i => i.props.accessories[0]?.text)).size > 1, '主命令示例分类不止一种')
  main.unmount()
})
