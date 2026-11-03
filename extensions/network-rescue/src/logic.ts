/**
 * 网络断网诊断与一键急救箱 (NetworkRescue 2.0 Logic)
 * 针对 Windows / macOS 常见断网故障提供 8 大真实诊断与一键修复能力
 */

import { callHostTransport, invokePluginService, isRealElectronHost, invokeDllPluginCapability } from './native-ipc.js'

export interface CapabilityActionItem {
  id: string
  title: string
  subtitle: string
  tag: string
  method: string
  params: Record<string, unknown>
}

export interface NativeInvocationResult {
  ok: boolean
  pluginName: string
  method: string
  data?: unknown
  error?: string
  fromFallback?: boolean
}

export type RescueCategory = 'dns_proxy' | 'stack_reset' | 'connectivity'
export type RescueFilterMode = 'all' | 'warning' | 'dns_proxy' | 'stack_reset'

export interface NetworkRescueItem {
  id: string
  title: string
  subtitle: string
  command: string
  category: RescueCategory
  categoryLabel: string
  status: 'healthy' | 'warning' | 'error' | 'repaired' | 'unknown'
  statusText: string
  requiresAdmin: boolean
}

export interface NetworkDiagnosticSnapshot {
  items: NetworkRescueItem[]
  ok: boolean
  error?: string
  unknownCount: number
  warningCount: number
  latencyMs: number | null
  proxyInterceptDetected: boolean
}

export interface NetworkRepairResult {
  ok: boolean
  itemId: string
  command: string
  message: string
}

export const DLL_PLUGIN_NAME = 'NetworkRescuePlugin'
export const FORBIDDEN_TARGET_PATTERN = new RegExp('^(?:FORMAT_ROUTING_TABLE_UNSAFE|DELETE_SYSTEM32_DRIVERS)$', 'i')
export const FORBIDDEN_REASON = '严禁删除系统核心网络驱动文件或破坏引导网卡配置'

export const NETWORK_RESCUE_ITEMS: NetworkRescueItem[] = [
  {
    id: 'flush-dns',
    title: '刷新 DNS 解析缓存 (Flush DNS Resolver Cache)',
    subtitle: 'ipconfig /flushdns · 清除过期或污染的本地 DNS 域名缓存记录',
    command: 'ipconfig /flushdns',
    category: 'dns_proxy',
    categoryLabel: 'DNS与代理',
    status: 'unknown',
    statusText: '尚未检测',
    requiresAdmin: false
  },
  {
    id: 'clear-proxy',
    title: '检测并清除残留系统代理 (Clear Residual System Proxy)',
    subtitle: 'HKCU\\...\\Internet Settings\\ProxyEnable · 修复关闭代理软件后网页无法访问故障',
    command: 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f',
    category: 'dns_proxy',
    categoryLabel: 'DNS与代理',
    status: 'unknown',
    statusText: '尚未检测',
    requiresAdmin: false
  },
  {
    id: 'reset-winsock',
    title: '重置 Winsock 目录与 TCP/IP 协议栈 (Reset Winsock & TCP/IP)',
    subtitle: 'netsh winsock reset && netsh int ip reset · 修复 LSP 劫持与套接字连接异常',
    command: 'netsh winsock reset && netsh int ip reset',
    category: 'stack_reset',
    categoryLabel: '协议栈重置',
    status: 'unknown',
    statusText: '尚未检测',
    requiresAdmin: true
  },
  {
    id: 'check-hosts',
    title: '检查本机 Hosts 文件异常劫持 (Inspect System Hosts File)',
    subtitle: 'C:\\Windows\\System32\\drivers\\etc\\hosts · 扫描异常域名重定向与屏蔽规则',
    command: 'type C:\\Windows\\System32\\drivers\\etc\\hosts',
    category: 'dns_proxy',
    categoryLabel: 'DNS与代理',
    status: 'unknown',
    statusText: '尚未检测',
    requiresAdmin: true
  },
  {
    id: 'renew-dhcp',
    title: '释放并重新获取 DHCP IP 租约 (Release & Renew DHCP Lease)',
    subtitle: 'ipconfig /release && ipconfig /renew · 解决局域网 IP 冲突或 169.254 受限地址',
    command: 'ipconfig /release && ipconfig /renew',
    category: 'connectivity',
    categoryLabel: '连通性修复',
    status: 'unknown',
    statusText: '尚未检测',
    requiresAdmin: false
  },
  {
    id: 'ping-gateway-dns',
    title: '检测默认网关与外网公共 DNS 连通性 (Gateway & Public DNS Probe)',
    subtitle: '连通性探测 114.114.114.114 / 223.5.5.5 / 1.1.1.1 · 诊断内网与外网出口路由',
    command: 'ping -n 2 223.5.5.5',
    category: 'connectivity',
    categoryLabel: '连通性修复',
    status: 'unknown',
    statusText: '尚未检测',
    requiresAdmin: false
  },
  {
    id: 'reset-firewall',
    title: '重置 Windows 防火墙默认策略 (Reset Firewall Policy)',
    subtitle: 'netsh advfirewall reset · 清除误拦截出站连接的自定义防火墙规则',
    command: 'netsh advfirewall reset',
    category: 'stack_reset',
    categoryLabel: '协议栈重置',
    status: 'unknown',
    statusText: '尚未检测',
    requiresAdmin: true
  },
  {
    id: 'restart-nla',
    title: '重启系统网络位置感知服务 (Restart Network Location Awareness)',
    subtitle: 'net stop nlasvc /y && net start nlasvc · 修复任务栏小地球图标误报无Internet',
    command: 'net start nlasvc',
    category: 'stack_reset',
    categoryLabel: '协议栈重置',
    status: 'unknown',
    statusText: '尚未检测',
    requiresAdmin: true
  }
]

export function getCapabilityItems(): CapabilityActionItem[] {
  return NETWORK_RESCUE_ITEMS.map((item) => ({
    id: item.id,
    title: item.title,
    subtitle: item.subtitle,
    tag: item.categoryLabel,
    method: 'ExecuteNetworkRepair',
    params: { itemId: item.id, command: item.command }
  }))
}

export function filterCapabilityItems(items: CapabilityActionItem[], query: string): CapabilityActionItem[] {
  if (!Array.isArray(items)) return []
  const q = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (!q) return items
  return items.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.subtitle.toLowerCase().includes(q) ||
      item.tag.toLowerCase().includes(q)
  )
}

export function validateInvocationPayload(method: string, params: unknown): { valid: boolean; error?: string } {
  if (typeof method !== 'string' || !method.trim()) {
    return { valid: false, error: 'INVALID_METHOD: 调用方法名不能为空' }
  }
  if (params === null || params === undefined || typeof params !== 'object' || Array.isArray(params)) {
    return { valid: false, error: 'INVALID_PARAMS: 参数必须为非空对象' }
  }
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (typeof v === 'string' && FORBIDDEN_TARGET_PATTERN.test(v.trim())) {
      return { valid: false, error: `SECURITY_INTERCEPTED (${k}): ${FORBIDDEN_REASON}` }
    }
  }
  return { valid: true }
}

export async function invokeNativeCapability(
  method: string,
  params: Record<string, unknown>,
  hostBridge?: unknown
): Promise<NativeInvocationResult> {
  const check = validateInvocationPayload(method, params)
  if (!check.valid) {
    throw new Error(check.error || '参数校验失败')
  }
  return invokeDllPluginCapability(DLL_PLUGIN_NAME, method.trim(), params, hostBridge)
}

const HOST_CHECK_ID_MAP: Record<string, string> = {
  'adapter-ip': 'renew-dhcp',
  'dns-resolve': 'flush-dns',
  'public-tcp': 'ping-gateway-dns',
  'system-proxy': 'clear-proxy'
}

interface RemoteDiagnosticPayload {
  latencyMs?: number
  items?: Array<Record<string, unknown>>
  checks?: Array<Record<string, unknown>>
}

export async function runNetworkDiagnostics(hostOverride?: unknown): Promise<NetworkDiagnosticSnapshot> {
  const items: NetworkRescueItem[] = NETWORK_RESCUE_ITEMS.map(item => ({ ...item }))
  const failure = (error: string): NetworkDiagnosticSnapshot => ({
    ok: false, error, items, unknownCount: items.length, warningCount: 0, latencyMs: null, proxyInterceptDetected: false
  })
  if (!hostOverride && !isRealElectronHost()) return failure('需要在 ZTools 客户端中诊断网络')
  const pluginRes = await invokePluginService<RemoteDiagnosticPayload>(DLL_PLUGIN_NAME, 'diagnose', {}, hostOverride)
  const fallback = pluginRes.ok ? undefined : await callHostTransport<RemoteDiagnosticPayload>('network_run_diagnostics', {}, hostOverride)
  const data = pluginRes.ok ? pluginRes.data : fallback?.ok ? fallback.data : undefined
  if (!data) return failure(pluginRes.error || fallback?.error || '客户端未返回诊断结果')
  const remote = Array.isArray(data.items) ? data.items : Array.isArray(data.checks) ? data.checks : undefined
  if (!remote) return failure('客户端返回的诊断数据格式无效')
  let matched = 0
  for (const item of remote) {
    if (!item || typeof item !== 'object') continue
    const rawId = String(item.id || item.checkId || '')
    const target = items.find(current => current.id === (HOST_CHECK_ID_MAP[rawId] || rawId))
    if (!target) continue
    matched += 1
    target.status = item.status === 'healthy' || item.status === 'warning' || item.status === 'error'
      ? item.status : 'unknown'
    target.statusText = String(item.statusText || item.detail || (target.status === 'unknown' ? '未检测到有效状态' : '客户端未提供详情'))
  }
  if (!matched) return failure('客户端未返回可识别的检查项')
  return {
    ok: true, items,
    unknownCount: items.filter(item => item.status === 'unknown').length,
    warningCount: items.filter(item => item.status === 'warning' || item.status === 'error').length,
    latencyMs: typeof data.latencyMs === 'number' && Number.isFinite(data.latencyMs) && data.latencyMs >= 0 ? data.latencyMs : null,
    proxyInterceptDetected: items.some(item => item.id === 'clear-proxy' && (item.status === 'warning' || item.status === 'error'))
  }
}

export const fetchNetworkDiagnostics = runNetworkDiagnostics

export async function executeNetworkRepair(
  itemId: string,
  hostOverride?: unknown
): Promise<NetworkRepairResult> {
  const normalizedId = typeof itemId === 'string' ? itemId.trim() : ''
  const mappedId = HOST_CHECK_ID_MAP[normalizedId] || normalizedId
  const target = NETWORK_RESCUE_ITEMS.find((i) => i.id === normalizedId || i.id === mappedId)
  if (!target) {
    return {
      ok: false,
      itemId: normalizedId,
      command: '',
      message: `未找到网络急救项: ${normalizedId}`
    }
  }

  if (hostOverride || isRealElectronHost(hostOverride)) {
    const pluginRes = await invokePluginService<{ ok?: boolean; message?: string; error?: string }>(
      DLL_PLUGIN_NAME,
      'repair',
      { checkId: target.id, itemId: target.id, command: target.command },
      hostOverride
    )
    if (pluginRes.ok && pluginRes.data?.ok !== false) {
      return {
        ok: true,
        itemId: target.id,
        command: target.command,
        message: String(pluginRes.data?.message || `已执行修复: ${target.title}`)
      }
    }
    if (pluginRes.data?.ok === false) {
      return {
        ok: false,
        itemId: target.id,
        command: target.command,
        message: String(pluginRes.data.error || pluginRes.data.message || '修复失败')
      }
    }

    return {
      ok: false,
      itemId: target.id,
      command: target.command,
      message: pluginRes.error || '客户端没有确认网络修复已执行'
    }

  }

  return {
    ok: false,
    itemId: target.id,
    command: target.command,
    message: '需要在 ZTools 客户端中执行网络修复'
  }
}

export async function batchExecuteNetworkRepairs(
  itemIds?: string[],
  hostOverride?: unknown
): Promise<{ ok: boolean; repairedCount: number; failedCount?: number; summary: string }> {
  const targets =
    Array.isArray(itemIds) && itemIds.length > 0
      ? NETWORK_RESCUE_ITEMS.filter((i) => itemIds.includes(i.id))
      : NETWORK_RESCUE_ITEMS.filter((i) => i.status === 'warning' || i.status === 'error')

  if (targets.length === 0) {
    return {
      ok: false,
      repairedCount: 0,
      failedCount: 0,
      summary: '未匹配到可执行的网络急救项'
    }
  }

  let repairedCount = 0
  let failedCount = 0
  for (const t of targets) {
    const res = await executeNetworkRepair(t.id, hostOverride)
    if (res.ok) {
      repairedCount += 1
    } else {
      failedCount += 1
    }
  }

  const allFailed = repairedCount === 0 && failedCount > 0
  return {
    ok: !allFailed,
    repairedCount,
    failedCount,
    summary: allFailed
      ? `网络修复失败（共 ${failedCount} 项未通过，请检查管理员权限）`
      : `已执行 ${repairedCount} 项，失败 ${failedCount} 项；请以重新诊断结果为准`
  }
}

export function filterNetworkRescueItems(
  items: NetworkRescueItem[],
  query: string,
  filterMode: RescueFilterMode | string = 'all'
): NetworkRescueItem[] {
  if (!Array.isArray(items)) return []
  let list = items
  if (filterMode === 'warning') {
    list = list.filter((i) => i.status === 'warning' || i.status === 'error')
  } else if (filterMode === 'dns_proxy') {
    list = list.filter((i) => i.category === 'dns_proxy' || i.category === 'connectivity')
  } else if (filterMode === 'stack_reset') {
    list = list.filter((i) => i.category === 'stack_reset')
  }

  const q = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (!q) return list
  return list.filter(
    (i) =>
      i.title.toLowerCase().includes(q) ||
      i.subtitle.toLowerCase().includes(q) ||
      i.command.toLowerCase().includes(q) ||
      i.statusText.toLowerCase().includes(q)
  )
}
