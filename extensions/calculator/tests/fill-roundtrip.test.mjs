import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount } from '../../shared/test-harness.mjs'
import CalculatorCommand, { evaluateCalculatorQuery, evaluateDateExpression } from '../dist/index.js'

// 「将结果填入输入框」(⌘E) 填回的文字必须能再次计算出同一结果：
// 日期不能被当成减法（2026-11-05 → 2,010），进制字面量不能算不出结果（0b11111111 → 选中项落到无关历史）。

const HISTORY_KEY = 'ztools-calculator-history-v1'
const host = createHost()
test.beforeEach(() => host.reset())
const seedHistory = (items) => host.storage.set(HISTORY_KEY, JSON.stringify(items))

// 第一条历史故意是一个大数：旧缺陷里选中项落到第一条历史，Enter 会复制出它
const UNRELATED_HISTORY = [
  { id: 'h-big', expression: '0xFFFFFFFFFFFFFFFF to dec', answer: '18446744073709551615', type: 'unit', pinned: false, timestamp: 2 },
  { id: 'h-2', expression: '9*9+1', answer: '82', type: 'math', pinned: false, timestamp: 1 }
]

const digits = (s) => s.replace(/,/g, '')

/** 再次计算的结果与原结果是否一致（按结果类型比较数值或文字） */
function assertSameResult(original, again, label) {
  assert.notEqual(again.type, 'none', `${label}：填回的文字必须仍是可计算的内容`)
  assert.equal(again.error, undefined, `${label}：填回的文字不能算出错误`)
  if (original.type === 'unit' && /^0[xbo]|^\d+$/.test(original.formattedAnswer)) {
    // 进制结果：比较整数值（BigInt 精确比较，超过 2^53 也不丢位）
    assert.equal(BigInt(digits(again.formattedAnswer)), BigInt(original.formattedAnswer), label)
  } else if (original.type === 'unit') {
    // 单位换算填回不带单位的数值：与界面显示的数值一致
    assert.equal(Number(digits(again.formattedAnswer)), parseFloat(original.formattedAnswer), label)
  } else if (original.type === 'color') {
    assert.equal(again.formattedAnswer, original.formattedAnswer, label)
    assert.equal(again.colorResult.rgb, original.colorResult.rgb, `${label}：透明度不能丢`)
  } else {
    assert.equal(again.type, original.type, label)
    assert.equal(again.formattedAnswer, original.formattedAnswer, label)
  }
}

const ROUND_TRIP_CASES = [
  // 算式：千分位、小数、极小/极大数、负数、百分号、取余、函数
  '1024 * 768', '1/3', '2^100', '1/1000000000', '-7*6', '50%', '10 % 3', 'sqrt(65536)', '-0', '2^60', '0.1+0.2',
  // 单位换算：长度、质量、温度、存储、CSS（含负数与需舍入的结果）
  '10km to miles', '5kg to lbs', '-40c to f', '100c to f', '1024mb to gb', '3px to rem', '-2.5rem to px', '1 px to rem',
  // 进制：各方向，含超过 2^53 的 64 位值，以及单独的进制字面量
  '255 to bin', '255 to hex', '255 to oct', '0xFF to dec', '0b1010 to hex', '0o777 to dec',
  '0xFFFFFFFFFFFFFFFF to dec', '18446744073709551615 to hex', '0xFF', '0b11111111',
  // 日期：相对日期（日期 / 带时间）、日期字面量本身与在其上加减
  'now + 2 weeks', 'today - 3 days', 'now + 5 hours', 'now - 30 mins', 'today + 1 month', 'now + 1 year',
  '2026-11-05', '2026-11-05 + 3 days', '2026-11-05 14:30 + 2 hours', '2024-02-29 08:05',
  // 颜色：HEX、RGB、HSL、半透明
  '#3b82f6', '#fff', 'rgb(59, 130, 246)', 'hsl(217, 91%, 60%)', 'rgba(59,130,246,0.5)', '#3b82f680'
]

test('[⌘E] 所有结果类型填回输入框后再次计算，得到与原结果一致的值；再填一次保持不变', () => {
  for (const q of ROUND_TRIP_CASES) {
    const r = evaluateCalculatorQuery(q)
    assert.notEqual(r.type, 'none', q)
    assert.equal(r.error, undefined, q)
    assert.equal(typeof r.fillText, 'string', `${q}：成功结果必须提供 fillText`)
    const again = evaluateCalculatorQuery(r.fillText)
    assertSameResult(r, again, `${q} → ${r.fillText}`)
    // 幂等：对再次计算的结果继续 ⌘E，文字与结果都不再变化
    const third = evaluateCalculatorQuery(again.fillText)
    // （进制转十进制的结果不带千分位，填回后按普通整数显示千分位，只比较数字）
    assert.equal(digits(third.formattedAnswer), digits(again.formattedAnswer), `${q}：第二次填回后结果应稳定`)
  }
})

test('[⌘E][回归] 日期结果填回不再被当成减法；进制字面量单独出现也有结果', () => {
  const date = evaluateCalculatorQuery('now + 2 weeks')
  assert.match(date.fillText, /^\d{4}-\d{2}-\d{2}$/)
  const filledDate = evaluateCalculatorQuery(date.fillText)
  assert.equal(filledDate.type, 'date')
  assert.equal(filledDate.formattedAnswer, date.formattedAnswer)
  assert.match(filledDate.details, /^星期[日一二三四五六] · (今天|\d+ 天后|\d+ 天前)$/)
  assert.equal(evaluateCalculatorQuery('2026-11-05').formattedAnswer, '2026-11-05', '不能算成 2,010')

  assert.equal(evaluateCalculatorQuery('0b11111111').formattedAnswer, '255')
  assert.equal(evaluateCalculatorQuery('0xff').formattedAnswer, '255')
  assert.equal(evaluateCalculatorQuery('0o17').formattedAnswer, '15')
  assert.equal(evaluateCalculatorQuery('0xFFFFFFFFFFFFFFFF').formattedAnswer, '18446744073709551615', '64 位字面量精确')
  // 十进制大整数单独出现按 BigInt 精确显示（进制换算 to dec 的结果填回后不丢位）
  assert.equal(evaluateCalculatorQuery('18446744073709551615').formattedAnswer, '18,446,744,073,709,551,615')
  // 半透明色填回 rgba，透明度不丢
  assert.equal(evaluateCalculatorQuery('#3b82f680').fillText, 'rgba(59, 130, 246, 0.5)')
  // CSS 换算的数值与显示一致（舍入后），不会填回一长串未舍入的小数
  assert.equal(evaluateCalculatorQuery('1px to rem').fillText, '0.0625')
})

test('[⌘E][异常] 不存在或越界的日期、越界换算报错且不提供填回；畸形进制字面量不当作换算', () => {
  for (const q of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-11-05 24:00', '2026-11-05 12:60', '2025-02-29 + 1 day']) {
    const r = evaluateCalculatorQuery(q)
    assert.equal(r.type, 'date', q)
    assert.match(r.error || '', /日期不存在/, q)
    assert.equal(r.fillText, undefined, q)
    assert.equal(r.formattedAnswer, '', `${q}：不能被 Date 自动进位或按减法算出别的值`)
  }
  const far = evaluateCalculatorQuery('now + 999999999 years')
  assert.match(far.error || '', /超出可表示范围/)
  assert.equal(far.fillText, undefined)
  assert.equal(evaluateDateExpression(''), null, '空输入不抛异常')
  assert.equal(evaluateDateExpression(null), null)
})

test('[⌘E][异常] 换算结果溢出时报错，不显示 Infinity', () => {
  const huge = '1' + '0'.repeat(306)
  const r = evaluateCalculatorQuery(`${huge} km to mm`)
  assert.equal(r.type, 'unit')
  assert.match(r.error || '', /超出数值范围/)
  assert.equal(r.fillText, undefined)
  for (const q of ['0b102', '0xZZ', '0o8', '0x']) {
    assert.notEqual(evaluateCalculatorQuery(q).type, 'unit', q)
  }
  assert.equal(evaluateCalculatorQuery('1+').fillText, undefined)
})

/** 模拟渲染器：受控 selectedItemId 必须命中一行，按 Enter 执行该行第一个动作 */
async function pressEnter(view) {
  const id = view.tree().props.selectedItemId
  assert.ok(id, '填入后必须由插件指定选中行，不能交给渲染器默认选第一行')
  const row = view.item(id)
  const [primary] = view.actions(row)
  await view.run(row, primary.props.title)
  return row
}

for (const [query, expectedFill, expectedTitle, expectedCopy] of [
  ['255 to bin', '0b11111111', '= 255', '255'],
  ['255 to hex', '0xFF', '= 255', '255'],
  ['0xFF to dec', '255', '= 255', '255'],
  ['10 km to m', '10000', '= 10,000', '10,000'],
  ['12*(3+4)', '84', '= 84', '84']
]) {
  test(`[⌘E][界面] ${query}：填回 ${expectedFill}，结果行被选中，Enter 复制 ${expectedCopy} 而不是无关历史`, async () => {
    seedHistory(UNRELATED_HISTORY)
    const view = await mount(CalculatorCommand)
    await view.search(query)
    await view.run(view.item('calc-success'), '将结果填入输入框')
    assert.equal(view.tree().props.searchText, expectedFill)
    assert.equal(view.tree().props.selectedItemId, 'calc-success')
    assert.equal(view.item('calc-success').props.title, expectedTitle)
    await pressEnter(view)
    assert.equal(host.clipboard.text, expectedCopy)
    assert.notEqual(host.clipboard.text, '18446744073709551615')
    view.unmount()
  })
}

test('[⌘E][界面] 日期结果填回日期字面量，再次计算为同一日期，Enter 复制该日期；连续按两次 ⌘E 不变', async () => {
  seedHistory(UNRELATED_HISTORY)
  const view = await mount(CalculatorCommand)
  await view.search('now + 2 weeks')
  const answer = view.item('calc-success').props.title
  await view.run(view.item('calc-success'), '将结果填入输入框')
  const filled = view.tree().props.searchText
  assert.match(filled, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(view.item('calc-success').props.title, answer, '不能变成 = 2,010 之类的减法结果')
  await view.run(view.item('calc-success'), '将结果填入输入框')
  assert.equal(view.tree().props.searchText, filled)
  await pressEnter(view)
  assert.equal(host.clipboard.text, answer.replace(/^= /, ''))
  view.unmount()
})

test('[⌘E][界面][异常] 错误结果不提供「将结果填入输入框」', async () => {
  const view = await mount(CalculatorCommand)
  for (const q of ['2026-02-30', '1+', '1.5.5 km to m']) {
    await view.search(q)
    assert.ok(!view.items().some((it) => it.props.id === 'calc-success'), q)
    assert.ok(!view.actions(view.item('calc-error')).some((a) => a.props.title === '将结果填入输入框'), q)
  }
  view.unmount()
})

test('[填入搜索框][异常] 历史算式已无法计算（旧版汇率）：选中该历史项本身，Enter 不会作用于其它历史', async () => {
  seedHistory([
    ...UNRELATED_HISTORY,
    { id: 'h-old', expression: '100 usd to cny', answer: '720', type: 'currency', pinned: false, timestamp: 0 }
  ])
  const view = await mount(CalculatorCommand)
  await view.run(view.item('h-old'), '填入搜索框')
  assert.equal(view.tree().props.searchText, '100 usd to cny')
  assert.equal(view.tree().props.selectedItemId, 'h-old')
  await pressEnter(view)
  assert.equal(host.clipboard.text, '720')
  view.unmount()
})
