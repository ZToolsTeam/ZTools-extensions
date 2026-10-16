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
  DLL_PLUGIN_NAME,
  SoftwareItem,
  SoftwareSummaryData,
  PROTECTED_SYSTEM_SOFTWARE_PATTERN,
  FORBIDDEN_SOFTWARE_PATTERN,
  FORBIDDEN_UNINSTALL_REASON,
  formatBytes,
  getMockSoftwareList,
  getMockSoftwareSummary,
  fetchSoftwareList,
  fetchSoftwareSummary,
  uninstallSoftware,
  openSoftwareLocation,
  launchSoftware,
  filterSoftwareList
} from './logic'

import { isRealElectronHost } from '../../shared/native-ipc'

export default function SoftwareManagerCommand() {
  const inRealHost = isRealElectronHost()
  const [searchText, setSearchText] = useState('')
  const [tab, setTab] = useState<'all' | 'desktop' | 'store' | 'runtime'>('all')
  const [softwareList, setSoftwareList] = useState<SoftwareItem[]>(inRealHost ? [] : getMockSoftwareList())
  const [summary, setSummary] = useState<SoftwareSummaryData>(
    inRealHost
      ? { totalCount: 0, totalSizeBytes: 0, recentInstalledCount: 0, silentSupportedCount: 0 }
      : getMockSoftwareSummary()
  )
  const [isLoading, setIsLoading] = useState(inRealHost)

  // 刷新全量数据
  async function refreshData(showIndicator = false, forceRefresh = false) {
    if (showIndicator) setIsLoading(true)
    try {
      const list = await fetchSoftwareList(undefined, forceRefresh)
      if (list && list.length > 0) {
        setSoftwareList(list)
      }
      const sum = await fetchSoftwareSummary(undefined, list)
      if (sum) setSummary(sum)
    } catch (err) {
      console.error('[SoftwareManager] refreshData error:', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    console.log('[SoftwareManager] useEffect triggered!')
    refreshData(false, false)
  }, [])

  // 处理标准交互卸载
  async function handleUninstall(item: SoftwareItem, isQuiet = false) {
    if (FORBIDDEN_SOFTWARE_PATTERN.test(item.name)) {
      await confirmAlert({
        title: '⚠️ 无法卸载核心系统组件',
        message: `${item.name}\n\n${FORBIDDEN_UNINSTALL_REASON}`,
        primaryAction: {
          title: '我知道了',
          style: 'default'
        }
      })
      return
    }

    const isProtected = PROTECTED_SYSTEM_SOFTWARE_PATTERN.test(item.name) || item.isSystem
    const confirmed = await confirmAlert({
      title: isProtected ? `⚠️ 高危警示：卸载系统运行库 [${item.name}]` : `确认卸载 [${item.name}]`,
      message: isProtected
        ? `软件 [${item.name}] 是 Windows 基础运行环境。许多桌面应用依赖其运行。卸载可能导致依赖它的应用无法启动或报错崩溃！\n\n确定依然执行卸载？`
        : `将调用原生卸载程序移除 [${item.name}] (版本: ${item.version})。\n${isQuiet ? '注意：将尝试使用静默无弹窗参数执行卸载。' : ''}`,
      primaryAction: {
        title: isQuiet ? '静默卸载' : '开始卸载',
        style: 'destructive'
      }
    })

    if (!confirmed) return

    showToast({
      style: Toast.Style.Animated,
      title: `正在启动卸载: ${item.name}`,
      message: isQuiet ? '静默后台执行中' : '请在弹出的系统卸载向导中确认'
    })

    const res = await uninstallSoftware(item, isQuiet)
    if (!res.ok) {
      showToast({
        style: Toast.Style.Failure,
        title: '卸载未完成',
        message: res.error || '用户取消或权限不足'
      })
      return
    }

    showToast({
      style: Toast.Style.Success,
      title: '卸载程序已启动',
      message: item.name
    })

    // 卸载后更新列表并拉取最新状态
    setTimeout(() => {
      refreshData(false)
    }, 2000)
  }

  // 渲染右侧 Detail Markdown 软件全景画像
  function renderDetailMarkdown(item: SoftwareItem): string {
    const isProtected = PROTECTED_SYSTEM_SOFTWARE_PATTERN.test(item.name) || item.isSystem

    const safetyCard = isProtected
      ? `> [!CAUTION]\n> **底层运行库依赖**：该软件是系统关键运行时或图形框架，许多第三方软件强依赖此库，请谨慎卸载！`
      : item.category === 'store'
      ? `> [!NOTE]\n> **应用商店应用**：通过 Windows Store 沙箱打包部署，卸载将清理应用缓存目录。`
      : `> [!TIP]\n> **普通桌面应用程序**：标准 Win32 应用程序，卸载程序将清理主安装目录并注销开始菜单快捷方式。`

    const quietSupportText = item.quietUninstallString
      ? '✅ 原生支持静默无干扰卸载 (`' + item.quietUninstallString + '`)'
      : '⚠️ 仅支持标准交互式向导卸载'

    const usageBlock = item.launchCount !== undefined
      ? `- **历史启动次数**: \`${item.launchCount} 次\`\n- **最近使用活跃**: \`${item.lastUsedTime ? new Date(item.lastUsedTime).toLocaleString() : '长期未活跃'}\``
      : `- **使用状态**: \`系统组件 / 未记录独立启动频率\``

    return `
# ${item.name}

**当前版本**: \`${item.version || '未知版本'}\` · **发布商**: \`${item.publisher || '未签名/未知开发商'}\`

---

### 📊 空间占用与性能画像
- **估算磁盘占用**: \`${formatBytes(item.estimatedSize)}\`
- **安装绝对路径**: \`${item.installLocation || '未提供独立目录或注册表省略'}\`
- **安装变更日期**: \`${item.installDate || '未知'}\`
${usageBlock}

---

### ⚙️ 卸载命令行信息
- **标准卸载指令**: \`${item.uninstallString || '无可用卸载命令行'}\`
- **静默卸载支持**: ${quietSupportText}

---

### 🛡️ 安全合规与管控建议
${safetyCard}
`
  }

  const filtered = filterSoftwareList(softwareList, searchText, tab)
  const desktopCount = softwareList.filter(s => s.category === 'desktop').length
  const storeCount = softwareList.filter(s => s.category === 'store').length
  const runtimeCount = softwareList.filter(s => s.category === 'runtime' || s.isSystem).length

  return List({
    searchBarPlaceholder: "搜索软件名称、发布商、版本或路径 (大体积应用深度清理)...",
    onSearchTextChange: setSearchText,
    isShowingDetail: true,
    isLoading,
    metricGrid: MetricGrid({
      columns: 4,
      items: [
        {
          id: 'metric-total',
          label: '已装软件总数',
          value: `${softwareList.length} 款`,
          subValue: `已筛选 ${filtered.length} 款`,
          status: 'normal'
        },
        {
          id: 'metric-space',
          label: '占用磁盘空间',
          value: formatBytes(summary.totalSizeBytes),
          subValue: '大文件优先展示',
          progress: Math.min(100, Math.round((summary.totalSizeBytes / (256 * 1024 * 1024 * 1024)) * 100)),
          status: summary.totalSizeBytes > 100 * 1024 * 1024 * 1024 ? 'warning' : 'normal'
        },
        {
          id: 'metric-recent',
          label: '近期 30 天新装',
          value: `${summary.recentInstalledCount} 款`,
          subValue: '系统环境变更',
          status: 'normal'
        },
        {
          id: 'metric-silent',
          label: '支持静默卸载',
          value: `${summary.silentSupportedCount} 款`,
          subValue: '一键后台静默',
          status: 'success'
        }
      ]
    }),
    segmentedControl: SegmentedControl({
      value: tab,
      onChange: (v) => setTab(v as any),
      options: [
        { value: 'all', label: '全部软件', badge: softwareList.length },
        { value: 'desktop', label: '桌面应用', badge: desktopCount },
        { value: 'store', label: '应用商店', badge: storeCount },
        { value: 'runtime', label: '运行库依赖', badge: runtimeCount }
      ]
    }),
    children: [
      List.Section({
        title: `已安装软件清单 (${filtered.length}/${softwareList.length})`,
        children: filtered.map(item =>
          List.Item({
            id: item.id,
            title: item.name,
            subtitle: `${item.publisher || '未知开发商'} · v${item.version || '1.0'}`,
            icon: {
              source: item.isSystem ? Icon.Gear : item.category === 'store' ? Icon.Globe : Icon.Window,
              tintColor: item.isSystem ? Color.SecondaryText : Color.Blue
            },
            accessories: [
              {
                tag: {
                  value: item.isSystem ? '运行库' : item.category === 'store' ? '应用商店' : '桌面应用',
                  color: item.isSystem ? Color.SecondaryText : item.category === 'store' ? Color.Purple : Color.Blue
                }
              },
              {
                text: formatBytes(item.estimatedSize)
              }
            ],
            detail: List.Item.Detail({
              markdown: renderDetailMarkdown(item)
            }),
            actions: ActionPanel({
              title: item.name,
              children: [
                ActionPanel.Section({
                  title: '当前软件操作',
                  children: [
                    Action({
                      title: '执行标准卸载',
                      icon: Icon.Trash,
                      shortcut: { modifiers: [], key: 'enter' },
                      onAction: () => handleUninstall(item, false)
                    }),
                    ...(item.quietUninstallString ? [
                      Action({
                        title: '执行静默后台卸载',
                        icon: Icon.Bolt,
                        shortcut: { modifiers: ['ctrl', 'shift'], key: 'u' },
                        onAction: () => handleUninstall(item, true)
                      })
                    ] : []),
                    ...(item.installLocation ? [
                      Action({
                        title: '在资源管理器中打开安装目录',
                        icon: Icon.Folder,
                        shortcut: { modifiers: ['ctrl'], key: 'o' },
                        onAction: async () => {
                          const ok = await openSoftwareLocation(item.installLocation)
                          if (!ok) {
                            showToast({ style: Toast.Style.Failure, title: '打开失败', message: item.installLocation })
                          }
                        }
                      })
                    ] : []),
                    ...(item.launchPath ? [
                      Action({
                        title: '启动该软件',
                        icon: Icon.Play,
                        shortcut: { modifiers: ['ctrl'], key: 'p' },
                        onAction: async () => {
                          const ok = await launchSoftware(item.launchPath!)
                          if (!ok) {
                            showToast({ style: Toast.Style.Failure, title: '启动失败', message: item.launchPath })
                          }
                        }
                      })
                    ] : []),
                    Action({
                      title: '复制软件名称与版本',
                      icon: Icon.Clipboard,
                      shortcut: { modifiers: ['ctrl'], key: 'c' },
                      onAction: () => {
                        Clipboard.copy(`${item.name} v${item.version}`)
                        showToast({ style: Toast.Style.Success, title: '已复制到剪贴板' })
                      }
                    }),
                    Action({
                      title: '复制完整卸载命令行',
                      icon: Icon.Terminal,
                      shortcut: { modifiers: ['ctrl', 'shift'], key: 'c' },
                      onAction: () => {
                        Clipboard.copy(item.quietUninstallString || item.uninstallString || '')
                        showToast({ style: Toast.Style.Success, title: '卸载命令已复制' })
                      }
                    })
                  ]
                }),
                ActionPanel.Section({
                  title: '全局管理操作',
                  children: [
                    Action({
                      title: '重新扫描已安装软件',
                      icon: Icon.ArrowClockwise,
                      shortcut: { modifiers: ['ctrl'], key: 'r' },
                      onAction: () => refreshData(true, true)
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
