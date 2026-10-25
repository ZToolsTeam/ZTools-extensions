import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import Command, { calcRmb, calcCurrency } from '../dist/index.js'
import { toChineseAmount } from '../dist/rmb.js'
import { parseRates, convertCurrency, getRates, RATES_URL, RATES_CACHE_KEY } from '../dist/currency-rates.js'
const host = createHost()
test.beforeEach(() => host.reset())
const payload = () => ({ result: 'success', base_code: 'USD', time_last_update_unix: Math.floor(Date.now() / 1000) - 60, time_next_update_unix: Math.floor(Date.now() / 1000) + 86300, rates: { USD: 1, CNY: 7, EUR: 0.9 } })

test('人民币大写不经过浮点计算，零值/分/万亿边界与非法金额', () => {
  for (const [input, output] of [['0', '零元整'], ['-0.00', '零元整'], ['0.01', '零元壹分'], ['1.01', '壹元零壹分'], ['10.50', '壹拾元伍角'], ['100010001', '壹亿零壹万零壹元整'], ['1,234.56', '壹仟贰佰叁拾肆元伍角陆分'], ['-1.20', '负壹元贰角']]) assert.equal(toChineseAmount(input), output)
  for (const invalid of ['', '1.005', '1e3', '1,23', '1000000000000', 'NaN']) assert.throws(() => toChineseAmount(invalid))
})

test('人民币大写子命令与计算器动作都可达，并可复制', async () => {
  const view = await mount(calcRmb)
  try { await view.search('123.45'); await view.run(view.item('rmb-result'), '复制大写金额'); assert.equal(host.clipboard.text, '壹佰贰拾叁元肆角伍分') }
  finally { view.unmount() }
  const main = await mount(Command)
  try { await main.run(null, '人民币大写…'); const form = await mountPushed(host); assert.equal(form.tree().props.navigationTitle, '人民币大写'); form.unmount() }
  finally { main.unmount() }
})

test('每日汇率严格验证来源、时间、数值与零金额', () => {
  const raw = payload(); const rates = parseRates(raw)
  assert.equal(convertCurrency('100 USD to CNY', rates), '700 CNY')
  assert.equal(convertCurrency('0 CNY to USD', rates), '0 USD')
  for (const input of ['1 XYZ to USD', 'bad', '1e999 USD to CNY']) assert.throws(() => convertCurrency(input, rates))
  for (const bad of [{ ...raw, result: 'error' }, { ...raw, rates: { USD: 1, CNY: -1 } }, { ...raw, time_last_update_unix: 1 }, { ...raw, base_code: 'EUR' }, { ...raw, time_next_update_unix: 0 }]) assert.throws(() => parseRates(bad))
})

test('汇率子命令调用固定真实端点，展示更新时间、来源且有效缓存不重复请求', async () => {
  let calls = 0
  host.ipc.network_http_request = async params => {
    calls++; assert.deepEqual(params, { method: 'GET', url: RATES_URL, timeout: 10000 })
    return { success: true, data: { statusCode: 200, body: JSON.stringify(payload()) } }
  }
  const view = await mount(calcCurrency)
  try {
    await view.search('100 USD to CNY')
    assert.equal(view.item('currency-result').props.title, '700 CNY')
    assert.match(view.tree().props.filterBar.summaryText, /来源更新于/)
    assert.equal(view.actions(view.item('currency-source'))[0].props.url, 'https://www.exchangerate-api.com')
    await view.run(view.item('currency-result'), '复制换算结果')
    assert.equal(host.clipboard.text, '700 CNY')
    await getRates(); assert.equal(calls, 1)
    assert.ok(host.storage.has(RATES_CACHE_KEY))
  } finally { view.unmount() }
})

test('网络失败、HTTP 限流与坏响应明确失败，不产生估算汇率', async () => {
  for (const [response, message] of [[null, /网络超时/], [{ success: true, data: { statusCode: 429, body: '{}' } }, /HTTP 429/], [{ success: true, data: { statusCode: 200, body: 'invalid' } }, /不是有效的 JSON/]]) {
    host.reset()
    host.ipc.network_http_request = async () => { if (response === null) throw new Error('网络超时'); return response }
    const view = await mount(calcCurrency)
    try {
      await tick(20)
      assert.equal(view.items().some(item => item.props.id === 'currency-result'), false)
      const row = view.item('currency-error')
      assert.match(row.props.title, message)
      assert.notEqual(row.props.icon, undefined)
      assert.equal(view.tree().props.isLoading, false)
      assert.ok(!view.actions(row).some(action => action.type === 'Action.CopyToClipboard'))
    } finally { view.unmount() }
  }
})

const stalePayload = (hoursAgo) => {
  const updated = Math.floor(Date.now() / 1000) - hoursAgo * 3600
  return { result: 'success', base_code: 'USD', time_last_update_unix: updated, time_next_update_unix: updated + 86400, rates: { USD: 1, CNY: 6.5, EUR: 0.9 } }
}

test('缓存过期（含超过 48 小时）不弹错误：先用旧汇率并标注汇率时间，后台取到新汇率后替换', async () => {
  for (const hoursAgo of [30, 100]) {
    host.reset()
    host.storage.set(RATES_CACHE_KEY, JSON.stringify(stalePayload(hoursAgo)))
    let release
    host.ipc.network_http_request = () => new Promise(resolve => { release = () => resolve({ success: true, data: { statusCode: 200, body: JSON.stringify(payload()) } }) })
    const view = await mount(calcCurrency)
    try {
      await view.search('100 USD to CNY'); await tick(20)
      assert.equal(view.item('currency-result').props.title, '650 CNY')
      assert.match(view.tree().props.filterBar.summaryText, /使用缓存汇率.*已过更新时间/)
      assert.equal(host.toasts.length, 0)
      assert.equal(host.ipcCalls.filter(([m]) => m === 'network_http_request').length, 1)
      release(); await tick(20)
      assert.equal(view.item('currency-result').props.title, '700 CNY')
      assert.doesNotMatch(view.tree().props.filterBar.summaryText, /缓存/)
      assert.equal(host.toasts.length, 0)
    } finally { view.unmount() }
  }
})

test('缓存过期且后台刷新失败：静默保留旧汇率，不显示错误', async () => {
  host.storage.set(RATES_CACHE_KEY, JSON.stringify(stalePayload(30)))
  host.ipc.network_http_request = async () => { throw new Error('网络超时') }
  const view = await mount(calcCurrency)
  try {
    await view.search('100 USD to CNY'); await tick(20)
    assert.equal(view.item('currency-result').props.title, '650 CNY')
    assert.match(view.tree().props.filterBar.summaryText, /使用缓存汇率/)
    assert.equal(host.toasts.length, 0)
  } finally { view.unmount() }
})

test('读缓存失败或缓存损坏不挡网络请求，也不提示错误', async () => {
  for (const setup of [() => { host.faults.storageRead = new Error('存储不可用') }, () => { host.storage.set(RATES_CACHE_KEY, JSON.stringify({ broken: true })) }]) {
    host.reset(); setup()
    host.ipc.network_http_request = async () => ({ success: true, data: { statusCode: 200, body: JSON.stringify(payload()) } })
    const view = await mount(calcCurrency)
    try {
      await view.search('100 USD to CNY'); await tick(20)
      assert.equal(view.item('currency-result').props.title, '700 CNY')
      assert.equal(host.ipcCalls.filter(([m]) => m === 'network_http_request').length, 1)
      assert.ok(!host.toasts.some(t => /缓存汇率不可用/.test(t.title)))
    } finally { view.unmount() }
  }
})

test('汇率缓存写失败仍显示已取得的真实结果并告知，卸载后不更新 UI', async () => {
  host.faults.storageWrite = new Error('磁盘已满')
  host.ipc.network_http_request = async () => ({ success: true, data: { statusCode: 200, body: JSON.stringify(payload()) } })
  assert.equal((await getRates()).rates.CNY, 7)
  assert.match(host.lastToast().title, /未能保存缓存/)
  host.reset()
  let release
  host.ipc.network_http_request = () => new Promise(resolve => { release = () => resolve({ success: true, data: { statusCode: 200, body: JSON.stringify(payload()) } }) })
  const view = await mount(calcCurrency)
  view.unmount(); release(); await tick()
})
