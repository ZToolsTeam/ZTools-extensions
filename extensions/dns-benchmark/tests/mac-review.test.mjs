import test from 'node:test'
import assert from 'node:assert/strict'
import { MacDnsCommand } from '../dist/index.js'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
const host = createHost(), views = []
const manual = { name: 'Wi-Fi', device: 'en0', addresses: ['192.0.2.100'], servers: ['192.0.2.1'], backup: null }
const backup = { id: 'f020e704-d836-4e4d-9ef3-245346f7ef67', servers: ['192.0.2.1'], createdAt: '2026-01-01T00:00:00Z' }
// 第一个地址（初始选中的 223.5.5.5）最慢、119.29.29.29 最快，每隔 3 个有一个解析失败
const probes = servers => ({ success: true, domain: 'example.com', results: servers.map((server, i) => {
  if (i > 0 && i % 3 === 0) return { server, milliseconds: null, answers: [], error: 'ETIMEOUT' }
  return { server, milliseconds: server === '119.29.29.29' ? 1 : i === 0 ? 999 : 50 + i, answers: ['192.0.2.9'], error: null }
}) })
async function settled() { for (let i = 0; i < 6; i++) await tick() }
async function open(props, service = manual) {
  host.ipc.dns_benchmark = async p => p.action === 'list' ? { success: true, services: [structuredClone(service)] } : p.action === 'benchmark' ? probes(p.servers) : { success: true }
  const view = await mount(() => MacDnsCommand(props)); views.push(view); await settled(); return view
}
const benchCalls = () => host.ipcCalls.filter(([m, p]) => m === 'dns_benchmark' && p.action === 'benchmark').length
test.beforeEach(() => host.reset())
test.afterEach(() => views.splice(0).forEach(v => v.unmount()))

test('测速完成后，用户没手动选过时选中排序后第一个成功地址', async () => {
  const v = await open({ featureCode: 'dns-benchmark-run' })
  assert.match(v.text(), /1 ms/, '测速结果已显示')
  assert.equal(v.tree().props.selectedItemId, '119.29.29.29')
  assert.equal(v.items()[0].props.id, '119.29.29.29')
})

test('用户手动选过的地址，测速完成后不被改掉', async () => {
  const v = await open({ featureCode: 'dns-benchmark-run' })
  v.tree().props.onSelectionChange('114.114.114.114'); await tick()
  await v.tree().props.filterBar.actions[0].onAction(); await settled()
  assert.match(v.text(), /1 ms/)
  assert.equal(v.tree().props.selectedItemId, '114.114.114.114')
})

test('全部解析失败时不强行改选中项', async () => {
  host.ipc.dns_benchmark = async p => p.action === 'list' ? { success: true, services: [manual] } : { success: true, domain: 'example.com', results: p.servers.map(server => ({ server, milliseconds: null, answers: [], error: 'ETIMEOUT' })) }
  const v = await mount(() => MacDnsCommand({ featureCode: 'dns-benchmark-run' })); views.push(v); await settled()
  assert.match(v.text(), /解析失败/)
  assert.equal(v.tree().props.selectedItemId, '223.5.5.5', '保持初始选中项')
})

test('刷新缓存与恢复自动命令打开时不自动测速；按「开始测速」才测', async () => {
  for (const featureCode of ['dns-flush-cache', 'dns-reset-dhcp']) {
    host.reset()
    const v = await open({ featureCode })
    assert.equal(benchCalls(), 0, featureCode)
    assert.match(v.text(), /尚未测试/)
    assert.equal(v.tree().props.filterBar.actions[0].title, '开始测速')
    await v.tree().props.filterBar.actions[0].onAction(); await settled()
    assert.equal(benchCalls(), 1, featureCode)
    assert.equal(v.tree().props.filterBar.actions[0].title, '重新测速', v.tree().props.filterBar.summaryText)
  }
})

test('当前已是自动获取：标注出来且不提供恢复动作', async () => {
  const v = await open({ featureCode: 'dns-reset-dhcp' }, { ...manual, servers: [] })
  const item = v.item('automatic')
  assert.equal(item.props.title, '当前已是自动获取')
  assert.equal(item.props.actions, undefined)
  // 状态行没有动作，默认选中改到可操作的“刷新 DNS 缓存”，Enter 有效
  assert.equal(v.tree().props.selectedItemId, 'flush')
  assert.ok(v.item('flush').props.actions)
  // 用户之后手动选回状态行，不再被程序改走
  v.tree().props.onSelectionChange('automatic'); await settled()
  assert.equal(v.tree().props.selectedItemId, 'automatic')
})

test('手动 DNS 时恢复自动入口仍默认选中“恢复自动 DNS”', async () => {
  const v = await open({ featureCode: 'dns-reset-dhcp' })
  assert.equal(v.tree().props.selectedItemId, 'automatic')
})

test('手动 DNS 时仍可恢复自动', async () => {
  const v = await open({ featureCode: 'dns-reset-dhcp' })
  assert.equal(v.item('automatic').props.title, '恢复自动 DNS')
  assert.ok(v.item('automatic').props.actions)
})

test('没有备份时不提供恢复动作；有备份才提供', async () => {
  let v = await open({ featureCode: 'dns-reset-dhcp' })
  assert.equal(v.item('restore').props.actions, undefined)
  assert.match(v.item('restore').props.subtitle, /尚无备份/)
  v = await open({ featureCode: 'dns-reset-dhcp' }, { ...manual, backup })
  assert.ok(v.item('restore').props.actions)
})
