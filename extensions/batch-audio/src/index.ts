import {
  List,
  ActionPanel,
  Action,
  Icon,
  Color,
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
  AUDIO_IMPORT_RULES,
  AUDIO_IMPORT_SUPPORTED_TEXT,
  CapabilityActionItem,
  RealAudioFileItem,
  checkMergeAudioLimits,
  createAudioImportTransport,
  formatBytes,
  getAudioWorkshopModes,
  openAudioFileLocation,
  pickAudioFolderWithConfirm,
  processAudioSelection,
  toAudioItem
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
  pickFiles,
  summarizeImport
} from './file-import.js'

export * from './logic.js'

const FORMAT_RATIO_MAP: Record<string, number> = {
  mp3_320k: 0.24,
  flac_lossless: 0.58,
  wav_pcm: 1.0,
  aac_256k: 0.20,
  m4a_aac: 0.22,
  ogg_vorbis: 0.19
}

function getLoudnessLabels(): Record<string, string> {
  return {
    lufs_16: t('loudness16'),
    lufs_14: t('loudness14'),
    lufs_23: t('loudness23'),
    keep_raw: t('loudnessKeep')
  }
}

export function BatchAudioCommand() {
  useLocale()
  const workshopModes = getAudioWorkshopModes()
  const loudnessLabels = getLoudnessLabels()
  const transport = createAudioImportTransport()
  const [searchText, setSearchText] = useState('')
  const [activeModeId, setActiveModeId] = useState<string>(workshopModes[0].id)
  const [outputFormat, setOutputFormat] = useState<'mp3_320k' | 'flac_lossless' | 'wav_pcm' | 'aac_256k' | 'm4a_aac' | 'ogg_vorbis'>('mp3_320k')
  const [loudnessTarget, setLoudnessTarget] = useState<'lufs_16' | 'lufs_14' | 'lufs_23' | 'keep_raw'>('keep_raw')
  const [sampleRateMode, setSampleRateMode] = useState<'48000' | '44100' | 'source'>('source')
  const [stripSilence, setStripSilence] = useState<boolean>(false)
  const [afftdnDenoise, setAfftdnDenoise] = useState<boolean>(false)

  const [files, setFiles] = useState<RealAudioFileItem[]>([])
  const [checkedIds, setCheckedIds] = useState<string[]>([])
  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<{ visitedDirs: number; matchedFiles: number } | null>(null)
  const processing = useRef(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [runningIds, setRunningIds] = useState<string[]>([])
  const [lastResult, setLastResult] = useState('')

  const importBatchRef = useRef(0)
  const importAbortRef = useRef<AbortController | null>(null)
  const filesRef = useRef<RealAudioFileItem[]>(files)
  filesRef.current = files

  async function runAudioImport(
    loader: (
      signal: AbortSignal,
      onProgress: (progress: { visitedDirs: number; matchedFiles: number }) => void
    ) => Promise<FileImportResult>
  ) {
    importAbortRef.current?.abort()
    const controller = new AbortController()
    importAbortRef.current = controller
    const batch = ++importBatchRef.current
    setIsImporting(true)
    setImportProgress(null)
    try {
      const result = await loader(controller.signal, (p) => {
        if (batch === importBatchRef.current) setImportProgress(p)
      })
      if (batch !== importBatchRef.current) return
      const incoming = result.files.map(toAudioItem)
      const { merged, added, duplicates } = mergeByPath(filesRef.current, incoming, f => f.path)
      if (added.length > 0) {
        filesRef.current = merged
        setFiles(merged)
        setCheckedIds(prev => Array.from(new Set([...prev, ...added.map(f => f.id)])))
      }
      const tip = summarizeImport(result, { added: added.length, duplicates }, AUDIO_IMPORT_SUPPORTED_TEXT)
      if (tip) {
        void showToast({ style: tip.ok ? Toast.Style.Success : Toast.Style.Failure, title: tip.title, message: tip.message })
      }
    } catch (err) {
      if (batch !== importBatchRef.current) return
      void showToast({ style: Toast.Style.Failure, title: t('importFailedTitle'), message: friendlyFileError(err) })
    } finally {
      if (batch === importBatchRef.current) {
        importAbortRef.current = null
        setIsImporting(false)
        setImportProgress(null)
      }
    }
  }

  function handlePickAudioFiles() {
    void runAudioImport(() =>
      pickFiles(transport, AUDIO_IMPORT_RULES, { title: t('pickFilesTitle'), filterName: t('pickFilesFilterName') })
    )
  }

  function handlePickAudioFolder() {
    void runAudioImport((signal, onProgress) =>
      pickAudioFolderWithConfirm(
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

  function handleAudioFileInput(input: NormalizedFileInput) {
    void runAudioImport((signal, onProgress) =>
      expandInputPaths(transport, input.paths, AUDIO_IMPORT_RULES, {
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
          if (input.paths.length > 0) handleAudioFileInput(input)
        }
        const off = eventsApi.on('plugin_files_dropped', onDrop)
        disposeDrop = () => {
          if (typeof off === 'function') off()
          else if (typeof eventsApi.off === 'function') eventsApi.off('plugin_files_dropped', onDrop)
        }
      }
    }
    return () => {
      importBatchRef.current += 1
      importAbortRef.current?.abort()
      disposeDrop?.()
    }
  }, [])

  const fileInputProps = createImportInputProps(handleAudioFileInput, {
    dropTitle: t('dropTitle'),
    dropSubtitle: t('dropSubtitle')
  })

  const activePreset = workshopModes.find(p => p.id === activeModeId) || workshopModes[0]
  const ratio = FORMAT_RATIO_MAP[outputFormat] ?? 0.24
  const outExt = outputFormat.split('_')[0] || 'mp3'

  function selectPreset(id: string) {
    setActiveModeId(id)
    const selected = workshopModes.find(mode => mode.id === id)
    if (selected?.params.format === 'flac') setOutputFormat('flac_lossless')
    if (selected?.params.format === 'mp3') setOutputFormat('mp3_320k')
  }

  async function runFiles(preset: CapabilityActionItem, selected: RealAudioFileItem[]) {
    if (processing.current) return
    if (!selected.length) {
      await showToast({ style: Toast.Style.Failure, title: t('selectAudioFirst') })
      return
    }
    if (preset.method === 'BatchMergeAudio') {
      if (selected.length < 2) {
        await showToast({ style: Toast.Style.Failure, title: t('mergeNeedTwo') })
        return
      }
      const limitErr = checkMergeAudioLimits(selected)
      if (limitErr) {
        await showToast({ style: Toast.Style.Failure, title: limitErr })
        return
      }
    }
    processing.current = true
    setIsProcessing(true)
    try {
      const accepted = await confirmAlert({
        title: t('confirmRunTitle', { count: selected.length, tag: preset.tag }),
        message: t('confirmRunMsg', { ext: outExt.toUpperCase() }),
        primaryAction: { title: t('confirmRunAction'), style: 'default' }
      })
      if (!accepted) return
      const result = await processAudioSelection(
        preset.method,
        {
          ...preset.params,
          format: outExt,
          bitrate: outExt === 'mp3' ? '320k' : '256k',
          loudnessTarget,
          sampleRateMode,
          stripSilence,
          afftdnDenoise
        },
        selected,
        undefined,
        {
          shouldSkip: id => !filesRef.current.some(item => item.id === id),
          onStart: ids => setRunningIds(ids),
          onDone: ids => setRunningIds(prev => prev.filter(id => !ids.includes(id)))
        }
      )
      const summary = t('runSummary', {
        completed: result.completed,
        failed: result.failed,
        outputs: result.outputs.length
      })
      setLastResult(summary)
      await showToast({
        style: result.failed ? Toast.Style.Failure : Toast.Style.Success,
        title: result.failed ? t('runPartialTitle') : t('runSuccessTitle'),
        message: result.errors.length ? `${summary}; ${result.errors[0]}` : summary
      })
    } finally {
      setRunningIds([])
      processing.current = false
      setIsProcessing(false)
    }
  }

  async function handleRunBatchChecked() {
    await runFiles(activePreset, files.filter(file => checkedIds.includes(file.id)))
  }

  async function handleRunPreset(preset: CapabilityActionItem, targetFile: RealAudioFileItem) {
    await runFiles(preset, [targetFile])
  }

  function handleRemoveItem(file: RealAudioFileItem) {
    if (runningIds.includes(file.id)) {
      void showToast({ style: Toast.Style.Failure, title: t('removeBusy') })
      return
    }
    const next = filesRef.current.filter(item => item.id !== file.id)
    filesRef.current = next
    setFiles(next)
    setCheckedIds(prev => prev.filter(id => id !== file.id))
  }

  function handleClearList() {
    if (processing.current) {
      void showToast({ style: Toast.Style.Failure, title: t('clearBusy') })
      return
    }
    importBatchRef.current += 1
    importAbortRef.current?.abort()
    importAbortRef.current = null
    setIsImporting(false)
    setImportProgress(null)
    filesRef.current = []
    setFiles([])
    setCheckedIds([])
    setLastResult('')
  }

  const selectedFiles = files.filter(f => checkedIds.includes(f.id))
  const totalKnownBytes = selectedFiles.reduce((s, f) => s + (f.sizeBytes ?? 0), 0)
  const selectedUnknownCount = selectedFiles.filter(f => f.sizeBytes === null).length
  const estimatedOutBytes = Math.round(totalKnownBytes * ratio)
  const selectedBytesText =
    selectedFiles.length > 0 && selectedUnknownCount === selectedFiles.length
      ? t('sizeUnknown')
      : `${formatBytes(totalKnownBytes)}${selectedUnknownCount > 0 ? t('unknownSizeCount', { count: selectedUnknownCount }) : ''}`

  const q = searchText.trim().toLowerCase()
  const filteredFiles = files.filter(
    f => !q || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
  )
  const filteredPresets = workshopModes.filter(
    p => !q || p.title.toLowerCase().includes(q) || p.subtitle.toLowerCase().includes(q) || p.tag.toLowerCase().includes(q)
  )

  const allFilteredChecked = filteredFiles.length > 0 && filteredFiles.every(f => checkedIds.includes(f.id))

  function toggleAllFiltered() {
    const visibleIds = new Set(filteredFiles.map(f => f.id))
    setCheckedIds(prev =>
      allFilteredChecked
        ? prev.filter(id => !visibleIds.has(id))
        : Array.from(new Set([...prev, ...visibleIds]))
    )
  }

  const pickFilesAction = () =>
    Action({
      title: t('actionPickFilesEllipsis'),
      icon: Icon.Plus,
      shortcut: { modifiers: ['ctrl'], key: 'o' },
      onAction: handlePickAudioFiles
    })
  const pickFolderAction = () =>
    Action({
      title: t('actionPickFolderEllipsis'),
      icon: Icon.Folder,
      shortcut: { modifiers: ['ctrl', 'shift'], key: 'o' },
      onAction: handlePickAudioFolder
    })

  const maxAudioBytes = Math.max(1, ...filteredFiles.map(f => f.sizeBytes ?? 0))
  const rightQueueItems = filteredFiles.map(f => {
    const isChecked = checkedIds.includes(f.id)
    const isItemRunning = runningIds.includes(f.id)
    const hasSize = f.sizeBytes !== null
    const estOut = hasSize ? Math.round(f.sizeBytes! * ratio) : null
    const accessories: Array<Record<string, unknown>> = []
    if (hasSize) {
      const volRatio = Math.max(10, Math.min(100, Math.round((f.sizeBytes! / maxAudioBytes) * 100)))
      accessories.push({ progress: { value: volRatio } })
      accessories.push({ tag: { value: `→ .${outExt.toUpperCase()} ~${formatBytes(estOut!)}` } })
      accessories.push({ text: formatBytes(f.sizeBytes!) })
    } else {
      accessories.push({ tag: { value: `→ .${outExt.toUpperCase()}` } })
      accessories.push({ text: t('sizeUnknown') })
    }

    const actionChildren: Array<ReturnType<typeof Action> | ReturnType<typeof ActionPanel.Section>> = [
      Action({
        title: t('actionRunBatch', { count: selectedFiles.length }),
        icon: Icon.Bolt,
        onAction: handleRunBatchChecked
      }),
      Action({
        title: t('actionRevealInFolder'),
        icon: Icon.Folder,
        shortcut: { modifiers: ['ctrl'], key: 'enter' },
        onAction: () => {
          void openAudioFileLocation(f.path)
        }
      }),
      Action({
        title: t('actionRunSingle', { tag: activePreset.tag }),
        icon: Icon.Play,
        onAction: () => handleRunPreset(activePreset, f)
      }),
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
                  onAction: () => handleRemoveItem(f)
                })
              ]),
          pickFilesAction(),
          pickFolderAction(),
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
    ]

    return List.Item({
      id: f.id,
      title: f.name,
      subtitle: estOut !== null
        ? `${f.parentDir} · ${f.extension.toUpperCase()} → .${outExt.toUpperCase()} (~${formatBytes(estOut)})`
        : `${f.parentDir} · ${f.extension.toUpperCase()} → .${outExt.toUpperCase()}`,
      checkable: true,
      checked: isChecked,
      onCheckChange: c => {
        setCheckedIds(prev => (c ? Array.from(new Set([...prev, f.id])) : prev.filter(id => id !== f.id)))
      },
      icon: {
        source: Icon.Music
      },
      accessories,
      actions: ActionPanel({
        title: f.name,
        children: actionChildren
      })
    })
  })

  const inClient = isRealElectronHost()
  const summaryText = isImporting
    ? t('summaryImporting', { dirs: importProgress?.visitedDirs ?? 0, files: importProgress?.matchedFiles ?? 0 })
    : files.length === 0
      ? inClient
        ? t('summaryEmptyClient')
        : t('hostRequired')
      : t('summaryNormal', {
          last: lastResult ? `${lastResult} · ` : '',
          selected: selectedFiles.length,
          total: files.length,
          bytes: selectedBytesText
        })

  const emptyText = !inClient
    ? t('hostRequired')
    : q && files.length > 0
      ? t('emptyNoMatch')
      : t('emptyDefault')

  return List({
    ...fileInputProps,
    searchBarPlaceholder: t('searchPlaceholder'),
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    isLoading: isImporting || isProcessing,
    actions: ActionPanel({
      title: t('queueActionsTitle'),
      children: [pickFilesAction(), pickFolderAction()]
    }),
    searchBarAccessory: List.Dropdown({
      tooltip: t('dropdownTooltip'),
      value: activeModeId,
      onChange: val => selectPreset(val),
      children: workshopModes.map(m =>
        List.Dropdown.Item({
          title: t('dropdownItemTitle', { tag: m.tag }),
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
          onAction: handlePickAudioFiles
        },
        {
          id: 'pick-folder',
          label: t('btnPickFolder'),
          title: t('btnPickFolder'),
          style: 'secondary',
          onAction: handlePickAudioFolder
        }
      ]
    }),
    workbenchPanel: {
      title: t('wbTitle'),
      subtitle: activePreset.tag,
      fields: [
        {
          id: 'wb-output-format',
          label: t('wbFormatLabel'),
          type: 'select',
          value: outputFormat,
          onChange: val => setOutputFormat(val as typeof outputFormat),
          options: [
            { label: t('optMp3'), value: 'mp3_320k' },
            { label: t('optFlac'), value: 'flac_lossless' },
            { label: t('optWav'), value: 'wav_pcm' },
            { label: t('optAac'), value: 'aac_256k' },
            { label: t('optM4a'), value: 'm4a_aac' },
            { label: t('optOgg'), value: 'ogg_vorbis' }
          ]
        },
        {
          id: 'wb-loudness',
          label: t('wbLoudnessLabel'),
          type: 'select',
          value: loudnessTarget,
          onChange: val => setLoudnessTarget(val as typeof loudnessTarget),
          options: [
            { label: t('optLufs16'), value: 'lufs_16' },
            { label: t('optLufs14'), value: 'lufs_14' },
            { label: t('optLufs23'), value: 'lufs_23' },
            { label: t('optKeepRaw'), value: 'keep_raw' }
          ]
        },
        {
          id: 'wb-samplerate',
          label: t('wbSampleRateLabel'),
          type: 'select',
          value: sampleRateMode,
          onChange: val => setSampleRateMode(val as typeof sampleRateMode),
          options: [
            { label: t('opt48k'), value: '48000' },
            { label: t('opt44k'), value: '44100' },
            { label: t('optSourceRate'), value: 'source' }
          ]
        },
        {
          id: 'wb-strip-silence',
          label: t('wbStripSilenceLabel'),
          type: 'toggle',
          value: stripSilence,
          onChange: val => setStripSilence(Boolean(val))
        },
        {
          id: 'wb-afftdn',
          label: t('wbDenoiseLabel'),
          type: 'toggle',
          value: afftdnDenoise,
          onChange: val => setAfftdnDenoise(Boolean(val))
        },
        {
          id: 'wb-outdir',
          label: t('wbOutdirLabel'),
          type: 'info',
          value: t('wbOutdirValue', { ext: outExt })
        }
      ],
      previewCard: {
        title: t('previewTitle'),
        badge: loudnessLabels[loudnessTarget] || '-16 LUFS',
        subtitle: t('previewSubtitle', { title: activePreset.title }),
        metrics: [
          { label: t('metricRawSize'), value: selectedBytesText },
          { label: t('metricEstOut'), value: selectedUnknownCount === selectedFiles.length && selectedFiles.length > 0 ? '—' : `~${formatBytes(estimatedOutBytes)}` },
          { label: t('metricTargetLoudness'), value: loudnessLabels[loudnessTarget] || '-16 LUFS' },
          { label: t('metricSelectedCount'), value: t('metricSelectedCountVal', { selected: selectedFiles.length, total: files.length }) }
        ]
      }
    },
    subList: {
      title: t('subListTitle'),
      subtitle: t('subListSubtitle', { count: filteredFiles.length, bytes: selectedBytesText }),
      checkable: filteredFiles.length > 0,
      checked: allFilteredChecked
        ? true
        : filteredFiles.some(f => checkedIds.includes(f.id))
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
      }),
      List.Section({
        title: t('sectionModesTitle', { count: filteredPresets.length }),
        children: filteredPresets.map(p =>
          List.Item({
            id: p.id,
            title: p.title,
            subtitle: p.subtitle,
            icon: {
              source: Icon.SpeakerHigh,
              tintColor: Color.SecondaryText
            },
            accessories: [
              { tag: { value: p.tag } },
              { text: p.method }
            ],
            actions: ActionPanel({
              title: p.title,
              children: [
                Action({
                  title: t('actionSetActiveMode'),
                  icon: Icon.CheckCircle,
                  onAction: () => {
                    selectPreset(p.id)
                  }
                })
              ]
            })
          })
        )
      })
    ]
  })
}

export default BatchAudioCommand

