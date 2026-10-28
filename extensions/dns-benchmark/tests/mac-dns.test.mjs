import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import DnsCommand, { MacDnsCommand, commands } from '../dist/index.js'
import { probeServers, listServices, changeDns } from '../dist/mac-dns-service.js'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
const host = createHost(), views = []
const service = { name: 'Wi-Fi', device: 'en0', addresses: ['192.0.2.100'], servers: ['192.0.2.1'], backup: null }
const backup = { id: 'f020e704-d836-4e4d-9ef3-245346f7ef67', servers: ['192.0.2.1'], createdAt: '2026-01-01T00:00:00Z' }
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { resolve, reject, promise } }
const probes = servers => ({ success: true, domain: 'example.com', results: servers.map((server, i) => ({ server, milliseconds: i, answers: ['192.0.2.9'], error: null })) })
async function settled() { for (let i = 0; i < 5; i++) await tick() }
async function open(component = MacDnsCommand, props) { const view = await mount(() => component(props)); views.push(view); await settled(); return view }
test.beforeEach(() => {
  host.reset()
  host.ipc.system_get_platform = async () => ({ success: true, platform: 'macos' })
  host.ipc.dns_benchmark = async p => p.action === 'list' ? { success: true, services: [structuredClone(service)] } : p.action === 'benchmark' ? probes(p.servers) :
    p.action === 'cancel' ? { success: true, cancelRequested: true } : p.action === 'flush' ? { success: true } :
      { success: true, service: { ...service, servers: p.action === 'reset' ? [] : p.action === 'restore' ? backup.servers : p.servers, backup } }
})
test.afterEach(() => views.splice(0).forEach(v => v.unmount()))
test('Mac 入口使用真实 DNS 接口，三条命令映射齐全，零延迟值有效', async () => {
  const v = await open(DnsCommand)
  assert.ok(v.items().length > 20); assert.match(v.text(), /0 ms/)
  assert.ok(host.ipcCalls.some(([m]) => m === 'system_get_platform')); assert.ok(host.ipcCalls.some(([m]) => m === 'dns_benchmark'))
  assert.ok(host.ipcCalls.every(([m]) => m !== 'dllplugin_call'))
  const manifest = JSON.parse(fs.readFileSync(new URL('../plugin.json', import.meta.url)))
  assert.deepEqual(Object.keys(commands).sort(), manifest.features.map(f => f.code).sort())
})
test('Enter 主动作应用所选单个地址，携带原 DNS 校验，成功后显示真实读回与备份', async () => {
  const v = await open(), row = v.items().find(v => v.props.id === '223.5.5.5')
  await row.props.actions.children[0].props.onAction(); await settled()
  const call = host.ipcCalls.find(([m, p]) => m === 'dns_benchmark' && p.action === 'apply')[1]
  assert.deepEqual(call.servers, ['223.5.5.5']); assert.deepEqual(call.expectedServers, service.servers); assert.equal(call.service, 'Wi-Fi')
  assert.match(v.text(), /当前使用/); assert.match(v.item('restore').props.subtitle, /192\.0\.2\.1/)
  assert.match(host.lastToast().title, /系统已确认/)
})
test('未测试或解析失败的地址禁止应用，失败不会标为 1500ms 或虚构备用值', async () => {
  host.ipc.dns_benchmark = async p => p.action === 'list' ? { success: true, services: [service] } : { success: true, domain: 'example.com', results: p.servers.map(server => ({ server, milliseconds: null, answers: [], error: 'ETIMEOUT' })) }
  const v = await open(); assert.match(v.text(), /解析失败/); assert.doesNotMatch(v.text(), /1500 ms/)
  await v.item('223.5.5.5').props.actions.children[0].props.onAction(); await settled()
  assert.match(v.text(), /选择成功返回解析结果/); assert.ok(!host.ipcCalls.some(([, p]) => p.action === 'apply'))
})
test('授权取消与配置冲突保留旧状态，不弹成功提示', async () => {
  const v = await open(); host.ipc.dns_benchmark = async () => { throw new Error('DNS 配置已被其他程序修改') }
  await v.item('automatic').props.actions.children[0].props.onAction(); await settled()
  assert.match(v.text(), /其他程序修改/); assert.doesNotMatch(v.text(), /当前 DNS：自动获取/); assert.doesNotMatch(host.lastToast().title, /已确认/)
})
test('取消测速和退出会通知宿主，迟到结果不能覆盖界面', async () => {
  const pending = deferred()
  host.ipc.dns_benchmark = async p => p.action === 'list' ? { success: true, services: [service] } : p.action === 'benchmark' ? pending.promise : { success: true, cancelled: true }
  const v = await open(); const request = host.ipcCalls.find(([, p]) => p.action === 'benchmark')[1]
  await v.tree().props.filterBar.actions[0].onAction(); pending.resolve(probes(request.servers)); await settled()
  assert.doesNotMatch(v.text(), /0 ms/); assert.equal(v.tree().props.isLoading, false)
  assert.ok(host.ipcCalls.some(([, p]) => p.action === 'cancel' && p.operationId === request.operationId))
  const again = deferred(); host.ipc.dns_benchmark = async p => p.action === 'list' ? again.promise : { success: true }
  const refresh = v.tree().props.filterBar.actions[0].onAction(); await tick(); v.unmount(); again.resolve({ success: true, services: [service] }); await refresh
  assert.equal(host.toasts.length, 0)
})
test('取消请求后事务若已提交，显示实际成功而非“已撤销”', async () => {
  const v = await open(), pending = deferred()
  host.ipc.dns_benchmark = async p => p.action === 'reset' ? pending.promise : { success: true, cancelRequested: true }
  const applying = v.item('automatic').props.actions.children[0].props.onAction(); await tick()
  await v.tree().props.filterBar.actions[0].onAction(); pending.resolve({ success: true, service: { ...service, servers: [], backup } }); await applying; await settled()
  assert.match(host.lastToast().title, /系统已确认/); assert.match(v.text(), /当前 DNS：自动获取/)
})
test('刷新缓存、恢复自动和备份入口指向实际操作，缓存授权失败不会报成功', async () => {
  const v = await open(MacDnsCommand, { featureCode: 'dns-flush-cache' }); assert.equal(v.tree().props.selectedItemId, 'flush')
  await v.item('flush').props.actions.children[0].props.onAction(); await settled(); assert.match(host.lastToast().title, /缓存已刷新/)
  host.ipc.dns_benchmark = async () => { throw new Error('用户取消授权') }
  await v.item('flush').props.actions.children[0].props.onAction(); await settled(); assert.match(v.text(), /用户取消授权/)
  const missing = await open(MacDnsCommand, { featureCode: 'dns-reset-dhcp' }); assert.equal(missing.tree().props.selectedItemId, 'automatic')
})
test('空网络、旧客户端、无效协议均明确报错，不生成 WLAN 或默认地址', async () => {
  host.ipc.dns_benchmark = async () => ({ success: true, services: [] })
  const v = await open(); assert.match(v.text(), /未找到已连接/); assert.doesNotMatch(v.text(), /WLAN|192\.168\.1\.100/)
  host.ipc.dns_benchmark = async () => ({ success: true, services: [{}] }); await assert.rejects(listServices('x'))
  host.ipc.dns_benchmark = async () => ({ success: true, domain: 'example.com', results: [{ server: '1.1.1.1', milliseconds: 0, answers: [], error: null }] }); await assert.rejects(probeServers('x', ['1.1.1.1']))
  host.ipc.dns_benchmark = async () => ({ success: true, service: { ...service, name: 'Other' } }); await assert.rejects(changeDns('x', service, 'reset'))
  globalThis.__ztoolsElectron.transport.methods = {}; const old = await open(); assert.match(old.text(), /升级客户端/)
})
