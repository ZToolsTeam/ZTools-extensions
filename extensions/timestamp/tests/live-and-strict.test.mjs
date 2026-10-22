import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import TimestampCommand from '../dist/index.js'
import { parseTimeInput } from '../dist/logic.js'

let host = createHost()
const T0 = Date.UTC(2026, 9, 21, 6, 30, 0, 250) // 2026-10-21T06:30:00.250Z

test.beforeEach(() => {
  host.reset()
  host.toasts.length = 0
  // 只接管 setInterval 与 Date；setTimeout 留给测试工具的 tick 使用
  mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 })
})
test.afterEach(() => mock.timers.reset())

const advance = async (ms) => {
  mock.timers.tick(ms)
  await tick()
}

// ---------- timestamp-1：留空时实时刷新，刷新动作真实生效 ----------

test('[timestamp-1] 留空时每秒推进当前时间，按 Enter 复制的是按下那一刻的值', async () => {
  const view = await mount(TimestampCommand)
  try {
    assert.equal(view.item('item-seconds').props.title, String(Math.floor(T0 / 1000)))
    assert.match(view.text(), /当前实时时间/)

    await advance(3000)
    assert.equal(view.item('item-seconds').props.title, String(Math.floor((T0 + 3000) / 1000)), '3 秒后界面应已推进')
    assert.equal(view.item('item-ms').props.title, String(T0 + 3000))

    // 两次刷新之间（还没到下一次 1 秒刷新）按下复制，仍取按下时刻
    mock.timers.tick(800)
    await view.run(view.item('item-ms'), '复制毫秒级时间戳')
    assert.equal(host.clipboard.text, String(T0 + 3800))
    await view.run(view.item('item-seconds'), '复制秒级时间戳')
    assert.equal(host.clipboard.text, String(Math.floor((T0 + 3800) / 1000)))
    assert.match(JSON.stringify(host.lastToast()), /已复制 秒级时间戳/)
  } finally {
    view.unmount()
  }
})

test('[timestamp-1] 留空时「刷新并重置为当前时间」立即更新并给出提示；有输入时清空并恢复', async () => {
  const view = await mount(TimestampCommand)
  try {
    mock.timers.tick(700) // 不足 1 秒，定时器尚未触发
    await view.run(view.item('item-local'), '刷新并重置为当前时间')
    assert.equal(view.item('item-ms').props.title, String(T0 + 700), '刷新后应立刻显示当前时刻')
    assert.match(JSON.stringify(host.lastToast()), /已刷新为当前时间/)

    await view.search('1700000000')
    assert.match(view.text(), /指定时间解析结果/)
    await view.run(view.item('item-seconds'), '刷新并重置为当前时间')
    assert.match(view.text(), /当前实时时间/)
    assert.equal(view.tree().props.searchText, '')
    assert.match(JSON.stringify(host.lastToast()), /已清空输入/)
  } finally {
    view.unmount()
  }
})

test('[timestamp-1] 仅空格视为留空；输入时间的相对时间随时间推进', async () => {
  const view = await mount(TimestampCommand)
  try {
    await view.search('   ')
    assert.match(view.text(), /当前实时时间/)

    await view.search(new Date(T0 - 2000).toISOString())
    assert.equal(view.item('item-relative').props.title, '刚刚')
    await advance(10000)
    assert.equal(view.item('item-relative').props.title, '12 秒前')
    // 指定时间本身不随时间变化
    assert.equal(view.item('item-ms').props.title, String(T0 - 2000))
  } finally {
    view.unmount()
  }
})

test('[timestamp-1][异常] 卸载后清理定时器，不再触发渲染；剪贴板写入失败不提示成功', async () => {
  const realClear = globalThis.clearInterval
  const cleared = []
  globalThis.clearInterval = (id) => {
    cleared.push(id)
    return realClear(id)
  }
  try {
    const view = await mount(TimestampCommand)
    const before = view.item('item-seconds').props.title
    view.unmount()
    assert.equal(cleared.length, 1, '卸载时必须清理 1 个定时器')
    // 卸载后再推进时间不应抛错
    await advance(5000)
    assert.ok(before)
  } finally {
    globalThis.clearInterval = realClear
  }

  // 宿主拒绝写入（如剪贴板不可用）时，复制动作向上抛错，不弹「已复制」
  const view = await mount(TimestampCommand)
  try {
    const { setDeclarativeBridge } = await import('@ztools/declarative-ui')
    setDeclarativeBridge({
      async copyToClipboard() {
        throw Object.assign(new Error('剪贴板不可用'), { code: 'FAILED' })
      }
    })
    const action = view.actions(view.item('item-seconds')).find((a) => a.props.title === '复制秒级时间戳')
    const toastsBefore = host.toasts.length
    await assert.rejects(() => action.props.onAction(), /剪贴板不可用/)
    assert.equal(host.toasts.length, toastsBefore, '失败时不能提示已复制')
  } finally {
    view.unmount()
    host = createHost() // 恢复测试宿主桥
  }
})

// ---------- timestamp-2：不再用宽松的 Date.parse 编造日期 ----------

test('[timestamp-2] 无意义或缺年份的输入一律报错，不编造 2001 年的日期', () => {
  for (const bad of [
    'abc 1', 'foo 2020', 'version 3.2', 'Oct 21', '1.5', 'page 12', '12/31', '10月21日', 'next friday',
    'Nov 2023', '14 Nov', 'Tue, 14 Nov 22:13:20 GMT'
  ]) {
    const r = parseTimeInput(bad, new Date(T0))
    assert.equal(r.valid, false, `「${bad}」不应被解析`)
    assert.match(r.error, /无法解析|不是一个存在/)
  }
})

test('[timestamp-2][边界] 格式合法但日期/时区不存在时报错，不顺延', () => {
  for (const bad of [
    '2023-02-29T00:00:00Z', '2023-11-14T24:00:00Z', '2023-11-14T22:61:00+08:00', '2023-11-14T22:13:20+25:00',
    '2023-11-14T22:13:20+08:75', '31 Feb 2023 10:00 GMT', '13/01/2023', '02/30/2024',
    'Tue Feb 30 2023 22:13:20 GMT+0800 (中国标准时间)', '2023-11-14T22:13:20+8'
  ]) {
    assert.equal(parseTimeInput(bad).valid, false, bad)
  }
})

test('[timestamp-2] 标准写法照常解析：ISO 8601 带时区/毫秒、RFC 2822、Date#toString、美式日期、本地带毫秒', () => {
  const cases = [
    ['2023-11-14T22:13:20Z', 1700000000000],
    ['2023-11-14T22:13:20.000Z', 1700000000000],
    ['2023-11-14T22:13:20.5Z', 1700000000500],
    ['2023-11-14t22:13:20z', 1700000000000],
    ['2023-11-15T06:13:20+08:00', 1700000000000],
    ['2023-11-15 06:13:20 +0800', 1700000000000],
    ['2023-11-14T17:13:20-0500', 1700000000000],
    ['Tue, 14 Nov 2023 22:13:20 GMT', 1700000000000],
    ['14 Nov 2023 22:13:20 +0000', 1700000000000],
    ['Wed, 15 Nov 2023 06:13 +0800', 1699999980000],
    ['Tue Nov 14 2023 22:13:20 GMT+0000 (Coordinated Universal Time)', 1700000000000],
    ['Wed Nov 15 2023 06:13:20 GMT+0800 (中国标准时间)', 1700000000000]
  ]
  for (const [input, ms] of cases) {
    const r = parseTimeInput(input)
    assert.equal(r.valid, true, `${input}: ${r.error}`)
    assert.equal(r.unixMilliseconds, ms, input)
  }
  // 不写时区按本地时间
  assert.equal(parseTimeInput('2023-11-14 22:13:20.123').localDateTime, '2023-11-14 22:13:20')
  assert.equal(parseTimeInput('2023-11-14 22:13:20.123').unixMilliseconds % 1000, new Date(2023, 10, 14, 22, 13, 20, 123).getTime() % 1000)
  assert.equal(parseTimeInput('12/25/2023').localDateTime, '2023-12-25 00:00:00')
  assert.equal(parseTimeInput('12/25/2023 8:05').localDateTime, '2023-12-25 08:05:00')
  assert.equal(parseTimeInput('2023-11-14T22:13:20').localDateTime, '2023-11-14 22:13:20')
  // JS 自身输出的三种字符串都能原样解析回来（与当前时区无关）
  const d = new Date(1700000000000)
  for (const s of [d.toISOString(), d.toUTCString(), d.toString()]) {
    assert.equal(parseTimeInput(s).unixSeconds, 1700000000, s)
  }
})

test('[timestamp-2] 界面：输入 abc 1 显示解析错误，错误行动作恢复为当前时间', async () => {
  const view = await mount(TimestampCommand)
  try {
    await view.search('abc 1')
    assert.match(view.text(), /解析错误/)
    assert.doesNotMatch(view.text(), /2001/)
    assert.throws(() => view.item('item-seconds'))
    await view.run(view.item('item-error'), '清空输入并恢复当前时间')
    assert.match(view.text(), /当前实时时间/)
    assert.equal(view.item('item-ms').props.title, String(T0))
  } finally {
    view.unmount()
  }
})
