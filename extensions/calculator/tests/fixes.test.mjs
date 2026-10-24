import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount } from '../../shared/test-harness.mjs'
import CalculatorCommand, {
  evaluateCalculatorQuery,
  evaluateMathExpression,
  addCalculatorHistory,
  getCalculatorHistory,
  togglePinCalculatorHistory,
  MAX_RECENT_HISTORY
} from '../dist/index.js'

const HISTORY_KEY = 'ztools-calculator-history-v1'
const host = createHost()
test.beforeEach(() => host.reset())

const stored = () => JSON.parse(host.storage.get(HISTORY_KEY) || '[]')
const seedHistory = (items) => host.storage.set(HISTORY_KEY, JSON.stringify(items))

// ---------------------------------------------------------------------------
// calculator-2：「填入搜索框」类动作必须写回受控输入框，并选中新结果
// ---------------------------------------------------------------------------

test('[calculator-2] 列表是受控输入框：填入示例后输入框显示示例、结果行被选中，Enter 复制的是新结果', async () => {
  const view = await mount(CalculatorCommand)
  assert.equal(view.tree().props.searchText, '')
  await view.run(view.item('eg-1'), '填入搜索框并计算')
  assert.equal(view.tree().props.searchText, 'sqrt(65536)', '输入框应显示被填入的示例')
  assert.equal(view.tree().props.selectedItemId, 'calc-success', '应选中新算出的结果行')
  const result = view.item('calc-success')
  assert.equal(result.props.title, '= 256')
  // 选中项上的第一个动作就是 Enter：复制新结果，而不是旧示例的「填入」
  await view.run(result, '复制计算结果')
  assert.equal(host.clipboard.text, '256')
  view.unmount()
})

test('[calculator-2] 将结果填入输入框：填原始数值（去千分位），可以继续追加计算', async () => {
  const view = await mount(CalculatorCommand)
  await view.search('1024 * 768')
  assert.equal(view.item('calc-success').props.title, '= 786,432')
  await view.run(view.item('calc-success'), '将结果填入输入框')
  assert.equal(view.tree().props.searchText, '786432')
  // 单独一个数字仍显示结果行，不会让结果凭空消失
  assert.equal(view.item('calc-success').props.title, '= 786,432')
  // 用户在填入内容后继续输入：输入框交还给用户，受控选中清空
  await view.search('786432+1')
  assert.equal(view.tree().props.searchText, '786432+1')
  assert.equal(view.tree().props.selectedItemId, undefined)
  assert.equal(view.item('calc-success').props.title, '= 786,433')
  view.unmount()
})

test('[calculator-2] 单位与进制结果填回可再次计算的文字', () => {
  assert.equal(evaluateCalculatorQuery('5 km to m').fillText, '5000')
  assert.equal(evaluateCalculatorQuery('255 to hex').fillText, '0xFF')
  assert.equal(evaluateCalculatorQuery('#3b82f6').fillText, '#3B82F6')
  assert.equal(evaluateCalculatorQuery('1+').fillText, undefined, '出错时没有可填入的结果')
})

test('[calculator-2] 历史与置顶项「填入搜索框」写回输入框；移动选中项后受控选中解除，再次填入仍生效', async () => {
  seedHistory([
    { id: 'h-pin', expression: '7*6', answer: '42', type: 'math', pinned: true, timestamp: 2 },
    { id: 'h-1', expression: '9*9+1', answer: '82', type: 'math', pinned: false, timestamp: 1 }
  ])
  const view = await mount(CalculatorCommand)
  await view.run(view.item('h-1'), '填入搜索框')
  assert.equal(view.tree().props.searchText, '9*9+1')
  assert.equal(view.tree().props.selectedItemId, 'calc-success')
  // 用户用方向键移到别的行：渲染器回调 onSelectionChange，插件放弃受控选中
  view.tree().props.onSelectionChange('h-pin')
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(view.tree().props.selectedItemId, undefined)
  await view.run(view.item('h-pin'), '填入搜索框')
  assert.equal(view.tree().props.searchText, '7*6')
  assert.equal(view.tree().props.selectedItemId, 'calc-success')
  assert.equal(view.item('calc-success').props.title, '= 42')
  view.unmount()
})

test('[calculator-2][异常] 填入的内容算不出结果时选中错误行；清空输入后回到初始列表', async () => {
  seedHistory([{ id: 'h-bad', expression: '(1+2', answer: '?', type: 'math', pinned: false, timestamp: 1 }])
  const view = await mount(CalculatorCommand)
  await view.run(view.item('h-bad'), '填入搜索框')
  assert.equal(view.tree().props.searchText, '(1+2')
  assert.equal(view.tree().props.selectedItemId, 'calc-error')
  assert.match(view.item('calc-error').props.subtitle, /括号不匹配/)
  // Esc 清空（渲染器调用 onSearchTextChange("")）：结果区消失，输入框为空
  await view.search('')
  assert.equal(view.tree().props.searchText, '')
  assert.ok(!view.items().some((it) => it.props.id === 'calc-error' || it.props.id === 'calc-success'))
  view.unmount()
})

// ---------------------------------------------------------------------------
// calculator-6：数值精度
// ---------------------------------------------------------------------------

test('[calculator-6] 极小数不再显示为 0，-0 规范为 0，常规小数无浮点尾差', () => {
  const cases = {
    '1/1000000000': '1e-9',
    '2^-30': '9.31322574615479e-10',
    '-0': '0',
    '0*-1': '0',
    '-1e-30': '-1e-30',
    '0.1+0.2': '0.3',
    '1.15*100': '115',
    '1/3': '0.333333333333333',
    '1234567.123456': '1,234,567.123456',
    '7/2': '3.5',
    '1024*768': '786,432',
    '2^100': '1.26765060022823e+30'
  }
  for (const [expr, expected] of Object.entries(cases)) {
    assert.equal(evaluateMathExpression(expr).formattedAnswer, expected, expr)
  }
  assert.ok(Object.is(evaluateMathExpression('-0').answer, 0), '-0 的数值也应规范为 0')
  // 科学计数法结果可以原样填回再计算
  assert.equal(evaluateMathExpression('1e-9*1000000000').formattedAnswer, '1')
  assert.equal(evaluateMathExpression('1.26765060022823e+30/1e30').formattedAnswer, '1.26765060022823')
})

test('[calculator-6] 进制换算超过 2^53 仍精确', () => {
  assert.equal(evaluateCalculatorQuery('0xFFFFFFFFFFFFFFFF to dec').formattedAnswer, '18446744073709551615')
  assert.equal(evaluateCalculatorQuery('9007199254740993 to hex').formattedAnswer, '0x20000000000001')
  assert.equal(evaluateCalculatorQuery('18446744073709551615 to bin').formattedAnswer, '0b' + '1'.repeat(64))
  assert.equal(evaluateCalculatorQuery('0o777 to dec').formattedAnswer, '511')
  assert.equal(evaluateCalculatorQuery('0b1010 to hex').formattedAnswer, '0xA')
  // [异常] 非法进制数字不当作换算
  assert.notEqual(evaluateCalculatorQuery('0b102 to dec').type, 'unit')
  assert.notEqual(evaluateCalculatorQuery('0xZZ to dec').type, 'unit')
})

test('[calculator-6] 界面复制极小数与 64 位进制结果得到正确值', async () => {
  const view = await mount(CalculatorCommand)
  await view.search('1/1000000000')
  await view.run(view.item('calc-success'), '复制计算结果')
  assert.equal(host.clipboard.text, '1e-9')
  await view.search('0xFFFFFFFFFFFFFFFF to dec')
  await view.run(view.item('calc-success'), '复制计算结果')
  assert.equal(host.clipboard.text, '18446744073709551615')
  view.unmount()
})

// ---------------------------------------------------------------------------
// calculator-7：单位换算的负数与畸形数字
// ---------------------------------------------------------------------------

test('[calculator-7] 单位换算支持负数', () => {
  assert.equal(evaluateCalculatorQuery('-40c to f').formattedAnswer, '-40 °F')
  assert.equal(evaluateCalculatorQuery('-10 c to f').formattedAnswer, '14 °F')
  assert.equal(evaluateCalculatorQuery('-16px to rem').formattedAnswer, '-1 rem')
  assert.equal(evaluateCalculatorQuery('-2.5rem to px').formattedAnswer, '-40 px')
  assert.equal(evaluateCalculatorQuery('+5 km to m').formattedAnswer, '5000 m')
  assert.equal(evaluateCalculatorQuery('-273.15 c to k').formattedAnswer, '0 °K')
  assert.equal(evaluateCalculatorQuery('-0.001 c to c').formattedAnswer, '0 °C', '舍入后的 -0 应显示为 0')
})

test('[calculator-7][异常] 畸形数字与低于绝对零度给出明确错误，不再静默得出结果', () => {
  for (const q of ['1.5.5 km to m', '. km to m', '1..2 kg to g', '1.5.5px to rem', '-1.2.3 c to f']) {
    const r = evaluateCalculatorQuery(q)
    assert.equal(r.type, 'unit', q)
    assert.equal(r.formattedAnswer, '', q)
    assert.match(r.error || '', /数字格式不正确/, q)
  }
  for (const q of ['-1 k to c', '-300 c to f', '-500 f to c']) {
    const r = evaluateCalculatorQuery(q)
    assert.match(r.error || '', /绝对零度/, q)
  }
  // 不认识的单位不当作换算（继续按算式处理）
  assert.notEqual(evaluateCalculatorQuery('1.5.5 foo to bar').type, 'unit')
})

test('[calculator-7] 界面：负温度显示结果，畸形数字显示错误行且不可复制', async () => {
  const view = await mount(CalculatorCommand)
  await view.search('-40c to f')
  assert.equal(view.item('calc-success').props.title, '= -40 °F')
  await view.search('1.5.5 km to m')
  assert.ok(!view.items().some((it) => it.props.id === 'calc-success'))
  const err = view.item('calc-error')
  assert.match(err.props.subtitle, /数字格式不正确/)
  assert.equal(view.actions(err).length, 0, '错误行不提供复制动作')
  view.unmount()
})

// ---------------------------------------------------------------------------
// calculator-8 / calculator-v1：置顶状态与淘汰
// ---------------------------------------------------------------------------

test('[calculator-8] 再次复制已置顶的算式：仍然置顶，id 不变，只更新时间与结果', async () => {
  const view = await mount(CalculatorCommand)
  await view.search('2+2')
  await view.run(view.item('calc-success'), '复制计算结果')
  const [first] = stored()
  assert.equal(first.expression, '2+2')
  await view.search('')
  await view.run(view.item(first.id), '置顶此算式')
  assert.equal(stored()[0].pinned, true)

  await view.search('2+2')
  await view.run(view.item('calc-success'), '复制计算结果')
  await view.run(view.item('calc-success'), '保存到历史算式')
  const after = stored()
  assert.equal(after.length, 1, '同一算式只保留一条')
  assert.equal(after[0].id, first.id)
  assert.equal(after[0].pinned, true)
  assert.ok(after[0].timestamp >= first.timestamp)
  assert.ok(view.text().includes('已置顶常用数字与算式'), '置顶分区仍在')

  // 重新打开插件（模拟重载）后依旧置顶
  view.unmount()
  const reopened = await mount(CalculatorCommand)
  const pinned = reopened.item(first.id)
  assert.equal(pinned.props.accessories[0].text, '置顶')
  reopened.unmount()
})

test('[calculator-v1] 置顶项不会因新增 100 条以上历史被淘汰，未置顶最多保留 100 条', async () => {
  await addCalculatorHistory('7*6', '42', 'math')
  const [pinnedItem] = await getCalculatorHistory()
  await togglePinCalculatorHistory(pinnedItem.id)
  for (let i = 0; i < MAX_RECENT_HISTORY + 50; i++) await addCalculatorHistory(`${i}+1`, String(i + 1), 'math')
  const items = stored()
  const pinned = items.filter((it) => it.pinned)
  const recent = items.filter((it) => !it.pinned)
  assert.deepEqual(pinned.map((it) => it.id), [pinnedItem.id])
  assert.equal(recent.length, MAX_RECENT_HISTORY)
  // 淘汰的是最旧的未置顶项
  assert.equal(recent[0].expression, `${MAX_RECENT_HISTORY + 49}+1`)
  assert.ok(!items.some((it) => it.expression === '0+1'))
})

test('[calculator-v1][异常] 已有超过 100 条未置顶的旧数据（含多个置顶）时，新增一条后置顶全部保留', async () => {
  const old = []
  for (let i = 0; i < 130; i++) {
    old.push({ id: `o-${i}`, expression: `o${i}`, answer: '0', type: 'math', pinned: i % 40 === 39, timestamp: 130 - i })
  }
  seedHistory(old)
  await addCalculatorHistory('1+1', '2', 'math')
  const items = stored()
  assert.deepEqual(items.filter((it) => it.pinned).map((it) => it.id), ['o-39', 'o-79', 'o-119'])
  assert.equal(items.filter((it) => !it.pinned).length, MAX_RECENT_HISTORY)
  assert.equal(items[0].expression, '1+1')
})

test('[calculator-8][异常] 读取历史失败时不覆盖已有历史（含置顶），界面提示保存失败', async () => {
  seedHistory([{ id: 'h-pin', expression: '7*6', answer: '42', type: 'math', pinned: true, timestamp: 1 }])
  const view = await mount(CalculatorCommand)
  await view.search('2+2')
  host.faults.storageRead = new Error('磁盘读取失败')
  await view.run(view.item('calc-success'), '复制计算结果')
  assert.equal(host.clipboard.text, '4', '复制本身已经成功')
  assert.deepEqual(stored().map((it) => it.id), ['h-pin'], '历史不能被一条新记录整体覆盖')
  assert.equal(host.lastToast().title, '历史记录保存失败')
  assert.ok(view.text().includes('已置顶常用数字与算式'), '界面上的置顶项仍在')

  host.faults.storageRead = null
  host.faults.storageWrite = new Error('磁盘已满')
  await view.run(view.item('calc-success'), '保存到历史算式')
  assert.equal(host.lastToast().title, '历史记录保存失败', '写入失败不能提示「已保存」')
  assert.deepEqual(stored().map((it) => it.id), ['h-pin'])
  view.unmount()
})

test('[calculator-8][异常] 存储里的历史数据损坏（不是数组）时按空列表处理，可以正常新增', async () => {
  host.storage.set(HISTORY_KEY, JSON.stringify({ broken: true }))
  const updated = await addCalculatorHistory('3*3', '9', 'math')
  assert.equal(updated.length, 1)
  assert.equal(stored()[0].expression, '3*3')
})
