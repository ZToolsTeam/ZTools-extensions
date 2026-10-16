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
} from '@ztools/declarative-ui';
import {
  CleanGroupItem,
  CleanSummaryData,
  formatBytes,
  getMockCleanGroups,
  getMockCleanSummary,
  fetchCleanRulesAndScan,
  executeCleanGroups,
  emptyRecycleBin,
  filterCleanGroups
} from "./logic";

import { isRealElectronHost } from "../../shared/native-ipc";

export default function CleanerCommand() {
  const inRealHost = isRealElectronHost()
  const [searchText, setSearchText] = useState('')
  const [tab, setTab] = useState<'all' | 'system' | 'browser' | 'app'>('all')
  const [groups, setGroups] = useState<CleanGroupItem[]>(inRealHost ? [] : getMockCleanGroups())
  const [summary, setSummary] = useState<CleanSummaryData>(
    inRealHost
      ? {
          totalSizeBytes: 0,
          checkedSizeBytes: 0,
          totalFileCount: 0,
          checkedFileCount: 0,
          diskFreeSizeBytes: 0,
          diskTotalSizeBytes: 0,
          recycleBinSizeBytes: 0
        }
      : getMockCleanSummary()
  )
  const [isLoading, setIsLoading] = useState(inRealHost)

  // 重新计算已勾选总体积与项数
  function updateSummary(currentGroups: CleanGroupItem[], baseSummary = summary): CleanSummaryData {
    let checkedSizeBytes = 0
    let checkedFileCount = 0
    let totalSizeBytes = 0
    let totalFileCount = 0

    for (const g of currentGroups) {
      totalSizeBytes += g.totalSizeBytes
      totalFileCount += g.fileCount
      if (g.checked) {
        checkedSizeBytes += g.totalSizeBytes
        checkedFileCount += g.fileCount
      }
    }

    return {
      ...baseSummary,
      totalSizeBytes,
      totalFileCount,
      checkedSizeBytes,
      checkedFileCount
    }
  }

  // 刷新/扫描全盘数据
  async function refreshData(showIndicator = false) {
    if (showIndicator) {
      setIsLoading(true)
      showToast({
        style: Toast.Style.Animated,
        title: '正在扫描系统垃圾',
        message: '枚举临时文件、更新残留与浏览器缓存...'
      })
    }

    try {
      const res = await fetchCleanRulesAndScan()
      setGroups(res.groups)
      setSummary(res.summary)
      if (showIndicator) {
        showToast({
          style: Toast.Style.Success,
          title: '系统垃圾扫描完成',
          message: `发现 ${res.groups.length} 个垃圾分类，共计 ${formatBytes(res.summary.totalSizeBytes)}`
        })
      }
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    refreshData(false)
  }, [])

  // 切换单项勾选状态
  function toggleCheck(id: string) {
    setGroups(prev => {
      const next = prev.map(g => (g.id === id ? { ...g, checked: !g.checked } : g))
      setSummary(updateSummary(next))
      return next
    })
  }

  // 全选或取消全选
  function toggleAll(checked: boolean) {
    setGroups(prev => {
      const next = prev.map(g => ({ ...g, checked }))
      setSummary(updateSummary(next))
      return next
    })
    showToast({
      style: Toast.Style.Success,
      title: checked ? '已勾选全部清理项' : '已取消全选',
      message: checked ? `当前已选 ${formatBytes(summary.totalSizeBytes)}` : '所有项已排除'
    })
  }

  // 执行安全清理已选项目
  async function handleCleanSelected() {
    const checkedGroups = groups.filter(g => g.checked && g.totalSizeBytes > 0)
    if (checkedGroups.length === 0) {
      showToast({
        style: Toast.Style.Failure,
        title: '未勾选任何清理项目',
        message: '请至少勾选一个有效体积的垃圾项'
      })
      return
    }

    const totalCleanSize = checkedGroups.reduce((acc, cur) => acc + cur.totalSizeBytes, 0)
    const hasCautionItem = checkedGroups.some(g => g.riskLevel === 'caution')

    const confirmed = await confirmAlert({
      title: hasCautionItem ? '⚠️ 确认清理所选项目 (包含需注意项目)' : '确认开始安全垃圾清理',
      message: `即将永久删除已勾选的 ${checkedGroups.length} 类垃圾项目，预计释放磁盘空间 ${formatBytes(totalCleanSize)}。\n\n${
        hasCautionItem
          ? '注意：所选项目中包含应用临时缓存，清理后可能需要重新拉取预览图。核心个人聊天记录和浏览器凭据已受安全保护，不受影响。'
          : '所有选定项均为无害临时文件与废弃下载包，可安全放心清理。'
      }\n\n是否立即开始？`,
      primaryAction: {
        title: '立即安全清理',
        style: 'destructive'
      }
    })

    if (!confirmed) return

    showToast({
      style: Toast.Style.Animated,
      title: '正在清理垃圾文件...',
      message: `处理 ${checkedGroups.length} 项垃圾数据`
    })

    const res = await executeCleanGroups(groups)
    if (!res.ok) {
      showToast({
        style: Toast.Style.Failure,
        title: '清理遇到异常',
        message: res.error || '部分文件由于被系统进程占用未能删除'
      })
      return
    }

    showToast({
      style: Toast.Style.Success,
      title: '垃圾清理圆满完成',
      message: `成功释放磁盘空间 ${formatBytes(res.deletedSizeBytes || totalCleanSize)} (${res.deletedCount} 个文件)`
    })

    // 局部清除已删除项的体积并重新计算
    setGroups(prev => {
      const next = prev.map(g => (g.checked ? { ...g, totalSizeBytes: 0, fileCount: 0, sampleFiles: [] } : g))
      setSummary(s => ({
        ...s,
        diskFreeSizeBytes: s.diskFreeSizeBytes + totalCleanSize,
        checkedSizeBytes: 0,
        checkedFileCount: 0,
        totalSizeBytes: Math.max(0, s.totalSizeBytes - totalCleanSize),
        totalFileCount: Math.max(0, s.totalFileCount - res.deletedCount)
      }))
      return next
    })
  }

  // 一键清空回收站
  async function handleEmptyRecycleBin() {
    const confirmed = await confirmAlert({
      title: '确认清空系统回收站？',
      message: `将永久销毁回收站中的全部待删文件 (${formatBytes(summary.recycleBinSizeBytes)})，此操作无法撤销。`,
      primaryAction: {
        title: '清空回收站',
        style: 'destructive'
      }
    })

    if (!confirmed) return

    showToast({
      style: Toast.Style.Animated,
      title: '正在清空回收站...'
    })

    const res = await emptyRecycleBin()
    if (!res.ok) {
      showToast({
        style: Toast.Style.Failure,
        title: '清空回收站失败',
        message: res.error || '权限不足或文件被占用'
      })
      return
    }

    showToast({
      style: Toast.Style.Success,
      title: '回收站已清空',
      message: `成功释放物理空间 ${formatBytes(res.freedBytes || summary.recycleBinSizeBytes)}`
    })

    setSummary(s => ({
      ...s,
      recycleBinSizeBytes: 0,
      diskFreeSizeBytes: s.diskFreeSizeBytes + (res.freedBytes || s.recycleBinSizeBytes)
    }))
  }

  // 渲染右侧 Detail Markdown 垃圾全景画像
  function renderDetailMarkdown(item: CleanGroupItem): string {
    const alertBlock =
      item.riskLevel === 'safe'
        ? `> [!TIP]\n> **绿色安全项**：此目录下的文件属于完全无害的系统运行时或解压临时文件，系统自动跳过正被打开占用的活跃文件，可 100% 放心清理。`
        : item.riskLevel === 'caution'
        ? `> [!WARNING]\n> **谨慎清理提示**：清理此项目会清空群聊接收的离线图片/视频临时预览，但核心文字聊天记录受 SQLite 加密库保护，绝不丢失。`
        : `> [!NOTE]\n> **推荐深度清理**：此项包含大量已安装补丁或包管理器构建的冗余副本，清理可获得显著磁盘空间释放。`

    const sampleTable =
      item.sampleFiles && item.sampleFiles.length > 0
        ? `\n### 📑 典型占用文件样本清单\n` +
          item.sampleFiles
            .map(
              (f, i) =>
                `${i + 1}. \`${f.path.split('\\').pop() || f.path}\` · **${formatBytes(f.sizeBytes)}**\n   - \`${f.path}\``
            )
            .join('\n')
        : '\n> *暂无大文件样本或该项已被清理*'

    return `
# ${item.name}

**所属分类**: \`${item.className}\` · **清理策略**: \`${item.checked ? '已勾选纳入' : '未勾选 (已排除)'}\`

---

### 📊 空间与规则画像
- **可释放空间**: \`${formatBytes(item.totalSizeBytes)}\`
- **扫描文件数**: \`${item.fileCount.toLocaleString()} 项\`
- **安全度评级**: \`${item.riskLevel === 'safe' ? '安全无害' : item.riskLevel === 'caution' ? '谨慎确认' : '推荐清理'}\`
- **磁盘绝对路径**: \`${item.pathHint}\`

---

### 🛡️ 清理影响与安全评估
${alertBlock}

---
${sampleTable}
`
  }

  const filtered = filterCleanGroups(groups, searchText, tab)
  const systemCount = groups.filter(g => g.category === 'system').length
  const browserCount = groups.filter(g => g.category === 'browser').length
  const appCount = groups.filter(g => g.category === 'app').length
  const checkedGroupsCount = groups.filter(g => g.checked && g.totalSizeBytes > 0).length

  return List({
    searchBarPlaceholder: "搜索垃圾清理项、路径、软件或规则 (Enter 立即清理, Ctrl+K 动作面板)...",
    onSearchTextChange: setSearchText,
    isShowingDetail: true,
    isLoading,
    metricGrid: MetricGrid({
      columns: 4,
      items: [
        {
          id: 'metric-clean-space',
          label: '待释放空间',
          value: formatBytes(summary.checkedSizeBytes),
          subValue: `已选 ${checkedGroupsCount} 项`,
          progress: summary.totalSizeBytes > 0 ? Math.round((summary.checkedSizeBytes / summary.totalSizeBytes) * 100) : 0,
          status: summary.checkedSizeBytes > 2 * 1024 * 1024 * 1024 ? 'warning' : 'normal'
        },
        {
          id: 'metric-junk-files',
          label: '扫描垃圾总数',
          value: `${summary.totalFileCount.toLocaleString()} 项`,
          subValue: `共计 ${formatBytes(summary.totalSizeBytes)}`,
          status: 'normal'
        },
        {
          id: 'metric-disk-free',
          label: 'C 盘可用空间',
          value: formatBytes(summary.diskFreeSizeBytes),
          subValue: `总共 ${formatBytes(summary.diskTotalSizeBytes)}`,
          status: summary.diskFreeSizeBytes < 25 * 1024 * 1024 * 1024 ? 'warning' : 'normal'
        },
        {
          id: 'metric-recycle-bin',
          label: '回收站残留',
          value: formatBytes(summary.recycleBinSizeBytes),
          subValue: '一键安全清空',
          status: summary.recycleBinSizeBytes > 1024 * 1024 * 1024 ? 'warning' : 'normal'
        }
      ]
    }),
    segmentedControl: SegmentedControl({
      value: tab,
      onChange: (v) => setTab(v as any),
      options: [
        { value: 'all', label: '全部项目', badge: groups.length },
        { value: 'system', label: '系统与缓存', badge: systemCount },
        { value: 'browser', label: '浏览器痕迹', badge: browserCount },
        { value: 'app', label: '应用与开发', badge: appCount }
      ]
    }),
    children: [
      List.Section({
        title: `系统垃圾扫描清单 (${filtered.length}/${groups.length})`,
        children: filtered.map(item =>
          List.Item({
            id: item.id,
            title: item.name,
            subtitle: `${item.className} · ${item.description}`,
            icon: {
              source: item.checked ? Icon.Checkmark : Icon.Circle,
              tintColor: item.checked ? Color.Green : Color.SecondaryText
            },
            accessories: [
              {
                tag: {
                  value: item.checked
                    ? item.riskLevel === 'safe'
                      ? '安全释放'
                      : item.riskLevel === 'caution'
                      ? '谨慎清理'
                      : '推荐清理'
                    : '已排除',
                  color: item.checked
                    ? item.riskLevel === 'caution'
                      ? Color.Yellow
                      : Color.Green
                    : Color.SecondaryText
                }
              },
              {
                text: formatBytes(item.totalSizeBytes)
              }
            ],
            detail: List.Item.Detail({
              markdown: renderDetailMarkdown(item)
            }),
            actions: ActionPanel({
              title: item.name,
              children: [
                ActionPanel.Section({
                  title: '当前项操作',
                  children: [
                    Action({
                      title: item.checked ? '排除此项 (取消勾选)' : '纳入清理 (勾选此项)',
                      icon: item.checked ? Icon.XMarkCircle : Icon.CheckCircle,
                      shortcut: { modifiers: [], key: 'space' },
                      onAction: () => toggleCheck(item.id)
                    }),
                    Action({
                      title: '复制清理路径',
                      icon: Icon.Clipboard,
                      shortcut: { modifiers: ['ctrl'], key: 'c' },
                      onAction: () => {
                        Clipboard.copy(item.pathHint)
                        showToast({
                          style: Toast.Style.Success,
                          title: '已复制清理路径',
                          message: item.pathHint
                        })
                      }
                    })
                  ]
                }),
                ActionPanel.Section({
                  title: '全局与批处理操作',
                  children: [
                    Action({
                      title: '立即安全清理已勾选项',
                      icon: Icon.Trash,
                      shortcut: { modifiers: [], key: 'enter' },
                      onAction: () => handleCleanSelected()
                    }),
                    Action({
                      title: '重新全盘扫描垃圾',
                      icon: Icon.ArrowClockwise,
                      shortcut: { modifiers: ['ctrl'], key: 'r' },
                      onAction: () => refreshData(true)
                    }),
                    Action({
                      title: '一键清空系统回收站',
                      icon: Icon.Trash,
                      shortcut: { modifiers: ['ctrl', 'shift'], key: 'e' },
                      onAction: () => handleEmptyRecycleBin()
                    }),
                    Action({
                      title: '全选所有可清理项',
                      icon: Icon.CheckCircle,
                      shortcut: { modifiers: ['ctrl'], key: 'a' },
                      onAction: () => toggleAll(true)
                    }),
                    Action({
                      title: '取消全选所有项',
                      icon: Icon.XMarkCircle,
                      shortcut: { modifiers: ['ctrl', 'shift'], key: 'a' },
                      onAction: () => toggleAll(false)
                    })
                  ]
                })
              ]
            })
          })
        )
      })
    ]
  })
}
