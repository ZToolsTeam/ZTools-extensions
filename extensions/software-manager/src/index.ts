/**
 * 软件卸载（布局二：左侧分类 + 右侧软件明细）
 *
 * - 右侧列出系统登记的已安装软件，按登记的占用体积降序；Enter 确认后启动软件自带的卸载程序
 * - 左侧「AppData 目录」只读列出目录占用，可定位或复制路径，不提供删除
 * - 读不到数据时在状态条与空列表中如实显示原因，不显示示例数据
 */

import {
  List,
  ActionPanel,
  Action,
  Icon,
  useState,
  useEffect,
  showToast,
  Toast,
  confirmAlert
} from '@ztools/declarative-ui'
import {
  type SoftwareItem,
  type AppDataDirItem,
  SOFTWARE_SMART_CATEGORIES,
  NOT_IN_CLIENT_MESSAGE,
  PROTECTED_SYSTEM_SOFTWARE_PATTERN,
  FORBIDDEN_SOFTWARE_PATTERN,
  FORBIDDEN_UNINSTALL_REASON,
  formatBytes,
  formatInstallDate,
  fetchSoftwareList,
  summarizeSoftware,
  probeAppDataDirs,
  uninstallSoftware,
  openSoftwareLocation,
  launchSoftware,
  filterSoftwareList
} from './logic.js'

import { isRealElectronHost } from './native-ipc.js'

export default function SoftwareManagerCommand() {
  const inRealHost = isRealElectronHost()
  const [searchText, setSearchText] = useState('')
  const [viewMode, setViewMode] = useState<'all' | 'appdata'>('all')
  const [smartCatFilter, setSmartCatFilter] = useState<string>('all')
  const [driveFilter, setDriveFilter] = useState<string>('all')
  const [softwareList, setSoftwareList] = useState<SoftwareItem[]>([])
  const [listError, setListError] = useState<string>(inRealHost ? '' : NOT_IN_CLIENT_MESSAGE)
  const [appDataDirs, setAppDataDirs] = useState<AppDataDirItem[]>([])
  const [appDataError, setAppDataError] = useState<string>(inRealHost ? '' : NOT_IN_CLIENT_MESSAGE)
  const [isLoading, setIsLoading] = useState(inRealHost)

  async function refreshData(forceRefresh = false) {
    setIsLoading(true)
    try {
      const list = await fetchSoftwareList(undefined, forceRefresh)
      setSoftwareList(list.items)
      setListError(list.ok ? '' : list.error || '读取已安装软件失败')
      const dirs = await probeAppDataDirs(list.items)
      setAppDataDirs(dirs.items)
      setAppDataError(dirs.ok ? '' : dirs.error || '扫描 AppData 失败')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void refreshData(false)
  }, [])

  async function handleUninstall(item: SoftwareItem) {
    if (FORBIDDEN_SOFTWARE_PATTERN.test(item.name)) {
      showToast({ style: Toast.Style.Failure, title: '不能卸载', message: `${item.name}：${FORBIDDEN_UNINSTALL_REASON}` })
      return
    }
    if (!item.uninstallString) {
      showToast({ style: Toast.Style.Failure, title: '没有卸载程序', message: `系统登记里没有 ${item.name} 的卸载程序` })
      return
    }

    const isProtected = PROTECTED_SYSTEM_SOFTWARE_PATTERN.test(item.name) || item.isSystem
    const confirmed = await confirmAlert({
      title: isProtected ? `卸载系统运行库「${item.name}」？` : `卸载「${item.name}」？`,
      message: [
        isProtected ? '这是系统运行库，卸载后依赖它的软件可能无法启动。' : '',
        `将启动软件自带的卸载程序：\n${item.uninstallString}`,
        '是否卸载完成以卸载向导为准。'
      ]
        .filter(Boolean)
        .join('\n\n'),
      primaryAction: {
        title: '启动卸载程序',
        style: 'destructive'
      }
    })
    if (!confirmed) return

    const res = await uninstallSoftware(item)
    if (!res.ok) {
      showToast({ style: Toast.Style.Failure, title: '启动卸载程序失败', message: res.error })
      return
    }
    showToast({ style: Toast.Style.Success, title: '卸载程序已启动', message: `${item.name}，请在卸载向导中继续` })
  }

  async function handleLocate(path: string) {
    const ok = await openSoftwareLocation(path)
    if (!ok) showToast({ style: Toast.Style.Failure, title: '无法在资源管理器中定位', message: path })
  }

  async function handleLaunch(item: SoftwareItem) {
    const ok = await launchSoftware(item.launchPath || '')
    if (!ok) showToast({ style: Toast.Style.Failure, title: '启动失败', message: item.launchPath })
  }

  const filtered = filterSoftwareList(softwareList, searchText, smartCatFilter, driveFilter)
  const summary = summarizeSoftware(softwareList)
  const filteredSummary = summarizeSoftware(filtered)
  const keyword = searchText.trim().toLowerCase()
  const visibleDirs = keyword
    ? appDataDirs.filter((d) => `${d.folderName} ${d.fullPath}`.toLowerCase().includes(keyword))
    : appDataDirs
  const appDataTotalBytes = appDataDirs.reduce((s, d) => s + d.sizeBytes, 0)
  const maxSwBytes = Math.max(1, ...filtered.map((s) => s.estimatedSize || 0))
  const maxDirBytes = Math.max(1, ...appDataDirs.map((d) => d.sizeBytes))

  const rightSubListItems =
    viewMode === 'appdata'
      ? visibleDirs.map((dir) =>
          List.Item({
            id: dir.id,
            title: dir.folderName,
            subtitle: `${dir.scope} · ${dir.fileCount} 个文件 · ${dir.fullPath}`,
            icon: { source: Icon.Folder },
            accessories: [
              { progress: Math.min(1, dir.sizeBytes / maxDirBytes) },
              { tag: { value: dir.similarSoftwareName ? `名称相近：${dir.similarSoftwareName}` : '未匹配到已安装软件' } },
              { text: formatBytes(dir.sizeBytes) }
            ],
            actions: ActionPanel({
              title: dir.folderName,
              children: [
                Action({
                  title: '在资源管理器中定位',
                  icon: Icon.Folder,
                  onAction: () => handleLocate(dir.fullPath)
                }),
                Action.CopyToClipboard({
                  title: '复制目录路径',
                  content: dir.fullPath
                })
              ]
            })
          })
        )
      : filtered.map((item) => {
          const isForbidden = FORBIDDEN_SOFTWARE_PATTERN.test(item.name)
          const isProtected = Boolean(item.isSystem) || PROTECTED_SYSTEM_SOFTWARE_PATTERN.test(item.name)
          const meta = [
            item.publisher || '未知发布商',
            item.version ? `v${item.version}` : '未知版本',
            item.installDrive || '安装位置未知',
            ...(item.installDate ? [`安装于 ${formatInstallDate(item.installDate)}`] : [])
          ]
          return List.Item({
            id: item.id,
            title: item.name,
            subtitle: meta.join(' · '),
            icon: { source: isProtected || isForbidden ? Icon.Lock : Icon.AppWindow },
            accessories: [
              { progress: Math.min(1, (item.estimatedSize || 0) / maxSwBytes) },
              { tag: { value: isForbidden ? '系统组件' : isProtected ? '系统运行库' : item.smartCategoryName || '其他' } },
              { text: item.estimatedSize > 0 ? formatBytes(item.estimatedSize) : '体积未知' }
            ],
            actions: ActionPanel({
              title: item.name,
              children: [
                ...(!isForbidden && item.uninstallString
                  ? [
                      Action({
                        title: '卸载',
                        icon: Icon.Trash,
                        style: Action.Style.Destructive,
                        onAction: () => handleUninstall(item)
                      })
                    ]
                  : []),
                ...(item.installLocation
                  ? [
                      Action({
                        title: '在资源管理器中定位安装目录',
                        icon: Icon.Folder,
                        onAction: () => handleLocate(item.installLocation)
                      })
                    ]
                  : []),
                ...(item.launchPath
                  ? [
                      Action({
                        title: '启动该软件',
                        icon: Icon.Play,
                        onAction: () => handleLaunch(item)
                      })
                    ]
                  : []),
                ...(item.uninstallString
                  ? [
                      Action.CopyToClipboard({
                        title: '复制卸载命令行',
                        content: item.uninstallString
                      })
                    ]
                  : [])
              ]
            })
          })
        })

  const summaryText =
    viewMode === 'appdata'
      ? appDataError ||
        `AppData 目录 ${appDataDirs.length} 个 (${formatBytes(appDataTotalBytes)}) · 只读列出，请在资源管理器中自行核对和清理`
      : listError ||
        `已安装 ${summary.totalCount} 款 · 登记占用合计 ${formatBytes(summary.totalSizeBytes)}${
          summary.unknownSizeCount > 0 ? `（${summary.unknownSizeCount} 款未登记体积）` : ''
        } · 当前显示 ${filtered.length} 款 (${formatBytes(filteredSummary.totalSizeBytes)})`

  const emptyText =
    viewMode === 'appdata'
      ? appDataError || (isLoading ? '正在扫描...' : '没有找到占用超过 64 KB 的 AppData 目录')
      : listError || (isLoading ? '正在读取...' : softwareList.length === 0 ? '系统登记的已安装软件清单为空' : '当前分类或盘符下没有软件')

  return List({
    searchBarPlaceholder:
      viewMode === 'appdata' ? '搜索目录名或路径...' : '搜索软件名称、发布商、版本或安装路径...',
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    isLoading,
    searchBarAccessory: List.Dropdown({
      tooltip: '按安装盘符筛选',
      value: driveFilter,
      onChange: (val) => setDriveFilter(val),
      children: [
        List.Dropdown.Item({ title: `全部盘符 (${softwareList.length})`, value: 'all' }),
        List.Dropdown.Item({
          title: `C: (${softwareList.filter((s) => s.installDrive === 'C:').length})`,
          value: 'C:'
        }),
        List.Dropdown.Item({
          title: `D: (${softwareList.filter((s) => s.installDrive === 'D:').length})`,
          value: 'D:'
        }),
        List.Dropdown.Item({
          title: `其他或未知 (${softwareList.filter((s) => s.installDrive !== 'C:' && s.installDrive !== 'D:').length})`,
          value: 'OTHER'
        })
      ]
    }),
    filterBar: {
      summaryText,
      actions: [
        {
          id: 'rescan-all',
          title: '重新扫描',
          style: 'secondary',
          onAction: () => refreshData(true)
        }
      ]
    },
    subList: {
      title: viewMode === 'appdata' ? 'AppData 目录（按占用降序，只读）' : '已安装软件（按登记的占用体积降序）',
      subtitle: viewMode === 'appdata' ? `${visibleDirs.length} 个目录` : `${filtered.length} 款`,
      emptyText,
      items: rightSubListItems
    },
    children: [
      List.Section({
        title: '总览',
        children: [
          List.Item({
            id: 'sw-nav-all',
            title: '全部已安装软件',
            subtitle: `${summary.totalCount} 款`,
            icon: { source: Icon.AppWindow },
            accessories: [{ text: formatBytes(summary.totalSizeBytes) }],
            onSelect: () => {
              setViewMode('all')
              setSmartCatFilter('all')
            }
          }),
          List.Item({
            id: 'sw-nav-appdata',
            title: 'AppData 目录',
            subtitle: `${appDataDirs.length} 个目录 · 只读`,
            icon: { source: Icon.Folder },
            accessories: [{ text: formatBytes(appDataTotalBytes) }],
            onSelect: () => {
              setViewMode('appdata')
            }
          })
        ]
      }),
      List.Section({
        title: '按名称分类',
        children: SOFTWARE_SMART_CATEGORIES.map((cat) => {
          const catItems = softwareList.filter((s) => s.smartCategory === cat.id)
          const catBytes = catItems.reduce((acc, s) => acc + (s.estimatedSize || 0), 0)
          return List.Item({
            id: `sw-nav-cat-${cat.id}`,
            title: cat.name,
            subtitle: `${catItems.length} 款`,
            icon: { source: cat.id === 'runtime_system' ? Icon.Lock : Icon.Folder },
            accessories: [{ text: formatBytes(catBytes) }],
            onSelect: () => {
              setViewMode('all')
              setSmartCatFilter(cat.id)
            }
          })
        })
      })
    ]
  })
}
