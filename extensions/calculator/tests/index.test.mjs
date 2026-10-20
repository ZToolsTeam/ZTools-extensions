import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount } from '../../shared/test-harness.mjs'
import CalculatorCommand, { evaluateMathExpression, evaluateCalculatorQuery } from '../dist/index.js'

const host = createHost()
test.beforeEach(() => host.reset())

test('四则运算、负号、取余、乘方与科学计数法结果正确', () => {
  const cases = {
    '2*-3': -6, '2^-1': 0.5, '-3^2': -9, '(-3)^2': 9, '--2': 2, '1-(-2)': 3, '10%3': 1, '10 % 3': 1,
    '50%': 0.5, '200*50%': 100, '2**10': 1024, '1e21+1': 1e21, '2.5e-3*2': 0.005, '2(3)': 6, '2pi': 2 * Math.PI,
    '(1+2)(3+4)': 21, '3sqrt(16)': 12, '2^3^2': 512, '7/2': 3.5, 'sin(-pi/2)': -1, '+5': 5, '3×4÷2': 6
  }
  for (const [expr, expected] of Object.entries(cases)) {
    const r = evaluateMathExpression(expr)
    assert.ok(r.answer !== null && Math.abs(r.answer - expected) < 1e-12, `${expr} = ${r.answer}，期望 ${expected}（${r.error || ''}）`)
  }
})

test('[破坏性] 非法与越界输入给出错误，不抛异常、不返回错误数值', () => {
  for (const expr of ['1/0', '10%0', '1.2.3+1', '(1+2', '1+', 'sqrt(-1)', '2^9999', 'foo(1)']) {
    const r = evaluateMathExpression(expr)
    assert.equal(r.answer, null, `${expr} 不应得出数值`)
    assert.ok(r.error, `${expr} 应给出错误原因`)
  }
  // 不含运算符的内容不当作算式
  assert.equal(evaluateMathExpression('1.2.3').answer, null)
})

test('不再提供写死汇率的货币换算', () => {
  assert.notEqual(evaluateCalculatorQuery('100 usd to cny').type, 'currency')
})

test('单位换算正确', () => {
  assert.equal(evaluateCalculatorQuery('5 km to m').rawAnswer, 5000)
  assert.equal(evaluateCalculatorQuery('100 c to f').rawAnswer, 212)
})

test('界面：输入算式即时显示结果，可复制；输入框提示里没有汇率', async () => {
  const view = await mount(CalculatorCommand)
  assert.ok(!String(view.tree().props.searchBarPlaceholder).includes('USD'))
  await view.search('2*-3')
  const item = view.item('calc-success')
  assert.ok(view.text().includes('-6'))
  await view.run(item, '复制计算结果')
  assert.equal(host.clipboard.text, '-6')
})
