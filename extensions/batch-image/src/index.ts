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
  ImageProcessOutcome,
  ImageProcessSettings,
  OutputFormat,
  QualityTier,
  RealImageFileItem,
  ResizePreset,
  FORMAT_OPTIONS,
  IMAGE_IMPORT_RULES,
  IMAGE_IMPORT_SUPPORTED_TEXT,
  IMAGE_WORKSHOP_PRESETS,
  QUALITY_OPTIONS,
  RESIZE_OPTIONS,
  createImageImportTransport,
  describeOutcomeDetail,
  describeOutcomeTag,
  formatBytes,
  getFormatOptions,
  getImageWorkshopPresets,
  getQualityOptions,
  getResizeOptions,
  openImageFileLocation,
  parseClipboardImagePaths,
  processImageBatch,
  readClipboardImageFilePaths,
  summarizeOutcomes,
  toImageItem,
  trashImageFileItem
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

export * from './logic.js'

/** 插件入口子命令 → 处理方案 */
const FEATURE_TO_PRESET_ID: Record<string, string> = {
  'preset-lossless': 'preset-smart-lossless',
  'preset-gov-limit': 'preset-extreme-300k',
  'preset-to-jpg': 'preset-to-jpg',
  'preset-doc-bw': 'preset-doc-grayscale'
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function BatchImageCommand() {
  useLocale()
  const presets = getImageWorkshopPresets()
  const formatOptions = getFormatOptions()
  const qualityOptions = getQualityOptions()
  const resizeOptions = getResizeOptions()
  const launchCtx = (((globalThis as Record<string, unknown>).window || globalThis) as { __ztoolsLaunchContext?: { pluginId?: string; featureCode?: string } }).__ztoolsLaunchContext
  const initialFeature = launchCtx && (!launchCtx.pluginId || launchCtx.pluginId === 'batch-image') ? String(launchCtx.featureCode || '').trim() : ''
  const resolvedPresetId = FEATURE_TO_PRESET_ID[initialFeature] || initialFeature
  const initialPreset =
    presets.find((p) => p.id === resolvedPresetId) || presets[0]!
  const transport = createImageImportTransport()
  const [searchText, setSearchText] = useState('')
  const [activePresetId, setActivePresetId] = useState<string>(initialPreset.id)
  const [outputFormat, setOutputFormat] = useState<OutputFormat>(initialPreset.defaultFormat)
  const [qualityTier, setQualityTier] = useState<QualityTier>(initialPreset.defaultQuality)
  const [resizePreset, setResizePreset] = useState<ResizePreset>(initialPreset.defaultResize)

  const [files, setFiles] = useState<RealImageFileItem[]>([])
  const [checkedIds, setCheckedIds] = useState<string[]>([])
  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<{ visitedDirs: number; matchedFiles: number } | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [runningIds, setRunningIds] = useState<string[]>([])

  const runningRef = useRef(false)
  const importSeqRef = useRef(0)
  const importAbortRef = useRef<AbortController | null>(null)
  const filesRef = useRef<RealImageFileItem[]>(files)
  filesRef.current = files

  function applyImportResult(result: FileImportResult) {
    const incoming = result.files.map(toImageItem)
    const { merged, added, duplicates } = mergeByPath(filesRef.current, incoming, (f) => f.path)
    if (added.length > 0) {
      filesRef.current = merged
      setFiles(merged)
      setCheckedIds((prev) => Array.from(new Set([...prev, ...added.map((f) => f.id)])))
    }
    const summary = summarizeImport(result, { added: added.length, duplicates }, IMAGE_IMPORT_SUPPORTED_TEXT)
    if (summary) {
      void showToast({
        style: summary.ok ? Toast.Style.Success : Toast.Style.Failure,
        title: summary.title,
        message: summary.message
      })
    }
  }

  async function runImport(
    task: (
      signal: AbortSignal,
      onProgress: (progress: { visitedDirs: number; matchedFiles: number }) => void
    ) => Promise<FileImportResult>
  ) {
    importAbortRef.current?.abort()
    const controller = new AbortController()
    importAbortRef.current = controller
    const seq = ++importSeqRef.current
    setIsImporting(true)
    setImportProgress(null)
    try {
      const result = await task(controller.signal, (progress) => {
        if (seq === importSeqRef.current) setImportProgress(progress)
      })
      if (seq !== importSeqRef.current) return
      applyImportResult(result)
    } catch (err) {
      if (seq !== importSeqRef.current) return
      void showToast({ style: Toast.Style.Failure, title: t('importFailedTitle'), message: friendlyFileError(err) })
    } finally {
      if (seq === importSeqRef.current) {
        importAbortRef.current = null
        setIsImporting(false)
        setImportProgress(null)
      }
    }
  }

  function handlePickFiles() {
    void runImport(() => pickFiles(transport, IMAGE_IMPORT_RULES, { title: t('pickFilesTitle'), filterName: t('pickFilesFilterName') }))
  }

  function handlePickFolder() {
    void runImport(async (signal, onProgress) => {
      const picked = await pickFolder(transport, { title: t('pickFolderTitle') })
      if (signal.aborted || picked.canceled) {
        return { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: true }
      }
      if (picked.error || !picked.folderPath) {
        return { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: false, error: picked.error || t('noFolderSelected') }
      }
      if (isVolumeRoot(picked.folderPath)) {
        const confirmed = await confirmAlert({
          title: t('confirmRootTitle', { path: picked.folderPath }),
          message: t('confirmRootMsg'),
          primaryAction: { title: t('confirmRootAction'), style: 'default' }
        })
        if (signal.aborted || !confirmed) {
          return { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: true }
        }
      }
      return collectFolderFiles(transport, picked.folderPath, IMAGE_IMPORT_RULES, { signal, onProgress })
    })
  }

  function handleFileInput(input: NormalizedFileInput) {
    void runImport((signal, onProgress) =>
      expandInputPaths(transport, input.paths, IMAGE_IMPORT_RULES, {
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
          const input = normalizeFileInput(envelope)
          if (input.paths.length > 0) handleFileInput(input)
        }
        const off = eventsApi.on('plugin_files_dropped', onDrop)
        disposeDrop = () => {
          if (typeof off === 'function') off()
          else if (typeof eventsApi.off === 'function') eventsApi.off('plugin_files_dropped', onDrop)
        }
      }
    }
    return () => {
      importSeqRef.current += 1
      importAbortRef.current?.abort()
      disposeDrop?.()
    }
  }, [])

  function handleSelectPreset(presetId: string) {
    setActivePresetId(presetId)
    const found = presets.find((p) => p.id === presetId)
    if (found) {
      setOutputFormat(found.defaultFormat)
      setQualityTier(found.defaultQuality)
      setResizePreset(found.defaultResize)
    }
  }

  const activePreset = presets.find((p) => p.id === activePresetId) || presets[0]!

  async function executeBatchProcess(targetFiles: RealImageFileItem[]) {
    if (runningRef.current) return
    if (targetFiles.length === 0) {
      await showToast({
        style: Toast.Style.Failure,
        title: t('selectAtLeastOne')
      })
      return
    }

    const settings: ImageProcessSettings = {
      method: activePreset.method,
      outputFormat,
      qualityTier,
      resizePreset,
      grayscale: activePreset.grayscale,
      sizeLimitBytes: activePreset.sizeLimitBytes
    }

    runningRef.current = true
    setIsRunning(true)
    let progressToast: { hide: () => Promise<void> } | null = null
    const appliedOutcomes = new Map<string, ImageProcessOutcome>()
    try {
      progressToast = await showToast({
        style: Toast.Style.Animated,
        title: t('processingBatchTitle', { count: targetFiles.length }),
        message: activePreset.title
      })

      await processImageBatch(targetFiles, settings, {
        shouldSkip: (id: string) => !filesRef.current.some((item) => item.id === id),
        onStart: (id: string) => {
          setRunningIds([id])
        },
        onItem: (id: string, outcome: ImageProcessOutcome) => {
          setRunningIds((prev) => prev.filter((item) => item !== id))
          // 处理期间被用户移出列表的条目直接忽略，绝不重新写回列表
          if (!filesRef.current.some((item) => item.id === id)) return
          appliedOutcomes.set(id, outcome)
          const next = filesRef.current.map((item) => {
            if (item.id !== id) return item
            const knownSize =
              item.sizeBytes ?? (outcome.status === 'done' ? outcome.originalBytes : null)
            return { ...item, sizeBytes: knownSize, result: outcome }
          })
          filesRef.current = next
          setFiles(next)
        }
      })

      await progressToast?.hide()
      if (appliedOutcomes.size === 0) return
      const summary = summarizeOutcomes(appliedOutcomes.values())

      if (summary.done === 0) {
        await showToast({
          style: Toast.Style.Failure,
          title: summary.total > 1 ? t('batchAllFailedTitle', { total: summary.total }) : t('batchSingleFailedTitle'),
          message: summary.firstError || t('errHostReturnFailed')
        })
        return
      }
      if (summary.failed > 0) {
        await showToast({
          style: Toast.Style.Failure,
          title: t('batchPartialTitle', { done: summary.done, failed: summary.failed }),
          message: summary.firstError
        })
        return
      }
      if (summary.overLimit > 0 && settings.sizeLimitBytes) {
        await showToast({
          style: Toast.Style.Failure,
          title: t('batchOverLimitTitle', {
            done: summary.done,
            overLimit: summary.overLimit,
            limit: formatBytes(settings.sizeLimitBytes)
          }),
          message: t('batchOverLimitMsg')
        })
        return
      }
      const savedText =
        summary.comparableOriginalBytes > 0
          ? t('batchSavedPart', { size: formatBytes(summary.savedBytes), pct: summary.savePercent })
          : ''
      const notSmallerText = summary.notSmaller > 0 ? t('batchNotSmallerPart', { count: summary.notSmaller }) : ''
      await showToast({
        style: Toast.Style.Success,
        title: t('batchSuccessTitle', { done: summary.done }),
        message: t('batchSuccessMsg', {
          size: formatBytes(summary.outputBytes),
          saved: savedText,
          notSmaller: notSmallerText
        })
      })
    } catch (err) {
      await progressToast?.hide()
      await showToast({
        style: Toast.Style.Failure,
        title: t('processErrorTitle'),
        message: friendlyFileError(err)
      })
    } finally {
      await progressToast?.hide()
      setRunningIds([])
      runningRef.current = false
      setIsRunning(false)
    }
  }

  async function handleAddFromClipboard() {
    let clipText = ''
    try {
      clipText = await Clipboard.readText()
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: t('readClipboardFailed'),
        message: errorText(err)
      })
      return
    }
    let paths = parseClipboardImagePaths(clipText)
    if (paths.length === 0) {
      paths = await readClipboardImageFilePaths()
    }
    if (paths.length === 0) {
      await showToast({
        style: Toast.Style.Failure,
        title: t('noClipImagePathsTitle'),
        message: t('noClipImagePathsMsg', { supported: IMAGE_IMPORT_SUPPORTED_TEXT })
      })
      return
    }
    void runImport((signal, onProgress) =>
      expandInputPaths(transport, paths, IMAGE_IMPORT_RULES, { signal, onProgress })
    )
  }

  function handleRemoveFromList(file: RealImageFileItem) {
    if (runningIds.includes(file.id)) {
      void showToast({ style: Toast.Style.Failure, title: t('removeBusy') })
      return
    }
    const next = filesRef.current.filter((item) => item.id !== file.id)
    filesRef.current = next
    setFiles(next)
    setCheckedIds((prev) => prev.filter((id) => id !== file.id))
  }

  function handleClearList() {
    if (runningRef.current) {
      void showToast({ style: Toast.Style.Failure, title: t('clearBusy') })
      return
    }
    importSeqRef.current += 1
    importAbortRef.current?.abort()
    importAbortRef.current = null
    setIsImporting(false)
    setImportProgress(null)
    filesRef.current = []
    setFiles([])
    setCheckedIds([])
  }

  async function handleTrashOriginalImage(file: RealImageFileItem) {
    if (runningIds.includes(file.id)) {
      await showToast({ style: Toast.Style.Failure, title: t('trashBusy') })
      return
    }
    const outputNote =
      file.result?.status === 'done'
        ? t('trashNoteHasOutput', { path: file.result.outputPath })
        : t('trashNoteNoOutput')
    const confirmed = await confirmAlert({
      title: t('confirmTrashTitle'),
      message: t('confirmTrashMsg', {
        name: file.name,
        size: file.sizeBytes === null ? t('sizeUnknownShort') : formatBytes(file.sizeBytes),
        path: file.path,
        note: outputNote
      }),
      primaryAction: { title: t('confirmTrashAction'), style: 'destructive' }
    })
    if (!confirmed) return
    const res = await trashImageFileItem(file.path)
    if (!res.ok) {
      await showToast({
        style: Toast.Style.Failure,
        title: t('trashFailedTitle'),
        message: res.error || t('trashInUseMsg')
      })
      return
    }
    const next = filesRef.current.filter((item) => item.id !== file.id)
    filesRef.current = next
    setFiles(next)
    setCheckedIds((prev) => prev.filter((id) => id !== file.id))
    await showToast({
      style: Toast.Style.Success,
      title: t('trashSuccessTitle'),
      message: file.name
    })
  }

  async function handleRevealInFolder(file: RealImageFileItem) {
    const target = file.result?.status === 'done' ? file.result.outputPath : file.path
    const ok = await openImageFileLocation(target)
    if (!ok) {
      await showToast({
        style: Toast.Style.Failure,
        title: t('revealFailedTitle'),
        message: target
      })
    }
  }

  const q = searchText.trim().toLowerCase()
  const filteredFiles = files.filter(
    (f) =>
      !q ||
      f.name.toLowerCase().includes(q) ||
      f.path.toLowerCase().includes(q) ||
      f.extension.toLowerCase().includes(q)
  )

  const selectedFiles = files.filter((f) => checkedIds.includes(f.id))
  const selectedKnownBytes = selectedFiles.reduce((acc, f) => acc + (f.sizeBytes ?? 0), 0)
  const selectedUnknown = selectedFiles.filter((f) => f.sizeBytes === null).length
  const resultSummary = summarizeOutcomes(
    files.map((f) => f.result).filter((r): r is ImageProcessOutcome => Boolean(r))
  )
  const hasResults = resultSummary.total > 0

  const maxImageBytes = Math.max(1, ...files.map((f) => f.sizeBytes ?? 0))
  const outExtLabel = outputFormat === 'keep' ? t('originalExtLabel') : outputFormat
  const allFilteredChecked = filteredFiles.length > 0 && filteredFiles.every((item) => checkedIds.includes(item.id))

  function toggleAllFiltered() {
    const filteredIds = new Set(filteredFiles.map((item) => item.id))
    setCheckedIds((prev) =>
      allFilteredChecked
        ? prev.filter((id) => !filteredIds.has(id))
        : Array.from(new Set([...prev, ...filteredIds]))
    )
  }

  const pickFilesAction = () =>
    Action({
      title: t('actionPickFilesEllipsis'),
      icon: Icon.Plus,
      shortcut: { modifiers: ['ctrl'], key: 'o' },
      onAction: handlePickFiles
    })
  const pickFolderAction = () =>
    Action({
      title: t('actionPickFolderEllipsis'),
      icon: Icon.Folder,
      shortcut: { modifiers: ['ctrl', 'shift'], key: 'o' },
      onAction: handlePickFolder
    })
  const clipboardAction = () =>
    Action({
      title: t('actionFromClipboard'),
      icon: Icon.Clipboard,
      onAction: handleAddFromClipboard
    })

  const selectedSizeText = `${formatBytes(selectedKnownBytes)}${selectedUnknown > 0 ? t('selectedUnknownPart', { count: selectedUnknown }) : ''}`
  const resultText = hasResults ? t('resultSummaryPart', { done: resultSummary.done, failed: resultSummary.failed }) : ''

  const rightQueueItems = filteredFiles.map((f) => {
    const isChecked = checkedIds.includes(f.id)
    const isProcessingItem = runningIds.includes(f.id)
    const accessories: Array<Record<string, unknown>> = []
    if (f.sizeBytes !== null) {
      accessories.push({
        progress: { value: Math.max(8, Math.min(100, Math.round((f.sizeBytes / maxImageBytes) * 100))) }
      })
    }
    accessories.push({ tag: { value: describeOutcomeTag(f.result) } })
    accessories.push({ text: f.sizeBytes === null ? t('sizeUnknown') : formatBytes(f.sizeBytes) })

    const doneResult = f.result?.status === 'done' ? f.result : null
    const actionChildren: Array<ReturnType<typeof Action> | ReturnType<typeof ActionPanel.Section>> = [
      Action({
        title: t('actionRunSelected', { count: selectedFiles.length }),
        icon: Icon.Bolt,
        onAction: () => executeBatchProcess(selectedFiles)
      }),
      Action({
        title: doneResult ? t('actionRevealOutput') : t('actionRevealSource'),
        icon: Icon.Folder,
        shortcut: { modifiers: ['ctrl'], key: 'enter' },
        onAction: () => handleRevealInFolder(f)
      }),
      Action({
        title: t('actionRunSingle'),
        icon: Icon.Play,
        shortcut: { modifiers: ['ctrl'], key: 's' },
        onAction: () => executeBatchProcess([f])
      })
    ]
    if (doneResult) {
      actionChildren.push(
        Action({
          title: t('actionCopyOutputPath'),
          icon: Icon.CopyClipboard,
          shortcut: { modifiers: ['ctrl', 'shift'], key: 'c' },
          onAction: async () => {
            try {
              await Clipboard.copy(doneResult.outputPath)
              await showToast({ style: Toast.Style.Success, title: t('copiedOutputPathTitle'), message: doneResult.outputPath })
            } catch (err) {
              await showToast({ style: Toast.Style.Failure, title: t('copyFailedTitle'), message: errorText(err) })
            }
          }
        })
      )
    }
    actionChildren.push(
      ActionPanel.Section({
        title: t('sectionList'),
        children: [
          ...(isProcessingItem
            ? []
            : [
                Action({
                  title: t('actionRemove'),
                  icon: Icon.Minus,
                  shortcut: { modifiers: ['ctrl'], key: 'backspace' },
                  onAction: () => handleRemoveFromList(f)
                })
              ]),
          pickFilesAction(),
          pickFolderAction(),
          clipboardAction(),
          Action({
            title: allFilteredChecked ? t('actionDeselectAll') : t('actionSelectAll'),
            icon: Icon.CheckCircle,
            shortcut: { modifiers: ['ctrl'], key: 'a' },
            onAction: toggleAllFiltered
          }),
          Action({
            title: t('actionClearList'),
            icon: Icon.Trash,
            style: Action.Style.Destructive,
            shortcut: { modifiers: ['ctrl', 'shift'], key: 'backspace' },
            onAction: handleClearList
          })
        ]
      })
    )
    if (!isProcessingItem) {
      actionChildren.push(
        ActionPanel.Section({
          title: t('sectionFile'),
          children: [
            Action({
              title: t('actionTrashSource'),
              icon: Icon.Trash,
              style: Action.Style.Destructive,
              shortcut: { modifiers: [], key: 'delete' },
              onAction: () => handleTrashOriginalImage(f)
            })
          ]
        })
      )
    }

    return List.Item({
      id: f.id,
      title: f.name,
      subtitle: describeOutcomeDetail(f.result, f.parentDir),
      checkable: true,
      checked: isChecked,
      onCheckChange: (checked) => {
        setCheckedIds((prev) =>
          checked ? Array.from(new Set([...prev, f.id])) : prev.filter((id) => id !== f.id)
        )
      },
      icon: {
        source: Icon.Image,
        tintColor: Color.SecondaryText
      },
      accessories,
      actions: ActionPanel({
        title: f.name,
        children: actionChildren
      })
    })
  })

  const fileInputProps = createImportInputProps(handleFileInput, {
    allowClipboardImage: true,
    dropTitle: t('dropTitle'),
    dropSubtitle: t('dropSubtitle')
  })

  const inClient = isRealElectronHost()
  const summaryText = isImporting
    ? t('summaryImporting', { dirs: importProgress?.visitedDirs ?? 0, files: importProgress?.matchedFiles ?? 0 })
    : files.length === 0
      ? inClient
        ? t('summaryEmptyClient')
        : t('hostRequired')
      : t('summaryNormal', {
          selected: selectedFiles.length,
          total: files.length,
          size: selectedSizeText,
          result: resultText
        })

  const emptyText = !inClient
    ? t('hostRequired')
    : q && files.length > 0
      ? t('emptyNoMatch')
      : t('summaryEmptyClient')

  return List({
    ...fileInputProps,
    searchBarPlaceholder: t('searchPlaceholder', { supported: IMAGE_IMPORT_SUPPORTED_TEXT }),
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    isLoading: isImporting || isRunning,
    actions: ActionPanel({
      title: t('queueActionsTitle'),
      children: [pickFilesAction(), pickFolderAction(), clipboardAction()]
    }),
    searchBarAccessory: List.Dropdown({
      tooltip: t('dropdownTooltip'),
      value: activePresetId,
      onChange: (val) => handleSelectPreset(val),
      children: presets.map((p) =>
        List.Dropdown.Item({
          title: t('dropdownItemTitle', { tag: p.tag }),
          value: p.id
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
      title: t('wbTitle'),
      subtitle: activePreset.subtitle,
      fields: [
        {
          id: 'wb-format',
          label: t('wbFormatLabel'),
          type: 'select',
          value: outputFormat,
          onChange: (val) => setOutputFormat(val as OutputFormat),
          options: formatOptions
        },
        {
          id: 'wb-quality',
          label: t('wbQualityLabel'),
          type: 'select',
          value: qualityTier,
          onChange: (val) => setQualityTier(val as QualityTier),
          options: qualityOptions
        },
        {
          id: 'wb-scale',
          label: t('wbScaleLabel'),
          type: 'select',
          value: resizePreset,
          onChange: (val) => setResizePreset(val as ResizePreset),
          options: resizeOptions
        },
        {
          id: 'wb-outdir',
          label: t('wbOutdirLabel'),
          type: 'info',
          value: t('wbOutdirValue', { ext: outExtLabel })
        },
        {
          id: 'wb-limits',
          label: t('wbLimitsLabel'),
          type: 'info',
          value: t('wbLimitsValue')
        }
      ],
      previewCard: {
        title: t('previewTitle'),
        badge: hasResults ? t('previewBadgeDone', { done: resultSummary.done }) : t('previewBadgePending'),
        subtitle: t('previewSubtitle', { title: activePreset.title }),
        metrics: [
          { label: t('metricSelected'), value: t('metricSelectedVal', { selected: selectedFiles.length, total: files.length }) },
          { label: t('metricSelectedSize'), value: selectedSizeText },
          {
            label: t('metricOutSize'),
            value: hasResults && resultSummary.done > 0 ? formatBytes(resultSummary.outputBytes) : '—'
          },
          {
            label: t('metricSaved'),
            value:
              resultSummary.comparableOriginalBytes > 0
                ? `${formatBytes(resultSummary.savedBytes)} (-${resultSummary.savePercent}%)`
                : '—'
          },
          { label: t('metricFailed'), value: hasResults ? t('metricFailedVal', { count: resultSummary.failed }) : '—' }
        ]
      }
    },
    subList: {
      title: t('subListTitle'),
      subtitle: t('subListSubtitle', { count: filteredFiles.length }),
      checkable: filteredFiles.length > 0,
      checked: allFilteredChecked
        ? true
        : filteredFiles.some((f) => checkedIds.includes(f.id))
          ? 'indeterminate'
          : false,
      onCheckChange: () => toggleAllFiltered(),
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

export default BatchImageCommand
