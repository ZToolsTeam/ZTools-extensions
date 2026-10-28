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
  FilterBar
} from '@ztools/declarative-ui'
import type { ListItemAccessory } from '@ztools/declarative-ui'
import {
  AI_IMAGE_ENGINES,
  AiImageBatchResult,
  AiImageFileItem,
  AiImageOutputFormat,
  AiImageScale,
  AI_INFERENCE_UNAVAILABLE_REASON,
  executeAiImageBatch,
  fetchAiImageQueue,
  formatBytes,
  openAiImageLocation
} from './logic.js'

export * from './logic.js'

interface ItemOutcome {
  ok: boolean
  /** 成功时为输出文件路径，失败时为错误原因 */
  detail: string
  resolution: string
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function baseName(fullPath: string): string {
  return fullPath.split(/[\\/]/).pop() || fullPath
}

function resolutionText(width: number, height: number): string {
  return width > 0 && height > 0 ? `${width}×${height}` : ''
}

export function AiImageCommand() {
  const [searchText, setSearchText] = useState('')
  const [activeEngineId, setActiveEngineId] = useState<string>(AI_IMAGE_ENGINES[0].id)
  const [scaleFactor, setScaleFactor] = useState<AiImageScale>('2x')
  const [outputFormat, setOutputFormat] = useState<AiImageOutputFormat>('png')
  const [files, setFiles] = useState<AiImageFileItem[]>([])
  const [checkedIds, setCheckedIds] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [outcomes, setOutcomes] = useState<Record<string, ItemOutcome>>({})
  const [lastRunText, setLastRunText] = useState('')
  const processingRef = useRef(false)

  async function refreshWorkspace(showIndicator = false) {
    setIsLoading(true)
    try {
      const ws = await fetchAiImageQueue()
      setFiles(ws.files)
      setCheckedIds(ws.files.map(f => f.id))
      setOutcomes({})
      setLoadError(ws.error || '')
      if (ws.error) {
        showToast({ style: Toast.Style.Failure, title: '读取图片队列失败', message: ws.error })
      } else if (showIndicator) {
        showToast({ style: Toast.Style.Success, title: '已重新扫描', message: `找到 ${ws.files.length} 张图片` })
      }
    } catch (err) {
      const msg = errorMessage(err)
      setLoadError(msg)
      showToast({ style: Toast.Style.Failure, title: '读取图片队列失败', message: msg })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    refreshWorkspace(false)
  }, [])

  const activeEngine = AI_IMAGE_ENGINES.find(e => e.id === activeEngineId) || AI_IMAGE_ENGINES[0]
  const unavailableReason = activeEngine.unavailableReason || AI_INFERENCE_UNAVAILABLE_REASON
  const formatLabel = outputFormat.toUpperCase()

  function applyResult(targets: AiImageFileItem[], res: AiImageBatchResult) {
    const idByPath = new Map(targets.map(f => [f.path, f.id]))
    const updates: Record<string, ItemOutcome> = {}
    for (const o of res.outputs) {
      const id = idByPath.get(o.inputPath)
      if (id) updates[id] = { ok: true, detail: o.outputPath, resolution: resolutionText(o.width, o.height) }
    }
    for (const fail of res.failures) {
      const id = idByPath.get(fail.inputPath)
      if (id) updates[id] = { ok: false, detail: fail.error, resolution: '' }
    }
    setOutcomes(prev => ({ ...prev, ...updates }))
  }

  async function runBatch(targets: AiImageFileItem[], askConfirm: boolean) {
    if (processingRef.current) {
      showToast({ style: Toast.Style.Failure, title: '正在处理，请等当前任务完成' })
      return
    }
    if (targets.length === 0) {
      showToast({ style: Toast.Style.Failure, title: '请先勾选要处理的图片' })
      return
    }
    if (!activeEngine.available) {
      showToast({ style: Toast.Style.Failure, title: `${activeEngine.title}暂不可用`, message: unavailableReason })
      return
    }
    if (askConfirm && targets.length > 1) {
      const confirmed = await confirmAlert({
        title: `放大 ${targets.length} 张图片？`,
        message: `${activeEngine.title} ${scaleFactor}，输出 ${formatLabel} 到原图所在目录，文件名加倍率和时间，不覆盖已有文件。`,
        primaryAction: { title: '开始处理', style: 'default' }
      })
      if (!confirmed) return
    }

    processingRef.current = true
    setIsProcessing(true)
    let res: AiImageBatchResult
    try {
      res = await executeAiImageBatch(targets, { engineId: activeEngine.id, scaleFactor, outputFormat })
    } catch (err) {
      showToast({ style: Toast.Style.Failure, title: '处理失败', message: errorMessage(err) })
      return
    } finally {
      processingRef.current = false
      setIsProcessing(false)
    }

    applyResult(targets, res)
    if (res.processedCount === 0) {
      setLastRunText(res.failedCount > 0 ? `${res.failedCount} 张全部失败` : '未能开始')
      showToast({
        style: Toast.Style.Failure,
        title: res.failedCount > 0 ? `${res.failedCount} 张图片处理失败` : '无法开始处理',
        message: res.error || '客户端图片处理失败'
      })
      return
    }
    if (res.failedCount > 0) {
      setLastRunText(`成功 ${res.processedCount} 张，失败 ${res.failedCount} 张`)
      showToast({
        style: Toast.Style.Failure,
        title: `完成 ${res.processedCount} 张，失败 ${res.failedCount} 张`,
        message: res.error
      })
      return
    }
    setLastRunText(`成功 ${res.processedCount} 张，共 ${formatBytes(res.totalOutputBytes)}`)
    const first = res.outputs[0]
    const firstRes = resolutionText(first.width, first.height)
    showToast({
      style: Toast.Style.Success,
      title: `已放大 ${res.processedCount} 张图片`,
      message:
        res.processedCount === 1
          ? `${baseName(first.outputPath)}${firstRes ? `（${firstRes}）` : ''}`
          : `输出到原图所在目录，共 ${formatBytes(res.totalOutputBytes)}`
    })
  }

  async function revealInFolder(targetPath: string) {
    const ok = await openAiImageLocation(targetPath)
    if (!ok) {
      showToast({ style: Toast.Style.Failure, title: '无法在资源管理器中显示', message: targetPath })
    }
  }

  const selectedFiles = files.filter(f => checkedIds.includes(f.id))
  const totalBytes = selectedFiles.reduce((s, f) => s + f.sizeBytes, 0)
  const q = searchText.trim().toLowerCase()
  const filteredFiles = files.filter(f => !q || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
  const factorText = scaleFactor === '4x' ? '4' : '2'

  let summaryText = `已选 ${selectedFiles.length}/${files.length} 张图片（${formatBytes(totalBytes)}）· ${activeEngine.tag} ${scaleFactor} · 输出 ${formatLabel}`
  if (isProcessing) {
    summaryText = '正在处理图片…'
  } else if (isLoading && files.length === 0) {
    summaryText = '正在扫描图片、桌面、下载目录…'
  } else if (loadError) {
    summaryText = `读取图片队列失败：${loadError}`
  } else if (!activeEngine.available) {
    summaryText = `${activeEngine.title}暂不可用：${unavailableReason}`
  }

  const emptyText = loadError
    ? `读取失败：${loadError}`
    : isLoading
      ? '正在扫描…'
      : q
        ? '没有匹配的图片'
        : '图片、桌面、下载目录里没有找到 PNG、JPG、BMP 图片'

  const maxImgBytes = Math.max(1, filteredFiles[0]?.sizeBytes || 1)
  const queueItems = filteredFiles.map(f => {
    const outcome = outcomes[f.id]
    const volRatio = Math.max(10, Math.min(100, Math.round((f.sizeBytes / maxImgBytes) * 100)))
    const subtitle = outcome
      ? outcome.ok
        ? `${f.parentDir} → ${baseName(outcome.detail)}`
        : `${f.parentDir} · 失败：${outcome.detail}`
      : f.parentDir
    const accessories: ListItemAccessory[] = [{ progress: { value: volRatio } }]
    if (outcome) {
      accessories.push(
        outcome.ok
          ? { tag: { value: outcome.resolution ? `已输出 ${outcome.resolution}` : '已输出' } }
          : { tag: { value: '处理失败' }, tooltip: outcome.detail }
      )
    }
    accessories.push({ text: formatBytes(f.sizeBytes) })

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
            title: `开始处理已勾选的 ${selectedFiles.length} 张`,
            icon: Icon.Bolt,
            onAction: () => runBatch(selectedFiles, true)
          }),
          Action({
            title: '在资源管理器中显示',
            icon: Icon.Folder,
            onAction: () => revealInFolder(outcome?.ok ? outcome.detail : f.path)
          }),
          Action({
            title: '仅处理这张图片',
            icon: Icon.Play,
            onAction: () => runBatch([f], false)
          })
        ]
      })
    })
  })

  return List({
    searchBarPlaceholder: '搜索图片文件名或目录',
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    isLoading: isLoading || isProcessing,
    searchBarAccessory: List.Dropdown({
      tooltip: '处理方式',
      value: activeEngineId,
      onChange: val => setActiveEngineId(val),
      children: AI_IMAGE_ENGINES.map(e =>
        List.Dropdown.Item({
          title: e.available ? e.title : `${e.title}（暂不可用）`,
          value: e.id
        })
      )
    }),
    filterBar: FilterBar({
      summaryText,
      actions: [
        {
          id: 'rescan-ai-image',
          label: '重新扫描',
          title: '重新扫描',
          style: 'secondary',
          onAction: () => refreshWorkspace(true)
        }
      ]
    }),
    workbenchPanel: {
      title: '处理参数',
      subtitle: activeEngine.available ? activeEngine.subtitle : `${activeEngine.title}暂不可用`,
      fields: [
        {
          id: 'wb-scale-factor',
          label: '放大倍率',
          type: 'select',
          value: scaleFactor,
          onChange: val => setScaleFactor(val === '4x' ? '4x' : '2x'),
          options: [
            { label: '2 倍', value: '2x' },
            { label: '4 倍', value: '4x' }
          ]
        },
        {
          id: 'wb-output-format',
          label: '输出格式',
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
          label: '输出位置',
          type: 'info',
          value: '原图所在目录，文件名加倍率和时间，不覆盖已有文件'
        }
      ],
      previewCard: {
        title: '处理预估',
        badge: activeEngine.available ? scaleFactor : '暂不可用',
        subtitle: activeEngine.available ? activeEngine.title : unavailableReason,
        metrics: [
          { label: '已选图片', value: `${selectedFiles.length} / ${files.length} 张` },
          { label: '原图总大小', value: formatBytes(totalBytes) },
          { label: '输出分辨率', value: `原尺寸 ×${factorText}` },
          { label: '上次处理', value: lastRunText || '尚未处理' }
        ]
      }
    },
    subList: {
      title: '待处理图片（按大小降序，勾选后按 ↵ 开始处理）',
      subtitle: `${filteredFiles.length} 张图片`,
      checkable: filteredFiles.length > 0,
      checked:
        filteredFiles.length > 0 && filteredFiles.every(f => checkedIds.includes(f.id))
          ? true
          : filteredFiles.some(f => checkedIds.includes(f.id))
            ? 'indeterminate'
            : false,
      onCheckChange: checked => {
        setCheckedIds(checked ? filteredFiles.map(f => f.id) : [])
      },
      emptyText,
      items: queueItems
    },
    children: [
      List.Section({
        title: `待处理图片（${filteredFiles.length}）`,
        children: queueItems
      })
    ]
  })
}

export default AiImageCommand
