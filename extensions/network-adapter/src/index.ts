import {
  List,
  ActionPanel,
  Action,
  Icon,
  Clipboard,
  useLocale,
  useState,
  useEffect,
  useRef,
  showToast,
  Toast,
  type ActionProps,
  type KeyboardShortcut
} from '@ztools/declarative-ui'
import { t } from './i18n.js'
import {
  type NetworkAdapterItem,
  type NetworkAdapterSnapshot,
  type AdapterFilterMode,
  ADAPTER_LIST_ERROR_PREFIX,
  createFailedSnapshot,
  fetchNetworkAdapters,
  flushDnsCache,
  applyDnsPreset,
  copyAdapterInfo,
  filterNetworkAdapters
} from './logic.js'

export * from './logic.js'

/** 一键设置的公共 DNS（阿里公共 DNS） */
export const PUBLIC_DNS_PRESET = '223.5.5.5'

function statusText(status: NetworkAdapterItem['status']): string {
  if (status === 'up') return t('statusConnected')
  if (status === 'down') return t('statusDisconnected')
  return t('statusUnknown')
}

function speedText(mbps: number): string {
  return mbps >= 1000 ? `${(mbps / 1000).toFixed(1)} Gbps` : `${mbps} Mbps`
}

function errorDetail(error: string): string {
  const prefix = t('adapterListErrorPrefix')
  return error.replace(new RegExp(`^${prefix}[：:]\\s*`), '').replace(new RegExp(`^${ADAPTER_LIST_ERROR_PREFIX}[：:]\\s*`), '')
}

function summaryText(snapshot: NetworkAdapterSnapshot | null, isLoading: boolean): string {
  if (!snapshot) return isLoading ? t('loadingAdapters') : ''
  if (!snapshot.ok) return t('summaryLoadError', { prefix: t('adapterListErrorPrefix') })
  const head = t('summaryActiveCount', { active: snapshot.activeCount, total: snapshot.adapters.length })
  if (!snapshot.primaryIpv4) return t('summaryNoPrimary', { head, unknown: t('unknown') })
  return t('summaryWithPrimary', {
    head,
    ipv4: snapshot.primaryIpv4,
    gateway: snapshot.primaryGateway || t('noneWord'),
    dns: snapshot.primaryDns || t('dnsUnconfigured')
  })
}

function copyAction(
  title: string,
  icon: ActionProps['icon'],
  content: string,
  toastTitle: string,
  toastMessage: string = content,
  shortcut?: KeyboardShortcut
) {
  return Action({
    title,
    icon,
    ...(shortcut ? { shortcut } : {}),
    onAction: async () => {
      await Clipboard.copy(content)
      showToast({ style: Toast.Style.Success, title: toastTitle, message: toastMessage })
    }
  })
}

function renderAdapterItem(
  item: NetworkAdapterItem,
  maxSpeed: number,
  onApplyDns: (item: NetworkAdapterItem, primaryDns: string) => Promise<void>
) {
  const unknown = t('unknown')
  const subtitleParts = [`MAC: ${item.mac || unknown}`]
  if (item.ipv4) subtitleParts.push(t('subtitleNetmask', { value: item.netmask || unknown }))
  subtitleParts.push(t('subtitleGateway', { value: item.gateway || t('noneWord') }))
  subtitleParts.push(t('subtitleDns', { value: item.dnsServers.length > 0 ? item.dnsServers.join(', ') : t('dnsUnconfigured') }))
  if (item.description) subtitleParts.push(item.description)

  const accessories: Record<string, unknown>[] = []
  if (item.speedMbps > 0) {
    accessories.push({ progress: { value: Math.min(100, Math.round((item.speedMbps / maxSpeed) * 100)) } })
  }
  accessories.push({ tag: { value: item.typeLabel } })
  accessories.push({
    text: item.speedMbps > 0 ? `${speedText(item.speedMbps)} · ${statusText(item.status)}` : statusText(item.status)
  })

  // 前两个动作（Enter / Ctrl+Enter）只放复制类，修改 DNS 这类会改动系统配置的动作排在后面；
  // 没有值的字段不提供复制动作（Clipboard.copy 失败会抛错，客户端显示操作失败，不会提示已复制）
  const actions = []
  if (item.ipv4) {
    actions.push(copyAction(t('actionCopyIpv4', { ip: item.ipv4 }), Icon.Clipboard, copyAdapterInfo(item, 'ipv4'), t('toastCopiedIpv4')))
  }
  if (item.mac) {
    actions.push(copyAction(t('actionCopyMac', { mac: item.mac }), Icon.Key, copyAdapterInfo(item, 'mac'), t('toastCopiedMac')))
  }
  const summary = copyAdapterInfo(item, 'summary')
  actions.push(
    copyAction(t('actionCopySummary'), Icon.Document, summary, t('toastCopiedSummary'), summary, { modifiers: ['ctrl'], key: 'c' }),
    copyAction(t('actionCopyJson'), Icon.Code, copyAdapterInfo(item, 'json'), t('toastCopiedJson'), item.name, {
      modifiers: ['ctrl', 'shift'],
      key: 'c'
    })
  )
  if (item.category !== 'loopback') {
    actions.push(
      Action({
        title: t('actionSetPublicDns', { dns: PUBLIC_DNS_PRESET }),
        icon: Icon.Globe,
        shortcut: { modifiers: ['ctrl'], key: 'p' },
        onAction: () => onApplyDns(item, PUBLIC_DNS_PRESET)
      }),
      Action({
        title: t('actionRestoreDhcpDns'),
        icon: Icon.ArrowClockwise,
        shortcut: { modifiers: ['ctrl', 'shift'], key: 'd' },
        onAction: () => onApplyDns(item, 'dhcp')
      })
    )
  }

  return List.Item({
    id: item.id,
    title: `${item.name} (${item.ipv4 || item.ipv6 || t('ipNone')})`,
    subtitle: subtitleParts.join(' · '),
    icon: item.category === 'physical' ? Icon.Wifi : Icon.Globe,
    accessories,
    actions: ActionPanel({
      title: `${item.name} (${item.ipv4 || t('ipv4Unassigned')})`,
      children: actions
    })
  })
}

export function NetworkAdapterCommand() {
  useLocale()
  const [searchText, setSearchText] = useState('')
  const [filterMode, setFilterMode] = useState<AdapterFilterMode>('all')
  const [snapshot, setSnapshot] = useState<NetworkAdapterSnapshot | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const requestSeq = useRef(0)

  async function refreshAdapters(showNotice = false) {
    const seq = ++requestSeq.current
    setIsLoading(true)
    let snap: NetworkAdapterSnapshot
    try {
      snap = await fetchNetworkAdapters()
    } catch (err) {
      snap = createFailedSnapshot(err instanceof Error ? err.message : String(err))
    }
    // 只采用最后一次请求的结果，避免较早的请求晚返回时覆盖新数据
    if (seq !== requestSeq.current) return
    setSnapshot(snap)
    setIsLoading(false)
    if (!snap.ok) {
      if (showNotice) {
        showToast({ style: Toast.Style.Failure, title: t('adapterListErrorPrefix'), message: errorDetail(snap.error) })
      }
      return
    }
    if (showNotice) {
      showToast({
        style: Toast.Style.Success,
        title: t('toastRefreshedTitle'),
        message: t('toastRefreshedMessage', { count: snap.adapters.length, ipv4: snap.primaryIpv4 || t('unknown') })
      })
    }
  }

  useEffect(() => {
    void refreshAdapters(false)
  }, [])

  async function handleFlushDns() {
    const res = await flushDnsCache()
    showToast({
      style: res.ok ? Toast.Style.Success : Toast.Style.Failure,
      title: res.ok ? t('toastDnsFlushedTitle') : t('toastDnsFlushFailedTitle'),
      message: res.message
    })
  }

  async function handleApplyDns(item: NetworkAdapterItem, primary: string) {
    const res = await applyDnsPreset(item.name, primary)
    showToast({
      style: res.ok ? Toast.Style.Success : Toast.Style.Failure,
      title: res.ok ? t('toastDnsSetTitle') : t('toastDnsSetFailedTitle'),
      message: res.message
    })
    // 成功后重新读取系统里的实际配置，不在本地拼写结果
    if (res.ok) await refreshAdapters(false)
  }

  const adapters = snapshot?.adapters ?? []
  const filtered = filterNetworkAdapters(adapters, searchText, filterMode)
  const maxSpeed = Math.max(1, ...adapters.map((a) => a.speedMbps))

  const children = []
  if (snapshot && !snapshot.ok) {
    children.push(
      List.Section({
        title: t('sectionLoadError'),
        children: [
          List.Item({
            id: 'nic-load-error',
            title: t('adapterListErrorPrefix'),
            subtitle: errorDetail(snapshot.error),
            icon: Icon.ExclamationMark
          })
        ]
      })
    )
  } else {
    children.push(
      List.Section({
        title: t('sectionAdapters', { count: filtered.length }),
        children: filtered.map((item) => renderAdapterItem(item, maxSpeed, handleApplyDns))
      })
    )
  }

  return List({
    navigationTitle: t('navTitle'),
    searchBarPlaceholder: t('searchPlaceholder'),
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    isLoading,
    searchBarAccessory: List.Dropdown({
      tooltip: t('filterTooltip'),
      value: filterMode,
      onChange: (val: string) => setFilterMode(val as AdapterFilterMode),
      children: [
        List.Dropdown.Item({ title: t('filterAll'), value: 'all' }),
        List.Dropdown.Item({ title: t('filterPhysical'), value: 'physical' }),
        List.Dropdown.Item({ title: t('filterVirtual'), value: 'virtual' }),
        List.Dropdown.Item({ title: t('filterConnected'), value: 'connected' })
      ]
    }),
    filterBar: {
      summaryText: summaryText(snapshot, isLoading),
      actions: [
        {
          id: 'refresh-nic',
          label: t('btnRefreshNic'),
          title: t('btnRefreshNic'),
          style: 'secondary',
          onAction: () => void refreshAdapters(true)
        },
        {
          id: 'flush-dns',
          label: t('btnFlushDns'),
          title: t('btnFlushDns'),
          style: 'secondary',
          onAction: () => void handleFlushDns()
        }
      ]
    },
    children
  })
}

export default NetworkAdapterCommand
