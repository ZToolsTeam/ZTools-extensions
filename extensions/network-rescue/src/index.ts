import {
  List,
  ActionPanel,
  Action,
  Icon,
  Color,
  Clipboard,
  useState,
  useEffect,
  showToast,
  Toast
} from '@ztools/declarative-ui'
import {
  type NetworkRescueItem,
  type RescueFilterMode,
  NETWORK_RESCUE_ITEMS,
  runNetworkDiagnostics,
  executeNetworkRepair,
  batchExecuteNetworkRepairs,
  filterNetworkRescueItems
} from './logic.js'

export * from './logic.js'

export function NetworkRescueCommand() {
  const [searchText, setSearchText] = useState('')
  const [filterMode, setFilterMode] = useState<RescueFilterMode>('all')
  const [items, setItems] = useState<NetworkRescueItem[]>(NETWORK_RESCUE_ITEMS)
  const [diagnosticError, setDiagnosticError] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  async function refreshDiagnostics(showNotice = false) {
    if (showNotice) setIsLoading(true)
    try {
      const snap = await runNetworkDiagnostics()
      setItems(snap.items)
      setDiagnosticError(snap.error || '')
      if (showNotice) {
        showToast({
          style: snap.ok ? Toast.Style.Success : Toast.Style.Failure,
          title: snap.ok ? '网络诊断已完成' : '网络诊断失败',
          message: snap.error || `告警 ${snap.warningCount} 项 · 未检测 ${snap.unknownCount} 项`
        })
      }
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void refreshDiagnostics(false)
  }, [])

  async function handleRepairItem(item: NetworkRescueItem) {
    const res = await executeNetworkRepair(item.id)
    if (res.ok) {
      await refreshDiagnostics(false)
      showToast({
        style: Toast.Style.Success,
        title: res.message,
        message: item.command
      })
    } else {
      showToast({
        style: Toast.Style.Failure,
        title: '修复执行失败',
        message: res.message
      })
    }
  }

  async function handleRepairAllWarnings() {
    const warningIds = items.filter((i) => i.status === 'warning' || i.status === 'error').map((i) => i.id)
    const res = await batchExecuteNetworkRepairs(warningIds)
    if (res.ok && res.repairedCount > 0) {
      await refreshDiagnostics(false)
      showToast({
        style: Toast.Style.Success,
        title: res.summary,
        message: '已重新诊断，请查看各项实际状态'
      })
    } else {
      showToast({
        style: Toast.Style.Failure,
        title: '批量修复未完成',
        message: res.summary
      })
    }
  }

  const filtered = filterNetworkRescueItems(items, searchText, filterMode)
  const unknownCount = items.filter(item => item.status === 'unknown').length
  const warningCount = items.filter((i) => i.status === 'warning' || i.status === 'error').length

  return List({
    navigationTitle: '网络断网诊断与急救箱',
    searchBarPlaceholder: '搜索网络急救项 (如: DNS 缓存, 残留系统代理, Winsock 重置, Hosts 劫持, DHCP)...',
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    isLoading,
    searchBarAccessory: List.Dropdown({
      tooltip: '筛选网络急救分类',
      value: filterMode,
      onChange: (val: string) => setFilterMode(val as RescueFilterMode),
      children: [
        List.Dropdown.Item({ title: '全部急救项 (All Rescue Items)', value: 'all' }),
        List.Dropdown.Item({ title: '异常告警项 (Warnings Only)', value: 'warning' }),
        List.Dropdown.Item({ title: 'DNS与代理修复 (DNS & Proxy)', value: 'dns_proxy' }),
        List.Dropdown.Item({ title: '协议栈重置 (Winsock & Firewall)', value: 'stack_reset' })
      ]
    }),
    filterBar: {
      summaryText: diagnosticError || `已有结果 ${items.length - unknownCount} 项 · 告警 ${warningCount} 项 · 未检测 ${unknownCount} 项`,
      actions: [
        {
          id: 'rediagnose',
          label: '重新诊断全网',
          title: '重新诊断全网',
          style: 'secondary',
          onAction: () => void refreshDiagnostics(true)
        },

      ]
    },
    children: [
      List.Section({
        title: `网络故障诊断与一键修复项 (${filtered.length})`,
        children: filtered.map((item) => {
          const isWarning = item.status === 'warning' || item.status === 'error'
          return List.Item({
            id: item.id,
            title: item.title,
            subtitle: `${item.subtitle}`,
            icon: isWarning ? Icon.ExclamationMark : Icon.Shield,
            accessories: [
              {
                tag: {
                  value: isWarning ? '异常告警' : item.status === 'unknown' ? '未检测' : '检查通过',
                  ...(isWarning ? { color: Color.Red } : {})
                }
              },
              { text: item.statusText }
            ],
            actions: ActionPanel({
              title: item.title,
              children: [
                Action({
                  title: `一键执行修复 (${item.categoryLabel})`,
                  icon: Icon.Bolt,
                  onAction: () => handleRepairItem(item)
                }),
                Action({
                  title: '复制底层修复命令',
                  icon: Icon.Clipboard,
                  shortcut: { modifiers: ['ctrl'], key: 'return' },
                  onAction: async () => {
                    await Clipboard.copy(item.command)
                    showToast({
                      style: Toast.Style.Success,
                      title: '已复制修复命令',
                      message: item.command
                    })
                  }
                }),
                Action({
                  title: '重新诊断全网连通性',
                  icon: Icon.ArrowClockwise,
                  shortcut: { modifiers: ['ctrl'], key: 'r' },
                  onAction: () => refreshDiagnostics(true)
                }),
                ...(warningCount > 0
                  ? [
                      Action({
                        title: `批量修复全部 ${warningCount} 项异常`,
                        icon: Icon.Checkmark,
                        onAction: () => handleRepairAllWarnings()
                      })
                    ]
                  : [])
              ]
            })
          })
        })
      })
    ]
  })
}

export default NetworkRescueCommand
