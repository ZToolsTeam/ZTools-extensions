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
  CLEAN_CLASSES,
  CleanGroupItem,
  CleanSampleFile,
  CleanSummaryData,
  formatBytes,
  computeCleanSummary,
  fetchCleanRulesAndScan,
  executeCleanFiles,
  summarizeCleanResult,
  pickDefaultCheckedSamplePaths,
  emptyRecycleBin,
  filterCleanGroups
} from './logic.js'
import { isRealElectronHost, showRealItemInFolder } from './native-ipc.js'

const CLIENT_REQUIRED_TEXT = '需要在 ZTools 客户端中使用'

type SampleRow = CleanSampleFile & { groupId: string; groupName: string; className: string }

function riskLabel(level: CleanGroupItem['riskLevel']): string {
  return level === 'safe' ? '安全缓存' : level === 'caution' ? '谨慎核对' : '推荐清理'
}

export default function CleanerCommand() {
  const inRealHost = isRealElectronHost()
  const [searchText, setSearchText] = useState('')
  const [viewMode, setViewMode] = useState<'groups' | 'files'>('groups')
  const [classIdFilter, setClassIdFilter] = useState<number>(0)
  const [riskFilter, setRiskFilter] = useState<string>('all')
  const [groups, setGroups] = useState<CleanGroupItem[]>([])
  const [checkedFilePaths, setCheckedFilePaths] = useState<string[]>([])
  const [summary, setSummary] = useState<CleanSummaryData>(() => computeCleanSummary([]))
  const [isLoading, setIsLoading] = useState(inRealHost)
  const [scanError, setScanError] = useState('')

  /**
   * 重新扫描。keepSelection 为 true 时（清理之后）只保留仍然存在的已勾选文件，不再自动勾选新出现的样本；
   * 否则按默认规则勾选
   */
  async function refreshData(options: { showIndicator?: boolean; keepSelection?: boolean } = {}) {
    if (!inRealHost) return
    setIsLoading(true)
    if (options.showIndicator) {
      showToast({ style: Toast.Style.Animated, title: '正在扫描...' })
    }
    try {
      const res = await fetchCleanRulesAndScan()
      setGroups(res.groups)
      setSummary(res.summary)
      setScanError('')
      if (options.keepSelection) {
        const existing = new Set(res.groups.flatMap(g => g.sampleFiles.map(f => f.path)))
        setCheckedFilePaths(prev => prev.filter(p => existing.has(p)))
      } else {
        setCheckedFilePaths(pickDefaultCheckedSamplePaths(res.groups))
      }
      if (options.showIndicator) {
        showToast({
          style: Toast.Style.Success,
          title: '扫描完成',
          message: `${res.groups.length} 项清理规则，共占用 ${formatBytes(res.summary.totalSizeBytes)}`
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setScanError(message)
      showToast({ style: Toast.Style.Failure, title: '扫描失败', message })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    refreshData()
  }, [])

  const checkedFileSet = new Set(checkedFilePaths)
  const filtered = filterCleanGroups(groups, searchText, 'all', classIdFilter, riskFilter)
    .slice()
    .sort((a, b) => b.totalSizeBytes - a.totalSizeBytes)

  const allSampleFiles: SampleRow[] = filtered
    .flatMap(g =>
      g.sampleFiles.map(f => ({ ...f, groupId: g.id, groupName: g.name, className: g.className }))
    )
    .sort((a, b) => b.sizeBytes - a.sizeBytes)

  // 清理范围：当前筛选（分类、安全等级、搜索）下显示的规则里，用户勾选的样本文件
  const targetFiles = allSampleFiles.filter(f => checkedFileSet.has(f.path))
  const targetBytes = targetFiles.reduce((s, f) => s + f.sizeBytes, 0)

  function setPathsChecked(paths: string[], checked: boolean) {
    setCheckedFilePaths(prev => {
      const next = new Set(prev)
      for (const p of paths) {
        if (checked) next.add(p)
        else next.delete(p)
      }
      return Array.from(next)
    })
  }

  function groupCheckState(g: CleanGroupItem): boolean | 'indeterminate' {
    if (g.sampleFiles.length === 0) return false
    const n = g.sampleFiles.filter(f => checkedFileSet.has(f.path)).length
    if (n === 0) return false
    return n === g.sampleFiles.length ? true : 'indeterminate'
  }

  function toggleGroup(g: CleanGroupItem, nextChecked?: boolean) {
    const target = typeof nextChecked === 'boolean' ? nextChecked : groupCheckState(g) !== true
    setPathsChecked(g.sampleFiles.map(f => f.path), target)
  }

  async function handleCleanSelected() {
    if (targetFiles.length === 0) {
      showToast({
        style: Toast.Style.Failure,
        title: '没有勾选任何文件',
        message: '请先勾选要清理的项目或文件'
      })
      return
    }

    const breakdownLines = filtered
      .map(g => {
        const inGroup = targetFiles.filter(f => f.groupId === g.id)
        if (inGroup.length === 0) return ''
        const bytes = inGroup.reduce((s, f) => s + f.sizeBytes, 0)
        return `- ${g.name}：${inGroup.length} 个（${formatBytes(bytes)}）`
      })
      .filter(Boolean)
      .join('\n')
    const hasCaution = filtered.some(
      g => g.riskLevel === 'caution' && targetFiles.some(f => f.groupId === g.id)
    )

    const confirmed = await confirmAlert({
      title: `把 ${targetFiles.length} 个文件移入回收站？`,
      message: `共 ${formatBytes(targetBytes)}\n\n${breakdownLines}\n\n${
        hasCaution ? '其中包含需要核对的项目（备份或下载的文件），请确认不再需要。\n' : ''
      }只处理列出的样本文件，不会清空整个文件夹。文件移入回收站后仍占用磁盘空间，清空回收站后才会释放。`,
      primaryAction: { title: '移入回收站', style: 'destructive' }
    })
    if (!confirmed) return

    const res = await executeCleanFiles(
      targetFiles.map(f => f.path),
      targetFiles
    )
    const toast = summarizeCleanResult(res)
    showToast({
      style: toast.success ? Toast.Style.Success : Toast.Style.Failure,
      title: toast.title,
      message: toast.message
    })
    if (res.deletedCount > 0) {
      await refreshData({ keepSelection: true })
    }
  }

  async function handleEmptyRecycleBin() {
    const confirmed = await confirmAlert({
      title: '清空系统回收站？',
      message: '将永久删除回收站里的全部文件（包括以前删除的其它文件），此操作不能撤销。',
      primaryAction: { title: '清空回收站', style: 'destructive' }
    })
    if (!confirmed) return

    const res = await emptyRecycleBin()
    if (!res.ok) {
      showToast({ style: Toast.Style.Failure, title: '清空回收站失败', message: res.error })
      return
    }
    showToast({
      style: Toast.Style.Success,
      title: '回收站已清空',
      message: res.message || (typeof res.removedCount === 'number' ? `共 ${res.removedCount} 项` : undefined)
    })
    await refreshData({ keepSelection: true })
  }

  async function locate(path: string) {
    const ok = await showRealItemInFolder(path)
    if (!ok) showToast({ style: Toast.Style.Failure, title: '无法在资源管理器中定位', message: path })
  }

  if (!inRealHost) {
    return List({
      searchBarPlaceholder: '搜索清理项',
      children: [
        List.Item({
          id: 'cleaner-client-required',
          title: CLIENT_REQUIRED_TEXT,
          subtitle: '本插件扫描本机的临时文件与缓存目录，只能在 Windows 版 ZTools 客户端中运行',
          icon: { source: Icon.Info }
        })
      ]
    })
  }

  const cleanActionTitle = `清理已勾选的 ${targetFiles.length} 个文件 (${formatBytes(targetBytes)})`
  const maxGroupBytes = Math.max(1, filtered[0]?.totalSizeBytes || 1)
  const maxSampleFileBytes = Math.max(1, allSampleFiles[0]?.sizeBytes || 1)

  const rightSubListItems =
    viewMode === 'files'
      ? allSampleFiles.map(file => {
          const fileName = file.path.split(/[\\/]/).pop() || file.path
          const volRatio = Math.max(8, Math.min(100, Math.round((file.sizeBytes / maxSampleFileBytes) * 100)))
          const isChecked = checkedFileSet.has(file.path)
          return List.Item({
            id: `sample-file-${file.path}`,
            title: fileName,
            subtitle: `${file.groupName} · ${file.path}`,
            checkable: true,
            checked: isChecked,
            onCheckChange: c => setPathsChecked([file.path], c),
            onToggleCheck: c => setPathsChecked([file.path], c),
            icon: { source: Icon.Document },
            accessories: [
              { progress: { value: volRatio } },
              { tag: { value: file.className } },
              { text: formatBytes(file.sizeBytes) }
            ],
            actions: ActionPanel({
              title: fileName,
              children: [
                Action({
                  title: cleanActionTitle,
                  icon: Icon.Trash,
                  style: Action.Style.Destructive,
                  onAction: () => handleCleanSelected()
                }),
                Action({
                  title: '在资源管理器定位',
                  icon: Icon.Folder,
                  onAction: () => locate(file.path)
                }),
                Action({
                  title: isChecked ? '取消勾选此文件' : '勾选此文件',
                  icon: Icon.Checkmark,
                  onAction: () => setPathsChecked([file.path], !isChecked)
                }),
                Action.CopyToClipboard({
                  title: '复制文件完整路径',
                  content: file.path
                })
              ]
            })
          })
        })
      : filtered.map(item => {
          const volRatio = Math.max(10, Math.min(100, Math.round((item.totalSizeBytes / maxGroupBytes) * 100)))
          const state = groupCheckState(item)
          const sampleBytes = item.sampleFiles.reduce((s, f) => s + f.sizeBytes, 0)
          const locatePath = item.sampleFiles[0]?.path || item.dirs?.[0] || ''
          const sampleText =
            item.sampleFiles.length > 0
              ? `可清理最大的 ${item.sampleFiles.length} 个 (${formatBytes(sampleBytes)})`
              : '没有可清理的文件'

          return List.Item({
            id: item.id,
            title: item.name,
            subtitle: `共 ${item.fileCount.toLocaleString()} 个文件 · ${sampleText} · ${item.pathHint}`,
            checkable: !item.isProtected && item.sampleFiles.length > 0,
            checked: state,
            onCheckChange: c => toggleGroup(item, c),
            onToggleCheck: c => toggleGroup(item, c),
            icon: { source: item.isProtected ? Icon.Lock : Icon.Trash },
            accessories: [
              { progress: { value: volRatio } },
              { tag: { value: riskLabel(item.riskLevel) } },
              { text: formatBytes(item.totalSizeBytes) }
            ],
            actions: ActionPanel({
              title: item.name,
              children: [
                Action({
                  title: cleanActionTitle,
                  icon: Icon.Trash,
                  style: Action.Style.Destructive,
                  onAction: () => handleCleanSelected()
                }),
                ...(locatePath
                  ? [
                      Action({
                        title: '在资源管理器定位',
                        icon: Icon.Folder,
                        onAction: () => locate(locatePath)
                      })
                    ]
                  : []),
                ...(item.sampleFiles.length > 0
                  ? [
                      Action({
                        title: state === true ? '取消勾选此项' : '勾选此项',
                        icon: Icon.Checkmark,
                        onAction: () => toggleGroup(item, state !== true)
                      })
                    ]
                  : []),
                Action({
                  title: '查看样本文件明细',
                  icon: Icon.Document,
                  onAction: () => setViewMode('files')
                }),
                Action({
                  title: '清空系统回收站',
                  icon: Icon.Trash,
                  onAction: () => handleEmptyRecycleBin()
                }),
                Action.CopyToClipboard({
                  title: '复制扫描路径',
                  content: item.pathHint
                })
              ]
            })
          })
        })

  const activeClassMeta = CLEAN_CLASSES.find(c => c.classId === classIdFilter)
  const rightTitle =
    viewMode === 'files'
      ? '样本文件明细（按体积降序）'
      : activeClassMeta
      ? `${activeClassMeta.name}（按体积降序）`
      : '全部清理项（按体积降序）'

  const checkableGroups = filtered.filter(g => g.sampleFiles.length > 0)
  const scopePaths = allSampleFiles.map(f => f.path)
  const allScopeChecked = scopePaths.length > 0 && targetFiles.length === scopePaths.length
  const someScopeChecked = targetFiles.length > 0 && !allScopeChecked
  const diskText = summary.diskTotalSizeBytes > 0 ? ` · C 盘可用 ${formatBytes(summary.diskFreeSizeBytes)}` : ''

  return List({
    searchBarPlaceholder: '搜索清理项、路径或说明',
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    isLoading,
    searchBarAccessory: List.Dropdown({
      tooltip: '按安全等级筛选',
      value: riskFilter,
      onChange: val => setRiskFilter(val),
      children: [
        List.Dropdown.Item({ title: `全部安全等级 (${groups.length})`, value: 'all' }),
        List.Dropdown.Item({
          title: `安全缓存 (${groups.filter(g => g.riskLevel === 'safe').length})`,
          value: 'safe'
        }),
        List.Dropdown.Item({
          title: `推荐清理 (${groups.filter(g => g.riskLevel === 'recommended').length})`,
          value: 'recommended'
        }),
        List.Dropdown.Item({
          title: `谨慎核对 (${groups.filter(g => g.riskLevel === 'caution').length})`,
          value: 'caution'
        })
      ]
    }),
    filterBar: {
      summaryText: scanError
        ? `扫描失败：${scanError}`
        : `共占用 ${formatBytes(summary.totalSizeBytes)} · 已勾选 ${targetFiles.length} 个文件 (${formatBytes(targetBytes)})${diskText}`,
      actions: [
        {
          id: 'rescan',
          label: '重新扫描',
          title: '重新扫描',
          style: 'secondary',
          onAction: () => refreshData({ showIndicator: true })
        }
      ]
    },
    subList: {
      title: rightTitle,
      subtitle:
        viewMode === 'files'
          ? `${allSampleFiles.length} 个样本文件 · 已勾选 ${targetFiles.length} 个 (${formatBytes(targetBytes)})`
          : `${filtered.length} 项 · 已勾选 ${targetFiles.length} 个文件 (${formatBytes(targetBytes)})`,
      checkable: viewMode === 'files' ? allSampleFiles.length > 0 : checkableGroups.length > 0,
      checked: allScopeChecked ? true : someScopeChecked ? 'indeterminate' : false,
      onCheckChange: () => setPathsChecked(scopePaths, !allScopeChecked),
      emptyText: isLoading
        ? '正在扫描...'
        : viewMode === 'files'
        ? '当前范围内没有样本文件'
        : '当前范围内没有匹配的清理项',
      items: rightSubListItems
    },
    children: [
      List.Section({
        title: '汇总',
        children: [
          List.Item({
            id: 'nav-clean-all',
            title: '全部清理项',
            subtitle: `${groups.length} 项规则 · 共 ${formatBytes(summary.totalSizeBytes)}`,
            icon: { source: Icon.HardDrive },
            accessories: [{ text: formatBytes(summary.totalSizeBytes) }],
            onSelect: () => {
              setClassIdFilter(0)
              setViewMode('groups')
            }
          }),
          List.Item({
            id: 'nav-clean-files',
            title: '样本文件明细',
            subtitle: `${allSampleFiles.length} 个样本文件，可逐个勾选`,
            icon: { source: Icon.Document },
            accessories: [{ text: `${allSampleFiles.length} 项` }],
            onSelect: () => setViewMode('files')
          })
        ]
      }),
      List.Section({
        title: '清理分类',
        children: CLEAN_CLASSES.map(cls => {
          const clsGroups = groups.filter(g => g.classId === cls.classId)
          const clsBytes = clsGroups.reduce((s, g) => s + g.totalSizeBytes, 0)
          return List.Item({
            id: `nav-clean-class-${cls.classId}`,
            title: cls.name,
            subtitle: `${clsGroups.length} 项规则`,
            icon: { source: Icon.Folder },
            accessories: [{ text: formatBytes(clsBytes) }],
            onSelect: () => {
              setClassIdFilter(cls.classId)
              setViewMode('groups')
            }
          })
        })
      })
    ]
  })
}
