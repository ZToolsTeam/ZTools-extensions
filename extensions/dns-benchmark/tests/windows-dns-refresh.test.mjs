import test from 'node:test'
import assert from 'node:assert/strict'
import DnsCommand from '../dist/index.js'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'

const host = createHost(), views = []
async function settled() { for (let i = 0; i < 6; i++) await tick() }
const calls = func => host.ipcCalls.filter(([m, p]) => m === 'dllplugin_call' && p.func === func)
const isActive = item => item.props.accessories.some(a => a.tag === '当前生效')

/** Windows 旧接口替身：adapterDns 为网卡当前真实 DNS，applyDns / resetDhcp 的结果可按用例替换 */
let adapterDns, applyDns, resetDhcp, adapterFault
test.beforeEach(() => {
  host.reset()
  adapterDns = ['223.5.5.5', '223.6.6.6']; adapterFault = null
  applyDns = async () => ({ ok: true, success: true, currentDns: adapterDns })
  resetDhcp = async () => ({ ok: true, success: true, currentDns: [], isDhcp: true })
  host.ipc.system_get_platform = async () => ({ success: true, platform: 'windows' })
  host.ipc.dllplugin_call = async ({ func, params }) => {
    if (func === 'getActiveAdapters') {
      if (adapterFault) return { ok: false, success: false, error: adapterFault }
      return { ok: true, adapters: [{ name: '以太网', description: 'Intel', ipv4: '192.0.2.10', isDhcp: false, currentDns: [...adapterDns] }] }
    }
    if (func === 'benchmarkDns') return { ok: true, results: params.servers.map((s, i) => ({ id: s.id, primary: s.primary, avgMs: 10 + i, timeout: false })) }
    if (func === 'applyDns') return applyDns(params)
    if (func === 'resetDhcp') return resetDhcp(params)
    throw new Error(`未预期的调用 ${func}`)
  }
})
test.afterEach(() => views.splice(0).forEach(v => v.unmount()))
async function open() { const v = await mount(() => DnsCommand({})); views.push(v); await settled(); return v }

test('备用 DNS 设置失败（主 DNS 已改）：提示失败后重新读取网卡，按真实 DNS 标记“当前生效”，不重新测速', async () => {
  const v = await open()
  assert.equal(calls('getActiveAdapters').length, 1); assert.equal(calls('benchmarkDns').length, 1)
  assert.ok(isActive(v.item('alidns')))
  // 宿主：主 DNS 已写入，备用 DNS 失败
  applyDns = async () => { adapterDns = ['114.114.114.114']; return { ok: false, success: false, errorCode: 'SECONDARY_DNS_FAILED', error: 'SECONDARY_DNS_FAILED: 主 DNS 已修改，备用 DNS 设置失败' } }
  await v.run(v.item('114dns'), v.actions(v.item('114dns'))[0].props.title)
  await settled()
  assert.equal(calls('applyDns').length, 1)
  assert.equal(calls('getActiveAdapters').length, 2, '失败后必须重新读取网卡')
  assert.equal(calls('benchmarkDns').length, 1, '只重新读取 DNS，不重新测速')
  const failure = host.toasts.find(t => /SECONDARY_DNS_FAILED/.test(t.title))
  assert.ok(failure); assert.equal(failure.style, 'FAILURE'); assert.match(failure.message, /重新读取/)
  assert.ok(!host.toasts.some(t => String(t.style).toUpperCase() === 'SUCCESS'))
  assert.ok(!isActive(v.item('alidns')), '旧 DNS 不能继续显示为当前生效')
  assert.ok(isActive(v.item('114dns')))
  assert.match(v.tree().props.filterBar?.summaryText ?? v.text(), /114\.114\.114\.114/)
  // 延迟数据保留（没有被当成无结果或 0 ms）
  assert.match(v.text(), /\d+ ms/)
})

test('其他失败同样重新读取；重新读取也失败时不再标记任何“当前生效”，并如实提示状态未知', async () => {
  const v = await open()
  applyDns = async () => { adapterFault = 'DNS_ADAPTER_QUERY_FAILED: 无法枚举系统活动网卡'; return { ok: false, success: false, errorCode: 'APPLY_DNS_FAILED', error: 'APPLY_DNS_FAILED: 拒绝访问' } }
  await v.run(v.item('114dns'), v.actions(v.item('114dns'))[0].props.title)
  await settled()
  assert.equal(calls('getActiveAdapters').length, 2)
  assert.ok(v.items().every(item => !isActive(item)))
  const last = host.lastToast()
  assert.equal(last.style, 'FAILURE')
  assert.match(last.title, /APPLY_DNS_FAILED: 拒绝访问，且重新读取网卡 DNS 失败/)
  assert.match(last.message, /状态未知.*无法枚举系统活动网卡/)
  assert.match(v.text(), /DNS 状态未知/)
  // 之后重新读取成功会清除“状态未知”
  adapterFault = null; adapterDns = ['223.5.5.5']
  applyDns = async () => ({ ok: false, success: false, error: 'SECONDARY_DNS_FAILED: 备用失败' })
  await v.run(v.item('114dns'), v.actions(v.item('114dns'))[0].props.title)
  await settled()
  assert.doesNotMatch(v.text(), /DNS 状态未知/)
  assert.ok(isActive(v.item('alidns')))
})

test('恢复 DHCP 失败后同样重新读取网卡 DNS', async () => {
  const v = await open()
  const resetTitle = '恢复网卡为 DHCP 自动获取 DNS'
  const before = calls('getActiveAdapters').length
  resetDhcp = async () => { adapterDns = []; return { ok: false, success: false, error: 'RESET_DHCP_FAILED: 部分完成' } }
  await v.run(v.item('alidns'), resetTitle)
  await settled()
  assert.equal(calls('getActiveAdapters').length, before + 1)
  assert.ok(v.items().every(item => !isActive(item)))
  assert.ok(host.toasts.some(t => /RESET_DHCP_FAILED/.test(t.title) && t.style === 'FAILURE'))
})
