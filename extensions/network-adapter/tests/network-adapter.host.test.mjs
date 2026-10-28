// 本插件的宿主集成测试（导入本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchNetworkAdapters,
  applyDnsPreset,
  flushSystemDnsCache,
  prefixLengthToNetmask,
  pickPrimaryAdapter
} from '../dist/logic.js'

/**
 * 按客户端内置网卡服务的真实行为模拟 dllplugin_call：
 * - 函数名不区分大小写：getAdapters / listAdapters / getNetworkInterfaces 读列表，flushDns 刷新缓存，setDns / applyPreset 改 DNS；
 * - 其他任何函数名都会落到读取网卡列表并返回成功，所以插件用错函数名时只能靠记录的调用发现；
 * - 返回值与客户端一致：结果对象再在 data 里复制一份。
 */
function createHostLikeNetworkService(options = {}) {
  const {
    adapters = [],
    listError = null,
    setDnsResult = () => ({ ok: true, success: true, output: '' }),
    flushResult = () => ({ ok: true, success: true, output: 'Windows IP 配置\n已成功刷新 DNS 解析缓存。' })
  } = options
  const calls = []
  const shellCalls = []
  const wrap = (record) => ({ ...record, data: { ...record } })
  const host = {
    dllplugin_call: async ({ plugin, func, params }) => {
      calls.push({ plugin, func, params })
      const fn = String(func).toLowerCase()
      if (fn === 'flushdns') return wrap(flushResult())
      if (fn === 'setdns' || fn === 'applypreset') {
        if (!String(params.adapterName ?? params.name ?? '')) return wrap({ ok: false, success: false, error: '未指定网卡名称' })
        return wrap(setDnsResult(params))
      }
      if (listError) return wrap({ ok: false, success: false, errorCode: 'ADAPTER_LIST_FAILED', error: listError })
      return wrap({ ok: true, success: true, adapters })
    },
    // 客户端不允许插件执行任意命令（shell_exec 恒定拒绝）；插件不应再尝试
    shell_exec: async (params) => {
      shellCalls.push(params)
      throw new Error('Electron 不允许 renderer 执行任意 shell 命令')
    }
  }
  return { host, calls, shellCalls }
}

const WINDOWS_ETHERNET = {
  id: 'Ethernet 2',
  name: 'Ethernet 2',
  description: 'Intel(R) Ethernet Controller I225-V',
  status: 'Up',
  mac: 'AA-BB-CC-DD-EE-FF',
  linkSpeed: '2.5 Gbps',
  ipv4: '192.168.50.10',
  prefixLength: 24,
  gateway: '192.168.50.1',
  dns: '192.168.50.1',
  dnsServers: ['192.168.50.1'],
  speedMbps: 2500
}

test('network-adapter: 真实网卡列表聚合、DNS 预设切换与无管理员权限异常断言', async () => {
  const svc = createHostLikeNetworkService({
    adapters: [WINDOWS_ETHERNET],
    setDnsResult: (params) =>
      params.adapterName === 'Restricted-NIC'
        ? { ok: false, success: false, output: '', error: '请求的操作需要提升（以管理员身份运行）。需要管理员权限' }
        : { ok: true, success: true, output: '' }
  })

  const snap = await fetchNetworkAdapters(svc.host)
  assert.equal(snap.ok, true)
  assert.equal(snap.error, '')
  assert.equal(snap.adapters.length, 1)
  assert.equal(snap.adapters[0].name, 'Ethernet 2')
  assert.equal(snap.adapters[0].netmask, '255.255.255.0', '子网掩码按客户端给的前缀长度换算')
  assert.equal(snap.adapters[0].typeLabel, '有线网卡')
  assert.equal(snap.adapters[0].speedMbps, 2500)
  assert.equal(snap.primaryIpv4, '192.168.50.10')
  assert.equal(snap.primaryGateway, '192.168.50.1')
  assert.equal(snap.primaryDns, '192.168.50.1')
  assert.equal(svc.calls[0].plugin, 'NetworkAdapterPlugin')
  assert.equal(svc.calls[0].func, 'getAdapters')

  // 正常切换 DNS：必须调用客户端实际支持的 setDns，且只传首选 DNS
  svc.calls.length = 0
  const okDns = await applyDnsPreset('Ethernet 2', '223.5.5.5', undefined, svc.host)
  assert.equal(okDns.ok, true)
  assert.deepEqual(okDns.dnsServers, ['223.5.5.5'])
  assert.equal(svc.calls.length, 1)
  assert.equal(svc.calls[0].func, 'setDns')
  assert.equal(svc.calls[0].params.adapterName, 'Ethernet 2')
  assert.equal(svc.calls[0].params.primaryDns, '223.5.5.5')

  // 异常场景 1：非法 DNS IPv4 格式拦截
  const badIp = await applyDnsPreset('Ethernet 2', '999.999.1.1', '', svc.host)
  assert.equal(badIp.ok, false)
  assert.match(badIp.message, /格式不合法/)

  // 异常场景 2：空网卡名称拦截
  const emptyNic = await applyDnsPreset('', '223.5.5.5', '', svc.host)
  assert.equal(emptyNic.ok, false)

  // 异常场景 3：无管理员权限时宿主返回失败，严禁伪造 ok: true
  const deniedDns = await applyDnsPreset('Restricted-NIC', '223.5.5.5', undefined, svc.host)
  assert.equal(deniedDns.ok, false)
  assert.deepEqual(deniedDns.dnsServers, [])
  assert.match(deniedDns.message, /管理员权限/)

  // 异常场景 4：flushSystemDnsCache 当宿主失败时返回 ok: false，且不再尝试执行命令
  const failSvc = createHostLikeNetworkService({
    flushResult: () => ({ ok: false, success: false, output: '无法刷新 DNS 解析缓存: 执行期间，函数出了问题。' })
  })
  const failFlush = await flushSystemDnsCache(failSvc.host)
  assert.equal(failFlush.ok, false)
  assert.match(failFlush.message, /^刷新 DNS 解析缓存失败/)
  assert.equal(failSvc.shellCalls.length, 0)

  const okFlush = await flushSystemDnsCache(svc.host)
  assert.equal(okFlush.ok, true)
  assert.equal(svc.calls.at(-1).func, 'flushDns')
})

test('network-adapter: 客户端读取网卡失败时如实返回错误，不用 127.0.0.1 或示例网卡冒充', async () => {
  const svc = createHostLikeNetworkService({
    listError: '读取网卡列表失败：PowerShell 执行失败（退出码 1）：Get-NetAdapter : 拒绝访问。'
  })
  const snap = await fetchNetworkAdapters(svc.host)
  assert.equal(snap.ok, false)
  assert.deepEqual(snap.adapters, [])
  assert.equal(snap.primaryIpv4, '')
  assert.equal(snap.primaryGateway, '')
  assert.equal(snap.primaryDns, '')
  assert.equal(snap.error, '读取网卡列表失败：PowerShell 执行失败（退出码 1）：Get-NetAdapter : 拒绝访问。', '前缀不重复')
  assert.doesNotMatch(JSON.stringify(snap), /127\.0\.0\.1|10\.0\.0\.|Wi-Fi 6E/)
})

test('network-adapter: 没有客户端时读取、改 DNS、刷新缓存都返回失败，不给离线假结果', async () => {
  assert.equal(typeof globalThis.window, 'undefined')
  const snap = await fetchNetworkAdapters()
  assert.equal(snap.ok, false)
  assert.match(snap.error, /未连接 ZTools 客户端/)
  assert.deepEqual(snap.adapters, [])
  assert.equal(snap.primaryIpv4, '')

  const dns = await applyDnsPreset('Ethernet 2', '223.5.5.5')
  assert.equal(dns.ok, false)
  assert.match(dns.message, /未连接 ZTools 客户端/)

  const dhcp = await applyDnsPreset('Ethernet 2', 'dhcp')
  assert.equal(dhcp.ok, false)

  const flush = await flushSystemDnsCache()
  assert.equal(flush.ok, false)
  assert.match(flush.message, /未连接 ZTools 客户端/)
})

test('network-adapter: 客户端返回无法识别的数据结构时报错，不当成空列表', async () => {
  const host = {
    dllplugin_call: async () => ({ ok: true, success: true, items: 'oops', data: { ok: true, success: true, items: 'oops' } })
  }
  const snap = await fetchNetworkAdapters(host)
  assert.equal(snap.ok, false)
  assert.match(snap.error, /数据格式无法识别/)

  // 客户端确实没有网卡时是成功的空列表，主网卡为空
  const empty = await fetchNetworkAdapters(createHostLikeNetworkService({ adapters: [] }).host)
  assert.equal(empty.ok, true)
  assert.deepEqual(empty.adapters, [])
  assert.equal(empty.primaryIpv4, '')
})

test('network-adapter: 客户端没给的字段留空或标为未知，不填默认 MAC、掩码、速率、MTU、DHCP', async () => {
  const svc = createHostLikeNetworkService({
    adapters: [
      { name: '以太网 3', status: 'Disconnected', linkSpeed: '0 bps', prefixLength: 24, ipv4: '' },
      { name: 'vEthernet (WSL)', status: 'Up', ipv4: '172.24.160.1', prefixLength: 20, linkSpeed: '10 Gbps' },
      { name: '以太网 4', description: 'TAP-Windows Adapter V9', status: 'Not Present' },
      { name: 'WLAN', description: 'Intel(R) Wi-Fi 6 AX201', status: 'Dormant', linkSpeed: '未知' },
      { name: 'Bluetooth 网络连接', description: 'Bluetooth Device (Personal Area Network)', status: '' },
      null,
      'not-an-object'
    ]
  })
  const snap = await fetchNetworkAdapters(svc.host)
  assert.equal(snap.ok, true)
  assert.equal(snap.adapters.length, 5, '非对象条目被跳过')
  const [eth3, wsl, tap, wlan, bt] = snap.adapters

  assert.equal(eth3.mac, '')
  assert.equal(eth3.netmask, '', '没有 IPv4 时不显示占位前缀换算出的掩码')
  assert.equal(eth3.speedMbps, 0)
  assert.equal(eth3.mtu, null)
  assert.equal(eth3.dhcpEnabled, null)
  assert.equal(eth3.description, '')
  assert.equal(eth3.status, 'down')
  assert.equal(eth3.category, 'physical')

  assert.equal(wsl.netmask, '255.255.240.0')
  assert.equal(wsl.category, 'virtual')
  assert.equal(wsl.status, 'up')
  assert.equal(wsl.speedMbps, 10000)

  assert.equal(tap.category, 'virtual', '按网卡型号识别 TAP 虚拟网卡')
  assert.equal(tap.status, 'down')

  assert.equal(wlan.status, 'unknown')
  assert.equal(wlan.speedMbps, 0, '速率未知不按 1 Gbps 估算')
  assert.equal(wlan.typeLabel, '无线网卡')

  assert.equal(bt.status, 'unknown', '没有状态时不当成已连接')
  assert.equal(bt.typeLabel, '蓝牙网卡')

  assert.equal(snap.activeCount, 1)
  assert.equal(snap.primaryIpv4, '172.24.160.1', '只有虚拟网卡已连接时用它，不退回回环地址')
})

test('network-adapter: 主网卡优先选已连接且有网关的物理网卡，只有回环时为空', () => {
  const base = { description: '', ipv6: '', netmask: '', mac: '', dnsServers: [], speedMbps: 0, mtu: null, dhcpEnabled: null, typeLabel: '' }
  const adapters = [
    { ...base, id: 'a', name: 'a', category: 'physical', status: 'down', ipv4: '', gateway: '' },
    { ...base, id: 'b', name: 'b', category: 'virtual', status: 'up', ipv4: '172.24.160.1', gateway: '' },
    { ...base, id: 'c', name: 'c', category: 'physical', status: 'up', ipv4: '192.168.1.8', gateway: '192.168.1.1' },
    { ...base, id: 'd', name: 'd', category: 'loopback', status: 'up', ipv4: '127.0.0.1', gateway: '' }
  ]
  assert.equal(pickPrimaryAdapter(adapters).id, 'c')
  assert.equal(pickPrimaryAdapter([adapters[3]]), null)
  assert.equal(pickPrimaryAdapter([]), null)
  assert.equal(pickPrimaryAdapter([adapters[0], adapters[1]]).id, 'b')
})

test('network-adapter: 备选 DNS 直接拒绝且不调用客户端，恢复自动获取时传空首选 DNS', async () => {
  const svc = createHostLikeNetworkService()
  const both = await applyDnsPreset('Ethernet 2', '223.5.5.5', '119.29.29.29', svc.host)
  assert.equal(both.ok, false)
  assert.match(both.message, /不支持同时设置备选 DNS/)
  assert.equal(svc.calls.length, 0)

  const dhcp = await applyDnsPreset('Ethernet 2', 'DHCP', undefined, svc.host)
  assert.equal(dhcp.ok, true)
  assert.deepEqual(dhcp.dnsServers, [])
  assert.equal(svc.calls[0].func, 'setDns')
  assert.equal(svc.calls[0].params.primaryDns, '', '客户端以空首选 DNS 表示恢复 DHCP')
  assert.match(dhcp.message, /恢复为自动获取/)
})

test('network-adapter: 前缀长度换算子网掩码的边界', () => {
  assert.equal(prefixLengthToNetmask(0), '0.0.0.0')
  assert.equal(prefixLengthToNetmask(32), '255.255.255.255')
  assert.equal(prefixLengthToNetmask(24), '255.255.255.0')
  assert.equal(prefixLengthToNetmask('16'), '255.255.0.0')
  assert.equal(prefixLengthToNetmask(33), '')
  assert.equal(prefixLengthToNetmask(-1), '')
  assert.equal(prefixLengthToNetmask(23.5), '')
  assert.equal(prefixLengthToNetmask('abc'), '')
  assert.equal(prefixLengthToNetmask(undefined), '')
})
