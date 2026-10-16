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
  Toast,
  MetricGrid,
  SegmentedControl
} from '@ztools/declarative-ui'
import {
  HardwareSpecEntry,
  HardwareTelemetrySnapshot,
  formatBytes,
  fetchHardwareTelemetrySnapshot
} from './logic'

export default function HardwareInfoCommand() {
  const [searchText, setSearchText] = useState('')
  const [tab, setTab] = useState<'all' | 'cpu' | 'memory' | 'storage' | 'display'>('all')
  const [snapshot, setSnapshot] = useState<HardwareTelemetrySnapshot | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  async function refreshTelemetry(showIndicator = false) {
    if (showIndicator) setIsLoading(true)
    try {
      const snap = await fetchHardwareTelemetrySnapshot()
      setSnapshot(snap)
      if (showIndicator) {
        showToast({
          style: Toast.Style.Success,
          title: '本机硬件遥测已刷新',
          message: `${snap.cpuModel} · 内存 ${snap.memoryUsagePercent}%`
        })
      }
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    refreshTelemetry(false)
  }, [])

  const entries: HardwareSpecEntry[] = snapshot?.entries || []
  const q = searchText.trim().toLowerCase()
  const filtered = entries.filter(e => {
    if (tab !== 'all' && e.category !== tab) return false
    if (!q) return true
    return (
      e.title.toLowerCase().includes(q) ||
      e.subtitle.toLowerCase().includes(q) ||
      e.value.toLowerCase().includes(q) ||
      e.tag.toLowerCase().includes(q)
    )
  })

  const cpuPct = snapshot?.cpuUsagePercent || 0
  const memPct = snapshot?.memoryUsagePercent || 0
  const totalMem = snapshot?.totalMemoryBytes || 0
  const usedMem = snapshot?.usedMemoryBytes || 0

  return List({
    searchBarPlaceholder: '搜索本机 CPU 型号、内存、磁盘分区、显示器分辨率或系统版本...',
    onSearchTextChange: setSearchText,
    isShowingDetail: true,
    isLoading,
    metricGrid: MetricGrid({
      columns: 4,
      items: [
        {
          id: 'hw-m-cpu',
          label: '处理器实时利用率',
          value: `${cpuPct}%`,
          subValue: snapshot ? `${snapshot.logicalCpuCount} 逻辑核心` : '采集中...',
          progress: cpuPct,
          status: cpuPct > 85 ? 'danger' : cpuPct > 60 ? 'warning' : 'success'
        },
        {
          id: 'hw-m-mem',
          label: '物理内存占用',
          value: `${memPct}%`,
          subValue: `${formatBytes(usedMem)} / ${formatBytes(totalMem)}`,
          progress: memPct,
          status: memPct > 85 ? 'danger' : memPct > 70 ? 'warning' : 'normal'
        },
        {
          id: 'hw-m-drives',
          label: '本机挂载存储卷',
          value: `${snapshot?.driveCount || 0} 块`,
          subValue: 'NTFS 硬件分区在线',
          status: 'normal'
        },
        {
          id: 'hw-m-disp',
          label: '显示输出与电源',
          value: `${snapshot?.displayCount || 1} 屏`,
          subValue: snapshot?.isCharging ? `⚡ 交流供电 (${snapshot.batteryPercent}%)` : `🔋 电池 (${snapshot?.batteryPercent || 100}%)`,
          status: 'success'
        }
      ]
    }),
    segmentedControl: SegmentedControl({
      value: tab,
      onChange: v => setTab(v as any),
      options: [
        { value: 'all', label: '整机硬件总览', badge: entries.length },
        { value: 'cpu', label: '处理器', badge: entries.filter(e => e.category === 'cpu').length },
        { value: 'memory', label: '物理内存', badge: entries.filter(e => e.category === 'memory').length },
        { value: 'storage', label: '磁盘存储', badge: entries.filter(e => e.category === 'storage').length },
        { value: 'display', label: '显示器', badge: entries.filter(e => e.category === 'display').length }
      ]
    }),
    children: [
      List.Section({
        title: `本机真实硬件与传感器规格清单 (${filtered.length})`,
        children: filtered.map(item =>
          List.Item({
            id: item.id,
            title: item.title,
            subtitle: item.subtitle,
            icon: {
              source:
                item.category === 'cpu'
                  ? Icon.Bolt
                  : item.category === 'memory'
                  ? Icon.Gear
                  : item.category === 'storage'
                  ? Icon.HardDrive
                  : item.category === 'display'
                  ? Icon.Monitor
                  : Icon.Desktop,
              tintColor: Color.Blue
            },
            accessories: [
              { tag: { value: item.tag, color: Color.SecondaryText } },
              { text: item.value }
            ],
            detail: List.Item.Detail({
              markdown: item.detailMarkdown
            }),
            actions: ActionPanel({
              title: item.title,
              children: [
                Action({
                  title: '刷新硬件传感器遥测',
                  icon: Icon.ArrowClockwise,
                  onAction: () => refreshTelemetry(true)
                }),
                Action({
                  title: '复制当前硬件规格摘要',
                  icon: Icon.Clipboard,
                  onAction: async () => {
                    const text = `${item.title} | ${item.subtitle} | ${item.value}`
                    await Clipboard.copy(text)
                    showToast({ style: Toast.Style.Success, title: '已复制硬件规格', message: item.title })
                  }
                }),
                Action({
                  title: '复制整机完整配置报告',
                  icon: Icon.Document,
                  onAction: async () => {
                    const report = entries.map(e => `- ${e.title}: ${e.subtitle} (${e.value})`).join('\n')
                    await Clipboard.copy(report)
                    showToast({ style: Toast.Style.Success, title: '已复制整机配置报告' })
                  }
                })
              ]
            })
          })
        )
      })
    ]
  })
}
