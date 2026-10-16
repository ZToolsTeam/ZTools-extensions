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
  confirmAlert,
  MetricGrid,
  SegmentedControl
} from '@ztools/declarative-ui'
import {
  BoostCandidateItem,
  BoostSnapshot,
  FORBIDDEN_REASON,
  formatBytes,
  fetchBoostSnapshot,
  terminateBoostProcess,
  executeQuickBoostCleanup,
  openBoostItemLocation
} from './logic'

export default function BoostCommand() {
  const [searchText, setSearchText] = useState('')
  const [tab, setTab] = useState<'all' | 'process' | 'temp_cache'>('all')
  const [snapshot, setSnapshot] = useState<BoostSnapshot | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  async function refreshBoost(showIndicator = false) {
    if (showIndicator) setIsLoading(true)
    try {
      const snap = await fetchBoostSnapshot()
      setSnapshot(snap)
      if (showIndicator) {
        showToast({
          style: Toast.Style.Success,
          title: '系统负载巡检完成',
          message: `当前内存占用 ${snap.memoryUsagePercent}% · 预计可释放 ${formatBytes(snap.reclaimableEstimateBytes)}`
        })
      }
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    refreshBoost(false)
  }, [])

  async function handleQuickBoost() {
    if (!snapshot) return
    const tempItems = snapshot.candidates.filter(c => c.type === 'temp_cache')
    const confirmed = await confirmAlert({
      title: '🚀 确认执行系统一键加速与临时缓存清理？',
      message: `将清理系统 %TEMP% 热点残留文件 (${tempItems.length} 项)，并重新采样物理内存工作集。\n\n核心系统服务与正在编辑的文档受严格保护。`,
      primaryAction: { title: '立即一键加速', style: 'default' }
    })
    if (!confirmed) return

    showToast({ style: Toast.Style.Animated, title: '正在执行系统加速与缓存回收...' })
    const res = await executeQuickBoostCleanup(snapshot.candidates)
    await refreshBoost(false)
    showToast({
      style: Toast.Style.Success,
      title: '系统极速加速完成',
      message: `已清理 ${res.cleanedCount} 项临时残留，释放 ${formatBytes(res.freedBytes)}`
    })
  }

  async function handleTerminateCandidate(item: BoostCandidateItem) {
    if (item.type !== 'process' || !item.pid) return
    if (item.isProtected) {
      await confirmAlert({
        title: `⚠️ 核心进程受保护 [${item.name}]`,
        message: FORBIDDEN_REASON,
        primaryAction: { title: '我知道了', style: 'default' }
      })
      return
    }

    const confirmed = await confirmAlert({
      title: `确认关闭高内存进程 [${item.name}] 以释放内存？`,
      message: `PID: ${item.pid}\n当前占用物理内存: ${formatBytes(item.memoryOrSizeBytes)}\n\n关闭后将立即释放该进程占用的全部物理内存工作集。`,
      primaryAction: { title: '关闭并释放内存', style: 'destructive' }
    })
    if (!confirmed) return

    const res = await terminateBoostProcess(item.pid, item.name)
    if (!res.ok) {
      showToast({ style: Toast.Style.Failure, title: '释放失败', message: res.error || '权限不足' })
      return
    }
    showToast({
      style: Toast.Style.Success,
      title: '已释放进程内存',
      message: `${item.name} (${formatBytes(item.memoryOrSizeBytes)})`
    })
    refreshBoost(false)
  }

  const candidates = snapshot?.candidates || []
  const q = searchText.trim().toLowerCase()
  const filtered = candidates.filter(c => {
    if (tab !== 'all' && c.type !== tab) return false
    if (!q) return true
    return (
      c.name.toLowerCase().includes(q) ||
      c.path.toLowerCase().includes(q) ||
      String(c.pid || '').includes(q)
    )
  })

  const memPct = snapshot?.memoryUsagePercent || 0
  const cpuPct = snapshot?.cpuUsagePercent || 0

  return List({
    searchBarPlaceholder: '搜索高内存占用进程、PID 或系统临时缓存项...',
    onSearchTextChange: setSearchText,
    isShowingDetail: true,
    isLoading,
    metricGrid: MetricGrid({
      columns: 4,
      items: [
        {
          id: 'boost-mem',
          label: '物理内存负载',
          value: `${memPct}%`,
          subValue: `${formatBytes(snapshot?.usedMemoryBytes || 0)} / ${formatBytes(snapshot?.totalMemoryBytes || 0)}`,
          progress: memPct,
          status: memPct > 85 ? 'danger' : memPct > 70 ? 'warning' : 'success'
        },
        {
          id: 'boost-avail',
          label: '空闲可用内存',
          value: formatBytes(snapshot?.availableMemoryBytes || 0),
          subValue: '立即可分配物理页',
          status: 'normal'
        },
        {
          id: 'boost-reclaim',
          label: '预计可优化空间',
          value: formatBytes(snapshot?.reclaimableEstimateBytes || 0),
          subValue: `${candidates.filter(c => !c.isProtected).length} 个可优化项`,
          status: 'success'
        },
        {
          id: 'boost-cpu',
          label: 'CPU 瞬时负载',
          value: `${cpuPct}%`,
          subValue: '实时内核采样',
          progress: cpuPct,
          status: cpuPct > 80 ? 'danger' : 'normal'
        }
      ]
    }),
    segmentedControl: SegmentedControl({
      value: tab,
      onChange: v => setTab(v as any),
      options: [
        { value: 'all', label: '全部优化项', badge: candidates.length },
        { value: 'process', label: '高内存进程排行', badge: candidates.filter(c => c.type === 'process').length },
        { value: 'temp_cache', label: '临时缓存残留', badge: candidates.filter(c => c.type === 'temp_cache').length }
      ]
    }),
    children: [
      List.Section({
        title: `本机真实内存与缓存优化清单 (${filtered.length})`,
        children: filtered.map(item =>
          List.Item({
            id: item.id,
            title: item.name,
            subtitle: item.type === 'process' ? `PID: ${item.pid} · ${item.recommendation}` : item.path,
            icon: {
              source: item.type === 'process' ? Icon.Bolt : Icon.Trash,
              tintColor: item.isProtected ? Color.SecondaryText : item.memoryOrSizeBytes > 300 * 1024 * 1024 ? Color.Orange : Color.Green
            },
            accessories: [
              {
                tag: {
                  value: item.isProtected ? '系统保护' : item.type === 'process' ? '内存工作集' : '临时残留',
                  color: item.isProtected ? Color.SecondaryText : Color.Blue
                }
              },
              { text: formatBytes(item.memoryOrSizeBytes) }
            ],
            detail: List.Item.Detail({
              markdown: `# ⚡ ${item.name}

**类型**: \`${item.type === 'process' ? `运行中进程 (PID: ${item.pid})` : '系统 %TEMP% 缓存文件'}\`  
**路径**: \`${item.path || '系统内核路径'}\`

---

### 📊 资源消耗与优化建议
- **当前占用大小**: \`${formatBytes(item.memoryOrSizeBytes)}\`
- **CPU 瞬时负载**: \`${item.cpuPercent.toFixed(1)}%\`
- **诊断建议**: ${item.recommendation}
`
            }),
            actions: ActionPanel({
              title: item.name,
              children: [
                Action({
                  title: '执行一键系统加速与清理',
                  icon: Icon.Bolt,
                  onAction: () => handleQuickBoost()
                }),
                ...(item.type === 'process' && !item.isProtected
                  ? [
                      Action({
                        title: '关闭该进程以释放内存',
                        icon: Icon.XMarkCircle,
                        onAction: () => handleTerminateCandidate(item)
                      })
                    ]
                  : []),
                ...(item.path
                  ? [
                      Action({
                        title: '在资源管理器中定位',
                        icon: Icon.Folder,
                        onAction: () => {
                          openBoostItemLocation(item.path)
                        }
                      })
                    ]
                  : []),
                Action({
                  title: '刷新系统负载快照',
                  icon: Icon.ArrowClockwise,
                  onAction: () => refreshBoost(true)
                })
              ]
            })
          })
        )
      })
    ]
  })
}
