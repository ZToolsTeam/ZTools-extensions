import {
  List,
  Detail,
  ActionPanel,
  Action,
  Icon,
  Clipboard,
  LocalStorage,
  confirmAlert,
  useLocale,
  useState,
  useEffect,
  useRef,
  useCachedState,
  showToast,
  Toast
} from '@ztools/declarative-ui'
import { t } from './i18n.js'
import {
  OCR_IMPORT_MAX_FILES,
  OCR_IMPORT_RULES,
  OCR_IMPORT_SUPPORTED_TEXT,
  type HostTransport,
  type OcrLanguage,
  type OcrOutcome,
  countCharacters,
  createFileImportTransport,
  fileNameOf,
  firstLine,
  getClientTransport,
  getOcrLanguages,
  notify,
  pickImageFiles,
  recognizeClipboardImage,
  recognizeImageFile,
  recognizeScreenRegion,
  resolveLanguage,
  textAsMarkdown
} from './ocr-service.js'

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
import { resolveErrorMessage } from './error-i18n.js'

export * from './ocr-service.js'

const LANGUAGE_KEY = 'language'

export interface OcrEntry {
  id: string
  source: 'file' | 'region' | 'clipboard'
  title: string
  /** 图片文件路径；框选和剪贴板没有 */
  path?: string
  /** queued：批量添加后等待识别 */
  status: 'queued' | 'running' | 'done' | 'failed'
  text: string
  error?: string
}

function isPending(entry: OcrEntry): boolean {
  return entry.status === 'queued' || entry.status === 'running'
}

async function loadLanguage(): Promise<OcrLanguage> {
  try {
    return resolveLanguage(await LocalStorage.getItem(LANGUAGE_KEY))
  } catch {
    return resolveLanguage(undefined)
  }
}

function requireTransport(): HostTransport {
  const transport = getClientTransport()
  if (!transport) throw new Error(t('notInClient'))
  return transport
}

function timeLabel(): string {
  const now = new Date()
  // 带秒：同一分钟里连续识别的几条能区分开
  return [now.getHours(), now.getMinutes(), now.getSeconds()].map(value => String(value).padStart(2, '0')).join(':')
}

let entrySeq = 0
function newEntryId(): string {
  entrySeq += 1
  return `ocr-${Date.now()}-${entrySeq}`
}

function applyOutcome(entry: OcrEntry, outcome: OcrOutcome): OcrEntry {
  return outcome.ok
    ? { ...entry, status: 'done', text: outcome.text, error: undefined }
    : { ...entry, status: 'failed', text: '', error: outcome.error }
}

/** 无界面命令：框选屏幕区域，识别后复制到剪贴板 */
export async function ocrRegion(): Promise<string> {
  const transport = requireTransport()
  const outcome = await recognizeScreenRegion(transport, await loadLanguage(), false)
  if (!outcome.ok) {
    if (outcome.canceled) return t('regionCanceledMsg')
    throw new Error(outcome.error)
  }
  await Clipboard.copy(outcome.text)
  // 框选时 ZTools 窗口已经收起，用系统通知告诉用户结果
  await notify(transport, t('notifyCopiedTitle'), firstLine(outcome.text, 80))
  return t('copiedCharsMsg', { count: countCharacters(outcome.text) })
}

/** 无界面命令：识别剪贴板里的图片，结果复制回剪贴板 */
export async function ocrClipboard(): Promise<string> {
  const transport = requireTransport()
  const outcome = await recognizeClipboardImage(transport, await loadLanguage())
  if (!outcome.ok) throw new Error(outcome.error)
  await Clipboard.copy(outcome.text)
  return t('copiedCharsMsg', { count: countCharacters(outcome.text) })
}

export function OcrCommand() {
  useLocale()
  const languages = getOcrLanguages()
  const transport = getClientTransport()
  const [languageId, setLanguageId] = useState<string>(() => languages[0].id)
  const language = languages.find(item => item.id === languageId) ?? languages[0]
  const [entries, setEntries] = useCachedState<OcrEntry[]>('entries', [])
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
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  const languageRef = useRef(language)
  languageRef.current = language

  useEffect(() => {
    unmountedRef.current = false
    void loadLanguage().then(nextLang => {
      if (!unmountedRef.current) setLanguageId(nextLang.id)
    })
    // 上次关闭插件时还没识别完的条目不会再有结果，标为中断，图片可以重新识别
    setEntries(previous => previous.some(isPending)
      ? previous.map(entry => (isPending(entry) ? { ...entry, status: 'failed', text: '', error: t('errInterrupted') } : entry))
      : previous)
    return () => {
      unmountedRef.current = true
      importSeqRef.current += 1
      importAbortRef.current?.abort()
      importAbortRef.current = null
    }
  }, [])

  function changeLanguage(id: string) {
    const next = resolveLanguage(id)
    setLanguageId(next.id)
    void LocalStorage.setItem(LANGUAGE_KEY, next.id).catch(() => undefined)
  }

  const updateEntry = (id: string, change: (entry: OcrEntry) => OcrEntry) =>
    setEntries(previous => previous.map(entry => (entry.id === id ? change(entry) : entry)))

  /** 同一时间只做一件事：框选、选择图片、识别都会占用识别组件 */
  async function exclusive(task: (host: HostTransport) => Promise<void>) {
    const activeTransport = getClientTransport() ?? transport
    if (!activeTransport) return void showToast({ style: Toast.Style.Failure, title: t('notInClient') })
    if (busyRef.current || importingRef.current) {
      return void showToast({ style: Toast.Style.Failure, title: importingRef.current ? t('toastImportingBusy') : t('toastOcrBusy') })
    }
    busyRef.current = true
    setBusy(true)
    try { await task(activeTransport) } finally {
      busyRef.current = false
      if (!unmountedRef.current) { setBusy(false); setProgress(undefined) }
    }
  }

  async function recognizeInto(entry: OcrEntry, run: () => Promise<OcrOutcome>): Promise<OcrOutcome> {
    updateEntry(entry.id, current => ({ ...current, status: 'running', error: undefined }))
    const outcome = await run()
    if (!unmountedRef.current && !removedIdsRef.current.has(entry.id)) {
      updateEntry(entry.id, current => applyOutcome(current, outcome))
    }
    return outcome
  }

  /** 新结果放在最前面；replaceId 是被重新识别的失败条目，用新结果替换它 */
  function addEntry(entry: OcrEntry, replaceId?: string) {
    setEntries(previous => [entry, ...previous.filter(item => item.id !== entry.id && item.id !== replaceId)])
    setSelectedId(entry.id)
  }

  /** 截图和剪贴板只识别一张：成功就复制，和无界面命令一致 */
  async function finishSingle(entry: OcrEntry, outcome: OcrOutcome, failureTitle: string, replaceId?: string) {
    addEntry(applyOutcome(entry, outcome), replaceId)
    if (outcome.ok) {
      await Clipboard.copy(outcome.text)
      await showToast({ style: Toast.Style.Success, title: t('toastRecognizedAndCopied'), message: firstLine(outcome.text) })
    } else {
      await showToast({ style: Toast.Style.Failure, title: failureTitle, message: outcome.error })
    }
  }

  async function handleRegion(replaceId?: string) {
    await exclusive(async host => {
      const previousSelectedId = selectedId
      const replacedIndex = replaceId ? entriesRef.current.findIndex(item => item.id === replaceId) : -1
      const replacedEntry = replacedIndex >= 0 ? entriesRef.current[replacedIndex] : undefined
      const entry: OcrEntry = { id: newEntryId(), source: 'region', title: t('regionEntryTitle', { time: timeLabel() }), status: 'running', text: '' }
      addEntry(entry, replaceId)
      const outcome = await recognizeScreenRegion(host, language)
      if (!outcome.ok && outcome.canceled) {
        setEntries(previous => {
          const withoutCurrent = previous.filter(item => item.id !== entry.id)
          if (!replacedEntry || withoutCurrent.some(item => item.id === replacedEntry.id)) return withoutCurrent
          const insertAt = Math.min(replacedIndex, withoutCurrent.length)
          return [...withoutCurrent.slice(0, insertAt), replacedEntry, ...withoutCurrent.slice(insertAt)]
        })
        setSelectedId(previousSelectedId)
        return
      }
      await finishSingle(entry, outcome, t('regionFailedTitle'), replaceId)
    })
  }

  async function handleClipboard(replaceId?: string) {
    await exclusive(async host => {
      const outcome = await recognizeClipboardImage(host, language)
      if (!outcome.ok && !outcome.empty && (outcome.errorCode === 'CLIPBOARD_NO_IMAGE' || outcome.error === t('errClipboardNoImage'))) {
        await showToast({ style: Toast.Style.Failure, title: t('errClipboardNoImage') })
        return
      }
      const entry: OcrEntry = { id: newEntryId(), source: 'clipboard', title: t('clipboardEntryTitle', { time: timeLabel() }), status: 'running', text: '' }
      await finishSingle(entry, outcome, t('errRecognizeFailed'), replaceId)
    })
  }

  async function recognizeImagePaths(host: HostTransport, paths: string[]) {
    if (paths.length === 0) return
    // 已在列表里的图片不重复添加（Windows 路径忽略大小写），移到最前面重新识别
    const existing = new Map(
      entriesRef.current
        .filter(entry => entry.path && !isPending(entry))
        .map(entry => [pathKey(entry.path as string), entry])
    )
    const seenKeys = new Set<string>()
    const uniquePaths: string[] = []
    for (const filePath of paths) {
      const key = pathKey(filePath)
      if (!key || seenKeys.has(key)) continue
      seenKeys.add(key)
      uniquePaths.push(filePath)
    }
    if (uniquePaths.length === 0) return
    const queued = uniquePaths.map((path): OcrEntry => ({
      id: existing.get(pathKey(path))?.id ?? newEntryId(),
      source: 'file',
      title: fileNameOf(path),
      path,
      status: 'queued',
      text: ''
    }))
    const queuedIds = new Set(queued.map(entry => entry.id))
    for (const id of queuedIds) removedIdsRef.current.delete(id)
    setEntries(previous => [...queued, ...previous.filter(entry => !queuedIds.has(entry.id))])
    setSelectedId(queued[0].id)
    let failed = 0
    for (const [index, entry] of queued.entries()) {
      if (unmountedRef.current) return
      if (removedIdsRef.current.has(entry.id)) continue
      setProgress({ done: index, total: queued.length })
      const outcome = await recognizeInto(entry, () => recognizeImageFile(host, entry.path as string, languageRef.current))
      if (unmountedRef.current) return
      if (!outcome.ok) failed += 1
    }
    const done = queued.length - failed
    await showToast({
      style: failed > 0 ? Toast.Style.Failure : Toast.Style.Success,
      title: failed > 0 ? t('batchPartialToast', { done, failed }) : t('batchSuccessToast', { done })
    })
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
            message: t('toastDropSupportedMsg', { formats: OCR_IMPORT_SUPPORTED_TEXT })
          })
        }
        return
      }
      const summary = summarizeImport(result, { added: 0 }, OCR_IMPORT_SUPPORTED_TEXT)
      if (summary) {
        await showToast({
          style: summary.ok ? Toast.Style.Success : Toast.Style.Failure,
          title: summary.title,
          message: summary.message
        })
      }
      return
    }
    const paths = result.files.map(file => file.path)
    await exclusive(async activeHost => {
      if (seq !== importSeqRef.current || unmountedRef.current) return
      if (result.truncated) {
        const notes: string[] = []
        if (result.ignored > 0) notes.push(t('noteIgnoredFiles', { count: result.ignored }))
        if (result.failedDirs.length > 0) notes.push(t('noteFailedDirs', { count: result.failedDirs.length }))
        const title =
          result.files.length >= OCR_IMPORT_MAX_FILES
            ? t('toastTruncatedMax', { max: OCR_IMPORT_MAX_FILES })
            : t('toastTruncatedPartial')
        await showToast({
          style: Toast.Style.Success,
          title,
          message: notes.join(t('noteSep')) || t('toastTruncatedDefaultMsg', { max: OCR_IMPORT_MAX_FILES })
        })
      } else if (result.failedDirs.length > 0) {
        await showToast({
          style: Toast.Style.Failure,
          title: t('noteFailedDirs', { count: result.failedDirs.length }),
          message: t('toastFailedDirsMsg', { count: paths.length })
        })
      }
      await recognizeImagePaths(activeHost, paths)
    })
  }

  async function runImportAndRecognize(
    source: 'folder' | 'input',
    task: (importTransport: FileImportTransport, signal: AbortSignal, onProgress: (p: { visitedDirs: number; matchedFiles: number }) => void) => Promise<FileImportResult>
  ) {
    const activeTransport = getClientTransport() ?? transport
    if (!activeTransport) return void showToast({ style: Toast.Style.Failure, title: t('notInClient') })
    if (busyRef.current) return void showToast({ style: Toast.Style.Failure, title: t('toastOcrBusy') })
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
    void runImportAndRecognize('folder', (importTransport, signal, onProgress) =>
      pickFolderWithConfirm(importTransport, OCR_IMPORT_RULES, {
        title: t('pickFolderTitle'),
        signal,
        onProgress,
        confirmVolume: folderPath => confirmAlert({
          title: t('confirmVolumeTitle', { path: folderPath }),
          message: t('confirmVolumeMessage', { max: OCR_IMPORT_MAX_FILES }),
          primaryAction: { title: t('confirmVolumePrimary'), style: 'default' }
        })
      })
    )
  }

  function handleFileInput(input: NormalizedFileInput) {
    void runImportAndRecognize('input', (importTransport, signal, onProgress) =>
      expandInputPaths(importTransport, input.paths, OCR_IMPORT_RULES, {
        knownDirectories: input.directories,
        signal,
        onProgress
      })
    )
  }

  const fileInputHandlerRef = useRef(handleFileInput)
  fileInputHandlerRef.current = handleFileInput

  async function handleAddImages() {
    await exclusive(async host => {
      let paths: string[]
      try {
        paths = await pickImageFiles(host)
      } catch (error) {
        await showToast({ style: Toast.Style.Failure, title: t('errOpenImagePicker'), message: error instanceof Error ? error.message : String(error) })
        return
      }
      if (paths.length === 0) return
      await recognizeImagePaths(host, paths)
    })
  }

  useEffect(() => {
    if (isDeclarativeFileInputSupported()) return undefined
    const events = (globalThis as {
      window?: {
        ztools?: {
          events?: {
            on?: (event: string, cb: (payload: unknown) => void) => (() => void) | void
            off?: (event: string, cb: (payload: unknown) => void) => void
          }
        }
      }
    }).window?.ztools?.events
    if (!events || typeof events.on !== 'function') return undefined
    const handleFilesDropped = (envelopeOrPayload: unknown) => {
      const input = normalizeFileInput(envelopeOrPayload)
      if (input.paths.length === 0) {
        void showToast({ style: Toast.Style.Failure, title: t('toastDropSupportedImages') })
        return
      }
      fileInputHandlerRef.current(input)
    }
    const dispose = events.on('plugin_files_dropped', handleFilesDropped)
    return () => {
      if (typeof dispose === 'function') dispose()
      else if (typeof events.off === 'function') events.off('plugin_files_dropped', handleFilesDropped)
    }
  }, [])

  async function handleRetry(entry: OcrEntry) {
    if (!entry.path) return
    await exclusive(async host => {
      const outcome = await recognizeInto(entry, () => recognizeImageFile(host, entry.path as string, language))
      if (!outcome.ok) await showToast({ style: Toast.Style.Failure, title: t('errRecognizeFailed'), message: outcome.error })
    })
  }

  function handleRemove(entry: OcrEntry) {
    removedIdsRef.current.add(entry.id)
    setEntries(previous => previous.filter(item => item.id !== entry.id))
  }

  /** 清空已结束的结果；正在识别的保留，识别完会填上结果；同时作废进行中的导入 */
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

  const query = searchText.trim().toLowerCase()
  const visible = entries.filter(entry => !query || entry.title.toLowerCase().includes(query) || entry.text.toLowerCase().includes(query))
  const doneEntries = entries.filter(entry => entry.status === 'done')
  const allText = doneEntries.map(entry => (doneEntries.length > 1 ? `${entry.title}\n${entry.text}` : entry.text)).join('\n\n')

  const startActionSpecs: Array<[string, Parameters<typeof Action>[0]['icon'], Parameters<typeof Action>[0]['shortcut'], () => void]> = [
    [t('actionCaptureRegion'), Icon.Camera, { modifiers: ['cmd'], key: 'n' }, () => handleRegion()],
    [t('actionAddImages'), Icon.Plus, { modifiers: ['cmd'], key: 'o' }, handleAddImages],
    [t('actionPickFolder'), Icon.Folder, { modifiers: ['cmd', 'shift'], key: 'o' }, handlePickFolder],
    [t('actionRecognizeClipboard'), Icon.Clipboard, { modifiers: ['cmd', 'shift'], key: 'v' }, () => handleClipboard()]
  ]
  const startActions = startActionSpecs.map(([title, icon, shortcut, onAction]) => Action({ title, icon, shortcut, onAction }))
  const clearAction = Action({ title: t('actionClearResults'), icon: Icon.Trash, style: Action.Style.Destructive, shortcut: { modifiers: ['cmd', 'shift'], key: 'backspace' }, onAction: handleClear })

  /** 主动作（Enter）：成功的复制文字，失败的重新识别 */
  function primaryActions(entry: OcrEntry) {
    const retryFile = entry.path
      ? [Action({ title: t('actionRetry'), icon: Icon.ArrowClockwise, shortcut: { modifiers: ['cmd'], key: 'r' }, onAction: () => handleRetry(entry) })]
      : []
    if (entry.status === 'done') return [Action.CopyToClipboard({ title: t('actionCopyText'), content: entry.text }), ...retryFile]
    if (entry.status !== 'failed') return []
    if (entry.source === 'file') return retryFile
    return entry.source === 'region'
      ? [Action({ title: t('actionRetryCapture'), icon: Icon.Camera, onAction: () => handleRegion(entry.id) })]
      : [Action({ title: t('actionRetryClipboard'), icon: Icon.Clipboard, onAction: () => handleClipboard(entry.id) })]
  }

  const items = visible.map(entry => {
    const subtitle = entry.status === 'done'
      ? firstLine(entry.text)
      : entry.status === 'failed' ? resolveErrorMessage(entry, t('errRecognizeFailed')) : entry.status === 'queued' ? t('statusQueued') : t('statusRunning')
    const markdown = entry.status === 'done'
      ? textAsMarkdown(entry.text)
      : entry.status === 'failed'
        ? t('detailFailed', { error: resolveErrorMessage(entry, t('detailUnknownReason')) })
        : entry.status === 'queued' ? t('detailQueued') : t('detailRunning')
    const entryActions = [
      ...primaryActions(entry),
      ...(doneEntries.length > 1
        ? [Action.CopyToClipboard({ title: t('actionCopyAll', { count: doneEntries.length }), content: allText, shortcut: { modifiers: ['cmd', 'shift'], key: 'c' } })]
        : []),
      ...(entry.path ? [Action.ShowInFinder({ path: entry.path })] : [])
    ]
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
        ? [{ text: t('charCountText', { count: countCharacters(entry.text) }) }]
        : [{ tag: entry.status === 'failed' ? t('tagFailed') : entry.status === 'queued' ? t('tagQueued') : t('tagRunning') }],
      detail: Detail({ markdown }),
      // 还在识别的条目没有针对它的主动作，Enter 留给开始新的识别
      actions: ActionPanel({
        children: [
          ...(isPending(entry) ? [] : [ActionPanel.Section({ children: entryActions })]),
          ActionPanel.Section({ title: t('sectionNewOcr'), children: startActions }),
          ...(isPending(entry) && entryActions.length > 0 ? [ActionPanel.Section({ children: entryActions })] : []),
          ActionPanel.Section({ children: removeActions })
        ]
      })
    })
  })

  const summaryText = !transport
    ? t('notInClient')
    : importProgress
      ? t('summaryImportingProgress', { dirs: importProgress.visitedDirs, files: importProgress.matchedFiles })
      : importing
        ? t('summaryImporting')
        : progress
          ? t('summaryBatchProgress', { current: progress.done + 1, total: progress.total })
          : entries.length === 0
            ? t('summaryEmpty')
            : t('summaryCount', { count: doneEntries.length, busySuffix: busy ? t('summaryBusySuffix') : '' })

  const fileInputProps = createImportInputProps(handleFileInput, {
    allowClipboardImage: true,
    dropTitle: t('dropTitle'),
    dropSubtitle: t('dropSubtitle', { max: OCR_IMPORT_MAX_FILES })
  })

  return List({
    ...fileInputProps,
    searchBarPlaceholder: t('searchPlaceholder'),
    onSearchTextChange: setSearchText,
    isLoading: busy || importing,
    isShowingDetail: visible.length > 0,
    selectedItemId: selectedId,
    onSelectionChange: (id: string | null) => setSelectedId(id ?? undefined),
    searchBarAccessory: List.Dropdown({
      tooltip: t('languageTooltip'),
      value: language.id,
      onChange: changeLanguage,
      children: languages.map(item => List.Dropdown.Item({ title: item.title, value: item.id }))
    }),
    filterBar: {
      summaryText,
      actions: transport
        ? [
            { id: 'ocr-region', title: t('actionCaptureRegion'), icon: Icon.Camera, onAction: () => handleRegion() },
            { id: 'ocr-add', title: t('actionAddImages'), icon: Icon.Plus, onAction: handleAddImages }
          ]
        : []
    },
    actions: ActionPanel({ children: startActions }),
    children: items
  })
}

export const ocrWorkbench = OcrCommand
export default OcrCommand
