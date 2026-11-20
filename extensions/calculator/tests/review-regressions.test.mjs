import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import Command, { calcRmb, calcCurrency } from '../dist/index.js'
import { toChineseAmount } from '../dist/rmb.js'
import {
  LATEST_RATES_URL,
  ASSET_QUOTES_URL,
  RATE_CACHE_KEY,
  NETWORK_POLICY,
  validateLatestRates,
  parseAmount,
  convertAmount,
  calcRate
} from '../dist/currency-rates.js'

const host = createHost()
test.beforeEach(() => host.reset())

const latestPayload = () => ({
  result: 'success',
  base_code: 'USD',
  time_last_update_unix: Math.floor(Date.now() / 1000) - 60,
  rates: { USD: 1, CNY: 7, EUR: 0.9, JPY: 150 }
})
const assetsPayload = () => ({ bitcoin: { usd: 50000 }, 'tether-gold': { usd: 2000 } })

function mockHealthyIpc() {
  let latestCalls = 0
  host.ipc.network_http_request = async (params) => {
    if (params.url === LATEST_RATES_URL) {
      latestCalls++
      return { success: true, data: { statusCode: 200, body: JSON.stringify(latestPayload()) } }
    }
    if (params.url === ASSET_QUOTES_URL) {
      return { success: true, data: { statusCode: 200, body: JSON.stringify(assetsPayload()) } }
    }
    throw new Error(`unexpected url: ${params.url}`)
  }
  return () => latestCalls
}

test('人民币大写不经过浮点计算，零值/分/万亿边界与非法金额', () => {
  for (const [input, output] of [
    ['0', '零元整'],
    ['-0.00', '零元整'],
    ['0.01', '零元壹分'],
    ['1.01', '壹元零壹分'],
    ['10.50', '壹拾元伍角'],
    ['100010001', '壹亿零壹万零壹元整'],
    ['1,234.56', '壹仟贰佰叁拾肆元伍角陆分'],
    ['-1.20', '负壹元贰角']
  ]) {
    assert.equal(toChineseAmount(input), output)
  }
  for (const invalid of ['', '1.005', '1e3', '1,23', '1000000000000', 'NaN']) {
    assert.throws(() => toChineseAmount(invalid))
  }
})

test('人民币大写子命令与计算器动作都可达，并可复制', async () => {
  const view = await mount(calcRmb)
  try {
    await view.search('123.45')
    await view.run(view.item('rmb-result'), '复制大写金额')
    assert.equal(host.clipboard.text, '壹佰贰拾叁元肆角伍分')
  } finally {
    view.unmount()
  }
  const main = await mount(Command)
  try {
    await main.run(null, '人民币大写…')
    const form = await mountPushed(host)
    assert.equal(form.tree().props.navigationTitle, '人民币大写')
    form.unmount()
  } finally {
    main.unmount()
  }
})

test('每日汇率严格验证来源、数值与零金额', () => {
  const raw = latestPayload()
  const { rates } = validateLatestRates(raw)
  const rate = calcRate(rates, 'USD', 'CNY')
  assert.equal(convertAmount(parseAmount('100'), rate, 'CNY'), '700.00')
  assert.equal(convertAmount(parseAmount('0'), calcRate(rates, 'CNY', 'USD'), 'USD'), '0.00')
  for (const bad of [
    { ...raw, result: 'error' },
    { ...raw, rates: { USD: 1, CNY: -1 } },
    { ...raw, base_code: 'EUR' },
    { ...raw, rates: { USD: 1 } }
  ]) {
    assert.throws(() => validateLatestRates(bad))
  }
})

test('汇率子命令调用固定真实端点，展示更新时间、来源且新鲜缓存不重复联网', async () => {
  const getLatestCalls = mockHealthyIpc()
  const view = await mount(calcCurrency)
  try {
    await view.search('100 USD to CNY')
    assert.equal(view.item('rate-CNY').props.title, '700.00 CNY')
    assert.match(view.tree().props.filterBar.summaryText, /汇率时间/)
    const openSource = view.actions(view.item('rate-CNY')).find((a) => a.type === 'Action.OpenInBrowser')
    assert.equal(openSource.props.url, 'https://www.exchangerate-api.com')
    await view.run(view.item('rate-CNY'), '复制换算结果')
    assert.equal(host.clipboard.text, '700.00')
    assert.equal(getLatestCalls(), 1)
    assert.ok(host.storage.has(RATE_CACHE_KEY))
  } finally {
    view.unmount()
  }
  // 30 分钟内再次挂载直接使用新鲜缓存，不重复发起网络请求
  const second = await mount(calcCurrency)
  try {
    assert.equal(getLatestCalls(), 1)
    assert.match(second.tree().props.filterBar.summaryText, /缓存于/)
  } finally {
    second.unmount()
  }
})

test('网络失败、HTTP 限流与坏响应明确失败，不产生估算汇率', async () => {
  for (const [response, message] of [
    [null, /网络请求失败|超时/],
    [{ success: true, data: { statusCode: 429, body: '{}' } }, /HTTP 429/],
    [{ success: true, data: { statusCode: 200, body: 'invalid' } }, /不是有效的 JSON/]
  ]) {
    host.reset()
    host.ipc.network_http_request = async () => {
      if (response === null) throw Object.assign(new Error('网络超时'), { code: 'REQUEST_TIMEOUT' })
      return response
    }
    const view = await mount(calcCurrency)
    try {
      await tick(20)
      assert.equal(view.items().some((item) => String(item.props.id).startsWith('rate-') && item.props.id !== 'rate-error'), false)
      const row = view.item('rate-error')
      assert.match(row.props.title, message)
      assert.equal(view.tree().props.isLoading, false)
      assert.ok(!view.actions(row).some((action) => action.type === 'Action.CopyToClipboard'))
    } finally {
      view.unmount()
    }
  }
})

test('过期缓存联网失败时回退展示 7 天内真实缓存并明确标注刷新失败', async () => {
  const twoHoursAgo = Date.now() - 2 * 3600 * 1000
  host.storage.set(
    RATE_CACHE_KEY,
    JSON.stringify({
      base: 'USD',
      rates: { USD: 1, CNY: 6.5, EUR: 0.9 },
      timestamp: twoHoursAgo,
      sourceUpdatedAt: twoHoursAgo,
      assetsStatus: 'partial'
    })
  )
  host.ipc.network_http_request = async () => {
    throw Object.assign(new Error('网络不可达'), { code: 'NETWORK_ERROR' })
  }
  const view = await mount(calcCurrency)
  try {
    await view.search('100 USD to CNY')
    await tick(20)
    assert.equal(view.item('rate-CNY').props.title, '650.00 CNY')
    assert.match(view.tree().props.filterBar.summaryText, /刷新失败.*缓存/)
  } finally {
    view.unmount()
  }
  // 超过 7 天的陈旧缓存不再回退，如实展示获取失败
  host.reset()
  host.storage.set(
    RATE_CACHE_KEY,
    JSON.stringify({
      base: 'USD',
      rates: { USD: 1, CNY: 6.5 },
      timestamp: Date.now() - NETWORK_POLICY.staleMaxAgeMs - 60_000,
      assetsStatus: 'partial'
    })
  )
  host.ipc.network_http_request = async () => {
    throw Object.assign(new Error('网络不可达'), { code: 'NETWORK_ERROR' })
  }
  const expiredView = await mount(calcCurrency)
  try {
    await tick(20)
    assert.ok(expiredView.item('rate-error'))
  } finally {
    expiredView.unmount()
  }
})

test('读缓存失败或缓存损坏不阻断网络请求，缓存写失败仍显示真实结果并提示', async () => {
  for (const setup of [
    () => {
      host.faults.storageRead = new Error('存储不可用')
    },
    () => {
      host.storage.set(RATE_CACHE_KEY, JSON.stringify({ broken: true }))
    }
  ]) {
    host.reset()
    setup()
    mockHealthyIpc()
    const view = await mount(calcCurrency)
    try {
      await view.search('100 USD to CNY')
      await tick(20)
      assert.equal(view.item('rate-CNY').props.title, '700.00 CNY')
    } finally {
      view.unmount()
    }
  }

  host.reset()
  host.faults.storageWrite = new Error('磁盘已满')
  mockHealthyIpc()
  const writeFailView = await mount(calcCurrency)
  try {
    await tick(20)
    assert.equal(writeFailView.item('rate-USD').props.title, '0.14 USD')
    assert.ok(host.toasts.some((t) => /缓存未保存/.test(t.title)))
  } finally {
    writeFailView.unmount()
  }
})
