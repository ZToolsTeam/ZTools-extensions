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
  FilterBar
} from '@ztools/declarative-ui'
import {
  PdfBatchResult,
  PdfTaskOutcome,
  RealPdfDocItem,
  TEXT_EXTRACTION_LIMIT_NOTE,
  UNAVAILABLE_FEATURES_NOTE,
  describeBatchResult,
  fetchRealPdfWorkspace,
  formatBytes,
  getAvailableTools,
  openPdfDocument,
  openPdfFileLocation,
  runPdfTool
} from './logic.js'

export * from './logic.js'

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function PdfCommand() {
  const tools = getAvailableTools()
  const [searchText, setSearchText] = useState('')
  const [activeToolId, setActiveToolId] = useState<string>(tools[0]?.id ?? '')
  const [files, setFiles] = useState<RealPdfDocItem[]>([])
  const [checkedIds, setCheckedIds] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRunning, setIsRunning] = useState(false)
  const [scanError, setScanError] = useState('')
  const [lastResult, setLastResult] = useState<PdfBatchResult | null>(null)
  // 防止上一批还没写完时再次触发（状态更新前的连续回车）
  const busyRef = useRef(false)

  async function refreshWorkspace(showIndicator = false) {
    setIsLoading(true)
    try {
      const ws = await fetchRealPdfWorkspace()
      const ids = new Set(ws.files.map(f => f.id))
      setFiles(ws.files)
      setCheckedIds(prev => prev.filter(id => ids.has(id)))
      setScanError('')
      if (showIndicator) {
        showToast({
          style: Toast.Style.Success,
          title: '扫描完成',
          message: `找到 ${ws.files.length} 个 PDF`
        })
      }
    } catch (err) {
      const message = errorText(err)
      setFiles([])
      setCheckedIds([])
      setScanError(message)
      showToast({ style: Toast.Style.Failure, title: '扫描 PDF 失败', message })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    refreshWorkspace(false)
  }, [])

  const activeTool = tools.find(t => t.id === activeToolId) ?? tools[0]
  const queueFiles = activeTool ? files.filter(f => f.docType === activeTool.inputType) : []
  const selectedFiles = queueFiles.filter(f => checkedIds.includes(f.id))
  const selectedBytes = selectedFiles.reduce((s, f) => s + f.sizeBytes, 0)
  const q = searchText.trim().toLowerCase()
  const visibleFiles = queueFiles.filter(
    f => !q || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
  )
  const outcomeById = new Map<string, PdfTaskOutcome>()
  for (const o of [...(lastResult?.succeeded ?? []), ...(lastResult?.failed ?? [])]) {
    outcomeById.set(o.file.id, o)
  }
  const lastOutputPath = lastResult?.succeeded[lastResult.succeeded.length - 1]?.outputPath ?? ''

  async function handleRun(targets: RealPdfDocItem[]) {
    if (!activeTool) {
      showToast({ style: Toast.Style.Failure, title: '没有可用的工具' })
      return
    }
    if (busyRef.current) {
      showToast({ style: Toast.Style.Failure, title: '上一批还在导出，请稍候' })
      return
    }
    if (targets.length === 0) {
      showToast({ style: Toast.Style.Failure, title: '请先勾选要导出的 PDF' })
      return
    }
    busyRef.current = true
    setIsRunning(true)
    try {
      const result = await runPdfTool(activeTool.id, targets)
      setLastResult(result)
      const summary = describeBatchResult(result)
      showToast({
        style: summary.ok ? Toast.Style.Success : Toast.Style.Failure,
        title: summary.title,
        message: summary.message
      })
    } catch (err) {
      showToast({ style: Toast.Style.Failure, title: `${activeTool.tag}失败`, message: errorText(err) })
    } finally {
      busyRef.current = false
      setIsRunning(false)
    }
  }

  async function handleOpen(path: string, mode: 'open' | 'reveal') {
    const ok = mode === 'open' ? await openPdfDocument(path) : await openPdfFileLocation(path)
    if (!ok) {
      showToast({
        style: Toast.Style.Failure,
        title: mode === 'open' ? '无法打开文件' : '无法在文件夹中显示',
        message: path
      })
    }
  }

  const maxDocBytes = Math.max(1, ...visibleFiles.map(f => f.sizeBytes))
  const queueItems = visibleFiles.map(f => {
    const isChecked = checkedIds.includes(f.id)
    const outcome = outcomeById.get(f.id)
    const volRatio = Math.max(2, Math.min(100, Math.round((f.sizeBytes / maxDocBytes) * 100)))
    const runChecked = selectedFiles.length > 0
    const actions = [
      Action({
        title: runChecked ? `导出已勾选的 ${selectedFiles.length} 个 PDF` : '导出当前 PDF',
        icon: Icon.Play,
        onAction: () => handleRun(runChecked ? selectedFiles : [f])
      }),
      ...(runChecked
        ? [
            Action({
              title: '仅导出当前 PDF',
              icon: Icon.Document,
              onAction: () => handleRun([f])
            })
          ]
        : []),
      ...(lastOutputPath
        ? [
            Action({
              title: '在文件夹中显示上次输出',
              icon: Icon.Folder,
              onAction: () => handleOpen(lastOutputPath, 'reveal')
            })
          ]
        : []),
      Action({
        title: '用默认程序打开 PDF',
        icon: Icon.Eye,
        onAction: () => handleOpen(f.path, 'open')
      }),
      Action({
        title: '在文件夹中显示 PDF',
        icon: Icon.Folder,
        onAction: () => handleOpen(f.path, 'reveal')
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
        ...(outcome ? [{ tag: { value: outcome.ok ? '已导出' : '导出失败' } }] : []),
        { text: formatBytes(f.sizeBytes) }
      ],
      actions: ActionPanel({ title: f.name, children: actions })
    })
  })

  const lastSummary = lastResult
    ? lastResult.error
      ? lastResult.error
      : `成功 ${lastResult.succeeded.length} 个 · 失败 ${lastResult.failed.length} 个`
    : ''
  const summaryText = scanError
    ? `扫描失败：${scanError}`
    : `已选 ${selectedFiles.length}/${queueFiles.length} 个 PDF（${formatBytes(selectedBytes)}）· 来自文档、下载、桌面目录（两级以内）`
  const emptyText = scanError
    ? `扫描失败：${scanError}`
    : q
      ? '没有匹配的 PDF'
      : '文档、下载、桌面目录（两级以内）里没有找到 PDF'

  return List({
    searchBarPlaceholder: '搜索 PDF 文件名或路径',
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    isLoading: isLoading || isRunning,
    searchBarAccessory: List.Dropdown({
      tooltip: '选择导出格式',
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
          id: 'rescan-pdf',
          label: '重新扫描',
          title: '重新扫描',
          style: 'secondary',
          onAction: () => refreshWorkspace(true)
        }
      ]
    }),
    workbenchPanel: {
      title: '导出设置',
      subtitle: activeTool?.title ?? '',
      fields: [
        {
          id: 'wb-format',
          label: '输出格式',
          type: 'info',
          value: activeTool?.outputExt === '.html' ? 'HTML 纯文本网页' : 'TXT 纯文本（UTF-8）'
        },
        {
          id: 'wb-outdir',
          label: '输出位置',
          type: 'info',
          value: 'PDF 所在目录；同名文件已存在时自动加序号，不覆盖'
        },
        {
          id: 'wb-limit',
          label: '提取限制',
          type: 'info',
          value: TEXT_EXTRACTION_LIMIT_NOTE
        },
        {
          id: 'wb-unavailable',
          label: '暂不可用',
          type: 'info',
          value: UNAVAILABLE_FEATURES_NOTE
        }
      ],
      previewCard: {
        title: '导出结果',
        badge: activeTool?.tag ?? '',
        subtitle: isRunning ? '正在导出…' : lastSummary || '尚未导出',
        metrics: [
          { label: '已选文件', value: `${selectedFiles.length} / ${queueFiles.length}` },
          { label: '已选体积', value: formatBytes(selectedBytes) }
        ]
      }
    },
    subList: {
      title: '待导出的 PDF（勾选后按 ↵ 开始）',
      subtitle: `${visibleFiles.length} 个`,
      checkable: visibleFiles.length > 0,
      checked:
        visibleFiles.length > 0 && visibleFiles.every(f => checkedIds.includes(f.id))
          ? true
          : visibleFiles.some(f => checkedIds.includes(f.id))
            ? 'indeterminate'
            : false,
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
        title: `PDF（${visibleFiles.length}）`,
        children: queueItems
      })
    ]
  })
}

export default PdfCommand
