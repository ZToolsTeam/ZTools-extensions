// 口语省略式中文数字（三百五、一千二、一万五）解析：逻辑层 + 真实声明式运行时界面集成
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount } from '../../shared/test-harness.mjs'
import Command from '../dist/index.js'
import { chineseToNumber, parseChineseNumber } from '../dist/logic.js'

const host = createHost()
test.beforeEach(() => host.reset())

test('逻辑层：单位后直接跟一位数字且中间没有“零”时，按下一级单位计权', () => {
  const cases = {
    三百五: '350',
    一千二: '1200',
    一万五: '15000',
    一百一: '110',
    叁佰伍: '350',
    两千五: '2500',
    一万二千五: '12500',
    一千二百三: '1230',
    一亿五: '150000000',
    十万五: '105000',
    一千二万: '12000000',
    负一万五: '-15000',
    三百五元: '350'
  }
  for (const [input, expected] of Object.entries(cases)) {
    const parsed = parseChineseNumber(input)
    assert.equal(parsed.value, expected, input)
    assert.equal(parsed.colloquial, true, `${input} 应标记为口语省略写法`)
    assert.equal(chineseToNumber(input), expected, input)
  }
})

test('逻辑层：有“零”或写全单位的规范写法保持原值，且不标记口语省略', () => {
  const cases = {
    三百零五: '305',
    一千零二: '1002',
    一万零五: '10005',
    一亿零五: '100000005',
    一万二千零五: '12005',
    二十五: '25',
    十五: '15',
    一万五千: '15000',
    一亿五万: '100050000',
    两千五百万: '25000000',
    叁佰伍拾元: '350',
    负五万零三: '-50003',
    壹万贰仟叁佰肆拾伍元陆角柒分: '12345.67',
    一二三: '123'
  }
  for (const [input, expected] of Object.entries(cases)) {
    const parsed = parseChineseNumber(input)
    assert.equal(parsed.value, expected, input)
    assert.equal(parsed.colloquial, false, `${input} 不应标记为口语省略写法`)
  }
})

test('逻辑层异常：口语省略不会放宽非法写法与 16 位上限', () => {
  assert.throws(() => chineseToNumber('三百五五'), /不能连续出现多个数字/)
  assert.throws(() => chineseToNumber('三五百'), /不能连续出现多个数字/)
  assert.throws(() => chineseToNumber('三百零'), /无意义的零结尾/)
  assert.throws(() => chineseToNumber('一万五万'), /万、亿、兆的顺序不正确/)
  assert.throws(() => chineseToNumber('一百五块'), /无法识别/)
  // 末位 9 按口语计权后正好 16 位，仍在上限内；再大一级就超限
  assert.equal(chineseToNumber('九千九百九十九兆九千九百九十九亿九千九百九十九万九千九百九'), '9999999999999990')
  assert.throws(() => chineseToNumber('九万兆五'), /万、亿、兆的顺序不正确|16 位/)
})

test('界面：输入“三百五”首行显示 350 并提示按口语省略理解，Enter 主动作复制 350', async () => {
  const view = await mount(Command)
  await view.search('三百五')
  const arabic = view.item('res-arabic')
  assert.equal(arabic.props.title, '350')
  assert.match(arabic.props.subtitle, /口语省略写法/)
  assert.match(arabic.props.subtitle, /三百五十/)
  assert.equal(view.item('res-ticket').props.title, '叁佰伍拾元整')
  assert.equal(view.item('res-upper').props.title, '叁佰伍拾')
  assert.equal(view.item('res-lower').props.title, '三百五十')

  await view.run(arabic, '复制 阿拉伯数字')
  assert.equal(host.clipboard.text, '350')
  assert.match(String(host.lastToast().title), /^已复制 阿拉伯数字: 350/)

  await view.run(view.item('res-ticket'), '复制 发票大写')
  assert.equal(host.clipboard.text, '叁佰伍拾元整')
  view.unmount()
})

test('界面：“一千二”“一万五”与规范写法“一千零二”结果不同，规范写法不出现口语提示', async () => {
  const view = await mount(Command)
  await view.search('一千二')
  assert.equal(view.item('res-arabic').props.title, '1200')
  assert.equal(view.item('res-ticket').props.title, '壹仟贰佰元整')

  await view.search('一万五')
  assert.equal(view.item('res-arabic').props.title, '15000')
  assert.equal(view.item('res-ticket').props.title, '壹万伍仟元整')

  await view.search('一千零二')
  const standard = view.item('res-arabic')
  assert.equal(standard.props.title, '1002')
  assert.equal(standard.props.subtitle, '阿拉伯数字金额')
  view.unmount()
})

test('界面异常：非法口语写法显示错误行而不是错误金额，改回合法输入后恢复结果', async () => {
  const view = await mount(Command)
  await view.search('三百五五')
  const err = view.item('err-item')
  assert.match(err.props.title, /不能连续出现多个数字/)
  assert.ok(!view.items().some((i) => i.props.id === 'res-arabic'), '错误时不出现结果行')

  await view.search('三五百')
  assert.match(view.item('err-item').props.title, /不能连续出现多个数字/)

  await view.search('三百五')
  assert.equal(view.item('res-arabic').props.title, '350')
  assert.ok(!view.items().some((i) => i.props.id === 'err-item'), '合法输入后错误行消失')
  view.unmount()
})
