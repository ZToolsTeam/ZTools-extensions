import test from 'node:test'
import assert from 'node:assert/strict'
import { setRuntimeLocale } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import CalculatorCommand, {
  calcCurrency,
  calcRmb,
  evaluateMathExpression,
  evaluateCalculatorQuery,
  evaluateDateExpression
} from '../dist/index.js'

const host = createHost()
test.beforeEach(() => {
  host.reset()
  setRuntimeLocale('zh-CN')
})

test('i18n: 主计算器中英文热切换实时更新示例、结果与错误提示，英文模式下无中文残留', async () => {
  const view = await mount(CalculatorCommand)
  assert.match(String(view.tree().props.searchBarPlaceholder), /输入算式/)

  // 运行时热切换至 en-US
  setRuntimeLocale('en-US')
  await tick()
  assert.match(String(view.tree().props.searchBarPlaceholder), /Enter expression/)
  assert.ok(!/[\u4e00-\u9fa5]/.test(view.text()), `en-US default view should not contain CJK: ${view.text()}`)

  // 单位换算结果（含 calculator-engine details）
  await view.search('10km to miles')
  const unitItem = view.item('calc-success')
  assert.match(String(unitItem.props.subtitle), /Unit conversion \(LENGTH\)/)
  assert.ok(!/[\u4e00-\u9fa5]/.test(view.text()), `en-US unit result should not contain CJK: ${view.text()}`)

  // 数学错误提示（含 calculator-engine error）
  await view.search('1/0')
  const errItem = view.item('calc-error')
  assert.equal(errItem.props.title, 'Invalid expression')
  assert.equal(errItem.props.subtitle, 'Division by zero')

  // 色彩检测副标题
  await view.search('#3B82F6')
  const colorItem = view.item('color-hex')
  assert.match(String(colorItem.props.subtitle), /Contrast White:/)
  assert.ok(!/[\u4e00-\u9fa5]/.test(view.text()), `en-US color view should not contain CJK: ${view.text()}`)

  // 热切换回 zh-CN
  setRuntimeLocale('zh-CN')
  await tick()
  assert.match(String(view.tree().props.searchBarPlaceholder), /输入算式/)
  assert.match(String(view.item('color-hex').props.subtitle), /对比度 白:/)
})

test('i18n: calculator-engine 独立支持显式 locale 与 document.documentElement.lang 切换', () => {
  assert.equal(evaluateMathExpression('1/0', { locale: 'en-US' }).error, 'Division by zero')
  assert.equal(evaluateMathExpression('1/0', { locale: 'zh-CN' }).error, '除数不能为零')

  const enUnit = evaluateCalculatorQuery('32px to rem', { locale: 'en-US' })
  assert.match(String(enUnit.details), /^Unit conversion \(CSS\):/)

  const enDate = evaluateDateExpression('2026-11-05', { locale: 'en-US' })
  assert.ok(enDate && !/[\u4e00-\u9fa5]/.test(enDate.details), `en-US date details should not contain CJK: ${enDate?.details}`)

  // 模拟前端 document.documentElement.lang 切换（供 frontend/src/vendor/calculator-engine.js 使用）
  const prevDoc = globalThis.document
  globalThis.document = { documentElement: { lang: 'en-US' } }
  try {
    assert.equal(evaluateMathExpression('sqrt(-1)').error, 'Square root of a negative number is not real')
    globalThis.document.documentElement.lang = 'zh-CN'
    assert.equal(evaluateMathExpression('sqrt(-1)').error, '负数没有实数平方根')
  } finally {
    if (prevDoc === undefined) delete globalThis.document
    else globalThis.document = prevDoc
  }
})

test('i18n: 汇率看板与人民币大写子视图支持英文模式无中文残留', async () => {
  setRuntimeLocale('en-US')
  const rmbView = await mount(calcRmb)
  assert.equal(rmbView.tree().props.navigationTitle, 'Chinese RMB Uppercase')
  assert.ok(!/[\u4e00-\u9fa5]/.test(rmbView.text()), `en-US rmb view should not contain CJK: ${rmbView.text()}`)

  const fxView = await mount(calcCurrency)
  assert.equal(fxView.tree().props.navigationTitle, 'Currency Converter')
  assert.match(String(fxView.tree().props.searchBarPlaceholder), /Enter amount/)
})
