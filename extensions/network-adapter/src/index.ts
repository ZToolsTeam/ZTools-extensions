import {
  List,
  ActionPanel,
  Action,
  Icon,
  Clipboard,
  useState,
  useEffect,
  useRef,
  showToast,
  Toast,
  type ActionProps,
  type KeyboardShortcut
} from '@ztools/declarative-ui'
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

const UNKNOWN = '未识别'
/** 一键设置的公共 DNS（阿里公共 DNS） */
export const PUBLIC_DNS_PRESET = '223.5.5.5'

function statusText(status: NetworkAdapterItem['status']): string {
  if (status === 'up') return '已连接'
  if (status === 'down') return '未连接'
  return '状态未知'
}

function speedText(mbps: number): string {
  return mbps >= 1000 ? `${(mbps / 1000).toFixed(1)} Gbps` : `${mbps} Mbps`
}

function errorDetail(error: string): string {
  return error.replace(new RegExp(`^${ADAPTER_LIST_ERROR_PREFIX}[：:]\\s*`), '')
}

function summaryText(snapshot: NetworkAdapterSnapshot | null, isLoading: boolean): string {
  if (!snapshot) return isLoading ? '正在读取本机网卡...' : ''
  if (!snapshot.ok) return `${ADAPTER_LIST_ERROR_PREFIX}，可点击「刷新网卡」重试`
  const head = `活动接口 ${snapshot.activeCount}/${snapshot.adapters.length} 个`
  if (!snapshot.primaryIpv4) return `${head} · 主网卡: ${UNKNOWN}`
  return `${head} · 主 IPv4: ${snapshot.primaryIpv4} · 默认网关: ${snapshot.primaryGateway || '无'} · 首选 DNS: ${snapshot.primaryDns || '未配置'}`
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
  const subtitleParts = [`MAC: ${item.mac || UNKNOWN}`]
  if (item.ipv4) subtitleParts.push(`掩码: ${item.netmask || UNKNOWN}`)
  subtitleParts.push(`网关: ${item.gateway || '无'}`)
  subtitleParts.push(`DNS: ${item.dnsServers.length > 0 ? item.dnsServers.join(', ') : '未配置'}`)
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
    actions.push(copyAction(`复制 IPv4 地址 (${item.ipv4})`, Icon.Clipboard, copyAdapterInfo(item, 'ipv4'), '已复制 IPv4 地址'))
  }
  if (item.mac) {
    actions.push(copyAction(`复制 MAC 地址 (${item.mac})`, Icon.Key, copyAdapterInfo(item, 'mac'), '已复制 MAC 地址'))
  }
  const summary = copyAdapterInfo(item, 'summary')
  actions.push(
    copyAction('复制单行网络摘要', Icon.Document, summary, '已复制网卡摘要', summary, { modifiers: ['ctrl'], key: 'c' }),
    copyAction('复制完整网卡配置 JSON', Icon.Code, copyAdapterInfo(item, 'json'), '已复制网卡 JSON 配置', item.name, {
      modifiers: ['ctrl', 'shift'],
      key: 'c'
    })
  )
  if (item.category !== 'loopback') {
    actions.push(
      Action({
        title: `将 DNS 设为 ${PUBLIC_DNS_PRESET}（阿里公共 DNS，替换现有 DNS，需管理员权限）`,
        icon: Icon.Globe,
        shortcut: { modifiers: ['ctrl'], key: 'p' },
        onAction: () => onApplyDns(item, PUBLIC_DNS_PRESET)
      }),
      Action({
        title: '恢复自动获取 DNS（需管理员权限）',
        icon: Icon.ArrowClockwise,
        shortcut: { modifiers: ['ctrl', 'shift'], key: 'd' },
        onAction: () => onApplyDns(item, 'dhcp')
      })
    )
  }

  return List.Item({
    id: item.id,
    title: `${item.name} (${item.ipv4 || item.ipv6 || '未分配 IP'})`,
    subtitle: subtitleParts.join(' · '),
    icon: item.category === 'physical' ? Icon.Wifi : Icon.Globe,
    accessories,
    actions: ActionPanel({
      title: `${item.name} (${item.ipv4 || '未分配 IPv4'})`,
      children: actions
    })
  })
}

export function NetworkAdapterCommand() {
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
        showToast({ style: Toast.Style.Failure, title: ADAPTER_LIST_ERROR_PREFIX, message: errorDetail(snap.error) })
      }
      return
    }
    if (showNotice) {
      showToast({
        style: Toast.Style.Success,
        title: '本机网卡状态已刷新',
        message: `共 ${snap.adapters.length} 个接口 · 主 IPv4: ${snap.primaryIpv4 || UNKNOWN}`
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
      title: res.ok ? 'DNS 缓存已刷新' : 'DNS 刷新失败',
      message: res.message
    })
  }

  async function handleApplyDns(item: NetworkAdapterItem, primary: string) {
    const res = await applyDnsPreset(item.name, primary)
    showToast({
      style: res.ok ? Toast.Style.Success : Toast.Style.Failure,
      title: res.ok ? '网卡 DNS 已修改' : '修改网卡 DNS 失败',
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
        title: '读取失败',
        children: [
          List.Item({
            id: 'nic-load-error',
            title: ADAPTER_LIST_ERROR_PREFIX,
            subtitle: errorDetail(snapshot.error),
            icon: Icon.ExclamationMark
          })
        ]
      })
    )
  } else {
    children.push(
      List.Section({
        title: `本机网络接口 (${filtered.length})`,
        children: filtered.map((item) => renderAdapterItem(item, maxSpeed, handleApplyDns))
      })
    )
  }

  return List({
    navigationTitle: '网络接口与网卡配置',
    searchBarPlaceholder: '搜索网卡名称、IPv4/IPv6 地址、MAC 地址、DNS 或网卡型号...',
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    isLoading,
    searchBarAccessory: List.Dropdown({
      tooltip: '按网卡类型筛选',
      value: filterMode,
      onChange: (val: string) => setFilterMode(val as AdapterFilterMode),
      children: [
        List.Dropdown.Item({ title: '全部网络接口', value: 'all' }),
        List.Dropdown.Item({ title: '物理网卡', value: 'physical' }),
        List.Dropdown.Item({ title: '虚拟与回环网卡', value: 'virtual' }),
        List.Dropdown.Item({ title: '仅已连接接口', value: 'connected' })
      ]
    }),
    filterBar: {
      summaryText: summaryText(snapshot, isLoading),
      actions: [
        {
          id: 'refresh-nic',
          label: '刷新网卡',
          title: '刷新网卡',
          style: 'secondary',
          onAction: () => void refreshAdapters(true)
        },
        {
          id: 'flush-dns',
          label: '刷新DNS缓存',
          title: '刷新DNS缓存',
          style: 'secondary',
          onAction: () => void handleFlushDns()
        }
      ]
    },
    children
  })
}

export default NetworkAdapterCommand
