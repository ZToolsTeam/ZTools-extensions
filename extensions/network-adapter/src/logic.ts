/**
 * 网卡管理：读取本机网络接口（IPv4、子网掩码、MAC、网关、DNS），刷新 DNS 缓存，设置网卡 DNS。
 *
 * 数据全部来自客户端提供的网卡接口（Windows 上由 PowerShell 的 Get-NetAdapter / Get-NetIPConfiguration 读取）。
 * - 读取失败时如实返回错误，不用示例数据或 127.0.0.1 之类的默认值冒充；
 * - 客户端没有给出的字段留空（界面显示“未识别”），不填默认值。
 */

import { invokePluginService } from './native-ipc.js'

export type AdapterCategory = 'physical' | 'virtual' | 'loopback'
export type AdapterFilterMode = 'all' | 'physical' | 'virtual' | 'connected'
/** up：已连接；down：未连接 / 已禁用 / 设备不存在；unknown：客户端没有给出可识别的状态 */
export type AdapterStatus = 'up' | 'down' | 'unknown'

export interface NetworkAdapterItem {
  id: string
  name: string
  description: string
  category: AdapterCategory
  typeLabel: string
  status: AdapterStatus
  ipv4: string
  ipv6: string
  /** 子网掩码；网卡没有 IPv4 或客户端未给出时为空 */
  netmask: string
  gateway: string
  /** MAC 地址；客户端未给出时为空 */
  mac: string
  dnsServers: string[]
  /** 链路速率（Mbps）；0 表示客户端未给出或网卡未连接 */
  speedMbps: number
  /** MTU；客户端未给出时为 null */
  mtu: number | null
  /** 是否通过 DHCP 获取地址；客户端未给出时为 null */
  dhcpEnabled: boolean | null
}

export interface NetworkAdapterSnapshot {
  /** 读取成功为 true；失败时 adapters 为空，error 给出原因 */
  ok: boolean
  error: string
  adapters: NetworkAdapterItem[]
  activeCount: number
  physicalCount: number
  virtualCount: number
  /** 主网卡：已连接、有 IPv4、非回环，优先有默认网关的物理网卡；找不到时以下字段都为空字符串 */
  primaryName: string
  primaryIpv4: string
  primaryGateway: string
  primaryDns: string
}

/** 客户端内置网卡服务的名称（dllplugin_call 的 plugin 参数） */
export const HOST_PLUGIN_NAME = 'NetworkAdapterPlugin'

/** 读取网卡列表失败时 error 的固定前缀 */
export const ADAPTER_LIST_ERROR_PREFIX = '读取网卡列表失败'

/** 把宿主返回的错误整理成用户能看懂的文字；宿主接口根本不存在时说明未连接客户端 */
export function describeHostError(error: unknown, fallback: string): string {
  const text = typeof error === 'string' ? error.trim() : ''
  if (!text) return fallback
  if (text === 'NO_WINDOW_ENV' || text.startsWith('METHOD_NOT_AVAILABLE')) {
    return '未连接 ZTools 客户端，无法调用网卡接口'
  }
  return text
}

/** 客户端返回的单条网卡记录（字段名与类型都以客户端为准，逐个收窄后使用） */
type RawAdapter = Record<string, unknown>

function isRecord(value: unknown): value is RawAdapter {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 字符串或数字取文本（去首尾空白），其他类型视为没有值 */
function textOf(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function parseAdapterSpeedMbps(raw: RawAdapter): number {
  const { speedMbps, linkSpeed } = raw
  if (typeof speedMbps === 'number' && Number.isFinite(speedMbps) && speedMbps > 0) return speedMbps
  if (typeof linkSpeed === 'number' && Number.isFinite(linkSpeed) && linkSpeed > 0) return linkSpeed
  if (typeof linkSpeed === 'string') {
    const match = linkSpeed.trim().match(/^(\d+(?:\.\d+)?)\s*(gbps|mbps|kbps|bps)?$/i)
    if (match) {
      const val = parseFloat(match[1])
      if (!(val > 0)) return 0
      const unit = (match[2] || 'mbps').toLowerCase()
      if (unit === 'gbps') return Math.round(val * 1000)
      if (unit === 'kbps') return Math.max(1, Math.round(val / 1000))
      if (unit === 'bps') return Math.max(1, Math.round(val / 1_000_000))
      return Math.round(val)
    }
  }
  // “未知”、空值或无法解析：如实记为 0（未知），不按 1 Gbps 估算
  return 0
}

function parseAdapterDnsServers(raw: RawAdapter): string[] {
  const list = Array.isArray(raw.dnsServers) ? raw.dnsServers : Array.isArray(raw.dns) ? raw.dns : null
  if (list) return list.map(textOf).filter(Boolean)
  if (typeof raw.dns === 'string') {
    return raw.dns
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return []
}

const DOWN_STATUS_PATTERN = /disconnected|disabled|down|offline|not[\s_-]*present|未连接|已禁用|已断开/i
const UP_STATUS_PATTERN = /^(?:up|connected|loopback|已连接)$/i

function parseAdapterStatus(raw: RawAdapter): AdapterStatus {
  const text = textOf(raw.status)
  if (!text) return 'unknown'
  // 先判断断开类状态：disconnected 里也含 connected
  if (DOWN_STATUS_PATTERN.test(text)) return 'down'
  if (UP_STATUS_PATTERN.test(text)) return 'up'
  return 'unknown'
}

/** 前缀长度（0~32）换算为点分十进制子网掩码；不合法时返回空字符串 */
export function prefixLengthToNetmask(prefix: unknown): string {
  const n =
    typeof prefix === 'number' ? prefix : typeof prefix === 'string' && prefix.trim() ? Number(prefix) : Number.NaN
  if (!Number.isInteger(n) || n < 0 || n > 32) return ''
  const mask = n === 0 ? 0 : (0xffffffff << (32 - n)) >>> 0
  return [24, 16, 8, 0].map((shift) => (mask >>> shift) & 255).join('.')
}

function parseAdapterNetmask(raw: RawAdapter, ipv4: string): string {
  // 没有 IPv4 地址时前缀长度没有意义（客户端可能给的是占位值），不显示掩码
  if (!ipv4) return ''
  return textOf(raw.netmask) || prefixLengthToNetmask(raw.prefixLength)
}

function parsePositiveNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

const VIRTUAL_NAME_PATTERN = /vethernet|vmware|virtual|wsl|tun|tap|clash|meta/i
const VIRTUAL_DESCRIPTION_PATTERN = /\b(?:hyper-v|vmware|virtualbox|virtual|wintun|tap-windows|wireguard|tunnel|wsl)\b/i

function physicalTypeLabel(text: string): string {
  if (/wi-?fi|wlan|wireless|802\.11|无线/i.test(text)) return '无线网卡'
  if (/bluetooth|蓝牙/i.test(text)) return '蓝牙网卡'
  if (/ethernet|以太网|gbe\b/i.test(text)) return '有线网卡'
  return '物理网卡'
}

function mapRawAdapter(raw: RawAdapter, i: number): NetworkAdapterItem {
  const name = textOf(raw.name) || textOf(raw.alias) || `未命名接口 ${i + 1}`
  const description = textOf(raw.description)
  const ipv4 = textOf(raw.ipv4) || textOf(raw.address)
  const isLoopback =
    raw.internal === true ||
    ipv4 === '127.0.0.1' ||
    raw.category === 'loopback' ||
    /loopback/i.test(`${name} ${textOf(raw.status)}`)
  const isVirtual =
    raw.category === 'virtual' || VIRTUAL_NAME_PATTERN.test(name) || VIRTUAL_DESCRIPTION_PATTERN.test(description)
  const category: AdapterCategory = isLoopback ? 'loopback' : isVirtual ? 'virtual' : 'physical'
  const typeLabel =
    textOf(raw.typeLabel) ||
    (category === 'loopback'
      ? '本机回环'
      : category === 'virtual'
      ? '虚拟网卡'
      : physicalTypeLabel(`${name} ${description}`))

  return {
    id: textOf(raw.id) || name,
    name,
    description,
    category,
    typeLabel,
    status: parseAdapterStatus(raw),
    ipv4,
    ipv6: textOf(raw.ipv6),
    netmask: parseAdapterNetmask(raw, ipv4),
    gateway: textOf(raw.gateway),
    mac: (textOf(raw.mac) || textOf(raw.macAddress)).toUpperCase(),
    dnsServers: parseAdapterDnsServers(raw),
    speedMbps: parseAdapterSpeedMbps(raw),
    mtu: parsePositiveNumber(raw.mtu),
    dhcpEnabled: typeof raw.dhcpEnabled === 'boolean' ? raw.dhcpEnabled : null
  }
}

/** 读取失败时的快照：不带任何网卡，主网卡字段全部为空 */
export function createFailedSnapshot(error: string): NetworkAdapterSnapshot {
  const detail = String(error || '').trim().replace(new RegExp(`^${ADAPTER_LIST_ERROR_PREFIX}[：:]\\s*`), '')
  return {
    ok: false,
    error: `${ADAPTER_LIST_ERROR_PREFIX}：${detail || '客户端未返回原因'}`,
    adapters: [],
    activeCount: 0,
    physicalCount: 0,
    virtualCount: 0,
    primaryName: '',
    primaryIpv4: '',
    primaryGateway: '',
    primaryDns: ''
  }
}

/** 主网卡：已连接、有 IPv4、非回环；优先有默认网关的物理网卡，其次有网关的任意网卡，再次物理网卡 */
export function pickPrimaryAdapter(adapters: NetworkAdapterItem[]): NetworkAdapterItem | null {
  const candidates = adapters.filter((a) => a.status === 'up' && a.ipv4 && a.category !== 'loopback')
  return (
    candidates.find((a) => a.gateway && a.category === 'physical') ||
    candidates.find((a) => a.gateway) ||
    candidates.find((a) => a.category === 'physical') ||
    candidates[0] ||
    null
  )
}

export function buildAdapterSnapshot(adapters: NetworkAdapterItem[]): NetworkAdapterSnapshot {
  const primary = pickPrimaryAdapter(adapters)
  return {
    ok: true,
    error: '',
    adapters,
    activeCount: adapters.filter((a) => a.status === 'up').length,
    physicalCount: adapters.filter((a) => a.category === 'physical').length,
    virtualCount: adapters.filter((a) => a.category === 'virtual').length,
    primaryName: primary?.name || '',
    primaryIpv4: primary?.ipv4 || '',
    primaryGateway: primary?.gateway || '',
    primaryDns: primary?.dnsServers[0] || ''
  }
}

export async function fetchNetworkAdapters(hostOverride?: unknown): Promise<NetworkAdapterSnapshot> {
  const res = await invokePluginService<unknown>(HOST_PLUGIN_NAME, 'getAdapters', {}, hostOverride)
  if (!res.ok) {
    return createFailedSnapshot(describeHostError(res.error, '客户端未返回原因'))
  }
  const data = res.data
  const rawList = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.adapters) ? data.adapters : null
  if (!rawList) {
    return createFailedSnapshot('客户端返回的网卡数据格式无法识别')
  }
  return buildAdapterSnapshot(rawList.filter(isRecord).map(mapRawAdapter))
}

const IPV4_REGEX = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

/**
 * 设置网卡 DNS：primaryDns 为 IPv4 地址时改为静态 DNS（替换该网卡现有的 DNS 列表），为 'dhcp' / 'auto' 时恢复自动获取。
 * 客户端目前一次只能设置一个 DNS 服务器，传入备选 DNS 会直接拒绝，不会只设首选却报告两个都已生效。
 * 修改 DNS 需要以管理员身份运行 ZTools，否则客户端返回失败。
 */
export async function applyDnsPreset(
  adapterIdOrName: string,
  primaryDns: string,
  secondaryDns?: string,
  hostOverride?: unknown
): Promise<{ ok: boolean; adapterId: string; dnsServers: string[]; message: string }> {
  const name = typeof adapterIdOrName === 'string' ? adapterIdOrName.trim() : ''
  const pDns = typeof primaryDns === 'string' ? primaryDns.trim() : ''
  const sDns = typeof secondaryDns === 'string' ? secondaryDns.trim() : ''

  if (!name) {
    return { ok: false, adapterId: '', dnsServers: [], message: '目标网卡名称或 ID 不能为空' }
  }
  const isDhcp = pDns.toLowerCase() === 'dhcp' || pDns.toLowerCase() === 'auto'
  if (!isDhcp && !IPV4_REGEX.test(pDns)) {
    return { ok: false, adapterId: name, dnsServers: [], message: `首选 DNS 地址格式不合法: ${pDns}` }
  }
  if (!isDhcp && sDns) {
    return {
      ok: false,
      adapterId: name,
      dnsServers: [],
      message: '当前客户端一次只能设置一个 DNS 服务器，不支持同时设置备选 DNS'
    }
  }

  // 客户端的 setDns：primaryDns 为空表示恢复 DHCP，否则设为静态 DNS
  const res = await invokePluginService<unknown>(
    HOST_PLUGIN_NAME,
    'setDns',
    { adapterName: name, name, primaryDns: isDhcp ? '' : pDns },
    hostOverride
  )
  if (res.ok) {
    return {
      ok: true,
      adapterId: name,
      dnsServers: isDhcp ? [] : [pDns],
      message: isDhcp ? `已将网卡 [${name}] 的 DNS 恢复为自动获取` : `已将网卡 [${name}] 的 DNS 设为 ${pDns}`
    }
  }
  return {
    ok: false,
    adapterId: name,
    dnsServers: [],
    message: `修改网卡 [${name}] 的 DNS 失败：${describeHostError(res.error, '客户端未返回原因')}`
  }
}

export async function flushSystemDnsCache(hostOverride?: unknown): Promise<{ ok: boolean; message: string }> {
  const res = await invokePluginService<unknown>(HOST_PLUGIN_NAME, 'flushDns', {}, hostOverride)
  if (res.ok) {
    return { ok: true, message: '已刷新本机 DNS 解析缓存' }
  }
  return {
    ok: false,
    message: `刷新 DNS 解析缓存失败：${describeHostError(res.error, '客户端未返回原因')}`
  }
}

export const flushDnsCache = flushSystemDnsCache

/** 复制用的文本；ipv4 / mac 没有值时返回空字符串（调用方不应提供复制动作） */
export function copyAdapterInfo(
  adapter: NetworkAdapterItem,
  format: 'ipv4' | 'mac' | 'json' | 'summary' = 'ipv4'
): string {
  if (!adapter) return ''
  if (format === 'ipv4') return adapter.ipv4 || ''
  if (format === 'mac') return adapter.mac || ''
  if (format === 'json') return JSON.stringify(adapter, null, 2)
  const unknown = '未识别'
  const parts = [
    adapter.name,
    `IPv4: ${adapter.ipv4 || '未分配'}`,
    `子网掩码: ${adapter.netmask || (adapter.ipv4 ? unknown : '-')}`,
    `网关: ${adapter.gateway || '无'}`,
    `MAC: ${adapter.mac || unknown}`,
    `DNS: ${adapter.dnsServers.join(', ') || '未配置'}`
  ]
  return parts.join(' | ')
}

export function filterNetworkAdapters(
  adapters: NetworkAdapterItem[],
  query: string,
  filterMode: AdapterFilterMode | string = 'all'
): NetworkAdapterItem[] {
  if (!Array.isArray(adapters)) return []
  let list = adapters
  if (filterMode === 'physical') {
    list = list.filter((a) => a.category === 'physical')
  } else if (filterMode === 'virtual') {
    list = list.filter((a) => a.category === 'virtual' || a.category === 'loopback')
  } else if (filterMode === 'connected') {
    list = list.filter((a) => a.status === 'up')
  }

  const q = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (!q) return list
  return list.filter(
    (a) =>
      a.name.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q) ||
      a.ipv4.toLowerCase().includes(q) ||
      a.ipv6.toLowerCase().includes(q) ||
      a.mac.toLowerCase().includes(q) ||
      a.typeLabel.toLowerCase().includes(q) ||
      a.dnsServers.some((d) => d.toLowerCase().includes(q))
  )
}
