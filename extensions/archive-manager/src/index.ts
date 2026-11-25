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
  FilterBar,
  useLocale
} from '@ztools/declarative-ui'
import { t } from './i18n.js'
import {
  ArchiveCandidateItem,
  ArchiveEntryItem,
  ARCHIVE_IMPORT_RULES,
  ARCHIVE_SUPPORTED_TEXT,
  createArchiveImportTransport,
  describeExtractTarget,
  formatBytes,
  getArchiveCategoryGroups,
  getCategoryLabel,
  inspectArchiveEntries,
  extractArchiveEntries,
  invokeNativeCapability,
  openArchiveLocation,
  summarizeExtractResult,
  summarizeVerifyResult,
  toArchiveCandidateItem,
  trashArchiveFile
} from './logic.js'
import {
  FileImportResult,
  NormalizedFileInput,
  collectFolderFiles,
  createImportInputProps,
  expandInputPaths,
  friendlyFileError,
  isVolumeRoot,
  mergeByPath,
  normalizeFileInput,
  pathKey,
  pickFiles,
  pickFolder,
  summarizeImport
} from './file-import.js'
import { isRealElectronHost } from './native-ipc.js'
import { isDeclarativeFileInputSupported } from './host-compat.js'
import { resolveErrorMessage } from './error-i18n.js'

export * from './logic.js'

interface ArchiveMeta {
  archiveSizeBytes: number
  totalUncompressedBytes: number
  compressionRatio: number
  isEncrypted: boolean
  traversalRiskCount: number
  hasSingleRootFolder: boolean
  singleRootFolderName: string | null
}

interface ImportScanProgress {
  visitedDirs: number
  matchedFiles: number
}

const EMPTY_META: ArchiveMeta = {
  archiveSizeBytes: 0,
  totalUncompressedBytes: 0,
  compressionRatio: 0,
  isEncrypted: false,
  traversalRiskCount: 0,
  hasSingleRootFolder: false,
  singleRootFolderName: null
}

const SHORTCUT_OPEN_FILES = { modifiers: ['ctrl'] as ('ctrl')[], key: 'o' }
const SHORTCUT_OPEN_FOLDER = { modifiers: ['ctrl', 'shift'] as ('ctrl' | 'shift')[], key: 'o' }
import { ARCHIVE_CATEGORY } from './archive-categories.zh-data.js'

const SHORTCUT_REMOVE_ITEM = { modifiers: ['ctrl'] as ('ctrl')[], key: 'backspace' }
const SHORTCUT_CLEAR_ALL = { modifiers: ['ctrl', 'shift'] as ('ctrl' | 'shift')[], key: 'backspace' }

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function readLaunchFeature(): string {
  const scope = ((globalThis as Record<string, unknown>).window || globalThis) as {
    __ztoolsLaunchContext?: { pluginId?: string; featureCode?: string }
  }
  const ctx = scope.__ztoolsLaunchContext
  if (!ctx || (ctx.pluginId && ctx.pluginId !== 'archive-manager')) return ''
  return String(ctx.featureCode || '').trim()
}

export function ArchiveManagerCommand() {
  useLocale()
  const categoryGroups = getArchiveCategoryGroups()
  const initialCategory = readLaunchFeature() === 'archive-docs' ? ARCHIVE_CATEGORY.DOCS : 'ALL'
  const isRealHost = isRealElectronHost()
  const transport = createArchiveImportTransport()
  const [searchText, setSearchText] = useState('')
  const [archives, setArchives] = useState<ArchiveCandidateItem[]>([])
  const [selectedArchivePath, setSelectedArchivePath] = useState<string>('')
  const [selectedCategory, setSelectedCategory] = useState<string>(initialCategory)
  const [entries, setEntries] = useState<ArchiveEntryItem[]>([])
  const [inspectError, setInspectError] = useState('')
  const [checkedEntryIds, setCheckedEntryIds] = useState<string[]>([])
  const [archiveMeta, setArchiveMeta] = useState<ArchiveMeta>(EMPTY_META)
  const [isLoading, setIsLoading] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<ImportScanProgress | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)

  // 切换压缩包与清空/移除时只采用最后一次读取的结果，避免慢结果回写已移除的包
  const inspectSeqRef = useRef(0)
  const importSeqRef = useRef(0)
  const importAbortRef = useRef<AbortController | null>(null)
  const extractingRef = useRef(false)
  const archivesRef = useRef<ArchiveCandidateItem[]>(archives)
  archivesRef.current = archives
  const selectedArchivePathRef = useRef<string>(selectedArchivePath)
  selectedArchivePathRef.current = selectedArchivePath

  function resetInspectionState() {
    inspectSeqRef.current += 1
    setIsLoading(false)
    setEntries([])
    setCheckedEntryIds([])
    setArchiveMeta(EMPTY_META)
    setInspectError('')
  }

  async function loadArchiveInspection(targetPath: string, showIndicator = false) {
    if (!targetPath) return
    const seq = ++inspectSeqRef.current
    setIsLoading(true)
    // 先清掉上一个压缩包的内容，读取失败时不能把旧内容当成当前压缩包显示
    setEntries([])
    setCheckedEntryIds([])
    setArchiveMeta(EMPTY_META)
    setInspectError('')
    try {
      const res = await inspectArchiveEntries(targetPath)
      if (seq !== inspectSeqRef.current) return
      if (pathKey(selectedArchivePathRef.current) !== pathKey(targetPath)) return
      if (!archivesRef.current.some((a) => pathKey(a.path) === pathKey(targetPath))) return
      if (!res.ok) {
        const reason = resolveErrorMessage(res, t('corruptOrNotZip'))
        setInspectError(reason)
        await showToast({ style: Toast.Style.Failure, title: t('readArchiveFailedTitle'), message: reason })
        return
      }
      setEntries(res.entries)
      setArchiveMeta({
        archiveSizeBytes: res.archiveSizeBytes,
        totalUncompressedBytes: res.totalUncompressedBytes,
        compressionRatio: res.compressionRatio,
        isEncrypted: res.isEncrypted,
        traversalRiskCount: res.traversalRiskCount,
        hasSingleRootFolder: res.hasSingleRootFolder,
        singleRootFolderName: res.singleRootFolderName
      })
      if (showIndicator) {
        await showToast({
          style: Toast.Style.Success,
          title: t('readArchiveOkTitle'),
          message: t('readArchiveOkMsg', { count: res.entries.length, size: formatBytes(res.totalUncompressedBytes) })
        })
      }
    } catch (err) {
      if (seq !== inspectSeqRef.current) return
      const msg = errorText(err)
      setInspectError(msg)
      await showToast({ style: Toast.Style.Failure, title: t('readArchiveFailedTitle'), message: msg })
    } finally {
      if (seq === inspectSeqRef.current) setIsLoading(false)
    }
  }

  function applyImportedArchives(result: FileImportResult) {
    const incoming = result.files.map(toArchiveCandidateItem)
    const { merged, added, duplicates } = mergeByPath(archivesRef.current, incoming, (item) => item.path)
    const hadSelection = Boolean(selectedArchivePathRef.current)

    if (added.length > 0) {
      archivesRef.current = merged
      setArchives(merged)
    }

    const summary = summarizeImport(result, { added: added.length, duplicates }, ARCHIVE_SUPPORTED_TEXT)
    if (summary) {
      void showToast({
        style: summary.ok ? Toast.Style.Success : Toast.Style.Failure,
        title: summary.title,
        message: summary.message
      })
    }

    // 导入前没有选中任何压缩包时，自动选中新导入的第 1 个并读取包内条目
    if (!hadSelection && added.length > 0) {
      const firstPath = added[0]!.path
      selectedArchivePathRef.current = firstPath
      setSelectedArchivePath(firstPath)
      void loadArchiveInspection(firstPath, false)
    }
  }

  async function executeArchiveImport(
    runner: (signal: AbortSignal, onProgress: (p: ImportScanProgress) => void) => Promise<FileImportResult>
  ) {
    importAbortRef.current?.abort()
    const controller = new AbortController()
    importAbortRef.current = controller
    const batchSeq = ++importSeqRef.current
    setIsImporting(true)
    setImportProgress(null)
    try {
      const result = await runner(controller.signal, (p) => {
        if (batchSeq === importSeqRef.current) setImportProgress(p)
      })
      if (batchSeq !== importSeqRef.current) return
      applyImportedArchives(result)
    } catch (err) {
      if (batchSeq !== importSeqRef.current) return
      await showToast({ style: Toast.Style.Failure, title: t('importFailedTitle'), message: friendlyFileError(err) })
    } finally {
      if (batchSeq === importSeqRef.current) {
        importAbortRef.current = null
        setIsImporting(false)
        setImportProgress(null)
      }
    }
  }

  function handlePickFiles() {
    void executeArchiveImport(() =>
      pickFiles(transport, ARCHIVE_IMPORT_RULES, {
        title: t('pickFilesTitle'),
        filterName: t('pickFilesFilterName')
      })
    )
  }

  function handlePickFolder() {
    void executeArchiveImport(async (signal, onProgress) => {
      const picked = await pickFolder(transport, { title: t('pickFolderTitle') })
      if (picked.canceled) return { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: true }
      if (picked.error || !picked.folderPath) {
        return {
          files: [],
          ignored: 0,
          truncated: false,
          failedDirs: [],
          canceled: false,
          error: resolveErrorMessage(picked, t('noFolderSelected'))
        }
      }
      if (isVolumeRoot(picked.folderPath)) {
        const ok = await confirmAlert({
          title: t('confirmRootTitle', { path: picked.folderPath }),
          message: t('confirmRootMsg'),
          primaryAction: { title: t('confirmRootAction'), style: 'default' }
        })
        if (!ok) return { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: true }
      }
      return collectFolderFiles(transport, picked.folderPath, ARCHIVE_IMPORT_RULES, { signal, onProgress })
    })
  }

  function handleFileInput(input: NormalizedFileInput) {
    void executeArchiveImport((signal, onProgress) =>
      expandInputPaths(transport, input.paths, ARCHIVE_IMPORT_RULES, {
        knownDirectories: input.directories,
        signal,
        onProgress
      })
    )
  }

  const handleFileInputRef = useRef(handleFileInput)
  handleFileInputRef.current = handleFileInput

  useEffect(() => {
    let removeDropListener: (() => void) | undefined
    if (!isDeclarativeFileInputSupported()) {
      const w = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : null
      const eventsApi = (
        w?.ztools as
          | {
              events?: {
                on?: (ev: string, cb: (payload: unknown) => void) => unknown
                off?: (ev: string, cb: (payload: unknown) => void) => void
              }
            }
          | undefined
      )?.events
      if (eventsApi && typeof eventsApi.on === 'function') {
        const onDrop = (envelope: unknown) => {
          const input = normalizeFileInput(envelope)
          if (input.paths.length > 0) handleFileInputRef.current(input)
        }
        const dispose = eventsApi.on('plugin_files_dropped', onDrop)
        removeDropListener = () => {
          if (typeof dispose === 'function') {
            ;(dispose as () => void)()
          } else if (typeof eventsApi.off === 'function') {
            eventsApi.off('plugin_files_dropped', onDrop)
          }
        }
      }
    }

    return () => {
      importSeqRef.current += 1
      inspectSeqRef.current += 1
      importAbortRef.current?.abort()
      removeDropListener?.()
    }
  }, [])

  const fileInputProps = createImportInputProps(
    (input) => handleFileInputRef.current(input),
    {
      dropTitle: t('dropTitle'),
      dropSubtitle: t('dropSubtitle')
    }
  )

  async function handleSelectArchive(nextPath: string) {
    if (!nextPath) return
    selectedArchivePathRef.current = nextPath
    setSelectedArchivePath(nextPath)
    setSelectedCategory('ALL')
    await loadArchiveInspection(nextPath, true)
  }

  function removeArchiveCandidate(targetPath: string) {
    const key = pathKey(targetPath)
    const idx = archivesRef.current.findIndex((a) => pathKey(a.path) === key)
    if (idx < 0) return
    const nextArchives = archivesRef.current.filter((_, i) => i !== idx)
    archivesRef.current = nextArchives
    setArchives(nextArchives)

    if (pathKey(selectedArchivePathRef.current) !== key) return
    if (nextArchives.length === 0) {
      selectedArchivePathRef.current = ''
      setSelectedArchivePath('')
      resetInspectionState()
      return
    }
    const nextArchive = nextArchives[Math.min(idx, nextArchives.length - 1)]!
    selectedArchivePathRef.current = nextArchive.path
    setSelectedArchivePath(nextArchive.path)
    setSelectedCategory('ALL')
    void loadArchiveInspection(nextArchive.path, false)
  }

  function handleRemoveCurrentArchive() {
    if (extractingRef.current) {
      void showToast({ style: Toast.Style.Failure, title: t('removeBusy') })
      return
    }
    const current = selectedArchivePathRef.current
    if (!current) return
    removeArchiveCandidate(current)
  }

  function handleClearList() {
    if (extractingRef.current) {
      void showToast({ style: Toast.Style.Failure, title: t('clearBusy') })
      return
    }
    importSeqRef.current += 1
    importAbortRef.current?.abort()
    importAbortRef.current = null
    setIsImporting(false)
    setImportProgress(null)
    archivesRef.current = []
    setArchives([])
    selectedArchivePathRef.current = ''
    setSelectedArchivePath('')
    resetInspectionState()
  }

  const checkedSet = new Set(checkedEntryIds)
  const checkedEntries = entries.filter((e) => checkedSet.has(e.id) && !e.hasPathTraversalRisk)

  /** 解压会覆盖目标位置的同名文件，执行前必须让用户确认目标文件夹 */
  async function confirmExtract(selective: boolean, count: number): Promise<boolean> {
    if (archiveMeta.isEncrypted) {
      await showToast({
        style: Toast.Style.Failure,
        title: t('encryptedTitle'),
        message: t('encryptedMsg')
      })
      return false
    }
    const target = describeExtractTarget(selectedArchivePath, archiveMeta, selective)
    return confirmAlert({
      title: selective ? t('confirmExtractSelectedTitle', { count }) : t('confirmExtractAllTitle'),
      message: t('confirmExtractMsg', { target }),
      primaryAction: { title: selective ? t('confirmExtractBtn') : t('confirmExtractAllBtn') }
    })
  }

  async function runExtract(options: { entryNames?: string[]; smartUnwrap: boolean }, progressTitle: string) {
    extractingRef.current = true
    setIsExtracting(true)
    let progressToast: { hide: () => Promise<void> } | null = null
    try {
      progressToast = await showToast({
        style: Toast.Style.Animated,
        title: progressTitle,
        message: selectedArchivePath.split(/[\\/]/).pop() || ''
      })
      const res = await extractArchiveEntries(selectedArchivePath, options)
      await progressToast?.hide()
      const summary = summarizeExtractResult(res)
      await showToast({
        style: summary.ok ? Toast.Style.Success : Toast.Style.Failure,
        title: summary.title,
        ...(summary.message ? { message: summary.message } : {})
      })
    } catch (err) {
      await progressToast?.hide()
      await showToast({ style: Toast.Style.Failure, title: t('extractFailedTitle'), message: errorText(err) })
    } finally {
      extractingRef.current = false
      setIsExtracting(false)
    }
  }

  async function handleExtractAll() {
    if (extractingRef.current) return
    if (!selectedArchivePath || inspectError || entries.length === 0) {
      await showToast({
        style: Toast.Style.Failure,
        title: t('noArchiveToExtractTitle'),
        message: inspectError ? t('noArchiveReadErrorMsg', { error: inspectError }) : t('noArchiveHintMsg')
      })
      return
    }
    if (!(await confirmExtract(false, entries.length))) return
    await runExtract({ smartUnwrap: true }, t('extractingProgress'))
  }

  async function handleExtractSelectedEntries(targetEntries: ArchiveEntryItem[]) {
    if (!selectedArchivePath || extractingRef.current) return
    const safeTargets = targetEntries.filter((e) => !e.hasPathTraversalRisk)
    if (safeTargets.length === 0) {
      await showToast({
        style: Toast.Style.Failure,
        title: t('noEntriesToExtractTitle'),
        message: t('noEntriesToExtractMsg')
      })
      return
    }
    if (!(await confirmExtract(true, safeTargets.length))) return
    await runExtract(
      { entryNames: safeTargets.map((e) => e.entryName), smartUnwrap: false },
      t('extractingSelectedProgress', { count: safeTargets.length })
    )
  }

  async function handleVerifyArchive() {
    if (!selectedArchivePath) return
    let res: Awaited<ReturnType<typeof invokeNativeCapability>>
    try {
      res = await invokeNativeCapability('VerifyArchive', { archivePath: selectedArchivePath })
    } catch (err) {
      await showToast({ style: Toast.Style.Failure, title: t('verifyFailedTitle'), message: errorText(err) })
      return
    }
    if (!res.ok) {
      await showToast({
        style: Toast.Style.Failure,
        title: t('verifyFailedTitle'),
        message: resolveErrorMessage(res, t('verifyFailedDefaultMsg'))
      })
      return
    }
    const summary = summarizeVerifyResult(res.data)
    await showToast({
      style: summary.ok ? Toast.Style.Success : Toast.Style.Failure,
      title: summary.title,
      message: summary.message
    })
  }

  async function handleRevealArchive() {
    if (!selectedArchivePath) return
    const ok = await openArchiveLocation(selectedArchivePath)
    if (!ok) {
      await showToast({ style: Toast.Style.Failure, title: t('revealFailedTitle'), message: selectedArchivePath })
    }
  }

  async function handleTrashArchive() {
    const targetPath = selectedArchivePath
    if (!targetPath) return
    if (extractingRef.current) {
      await showToast({ style: Toast.Style.Failure, title: t('trashBusy') })
      return
    }
    const ok = await confirmAlert({
      title: t('confirmTrashTitle'),
      message: t('confirmTrashMsg', { path: targetPath }),
      primaryAction: { title: t('confirmTrashAction'), style: 'destructive' }
    })
    if (!ok) return
    const tr = await trashArchiveFile(targetPath)
    if (tr.ok) {
      await showToast({ style: Toast.Style.Success, title: t('trashSuccessTitle') })
      removeArchiveCandidate(targetPath)
    } else {
      await showToast({
        style: Toast.Style.Failure,
        title: t('trashFailedTitle'),
        message: resolveErrorMessage(tr, t('trashInUseMsg'))
      })
    }
  }

  if (!isRealHost) {
    return List({
      searchBarPlaceholder: t('searchPlaceholderShort'),
      children: [
        List.Section({
          title: t('sectionArchives'),
          children: [
            List.Item({
              id: 'archive-client-required',
              title: t('notInClient'),
              subtitle: t('clientRequiredSub'),
              icon: { source: Icon.Info }
            })
          ]
        })
      ]
    })
  }

  const pickFilesAction = () =>
    Action({
      title: t('actionPickFilesEllipsis'),
      icon: Icon.Plus,
      shortcut: SHORTCUT_OPEN_FILES,
      onAction: handlePickFiles
    })
  const pickFolderAction = () =>
    Action({
      title: t('actionPickFolderEllipsis'),
      icon: Icon.Folder,
      shortcut: SHORTCUT_OPEN_FOLDER,
      onAction: handlePickFolder
    })
  const removeArchiveAction = () =>
    Action({
      title: t('actionRemove'),
      icon: Icon.Minus,
      shortcut: SHORTCUT_REMOVE_ITEM,
      onAction: handleRemoveCurrentArchive
    })
  const clearListAction = () =>
    Action({
      title: t('actionClearList'),
      icon: Icon.Trash,
      style: Action.Style.Destructive,
      shortcut: SHORTCUT_CLEAR_ALL,
      onAction: handleClearList
    })

  const categoryCounts = new Map<string, { count: number; bytes: number }>()
  for (const grp of categoryGroups) {
    categoryCounts.set(grp.id, { count: 0, bytes: 0 })
  }
  for (const e of entries) {
    const allStat = categoryCounts.get('ALL')!
    allStat.count += 1
    allStat.bytes += e.uncompressedSize
    const catStat = categoryCounts.get(e.category) ?? { count: 0, bytes: 0 }
    catStat.count += 1
    catStat.bytes += e.uncompressedSize
    categoryCounts.set(e.category, catStat)
  }

  const q = searchText.trim().toLowerCase()
  const filteredEntries = entries.filter((e) => {
    if (selectedCategory !== 'ALL' && e.category !== selectedCategory) return false
    if (!q) return true
    return (
      e.name.toLowerCase().includes(q) ||
      e.entryName.toLowerCase().includes(q) ||
      e.category.toLowerCase().includes(q) ||
      e.crc32.toLowerCase().includes(q)
    )
  })

  const maxEntryBytes = Math.max(1, filteredEntries[0]?.uncompressedSize || 1)
  const hasChecked = checkedEntries.length > 0
  const safeFilteredEntries = filteredEntries.filter((item) => !item.hasPathTraversalRisk)
  const allSafeChecked = safeFilteredEntries.length > 0 && safeFilteredEntries.every((item) => checkedSet.has(item.id))

  const toggleAllAction = () =>
    Action({
      title: allSafeChecked ? t('actionDeselectAll') : t('actionSelectAll'),
      icon: Icon.CheckCircle,
      shortcut: { modifiers: ['ctrl'], key: 'a' },
      onAction: () => {
        setCheckedEntryIds(allSafeChecked ? [] : safeFilteredEntries.map((item) => item.id))
      }
    })

  const rightSubListItems = filteredEntries.map((entry) => {
    const isChecked = checkedSet.has(entry.id)
    const volRatio = Math.max(8, Math.min(100, Math.round((entry.uncompressedSize / maxEntryBytes) * 100)))
    const panelChildren: Array<ReturnType<typeof Action> | ReturnType<typeof ActionPanel.Section>> = [
      hasChecked
        ? Action({
            title: t('actionExtractSelected', { count: checkedEntries.length }),
            icon: Icon.Download,
            onAction: () => handleExtractSelectedEntries(checkedEntries)
          })
        : Action({
            title: t('actionExtractAll'),
            icon: Icon.Download,
            onAction: handleExtractAll
          }),
      Action({
        title: t('actionRevealArchive'),
        icon: Icon.Folder,
        onAction: handleRevealArchive
      }),
      Action({
        title: t('actionExtractSingle', { name: entry.name }),
        icon: Icon.Document,
        shortcut: { modifiers: ['ctrl'], key: 's' },
        onAction: () => handleExtractSelectedEntries([entry])
      })
    ]
    if (hasChecked) {
      panelChildren.push(
        Action({
          title: t('actionExtractAll'),
          icon: Icon.Download,
          shortcut: { modifiers: ['ctrl'], key: 'e' },
          onAction: handleExtractAll
        })
      )
    }
    panelChildren.push(
      Action({
        title: t('actionVerifyArchive'),
        icon: Icon.CheckCircle,
        shortcut: { modifiers: ['ctrl'], key: 't' },
        onAction: handleVerifyArchive
      }),
      Action({
        title: t('actionCopyPathCrc'),
        icon: Icon.CopyClipboard,
        shortcut: { modifiers: ['ctrl', 'shift'], key: 'c' },
        onAction: async () => {
          const info = `${entry.entryName} (CRC32: ${entry.crc32}, ${formatBytes(entry.uncompressedSize)})`
          try {
            await Clipboard.copy(info)
          } catch (err) {
            await showToast({ style: Toast.Style.Failure, title: t('copyFailedTitle'), message: errorText(err) })
            return
          }
          await showToast({ style: Toast.Style.Success, title: t('copiedPathTitle'), message: info })
        }
      }),
      Action({
        title: t('actionTrashArchive'),
        icon: Icon.Trash,
        style: Action.Style.Destructive,
        shortcut: { modifiers: [], key: 'delete' },
        onAction: handleTrashArchive
      }),
      ActionPanel.Section({
        title: t('sectionList'),
        children: [
          ...(isExtracting ? [] : [removeArchiveAction()]),
          pickFilesAction(),
          pickFolderAction(),
          toggleAllAction(),
          clearListAction()
        ]
      })
    )

    return List.Item({
      id: entry.id,
      title: entry.name,
      subtitle: `${entry.entryName} · CRC32: ${entry.crc32}`,
      checkable: !entry.hasPathTraversalRisk,
      checked: isChecked,
      onCheckChange: (checked) => {
        if (entry.hasPathTraversalRisk) return
        if (checked) {
          setCheckedEntryIds(Array.from(new Set([...checkedEntryIds, entry.id])))
        } else {
          setCheckedEntryIds(checkedEntryIds.filter((id) => id !== entry.id))
        }
      },
      icon: {
        source: entry.hasPathTraversalRisk ? Icon.ExclamationMark : Icon.Document,
        tintColor: entry.hasPathTraversalRisk ? Color.Red : Color.SecondaryText
      },
      accessories: [
        { progress: { value: volRatio } },
        entry.hasPathTraversalRisk
          ? { tag: { value: t('tagUnsafePath'), color: Color.Red } }
          : { tag: { value: `${getCategoryLabel(entry.category)} -${entry.compressionRatio}%` } },
        { text: formatBytes(entry.uncompressedSize) }
      ],
      actions: ActionPanel({ title: entry.name, children: panelChildren })
    })
  })

  const currentArchive = archives.find((a) => pathKey(a.path) === pathKey(selectedArchivePath))
  const currentArchiveName =
    currentArchive?.name || selectedArchivePath.split(/[\\/]/).pop() || t('noArchiveSelected')
  const displayArchiveSizeBytes =
    archiveMeta.archiveSizeBytes > 0 ? archiveMeta.archiveSizeBytes : currentArchive?.sizeBytes ?? null

  const summaryText = isImporting
    ? t('summaryImporting', { dirs: importProgress?.visitedDirs ?? 0, files: importProgress?.matchedFiles ?? 0 })
    : archives.length === 0
      ? t('summaryEmpty')
      : inspectError
        ? t('summaryInspectError', { name: currentArchiveName, error: inspectError })
        : t('summaryNormal', {
            name: currentArchiveName,
            size: formatBytes(displayArchiveSizeBytes),
            count: entries.length,
            uncomp: formatBytes(archiveMeta.totalUncompressedBytes),
            checked: hasChecked ? t('summaryCheckedPart', { count: checkedEntries.length }) : ''
          })

  const emptyText = isImporting
    ? t('emptyImporting')
    : archives.length === 0
      ? t('emptyNoArchives')
      : inspectError
        ? t('emptyInspectError', { error: inspectError })
        : isLoading
          ? t('emptyLoading')
          : entries.length === 0
            ? t('emptyNoFiles')
            : t('emptyNoMatch')

  const diagnosticItems =
    entries.length > 0
      ? [
          List.Item({
            id: 'diag-root-mode',
            title: t('diagRootTitle'),
            subtitle: archiveMeta.hasSingleRootFolder ? t('diagRootSingleSub') : t('diagRootFolderSub'),
            icon: { source: Icon.Folder, tintColor: Color.SecondaryText },
            accessories: [{ tag: { value: archiveMeta.hasSingleRootFolder ? t('diagRootSingleTag') : t('diagRootFolderTag') } }],
            actions: ActionPanel({
              title: t('diagRootTitle'),
              children: [Action({ title: t('actionExtractAll'), icon: Icon.Download, onAction: handleExtractAll })]
            })
          }),
          List.Item({
            id: 'diag-security',
            title: t('diagSecurityTitle'),
            subtitle:
              archiveMeta.traversalRiskCount > 0
                ? t('diagSecurityRiskSub', { count: archiveMeta.traversalRiskCount })
                : archiveMeta.isEncrypted
                  ? t('diagSecurityEncSub')
                  : t('diagSecuritySafeSub'),
            icon: {
              source: archiveMeta.traversalRiskCount > 0 ? Icon.ExclamationMark : Icon.CheckCircle,
              tintColor: archiveMeta.traversalRiskCount > 0 ? Color.Red : Color.SecondaryText
            },
            accessories: [
              archiveMeta.traversalRiskCount > 0
                ? { tag: { value: t('diagSecurityRiskTag', { count: archiveMeta.traversalRiskCount }), color: Color.Red } }
                : { tag: { value: archiveMeta.isEncrypted ? t('diagSecurityEncTag') : t('diagSecuritySafeTag') } }
            ],
            actions: ActionPanel({
              title: t('diagVerifyPanelTitle'),
              children: [
                Action({
                  title: t('actionVerifyArchive'),
                  icon: Icon.CheckCircle,
                  onAction: handleVerifyArchive
                })
              ]
            })
          })
        ]
      : []

  const listActions = ActionPanel({
    children: [
      pickFilesAction(),
      pickFolderAction(),
      ...(archives.length > 0
        ? [
            ActionPanel.Section({
              title: t('sectionList'),
              children: [...(selectedArchivePath && !isExtracting ? [removeArchiveAction()] : []), clearListAction()]
            })
          ]
        : [])
    ]
  })

  return List({
    ...fileInputProps,
    searchBarPlaceholder: t('searchPlaceholder'),
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    isLoading: isImporting || isLoading || isExtracting,
    actions: listActions,
    searchBarAccessory: List.Dropdown({
      tooltip: t('dropdownTooltip'),
      value: selectedArchivePath,
      onChange: (val) => {
        if (val) void handleSelectArchive(val)
      },
      children: archives.map((arc) =>
        List.Dropdown.Item({
          title: `${arc.name} (${formatBytes(arc.sizeBytes)})`,
          value: arc.path
        })
      )
    }),
    filterBar: FilterBar({
      summaryText,
      actions: [
        {
          id: 'pick-files',
          label: t('btnPickFiles'),
          title: t('btnPickFiles'),
          style: 'secondary',
          onAction: handlePickFiles
        },
        {
          id: 'pick-folder',
          label: t('btnPickFolder'),
          title: t('btnPickFolder'),
          style: 'secondary',
          onAction: handlePickFolder
        }
      ]
    }),
    subList: {
      title: hasChecked
        ? t('subListTitleChecked', { count: checkedEntries.length })
        : t('subListTitleDefault'),
      subtitle: t('subListSubtitle', { count: filteredEntries.length, size: formatBytes(archiveMeta.totalUncompressedBytes) }),
      checkable: filteredEntries.length > 0,
      checked:
        filteredEntries.length > 0 && filteredEntries.every((e) => checkedSet.has(e.id))
          ? true
          : filteredEntries.some((e) => checkedSet.has(e.id))
            ? 'indeterminate'
            : false,
      onCheckChange: (checked) => {
        const safeIds = filteredEntries.filter((e) => !e.hasPathTraversalRisk).map((e) => e.id)
        setCheckedEntryIds(checked ? safeIds : [])
      },
      emptyText,
      items: rightSubListItems
    },
    children: [
      List.Section({
        title: t('sectionFilterByCategory'),
        children: categoryGroups.map((grp) => {
          const stat = categoryCounts.get(grp.id) || { count: 0, bytes: 0 }
          const isSelected = selectedCategory === grp.id
          return List.Item({
            id: `nav-cat-${grp.id}`,
            title: grp.name,
            subtitle: formatBytes(stat.bytes),
            icon: {
              source: isSelected ? Icon.CheckCircle : Icon.Folder,
              tintColor: Color.SecondaryText
            },
            accessories: [{ text: t('itemCountText', { count: stat.count }) }],
            actions: ActionPanel({
              title: grp.name,
              children: [
                Action({
                  title: t('actionFilterCategory', { name: grp.name }),
                  icon: Icon.Filter,
                  onAction: () => setSelectedCategory(grp.id)
                }),
                Action({
                  title: t('actionExtractAll'),
                  icon: Icon.Download,
                  onAction: handleExtractAll
                }),
                ...(archives.length > 0 && selectedArchivePath
                  ? [
                      Action({
                        title: t('actionVerifyArchive'),
                        icon: Icon.CheckCircle,
                        shortcut: { modifiers: ['ctrl'], key: 't' },
                        onAction: handleVerifyArchive
                      })
                    ]
                  : []),
                ...(archives.length > 0
                  ? [
                      ActionPanel.Section({
                        title: t('sectionList'),
                        children: [
                          ...(isExtracting ? [] : [removeArchiveAction()]),
                          pickFilesAction(),
                          pickFolderAction(),
                          clearListAction()
                        ]
                      })
                    ]
                  : [])
              ]
            })
          })
        })
      }),
      ...(diagnosticItems.length > 0 ? [List.Section({ title: t('sectionPreCheck'), children: diagnosticItems })] : [])
    ]
  })
}

export default ArchiveManagerCommand
