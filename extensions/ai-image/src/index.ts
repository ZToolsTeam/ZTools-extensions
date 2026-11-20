import {
  List,
  ActionPanel,
  Action,
  Icon,
  useState,
  useEffect,
  useRef,
  showToast,
  Toast,
  confirmAlert,
  FilterBar,
  useLocale
} from '@ztools/declarative-ui'
import type { ListItemAccessory } from '@ztools/declarative-ui'
import { t } from './i18n.js'
import {
  FileImportResult,
  NormalizedFileInput,
  createImportInputProps,
  isVolumeRoot,
  mergeByPath,
  normalizeFileInput,
  summarizeImport
} from './file-import.js'
import { isDeclarativeFileInputSupported } from './host-compat.js'
import {
  AI_IMAGE_ENGINES,
  AI_IMAGE_SUPPORTED_TEXT,
  AiImageBatchResult,
  AiImageFileItem,
  AiImageOutputFormat,
  AiImageScale,
  AI_INFERENCE_UNAVAILABLE_REASON,
  collectAiImageFolderFiles,
  executeAiImageBatch,
  expandAiImageInputPaths,
  formatAiImageError,
  formatBytes,
  getAiImageEngines,
  importedFileToAiImageItem,
  isAiImageHostReady,
  openAiImageLocation,
  pickAiImageFolder,
  selectAiImageFiles
} from './logic.js'

export * from './logic.js'

interface ItemOutcome {
  ok: boolean
  /** 成功时为输出文件路径，失败时为错误原因 */
  detail: string
  resolution: string
}

interface HostEventsWindow {
  ztools?: {
    events?: {
      on?: (event: string, cb: (payload: unknown) => void) => (() => void) | void
    }
  }
}

function baseName(fullPath: string): string {
  return fullPath.split(/[\\/]/).pop() || fullPath
}

function resolutionText(width: number, height: number): string {
  return width > 0 && height > 0 ? `${width}×${height}` : ''
}

function formatSizeText(sizeBytes: number | null): string {
  return sizeBytes === null ? t('sizeUnknown') : formatBytes(sizeBytes)
}

function formatTotalSize(items: readonly AiImageFileItem[]): string {
  if (items.length === 0) return '0 B'
  let knownBytes = 0
  let hasKnown = false
  for (const item of items) {
    if (item.sizeBytes !== null) {
      knownBytes += item.sizeBytes
      hasKnown = true
    }
  }
  return hasKnown ? formatBytes(knownBytes) : t('sizeUnknown')
}

export function AiImageCommand() {
  useLocale()
  const engines = getAiImageEngines()
  const [searchText, setSearchText] = useState('')
  const [activeEngineId, setActiveEngineId] = useState<string>(engines[0].id)
  const [scaleFactor, setScaleFactor] = useState<AiImageScale>('2x')
  const [outputFormat, setOutputFormat] = useState<AiImageOutputFormat>('png')
  const [files, setFiles] = useState<AiImageFileItem[]>([])
  const [checkedIds, setCheckedIds] = useState<string[]>([])
  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<{ visitedDirs: number; matchedFiles: number } | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingIds, setProcessingIds] = useState<string[]>([])
  const [outcomes, setOutcomes] = useState<Record<string, ItemOutcome>>({})
  const [lastRunText, setLastRunText] = useState('')

  const filesRef = useRef<AiImageFileItem[]>([])
  const processingRef = useRef(false)
  const processingIdsRef = useRef<Set<string>>(new Set())
  const mountedRef = useRef(true)
  const importBatchRef = useRef(0)
  const importAbortRef = useRef<AbortController | null>(null)

  function updateFiles(updater: (prev: AiImageFileItem[]) => AiImageFileItem[]): AiImageFileItem[] {
    const next = updater(filesRef.current)
    filesRef.current = next
    setFiles(next)
    return next
  }

  function startImportBatch(): { batchId: number; signal: AbortSignal } {
    importAbortRef.current?.abort()
    const controller = new AbortController()
    importAbortRef.current = controller
    importBatchRef.current += 1
    return { batchId: importBatchRef.current, signal: controller.signal }
  }

  function commitImportResult(batchId: number, result: FileImportResult) {
    if (!mountedRef.current || batchId !== importBatchRef.current) return
    if (result.canceled) return
    if (result.error) {
      const errSummary = summarizeImport(result, { added: 0 }, AI_IMAGE_SUPPORTED_TEXT)
      if (errSummary) {
        showToast({ style: Toast.Style.Failure, title: errSummary.title, message: errSummary.message })
      }
      return
    }
    const incoming = result.files.map(importedFileToAiImageItem)
    const { merged, added, duplicates } = mergeByPath(filesRef.current, incoming, f => f.path)
    if (added.length > 0) {
      filesRef.current = merged
      setFiles(merged)
      const addedIds = added.map(f => f.id)
      setCheckedIds(prev => Array.from(new Set([...prev, ...addedIds])))
    }
    const summary = summarizeImport(result, { added: added.length, duplicates }, AI_IMAGE_SUPPORTED_TEXT)
    if (summary) {
      showToast({
        style: summary.ok ? Toast.Style.Success : Toast.Style.Failure,
        title: summary.title,
        message: summary.message
      })
    }
  }

  async function handlePickFiles() {
    if (!isAiImageHostReady()) {
      showToast({ style: Toast.Style.Failure, title: t('importFailedTitle'), message: t('hostRequired') })
      return
    }
    const { batchId } = startImportBatch()
    try {
      const res = await selectAiImageFiles()
      commitImportResult(batchId, res)
    } catch (err) {
      if (mountedRef.current && batchId === importBatchRef.current) {
        showToast({ style: Toast.Style.Failure, title: t('importFailedTitle'), message: formatAiImageError(err) })
      }
    }
  }

  async function handlePickFolder() {
    if (!isAiImageHostReady()) {
      showToast({ style: Toast.Style.Failure, title: t('importFailedTitle'), message: t('hostRequired') })
      return
    }
    const { batchId, signal } = startImportBatch()
    try {
      const picked = await pickAiImageFolder()
      if (!mountedRef.current || batchId !== importBatchRef.current) return
      if (picked.canceled) return
      if (picked.error || !picked.folderPath) {
        showToast({ style: Toast.Style.Failure, title: t('importFailedTitle'), message: picked.error || t('noFolderSelected') })
        return
      }
      if (isVolumeRoot(picked.folderPath)) {
        const confirmed = await confirmAlert({
          title: t('confirmRootTitle', { path: picked.folderPath }),
          message: t('confirmRootMessage', { supported: AI_IMAGE_SUPPORTED_TEXT }),
          primaryAction: { title: t('confirmRootAction'), style: 'default' }
        })
        if (!confirmed || !mountedRef.current || batchId !== importBatchRef.current) return
      }
      setIsImporting(true)
      setImportProgress({ visitedDirs: 0, matchedFiles: 0 })
      const res = await collectAiImageFolderFiles(picked.folderPath, {
        signal,
        onProgress: p => {
          if (mountedRef.current && importBatchRef.current === batchId) {
            setImportProgress(p)
          }
        }
      })
      commitImportResult(batchId, res)
    } catch (err) {
      if (mountedRef.current && batchId === importBatchRef.current) {
        showToast({ style: Toast.Style.Failure, title: t('importFailedTitle'), message: formatAiImageError(err) })
      }
    } finally {
      if (mountedRef.current && importBatchRef.current === batchId) {
        setIsImporting(false)
        setImportProgress(null)
      }
    }
  }

  async function handleInputPaths(input: NormalizedFileInput) {
    if (!isAiImageHostReady()) {
      showToast({ style: Toast.Style.Failure, title: t('importFailedTitle'), message: t('hostRequired') })
      return
    }
    const { batchId, signal } = startImportBatch()
    setIsImporting(true)
    setImportProgress({ visitedDirs: 0, matchedFiles: 0 })
    try {
      const res = await expandAiImageInputPaths(input.paths, {
        knownDirectories: input.directories,
        signal,
        onProgress: p => {
          if (mountedRef.current && importBatchRef.current === batchId) {
            setImportProgress(p)
          }
        }
      })
      commitImportResult(batchId, res)
    } catch (err) {
      if (mountedRef.current && batchId === importBatchRef.current) {
        showToast({ style: Toast.Style.Failure, title: t('importFailedTitle'), message: formatAiImageError(err) })
      }
    } finally {
      if (mountedRef.current && importBatchRef.current === batchId) {
        setIsImporting(false)
        setImportProgress(null)
      }
    }
  }

  useEffect(() => {
    mountedRef.current = true
    const win = typeof window !== 'undefined' ? (window as unknown as HostEventsWindow) : undefined
    const unsub = !isDeclarativeFileInputSupported()
      ? win?.ztools?.events?.on?.('plugin_files_dropped', raw => {
          const input = normalizeFileInput(raw)
          if (input.paths.length > 0) void handleInputPaths(input)
        })
      : undefined
    return () => {
      mountedRef.current = false
      importBatchRef.current += 1
      importAbortRef.current?.abort()
      importAbortRef.current = null
      if (typeof unsub === 'function') unsub()
    }
  }, [])

  function removeFileFromList(targetId: string) {
    if (processingIdsRef.current.has(targetId)) return
    updateFiles(prev => prev.filter(f => f.id !== targetId))
    setCheckedIds(prev => prev.filter(id => id !== targetId))
    setOutcomes(prev => {
      if (!(targetId in prev)) return prev
      const next = { ...prev }
      delete next[targetId]
      return next
    })
  }

  function clearQueue() {
    if (processingRef.current) {
      showToast({ style: Toast.Style.Failure, title: t('clearWhileProcessing') })
      return
    }
    importBatchRef.current += 1
    importAbortRef.current?.abort()
    importAbortRef.current = null
    setIsImporting(false)
    setImportProgress(null)
    updateFiles(() => [])
    setCheckedIds([])
    setOutcomes({})
    setLastRunText('')
  }

  const fileInputProps = createImportInputProps(
    input => {
      void handleInputPaths(input)
    },
    {
      allowClipboardImage: true,
      dropTitle: t('dropTitle'),
      dropSubtitle: t('dropSubtitle', { supported: AI_IMAGE_SUPPORTED_TEXT })
    }
  )

  const activeEngine = engines.find(e => e.id === activeEngineId) || engines[0]
  const unavailableReason = activeEngine.unavailableReason || t('aiInferenceUnavailable')
  const formatLabel = outputFormat.toUpperCase()

  function applyResult(targets: AiImageFileItem[], res: AiImageBatchResult) {
    const activeIds = new Set(filesRef.current.map(f => f.id))
    const idByPath = new Map(targets.map(f => [f.path, f.id]))
    const updates: Record<string, ItemOutcome> = {}
    for (const o of res.outputs) {
      const id = idByPath.get(o.inputPath)
      if (id && activeIds.has(id)) {
        updates[id] = { ok: true, detail: o.outputPath, resolution: resolutionText(o.width, o.height) }
      }
    }
    for (const fail of res.failures) {
      const id = idByPath.get(fail.inputPath)
      if (id && activeIds.has(id)) {
        updates[id] = { ok: false, detail: fail.error, resolution: '' }
      }
    }
    if (Object.keys(updates).length > 0) {
      setOutcomes(prev => ({ ...prev, ...updates }))
    }
  }

  async function runBatch(targets: AiImageFileItem[], askConfirm: boolean) {
    if (processingRef.current) {
      showToast({ style: Toast.Style.Failure, title: t('processingWait') })
      return
    }
    if (targets.length === 0) {
      showToast({ style: Toast.Style.Failure, title: t('selectImagesFirst') })
      return
    }
    if (!activeEngine.available) {
      showToast({ style: Toast.Style.Failure, title: t('engineUnavailableTitle', { title: activeEngine.title }), message: unavailableReason })
      return
    }
    if (askConfirm && targets.length > 1) {
      const confirmed = await confirmAlert({
        title: t('confirmBatchTitle', { count: targets.length }),
        message: t('confirmBatchMessage', { title: activeEngine.title, scale: scaleFactor, format: formatLabel }),
        primaryAction: { title: t('confirmBatchAction'), style: 'default' }
      })
      if (!confirmed) return
    }

    const targetIds = targets.map(t => t.id)
    processingRef.current = true
    processingIdsRef.current = new Set(targetIds)
    setIsProcessing(true)
    setProcessingIds(targetIds)

    let res: AiImageBatchResult
    try {
      res = await executeAiImageBatch(
        targets,
        { engineId: activeEngine.id, scaleFactor, outputFormat },
        undefined,
        new Date(),
        {
          shouldProcess: item => mountedRef.current && filesRef.current.some(cur => cur.id === item.id)
        }
      )
    } catch (err) {
      if (mountedRef.current) {
        showToast({ style: Toast.Style.Failure, title: t('processFailedTitle'), message: formatAiImageError(err) })
      }
      return
    } finally {
      processingRef.current = false
      processingIdsRef.current = new Set()
      if (mountedRef.current) {
        setIsProcessing(false)
        setProcessingIds([])
      }
    }

    if (!mountedRef.current) return

    applyResult(targets, res)
    if (res.processedCount === 0) {
      setLastRunText(res.failedCount > 0 ? t('lastRunAllFailed', { count: res.failedCount }) : t('lastRunNotStarted'))
      showToast({
        style: Toast.Style.Failure,
        title: res.failedCount > 0 ? t('batchFailedTitle', { count: res.failedCount }) : t('cannotStartTitle'),
        message: res.error || t('errHostProcessFailed')
      })
      return
    }
    if (res.failedCount > 0) {
      setLastRunText(t('lastRunPartial', { ok: res.processedCount, fail: res.failedCount }))
      showToast({
        style: Toast.Style.Failure,
        title: t('batchPartialTitle', { ok: res.processedCount, fail: res.failedCount }),
        message: res.error
      })
      return
    }
    setLastRunText(t('lastRunSuccess', { count: res.processedCount, size: formatBytes(res.totalOutputBytes) }))
    const first = res.outputs[0]
    const firstRes = resolutionText(first.width, first.height)
    showToast({
      style: Toast.Style.Success,
      title: t('batchSuccessTitle', { count: res.processedCount }),
      message:
        res.processedCount === 1
          ? t('batchSuccessSingleMsg', { name: baseName(first.outputPath), res: firstRes ? ` (${firstRes})` : '' })
          : t('batchSuccessMultiMsg', { size: formatBytes(res.totalOutputBytes) })
    })
  }

  async function revealInFolder(targetPath: string) {
    const ok = await openAiImageLocation(targetPath)
    if (!ok) {
      showToast({ style: Toast.Style.Failure, title: t('revealFailedTitle'), message: targetPath })
    }
  }

  const selectedFiles = files.filter(f => checkedIds.includes(f.id))
  const totalSizeText = formatTotalSize(selectedFiles)
  const q = searchText.trim().toLowerCase()
  const filteredFiles = files.filter(f => !q || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
  const allFilteredChecked = filteredFiles.length > 0 && filteredFiles.every(f => checkedIds.includes(f.id))
  const someFilteredChecked = filteredFiles.some(f => checkedIds.includes(f.id))
  const factorText = scaleFactor === '4x' ? '4' : '2'

  function toggleSelectAll() {
    if (filteredFiles.length === 0) return
    const filteredIds = filteredFiles.map(f => f.id)
    if (allFilteredChecked) {
      const idSet = new Set(filteredIds)
      setCheckedIds(prev => prev.filter(id => !idSet.has(id)))
    } else {
      setCheckedIds(prev => Array.from(new Set([...prev, ...filteredIds])))
    }
  }

  let summaryText = t('summaryNormal', {
    selected: selectedFiles.length,
    total: files.length,
    size: totalSizeText,
    tag: activeEngine.tag,
    scale: scaleFactor,
    format: formatLabel
  })
  if (isImporting) {
    summaryText = importProgress
      ? t('summaryImportingProgress', { dirs: importProgress.visitedDirs, files: importProgress.matchedFiles })
      : t('summaryImporting')
  } else if (isProcessing) {
    summaryText = t('summaryProcessing')
  } else if (!activeEngine.available) {
    summaryText =
      files.length === 0
        ? t('summaryUnavailableEmpty', { title: activeEngine.title, reason: unavailableReason })
        : t('summaryUnavailable', { title: activeEngine.title, reason: unavailableReason })
  } else if (files.length === 0) {
    summaryText = t('summaryEmpty')
  }

  const emptyText = !isAiImageHostReady()
    ? t('hostRequired')
    : isImporting
      ? t('summaryImporting')
      : q
        ? t('emptyNoMatch')
        : t('emptyDefault')

  const maxKnownBytes = filteredFiles.reduce((max, f) => Math.max(max, f.sizeBytes ?? 0), 0)
  const queueItems = filteredFiles.map(f => {
    const outcome = outcomes[f.id]
    const isItemProcessing = processingIds.includes(f.id)
    const subtitle = outcome
      ? outcome.ok
        ? `${f.parentDir} → ${baseName(outcome.detail)}`
        : t('itemFailedSub', { dir: f.parentDir, detail: outcome.detail })
      : f.parentDir
    const accessories: ListItemAccessory[] = []
    if (f.sizeBytes !== null && maxKnownBytes > 0) {
      const volRatio = Math.max(10, Math.min(100, Math.round((f.sizeBytes / maxKnownBytes) * 100)))
      accessories.push({ progress: { value: volRatio } })
    }
    if (outcome) {
      accessories.push(
        outcome.ok
          ? { tag: { value: outcome.resolution ? t('tagOutputWithRes', { res: outcome.resolution }) : t('tagOutput') } }
          : { tag: { value: t('tagFailed') }, tooltip: outcome.detail }
      )
    }
    accessories.push({ text: formatSizeText(f.sizeBytes) })

    const listSectionChildren = [
      ...(isItemProcessing
        ? []
        : [
            Action({
              title: t('actionRemove'),
              icon: Icon.Minus,
              shortcut: { modifiers: ['ctrl'], key: 'backspace' },
              onAction: () => removeFileFromList(f.id)
            })
          ]),
      Action({
        title: t('actionPickFilesEllipsis'),
        icon: Icon.Document,
        shortcut: { modifiers: ['ctrl'], key: 'o' },
        onAction: () => {
          void handlePickFiles()
        }
      }),
      Action({
        title: t('actionPickFolderEllipsis'),
        icon: Icon.Folder,
        shortcut: { modifiers: ['ctrl', 'shift'], key: 'o' },
        onAction: () => {
          void handlePickFolder()
        }
      }),
      Action({
        title: allFilteredChecked ? t('actionDeselectAll') : t('actionSelectAll'),
        icon: Icon.Checkmark,
        shortcut: { modifiers: ['ctrl'], key: 'a' },
        onAction: toggleSelectAll
      }),
      Action({
        title: t('actionClearList'),
        icon: Icon.Trash,
        style: Action.Style.Destructive,
        shortcut: { modifiers: ['ctrl', 'shift'], key: 'backspace' },
        onAction: clearQueue
      })
    ]

    return List.Item({
      id: f.id,
      title: f.name,
      subtitle,
      checkable: true,
      checked: checkedIds.includes(f.id),
      onCheckChange: c => {
        setCheckedIds(c ? Array.from(new Set([...checkedIds, f.id])) : checkedIds.filter(id => id !== f.id))
      },
      icon: { source: Icon.Image },
      accessories,
      actions: ActionPanel({
        title: f.name,
        children: [
          Action({
            title: t('actionProcessSelected', { count: selectedFiles.length }),
            icon: Icon.Bolt,
            onAction: () => runBatch(selectedFiles, true)
          }),
          Action({
            title: t('actionRevealInFolder'),
            icon: Icon.Folder,
            onAction: () => revealInFolder(outcome?.ok ? outcome.detail : f.path)
          }),
          Action({
            title: t('actionProcessSingle'),
            icon: Icon.Play,
            onAction: () => runBatch([f], false)
          }),
          ActionPanel.Section({
            title: t('sectionList'),
            children: listSectionChildren
          })
        ]
      })
    })
  })

  return List({
    ...fileInputProps,
    searchBarPlaceholder: t('searchPlaceholder'),
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    isLoading: isImporting || isProcessing,
    actions: ActionPanel({
      children: [
        Action({
          title: t('actionPickFilesEllipsis'),
          icon: Icon.Document,
          shortcut: { modifiers: ['ctrl'], key: 'o' },
          onAction: () => {
            void handlePickFiles()
          }
        }),
        Action({
          title: t('actionPickFolderEllipsis'),
          icon: Icon.Folder,
          shortcut: { modifiers: ['ctrl', 'shift'], key: 'o' },
          onAction: () => {
            void handlePickFolder()
          }
        }),
        ...(files.length > 0
          ? [
              ActionPanel.Section({
                title: t('sectionList'),
                children: [
                  Action({
                    title: t('actionClearList'),
                    icon: Icon.Trash,
                    style: Action.Style.Destructive,
                    shortcut: { modifiers: ['ctrl', 'shift'], key: 'backspace' },
                    onAction: clearQueue
                  })
                ]
              })
            ]
          : [])
      ]
    }),
    searchBarAccessory: List.Dropdown({
      tooltip: t('dropdownTooltip'),
      value: activeEngineId,
      onChange: val => setActiveEngineId(val),
      children: engines.map(e =>
        List.Dropdown.Item({
          title: e.available ? e.title : t('dropdownUnavailable', { title: e.title }),
          value: e.id
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
          icon: Icon.Document,
          style: 'secondary',
          onAction: () => {
            void handlePickFiles()
          }
        },
        {
          id: 'pick-folder',
          label: t('btnPickFolder'),
          title: t('btnPickFolder'),
          icon: Icon.Folder,
          style: 'secondary',
          onAction: () => {
            void handlePickFolder()
          }
        }
      ]
    }),
    workbenchPanel: {
      title: t('wbTitle'),
      subtitle: activeEngine.available ? activeEngine.subtitle : t('engineUnavailableTitle', { title: activeEngine.title }),
      fields: [
        {
          id: 'wb-scale-factor',
          label: t('wbScaleLabel'),
          type: 'select',
          value: scaleFactor,
          onChange: val => setScaleFactor(val === '4x' ? '4x' : '2x'),
          options: [
            { label: t('wbScale2x'), value: '2x' },
            { label: t('wbScale4x'), value: '4x' }
          ]
        },
        {
          id: 'wb-output-format',
          label: t('wbFormatLabel'),
          type: 'select',
          value: outputFormat,
          onChange: val => setOutputFormat(val === 'jpg' ? 'jpg' : 'png'),
          options: [
            { label: 'PNG', value: 'png' },
            { label: 'JPG', value: 'jpg' }
          ]
        },
        {
          id: 'wb-outdir',
          label: t('wbOutdirLabel'),
          type: 'info',
          value: t('wbOutdirValue')
        }
      ],
      previewCard: {
        title: t('previewTitle'),
        badge: activeEngine.available ? scaleFactor : t('previewBadgeUnavailable'),
        subtitle: activeEngine.available ? activeEngine.title : unavailableReason,
        metrics: [
          { label: t('metricSelected'), value: t('metricSelectedValue', { selected: selectedFiles.length, total: files.length }) },
          { label: t('metricTotalSize'), value: totalSizeText },
          { label: t('metricOutRes'), value: t('metricOutResValue', { factor: factorText }) },
          { label: t('metricLastRun'), value: lastRunText || t('metricNotRun') }
        ]
      }
    },
    subList: {
      title: t('subListTitle'),
      subtitle: t('subListSubtitle', { count: filteredFiles.length }),
      checkable: filteredFiles.length > 0,
      checked: allFilteredChecked ? true : someFilteredChecked ? 'indeterminate' : false,
      onCheckChange: checked => {
        const filteredIds = filteredFiles.map(f => f.id)
        if (checked) {
          setCheckedIds(prev => Array.from(new Set([...prev, ...filteredIds])))
        } else {
          const idSet = new Set(filteredIds)
          setCheckedIds(prev => prev.filter(id => !idSet.has(id)))
        }
      },
      emptyText,
      items: queueItems
    },
    children: [
      List.Section({
        title: t('sectionPendingTitle', { count: filteredFiles.length }),
        children: queueItems
      })
    ]
  })
}

export default AiImageCommand
