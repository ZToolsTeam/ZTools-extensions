/**
 * 网络断网诊断与一键急救箱 (NetworkRescue 2.0 Logic)
 * 针对 Windows / macOS 常见断网故障提供 8 大真实诊断与一键修复能力
 */

import { callHostTransport, invokePluginService, isRealElectronHost, invokeDllPluginCapability } from './native-ipc.js'
import { t } from './i18n.js'

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

export function getNetworkRescueItems(): NetworkRescueItem[] {
  return [
    {
      id: 'flush-dns',
      title: t('itemFlushDnsTitle'),
      subtitle: t('itemFlushDnsSubtitle'),
      command: 'ipconfig /flushdns',
      category: 'dns_proxy',
      categoryLabel: t('catDnsProxy'),
      status: 'unknown',
      statusText: t('statusNotChecked'),
      requiresAdmin: false
    },
    {
      id: 'clear-proxy',
      title: t('itemClearProxyTitle'),
      subtitle: t('itemClearProxySubtitle'),
      command: 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f',
      category: 'dns_proxy',
      categoryLabel: t('catDnsProxy'),
      status: 'unknown',
      statusText: t('statusNotChecked'),
      requiresAdmin: false
    },
    {
      id: 'reset-winsock',
      title: t('itemResetWinsockTitle'),
      subtitle: t('itemResetWinsockSubtitle'),
      command: 'netsh winsock reset && netsh int ip reset',
      category: 'stack_reset',
      categoryLabel: t('catStackReset'),
      status: 'unknown',
      statusText: t('statusNotChecked'),
      requiresAdmin: true
    },
    {
      id: 'check-hosts',
      title: t('itemCheckHostsTitle'),
      subtitle: t('itemCheckHostsSubtitle'),
      command: 'type C:\\Windows\\System32\\drivers\\etc\\hosts',
      category: 'dns_proxy',
      categoryLabel: t('catDnsProxy'),
      status: 'unknown',
      statusText: t('statusNotChecked'),
      requiresAdmin: true
    },
    {
      id: 'renew-dhcp',
      title: t('itemRenewDhcpTitle'),
      subtitle: t('itemRenewDhcpSubtitle'),
      command: 'ipconfig /release && ipconfig /renew',
      category: 'connectivity',
      categoryLabel: t('catConnectivity'),
      status: 'unknown',
      statusText: t('statusNotChecked'),
      requiresAdmin: false
    },
    {
      id: 'ping-gateway-dns',
      title: t('itemPingGatewayTitle'),
      subtitle: t('itemPingGatewaySubtitle'),
      command: 'ping -n 2 223.5.5.5',
      category: 'connectivity',
      categoryLabel: t('catConnectivity'),
      status: 'unknown',
      statusText: t('statusNotChecked'),
      requiresAdmin: false
    },
    {
      id: 'reset-firewall',
      title: t('itemResetFirewallTitle'),
      subtitle: t('itemResetFirewallSubtitle'),
      command: 'netsh advfirewall reset',
      category: 'stack_reset',
      categoryLabel: t('catStackReset'),
      status: 'unknown',
      statusText: t('statusNotChecked'),
      requiresAdmin: true
    },
    {
      id: 'restart-nla',
      title: t('itemRestartNlaTitle'),
      subtitle: t('itemRestartNlaSubtitle'),
      command: 'net start nlasvc',
      category: 'stack_reset',
      categoryLabel: t('catStackReset'),
      status: 'unknown',
      statusText: t('statusNotChecked'),
      requiresAdmin: true
    }
  ]
}

export const NETWORK_RESCUE_ITEMS: NetworkRescueItem[] = getNetworkRescueItems()

export function getCapabilityItems(): CapabilityActionItem[] {
  return getNetworkRescueItems().map((item) => ({
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
    return { valid: false, error: t('errInvalidMethod') }
  }
  if (params === null || params === undefined || typeof params !== 'object' || Array.isArray(params)) {
    return { valid: false, error: t('errInvalidParams') }
  }
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (typeof v === 'string' && FORBIDDEN_TARGET_PATTERN.test(v.trim())) {
      return { valid: false, error: t('errSecurityIntercepted', { key: k, reason: t('forbiddenReason') }) }
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
    throw new Error(check.error || t('errParamValidationFailed'))
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
  const items: NetworkRescueItem[] = getNetworkRescueItems()
  const failure = (error: string): NetworkDiagnosticSnapshot => ({
    ok: false, error, items, unknownCount: items.length, warningCount: 0, latencyMs: null, proxyInterceptDetected: false
  })
  if (!hostOverride && !isRealElectronHost()) return failure(t('errNeedClientDiag'))
  const pluginRes = await invokePluginService<RemoteDiagnosticPayload>(DLL_PLUGIN_NAME, 'diagnose', {}, hostOverride)
  const fallback = pluginRes.ok ? undefined : await callHostTransport<RemoteDiagnosticPayload>('network_run_diagnostics', {}, hostOverride)
  const data = pluginRes.ok ? pluginRes.data : fallback?.ok ? fallback.data : undefined
  if (!data) return failure(pluginRes.error || fallback?.error || t('errNoDiagResult'))
  const remote = Array.isArray(data.items) ? data.items : Array.isArray(data.checks) ? data.checks : undefined
  if (!remote) return failure(t('errInvalidDiagFormat'))
  let matched = 0
  for (const item of remote) {
    if (!item || typeof item !== 'object') continue
    const rawId = String(item.id || item.checkId || '')
    const target = items.find(current => current.id === (HOST_CHECK_ID_MAP[rawId] || rawId))
    if (!target) continue
    matched += 1
    target.status = item.status === 'healthy' || item.status === 'warning' || item.status === 'error'
      ? item.status : 'unknown'
    target.statusText = String(item.statusText || item.detail || (target.status === 'unknown' ? t('errNoValidStatus') : t('errNoDetailFromHost')))
  }
  if (!matched) return failure(t('errNoRecognizedChecks'))
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
  const target = getNetworkRescueItems().find((i) => i.id === normalizedId || i.id === mappedId)
  if (!target) {
    return {
      ok: false,
      itemId: normalizedId,
      command: '',
      message: t('errItemNotFound', { id: normalizedId })
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
        message: String(pluginRes.data?.message || t('msgRepairExecuted', { title: target.title }))
      }
    }
    if (pluginRes.data?.ok === false) {
      return {
        ok: false,
        itemId: target.id,
        command: target.command,
        message: String(pluginRes.data.error || pluginRes.data.message || t('errRepairFailed'))
      }
    }

    return {
      ok: false,
      itemId: target.id,
      command: target.command,
      message: pluginRes.error || t('errHostNoConfirm')
    }

  }

  return {
    ok: false,
    itemId: target.id,
    command: target.command,
    message: t('errNeedClientRepair')
  }
}

export async function batchExecuteNetworkRepairs(
  itemIds?: string[],
  hostOverride?: unknown
): Promise<{ ok: boolean; repairedCount: number; failedCount?: number; summary: string }> {
  const allItems = getNetworkRescueItems()
  const targets =
    Array.isArray(itemIds) && itemIds.length > 0
      ? allItems.filter((i) => itemIds.includes(i.id))
      : allItems.filter((i) => i.status === 'warning' || i.status === 'error')

  if (targets.length === 0) {
    return {
      ok: false,
      repairedCount: 0,
      failedCount: 0,
      summary: t('errNoMatchedItems')
    }
  }

  let repairedCount = 0
  let failedCount = 0
  for (const item of targets) {
    const res = await executeNetworkRepair(item.id, hostOverride)
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
      ? t('summaryAllFailed', { count: failedCount })
      : t('summaryPartial', { repaired: repairedCount, failed: failedCount })
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
