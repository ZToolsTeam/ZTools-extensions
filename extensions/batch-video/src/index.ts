import {
  List,
  ActionPanel,
  Action,
  Icon,
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
  RealVideoFileItem,
  VideoProcessOutcome,
  VideoTaskId,
  HOST_FFMPEG_LIMIT_SECONDS,
  OUTPUT_SUFFIX,
  VIDEO_IMPORT_RULES,
  VIDEO_IMPORT_SUPPORTED_TEXT,
  VIDEO_TASKS,
  buildFfmpegCommand,
  createVideoImportTransport,
  describeOutcomeSubtitle,
  describeOutcomeTag,
  fileNameOf,
  formatBytes,
  getVideoTask,
  getVideoTasks,
  pickVideoFolderWithConfirm,
  processVideoBatch,
  resolveOutputFormat,
  revealVideoInFolder,
  selectVideoFiles,
  summarizeOutcomes,
  toVideoItem
} from './logic.js'
import { isRealElectronHost } from './native-ipc.js'
import { isDeclarativeFileInputSupported } from './host-compat.js'
import {
  FileImportResult,
  NormalizedFileInput,
  createImportInputProps,
  expandInputPaths,
  friendlyFileError,
  mergeByPath,
  normalizeFileInput,
  summarizeImport
} from './file-import.js'

export * from './logic.js'

const DEFAULT_FORMATS: Record<VideoTaskId, string> = {
  'convert-video': 'mp4',
  'to-gif': 'gif',
  'extract-audio': 'mp3'
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function BatchVideoCommand() {
  useLocale()
  const videoTasks = getVideoTasks()
  const transport = createVideoImportTransport()
  const [searchText, setSearchText] = useState('')
  const [taskId, setTaskId] = useState<VideoTaskId>(videoTasks[0]!.id)
  const [formatByTask, setFormatByTask] = useState<Record<VideoTaskId, string>>(DEFAULT_FORMATS)
  const [files, setFiles] = useState<RealVideoFileItem[]>([])
  const [checkedIds, setCheckedIds] = useState<string[]>([])
  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<{ visitedDirs: number; matchedFiles: number } | null>(null)
  const [running, setRunning] = useState(false)
  const [runningIds, setRunningIds] = useState<string[]>([])

  const runningRef = useRef(false)
  const stopRef = useRef(false)
  const importTicketRef = useRef(0)
  const importAbortRef = useRef<AbortController | null>(null)
  const filesRef = useRef<RealVideoFileItem[]>(files)
  filesRef.current = files
  const stopToastRef = useRef<{ hide: () => Promise<void> | void } | null>(null)

  async function importWithTicket(
    executor: (
      signal: AbortSignal,
      onProgress: (progress: { visitedDirs: number; matchedFiles: number }) => void
    ) => Promise<FileImportResult>
  ) {
    importAbortRef.current?.abort()
    const controller = new AbortController()
    importAbortRef.current = controller
    const ticket = ++importTicketRef.current
    setIsImporting(true)
    setImportProgress(null)
    try {
      const result = await executor(controller.signal, progress => {
        if (ticket === importTicketRef.current) setImportProgress(progress)
      })
      if (ticket !== importTicketRef.current) return
      const incoming = result.files.map(toVideoItem)
      const { merged, added, duplicates } = mergeByPath(filesRef.current, incoming, item => item.path)
      if (added.length > 0) {
        filesRef.current = merged
        setFiles(merged)
        setCheckedIds(prev => Array.from(new Set([...prev, ...added.map(item => item.id)])))
      }
      const notice = summarizeImport(result, { added: added.length, duplicates }, VIDEO_IMPORT_SUPPORTED_TEXT)
      if (notice) {
        void showToast({
          style: notice.ok ? Toast.Style.Success : Toast.Style.Failure,
          title: notice.title,
          message: notice.message
        })
      }
    } catch (err) {
      if (ticket !== importTicketRef.current) return
      void showToast({ style: Toast.Style.Failure, title: t('importFailedTitle'), message: friendlyFileError(err) })
    } finally {
      if (ticket === importTicketRef.current) {
        importAbortRef.current = null
        setIsImporting(false)
        setImportProgress(null)
      }
    }
  }

  function handleAddVideoFiles() {
    void importWithTicket(() => selectVideoFiles())
  }

  function handleAddVideoFolder() {
    void importWithTicket((signal, onProgress) =>
      pickVideoFolderWithConfirm(
        transport,
        folderPath =>
          confirmAlert({
            title: t('confirmRootTitle', { path: folderPath }),
            message: t('confirmRootMsg'),
            primaryAction: { title: t('confirmRootAction'), style: 'default' }
          }),
        { signal, onProgress }
      )
    )
  }

  function handleVideoFileInput(input: NormalizedFileInput) {
    void importWithTicket((signal, onProgress) =>
      expandInputPaths(transport, input.paths, VIDEO_IMPORT_RULES, {
        knownDirectories: input.directories,
        signal,
        onProgress
      })
    )
  }

  useEffect(() => {
    let disposeDrop: (() => void) | undefined
    if (!isDeclarativeFileInputSupported()) {
      const w = typeof window !== 'undefined' ? (window as { ztools?: { events?: { on?: (event: string, cb: (env: unknown) => void) => (() => void) | void; off?: (event: string, cb: (env: unknown) => void) => void } } }) : null
      const eventsApi = w?.ztools?.events
      if (eventsApi && typeof eventsApi.on === 'function') {
        const onDrop = (envelope: unknown) => {
          const parsed = normalizeFileInput(envelope)
          if (parsed.paths.length > 0) handleVideoFileInput(parsed)
        }
        const off = eventsApi.on('plugin_files_dropped', onDrop)
        disposeDrop = () => {
          if (typeof off === 'function') off()
          else if (typeof eventsApi.off === 'function') eventsApi.off('plugin_files_dropped', onDrop)
        }
      }
    }
    return () => {
      importTicketRef.current += 1
      importAbortRef.current?.abort()
      disposeDrop?.()
    }
  }, [])

  const fileInputProps = createImportInputProps(handleVideoFileInput, {
    dropTitle: t('dropTitle'),
    dropSubtitle: t('dropSubtitle')
  })

  const activeTask = getVideoTask(taskId)
  const activeFormat = resolveOutputFormat(activeTask, formatByTask[taskId]) || activeTask.formats[0]!.value

  async function executeBatch(targets: RealVideoFileItem[]) {
    if (runningRef.current) {
      await showToast({ style: Toast.Style.Failure, title: t('busyWait') })
      return
    }
    if (targets.length === 0) {
      await showToast({ style: Toast.Style.Failure, title: t('selectVideoFirst') })
      return
    }
    const settings = { taskId, format: activeFormat }
    runningRef.current = true
    stopRef.current = false
    setRunning(true)
    let progressToast: { hide: () => Promise<void> | void } | null = null
    const appliedOutcomes = new Map<string, VideoProcessOutcome>()
    try {
      progressToast = await showToast({
        style: Toast.Style.Animated,
        title: t('processingTitle', { count: targets.length }),
        message: t('processingMsg', {
          title: activeTask.title,
          format: activeFormat.toUpperCase(),
          seconds: HOST_FFMPEG_LIMIT_SECONDS
        })
      })
      await processVideoBatch(targets, settings, {
        shouldSkip: id => !filesRef.current.some(item => item.id === id),
        onStart: id => setRunningIds([id]),
        onItem: (id: string, outcome: VideoProcessOutcome) => {
          setRunningIds(prev => prev.filter(item => item !== id))
          if (!filesRef.current.some(item => item.id === id)) return
          appliedOutcomes.set(id, outcome)
          const next = filesRef.current.map(item => (item.id === id ? { ...item, result: outcome } : item))
          filesRef.current = next
          setFiles(next)
        },
        shouldStop: () => stopRef.current
      })
      await progressToast?.hide()
      if (appliedOutcomes.size === 0 && !stopRef.current) return
      const summary = summarizeOutcomes(appliedOutcomes.values())
      const notStarted = targets.length - summary.total

      if (summary.done === 0) {
        await showToast({
          style: Toast.Style.Failure,
          title:
            summary.total === 0
              ? t('stoppedNoProcessed')
              : summary.total > 1
                ? t('allFailedTitle', { total: summary.total })
                : t('singleFailedTitle'),
          message: summary.firstError || t('stoppedDefaultMsg')
        })
        return
      }
      if (summary.failed > 0 || notStarted > 0) {
        await showToast({
          style: Toast.Style.Failure,
          title: t('partialTitle', {
            done: summary.done,
            failed: summary.failed,
            notStarted: notStarted > 0 ? t('partialNotStarted', { count: notStarted }) : ''
          }),
          message: summary.firstError || t('stoppedDefaultMsg')
        })
        return
      }
      await showToast({
        style: Toast.Style.Success,
        title: t('successTitle', { done: summary.done }),
        message: t('successMsg', { size: formatBytes(summary.outputBytes), suffix: OUTPUT_SUFFIX })
      })
    } catch (err) {
      await showToast({ style: Toast.Style.Failure, title: t('processErrorTitle'), message: friendlyFileError(err) })
    } finally {
      await progressToast?.hide()
      await stopToastRef.current?.hide()
      stopToastRef.current = null
      setRunningIds([])
      runningRef.current = false
      stopRef.current = false
      setRunning(false)
    }
  }

  async function requestStop() {
    if (!runningRef.current) return
    stopRef.current = true
    stopToastRef.current = await showToast({ style: Toast.Style.Animated, title: t('stoppingTitle') })
  }

  function handleRemoveVideo(file: RealVideoFileItem) {
    if (runningIds.includes(file.id)) {
      void showToast({ style: Toast.Style.Failure, title: t('removeBusy') })
      return
    }
    const next = filesRef.current.filter(item => item.id !== file.id)
    filesRef.current = next
    setFiles(next)
    setCheckedIds(prev => prev.filter(id => id !== file.id))
  }

  function handleClearVideos() {
    if (runningRef.current) {
      void showToast({ style: Toast.Style.Failure, title: t('clearBusy') })
      return
    }
    importTicketRef.current += 1
    importAbortRef.current?.abort()
    importAbortRef.current = null
    setIsImporting(false)
    setImportProgress(null)
    filesRef.current = []
    setFiles([])
    setCheckedIds([])
  }

  async function handleReveal(file: RealVideoFileItem) {
    const shown = await revealVideoInFolder(file)
    if (shown === 'failed') {
      await showToast({ style: Toast.Style.Failure, title: t('revealFailedTitle'), message: file.path })
      return
    }
    if (shown === 'source' && file.result?.status === 'done') {
      await showToast({
        style: Toast.Style.Success,
        title: t('revealSourceToastTitle'),
        message: fileNameOf(file.result.outputPath)
      })
    }
  }

  async function copyText(text: string, title: string) {
    try {
      await Clipboard.copy(text)
      await showToast({ style: Toast.Style.Success, title, message: text })
    } catch (err) {
      await showToast({ style: Toast.Style.Failure, title: t('copyFailedTitle'), message: errorText(err) })
    }
  }

  const q = searchText.trim().toLowerCase()
  const filteredFiles = files.filter(f => !q || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
  const selectedFiles = files.filter(f => checkedIds.includes(f.id))
  const selectedKnownBytes = selectedFiles.reduce((sum, f) => sum + (f.sizeBytes ?? 0), 0)
  const selectedUnknownCount = selectedFiles.filter(f => f.sizeBytes === null).length
  const selectedBytesText =
    selectedFiles.length > 0 && selectedUnknownCount === selectedFiles.length
      ? t('sizeUnknown')
      : `${formatBytes(selectedKnownBytes)}${selectedUnknownCount > 0 ? t('unknownSizePart', { count: selectedUnknownCount }) : ''}`
  const doneFiles = files.filter(f => f.result?.status === 'done')
  const doneKnownSourceBytes = doneFiles.reduce((sum, f) => sum + (f.sizeBytes ?? 0), 0)
  const resultSummary = summarizeOutcomes(
    files.map(f => f.result).filter((r): r is VideoProcessOutcome => Boolean(r))
  )
  const hasResults = resultSummary.total > 0
  const allFilteredChecked = filteredFiles.length > 0 && filteredFiles.every(f => checkedIds.includes(f.id))
  const maxVideoBytes = Math.max(1, ...files.map(f => f.sizeBytes ?? 0))

  /** 勾选 / 取消勾选当前搜索结果里的全部视频，不影响搜索结果以外已勾选的项 */
  function setFilteredChecked(checked: boolean) {
    const filteredIds = new Set(filteredFiles.map(f => f.id))
    setCheckedIds(prev =>
      checked ? Array.from(new Set([...prev, ...filteredIds])) : prev.filter(id => !filteredIds.has(id))
    )
  }

  const pickFilesAction = () =>
    Action({
      title: t('actionPickFilesEllipsis'),
      icon: Icon.Plus,
      shortcut: { modifiers: ['ctrl'], key: 'o' },
      onAction: handleAddVideoFiles
    })
  const pickFolderAction = () =>
    Action({
      title: t('actionPickFolderEllipsis'),
      icon: Icon.Folder,
      shortcut: { modifiers: ['ctrl', 'shift'], key: 'o' },
      onAction: handleAddVideoFolder
    })

  const rightQueueItems = filteredFiles.map(f => {
    const doneResult = f.result?.status === 'done' ? f.result : null
    const isItemRunning = runningIds.includes(f.id)
    const accessories: Array<Record<string, unknown>> = []
    if (f.sizeBytes !== null) {
      accessories.push({ progress: { value: Math.max(8, Math.min(100, Math.round((f.sizeBytes / maxVideoBytes) * 100))) } })
    }
    accessories.push({ tag: { value: describeOutcomeTag(f.result) } })
    accessories.push({ text: f.sizeBytes === null ? t('sizeUnknown') : formatBytes(f.sizeBytes) })

    const actionChildren: Array<ReturnType<typeof Action> | ReturnType<typeof ActionPanel.Section>> = [
      running
        ? Action({
            title: t('actionStopProcessing'),
            icon: Icon.Stop,
            onAction: requestStop
          })
        : Action({
            title: t('actionStartSelected', { count: selectedFiles.length }),
            icon: Icon.Bolt,
            onAction: () => executeBatch(selectedFiles)
          }),
      Action({
        title: doneResult ? t('actionRevealOutput') : t('actionReveal'),
        icon: Icon.Folder,
        shortcut: { modifiers: ['ctrl'], key: 'enter' },
        onAction: () => handleReveal(f)
      }),
      Action({
        title: t('actionRunSingle'),
        icon: Icon.Play,
        onAction: () => executeBatch([f])
      }),
      Action({
        title: t('actionCopyFfmpeg'),
        icon: Icon.Terminal,
        onAction: () => copyText(buildFfmpegCommand(f.path, activeFormat), t('copiedFfmpegTitle'))
      })
    ]
    if (doneResult) {
      actionChildren.push(
        Action({
          title: t('actionCopyOutputPath'),
          icon: Icon.CopyClipboard,
          onAction: () => copyText(doneResult.outputPath, t('copiedOutputPathTitle'))
        })
      )
    }
    actionChildren.push(
      ActionPanel.Section({
        title: t('sectionList'),
        children: [
          ...(isItemRunning
            ? []
            : [
                Action({
                  title: t('actionRemove'),
                  icon: Icon.Minus,
                  shortcut: { modifiers: ['ctrl'], key: 'backspace' },
                  onAction: () => handleRemoveVideo(f)
                })
              ]),
          pickFilesAction(),
          pickFolderAction(),
          Action({
            title: allFilteredChecked ? t('actionDeselectAll') : t('actionSelectAll'),
            icon: Icon.CheckCircle,
            shortcut: { modifiers: ['ctrl'], key: 'a' },
            onAction: () => setFilteredChecked(!allFilteredChecked)
          }),
          Action({
            title: t('actionClearList'),
            icon: Icon.Trash,
            style: Action.Style.Destructive,
            shortcut: { modifiers: ['ctrl', 'shift'], key: 'backspace' },
            onAction: handleClearVideos
          })
        ]
      })
    )

    return List.Item({
      id: f.id,
      title: f.name,
      subtitle: describeOutcomeSubtitle(f),
      checkable: true,
      checked: checkedIds.includes(f.id),
      onCheckChange: c => {
        setCheckedIds(prev => (c ? Array.from(new Set([...prev, f.id])) : prev.filter(id => id !== f.id)))
      },
      icon: {
        source: Icon.Video
      },
      accessories,
      actions: ActionPanel({
        title: f.name,
        children: actionChildren
      })
    })
  })

  const inClient = isRealElectronHost()
  const resultText = hasResults ? t('resultSummaryPart', { done: resultSummary.done, failed: resultSummary.failed }) : ''
  const summaryText = isImporting
    ? t('summaryImporting', { dirs: importProgress?.visitedDirs ?? 0, files: importProgress?.matchedFiles ?? 0 })
    : files.length === 0
      ? inClient
        ? t('summaryEmptyClient')
        : t('hostRequired')
      : t('summaryNormal', {
          selected: selectedFiles.length,
          total: files.length,
          bytes: selectedBytesText,
          result: resultText
        })

  const emptyText = !inClient
    ? t('hostRequired')
    : q && files.length > 0
      ? t('emptyNoMatch')
      : t('summaryEmptyClient')

  return List({
    ...fileInputProps,
    searchBarPlaceholder: t('searchPlaceholder'),
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    isLoading: isImporting || running,
    actions: ActionPanel({
      children: [pickFilesAction(), pickFolderAction()]
    }),
    searchBarAccessory: List.Dropdown({
      tooltip: t('dropdownTooltip'),
      value: taskId,
      onChange: val => setTaskId(getVideoTask(val).id),
      children: videoTasks.map(task =>
        List.Dropdown.Item({
          title: t('dropdownItemTitle', { tag: task.tag }),
          value: task.id
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
          onAction: handleAddVideoFiles
        },
        {
          id: 'pick-folder',
          label: t('btnPickFolder'),
          title: t('btnPickFolder'),
          style: 'secondary',
          onAction: handleAddVideoFolder
        }
      ]
    }),
    workbenchPanel: {
      title: t('wbTitle'),
      subtitle: activeTask.tag,
      fields: [
        activeTask.formats.length > 1
          ? {
              id: 'wb-format',
              label: t('wbFormatLabel'),
              type: 'select',
              value: activeFormat,
              onChange: val => {
                const next = resolveOutputFormat(activeTask, String(val))
                if (next) setFormatByTask(prev => ({ ...prev, [taskId]: next }))
              },
              options: activeTask.formats.map(opt => ({ label: opt.label, value: opt.value }))
            }
          : {
              id: 'wb-format',
              label: t('wbFormatLabel'),
              type: 'info',
              value: activeTask.formats[0]!.label
            },
        {
          id: 'wb-codec',
          label: t('wbCodecLabel'),
          type: 'info',
          value: t('wbCodecValue')
        },
        {
          id: 'wb-outdir',
          label: t('wbOutdirLabel'),
          type: 'info',
          value: t('wbOutdirValue', { suffix: OUTPUT_SUFFIX, ext: activeFormat })
        },
        {
          id: 'wb-limit',
          label: t('wbLimitLabel'),
          type: 'info',
          value: t('wbLimitValue', { seconds: HOST_FFMPEG_LIMIT_SECONDS })
        }
      ],
      previewCard: {
        title: hasResults ? t('previewTitleResults') : t('previewTitleInfo'),
        badge: hasResults ? t('previewBadgeResults', { done: resultSummary.done, failed: resultSummary.failed }) : t('previewBadgePending'),
        subtitle: t('previewSubtitle', { subtitle: activeTask.subtitle, suffix: OUTPUT_SUFFIX }),
        metrics: [
          { label: t('metricDone'), value: t('metricCountVal', { count: resultSummary.done }) },
          { label: t('metricFailed'), value: t('metricCountVal', { count: resultSummary.failed }) },
          { label: t('metricOutSize'), value: resultSummary.done > 0 ? formatBytes(resultSummary.outputBytes) : '—' },
          {
            label: t('metricSourceSize'),
            value: resultSummary.done > 0 && doneKnownSourceBytes > 0 ? formatBytes(doneKnownSourceBytes) : '—'
          }
        ]
      }
    },
    subList: {
      title: t('subListTitle'),
      subtitle: t('metricCountVal', { count: filteredFiles.length }),
      checkable: filteredFiles.length > 0,
      checked: allFilteredChecked
        ? true
        : filteredFiles.some(f => checkedIds.includes(f.id))
          ? 'indeterminate'
          : false,
      onCheckChange: checked => setFilteredChecked(Boolean(checked)),
      emptyText,
      items: rightQueueItems
    },
    children: [
      List.Section({
        title: t('sectionQueueTitle', { count: filteredFiles.length }),
        children: rightQueueItems
      })
    ]
  })
}

export default BatchVideoCommand
