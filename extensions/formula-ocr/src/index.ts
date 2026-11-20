import {
  List,
  Detail,
  Form,
  ActionPanel,
  Action,
  Icon,
  Clipboard,
  LocalStorage,
  confirmAlert,
  useState,
  useEffect,
  useRef,
  useCachedState,
  useLocale,
  useNavigation,
  showToast,
  Toast
} from '@ztools/declarative-ui'
import {
  COPY_FORMATS,
  FORMULA_IMPORT_MAX_FILES,
  FORMULA_IMPORT_RULES,
  FORMULA_IMPORT_SUPPORTED_TEXT,
  MODEL_MISSING_MESSAGE,
  NOT_IN_CLIENT_MESSAGE,
  type CopyFormat,
  type FormulaOutcome,
  type HostTransport,
  type ModelStatus,
  cancelModelDownload,
  createFileImportTransport,
  downloadModel,
  fileNameOf,
  formatMegabytes,
  formulaMarkdown,
  formulaPreviewMarkdown,
  getClientTransport,
  getCopyFormats,
  getModelMissingMessage,
  getModelStatus,
  getNotInClientMessage,
  notify,
  pickImageFiles,
  recognizeClipboardImage,
  recognizeImageFile,
  recognizeScreenRegion,
  resolveCopyFormat,
  truncate
} from './formula-service.js'
import { t } from './i18n.js'

import { isDeclarativeFileInputSupported } from './host-compat.js'
import {
  type FileImportResult,
  type FileImportTransport,
  type NormalizedFileInput,
  createImportInputProps,
  expandInputPaths,
  friendlyFileError,
  normalizeFileInput,
  pathKey,
  pickFolderWithConfirm,
  runControlledImport,
  summarizeImport
} from './file-import.js'

export * from './formula-service.js'

const FORMAT_KEY = 'copyFormat'
/** 下载中每隔多久刷新一次进度 */
const PROGRESS_INTERVAL_MS = 500

export interface FormulaEntry {
  id: string
  source: 'file' | 'region' | 'clipboard'
  title: string
  /** 图片文件路径；框选和剪贴板没有 */
  path?: string
  /** queued：批量添加后等待识别 */
  status: 'queued' | 'running' | 'done' | 'failed'
  latex: string
  lowConfidence?: boolean
  previewDataUrl?: string
  edited?: boolean
  error?: string
}

const INTERRUPTED_MESSAGE = '识别被中断'

function isPending(entry: FormulaEntry): boolean {
  return entry.status === 'queued' || entry.status === 'running'
}

async function loadCopyFormat(): Promise<CopyFormat> {
  try {
    return resolveCopyFormat(await LocalStorage.getItem(FORMAT_KEY))
  } catch {
    return resolveCopyFormat(undefined)
  }
}

function requireTransport(): HostTransport {
  const transport = getClientTransport()
  if (!transport) throw new Error(getNotInClientMessage())
  return transport
}

function timeLabel(): string {
  const now = new Date()
  return [now.getHours(), now.getMinutes(), now.getSeconds()].map(value => String(value).padStart(2, '0')).join(':')
}

let entrySeq = 0
function newEntryId(): string {
  entrySeq += 1
  return `formula-${Date.now()}-${entrySeq}`
}

function applyOutcome(entry: FormulaEntry, outcome: FormulaOutcome): FormulaEntry {
  return outcome.ok
    ? { ...entry, status: 'done', latex: outcome.latex, lowConfidence: outcome.lowConfidence, previewDataUrl: outcome.previewDataUrl, edited: false, error: undefined }
    : { ...entry, status: 'failed', latex: '', lowConfidence: undefined, previewDataUrl: undefined, edited: false, error: outcome.error }
}

/** 会话最多保留 50 条已结束结果；预览总量最多 4 MiB，优先保留最近的原图。 */
export function retainFormulaEntries(entries: FormulaEntry[]): FormulaEntry[] {
  let finished = 0
  let previewSize = 0
  return entries.filter(entry => isPending(entry) || ++finished <= 50).map(entry => {
    previewSize += entry.previewDataUrl?.length ?? 0
    return previewSize > 4 * 1024 * 1024 && entry.previewDataUrl ? { ...entry, previewDataUrl: undefined } : entry
  })
}

export function FormulaEditor({ entry, onSave }: { entry: FormulaEntry; onSave: (latex: string) => boolean }) {
  useLocale()
  const { pop } = useNavigation()
  const [latex, setLatex] = useState(entry.latex)
  const [error, setError] = useState<string | undefined>(undefined)
  const save = () => {
    const value = latex.trim()
    if (!value) { setError(t('errEnterLatex')); return }
    if (value.length > 16_384) { setError(t('errLatexTooLong')); return }
    if (onSave(value)) pop()
  }
  return Form({
    navigationTitle: t('editFormNavTitle'),
    actions: ActionPanel({ children: [Action.SubmitForm({ title: t('editFormSaveBtn'), icon: Icon.Check, onSubmit: save })] }),
    children: [
      Form.TextArea({ id: 'latex', title: 'LaTeX', value: latex, monospace: true, autoFocus: true, error,
        info: t('editFormInfo'), onChange: value => { setLatex(value); setError(undefined) } }),
      Form.Description({ markdown: formulaPreviewMarkdown(latex, entry.previewDataUrl) })
    ]
  })
}

/** 无界面命令共用：识别后按保存的格式复制 */
async function copyOutcome(outcome: FormulaOutcome): Promise<string> {
  if (!outcome.ok) throw new Error(outcome.error)
  const format = await loadCopyFormat()
  await Clipboard.copy(format.wrap(outcome.latex))
  return outcome.lowConfidence ? t('copiedLowConf') : t('copiedOk')
}

/** 无界面命令：框选屏幕上的公式，识别后复制 */
export async function formulaRegion(): Promise<string> {
  const transport = requireTransport()
  const outcome = await recognizeScreenRegion(transport, false)
  if (!outcome.ok && outcome.canceled) return t('canceledRegion')
  const message = await copyOutcome(outcome)
  // 框选时 ZTools 窗口已经收起，用系统通知告诉用户结果
  await notify(transport, message, truncate(outcome.ok ? outcome.latex : '', 80))
  return message
}

/** 无界面命令：识别剪贴板图片里的公式，结果复制回剪贴板 */
export async function formulaClipboard(): Promise<string> {
  return copyOutcome(await recognizeClipboardImage(requireTransport()))
}

export function FormulaCommand() {
  useLocale()
  const { push } = useNavigation()
  const transport = getClientTransport()
  const copyFormats = getCopyFormats()
  const [format, setFormat] = useState<CopyFormat>(() => getCopyFormats()[0]!)
  const [model, setModel] = useState<ModelStatus | undefined>(undefined)
  const [modelError, setModelError] = useState<string | undefined>(undefined)
  const [entries, setCachedEntries] = useCachedState<FormulaEntry[]>('entries', [])
  function setEntries(change: FormulaEntry[] | ((previous: FormulaEntry[]) => FormulaEntry[])) {
    setCachedEntries(previous => retainFormulaEntries(typeof change === 'function' ? change(previous) : change))
  }
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  const modelRef = useRef(model)
  modelRef.current = model
  const [searchText, setSearchText] = useState('')
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | undefined>(undefined)
  const [importProgress, setImportProgress] = useState<{ visitedDirs: number; matchedFiles: number } | undefined>(undefined)
  const busyRef = useRef(false)
  const importingRef = useRef(false)
  const importSeqRef = useRef(0)
  const importAbortRef = useRef<AbortController | null>(null)
  const unmountedRef = useRef(false)
  const removedIdsRef = useRef<Set<string>>(new Set())

  async function refreshModel(host: HostTransport) {
    try {
      const next = await getModelStatus(host)
      if (unmountedRef.current) return
      setModel(next)
      setModelError(undefined)
    } catch (error) {
      if (unmountedRef.current) return
      setModelError(error instanceof Error ? error.message : String(error))
    }
  }

  useEffect(() => {
    unmountedRef.current = false
    void loadCopyFormat().then(nextFormat => {
      if (!unmountedRef.current) setFormat(nextFormat)
    })
    if (transport) void refreshModel(transport)
    // 上次关闭插件时还没识别完的条目不会再有结果，标为中断
    setEntries(previous => previous.some(isPending)
      ? previous.map(entry => (isPending(entry) ? { ...entry, status: 'failed', latex: '', error: t('interruptedMessage') } : entry))
      : previous)
    return () => {
      unmountedRef.current = true
      importSeqRef.current += 1
      importAbortRef.current?.abort()
      importAbortRef.current = null
    }
  }, [])

  // 下载在客户端进行（关掉插件也不中断），这里只轮询进度
  const downloading = model?.state === 'downloading'
  useEffect(() => {
    if (!downloading || !transport) return undefined
    const timer = setInterval(() => { void refreshModel(transport) }, PROGRESS_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [downloading])

  function changeFormat(id: string) {
    const next = resolveCopyFormat(id)
    setFormat(next)
    void LocalStorage.setItem(FORMAT_KEY, next.id).catch(() => undefined)
  }

  async function handleDownload() {
    if (!transport) return
    try {
      setModel(await downloadModel(transport))
      setModelError(undefined)
    } catch (error) {
      await showToast({ style: Toast.Style.Failure, title: t('toastCannotStartDownload'), message: error instanceof Error ? error.message : String(error) })
    }
  }

  async function handleCancelDownload() {
    if (!transport) return
    try {
      setModel(await cancelModelDownload(transport))
    } catch (error) {
      await showToast({ style: Toast.Style.Failure, title: t('toastCancelDownloadFailed'), message: error instanceof Error ? error.message : String(error) })
    }
  }

  function updateEntry(id: string, change: (entry: FormulaEntry) => FormulaEntry) {
    setEntries(previous => previous.map(entry => (entry.id === id ? change(entry) : entry)))
  }

  /** 同一时间只做一件事：框选、选择图片、识别都会占用识别组件 */
  async function exclusive(task: (host: HostTransport) => Promise<void>) {
    const activeTransport = getClientTransport() ?? transport
    if (!activeTransport) {
      await showToast({ style: Toast.Style.Failure, title: getNotInClientMessage() })
      return
    }
    if (busyRef.current || importingRef.current) {
      await showToast({
        style: Toast.Style.Failure,
        title: importingRef.current ? t('toastBusyImporting') : t('toastBusyRecognizing')
      })
      return
    }
    busyRef.current = true
    setBusy(true)
    try {
      await task(activeTransport)
    } finally {
      busyRef.current = false
      if (!unmountedRef.current) {
        setBusy(false)
        setProgress(undefined)
      }
    }
  }

  /** 模型在别处被删除等情况：识别时才发现没有模型，回到下载界面 */
  async function noteModelMissing(host: HostTransport, outcome: FormulaOutcome) {
    if (!outcome.ok && outcome.modelMissing) await refreshModel(host)
  }

  async function recognizeInto(host: HostTransport, entry: FormulaEntry, run: () => Promise<FormulaOutcome>): Promise<FormulaOutcome> {
    updateEntry(entry.id, current => ({ ...current, status: 'running', error: undefined }))
    const outcome = await run()
    if (!unmountedRef.current && !removedIdsRef.current.has(entry.id)) {
      updateEntry(entry.id, current => applyOutcome(current, outcome))
    }
    await noteModelMissing(host, outcome)
    return outcome
  }

  /** 新结果放在最前面；replaceId 是被重新识别的失败条目，用新结果替换它 */
  function addEntry(entry: FormulaEntry, replaceId?: string) {
    setEntries(previous => [entry, ...previous.filter(item => item.id !== replaceId)])
    setSelectedId(entry.id)
  }

  /** 截图和剪贴板只识别一张：成功就按当前格式复制，和无界面命令一致 */
  async function finishSingle(host: HostTransport, entry: FormulaEntry, outcome: FormulaOutcome, failureTitle: string, replaceId?: string) {
    await noteModelMissing(host, outcome)
    if (!outcome.ok && outcome.modelMissing) return
    addEntry(applyOutcome(entry, outcome), replaceId)
    if (outcome.ok) {
      await Clipboard.copy(format.wrap(outcome.latex))
      await showToast({
        style: Toast.Style.Success,
        title: outcome.lowConfidence ? t('toastCopiedLowConf') : t('toastRecognizedCopied'),
        message: truncate(outcome.latex)
      })
    } else {
      await showToast({ style: Toast.Style.Failure, title: failureTitle, message: outcome.error })
    }
  }

  async function handleRegion(replaceId?: string) {
    await exclusive(async host => {
      const entry: FormulaEntry = { id: newEntryId(), source: 'region', title: t('entryTitleRegion', { time: timeLabel() }), status: 'running', latex: '' }
      const outcome = await recognizeScreenRegion(host, true, true)
      if (!outcome.ok && outcome.canceled) return
      await finishSingle(host, entry, outcome, t('toastRegionFailed'), replaceId)
    })
  }

  async function handleClipboard(replaceId?: string) {
    await exclusive(async host => {
      const outcome = await recognizeClipboardImage(host, true)
      if (!outcome.ok && !outcome.empty && (outcome.error === t('errNoClipboardImage') || outcome.error === '剪贴板里没有图片')) {
        await showToast({ style: Toast.Style.Failure, title: t('errNoClipboardImage') })
        return
      }
      const entry: FormulaEntry = { id: newEntryId(), source: 'clipboard', title: t('entryTitleClipboard', { time: timeLabel() }), status: 'running', latex: '' }
      await finishSingle(host, entry, outcome, t('statusFailed'), replaceId)
    })
  }

  async function recognizeFormulaFiles(host: HostTransport, rawPaths: string[]) {
    const seenKeys = new Set<string>()
    const uniquePaths: string[] = []
    for (const filePath of rawPaths) {
      const key = pathKey(filePath)
      if (!key || seenKeys.has(key)) continue
      seenKeys.add(key)
      uniquePaths.push(filePath)
    }
    if (uniquePaths.length === 0) return
    // 已在列表里的公式图片复用原条目 ID 并移到最前面重新识别（Windows 路径忽略大小写）
    const reusableByPath = new Map<string, string>()
    for (const item of entriesRef.current) {
      if (item.path && !isPending(item)) reusableByPath.set(pathKey(item.path), item.id)
    }
    const batch: FormulaEntry[] = uniquePaths.map(filePath => ({
      id: reusableByPath.get(pathKey(filePath)) ?? newEntryId(),
      source: 'file',
      title: fileNameOf(filePath),
      path: filePath,
      status: 'queued',
      latex: ''
    }))
    const batchIdSet = new Set(batch.map(item => item.id))
    for (const id of batchIdSet) removedIdsRef.current.delete(id)
    setEntries(prev => [...batch, ...prev.filter(item => !batchIdSet.has(item.id))])
    setSelectedId(batch[0]!.id)
    let failedCount = 0
    for (let idx = 0; idx < batch.length; idx++) {
      if (unmountedRef.current) return
      const current = batch[idx]!
      if (removedIdsRef.current.has(current.id)) continue
      setProgress({ done: idx, total: batch.length })
      const outcome = await recognizeInto(host, current, () => recognizeImageFile(host, current.path as string, true))
      if (unmountedRef.current) return
      if (!outcome.ok) failedCount += 1
      // 模型不可用时后面的图片也识别不了，剩下的标为失败
      if (!outcome.ok && outcome.modelMissing) {
        const remainingIds = new Set(batch.slice(idx + 1).map(item => item.id))
        setEntries(prev => prev.map(item => (remainingIds.has(item.id) ? { ...item, status: 'failed', error: getModelMissingMessage() } : item)))
        failedCount += remainingIds.size
        break
      }
    }
    if (unmountedRef.current) return
    const succeededCount = batch.length - failedCount
    const summaryTitle = failedCount > 0 ? t('batchSummaryPartial', { ok: succeededCount, fail: failedCount }) : t('batchSummaryDone', { ok: succeededCount })
    await showToast({ style: failedCount > 0 ? Toast.Style.Failure : Toast.Style.Success, title: summaryTitle })
  }

  async function finishImportAndRecognize(result: FileImportResult, source: 'folder' | 'input', seq: number) {
    if (result.canceled) return
    if (result.error) {
      await showToast({ style: Toast.Style.Failure, title: t('toastImportFailed'), message: friendlyFileError(result.error) })
      return
    }
    if (result.files.length === 0) {
      if (source === 'input') {
        if (result.failedDirs.length > 0 && result.ignored === 0) {
          await showToast({ style: Toast.Style.Failure, title: t('toastImportFailed'), message: result.failedDirs[0]!.error })
        } else {
          await showToast({
            style: Toast.Style.Failure,
            title: t('toastDropSupportedImages'),
            message: t('toastSupportedExtsMsg', { exts: FORMULA_IMPORT_SUPPORTED_TEXT })
          })
        }
        return
      }
      const summary = summarizeImport(result, { added: 0 }, FORMULA_IMPORT_SUPPORTED_TEXT)
      if (summary) {
        await showToast({
          style: summary.ok ? Toast.Style.Success : Toast.Style.Failure,
          title: summary.title,
          message: summary.message
        })
      }
      return
    }
    if (modelRef.current?.state !== 'ready') {
      await showToast({ style: Toast.Style.Failure, title: getModelMissingMessage() })
      return
    }
    const paths = result.files.map(file => file.path)
    await exclusive(async activeHost => {
      if (seq !== importSeqRef.current || unmountedRef.current) return
      if (modelRef.current?.state !== 'ready') {
        await showToast({ style: Toast.Style.Failure, title: getModelMissingMessage() })
        return
      }
      if (result.truncated) {
        const notes: string[] = []
        if (result.ignored > 0) notes.push(t('toastTruncatedIgnored', { count: result.ignored }))
        if (result.failedDirs.length > 0) notes.push(t('toastTruncatedFailedDirs', { count: result.failedDirs.length }))
        const title =
          result.files.length >= FORMULA_IMPORT_MAX_FILES
            ? t('toastTruncatedOverMax', { max: FORMULA_IMPORT_MAX_FILES })
            : t('toastTruncatedPartial')
        await showToast({
          style: Toast.Style.Success,
          title,
          message: notes.join('; ') || t('toastTruncatedMaxMsg', { max: FORMULA_IMPORT_MAX_FILES })
        })
      } else if (result.failedDirs.length > 0) {
        await showToast({
          style: Toast.Style.Failure,
          title: t('toastTruncatedFailedDirs', { count: result.failedDirs.length }),
          message: t('toastPartialDirsMsg', { count: paths.length })
        })
      }
      await recognizeFormulaFiles(activeHost, paths)
    })
  }

  async function runImportAndRecognize(
    source: 'folder' | 'input',
    task: (importTransport: FileImportTransport, signal: AbortSignal, onProgress: (p: { visitedDirs: number; matchedFiles: number }) => void) => Promise<FileImportResult>
  ) {
    if (modelRef.current?.state !== 'ready') return void showToast({ style: Toast.Style.Failure, title: getModelMissingMessage() })
    const activeTransport = getClientTransport() ?? transport
    if (!activeTransport) return void showToast({ style: Toast.Style.Failure, title: getNotInClientMessage() })
    if (busyRef.current) return void showToast({ style: Toast.Style.Failure, title: t('toastBusyRecognizing') })
    const importTransport = createFileImportTransport(activeTransport)
    const outcome = await runControlledImport(
      {
        seqRef: importSeqRef,
        abortRef: importAbortRef,
        importingRef,
        unmountedRef,
        onStateChange: (nextImporting, p) => { setImporting(nextImporting); setImportProgress(p) },
        onError: async message => { await showToast({ style: Toast.Style.Failure, title: t('toastImportFailed'), message }) }
      },
      (signal, onProgress) => task(importTransport, signal, onProgress)
    )
    if (outcome) await finishImportAndRecognize(outcome.result, source, outcome.seq)
  }

  function handlePickFolder() {
    if (modelRef.current?.state !== 'ready') return void showToast({ style: Toast.Style.Failure, title: getModelMissingMessage() })
    void runImportAndRecognize('folder', (importTransport, signal, onProgress) =>
      pickFolderWithConfirm(importTransport, FORMULA_IMPORT_RULES, {
        title: t('dialogPickFolderTitle'),
        signal,
        onProgress,
        confirmVolume: folderPath => confirmAlert({
          title: t('confirmVolumeTitle', { path: folderPath }),
          message: t('confirmVolumeMsg', { max: FORMULA_IMPORT_MAX_FILES }),
          primaryAction: { title: t('confirmVolumeBtn'), style: 'default' }
        })
      })
    )
  }

  function handleFileInput(input: NormalizedFileInput) {
    if (modelRef.current?.state !== 'ready') {
      void showToast({ style: Toast.Style.Failure, title: getModelMissingMessage() })
      return
    }
    void runImportAndRecognize('input', (importTransport, signal, onProgress) =>
      expandInputPaths(importTransport, input.paths, FORMULA_IMPORT_RULES, {
        knownDirectories: input.directories,
        signal,
        onProgress
      })
    )
  }

  const fileInputHandlerRef = useRef(handleFileInput)
  fileInputHandlerRef.current = handleFileInput

  useEffect(() => {
    if (isDeclarativeFileInputSupported()) return
    const ztoolsEvents = (globalThis as { window?: { ztools?: { events?: { on?: (e: string, fn: (p: unknown) => void) => (() => void) | void; off?: (e: string, fn: (p: unknown) => void) => void } } } }).window?.ztools?.events
    if (typeof ztoolsEvents?.on !== 'function') return
    const onDropped = (envelope: unknown) => {
      if (modelRef.current?.state !== 'ready') {
        void showToast({ style: Toast.Style.Failure, title: getModelMissingMessage() })
        return
      }
      const input = normalizeFileInput(envelope)
      if (input.paths.length === 0) {
        void showToast({ style: Toast.Style.Failure, title: t('toastDropSupportedImages') })
        return
      }
      fileInputHandlerRef.current(input)
    }
    const unlisten = ztoolsEvents.on('plugin_files_dropped', onDropped)
    return () => {
      if (typeof unlisten === 'function') unlisten()
      else ztoolsEvents.off?.('plugin_files_dropped', onDropped)
    }
  }, [])

  async function handleAddImages() {
    await exclusive(async host => {
      try {
        const selectedPaths = await pickImageFiles(host)
        if (selectedPaths.length > 0) await recognizeFormulaFiles(host, selectedPaths)
      } catch (err) {
        await showToast({ style: Toast.Style.Failure, title: t('toastOpenPickFailed'), message: err instanceof Error ? err.message : String(err) })
      }
    })
  }

  async function handleRetry(entry: FormulaEntry) {
    if (!entry.path) return
    await exclusive(async host => {
      const outcome = await recognizeInto(host, entry, () => recognizeImageFile(host, entry.path as string, true))
      if (!outcome.ok) await showToast({ style: Toast.Style.Failure, title: t('statusFailed'), message: outcome.error })
    })
  }

  function handleRemove(entry: FormulaEntry) {
    removedIdsRef.current.add(entry.id)
    setEntries(previous => previous.filter(item => item.id !== entry.id))
  }

  /** 清空已结束的结果；正在识别的保留；同时作废进行中的导入 */
  function handleClear() {
    importSeqRef.current += 1
    importAbortRef.current?.abort()
    importAbortRef.current = null
    importingRef.current = false
    setImporting(false)
    setImportProgress(undefined)
    setEntries(previous => previous.filter(isPending))
    setSelectedId(undefined)
  }

  const formatDropdown = List.Dropdown({
    tooltip: t('tooltipCopyFormat'),
    value: format.id,
    onChange: changeFormat,
    children: copyFormats.map(item => List.Dropdown.Item({ title: item.title, value: item.id }))
  })

  // 不在客户端、查询状态失败、模型未就绪：只显示一行说明与对应动作，不显示识别入口
  if (!transport || modelError || !model || model.state !== 'ready') {
    return modelView()
  }

  function modelView() {
    const size = formatMegabytes(model?.totalBytes ?? 0)
    const intro = [
      t('introLine1'),
      '',
      t('introLine2', { size })
    ].join('\n')
    let item
    if (!transport) {
      item = List.Item({ id: 'not-in-client', title: getNotInClientMessage(), icon: Icon.Info })
    } else if (modelError) {
      item = List.Item({
        id: 'model-error',
        title: t('modelErrorTitle'),
        subtitle: modelError,
        icon: Icon.ExclamationMark,
        actions: ActionPanel({ children: [Action({ title: t('retryBtn'), icon: Icon.ArrowClockwise, onAction: () => refreshModel(transport) })] })
      })
    } else if (!model) {
      item = List.Item({ id: 'model-loading', title: t('modelCheckingTitle'), icon: Icon.Clock })
    } else if (model.state === 'downloading') {
      const ratio = model.totalBytes > 0 ? Math.min(1, model.receivedBytes / model.totalBytes) : 0
      item = List.Item({
        id: 'model-downloading',
        title: t('modelDownloadingTitle'),
        // 还没收到数据时多半在连接下载地址（不可用的地址要等超时才换下一个）
        subtitle: model.receivedBytes > 0 ? `${formatMegabytes(model.receivedBytes)} / ${size}` : t('modelConnectingSub'),
        icon: Icon.Download,
        accessories: [{ text: `${Math.floor(ratio * 100)}%` }],
        detail: Detail({ markdown: `${intro}\n\n${t('modelDownloadNote')}` }),
        actions: ActionPanel({ children: [Action({ title: t('cancelDownloadBtn'), icon: Icon.XMarkCircle, onAction: handleCancelDownload })] })
      })
    } else {
      const failed = model.state === 'failed'
      item = List.Item({
        id: 'model-download',
        title: failed ? t('modelDownloadFailedTitle') : t('modelDownloadTitle'),
        subtitle: failed ? model.error : t('modelDownloadSub', { size }),
        icon: failed ? Icon.ExclamationMark : Icon.Download,
        detail: Detail({ markdown: failed ? t('modelDownloadFailedMd', { error: model.error ?? '', intro }) : intro }),
        actions: ActionPanel({ children: [Action({ title: failed ? t('redownloadBtn') : t('downloadModelBtn'), icon: Icon.Download, onAction: handleDownload })] })
      })
    }
    return List({
      searchBarPlaceholder: t('modelViewPlaceholder'),
      isShowingDetail: Boolean(transport && model && !modelError),
      children: [item]
    })
  }

  const query = searchText.trim().toLowerCase()
  const visible = entries.filter(entry => !query || entry.title.toLowerCase().includes(query) || entry.latex.toLowerCase().includes(query))
  const doneCount = entries.filter(entry => entry.status === 'done').length

  const regionAction = Action({ title: t('actionRegion'), icon: Icon.Camera, shortcut: { modifiers: ['cmd'], key: 'n' }, onAction: () => handleRegion() })
  const addImagesAction = Action({ title: t('actionAddImages'), icon: Icon.Plus, shortcut: { modifiers: ['cmd'], key: 'o' }, onAction: handleAddImages })
  const pickFolderAction = Action({
    title: t('actionPickFolder'),
    icon: Icon.Folder,
    shortcut: { modifiers: ['cmd', 'shift'], key: 'o' },
    onAction: handlePickFolder
  })
  const clipboardAction = Action({
    title: t('actionClipboard'),
    icon: Icon.Clipboard,
    shortcut: { modifiers: ['cmd', 'shift'], key: 'v' },
    onAction: () => handleClipboard()
  })
  const startActions = [regionAction, addImagesAction, pickFolderAction, clipboardAction]
  const clearAction = Action({
    title: t('actionClearResults'),
    icon: Icon.Trash,
    style: Action.Style.Destructive,
    shortcut: { modifiers: ['cmd', 'shift'], key: 'backspace' },
    onAction: handleClear
  })

  /** 主动作（Enter）：成功的按当前格式复制，其它格式在后面；失败的重新识别 */
  function primaryActions(entry: FormulaEntry) {
    const retryFile = entry.path
      ? [Action({ title: t('actionRetryRecognize'), icon: Icon.ArrowClockwise, shortcut: { modifiers: ['cmd'], key: 'r' }, onAction: () => handleRetry(entry) })]
      : []
    if (entry.status === 'done') {
      const currentFormat = copyFormats.find(item => item.id === format.id) ?? format
      const formats = [currentFormat, ...copyFormats.filter(item => item.id !== currentFormat.id)]
      const copyActions = formats.map(item => Action.CopyToClipboard({ title: item.actionTitle, content: item.wrap(entry.latex) }))
      const editAction = Action({ title: t('actionEditFormula'), icon: Icon.Pencil, shortcut: { modifiers: ['cmd'], key: 'e' }, onAction: () => {
        push(() => FormulaEditor({ entry, onSave: latex => {
          if (!entriesRef.current.some(item => item.id === entry.id && item.status === 'done')) {
            void showToast({ style: Toast.Style.Failure, title: t('toastEntryRemoved') })
            return false
          }
          updateEntry(entry.id, current => ({ ...current, latex, edited: true }))
          return true
        } }))
      } })
      return [copyActions[0]!, editAction, ...copyActions.slice(1), ...retryFile]
    }
    if (entry.status !== 'failed') return []
    if (entry.source === 'file') return retryFile
    return entry.source === 'region'
      ? [Action({ title: t('actionRetryRegion'), icon: Icon.Camera, onAction: () => handleRegion(entry.id) })]
      : [Action({ title: t('actionRetryClipboard'), icon: Icon.Clipboard, onAction: () => handleClipboard(entry.id) })]
  }

  const items = visible.map(entry => {
    const subtitle = entry.status === 'done'
      ? truncate(entry.latex)
      : entry.status === 'failed' ? entry.error || t('statusFailed') : entry.status === 'queued' ? t('statusWaiting') : t('statusRecognizing')
    const markdown = entry.status === 'done'
      ? formulaMarkdown(entry.latex, entry.lowConfidence === true, entry.previewDataUrl)
      : entry.status === 'failed' ? t('statusFailedUnknown', { error: entry.error || t('unknownReason') }) : entry.status === 'queued' ? t('statusWaitingEllipsis') : t('statusRecognizingEllipsis')
    const entryActions = [...primaryActions(entry), ...(entry.path ? [Action.ShowInFinder({ path: entry.path })] : [])]
    // 移除放在最后一组，不占底部的次动作位置
    const removeActions = [
      ...(isPending(entry)
        ? []
        : [Action({ title: t('actionRemoveItem'), icon: Icon.Trash, shortcut: { modifiers: ['cmd'], key: 'backspace' }, onAction: () => handleRemove(entry) })]),
      clearAction
    ]
    return List.Item({
      id: entry.id,
      title: entry.title,
      subtitle,
      icon: entry.source === 'file' ? Icon.Image : entry.source === 'region' ? Icon.Camera : Icon.Clipboard,
      accessories: entry.status === 'done'
        ? [...(entry.edited ? [{ tag: t('tagEdited') }] : []), ...(entry.lowConfidence ? [{ tag: t('tagLowConf') }] : [])]
        : [{ tag: entry.status === 'failed' ? t('tagFailed') : entry.status === 'queued' ? t('tagQueued') : t('tagRunning') }],
      detail: Detail({ markdown }),
      // 还在识别的条目没有针对它的主动作，Enter 留给开始新的识别
      actions: ActionPanel({
        children: [
          ...(isPending(entry) ? [] : [ActionPanel.Section({ children: entryActions })]),
          ActionPanel.Section({ title: t('secNewRecognition'), children: startActions }),
          ...(isPending(entry) && entryActions.length > 0 ? [ActionPanel.Section({ children: entryActions })] : []),
          ActionPanel.Section({ children: removeActions })
        ]
      })
    })
  })

  const summaryText = importProgress
    ? t('summaryImportingProgress', { dirs: importProgress.visitedDirs, files: importProgress.matchedFiles })
    : importing
      ? t('summaryImporting')
      : progress
        ? t('summaryRecognizingProgress', { cur: progress.done + 1, total: progress.total })
        : entries.length === 0
          ? t('summaryIdle')
          : t('summaryResults', { count: doneCount, busyPart: busy ? t('summaryBusyPart') : '' })

  const fileInputProps = createImportInputProps(handleFileInput, {
    allowClipboardImage: true,
    dropTitle: t('dropTitle'),
    dropSubtitle: t('dropSubtitle', { max: FORMULA_IMPORT_MAX_FILES })
  })

  return List({
    ...fileInputProps,
    searchBarPlaceholder: t('searchPlaceholder'),
    onSearchTextChange: setSearchText,
    isLoading: busy || importing,
    isShowingDetail: visible.length > 0,
    selectedItemId: selectedId,
    onSelectionChange: (id: string | null) => setSelectedId(id ?? undefined),
    searchBarAccessory: formatDropdown,
    filterBar: {
      summaryText,
      actions: [
        { id: 'formula-region', title: t('actionRegion'), icon: Icon.Camera, onAction: () => handleRegion() },
        { id: 'formula-add', title: t('actionAddImages'), icon: Icon.Plus, onAction: handleAddImages }
      ]
    },
    actions: ActionPanel({ children: startActions }),
    children: items
  })
}

export const formulaWorkbench = FormulaCommand
export default FormulaCommand
