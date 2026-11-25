import { getLocale } from '@ztools/declarative-ui'
import { t } from './i18n.js'
import { callHostTransport } from './native-ipc.js'
import type {
  ActiveNetworkAdapter,
  DnsActionResponse,
  DnsBenchmarkItem,
  DnsCategory,
  DnsProviderPreset
} from './types.js'
import { resolveErrorMessage } from './error-i18n.js'

const PRESET_DEFS: ReadonlyArray<{
  id: string
  nameKey: 'alidnsName' | 'dnspodName' | 'dns114Name' | 'volcdnsName' | 'baidudnsName' | 'cnnicName' | 'safe114Name' | 'safe360Name' | 'onednsName' | 'cloudflareName' | 'googleName' | 'quad9Name' | 'opendnsName' | 'adguardName' | 'controldName'
  category: DnsCategory
  catKey: 'catDomestic' | 'catSecurity' | 'catGlobal'
  primary: string
  secondary: string
  descKey: 'alidnsDesc' | 'dnspodDesc' | 'dns114Desc' | 'volcdnsDesc' | 'baidudnsDesc' | 'cnnicDesc' | 'safe114Desc' | 'safe360Desc' | 'onednsDesc' | 'cloudflareDesc' | 'googleDesc' | 'quad9Desc' | 'opendnsDesc' | 'adguardDesc' | 'controldDesc'
}> = [
  { id: 'alidns', nameKey: 'alidnsName', category: 'domestic', catKey: 'catDomestic', primary: '223.5.5.5', secondary: '223.6.6.6', descKey: 'alidnsDesc' },
  { id: 'dnspod', nameKey: 'dnspodName', category: 'domestic', catKey: 'catDomestic', primary: '119.29.29.29', secondary: '182.254.116.116', descKey: 'dnspodDesc' },
  { id: '114dns', nameKey: 'dns114Name', category: 'domestic', catKey: 'catDomestic', primary: '114.114.114.114', secondary: '114.114.115.115', descKey: 'dns114Desc' },
  { id: 'volcdns', nameKey: 'volcdnsName', category: 'domestic', catKey: 'catDomestic', primary: '180.184.1.1', secondary: '180.184.2.2', descKey: 'volcdnsDesc' },
  { id: 'baidudns', nameKey: 'baidudnsName', category: 'domestic', catKey: 'catDomestic', primary: '180.76.76.76', secondary: '114.114.114.114', descKey: 'baidudnsDesc' },
  { id: 'cnnic-sdns', nameKey: 'cnnicName', category: 'domestic', catKey: 'catDomestic', primary: '1.2.4.8', secondary: '210.2.4.8', descKey: 'cnnicDesc' },
  { id: '114-safe', nameKey: 'safe114Name', category: 'security', catKey: 'catSecurity', primary: '114.114.114.119', secondary: '114.114.115.119', descKey: 'safe114Desc' },
  { id: '360-safe', nameKey: 'safe360Name', category: 'security', catKey: 'catSecurity', primary: '101.226.4.6', secondary: '218.30.118.6', descKey: 'safe360Desc' },
  { id: 'onedns-clean', nameKey: 'onednsName', category: 'security', catKey: 'catSecurity', primary: '117.50.10.10', secondary: '52.80.52.52', descKey: 'onednsDesc' },
  { id: 'cloudflare', nameKey: 'cloudflareName', category: 'global', catKey: 'catGlobal', primary: '1.1.1.1', secondary: '1.0.0.1', descKey: 'cloudflareDesc' },
  { id: 'google-dns', nameKey: 'googleName', category: 'global', catKey: 'catGlobal', primary: '8.8.8.8', secondary: '8.8.4.4', descKey: 'googleDesc' },
  { id: 'quad9', nameKey: 'quad9Name', category: 'global', catKey: 'catGlobal', primary: '9.9.9.9', secondary: '149.112.112.112', descKey: 'quad9Desc' },
  { id: 'opendns', nameKey: 'opendnsName', category: 'global', catKey: 'catGlobal', primary: '208.67.222.222', secondary: '208.67.220.220', descKey: 'opendnsDesc' },
  { id: 'adguard-dns', nameKey: 'adguardName', category: 'global', catKey: 'catGlobal', primary: '94.140.14.14', secondary: '94.140.15.15', descKey: 'adguardDesc' },
  { id: 'controld', nameKey: 'controldName', category: 'global', catKey: 'catGlobal', primary: '76.76.2.0', secondary: '76.76.10.0', descKey: 'controldDesc' }
]

export function getPublicDnsPresets(): readonly DnsProviderPreset[] {
  return PRESET_DEFS.map((p) => ({
    id: p.id,
    name: t(p.nameKey),
    category: p.category,
    categoryLabel: t(p.catKey),
    primary: p.primary,
    secondary: p.secondary,
    description: t(p.descKey)
  }))
}

export function isValidIpv4Address(ip: string): boolean {
  if (typeof ip !== 'string') return false
  const trimmed = ip.trim()
  const m = trimmed.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  for (let i = 1; i <= 4; i++) {
    const part = Number(m[i])
    if (!Number.isInteger(part) || part < 0 || part > 255) return false
  }
  return true
}

export function isSafeAdapterName(name: string): boolean {
  if (typeof name !== 'string') return false
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 120) return false
  return !/[;&|`$<>\\"\r\n\0]/.test(trimmed)
}

export async function getActiveNetworkAdapters(
  hostOverride?: unknown
): Promise<ActiveNetworkAdapter[]> {
  const res = await callHostTransport<Record<string, unknown>>(
    'dllplugin_call',
    {
      plugin: 'DnsBenchmarkPlugin',
      func: 'getActiveAdapters',
      params: {}
    },
    hostOverride
  )
  if (!res.ok || !res.data || res.data.ok === false || !Array.isArray(res.data.adapters)) {
    throw new Error(resolveErrorMessage(res.data?.error ? res.data : res, t('errAdapterQuery')))
  }
  return (res.data.adapters as Array<Record<string, unknown>>)
    .map((a) => {
      const currentDns = Array.isArray(a.currentDns) ? a.currentDns.map(String) : []
      return {
        name: String(a.name ?? ''),
        description: String(a.description ?? a.name ?? ''),
        ipv4: String(a.ipv4 ?? ''),
        isDhcp: Boolean(a.isDhcp ?? currentDns.length === 0),
        currentDns
      }
    })
    .filter((a) => a.name)
}

export function sortAndMarkDnsItems(
  presets: readonly DnsProviderPreset[],
  probeResults: ReadonlyArray<{
    id?: string
    primary?: string
    avgMs?: number
    primaryMs?: number | null
    secondaryMs?: number | null
    timeout?: boolean
  }>,
  activeDnsList: readonly string[] = []
): DnsBenchmarkItem[] {
  const activeSet = new Set(activeDnsList.map((ip) => ip.trim()))
  const resultById = new Map<string, (typeof probeResults)[number]>()
  for (const r of probeResults) {
    if (r.id) resultById.set(r.id, r)
    if (r.primary) resultById.set(r.primary, r)
  }

  const items: DnsBenchmarkItem[] = presets.map((preset) => {
    const matched = resultById.get(preset.id) ?? resultById.get(preset.primary)
    // 没有结果不等于超时：不显示延迟、不参与“最快”判断
    const noResult = matched === undefined
    const timeout = matched?.timeout === true
    const rawAvg = Number(matched?.avgMs)
    const avgMs = Number.isFinite(rawAvg) && rawAvg > 0 ? Math.round(rawAvg) : 0
    const isCurrentActive =
      activeSet.has(preset.primary) || (Boolean(preset.secondary) && activeSet.has(preset.secondary))

    return {
      ...preset,
      avgMs: timeout || noResult ? 0 : avgMs,
      primaryMs: matched?.primaryMs ?? null,
      secondaryMs: matched?.secondaryMs ?? null,
      timeout,
      ...(noResult ? { noResult } : {}),
      isCurrentActive
    }
  })

  items.sort((a, b) => {
    const rank = (item: DnsBenchmarkItem) => (item.noResult ? 2 : item.timeout ? 1 : 0)
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    if (a.avgMs !== b.avgMs) return a.avgMs - b.avgMs
    return a.name.localeCompare(b.name, getLocale())
  })

  return items
}

export async function runDnsBenchmark(
  activeDnsList: readonly string[] = [],
  hostOverride?: unknown,
  presets: readonly DnsProviderPreset[] = getPublicDnsPresets()
): Promise<{ items: DnsBenchmarkItem[]; fastestDns: DnsBenchmarkItem | null; allTimeout: boolean }> {
  const res = await callHostTransport<Record<string, unknown>>(
    'dllplugin_call',
    {
      plugin: 'DnsBenchmarkPlugin',
      func: 'benchmarkDns',
      params: {
        servers: presets.map((p) => ({
          id: p.id,
          primary: p.primary,
          secondary: p.secondary
        }))
      }
    },
    hostOverride
  )

  // 测速接口失败要如实报错，不能显示成“所有节点超时”
  if (!res.ok || !res.data || res.data.ok === false || !Array.isArray(res.data.results)) {
    throw new Error(resolveErrorMessage(res.data?.error ? res.data : res, t('errBenchmarkFailed')))
  }
  const rawResults = res.data.results as Array<{
    id?: string
    primary?: string
    avgMs?: number
    primaryMs?: number | null
    secondaryMs?: number | null
    timeout?: boolean
  }>

  const sorted = sortAndMarkDnsItems(presets, rawResults, activeDnsList)
  const fastestDns = sorted.find((item) => !item.timeout && !item.noResult) ?? null
  const allTimeout = sorted.length > 0 && sorted.every((item) => item.timeout)
  return {
    items: sorted,
    fastestDns,
    allTimeout
  }
}

export async function applyAdapterDns(
  adapterName: string,
  primary: string,
  secondary = '',
  hostOverride?: unknown
): Promise<DnsActionResponse> {
  if (!isSafeAdapterName(adapterName)) {
    return {
      ok: false,
      errorCode: 'INVALID_ADAPTER_NAME',
      error: t('errInvalidAdapter')
    }
  }
  if (!isValidIpv4Address(primary) || (secondary && !isValidIpv4Address(secondary))) {
    return {
      ok: false,
      errorCode: 'INVALID_DNS_IP',
      error: t('errInvalidIp', { ips: `${primary}${secondary ? `, ${secondary}` : ''}` })
    }
  }

  const res = await callHostTransport<Record<string, unknown>>(
    'dllplugin_call',
    {
      plugin: 'DnsBenchmarkPlugin',
      func: 'applyDns',
      params: {
        adapterName: adapterName.trim(),
        primary: primary.trim(),
        secondary: secondary.trim(),
        executeSystemModify: hostOverride === undefined
      }
    },
    hostOverride
  )

  if (!res.ok || (res.data && res.data.ok === false)) {
    const rawErrText = String(res.data?.error ?? res.error ?? '')
    const codeMatch = rawErrText.match(/^([A-Z0-9_]+):/)
    return {
      ok: false,
      errorCode: String(res.data?.errorCode ?? codeMatch?.[1] ?? 'APPLY_DNS_FAILED'),
      error: resolveErrorMessage(res.data?.error ? res.data : res, t('errApplyDns'))
    }
  }

  // 以宿主重新读出的系统实际 DNS 为准；读不到时不假定已生效
  const currentDns = Array.isArray(res.data?.currentDns) ? (res.data.currentDns as unknown[]).map(String) : undefined
  const flushError = typeof res.data?.flushError === 'string' ? res.data.flushError : undefined
  return {
    ok: true,
    adapterName: adapterName.trim(),
    ...(currentDns ? { currentDns } : {}),
    isDhcp: res.data?.isDhcp === true,
    flushed: res.data?.flushed === true,
    ...(flushError ? { flushError } : {})
  }
}

export async function resetAdapterToDhcp(
  adapterName: string,
  hostOverride?: unknown
): Promise<DnsActionResponse> {
  if (!isSafeAdapterName(adapterName)) {
    return {
      ok: false,
      errorCode: 'INVALID_ADAPTER_NAME',
      error: t('errInvalidAdapterShort')
    }
  }

  const res = await callHostTransport<Record<string, unknown>>(
    'dllplugin_call',
    {
      plugin: 'DnsBenchmarkPlugin',
      func: 'resetDhcp',
      params: {
        adapterName: adapterName.trim(),
        executeSystemModify: hostOverride === undefined
      }
    },
    hostOverride
  )

  if (!res.ok || (res.data && res.data.ok === false)) {
    const rawErrText = String(res.data?.error ?? res.error ?? '')
    const codeMatch = rawErrText.match(/^([A-Z0-9_]+):/)
    return {
      ok: false,
      errorCode: String(res.data?.errorCode ?? codeMatch?.[1] ?? 'RESET_DHCP_FAILED'),
      error: resolveErrorMessage(res.data?.error ? res.data : res, t('errResetDhcp'))
    }
  }

  const currentDns = Array.isArray(res.data?.currentDns) ? (res.data.currentDns as unknown[]).map(String) : undefined
  const flushError = typeof res.data?.flushError === 'string' ? res.data.flushError : undefined
  return {
    ok: true,
    adapterName: adapterName.trim(),
    ...(currentDns ? { currentDns } : {}),
    isDhcp: res.data?.isDhcp !== false,
    flushed: res.data?.flushed === true,
    ...(flushError ? { flushError } : {})
  }
}

export async function flushSystemDnsCache(hostOverride?: unknown): Promise<DnsActionResponse> {
  const res = await callHostTransport<Record<string, unknown>>(
    'dllplugin_call',
    {
      plugin: 'DnsBenchmarkPlugin',
      func: 'flushCache',
      params: {}
    },
    hostOverride
  )
  if (!res.ok || (res.data && res.data.ok === false)) {
    return {
      ok: false,
      errorCode: 'FLUSH_DNS_FAILED',
      error: resolveErrorMessage(res.data?.error ? res.data : res, t('errFlushCache'))
    }
  }
  return {
    ok: true,
    flushed: true
  }
}
