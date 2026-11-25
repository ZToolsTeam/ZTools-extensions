import {
  List,
  ActionPanel,
  Action,
  Icon,
  useLocale,
  useState,
  useEffect,
  useRef,
  showToast,
  Toast,
  FilterBar,
  confirmAlert,
  KeyboardShortcut
} from '@ztools/declarative-ui'
import { t } from './i18n.js'
import {
  PDF_IMPORT_RULES,
  PDF_IMPORT_SUPPORTED_TEXT,
  PdfBatchResult,
  PdfTaskOutcome,
  RealPdfDocItem,
  createPdfImportTransport,
  describeBatchResult,
  formatBytes,
  getAvailableTools,
  getTextExtractionLimitNote,
  getUnavailableFeaturesNote,
  openPdfDocument,
  openPdfFileLocation,
  runPdfTool,
  toPdfDocItem
} from './logic.js'
import { isRealElectronHost } from './native-ipc.js'
import { isDeclarativeFileInputSupported } from './host-compat.js'
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
  pickFiles,
  pickFolder,
  summarizeImport
} from './file-import.js'
import { resolveErrorMessage } from './error-i18n.js'

export * from './logic.js'

function sizeText(bytes: number | null): string {
  return bytes === null ? t('sizeUnknown') : formatBytes(bytes)
}

interface ImportProgress {
  visitedDirs: number
  matchedFiles: number
}

type ImportTask = (
  signal: AbortSignal,
  onProgress: (progress: ImportProgress) => void
) => Promise<FileImportResult>

const SHORTCUT_PICK_FILES: KeyboardShortcut = { modifiers: ['ctrl'], key: 'o' }
const SHORTCUT_PICK_FOLDER: KeyboardShortcut = { modifiers: ['ctrl', 'shift'], key: 'o' }
const SHORTCUT_REMOVE: KeyboardShortcut = { modifiers: ['ctrl'], key: 'backspace' }
const SHORTCUT_CLEAR: KeyboardShortcut = { modifiers: ['ctrl', 'shift'], key: 'backspace' }
const SHORTCUT_TOGGLE_ALL: KeyboardShortcut = { modifiers: ['ctrl'], key: 'a' }

export function PdfCommand() {
  useLocale()
  const tools = getAvailableTools()
  const transport = createPdfImportTransport()
  const [searchText, setSearchText] = useState('')
  const [activeToolId, setActiveToolId] = useState<string>(tools[0]?.id ?? '')
  const [files, setFiles] = useState<RealPdfDocItem[]>([])
  const [checkedIds, setCheckedIds] = useState<string[]>([])
  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [runningIds, setRunningIds] = useState<string[]>([])
  const [lastResult, setLastResult] = useState<PdfBatchResult | null>(null)
  // 防止上一批还没写完时再次触发（状态更新前的连续回车）
  const busyRef = useRef(false)
  const mountedRef = useRef(true)
  // 导入批次号：清空列表、卸载或开始新导入时递增，过期批次的结果直接丢弃
  const importSeqRef = useRef(0)
  const importAbortRef = useRef<AbortController | null>(null)
  // 合并导入结果时需要同步拿到最新列表（setState 回调里不能弹提示）
  const filesRef = useRef<RealPdfDocItem[]>([])
  filesRef.current = files

  useEffect(() => {
    mountedRef.current = true
    let dispose: unknown = null
    let eventsApi:
      | {
          on?: (ev: string, cb: (payload: unknown) => void) => unknown
          off?: (ev: string, cb: (payload: unknown) => void) => void
        }
      | undefined
    const handleLegacyDrop = (raw: unknown) => {
      const input = normalizeFileInput(raw)
      if (input.paths.length > 0) handleFileInput(input)
    }

    if (!isDeclarativeFileInputSupported()) {
      const w = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : null
      eventsApi = (w?.ztools as { events?: typeof eventsApi } | undefined)?.events
      if (eventsApi && typeof eventsApi.on === 'function') {
        dispose = eventsApi.on('plugin_files_dropped', handleLegacyDrop)
      }
    }

    return () => {
      mountedRef.current = false
      importSeqRef.current += 1
      importAbortRef.current?.abort()
      if (typeof dispose === 'function') {
        ;(dispose as () => void)()
      } else if (eventsApi && typeof eventsApi.off === 'function') {
        eventsApi.off('plugin_files_dropped', handleLegacyDrop)
      }
    }
  }, [])

  /** 所有导入入口共用：合并去重、默认勾选新文件、给出提示 */
  function applyImportResult(result: FileImportResult) {
    const incoming = result.files.map(toPdfDocItem)
    const { merged, added, duplicates } = mergeByPath(filesRef.current, incoming, f => f.path)
    if (added.length > 0) {
      filesRef.current = merged
      setFiles(merged)
      setCheckedIds(prev => Array.from(new Set([...prev, ...added.map(f => f.id)])))
    }
    const summary = summarizeImport(result, { added: added.length, duplicates }, PDF_IMPORT_SUPPORTED_TEXT)
    if (summary) {
      showToast({
        style: summary.ok ? Toast.Style.Success : Toast.Style.Failure,
        title: summary.title,
        message: summary.message
      })
    }
  }

  async function runImport(task: ImportTask) {
    importAbortRef.current?.abort()
    const controller = new AbortController()
    importAbortRef.current = controller
    const seq = ++importSeqRef.current
    setIsImporting(true)
    setImportProgress(null)
    try {
      const result = await task(controller.signal, progress => {
        if (mountedRef.current && seq === importSeqRef.current) setImportProgress(progress)
      })
      if (!mountedRef.current || seq !== importSeqRef.current || controller.signal.aborted) return
      applyImportResult(result)
    } catch (err) {
      if (!mountedRef.current || seq !== importSeqRef.current) return
      showToast({ style: Toast.Style.Failure, title: t('toastImportFailed'), message: friendlyFileError(err) })
    } finally {
      if (mountedRef.current && seq === importSeqRef.current) {
        importAbortRef.current = null
        setIsImporting(false)
        setImportProgress(null)
      }
    }
  }

  function handlePickFiles() {
    void runImport(() => pickFiles(transport, PDF_IMPORT_RULES, { title: t('pickFilesTitle'), filterName: t('pickFilesFilter') }))
  }

  function handlePickFolder() {
    void runImport(async (signal, onProgress) => {
      const picked = await pickFolder(transport, { title: t('pickFolderTitle') })
      if (picked.canceled || signal.aborted) return { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: true }
      if (picked.error || !picked.folderPath) {
        return { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: false, error: resolveErrorMessage(picked, t('errNoFolderPicked')) }
      }
      if (isVolumeRoot(picked.folderPath)) {
        const confirmed = await confirmAlert({
          title: t('confirmVolumeTitle', { path: picked.folderPath }),
          message: t('confirmVolumeMessage'),
          primaryAction: { title: t('confirmVolumePrimary'), style: 'default' }
        })
        if (!confirmed || signal.aborted) return { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: true }
      }
      return collectFolderFiles(transport, picked.folderPath, PDF_IMPORT_RULES, { signal, onProgress })
    })
  }

  function handleFileInput(input: NormalizedFileInput) {
    void runImport((signal, onProgress) =>
      expandInputPaths(transport, input.paths, PDF_IMPORT_RULES, {
        knownDirectories: input.directories,
        signal,
        onProgress
      })
    )
  }

  function handleRemove(file: RealPdfDocItem) {
    if (runningIds.includes(file.id)) {
      showToast({ style: Toast.Style.Failure, title: t('toastRunningRemove') })
      return
    }
    const next = filesRef.current.filter(f => f.id !== file.id)
    filesRef.current = next
    setFiles(next)
    setCheckedIds(prev => prev.filter(id => id !== file.id))
  }

  function handleClear() {
    if (busyRef.current) {
      showToast({ style: Toast.Style.Failure, title: t('toastBusyClear') })
      return
    }
    // 让进行中的导入作废，结果不再加入列表
    importSeqRef.current += 1
    importAbortRef.current?.abort()
    importAbortRef.current = null
    setIsImporting(false)
    setImportProgress(null)
    filesRef.current = []
    setFiles([])
    setCheckedIds([])
    setLastResult(null)
  }

  const fileInputProps = createImportInputProps(handleFileInput, {
    dropTitle: t('dropTitle'),
    dropSubtitle: t('dropSubtitle')
  })

  const activeTool = tools.find(item => item.id === activeToolId) ?? tools[0]
  const queueFiles = activeTool ? files.filter(f => f.docType === activeTool.inputType) : []
  const selectedFiles = queueFiles.filter(f => checkedIds.includes(f.id))
  const selectedBytes = selectedFiles.reduce((s, f) => s + (f.sizeBytes ?? 0), 0)
  const selectedUnknown = selectedFiles.some(f => f.sizeBytes === null)
  const q = searchText.trim().toLowerCase()
  const visibleFiles = queueFiles.filter(
    f => !q || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
  )
  const outcomeById = new Map<string, PdfTaskOutcome>()
  for (const o of [...(lastResult?.succeeded ?? []), ...(lastResult?.failed ?? [])]) {
    outcomeById.set(o.file.id, o)
  }
  const lastOutputPath = lastResult?.succeeded[lastResult.succeeded.length - 1]?.outputPath ?? ''
  const allVisibleChecked = visibleFiles.length > 0 && visibleFiles.every(f => checkedIds.includes(f.id))

  async function handleRun(targets: RealPdfDocItem[]) {
    if (!activeTool) {
      showToast({ style: Toast.Style.Failure, title: t('toastNoToolAvailable') })
      return
    }
    if (busyRef.current) {
      showToast({ style: Toast.Style.Failure, title: t('toastBatchBusy') })
      return
    }
    if (targets.length === 0) {
      showToast({ style: Toast.Style.Failure, title: t('batchSelectPdfFirst') })
      return
    }
    busyRef.current = true
    setIsRunning(true)
    setRunningIds(targets.map(f => f.id))
    try {
      const result = await runPdfTool(activeTool.id, targets)
      if (!mountedRef.current) return
      setLastResult(result)
      const summary = describeBatchResult(result)
      showToast({
        style: summary.ok ? Toast.Style.Success : Toast.Style.Failure,
        title: summary.title,
        message: summary.message
      })
    } catch (err) {
      if (!mountedRef.current) return
      showToast({ style: Toast.Style.Failure, title: t('toastToolFailed', { tag: activeTool.tag }), message: friendlyFileError(err) })
    } finally {
      busyRef.current = false
      if (mountedRef.current) {
        setIsRunning(false)
        setRunningIds([])
      }
    }
  }

  async function handleOpen(path: string, mode: 'open' | 'reveal') {
    const ok = mode === 'open' ? await openPdfDocument(path) : await openPdfFileLocation(path)
    if (!mountedRef.current) return
    if (!ok) {
      showToast({
        style: Toast.Style.Failure,
        title: mode === 'open' ? t('toastOpenFailed') : t('toastRevealFailed'),
        message: path
      })
    }
  }

  function toggleAllVisible() {
    const visibleIds = visibleFiles.map(f => f.id)
    setCheckedIds(prev =>
      allVisibleChecked ? prev.filter(id => !visibleIds.includes(id)) : Array.from(new Set([...prev, ...visibleIds]))
    )
  }

  const pickFilesAction = () =>
    Action({ title: t('actionPickFilesEllipsis'), icon: Icon.Plus, shortcut: SHORTCUT_PICK_FILES, onAction: handlePickFiles })
  const pickFolderAction = () =>
    Action({ title: t('actionPickFolderEllipsis'), icon: Icon.Folder, shortcut: SHORTCUT_PICK_FOLDER, onAction: handlePickFolder })

  const maxDocBytes = Math.max(1, ...visibleFiles.map(f => f.sizeBytes ?? 0))
  const queueItems = visibleFiles.map(f => {
    const isChecked = checkedIds.includes(f.id)
    const outcome = outcomeById.get(f.id)
    const volRatio = Math.max(2, Math.min(100, Math.round(((f.sizeBytes ?? 0) / maxDocBytes) * 100)))
    const runChecked = selectedFiles.length > 0
    const isProcessing = runningIds.includes(f.id)
    const actions = [
      Action({
        title: runChecked ? t('actionExportChecked', { count: selectedFiles.length }) : t('actionExportCurrent'),
        icon: Icon.Play,
        onAction: () => handleRun(runChecked ? selectedFiles : [f])
      }),
      ...(runChecked
        ? [
            Action({
              title: t('actionExportOnlyCurrent'),
              icon: Icon.Document,
              onAction: () => handleRun([f])
            })
          ]
        : []),
      ...(lastOutputPath
        ? [
            Action({
              title: t('actionRevealLastOutput'),
              icon: Icon.Folder,
              onAction: () => handleOpen(lastOutputPath, 'reveal')
            })
          ]
        : []),
      Action({
        title: t('actionOpenPdf'),
        icon: Icon.Eye,
        onAction: () => handleOpen(f.path, 'open')
      }),
      Action({
        title: t('actionRevealPdf'),
        icon: Icon.Folder,
        onAction: () => handleOpen(f.path, 'reveal')
      }),
      ActionPanel.Section({
        title: t('sectionList'),
        children: [
          ...(isProcessing
            ? []
            : [
                Action({
                  title: t('actionRemoveFromList'),
                  icon: Icon.Minus,
                  shortcut: SHORTCUT_REMOVE,
                  onAction: () => handleRemove(f)
                })
              ]),
          pickFilesAction(),
          pickFolderAction(),
          Action({
            title: allVisibleChecked ? t('actionUnselectAll') : t('actionSelectAll'),
            icon: Icon.CheckCircle,
            shortcut: SHORTCUT_TOGGLE_ALL,
            onAction: toggleAllVisible
          }),
          Action({
            title: t('actionClearList'),
            icon: Icon.Trash,
            style: Action.Style.Destructive,
            shortcut: SHORTCUT_CLEAR,
            onAction: handleClear
          })
        ]
      })
    ]

    return List.Item({
      id: f.id,
      title: f.name,
      subtitle: f.parentDir,
      checkable: true,
      checked: isChecked,
      onCheckChange: c => {
        setCheckedIds(prev => (c ? Array.from(new Set([...prev, f.id])) : prev.filter(id => id !== f.id)))
      },
      icon: { source: Icon.Document },
      accessories: [
        { progress: { value: volRatio } },
        ...(outcome ? [{ tag: { value: outcome.ok ? t('tagExported') : t('tagExportFailed') } }] : []),
        { text: sizeText(f.sizeBytes) }
      ],
      actions: ActionPanel({ title: f.name, children: actions })
    })
  })

  const lastSummary = !lastResult
    ? ''
    : lastResult.error
      ? resolveErrorMessage(lastResult, t('tagExportFailed'))
      : t('lastSummaryStats', { ok: lastResult.succeeded.length, fail: lastResult.failed.length })
  const inClient = isRealElectronHost()
  const selectedBytesText = `${formatBytes(selectedBytes)}${selectedUnknown ? t('selectedUnknownSuffix') : ''}`
  const summaryText = isImporting
    ? t('summaryImporting', { dirs: importProgress?.visitedDirs ?? 0, files: importProgress?.matchedFiles ?? 0 })
    : files.length === 0
      ? inClient
        ? t('summaryEmptyClient')
        : t('outsideClient')
      : t('summarySelected', { selected: selectedFiles.length, total: queueFiles.length, size: selectedBytesText })
  const emptyText = !inClient
    ? t('outsideClient')
    : q && files.length > 0
      ? t('emptyNoMatch')
      : t('summaryEmptyClient')

  return List({
    ...fileInputProps,
    searchBarPlaceholder: t('searchPlaceholder'),
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    isLoading: isImporting || isRunning,
    actions: ActionPanel({
      children: [pickFilesAction(), pickFolderAction()]
    }),
    searchBarAccessory: List.Dropdown({
      tooltip: t('formatTooltip'),
      value: activeTool?.id ?? '',
      onChange: val => setActiveToolId(val),
      children: tools.map(m =>
        List.Dropdown.Item({
          title: m.tag,
          value: m.id
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
    workbenchPanel: {
      title: t('panelTitle'),
      subtitle: activeTool?.title ?? '',
      fields: [
        {
          id: 'wb-format',
          label: t('fieldFormatLabel'),
          type: 'info',
          value: activeTool?.outputExt === '.html' ? t('fieldFormatHtml') : t('fieldFormatTxt')
        },
        {
          id: 'wb-outdir',
          label: t('fieldOutdirLabel'),
          type: 'info',
          value: t('fieldOutdirValue')
        },
        {
          id: 'wb-limit',
          label: t('fieldLimitLabel'),
          type: 'info',
          value: getTextExtractionLimitNote()
        },
        {
          id: 'wb-unavailable',
          label: t('fieldUnavailableLabel'),
          type: 'info',
          value: getUnavailableFeaturesNote()
        }
      ],
      previewCard: {
        title: t('previewTitle'),
        badge: activeTool?.tag ?? '',
        subtitle: isRunning ? t('previewRunning') : lastSummary || t('previewIdle'),
        metrics: [
          { label: t('metricSelectedFiles'), value: `${selectedFiles.length} / ${queueFiles.length}` },
          { label: t('metricSelectedSize'), value: selectedBytesText }
        ]
      }
    },
    subList: {
      title: t('subListTitle'),
      subtitle: t('subListSubtitle', { count: visibleFiles.length }),
      checkable: visibleFiles.length > 0,
      checked: allVisibleChecked ? true : visibleFiles.some(f => checkedIds.includes(f.id)) ? 'indeterminate' : false,
      onCheckChange: checked => {
        const visibleIds = visibleFiles.map(f => f.id)
        setCheckedIds(prev =>
          checked ? Array.from(new Set([...prev, ...visibleIds])) : prev.filter(id => !visibleIds.includes(id))
        )
      },
      emptyText,
      items: queueItems
    },
    children: [
      List.Section({
        title: t('sectionPdfTitle', { count: visibleFiles.length }),
        children: queueItems
      })
    ]
  })
}

export default PdfCommand
