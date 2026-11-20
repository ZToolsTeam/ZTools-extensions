import {
  List,
  ActionPanel,
  Action,
  Icon,
  Color,
  Clipboard,
  useLocale,
  useState,
  useEffect,
  showToast,
  Toast
} from '@ztools/declarative-ui'
import { t } from './i18n.js'
import {
  type NetworkRescueItem,
  type RescueFilterMode,
  getNetworkRescueItems,
  runNetworkDiagnostics,
  executeNetworkRepair,
  batchExecuteNetworkRepairs,
  filterNetworkRescueItems
} from './logic.js'

export * from './logic.js'

export function NetworkRescueCommand() {
  useLocale()
  const [searchText, setSearchText] = useState('')
  const [filterMode, setFilterMode] = useState<RescueFilterMode>('all')
  const [items, setItems] = useState<NetworkRescueItem[]>(() => getNetworkRescueItems())
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
          title: snap.ok ? t('toastDiagDone') : t('toastDiagFailed'),
          message: snap.error || t('toastDiagStats', { warning: snap.warningCount, unknown: snap.unknownCount })
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
        title: t('toastRepairFailedTitle'),
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
        message: t('toastBatchDoneMessage')
      })
    } else {
      showToast({
        style: Toast.Style.Failure,
        title: t('toastBatchFailedTitle'),
        message: res.summary
      })
    }
  }

  const filtered = filterNetworkRescueItems(items, searchText, filterMode)
  const unknownCount = items.filter(item => item.status === 'unknown').length
  const warningCount = items.filter((i) => i.status === 'warning' || i.status === 'error').length

  return List({
    navigationTitle: t('navTitle'),
    searchBarPlaceholder: t('searchPlaceholder'),
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    isLoading,
    searchBarAccessory: List.Dropdown({
      tooltip: t('filterTooltip'),
      value: filterMode,
      onChange: (val: string) => setFilterMode(val as RescueFilterMode),
      children: [
        List.Dropdown.Item({ title: t('filterAll'), value: 'all' }),
        List.Dropdown.Item({ title: t('filterWarning'), value: 'warning' }),
        List.Dropdown.Item({ title: t('filterDnsProxy'), value: 'dns_proxy' }),
        List.Dropdown.Item({ title: t('filterStackReset'), value: 'stack_reset' })
      ]
    }),
    filterBar: {
      summaryText: diagnosticError || t('summaryBar', { checked: items.length - unknownCount, warning: warningCount, unknown: unknownCount }),
      actions: [
        {
          id: 'rediagnose',
          label: t('btnRediagnose'),
          title: t('btnRediagnose'),
          style: 'secondary',
          onAction: () => void refreshDiagnostics(true)
        }
      ]
    },
    children: [
      List.Section({
        title: t('sectionTitle', { count: filtered.length }),
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
                  value: isWarning ? t('tagWarning') : item.status === 'unknown' ? t('tagUnknown') : t('tagHealthy'),
                  ...(isWarning ? { color: Color.Red } : {})
                }
              },
              { text: item.statusText }
            ],
            actions: ActionPanel({
              title: item.title,
              children: [
                Action({
                  title: t('actionRunRepair', { category: item.categoryLabel }),
                  icon: Icon.Bolt,
                  onAction: () => handleRepairItem(item)
                }),
                Action({
                  title: t('actionCopyCommand'),
                  icon: Icon.Clipboard,
                  shortcut: { modifiers: ['ctrl'], key: 'return' },
                  onAction: async () => {
                    await Clipboard.copy(item.command)
                    showToast({
                      style: Toast.Style.Success,
                      title: t('toastCopiedCommand'),
                      message: item.command
                    })
                  }
                }),
                Action({
                  title: t('actionRediagnose'),
                  icon: Icon.ArrowClockwise,
                  shortcut: { modifiers: ['ctrl'], key: 'r' },
                  onAction: () => refreshDiagnostics(true)
                }),
                ...(warningCount > 0
                  ? [
                      Action({
                        title: t('actionBatchRepair', { count: warningCount }),
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
