import {
  List,
  ActionPanel,
  Action,
  Icon,
  Clipboard,
  useState,
  useEffect,
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

export * from './logic.js'

type HardwareDropdownFilter = 'all' | 'cpu-mem' | 'storage' | 'display' | 'benchmark' | 'report'

export default function HardwareInfoCommand() {
  const [searchText, setSearchText] = useState('')
  const [dropdownFilter, setDropdownFilter] = useState<HardwareDropdownFilter>('all')
  const [snapshot, setSnapshot] = useState<HardwareTelemetrySnapshot | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // showIndicator：用户主动刷新时才弹成功提示；读取失败无论首次加载还是刷新都要如实提示
  async function refreshTelemetry(showIndicator = false) {
    if (showIndicator) setIsLoading(true)
    try {
      const snap = await fetchHardwareTelemetrySnapshot()
      setSnapshot(snap)
      if (snap.failures.length > 0) {
        showToast({
          style: Toast.Style.Failure,
          title: snap.failures.length >= TELEMETRY_MODULES.length ? '硬件信息读取失败' : '部分硬件信息读取失败',
          message: `未能读取：${snap.failures.join('、')}`
        })
      } else if (showIndicator) {
        showToast({
          style: Toast.Style.Success,
          title: '硬件信息已刷新',
          message: `${snap.cpuModel} · 内存 ${snap.memoryUsagePercent}% · 存储 ${formatBytes(snap.totalDiskBytes)}`
        })
      }
    } catch (err) {
      showToast({
        style: Toast.Style.Failure,
        title: '硬件信息读取失败',
        message: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setIsLoading(false)
    }
  }

  async function copyText(content: string, successTitle: string, successMessage: string) {
    try {
      await Clipboard.copy(content)
      showToast({ style: Toast.Style.Success, title: successTitle, message: successMessage })
    } catch (err) {
      showToast({
        style: Toast.Style.Failure,
        title: '复制失败',
        message: err instanceof Error ? err.message : String(err)
      })
    }
  }

  useEffect(() => {
    void refreshTelemetry(false)
  }, [])

  async function handleCopyReport(format: 'markdown' | 'json' | 'txt') {
    if (!snapshot) return
    const content = exportHardwareReport(snapshot, format)
    const message = snapshot.failures.length > 0
      ? `报告中「${snapshot.failures.join('、')}」标注为读取失败`
      : `${snapshot.cpuModel} · ${formatBytes(snapshot.totalMemoryBytes ?? 0)} RAM`
    await copyText(content, `已导出 ${format.toUpperCase()} 硬件配置报告至剪贴板`, message)
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
    searchBarPlaceholder: '搜索 CPU 型号、内存、系统版本、磁盘分区、显示器或场景评估...',
    onSearchTextChange: setSearchText,
    isShowingDetail: true,
    isLoading,
    searchBarAccessory: List.Dropdown({
      tooltip: '切换硬件模块或导出报告',
      value: dropdownFilter,
      onChange: (val: string) => setDropdownFilter(val as HardwareDropdownFilter),
      children: [
        List.Dropdown.Item({ title: '全部硬件模块 (All Modules)', value: 'all' }),
        List.Dropdown.Item({ title: '处理器与内存 (CPU & RAM)', value: 'cpu-mem' }),
        List.Dropdown.Item({ title: '磁盘存储卷 (Storage Volumes)', value: 'storage' }),
        List.Dropdown.Item({ title: '显示器 (Displays)', value: 'display' }),
        List.Dropdown.Item({ title: '4 大场景估算评分 (Scenarios)', value: 'benchmark' }),
        List.Dropdown.Item({ title: '导出硬件报告 (Export Report)', value: 'report' })
      ]
    }),
    filterBar: {
      summaryText: buildSummaryText(snapshot),
      actions: [
        {
          id: 'refresh-hw',
          label: '刷新',
          title: '刷新',
          style: 'secondary',
          onAction: () => void refreshTelemetry(true)
        },
        {
          id: 'export-md',
          label: '复制Markdown报告',
          title: '复制Markdown报告',
          style: 'secondary',
          onAction: () => void handleCopyReport('markdown')
        }
      ]
    },
    children:
      dropdownFilter === 'report' && snapshot
        ? [
            List.Section({
              title: '多格式整机硬件配置与健康度报告导出',
              children: [
                List.Item({
                  id: 'report-md',
                  title: '导出 Markdown 格式整机硬件评测报告',
                  subtitle: '适合粘贴至 GitHub Issue、Notion、Obsidian 或技术文档',
                  icon: Icon.Document,
                  accessories: [{ tag: { value: 'Markdown' } }],
                  detail: List.Item.Detail({
                    markdown: exportHardwareReport(snapshot, 'markdown')
                  }),
                  actions: ActionPanel({
                    title: 'Markdown 报告',
                    children: [
                      Action({
                        title: '复制 Markdown 硬件报告到剪贴板',
                        icon: Icon.Clipboard,
                        onAction: () => handleCopyReport('markdown')
                      })
                    ]
                  })
                }),
                List.Item({
                  id: 'report-json',
                  title: '导出 JSON 结构化硬件资产清单',
                  subtitle: '适合企业 IT 资产盘点、自动化运维脚本与 API 对接',
                  icon: Icon.Terminal,
                  accessories: [{ tag: { value: 'JSON Schema' } }],
                  detail: List.Item.Detail({
                    markdown: '```json\n' + exportHardwareReport(snapshot, 'json') + '\n```'
                  }),
                  actions: ActionPanel({
                    title: 'JSON 资产清单',
                    children: [
                      Action({
                        title: '复制 JSON 硬件清单到剪贴板',
                        icon: Icon.Clipboard,
                        onAction: () => handleCopyReport('json')
                      })
                    ]
                  })
                }),
                List.Item({
                  id: 'report-txt',
                  title: '导出纯文本 (TXT) 极简配置单',
                  subtitle: '适合直接发送至即时通讯窗口快速分享本机配置',
                  icon: Icon.Clipboard,
                  accessories: [{ tag: { value: 'Plain Text' } }],
                  detail: List.Item.Detail({
                    markdown: '```text\n' + exportHardwareReport(snapshot, 'txt') + '\n```'
                  }),
                  actions: ActionPanel({
                    title: '纯文本配置单',
                    children: [
                      Action({
                        title: '复制纯文本配置单到剪贴板',
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
              title: `本机硬件规格清单 (${filtered.length})`,
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
                    { text: item.value }
                  ],
                  detail: List.Item.Detail({
                    markdown: item.detailMarkdown
                  }),
                  actions: ActionPanel({
                    title: item.title,
                    children: [
                      Action({
                        title: '复制 Markdown 整机硬件报告',
                        icon: Icon.Document,
                        onAction: () => handleCopyReport('markdown')
                      }),
                      Action({
                        title: '复制 JSON 结构化资产清单',
                        icon: Icon.Terminal,
                        shortcut: { modifiers: ['ctrl'], key: 'return' },
                        onAction: () => handleCopyReport('json')
                      }),
                      Action({
                        title: '复制当前硬件规格摘要',
                        icon: Icon.Clipboard,
                        shortcut: { modifiers: ['ctrl'], key: 'c' },
                        onAction: () =>
                          copyText(`${item.title} | ${item.subtitle} | ${item.value}`, '已复制硬件规格', item.title)
                      }),
                      Action({
                        title: '刷新硬件信息',
                        icon: Icon.ArrowClockwise,
                        shortcut: { modifiers: ['ctrl'], key: 'r' },
                        onAction: () => refreshTelemetry(true)
                      })
                    ]
                  })
                })
              )
            })
          ]
  })
}
