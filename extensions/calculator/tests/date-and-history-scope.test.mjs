// 日期推算的月末与夏令时边界；复制历史 / 置顶 / 示例时不能把输入框里另一条算式写进历史
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { getDeclarativeBridge } from '@ztools/declarative-ui'
import { createHost, mount } from '../../shared/test-harness.mjs'
import CalculatorCommand, { evaluateCalculatorQuery } from '../dist/index.js'

const HISTORY_KEY = 'ztools-calculator-history-v1'
const host = createHost()
test.beforeEach(() => host.reset())
const stored = () => JSON.parse(host.storage.get(HISTORY_KEY) || '[]')
const answer = (q) => evaluateCalculatorQuery(q).formattedAnswer

test('按月 / 按年推算：目标月没有这一天时取当月最后一天，不顺延到下个月', () => {
  assert.equal(answer('2026-01-31 + 1 month'), '2026-02-28')
  assert.equal(answer('2024-01-31 + 1 month'), '2024-02-29', '闰年 2 月')
  assert.equal(answer('2026-03-31 - 1 month'), '2026-02-28', '往前推同样不能落回 3 月')
  assert.equal(answer('2026-05-31 + 1 month'), '2026-06-30')
  assert.equal(answer('2024-02-29 + 1 year'), '2025-02-28')
  assert.equal(answer('2024-02-29 + 4 years'), '2028-02-29')
  assert.equal(answer('2026-12-31 + 2 months'), '2027-02-28', '跨年')
  assert.equal(answer('2026-01-15 + 1 month'), '2026-02-15', '普通日期不受影响')
  assert.equal(answer('2026-10-31 14:30 + 1 month'), '2026-11-30 14:30', '带时间时保留时分')
})

test('[边界] 不存在的日期仍报错', () => {
  const r = evaluateCalculatorQuery('2026-02-30 + 1 month')
  assert.equal(r.type, 'date')
  assert.match(r.error, /日期不存在/)
})

// 夏令时只在有夏令时的时区里出现：用子进程固定 TZ，结果不依赖跑测试的机器
test('[夏令时] 纽约时区：跳过的时刻报错，小时加减按实际经过时间', () => {
  const dist = fileURLToPath(new URL('../dist/index.js', import.meta.url))
  const harness = fileURLToPath(new URL('../../shared/test-harness.mjs', import.meta.url))
  const script = `
    const { createHost } = await import(${JSON.stringify(harness)}); createHost();
    const m = await import(${JSON.stringify(dist)});
    const out = {};
    for (const q of ['2026-03-08 02:30', '2026-11-01 01:30 + 1 hour', '2026-11-01 00:30 + 120 minutes', '2026-03-08 01:30 + 1 hour'])
      { const r = m.evaluateCalculatorQuery(q); out[q] = r.error ? 'ERR:' + r.error : r.formattedAnswer; }
    console.log(JSON.stringify(out));`
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, TZ: 'America/New_York' },
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8'
  })
  assert.equal(res.status, 0, res.stderr)
  const out = JSON.parse(res.stdout.trim().split('\n').pop())
  assert.match(out['2026-03-08 02:30'], /^ERR:.*日期不存在/, '夏令时跳过的 02:30 在本地不存在，不能静默显示成 03:30')
  // 01:30 EDT 过 1 小时是 01:30 EST（墙上时间不变），不是两个小时后的 02:30
  assert.equal(out['2026-11-01 01:30 + 1 hour'], '2026-11-01 01:30')
  assert.equal(out['2026-11-01 00:30 + 120 minutes'], '2026-11-01 01:30')
  assert.equal(out['2026-03-08 01:30 + 1 hour'], '2026-03-08 03:30')
})

test('复制历史结果、置顶结果与示例时，不把输入框里的当前算式写进历史', async () => {
  host.storage.set(HISTORY_KEY, JSON.stringify([
    { id: 'h-pin', expression: '7*6', answer: '42', type: 'math', pinned: true, timestamp: 2 },
    { id: 'h-old', expression: '1+1', answer: '2', type: 'math', timestamp: 1 }
  ]))
  const view = await mount(CalculatorCommand)
  await view.search('9*9')
  await view.run(view.item('h-old'), '复制结果')
  assert.equal(host.clipboard.text, '2')
  await view.run(view.item('h-pin'), '复制结果')
  assert.equal(host.clipboard.text, '42')
  await view.run(view.item('h-old'), '粘贴到前台')
  assert.deepEqual(host.clipboard.pasted, ['2'])
  await view.run(view.item('eg-0'), '复制表达式')
  assert.equal(host.clipboard.text, '1024 * 768')
  assert.deepEqual(stored().map((it) => it.expression), ['7*6', '1+1'], '历史里不能出现未被复制过的 9*9')

  // 复制当前结果本身仍然记入历史
  await view.run(view.item('calc-success'), '复制计算结果')
  assert.equal(stored()[0].expression, '9*9')
  view.unmount()
})

test('[故障注入] 粘贴到前台失败（如 macOS 未授权辅助功能）：如实抛错，不提示成功，也不记入历史', async () => {
  const bridge = getDeclarativeBridge()
  const original = bridge.pasteToActive
  bridge.pasteToActive = async () => { throw Object.assign(new Error('需要辅助功能权限'), { code: 'PERMISSION_DENIED' }) }
  try {
    const view = await mount(CalculatorCommand)
    await view.search('3*3')
    const before = host.toasts.length
    await assert.rejects(view.run(view.item('calc-success'), '粘贴到前台应用'), /辅助功能/)
    assert.ok(!host.toasts.slice(before).some((t) => /粘贴/.test(String(t.title)) && t.style !== 'FAILURE'), '失败时不能出现粘贴成功提示')
    assert.deepEqual(stored(), [])
    view.unmount()
  } finally {
    bridge.pasteToActive = original
  }
})
