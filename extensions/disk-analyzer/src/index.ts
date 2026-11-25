import {
  List,
  ActionPanel,
  Action,
  Icon,
  Color,
  Clipboard,
  useState,
  useEffect,
  useRef,
  showToast,
  Toast,
  confirmAlert,
  useLocale
} from '@ztools/declarative-ui'
import { t } from './i18n.js'
import {
  DiskDriveItem,
  DiskFileEntry,
  DiskGroupStat,
  getOfficialFileTypeGroups,
  groupDescriptionFor,
  searchPlaceholderFor,
  getForbiddenReason,
  FORBIDDEN_TARGET_PATTERN,
  formatBytes,
  formatDateTime,
  computeExtStats,
  computeGroupStats,
  fetchDiskAnalysisSnapshot,
  deleteDiskFileItem,
  batchDeleteDiskFileItems,
  openDiskItemLocation,
  openDiskFileDefault,
  openDriveRoot,
  driveRoot,
  fileManagerName,
  trashName,
  type DiskScanFailure
} from './logic.js'
import { resolveErrorMessage } from './error-i18n.js'

/**
 * 定位 / 打开：宿主只放行本窗口扫描结果里的路径，失败时必须提示（以前静默失败，用户以为点了没反应）。
 * 分区根目录走 openDriveRootWithToast（授权来源不同，失败原因也不同）。
 */
async function openWithToast(kind: 'reveal' | 'open', targetPath: string): Promise<void> {
  const ok = kind === 'reveal' ? await openDiskItemLocation(targetPath) : await openDiskFileDefault(targetPath)
  if (ok) return
  await showToast({
    style: Toast.Style.Failure,
    title: kind === 'reveal' ? t('toastRevealFailed') : t('toastOpenFailed'),
    message: t('toastPathExpiredMsg', { path: targetPath })
  })
}

/** 打开分区根目录：失败时按原因提示（旧版客户端不授权分区根目录 / 分区已推出），不说「可能已被移动或删除」 */
async function openDriveRootWithToast(drive: string): Promise<void> {
  const res = await openDriveRoot(drive)
  if (res.ok) return
  await showToast({
    style: Toast.Style.Failure,
    title: t('toastOpenDriveFailed'),
    message: `${driveRoot(drive)}\n${resolveErrorMessage(res, t('driveRootOpenFailed'))}`
  })
}

/** 生成单个文件分类的空间画像与二级扩展名排行 Markdown */
export function buildGroupMarkdown(g: DiskGroupStat, selectedDrive: string): string {
  const extRows =
    g.topExtensions.length > 0
      ? g.topExtensions
          .map(e =>
            t('mdExtLine', {
              ext: e.extension,
              size: formatBytes(e.totalSizeBytes),
              pct: e.sharePercent,
              count: e.fileCount
            })
          )
          .join('\n')
      : t('mdNoFiles')

  return t('mdGroupBody', {
    name: g.name,
    desc: groupDescriptionFor(g.groupId),
    scope: selectedDrive === 'ALL' ? t('mdScopeAll') : t('mdScopeDrive', { drive: selectedDrive }),
    size: formatBytes(g.totalSizeBytes),
    pct: g.sharePercent,
    count: g.fileCount,
    extCount: g.topExtensions.length,
    extRows
  })
}

/** 目录名（路径最后一段）；分区根目录本身显示完整路径 */
function dirDisplayName(dirPath: string): string {
  const trimmed = dirPath.replace(/[\\/]+$/, '')
  const name = trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1)
  return name || dirPath
}

export default function DiskAnalyzerCommand() {
  useLocale()
  const [searchText, setSearchText] = useState('')
  const [tab, setTab] = useState<'all' | 'files' | 'drives' | 'ext'>('all')
  const [selectedDrive, setSelectedDrive] = useState<string>('ALL')
  const [selectedGroupId, setSelectedGroupId] = useState<string>('ALL')
  const [selectedDirPath, setSelectedDirPath] = useState<string>('ALL')
  const [selectedExt, setSelectedExt] = useState<string>('ALL')
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])

  const [drives, setDrives] = useState<DiskDriveItem[]>([])
  const [files, setFiles] = useState<DiskFileEntry[]>([])
  const [topDirectories, setTopDirectories] = useState<
    Array<{ name: string; path: string; drive: string; sizeBytes: number; fileCount: number; approximate?: boolean }>
  >([])
  // 宿主目录扫描达到条目上限时，大文件列表只是抽样结果，界面不能标成「全盘」「按体积降序」
  const [scanError, setScanError] = useState('')
  const [sampledScan, setSampledScan] = useState<{ sampled: boolean; scannedEntries: number }>({ sampled: false, scannedEntries: 0 })
  // 未能扫描的目录（用户拒绝访问、外接卷不可读等）：其余目录照常展示，这些目录在左侧单独列出原因
  const [failedScans, setFailedScans] = useState<DiskScanFailure[]>([])
  const [totalCapacity, setTotalCapacity] = useState(0)
  const [totalUsed, setTotalUsed] = useState(0)
  const [totalAvailable, setTotalAvailable] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isScanning, setIsScanning] = useState(false)
  // 互斥标记用 ref：连点时后几次点击拿到的可能还是旧闭包，状态还没刷新，ref 在各次渲染间是同一个对象
  const scanningRef = useRef(false)
  const batchTrashingRef = useRef(false)

  async function refreshAnalysis(showIndicator = false) {
    if (scanningRef.current) return
    scanningRef.current = true
    setIsScanning(true)
    // 进行中提示（Animated）宿主不会自动隐藏，必须在结束时显式 hide
    let progressToast: { hide: () => Promise<void> } | null = null
    try {
      if (showIndicator) {
        setIsLoading(true)
        progressToast = await showToast({
          style: Toast.Style.Animated,
          title: t('toastScanningTitle'),
          message: t('toastScanningMsg')
        })
      }
      // 分区容量先到先显示；大文件和目录要等扫描完成
      const snap = await fetchDiskAnalysisSnapshot(undefined, summary => {
        setDrives(summary.drives)
        setTotalCapacity(summary.totalCapacityBytes)
        setTotalUsed(summary.totalUsedBytes)
        setTotalAvailable(summary.totalAvailableBytes)
      })
      setScanError('')
      setDrives(snap.drives)
      setFiles(snap.files)
      setTopDirectories(Array.isArray(snap.topDirectories) ? snap.topDirectories : [])
      setSampledScan({ sampled: snap.sampled === true, scannedEntries: Number(snap.scannedEntries) || 0 })
      const failed = Array.isArray(snap.failedScans) ? snap.failedScans : []
      setFailedScans(failed)
      setTotalCapacity(snap.totalCapacityBytes)
      setTotalUsed(snap.totalUsedBytes)
      setTotalAvailable(snap.totalAvailableBytes)
      setSelectedPaths([])
      if (showIndicator && failed.length > 0) {
        await progressToast?.hide()
        showToast({
          style: Toast.Style.Failure,
          title: t('toastPartialTitle', { count: failed.length }),
          message: t('toastPartialMsg', {
            count: snap.files.length,
            detail: failed.map(f => t('permHintWrap', { raw: f.path, hint: f.reason })).join(t('pairSep'))
          })
        })
      } else if (showIndicator) {
        await progressToast?.hide()
        showToast({
          style: Toast.Style.Success,
          title: t('toastScanDoneTitle'),
          message: t('toastScanDoneMsg', {
            drives: snap.drives.length,
            files: snap.files.length,
            exts: snap.extStats.length
          })
        })
      }
    } catch (err) {
      setScanError(err instanceof Error ? err.message : String(err))
      await progressToast?.hide()
      showToast({
        style: Toast.Style.Failure,
        title: t('toastScanFailedTitle'),
        message: err instanceof Error ? err.message : String(err)
      })
    } finally {
      await progressToast?.hide()
      scanningRef.current = false
      setIsScanning(false)
      setIsLoading(false)
    }
  }

  useEffect(() => {
    refreshAnalysis(false)
  }, [])

  // 1. 按当前选中的目标盘符过滤文件
  const driveScopedFiles =
    selectedDrive === 'ALL'
      ? files
      : files.filter(f => f.drive.toUpperCase() === selectedDrive.toUpperCase())

  // 2. 基于当前盘符作用域实时计算 10 大官方分类统计 & 扩展名统计
  const scopedGroupStats: DiskGroupStat[] = computeGroupStats(driveScopedFiles)
  const scopedExtStats = computeExtStats(driveScopedFiles)
  const scopedTotalBytes = driveScopedFiles.reduce((acc, f) => acc + f.sizeBytes, 0)

  // 3. 按当前选中的 10 大分类过滤，以动态计算该分类下的二级后缀列表
  const groupScopedFiles =
    selectedGroupId === 'ALL'
      ? driveScopedFiles
      : driveScopedFiles.filter(f => String(f.groupId) === selectedGroupId)

  const activeGroupExtensions = computeExtStats(groupScopedFiles).slice(0, 10)

  // 4. 按目录 + 二级后缀 + 搜索关键字最终过滤文件列表，并按体积从大到小排序
  const q = searchText.trim().toLowerCase()
  const finalFilteredFiles = groupScopedFiles
    .filter(f => {
      if (selectedDirPath !== 'ALL') {
        const normDir = selectedDirPath.toLowerCase()
        if (
          !f.path.toLowerCase().startsWith(normDir) &&
          !f.parentDir.toLowerCase().startsWith(normDir)
        ) {
          return false
        }
      }
      if (selectedExt !== 'ALL' && f.extension.toLowerCase() !== selectedExt.toLowerCase()) {
        return false
      }
      if (!q) return true
      return (
        f.name.toLowerCase().includes(q) ||
        f.path.toLowerCase().includes(q) ||
        f.extension.toLowerCase().includes(q) ||
        f.groupName.toLowerCase().includes(q)
      )
    })
    .sort((a, b) => b.sizeBytes - a.sizeBytes)

  // 右侧完整渲染全部匹配项（每个扫描目录最多 100 个大文件），保证表头全选只作用于看得见的条目
  const visibleFiles = finalFilteredFiles

  // 勾选状态统计（系统保护文件永远不进入清理队列）
  const selectedSet = new Set(selectedPaths)
  const selectedEntries = files.filter(f => selectedSet.has(f.path) && !f.isProtected)
  const selectedBytes = selectedEntries.reduce((acc, f) => acc + f.sizeBytes, 0)
  const selectableInFilter = finalFilteredFiles.filter(f => !f.isProtected)
  const allFilteredChecked =
    selectableInFilter.length > 0 && selectableInFilter.every(f => selectedSet.has(f.path))

  function toggleSingleFile(filePath: string, checked: boolean) {
    if (checked && files.some(f => f.path === filePath && f.isProtected)) return
    setSelectedPaths(prev => {
      const next = new Set(prev)
      if (checked) next.add(filePath)
      else next.delete(filePath)
      return Array.from(next)
    })
  }

  function toggleGroupCheck(groupFiles: DiskFileEntry[], checked: boolean) {
    const selectable = groupFiles.filter(f => !f.isProtected).map(f => f.path)
    if (selectable.length === 0) return
    setSelectedPaths(prev => {
      const next = new Set(prev)
      for (const p of selectable) {
        if (checked) next.add(p)
        else next.delete(p)
      }
      return Array.from(next)
    })
  }

  function toggleSelectAllFiltered() {
    if (selectableInFilter.length === 0) {
      showToast({
        style: Toast.Style.Failure,
        title: t('toastNoCleanableTitle'),
        message: t('toastNoCleanableMsg')
      })
      return
    }
    setSelectedPaths(prev => {
      const next = new Set(prev)
      if (allFilteredChecked) {
        for (const f of selectableInFilter) next.delete(f.path)
      } else {
        for (const f of selectableInFilter) next.add(f.path)
      }
      return Array.from(next)
    })
  }

  async function handleTrashFile(entry: DiskFileEntry) {
    if (entry.isProtected || FORBIDDEN_TARGET_PATTERN.test(entry.path)) {
      await confirmAlert({
        title: t('alertProtectedTitle'),
        message: `${entry.path}\n\n${getForbiddenReason()}`,
        primaryAction: { title: t('alertAck'), style: 'default' }
      })
      return
    }

    const trash = trashName(entry.path)
    const confirmed = await confirmAlert({
      title: t('alertTrashTitle', { trash }),
      message: t('alertTrashMessage', {
        name: entry.name,
        group: entry.groupName,
        ext: entry.extension,
        size: formatBytes(entry.sizeBytes),
        path: entry.path,
        trash
      }),
      primaryAction: { title: t('alertTrashPrimary', { trash }), style: 'destructive' }
    })
    if (!confirmed) return

    const res = await deleteDiskFileItem(entry.path)
    if (!res.ok) {
      showToast({
        style: Toast.Style.Failure,
        title: t('removeFailed'),
        message: resolveErrorMessage(res, t('toastTrashFailMsg'))
      })
      return
    }

    showToast({
      style: Toast.Style.Success,
      title: t('toastTrashDoneTitle', { trash }),
      message: `${entry.name} (${formatBytes(entry.sizeBytes)})`
    })
    setFiles(prev => prev.filter(f => f.path !== entry.path))
    setSelectedPaths(prev => prev.filter(p => p !== entry.path))
  }

  async function handleBatchTrashSelected() {
    if (selectedEntries.length === 0 || batchTrashingRef.current) return
    batchTrashingRef.current = true
    try {
      await runBatchTrash()
    } finally {
      batchTrashingRef.current = false
    }
  }

  async function runBatchTrash() {
    const previewLines = selectedEntries
      .slice(0, 8)
      .map(f => `• [${f.groupName}] ${f.name} (${formatBytes(f.sizeBytes)})`)
      .join('\n')
    const moreLine =
      selectedEntries.length > 8 ? t('moreFilesLine', { count: selectedEntries.length - 8 }) : ''

    const trash = trashName(selectedEntries[0]?.path || '')
    const confirmed = await confirmAlert({
      title: t('alertBatchTitle', { count: selectedEntries.length }),
      message: t('alertBatchMessage', {
        size: formatBytes(selectedBytes),
        preview: previewLines,
        more: moreLine,
        trash
      }),
      primaryAction: { title: t('alertBatchPrimary', { trash, size: formatBytes(selectedBytes) }), style: 'destructive' }
    })
    if (!confirmed) return

    const progressToast = await showToast({
      style: Toast.Style.Animated,
      title: t('toastBatchLoadingTitle', { trash, count: selectedEntries.length }),
      message: t('toastBatchLoadingMsg', { size: formatBytes(selectedBytes) })
    })

    let result: Awaited<ReturnType<typeof batchDeleteDiskFileItems>>
    try {
      result = await batchDeleteDiskFileItems(selectedEntries.map(f => f.path))
    } catch (err) {
      await progressToast.hide()
      showToast({
        style: Toast.Style.Failure,
        title: t('toastBatchFailedTitle'),
        message: err instanceof Error ? err.message : String(err)
      })
      return
    }
    await progressToast.hide()
    const { succeeded, failed } = result
    if (succeeded.length > 0) {
      const removedSet = new Set(succeeded)
      const freedBytes = selectedEntries
        .filter(f => removedSet.has(f.path))
        .reduce((acc, f) => acc + f.sizeBytes, 0)
      setFiles(prev => prev.filter(f => !removedSet.has(f.path)))
      setSelectedPaths(prev => prev.filter(p => !removedSet.has(p)))
      const failPart = failed.length > 0
        ? t('toastBatchPartialFail', { count: failed.length, error: resolveErrorMessage(failed[0], t('toastBatchPartialDefaultErr')) })
        : ''
      showToast({
        style: Toast.Style.Success,
        title: t('toastBatchDoneTitle', { count: succeeded.length }),
        message: t('toastBatchDoneMsg', { size: formatBytes(freedBytes), failPart })
      })
    } else if (failed.length > 0) {
      showToast({
        style: Toast.Style.Failure,
        title: t('toastBatchFailedTitle'),
        message: resolveErrorMessage(failed[0], t('toastBatchAllFailedMsg'))
      })
    }
  }

  // 当前作用域容量指标计算
  const activeDriveObj =
    selectedDrive === 'ALL'
      ? null
      : drives.find(d => d.drive.toUpperCase() === selectedDrive.toUpperCase()) || null

  const metricCap = activeDriveObj ? activeDriveObj.totalBytes : totalCapacity
  const metricUsed = activeDriveObj ? activeDriveObj.usedBytes : totalUsed
  const metricAvail = activeDriveObj ? activeDriveObj.availableBytes : totalAvailable
  const overallPercent = metricCap > 0 ? Math.round((metricUsed / metricCap) * 100) : 0

  function renderDriveMarkdown(d: DiskDriveItem): string {
    const driveFiles = files.filter(f => f.drive.toUpperCase() === d.drive.toUpperCase())
    const driveGroups = computeGroupStats(driveFiles).filter(g => g.fileCount > 0)
    const filledBlocks = Math.min(20, Math.max(1, Math.round((d.usagePercent / 100) * 20)))
    const bar = '█'.repeat(filledBlocks) + '░'.repeat(20 - filledBlocks)
    const alert =
      d.usagePercent >= 90
        ? t('mdAlertDanger', { pct: d.usagePercent, avail: formatBytes(d.availableBytes), drive: d.drive })
        : d.usagePercent >= 75
        ? t('mdAlertWarn', { pct: d.usagePercent })
        : t('mdAlertHealthy', { pct: d.usagePercent })

    const groupLines =
      driveGroups.length > 0
        ? driveGroups
            .map(g =>
              t('mdGroupLine', {
                name: g.name,
                size: formatBytes(g.totalSizeBytes),
                pct: g.sharePercent,
                count: g.fileCount
              })
            )
            .join('\n')
        : t('mdNoSampledFiles')

    return t('mdDriveBody', {
      label: d.label,
      root: driveRoot(d.drive),
      fs: d.fileSystem,
      bar,
      pct: d.usagePercent,
      total: formatBytes(d.totalBytes),
      used: formatBytes(d.usedBytes),
      avail: formatBytes(d.availableBytes),
      count: driveFiles.length,
      size: formatBytes(driveFiles.reduce((a, b) => a + b.sizeBytes, 0)),
      groups: groupLines,
      alert
    })
  }

  function renderGroupMarkdown(g: DiskGroupStat): string {
    return buildGroupMarkdown(g, selectedDrive)
  }

  // 构建 10 大分类彩色分段条
  const nonEmptyGroups = scopedGroupStats.filter(g => g.totalSizeBytes > 0)
  const distributionSegments = (nonEmptyGroups.length > 0 ? nonEmptyGroups : scopedGroupStats.slice(0, 5)).map(
    g => ({
      id: String(g.groupId),
      label: g.name,
      color: g.color,
      sizeBytes: g.totalSizeBytes,
      formattedSize: formatBytes(g.totalSizeBytes),
      percent: g.sharePercent,
      count: g.fileCount
    })
  )

  const filteredDrives = drives.filter(
    d => !q || d.drive.toLowerCase().includes(q) || d.label.toLowerCase().includes(q)
  )
  const filteredExts = scopedExtStats.filter(
    e => !q || e.extension.toLowerCase().includes(q) || e.categoryLabel.toLowerCase().includes(q)
  )

  // 按分组聚合可见文件，支持分类级三态复选框
  const officialGroups = getOfficialFileTypeGroups()
  const filesByGroupSection = officialGroups.map(meta => {
    const gStat = scopedGroupStats.find(s => s.groupId === meta.groupId)
    const groupAllFiles = finalFilteredFiles.filter(f => f.groupId === meta.groupId)
    const groupVisibleFiles = visibleFiles.filter(f => f.groupId === meta.groupId)
    const selectable = groupAllFiles.filter(f => !f.isProtected)
    const checkedCount = selectable.filter(f => selectedSet.has(f.path)).length
    const checkState: boolean | 'indeterminate' =
      selectable.length === 0
        ? false
        : checkedCount === selectable.length
        ? true
        : checkedCount > 0
        ? 'indeterminate'
        : false

    return {
      meta,
      gStat,
      groupAllFiles,
      groupVisibleFiles,
      selectable,
      checkedCount,
      checkState
    }
  }).filter(sec => sec.groupVisibleFiles.length > 0)

  // 构建右侧可交互大文件列表 (带复选框、体积占比条、分类标签与一键清理动作)
  const maxFileBytes = Math.max(1, visibleFiles[0]?.sizeBytes || 1)
  const rightFileItems = visibleFiles.map(f => {
    const isChecked = selectedSet.has(f.path)
    const volRatio = Math.max(8, Math.min(100, Math.round((f.sizeBytes / maxFileBytes) * 100)))
    const catMeta = officialGroups.find(g => g.groupId === f.groupId)
    const shortCat = catMeta?.shortName || f.groupName
    const trash = trashName(f.path)
    const fm = fileManagerName(f.path)

    return List.Item({
      id: f.id,
      title: f.name,
      subtitle: f.isProtected
        ? t('protectedSubtitle', { dir: f.parentDir })
        : `${f.parentDir} · ${formatDateTime(f.mtime)}`,
      checkable: !f.isProtected,
      checked: isChecked,
      onCheckChange: nextChecked => toggleSingleFile(f.path, nextChecked),
      onToggleCheck: nextChecked => toggleSingleFile(f.path, nextChecked),
      // 不可勾选的行由宿主在复选框位置显示锁标记，行图标不再重复放锁
      icon: {
        source: Icon.Document
      },
      accessories: [
        {
          progress: {
            value: volRatio
          }
        },
        {
          tag: {
            value: f.isProtected ? t('protectedTag') : shortCat,
            color: Color.SecondaryText
          }
        },
        { text: formatBytes(f.sizeBytes) }
      ],
      actions: ActionPanel({
        title: f.name,
        children: [
          Action({
            title: t('actionRevealInFm', { fm }),
            icon: Icon.Folder,
            onAction: () => openWithToast('reveal', f.path)
          }),
          ...(f.isProtected
            ? []
            : [
                Action({
                  title: isChecked ? t('actionUncheck') : t('actionCheck'),
                  icon: Icon.Checkmark,
                  onAction: () => toggleSingleFile(f.path, !isChecked)
                })
              ]),
          Action({
            title: t('actionOpenDefault'),
            icon: Icon.AppWindow,
            onAction: () => openWithToast('open', f.path)
          }),
          Action({
            title: t('actionFilterExt', { ext: f.extension }),
            icon: Icon.MagnifyingGlass,
            onAction: () => {
              setSelectedGroupId(String(f.groupId))
              setSelectedExt(f.extension)
            }
          }),
          // 系统保护文件不提供清理动作；非保护文件的删除动作退至次动作 + 快捷键防 Enter 误触
          ...(f.isProtected
            ? []
            : [
                Action({
                  title: t('actionMoveToTrash', { trash }),
                  icon: Icon.Trash,
                  style: Action.Style.Destructive,
                  shortcut: { modifiers: ['ctrl'], key: 'backspace' },
                  onAction: () => handleTrashFile(f)
                })
              ]),
          ...(selectedEntries.length > 0
            ? [
                Action({
                  title: t('actionBatchTrash', { count: selectedEntries.length, size: formatBytes(selectedBytes) }),
                  icon: Icon.Trash,
                  style: Action.Style.Destructive,
                  shortcut: { modifiers: ['ctrl', 'shift'], key: 'backspace' },
                  onAction: () => handleBatchTrashSelected()
                })
              ]
            : []),
          Action.CopyToClipboard({
            title: t('actionCopyFullPath'),
            content: f.path
          })
        ]
      })
    })
  })

  // 首次加载或重新扫描进行中：数字还没出来，界面写「正在扫描」，不把 0 B 当结果显示
  const scanPending = isScanning || isLoading
  const defaultTrash = trashName(files[0]?.path || '')
  const rightScopeTitle =
    selectedDirPath !== 'ALL'
      ? t('scopeDirTitle', { dir: selectedDirPath })
      : selectedGroupId !== 'ALL'
      ? t('scopeGroupTitle', { group: scopedGroupStats.find(g => String(g.groupId) === selectedGroupId)?.name || t('scopeCurrentGroup') })
      : selectedDrive !== 'ALL'
      ? t('scopeDriveTitle', { drive: selectedDrive })
      : sampledScan.sampled
      ? t('scopeSampledTitle', { trash: defaultTrash })
      : t('scopeAllTitle', { trash: defaultTrash })

  const summaryText = scanError
    ? t('summaryScanFailed', { error: scanError })
    : t('summaryMain', {
        cap: formatBytes(metricCap),
        used: formatBytes(metricUsed),
        pct: overallPercent,
        avail: formatBytes(metricAvail)
      }) +
      (sampledScan.sampled ? t('summarySampled', { count: sampledScan.scannedEntries }) : '') +
      (failedScans.length > 0 ? t('summaryFailedDirs', { count: failedScans.length }) : '') +
      (selectedEntries.length > 0 ? t('summarySelected', { count: selectedEntries.length, size: formatBytes(selectedBytes) }) : '')

  return List({
    searchBarPlaceholder: searchPlaceholderFor(),
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    isLoading,
    searchBarAccessory: List.Dropdown({
      tooltip: t('dropdownTooltip'),
      value: selectedDrive,
      onChange: val => {
        setSelectedDrive(val)
        setSelectedDirPath('ALL')
        setSelectedExt('ALL')
      },
      children: [
        List.Dropdown.Item({
          title: t('dropdownAll', { count: files.length }),
          value: 'ALL'
        }),
        ...drives.map(d =>
          List.Dropdown.Item({
            title: `${d.drive} (${d.usagePercent}%)`,
            value: d.drive
          })
        )
      ]
    }),
    filterBar: {
      summaryText: scanError
        ? t('summaryScanFailed', { error: scanError })
        : scanPending && metricCap <= 0
        ? t('summaryReadingCap')
        : (scanPending ? t('summaryScanningPrefix') : '') + summaryText,
      actions: [
        {
          id: 'act-rescan',
          label: isScanning ? t('btnScanning') : t('btnRescan'),
          style: 'secondary',
          disabled: isScanning,
          onAction: () => refreshAnalysis(true)
        }
      ]
    },
    subList: {
      title: rightScopeTitle,
      subtitle: scanPending && files.length === 0 ? t('subListScanning') : t('subListSubtitle', { count: finalFilteredFiles.length, size: formatBytes(finalFilteredFiles.reduce((a, b) => a + b.sizeBytes, 0)) }),
      checkable: selectableInFilter.length > 0,
      checked:
        selectableInFilter.length === 0
          ? false
          : allFilteredChecked
          ? true
          : selectedEntries.length > 0
          ? 'indeterminate'
          : false,
      onCheckChange: () => toggleSelectAllFiltered(),
      emptyText: scanPending ? t('subListEmptyScanning') : t('subListEmpty'),
      items: rightFileItems
    },
    children: [
      // 「全部大文件」是查看范围，不是分区：单独成组，不混进分区列表；数量只在右侧表头显示一次
      List.Section({
        title: t('secScopeTitle'),
        children: [
          List.Item({
            id: 'drive-ALL',
            title: sampledScan.sampled ? t('itemAllSampled') : t('itemAllFiles'),
            subtitle: totalCapacity > 0 ? t('itemAllSubtitle', { used: formatBytes(totalUsed), cap: formatBytes(totalCapacity) }) : scanPending ? t('itemAllSubtitleScanning') : t('itemAllSubtitleNoCap'),
            icon: { source: Icon.Globe },
            onSelect: () => {
              setSelectedDrive('ALL')
              setSelectedGroupId('ALL')
              setSelectedDirPath('ALL')
              setSelectedExt('ALL')
            }
          })
        ]
      }),
      List.Section({
        title: t('secDrivesTitle', { count: filteredDrives.length }),
        children: [
          ...filteredDrives.map(d => {
            const isDanger = d.usagePercent >= 90
            return List.Item({
              id: `drive-${d.drive}`,
              title: d.label.includes(d.drive) ? d.label : `${d.drive} ${d.label}`,
              subtitle: t('driveItemSubtitle', { used: formatBytes(d.usedBytes), avail: formatBytes(d.availableBytes) }),
              icon: {
                source: Icon.HardDrive
              },
              accessories: [
                {
                  tag: {
                    value: `${d.usagePercent}%`,
                    ...(isDanger ? { color: 'red' } : {})
                  }
                }
              ],
              onSelect: () => {
                setSelectedDrive(d.drive)
                setSelectedGroupId('ALL')
                setSelectedDirPath('ALL')
                setSelectedExt('ALL')
              },
              detail: List.Item.Detail({
                markdown: renderDriveMarkdown(d)
              }),
              actions: ActionPanel({
                title: d.label,
                children: [
                  Action({
                    title: t('actionFocusDrive', { drive: d.drive }),
                    icon: Icon.MagnifyingGlass,
                    onAction: () => {
                      setSelectedDrive(d.drive)
                      setSelectedGroupId('ALL')
                      setSelectedDirPath('ALL')
                      setSelectedExt('ALL')
                    }
                  }),
                  Action({
                    title: t('actionOpenDriveInFm', { fm: fileManagerName(d.drive) }),
                    icon: Icon.Folder,
                    onAction: () => openDriveRootWithToast(d.drive)
                  })
                ]
              })
            })
          })
        ]
      }),
      ...(failedScans.length > 0
        ? [
            List.Section({
              title: t('secFailedDirsTitle', { count: failedScans.length }),
              children: failedScans.map(failure =>
                List.Item({
                  id: `scanfail-${failure.path}`,
                  title: dirDisplayName(failure.path),
                  subtitle: failure.reason,
                  icon: { source: Icon.ExclamationMark },
                  accessories: [{ text: failure.path }],
                  actions: ActionPanel({
                    title: dirDisplayName(failure.path),
                    children: [
                      // 重新扫描是全局动作，只放在顶部状态条
                      Action.CopyToClipboard({
                        title: t('actionCopyDirPath'),
                        content: failure.path
                      }),
                      Action.CopyToClipboard({
                        title: t('actionCopyFailReason'),
                        content: `${failure.path}: ${failure.reason}`
                      })
                    ]
                  })
                })
              )
            })
          ]
        : []),
      List.Section({
        title: t('secGroupsTitle', { count: scopedGroupStats.filter(g => g.fileCount > 0).length }),
        children: scopedGroupStats
          .filter(g => g.fileCount > 0)
          .map(g => {
            const cleanGroupName = g.name
            return List.Item({
              id: `group-${g.groupId}`,
              title: cleanGroupName,
              subtitle: t('groupItemSubtitle', { count: g.fileCount, pct: g.sharePercent }),
              icon: { source: Icon.Folder },
              accessories: [{ text: formatBytes(g.totalSizeBytes) }],
              onSelect: () => {
                setSelectedGroupId(String(g.groupId))
                setSelectedDirPath('ALL')
                setSelectedExt('ALL')
              },
              actions: ActionPanel({
                title: cleanGroupName,
                children: [
                  Action({
                    title: t('actionViewGroup', { group: cleanGroupName, count: g.fileCount }),
                    icon: Icon.MagnifyingGlass,
                    onAction: () => {
                      setSelectedGroupId(String(g.groupId))
                      setSelectedDirPath('ALL')
                      setSelectedExt('ALL')
                    }
                  }),
                  Action({
                    title: t('actionCheckGroup', { group: cleanGroupName }),
                    icon: Icon.Checkmark,
                    onAction: () => {
                      const groupFiles = driveScopedFiles.filter(f => f.groupId === g.groupId)
                      toggleGroupCheck(groupFiles, true)
                    }
                  })
                ]
              })
            })
          })
      }),
      ...(topDirectories.length > 0
        ? [
            List.Section({
              title: t('secTopDirsTitle', { count: Math.min(12, topDirectories.length) }),
              children: topDirectories.slice(0, 12).map((dir, idx) =>
                List.Item({
                  id: `topdir-${idx}-${dir.path}`,
                  title: `${dir.name} (${dir.drive})`,
                  subtitle: dir.path,
                  icon: { source: Icon.Folder },
                  // 近似体积只是下限，用「≥」如实标注
                  accessories: [{ text: `${dir.approximate ? '≥ ' : ''}${formatBytes(dir.sizeBytes)}` }],
                  onSelect: () => {
                    setSelectedDrive(dir.drive)
                    setSelectedGroupId('ALL')
                    setSelectedDirPath(dir.path)
                    setSelectedExt('ALL')
                  },
                  actions: ActionPanel({
                    title: dir.name,
                    children: [
                      Action({
                        title: t('actionDrillDir', { name: dir.name }),
                        icon: Icon.MagnifyingGlass,
                        onAction: () => {
                          setSelectedDrive(dir.drive)
                          setSelectedGroupId('ALL')
                          setSelectedDirPath(dir.path)
                          setSelectedExt('ALL')
                        }
                      }),
                      Action({
                        title: t('actionOpenDirInFm', { fm: fileManagerName(dir.path) }),
                        icon: Icon.Folder,
                        onAction: () => openWithToast('reveal', dir.path)
                      }),
                      Action.CopyToClipboard({
                        title: t('actionCopyDirPath'),
                        content: dir.path
                      })
                    ]
                  })
                })
              )
            })
          ]
        : [])
    ]
  })
}
