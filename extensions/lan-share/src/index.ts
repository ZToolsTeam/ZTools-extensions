import {
  List,
  ActionPanel,
  Action,
  Icon,
  Clipboard,
  confirmAlert,
  useLocale,
  useState,
  useEffect,
  useRef,
  showToast,
  Toast
} from '@ztools/declarative-ui'
import {
  type LanShareStatus,
  type SharedFileItem,
  type LanActionResult,
  LAN_SHARE_IMPORT_RULES,
  LAN_SHARE_MAX_FILES,
  addFilesToShareBatched,
  clearAllSharedFiles,
  createLanShareImportTransport,
  formatBytes,
  fetchLanShareStatus,
  startLanShare,
  stopLanShare,
  setFileShared,
  removeSharedFile,
  generateQrCodeSvgDataUri,
  filterSharedFiles
} from './logic.js'
import {
  collectFolderFiles,
  createImportInputProps,
  expandInputPaths,
  friendlyFileError,
  isVolumeRoot,
  normalizeFileInput,
  pickFiles,
  pickFolder,
  summarizeImport,
  type FileImportResult,
  type NormalizedFileInput
} from './file-import.js'
import { t } from './i18n.js'

export * from './logic.js'

function isDeclarativeFileInputSupported(): boolean {
  if (typeof window === 'undefined') return true
  const w = window as unknown as { __ztoolsDeclarativeFeatures?: { fileInput?: boolean } }
  return w.__ztoolsDeclarativeFeatures?.fileInput === true
}

/**
 * 复制文本：等宿主确认写入成功后才提示成功；写入失败（内容为空、超过上限、剪贴板被占用等）时提示失败原因，不能假装已复制
 */
async function copyWithToast(text: string, successTitle: string, successMessage?: string): Promise<void> {
  try {
    await Clipboard.copy(text)
  } catch (err) {
    await showToast({
      style: Toast.Style.Failure,
      title: t('toastCopyFailed'),
      message: err instanceof Error ? err.message : String(err)
    })
    return
  }
  await showToast({ style: Toast.Style.Success, title: successTitle, message: successMessage })
}

function qrMarkdown(url: string): string {
  const qr = generateQrCodeSvgDataUri(url)
  return qr ? `![${t('qrAltText')}](${qr})\n\n` : t('qrTooLongMsg')
}

function serviceDetail(status: LanShareStatus): string {
  if (!status.ok) return t('detailReadFailedHeader', { error: status.error || '' })
  if (!status.running) {
    return t('detailNotRunning', { noPassword: t('noPasswordNote'), firewall: t('firewallNote') })
  }
  const others = status.interfaces.filter((i) => i.address !== status.lanIp)
  const otherLines = others.length
    ? `${t('detailOtherAddrsHeader')}${others.map((i) => `- ${i.name}: \`http://${i.address}:${status.port}\``).join('\n')}`
    : ''
  const noLan = status.interfaces.length === 0 ? t('detailNoLanAddr') : ''
  return t('detailRunning', {
    qr: qrMarkdown(status.portalUrl),
    url: status.portalUrl,
    noPassword: t('noPasswordNote'),
    keepRunning: t('keepRunningNote'),
    firewall: t('firewallNote'),
    others: otherLines,
    noLan
  })
}

function fileDetail(file: SharedFileItem, status: LanShareStatus): string {
  const head = t('fileDetailHead', { name: file.name, path: file.path, size: formatBytes(file.sizeBytes) })
  if (file.isDirectory) return t('fileDetailDir', { head })
  if (!file.shared) return t('fileDetailPaused', { head })
  if (!status.running) return t('fileDetailStopped', { head })
  return `${head}${qrMarkdown(file.downloadUrl)}\`\`\`text\n${file.downloadUrl}\n\`\`\``
}

const EMPTY_STATUS: LanShareStatus = {
  ok: true,
  running: false,
  lanIp: '',
  port: 0,
  portalUrl: '',
  interfaces: [],
  files: []
}

export function LanShareCommand() {
  useLocale()
  const transport = createLanShareImportTransport()
  const [searchText, setSearchText] = useState('')
  const [status, setStatus] = useState<LanShareStatus>(EMPTY_STATUS)
  const [isLoading, setIsLoading] = useState(true)
  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<{ visitedDirs: number; matchedFiles: number } | null>(null)

  const mountedRef = useRef(true)
  const busyRef = useRef(false)
  const importSeqRef = useRef(0)
  const importAbortRef = useRef<AbortController | null>(null)
  const statusRef = useRef<LanShareStatus>(EMPTY_STATUS)
  statusRef.current = status

  async function refresh(showNotice = false) {
    setIsLoading(true)
    try {
      const next = await fetchLanShareStatus()
      if (!mountedRef.current) return
      setStatus(next)
      if (showNotice) {
        await showToast(
          next.ok
            ? { style: Toast.Style.Success, title: t('toastRefreshed'), message: next.running ? next.portalUrl : t('toastNotRunning') }
            : { style: Toast.Style.Failure, title: t('errReadStatusFailed'), message: next.error }
        )
      }
    } finally {
      if (mountedRef.current) setIsLoading(false)
    }
  }

  /** 执行一个改变共享状态的操作：结果以客户端返回为准，之后重新读取完整状态 */
  async function applyResult(res: LanActionResult, failureTitle: string, successMessage?: string) {
    if (res.ok) {
      await showToast({ style: Toast.Style.Success, title: res.message, message: successMessage })
    } else {
      await showToast({ style: Toast.Style.Failure, title: failureTitle, message: res.message })
    }
    await refresh(false)
  }

  async function shareCollectedResult(result: FileImportResult) {
    if (result.canceled) return
    if (result.error) {
      await showToast({ style: Toast.Style.Failure, title: t('toastPickFailed'), message: result.error })
      return
    }
    if (result.files.length === 0) {
      const emptySummary = summarizeImport(result, { added: 0 })
      await showToast({
        style: Toast.Style.Failure,
        title: emptySummary?.title || t('toastNoFilesFound'),
        message: emptySummary?.message
      })
      return
    }

    busyRef.current = true
    try {
      const batch = await addFilesToShareBatched(result.files.map((f) => f.path))
      if (!mountedRef.current) return

      const extraNotes: string[] = []
      if (result.ignored > 0) extraNotes.push(t('noteIgnoredHidden', { count: result.ignored }))
      if (result.truncated) extraNotes.push(t('noteTruncated', { max: LAN_SHARE_MAX_FILES }))
      if (result.failedDirs.length > 0) extraNotes.push(t('noteFailedDirs', { count: result.failedDirs.length }))
      if (batch.failedBatches > 0) {
        extraNotes.push(t('notePartialBatchFail', { error: batch.errorMessage ? ` (${batch.errorMessage})` : '' }))
      }
      if (batch.duplicateNameCount > 0) {
        extraNotes.push(t('noteDuplicateNames', { count: batch.duplicateNameCount }))
      }

      if (batch.addedCount === 0) {
        const failParts = [batch.errorMessage || t('errNoFilesAdded'), ...extraNotes]
        await showToast({
          style: Toast.Style.Failure,
          title: t('toastShareFailed'),
          message: failParts.filter(Boolean).join(t('semiSep'))
        })
        await refresh(false)
        return
      }

      const title =
        batch.skipped.length > 0
          ? t('msgSharedPartial', { added: batch.addedCount, skipped: batch.skipped.length })
          : t('msgSharedAll', { added: batch.addedCount })
      const portal = batch.status?.portalUrl
      const portalNote = portal ? `${portal} · ${t('noPasswordNote')}` : extraNotes.length === 0 ? undefined : t('noPasswordNote')
      const message = [...extraNotes, portalNote].filter(Boolean).join(t('semiSep')) || undefined
      await showToast({
        style: batch.failedBatches > 0 ? Toast.Style.Failure : Toast.Style.Success,
        title,
        message
      })
      await refresh(false)
    } finally {
      busyRef.current = false
    }
  }

  async function runShareImport(
    task: (signal: AbortSignal, onProgress: (p: { visitedDirs: number; matchedFiles: number }) => void) => Promise<FileImportResult>
  ) {
    importAbortRef.current?.abort()
    const controller = new AbortController()
    importAbortRef.current = controller
    const seq = ++importSeqRef.current
    setIsImporting(true)
    setImportProgress(null)
    try {
      const result = await task(controller.signal, (progress) => {
        if (mountedRef.current && seq === importSeqRef.current) setImportProgress(progress)
      })
      if (!mountedRef.current || seq !== importSeqRef.current) return
      await shareCollectedResult(result)
    } catch (err) {
      if (!mountedRef.current || seq !== importSeqRef.current) return
      await showToast({ style: Toast.Style.Failure, title: t('toastImportFailed'), message: friendlyFileError(err) })
    } finally {
      if (mountedRef.current && seq === importSeqRef.current) {
        importAbortRef.current = null
        setIsImporting(false)
        setImportProgress(null)
      }
    }
  }

  function handleAddFiles() {
    void runShareImport(() => pickFiles(transport, LAN_SHARE_IMPORT_RULES, { title: t('pickFilesTitle') }))
  }

  function handleAddFolder() {
    void runShareImport(async (signal, onProgress) => {
      const picked = await pickFolder(transport, { title: t('pickFolderTitle') })
      if (picked.canceled) return { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: true }
      if (picked.error || !picked.folderPath) {
        return { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: false, error: picked.error || t('errNoFolderSelected') }
      }
      if (isVolumeRoot(picked.folderPath)) {
        const confirmed = await confirmAlert({
          title: t('confirmRootTitle', { path: picked.folderPath }),
          message: t('confirmRootMsg', { max: LAN_SHARE_MAX_FILES }),
          primaryAction: { title: t('confirmRootAction'), style: 'default' }
        })
        if (!confirmed) return { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: true }
      }
      return collectFolderFiles(transport, picked.folderPath, LAN_SHARE_IMPORT_RULES, { signal, onProgress })
    })
  }

  function handleFileInput(input: NormalizedFileInput) {
    void runShareImport((signal, onProgress) =>
      expandInputPaths(transport, input.paths, LAN_SHARE_IMPORT_RULES, {
        knownDirectories: input.directories,
        signal,
        onProgress
      })
    )
  }

  useEffect(() => {
    mountedRef.current = true
    void refresh(false)

    let cleanupDrop: (() => void) | undefined
    if (!isDeclarativeFileInputSupported()) {
      const ztools = (
        globalThis as {
          window?: {
            ztools?: {
              events?: {
                on?: (event: string, cb: (payload: unknown) => void) => (() => void) | void
                off?: (event: string, cb: (payload: unknown) => void) => void
              }
            }
          }
        }
      ).window?.ztools
      if (typeof ztools?.events?.on === 'function') {
        const handler = (raw: unknown) => {
          const input = normalizeFileInput(raw)
          if (input.paths.length > 0) handleFileInput(input)
        }
        const off = ztools.events.on('plugin_files_dropped', handler)
        cleanupDrop = () => {
          if (typeof off === 'function') off()
          else ztools?.events?.off?.('plugin_files_dropped', handler)
        }
      }
    }

    return () => {
      mountedRef.current = false
      importSeqRef.current += 1
      importAbortRef.current?.abort()
      cleanupDrop?.()
    }
  }, [])

  const fileInputProps = createImportInputProps(handleFileInput, {
    allowClipboardImage: true,
    dropTitle: t('dropTitle'),
    dropSubtitle: t('dropSubtitle')
  })

  async function handleStart() {
    const res = await startLanShare()
    await applyResult(res, t('errStartFailed'), res.status?.portalUrl)
  }

  async function handleStop() {
    await applyResult(await stopLanShare(), t('errStopFailed'))
  }

  async function handleToggle(file: SharedFileItem) {
    await applyResult(await setFileShared(file.id, !file.shared), t('errToggleFailed'))
  }

  async function handleRemove(file: SharedFileItem) {
    await applyResult(await removeSharedFile(file.id), t('errRemoveFailed'))
  }

  async function handleClearAll() {
    if (busyRef.current || isImporting) {
      await showToast({ style: Toast.Style.Failure, title: t('toastWaitClearing') })
      return
    }
    if (statusRef.current.files.length === 0) return
    busyRef.current = true
    setIsLoading(true)
    try {
      const res = await clearAllSharedFiles(statusRef.current.files)
      if (!mountedRef.current) return
      await showToast({
        style: res.ok ? Toast.Style.Success : Toast.Style.Failure,
        title: res.message,
        message: res.detail
      })
      await refresh(false)
    } finally {
      busyRef.current = false
      if (mountedRef.current) setIsLoading(false)
    }
  }

  const filtered = filterSharedFiles(status.files, searchText)
  const downloadable = status.files.filter((f) => f.downloadUrl).length

  const pickFilesAction = () =>
    Action({
      title: t('actionPickFiles'),
      icon: Icon.Plus,
      shortcut: { modifiers: ['ctrl'], key: 'o' },
      onAction: () => handleAddFiles()
    })

  const pickFolderAction = () =>
    Action({
      title: t('actionPickFolder'),
      icon: Icon.Folder,
      shortcut: { modifiers: ['ctrl', 'shift'], key: 'o' },
      onAction: () => handleAddFolder()
    })

  const refreshAction = () =>
    Action({
      title: t('actionRefreshStatus'),
      icon: Icon.ArrowClockwise,
      onAction: () => refresh(true)
    })

  const clearAllAction = () =>
    Action({
      title: t('actionClearAll'),
      icon: Icon.Trash,
      style: Action.Style.Destructive,
      shortcut: { modifiers: ['ctrl', 'shift'], key: 'backspace' },
      onAction: () => handleClearAll()
    })

  const listSection = (includeRefresh = true) =>
    ActionPanel.Section({
      title: t('sectionList'),
      children: [
        pickFilesAction(),
        pickFolderAction(),
        ...(includeRefresh ? [refreshAction()] : []),
        ...(status.files.length > 0 ? [clearAllAction()] : [])
      ]
    })

  const serviceItem = !status.ok
    ? List.Item({
        id: 'lan-service',
        title: t('errReadStatusFailed'),
        subtitle: status.error,
        icon: Icon.ExclamationMark,
        detail: List.Item.Detail({ markdown: serviceDetail(status) }),
        actions: ActionPanel({
          title: t('errReadStatusFailed'),
          children: [
            Action({ title: t('actionReload'), icon: Icon.ArrowClockwise, onAction: () => refresh(true) }),
            listSection(false)
          ]
        })
      })
    : status.running
    ? List.Item({
        id: 'lan-service',
        title: t('serviceRunningTitle', { url: status.portalUrl }),
        subtitle: t('noPasswordNote'),
        icon: Icon.Wifi,
        accessories: [{ tag: { value: t('tagRunning') } }],
        detail: List.Item.Detail({ markdown: serviceDetail(status) }),
        actions: ActionPanel({
          title: t('panelShareService'),
          children: [
            Action({
              title: t('actionCopyPortalUrl'),
              icon: Icon.Clipboard,
              onAction: () => copyWithToast(status.portalUrl, t('toastCopiedPortalUrl'), status.portalUrl)
            }),
            Action({
              title: t('actionStopService'),
              icon: Icon.Stop,
              shortcut: { modifiers: ['ctrl'], key: 'return' },
              onAction: () => handleStop()
            }),
            refreshAction(),
            listSection(false)
          ]
        })
      })
    : List.Item({
        id: 'lan-service',
        title: t('toastNotRunning'),
        subtitle: t('serviceStoppedSub'),
        icon: Icon.Wifi,
        accessories: [{ tag: { value: t('tagStopped') } }],
        detail: List.Item.Detail({ markdown: serviceDetail(status) }),
        actions: ActionPanel({
          title: t('panelShareService'),
          children: [
            Action({ title: t('actionStartService'), icon: Icon.Play, onAction: () => handleStart() }),
            refreshAction(),
            listSection(false)
          ]
        })
      })

  const fileItems = filtered.map((file) => {
    const actions: Array<ReturnType<typeof Action> | ReturnType<typeof ActionPanel.Section>> = []
    if (file.downloadUrl) {
      actions.push(
        Action({
          title: t('actionCopyDownloadUrl'),
          icon: Icon.Clipboard,
          onAction: () => copyWithToast(file.downloadUrl, t('toastCopiedDownloadUrl'), file.downloadUrl)
        })
      )
    }
    actions.push(
      Action({
        title: file.shared ? t('actionPauseFile') : t('actionResumeFile'),
        icon: file.shared ? Icon.Pause : Icon.Play,
        // 仅当存在「复制下载地址」作为首项时由第 2 顺位自动承接 Ctrl+Enter，避免无下载地址时首项错位
        onAction: () => handleToggle(file)
      }),
      Action({
        title: t('actionRemoveFile'),
        icon: Icon.XMarkCircle,
        shortcut: { modifiers: ['ctrl'], key: 'backspace' },
        onAction: () => handleRemove(file)
      }),
      listSection(true)
    )
    return List.Item({
      id: `lan-file-${file.id}`,
      title: file.name,
      subtitle: file.path,
      icon: Icon.Document,
      accessories: [
        { tag: { value: file.isDirectory ? t('tagDirectory') : !file.shared ? t('tagPaused') : status.running ? t('tagSharing') : t('tagServiceStopped') } },
        { text: formatBytes(file.sizeBytes) }
      ],
      detail: List.Item.Detail({ markdown: fileDetail(file, status) }),
      actions: ActionPanel({ title: file.name, children: actions })
    })
  })

  const clearSuffix = status.files.length > 0 ? t('summaryClearSuffix') : ''
  const summaryText = isImporting
    ? t('summaryImporting', { dirs: importProgress?.visitedDirs ?? 0, files: importProgress?.matchedFiles ?? 0 })
    : !status.ok
      ? t('summaryReadFailed', { error: status.error || '' })
      : status.running
        ? t('summaryRunning', { url: status.portalUrl, count: downloadable, suffix: clearSuffix })
        : status.files.length === 0
          ? t('summaryIdleEmpty')
          : t('summaryIdleWithFiles', { count: status.files.length, suffix: clearSuffix })

  return List({
    ...fileInputProps,
    navigationTitle: t('navTitle'),
    searchBarPlaceholder: t('searchPlaceholder'),
    onSearchTextChange: setSearchText,
    isShowingDetail: true,
    isLoading: isLoading || isImporting,
    actions: ActionPanel({
      children: [
        pickFilesAction(),
        pickFolderAction(),
        refreshAction(),
        ...(status.files.length > 0 ? [clearAllAction()] : [])
      ]
    }),
    filterBar: {
      summaryText,
      actions: [
        {
          id: 'pick-files',
          label: t('barPickFiles'),
          title: t('barPickFiles'),
          style: 'secondary',
          onAction: handleAddFiles
        },
        {
          id: 'pick-folder',
          label: t('barPickFolder'),
          title: t('barPickFolder'),
          style: 'secondary',
          onAction: handleAddFolder
        }
      ]
    },
    children: [
      List.Section({ title: t('secShareService'), children: [serviceItem] }),
      List.Section({ title: t('secSharedFiles', { count: filtered.length }), children: fileItems })
    ]
  })
}

export default LanShareCommand
