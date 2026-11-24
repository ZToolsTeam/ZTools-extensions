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
  Toast
} from '@ztools/declarative-ui'
import {
  HardwareSpecEntry,
  HardwareTelemetrySnapshot,
  formatBytes,
  fetchHardwareTelemetrySnapshot,
  exportHardwareReport,
  buildSummaryText,
  TELEMETRY_MODULES
} from './logic.js'
import { t } from './i18n.js'

export * from './logic.js'

type HardwareDropdownFilter = 'all' | 'cpu-mem' | 'storage' | 'display' | 'benchmark' | 'report'

export default function HardwareInfoCommand() {
  const locale = useLocale()
  const [searchText, setSearchText] = useState('')
  const [dropdownFilter, setDropdownFilter] = useState<HardwareDropdownFilter>('all')
  const [snapshot, setSnapshot] = useState<HardwareTelemetrySnapshot | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  // 连续刷新时只采用最后一次请求的结果，避免较慢的旧请求覆盖新数据；卸载后不再更新状态或弹提示
  const requestSeq = useRef(0)
  const mounted = useRef(true)

  // showIndicator：用户主动刷新时才弹成功提示；读取失败无论首次加载还是刷新都要如实提示
  async function refreshTelemetry(showIndicator = false) {
    const seq = ++requestSeq.current
    const isCurrent = () => mounted.current && seq === requestSeq.current
    if (showIndicator) setIsLoading(true)
    try {
      const snap = await fetchHardwareTelemetrySnapshot()
      if (!isCurrent()) return
      setSnapshot(snap)
      if (snap.failures.length > 0) {
        showToast({
          style: Toast.Style.Failure,
          title: snap.failures.length >= TELEMETRY_MODULES.length ? t('toastAllReadFailed') : t('toastPartialReadFailed'),
          message: t('toastReadFailedMsg', {
            failures: snap.failures.join(t('listSeparator')),
            warnings: snap.warnings.length > 0 ? `${t('periodSeparator')}${snap.warnings.join(t('semiSeparator'))}` : ''
          })
        })
      } else if (showIndicator) {
        showToast({
          style: Toast.Style.Success,
          title: t('toastRefreshedTitle'),
          message: t('toastRefreshedMsg', {
            cpu: snap.cpuModel ?? '',
            mem: snap.memoryUsagePercent ?? 0,
            disk: formatBytes(snap.totalDiskBytes)
          })
        })
      }
    } catch (err) {
      if (!isCurrent()) return
      showToast({
        style: Toast.Style.Failure,
        title: t('toastAllReadFailed'),
        message: err instanceof Error ? err.message : String(err)
      })
    } finally {
      if (isCurrent()) setIsLoading(false)
    }
  }

  async function copyText(content: string, successTitle: string, successMessage: string) {
    try {
      await Clipboard.copy(content)
      showToast({ style: Toast.Style.Success, title: successTitle, message: successMessage })
    } catch (err) {
      showToast({
        style: Toast.Style.Failure,
        title: t('toastCopyFailed'),
        message: err instanceof Error ? err.message : String(err)
      })
    }
  }

  useEffect(() => {
    mounted.current = true
    void refreshTelemetry(false)
    return () => {
      mounted.current = false
    }
  }, [locale])

  async function handleCopyReport(format: 'markdown' | 'json' | 'txt') {
    if (!snapshot) {
      showToast({ style: Toast.Style.Failure, title: t('toastNotReadyTitle'), message: t('toastNotReadyMsg') })
      return
    }
    const content = exportHardwareReport(snapshot, format)
    const message = snapshot.failures.length > 0
      ? t('toastReportFailureMsg', { failures: snapshot.failures.join(t('listSeparator')) })
      : t('toastReportOkMsg', { cpu: snapshot.cpuModel ?? '', mem: formatBytes(snapshot.totalMemoryBytes ?? 0) })
    await copyText(content, t('toastExportedReport', { format: format.toUpperCase() }), message)
  }

  const entries: HardwareSpecEntry[] = snapshot?.entries || []
  const q = searchText.trim().toLowerCase()
  const filtered = entries.filter((e) => {
    if (dropdownFilter === 'cpu-mem' && e.category !== 'cpu' && e.category !== 'memory' && e.category !== 'system') {
      return false
    }
    if (dropdownFilter === 'storage' && e.category !== 'storage') return false
    if (dropdownFilter === 'display' && e.category !== 'display') return false
    if (dropdownFilter === 'benchmark' && e.category !== 'benchmark') return false
    if (!q) return true
    return (
      e.title.toLowerCase().includes(q) ||
      e.subtitle.toLowerCase().includes(q) ||
      e.value.toLowerCase().includes(q) ||
      e.tag.toLowerCase().includes(q)
    )
  })

  return List({
    searchBarPlaceholder: t('searchPlaceholder'),
    onSearchTextChange: setSearchText,
    isShowingDetail: true,
    isLoading,
    searchBarAccessory: List.Dropdown({
      tooltip: t('dropdownTooltip'),
      value: dropdownFilter,
      onChange: (val: string) => setDropdownFilter(val as HardwareDropdownFilter),
      children: [
        List.Dropdown.Item({ title: t('filterAll'), value: 'all' }),
        List.Dropdown.Item({ title: t('filterCpuMem'), value: 'cpu-mem' }),
        List.Dropdown.Item({ title: t('filterStorage'), value: 'storage' }),
        List.Dropdown.Item({ title: t('filterDisplay'), value: 'display' }),
        List.Dropdown.Item({ title: t('filterBenchmark'), value: 'benchmark' }),
        List.Dropdown.Item({ title: t('filterReport'), value: 'report' })
      ]
    }),
    filterBar: {
      summaryText: buildSummaryText(snapshot),
      actions: [
        {
          id: 'refresh-hw',
          label: t('actionRefresh'),
          title: t('actionRefresh'),
          style: 'secondary',
          onAction: () => void refreshTelemetry(true)
        },
        {
          id: 'export-md',
          label: t('actionCopyMdReport'),
          title: t('actionCopyMdReport'),
          style: 'secondary',
          onAction: () => void handleCopyReport('markdown')
        }
      ]
    },
    children:
      dropdownFilter === 'report' && snapshot
        ? [
            List.Section({
              title: t('reportSectionTitle'),
              children: [
                List.Item({
                  id: 'report-md',
                  title: t('reportMdTitle'),
                  subtitle: t('reportMdSubtitle'),
                  icon: Icon.Document,
                  accessories: [{ tag: { value: 'Markdown' } }],
                  detail: List.Item.Detail({
                    markdown: exportHardwareReport(snapshot, 'markdown')
                  }),
                  actions: ActionPanel({
                    title: t('reportMdPanel'),
                    children: [
                      Action({
                        title: t('reportMdAction'),
                        icon: Icon.Clipboard,
                        onAction: () => handleCopyReport('markdown')
                      })
                    ]
                  })
                }),
                List.Item({
                  id: 'report-json',
                  title: t('reportJsonTitle'),
                  subtitle: t('reportJsonSubtitle'),
                  icon: Icon.Terminal,
                  accessories: [{ tag: { value: 'JSON' } }],
                  detail: List.Item.Detail({
                    markdown: '```json\n' + exportHardwareReport(snapshot, 'json') + '\n```'
                  }),
                  actions: ActionPanel({
                    title: t('reportJsonPanel'),
                    children: [
                      Action({
                        title: t('reportJsonAction'),
                        icon: Icon.Clipboard,
                        onAction: () => handleCopyReport('json')
                      })
                    ]
                  })
                }),
                List.Item({
                  id: 'report-txt',
                  title: t('reportTxtTitle'),
                  subtitle: t('reportTxtSubtitle'),
                  icon: Icon.Clipboard,
                  accessories: [{ tag: { value: t('reportTxtTag') } }],
                  detail: List.Item.Detail({
                    markdown: '```text\n' + exportHardwareReport(snapshot, 'txt') + '\n```'
                  }),
                  actions: ActionPanel({
                    title: t('reportTxtPanel'),
                    children: [
                      Action({
                        title: t('reportTxtAction'),
                        icon: Icon.Clipboard,
                        onAction: () => handleCopyReport('txt')
                      })
                    ]
                  })
                })
              ]
            })
          ]
        : [
            List.Section({
              title: t('specSectionTitle', { count: filtered.length }),
              children: filtered.map((item) =>
                List.Item({
                  id: item.id,
                  title: item.title,
                  subtitle: item.subtitle,
                  icon:
                    item.category === 'cpu'
                      ? Icon.Bolt
                      : item.category === 'memory'
                      ? Icon.Gear
                      : item.category === 'storage'
                      ? Icon.HardDrive
                      : item.category === 'display'
                      ? Icon.Monitor
                      : item.category === 'benchmark'
                      ? Icon.Star
                      : Icon.Desktop,
                  accessories: [
                    { tag: { value: item.tag } },
                    ...(item.value ? [{ text: item.value }] : [])
                  ],
                  detail: List.Item.Detail({
                    markdown: item.detailMarkdown
                  }),
                  actions: ActionPanel({
                    title: item.title,
                    children: [
                      Action({
                        title: t('copySpecAction'),
                        icon: Icon.Clipboard,
                        onAction: () =>
                          copyText(
                            [item.title, item.subtitle, item.value].filter(Boolean).join(' | '),
                            t('copiedSpecToast'),
                            item.title
                          )
                      }),
                      Action({
                        title: t('copyDetailAction'),
                        icon: Icon.Document,
                        onAction: () => copyText(item.detailMarkdown, t('copiedDetailToast'), item.title)
                      })
                    ]
                  })
                })
              )
            })
          ]
  })
}
