import test from 'node:test'
import assert from 'node:assert/strict'
import { Toast } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import NetworkAdapterCommand from '../dist/index.js'

const wrap = (record) => ({ ...record, data: { ...record } })

/** 模拟客户端内置网卡服务（dllplugin_call），可在测试中途切换返回结果 */
function installNetworkService(host, state) {
  host.ipc.dllplugin_call = async ({ func, params }) => {
    const fn = String(func).toLowerCase()
    if (fn === 'flushdns') return wrap(state.flush ?? { ok: true, success: true, output: '' })
    if (fn === 'setdns' || fn === 'applypreset') {
      const res = state.setDns ? state.setDns(params) : { ok: true, success: true, output: '' }
      return wrap(res)
    }
    if (state.listError) return wrap({ ok: false, success: false, errorCode: 'ADAPTER_LIST_FAILED', error: state.listError })
    return wrap({ ok: true, success: true, adapters: state.adapters })
  }
}

const funcCalls = (host) => host.ipcCalls.filter(([m]) => m === 'dllplugin_call').map(([, p]) => p.func)

const ETHERNET = {
  id: 'Ethernet 2',
  name: 'Ethernet 2',
  description: 'Intel(R) Ethernet Controller I225-V',
  status: 'Up',
  mac: 'AA-BB-CC-DD-EE-FF',
  linkSpeed: '2.5 Gbps',
  speedMbps: 2500,
  ipv4: '192.168.50.10',
  prefixLength: 24,
  gateway: '192.168.50.1',
  dnsServers: ['192.168.50.1']
}

test('network-adapter UI: 读取失败显示错误状态，不显示默认 IP；恢复后显示真实网卡', async () => {
  const host = createHost()
  const state = { listError: '读取网卡列表失败：PowerShell 执行失败（退出码 1）：Get-NetAdapter : 拒绝访问。', adapters: [] }
  installNetworkService(host, state)
  const view = await mount(NetworkAdapterCommand, host)

  const errorItem = view.item('nic-load-error')
  assert.equal(errorItem.props.title, '读取网卡列表失败')
  assert.equal(errorItem.props.subtitle, 'PowerShell 执行失败（退出码 1）：Get-NetAdapter : 拒绝访问。')
  assert.match(view.tree().props.filterBar.summaryText, /读取网卡列表失败/)
  assert.equal(view.tree().props.isLoading, false)
  assert.doesNotMatch(view.text(), /127\.0\.0\.1|10\.0\.0\.1|223\.5\.5\.5/)
  assert.equal(host.toasts.length, 0, '首次加载失败只在列表里显示，不额外弹提示')

  // 手动刷新仍失败：给出失败提示
  const refresh = view.tree().props.filterBar.actions.find((a) => a.id === 'refresh-nic')
  refresh.onAction()
  await tick()
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.match(host.lastToast().message, /拒绝访问/)

  // 客户端恢复后刷新：错误项消失，显示真实网卡
  state.listError = null
  state.adapters = [ETHERNET]
  view.tree().props.filterBar.actions.find((a) => a.id === 'refresh-nic').onAction()
  await tick()
  assert.throws(() => view.item('nic-load-error'))
  const eth = view.item('Ethernet 2')
  assert.equal(eth.props.title, 'Ethernet 2 (192.168.50.10)')
  assert.match(eth.props.subtitle, /掩码: 255\.255\.255\.0/)
  assert.match(view.tree().props.filterBar.summaryText, /主 IPv4: 192\.168\.50\.10 · 默认网关: 192\.168\.50\.1 · 首选 DNS: 192\.168\.50\.1/)
  assert.equal(host.lastToast().style, Toast.Style.Success)
  view.unmount()
})

test('network-adapter UI: 客户端没给的字段显示未识别，没有值的复制动作不出现', async () => {
  const host = createHost()
  installNetworkService(host, {
    adapters: [{ name: '以太网 3', status: 'Disconnected', linkSpeed: '0 bps', ipv4: '', prefixLength: 24 }]
  })
  const view = await mount(NetworkAdapterCommand, host)
  const item = view.item('以太网 3')
  assert.equal(item.props.title, '以太网 3 (未分配 IP)')
  assert.match(item.props.subtitle, /MAC: 未识别/)
  assert.doesNotMatch(item.props.subtitle, /掩码/)
  assert.doesNotMatch(view.text(), /00-00-00-00-00-00|1\.0 Gbps|1000 Mbps/)
  assert.ok(item.props.accessories.every((acc) => acc.progress === undefined), '速率未知时不画进度条')
  assert.ok(item.props.accessories.some((acc) => acc.text === '未连接'))
  assert.match(view.tree().props.filterBar.summaryText, /主网卡: 未识别/)

  const titles = view.actions(item).map((a) => a.props.title)
  assert.ok(!titles.some((t) => t.startsWith('复制 IPv4')), '没有 IPv4 时不提供复制 IPv4')
  assert.ok(!titles.some((t) => t.startsWith('复制 MAC')), '没有 MAC 时不提供复制 MAC')
  assert.equal(titles[0], '复制单行网络摘要')
  assert.ok(!titles.includes('刷新网卡状态') && !titles.some((t) => t.startsWith('刷新 DNS')), '全局动作只放在顶部状态条')

  await view.run(item, '复制单行网络摘要')
  assert.match(host.clipboard.text, /MAC: 未识别/)
  assert.equal(host.lastToast().title, '已复制网卡摘要')
  view.unmount()
})

test('network-adapter UI: 修改 DNS 成功后重新读取实际配置；失败时提示错误且不改动列表', async () => {
  const host = createHost()
  const state = { adapters: [ETHERNET], setDns: null }
  installNetworkService(host, state)
  const view = await mount(NetworkAdapterCommand, host)
  const presetTitle = view.actions(view.item('Ethernet 2')).map((a) => a.props.title).find((t) => t.startsWith('将 DNS 设为 223.5.5.5'))
  assert.ok(presetTitle)
  const titles = view.actions(view.item('Ethernet 2')).map((a) => a.props.title)
  assert.ok(titles[0].startsWith('复制 IPv4') && titles[1].startsWith('复制 MAC'), '前两个动作只放复制类')
  await view.run(view.item('Ethernet 2'), '复制 IPv4 地址 (192.168.50.10)')
  assert.equal(host.clipboard.text, '192.168.50.10')
  await view.run(view.item('Ethernet 2'), '复制 MAC 地址 (AA-BB-CC-DD-EE-FF)')
  assert.equal(host.clipboard.text, 'AA-BB-CC-DD-EE-FF')
  assert.equal(host.lastToast().title, '已复制 MAC 地址')

  // 失败：客户端拒绝（未以管理员身份运行）
  state.setDns = () => ({ ok: false, success: false, output: '', error: '请求的操作需要提升（以管理员身份运行）。' })
  host.ipcCalls.length = 0
  await view.run(view.item('Ethernet 2'), presetTitle)
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.match(host.lastToast().message, /需要提升/)
  assert.deepEqual(funcCalls(host), ['setDns'], '失败后不重新读取，也不在本地改写 DNS')
  assert.match(view.item('Ethernet 2').props.subtitle, /DNS: 192\.168\.50\.1/)

  // 成功：系统里的 DNS 变了，插件重新读取后显示实际值
  state.setDns = (params) => {
    state.adapters = [{ ...ETHERNET, dnsServers: [params.primaryDns] }]
    return { ok: true, success: true, output: '' }
  }
  host.ipcCalls.length = 0
  await view.run(view.item('Ethernet 2'), presetTitle)
  await tick()
  assert.equal(host.toasts.find((t) => t.title === '网卡 DNS 已修改')?.style, Toast.Style.Success)
  assert.deepEqual(funcCalls(host), ['setDns', 'getAdapters'])
  assert.match(view.item('Ethernet 2').props.subtitle, /DNS: 223\.5\.5\.5/)

  // 恢复自动获取：传空首选 DNS
  host.ipcCalls.length = 0
  state.setDns = () => ({ ok: true, success: true, output: '' })
  await view.run(view.item('Ethernet 2'), '恢复自动获取 DNS（需管理员权限）')
  const setDnsCall = host.ipcCalls.find(([m, p]) => m === 'dllplugin_call' && p.func === 'setDns')
  assert.equal(setDnsCall[1].params.primaryDns, '')
  view.unmount()
})

test('network-adapter UI: 刷新 DNS 缓存失败时提示失败', async () => {
  const host = createHost()
  installNetworkService(host, {
    adapters: [ETHERNET],
    flush: { ok: false, success: false, output: '无法刷新 DNS 解析缓存: 执行期间，函数出了问题。' }
  })
  const view = await mount(NetworkAdapterCommand, host)
  view.tree().props.filterBar.actions.find((a) => a.id === 'flush-dns').onAction()
  await tick()
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.equal(host.lastToast().title, 'DNS 刷新失败')
  assert.match(host.lastToast().message, /^刷新 DNS 解析缓存失败/)
  view.unmount()
})
