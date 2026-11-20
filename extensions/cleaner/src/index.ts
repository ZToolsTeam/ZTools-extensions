import {
  List,
  ActionPanel,
  Action,
  Icon,
  useState,
  useEffect,
  showToast,
  Toast,
  confirmAlert,
  useLocale
} from '@ztools/declarative-ui'
import { t } from './i18n.js'
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
  filterCleanGroups,
  getCleanClasses
} from './logic.js'
import { isRealElectronHost, showRealItemInFolder } from './native-ipc.js'

const CLIENT_REQUIRED_TEXT = t('notInClient')

type SampleRow = CleanSampleFile & { groupId: string; groupName: string; className: string }

function riskLabel(level: CleanGroupItem['riskLevel']): string {
  return level === 'safe' ? t('riskSafe') : level === 'caution' ? t('riskCaution') : t('riskRecommended')
}

export default function CleanerCommand() {
  useLocale()
  const cleanClasses = getCleanClasses()
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
      showToast({ style: Toast.Style.Animated, title: t('scanningTitle') })
    }
    try {
      const res = await fetchCleanRulesAndScan()
      setGroups(res.groups)
      setSummary(res.summary)
      setScanError(res.error || '')
      if (options.keepSelection) {
        const existing = new Set(res.groups.flatMap(g => g.sampleFiles.map(f => f.path)))
        setCheckedFilePaths(prev => prev.filter(p => existing.has(p)))
      } else {
        setCheckedFilePaths(pickDefaultCheckedSamplePaths(res.groups))
      }
      if (res.error) {
        showToast({ style: Toast.Style.Failure, title: t('scanIncompleteTitle'), message: res.error })
      } else if (options.showIndicator) {
        showToast({
          style: Toast.Style.Success,
          title: t('scanOkTitle'),
          message: t('scanOkMsg', { count: res.groups.length, size: formatBytes(res.summary.totalSizeBytes) })
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setScanError(message)
      showToast({ style: Toast.Style.Failure, title: t('scanFailedTitle'), message })
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
        title: t('errNoCheckedFiles'),
        message: t('noCheckedHint')
      })
      return
    }

    const breakdownLines = filtered
      .map(g => {
        const inGroup = targetFiles.filter(f => f.groupId === g.id)
        if (inGroup.length === 0) return ''
        const bytes = inGroup.reduce((s, f) => s + f.sizeBytes, 0)
        return t('confirmCleanBreakdown', { name: g.name, count: inGroup.length, size: formatBytes(bytes) })
      })
      .filter(Boolean)
      .join('\n')
    const hasCaution = filtered.some(
      g => g.riskLevel === 'caution' && targetFiles.some(f => f.groupId === g.id)
    )

    const confirmed = await confirmAlert({
      title: t('confirmCleanTitle', { count: targetFiles.length }),
      message: t('confirmCleanMsg', {
        size: formatBytes(targetBytes),
        breakdown: breakdownLines,
        caution: hasCaution ? t('confirmCleanCaution') : ''
      }),
      primaryAction: { title: t('actionMoveToTrash'), style: 'destructive' }
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
      title: t('confirmEmptyBinTitle'),
      message: t('confirmEmptyBinMsg'),
      primaryAction: { title: t('actionEmptyBin'), style: 'destructive' }
    })
    if (!confirmed) return

    const res = await emptyRecycleBin()
    if (!res.ok) {
      showToast({ style: Toast.Style.Failure, title: t('emptyBinFailedDefault'), message: res.error })
      return
    }
    showToast({
      style: Toast.Style.Success,
      title: t('emptyBinOkTitle'),
      message: res.message || (typeof res.removedCount === 'number' ? t('emptyBinOkCount', { count: res.removedCount }) : undefined)
    })
    await refreshData({ keepSelection: true })
  }

  async function locate(path: string) {
    const ok = await showRealItemInFolder(path)
    if (!ok) showToast({ style: Toast.Style.Failure, title: t('revealFailedTitle'), message: path })
  }

  if (!inRealHost) {
    return List({
      searchBarPlaceholder: t('searchPlaceholderShort'),
      children: [
        List.Item({
          id: 'cleaner-client-required',
          title: t('notInClient'),
          subtitle: t('clientRequiredSub'),
          icon: { source: Icon.Info }
        })
      ]
    })
  }

  const cleanActionTitle = t('actionCleanSelected', { count: targetFiles.length, size: formatBytes(targetBytes) })
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
                  title: t('actionRevealInFolder'),
                  icon: Icon.Folder,
                  onAction: () => locate(file.path)
                }),
                Action({
                  title: isChecked ? t('actionUncheckFile') : t('actionCheckFile'),
                  icon: Icon.Checkmark,
                  onAction: () => setPathsChecked([file.path], !isChecked)
                }),
                Action.CopyToClipboard({
                  title: t('actionCopyFullPath'),
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
              ? t('sampleCleanableText', { count: item.sampleFiles.length, size: formatBytes(sampleBytes) })
              : t('sampleNoneText')

          return List.Item({
            id: item.id,
            title: item.name,
            subtitle: t('groupSubtitle', { count: item.fileCount.toLocaleString(), sample: sampleText, hint: item.pathHint }),
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
                        title: t('actionRevealInFolder'),
                        icon: Icon.Folder,
                        onAction: () => locate(locatePath)
                      })
                    ]
                  : []),
                ...(item.sampleFiles.length > 0
                  ? [
                      Action({
                        title: state === true ? t('actionUncheckGroup') : t('actionCheckGroup'),
                        icon: Icon.Checkmark,
                        onAction: () => toggleGroup(item, state !== true)
                      })
                    ]
                  : []),
                Action({
                  title: t('actionViewSampleFiles'),
                  icon: Icon.Document,
                  onAction: () => setViewMode('files')
                }),
                Action({
                  title: t('actionEmptySysBin'),
                  icon: Icon.Trash,
                  onAction: () => handleEmptyRecycleBin()
                }),
                Action.CopyToClipboard({
                  title: t('actionCopyScanPath'),
                  content: item.pathHint
                })
              ]
            })
          })
        })

  const activeClassMeta = cleanClasses.find(c => c.classId === classIdFilter)
  const rightTitle =
    viewMode === 'files'
      ? t('rightTitleFiles')
      : activeClassMeta
      ? t('rightTitleClass', { name: activeClassMeta.name })
      : t('rightTitleAll')

  const checkableGroups = filtered.filter(g => g.sampleFiles.length > 0)
  const scopePaths = allSampleFiles.map(f => f.path)
  const allScopeChecked = scopePaths.length > 0 && targetFiles.length === scopePaths.length
  const someScopeChecked = targetFiles.length > 0 && !allScopeChecked
  const diskText = summary.diskTotalSizeBytes > 0 ? t('diskFreeText', { size: formatBytes(summary.diskFreeSizeBytes) }) : ''

  return List({
    searchBarPlaceholder: t('searchPlaceholder'),
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    isLoading,
    searchBarAccessory: List.Dropdown({
      tooltip: t('dropdownTooltip'),
      value: riskFilter,
      onChange: val => setRiskFilter(val),
      children: [
        List.Dropdown.Item({ title: t('riskAllOption', { count: groups.length }), value: 'all' }),
        List.Dropdown.Item({
          title: t('riskSafeOption', { count: groups.filter(g => g.riskLevel === 'safe').length }),
          value: 'safe'
        }),
        List.Dropdown.Item({
          title: t('riskRecOption', { count: groups.filter(g => g.riskLevel === 'recommended').length }),
          value: 'recommended'
        }),
        List.Dropdown.Item({
          title: t('riskCautionOption', { count: groups.filter(g => g.riskLevel === 'caution').length }),
          value: 'caution'
        })
      ]
    }),
    filterBar: {
      summaryText: scanError
        ? t('summaryScanError', { label: groups.length ? t('scanIncompleteTitle') : t('scanFailedTitle'), error: scanError })
        : t('summaryNormal', {
            total: formatBytes(summary.totalSizeBytes),
            count: targetFiles.length,
            selected: formatBytes(targetBytes),
            disk: diskText
          }),
      actions: [
        {
          id: 'rescan',
          label: t('btnRescan'),
          title: t('btnRescan'),
          style: 'secondary',
          onAction: () => refreshData({ showIndicator: true })
        }
      ]
    },
    subList: {
      title: rightTitle,
      subtitle:
        viewMode === 'files'
          ? t('subListSubFiles', { total: allSampleFiles.length, checked: targetFiles.length, size: formatBytes(targetBytes) })
          : t('subListSubGroups', { total: filtered.length, checked: targetFiles.length, size: formatBytes(targetBytes) }),
      checkable: viewMode === 'files' ? allSampleFiles.length > 0 : checkableGroups.length > 0,
      checked: allScopeChecked ? true : someScopeChecked ? 'indeterminate' : false,
      onCheckChange: () => setPathsChecked(scopePaths, !allScopeChecked),
      emptyText: isLoading
        ? t('scanningTitle')
        : viewMode === 'files'
        ? t('emptyNoSamples')
        : t('emptyNoGroups'),
      items: rightSubListItems
    },
    children: [
      List.Section({
        title: t('sectionSummary'),
        children: [
          List.Item({
            id: 'nav-clean-all',
            title: t('navAllTitle'),
            subtitle: t('navAllSub', { count: groups.length, size: formatBytes(summary.totalSizeBytes) }),
            icon: { source: Icon.HardDrive },
            accessories: [{ text: formatBytes(summary.totalSizeBytes) }],
            onSelect: () => {
              setClassIdFilter(0)
              setViewMode('groups')
            }
          }),
          List.Item({
            id: 'nav-clean-files',
            title: t('navFilesTitle'),
            subtitle: t('navFilesSub', { count: allSampleFiles.length }),
            icon: { source: Icon.Document },
            accessories: [{ text: t('itemCountText', { count: allSampleFiles.length }) }],
            onSelect: () => setViewMode('files')
          })
        ]
      }),
      List.Section({
        title: t('sectionClasses'),
        children: cleanClasses.map(cls => {
          const clsGroups = groups.filter(g => g.classId === cls.classId)
          const clsBytes = clsGroups.reduce((s, g) => s + g.totalSizeBytes, 0)
          return List.Item({
            id: `nav-clean-class-${cls.classId}`,
            title: cls.name,
            subtitle: t('classRuleCountSub', { count: clsGroups.length }),
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
