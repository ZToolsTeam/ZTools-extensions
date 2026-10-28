export type DnsCategory = 'domestic' | 'security' | 'global'

export interface DnsProviderPreset {
  id: string
  name: string
  category: DnsCategory
  categoryLabel: string
  primary: string
  secondary: string
  description: string
}

export interface DnsBenchmarkItem extends DnsProviderPreset {
  avgMs: number
  primaryMs: number | null
  secondaryMs: number | null
  timeout: boolean
  /** 宿主没有返回此节点的结果（不是超时） */
  noResult?: boolean
  isCurrentActive: boolean
}

export interface ActiveNetworkAdapter {
  name: string
  description: string
  ipv4: string
  isDhcp: boolean
  currentDns: string[]
}

export interface DnsActionResponse {
  ok: boolean
  adapterName?: string
  currentDns?: string[]
  isDhcp?: boolean
  flushed?: boolean
  /** 修改已生效但刷新缓存失败的原因 */
  flushError?: string
  errorCode?: string
  error?: string
}
