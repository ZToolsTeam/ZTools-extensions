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
  FilterBar
} from '@ztools/declarative-ui'
import {
  RealVideoFileItem,
  VideoProcessOutcome,
  VideoTaskId,
  HOST_FFMPEG_LIMIT_SECONDS,
  OUTPUT_SUFFIX,
  SCAN_TOP_N_PER_DIR,
  VIDEO_TASKS,
  buildFfmpegCommand,
  describeOutcomeSubtitle,
  describeOutcomeTag,
  fetchRealVideoWorkspace,
  fileNameOf,
  formatBytes,
  getVideoTask,
  makeVideoItem,
  processVideoBatch,
  resolveOutputFormat,
  revealVideoInFolder,
  summarizeOutcomes
} from './logic.js'
import { isRealElectronHost } from './native-ipc.js'

export * from './logic.js'

const MB = 1024 * 1024

/** 未连接 ZTools 客户端（例如在浏览器里预览布局）时显示的示例文件；界面状态条会注明这是示例 */
const PREVIEW_SAMPLE_VIDEOS: RealVideoFileItem[] = [
  makeVideoItem('vid-preview-1', 'D:\\Videos\\Captures\\Product_Launch_4K_60fps.mp4', 1420 * MB),
  makeVideoItem('vid-preview-2', 'D:\\Videos\\Recordings\\Screen_Recording_2026-10-18.mkv', 860 * MB),
  makeVideoItem('vid-preview-3', 'D:\\Videos\\Projects\\Demo_Walkthrough_Raw.mov', 640 * MB),
  makeVideoItem('vid-preview-4', 'D:\\Videos\\Meetings\\Team_Meeting_Recording_1080P.mp4', 512 * MB),
  makeVideoItem('vid-preview-5', 'D:\\Videos\\Captures\\UI_Interaction_Showcase.mp4', 328 * MB),
  makeVideoItem('vid-preview-6', 'D:\\Videos\\Tests\\Performance_Test_Capture.webm', 215 * MB),
  makeVideoItem('vid-preview-7', 'D:\\Downloads\\Layout_Tutorial.mp4', 184 * MB),
  makeVideoItem('vid-preview-8', 'D:\\Videos\\Exports\\Animation_Export.mov', 146 * MB)
]

const DEFAULT_FORMATS: Record<VideoTaskId, string> = {
  'convert-video': 'mp4',
  'to-gif': 'gif',
  'extract-audio': 'mp3'
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function BatchVideoCommand() {
  const isRealHost = isRealElectronHost()
  const initialVideos = isRealHost ? [] : PREVIEW_SAMPLE_VIDEOS
  const [searchText, setSearchText] = useState('')
  const [taskId, setTaskId] = useState<VideoTaskId>(VIDEO_TASKS[0]!.id)
  const [formatByTask, setFormatByTask] = useState<Record<VideoTaskId, string>>(DEFAULT_FORMATS)
  const [files, setFiles] = useState<RealVideoFileItem[]>(initialVideos)
  const [checkedIds, setCheckedIds] = useState<string[]>(initialVideos.map(f => f.id))
  const [isLoading, setIsLoading] = useState(false)
  const [running, setRunning] = useState(false)

  const runningRef = useRef(false)
  const stopRef = useRef(false)
  const scanningRef = useRef(false)
  const stopToastRef = useRef<{ hide: () => Promise<void> | void } | null>(null)

  async function refreshWorkspace(showIndicator = false) {
    if (scanningRef.current) return
    if (runningRef.current) {
      await showToast({ style: Toast.Style.Failure, title: '正在处理视频，完成后再重新扫描' })
      return
    }
    scanningRef.current = true
    setIsLoading(true)
    try {
      const ws = await fetchRealVideoWorkspace()
      const connected = isRealElectronHost()
      const nextFiles = connected || ws.files.length > 0 ? ws.files : PREVIEW_SAMPLE_VIDEOS
      setFiles(nextFiles)
      setCheckedIds(nextFiles.map(f => f.id))
      if (showIndicator) {
        await showToast({
          style: Toast.Style.Success,
          title: '视频队列已刷新',
          message: connected || ws.files.length > 0 ? `找到 ${nextFiles.length} 个视频文件` : '未连接 ZTools 客户端，显示的是示例文件'
        })
      }
    } catch (err) {
      await showToast({ style: Toast.Style.Failure, title: '扫描视频失败', message: errorText(err) })
    } finally {
      scanningRef.current = false
      setIsLoading(false)
    }
  }

  useEffect(() => {
    refreshWorkspace(false)
  }, [])

  const activeTask = getVideoTask(taskId)
  const activeFormat = resolveOutputFormat(activeTask, formatByTask[taskId]) || activeTask.formats[0]!.value

  async function executeBatch(targets: RealVideoFileItem[]) {
    if (runningRef.current) {
      await showToast({ style: Toast.Style.Failure, title: '正在处理视频，请等当前任务完成或先停止' })
      return
    }
    if (targets.length === 0) {
      await showToast({ style: Toast.Style.Failure, title: '请先勾选要处理的视频' })
      return
    }
    const settings = { taskId, format: activeFormat }
    runningRef.current = true
    stopRef.current = false
    setRunning(true)
    setIsLoading(true)
    let progressToast: { hide: () => Promise<void> | void } | null = null
    try {
      progressToast = await showToast({
        style: Toast.Style.Animated,
        title: `正在处理 ${targets.length} 个视频...`,
        message: `${activeTask.title} · ${activeFormat.toUpperCase()}，单个文件最长 ${HOST_FFMPEG_LIMIT_SECONDS} 秒`
      })
      const outcomes = await processVideoBatch(targets, settings, {
        onItem: (id: string, outcome: VideoProcessOutcome) => {
          setFiles(prev => prev.map(item => (item.id === id ? { ...item, result: outcome } : item)))
        },
        shouldStop: () => stopRef.current
      })
      await progressToast?.hide()
      const summary = summarizeOutcomes(outcomes.values())
      const notStarted = targets.length - summary.total

      if (summary.done === 0) {
        await showToast({
          style: Toast.Style.Failure,
          title:
            summary.total === 0
              ? '已停止，没有处理任何视频'
              : summary.total > 1
                ? `${summary.total} 个视频全部处理失败`
                : '视频处理失败',
          message: summary.firstError || '已按要求停止'
        })
        return
      }
      if (summary.failed > 0 || notStarted > 0) {
        await showToast({
          style: Toast.Style.Failure,
          title: `已输出 ${summary.done} 个，失败 ${summary.failed} 个${notStarted > 0 ? `，未处理 ${notStarted} 个` : ''}`,
          message: summary.firstError || '已按要求停止'
        })
        return
      }
      await showToast({
        style: Toast.Style.Success,
        title: `已输出 ${summary.done} 个文件`,
        message: `共 ${formatBytes(summary.outputBytes)}，另存到源文件所在目录（*${OUTPUT_SUFFIX}*），原文件未改动`
      })
    } catch (err) {
      await showToast({ style: Toast.Style.Failure, title: '视频处理异常', message: errorText(err) })
    } finally {
      await progressToast?.hide()
      await stopToastRef.current?.hide()
      stopToastRef.current = null
      runningRef.current = false
      stopRef.current = false
      setRunning(false)
      setIsLoading(false)
    }
  }

  async function requestStop() {
    if (!runningRef.current) return
    stopRef.current = true
    stopToastRef.current = await showToast({ style: Toast.Style.Animated, title: '将在当前文件处理完成后停止' })
  }

  async function handleReveal(file: RealVideoFileItem) {
    const shown = await revealVideoInFolder(file)
    if (shown === 'failed') {
      await showToast({ style: Toast.Style.Failure, title: '无法在资源管理器中显示', message: file.path })
      return
    }
    if (shown === 'source' && file.result?.status === 'done') {
      await showToast({
        style: Toast.Style.Success,
        title: '已显示源文件，输出文件在同一目录',
        message: fileNameOf(file.result.outputPath)
      })
    }
  }

  async function copyText(text: string, title: string) {
    try {
      await Clipboard.copy(text)
      await showToast({ style: Toast.Style.Success, title, message: text })
    } catch (err) {
      await showToast({ style: Toast.Style.Failure, title: '复制失败', message: errorText(err) })
    }
  }

  const q = searchText.trim().toLowerCase()
  const filteredFiles = files.filter(f => !q || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
  const selectedFiles = files.filter(f => checkedIds.includes(f.id))
  const selectedBytes = selectedFiles.reduce((sum, f) => sum + f.sizeBytes, 0)
  const doneFiles = files.filter(f => f.result?.status === 'done')
  const doneSourceBytes = doneFiles.reduce((sum, f) => sum + f.sizeBytes, 0)
  const resultSummary = summarizeOutcomes(
    files.map(f => f.result).filter((r): r is VideoProcessOutcome => Boolean(r))
  )
  const hasResults = resultSummary.total > 0
  const allFilteredChecked = filteredFiles.length > 0 && filteredFiles.every(f => checkedIds.includes(f.id))
  const maxVideoBytes = Math.max(1, ...files.map(f => f.sizeBytes))

  /** 勾选 / 取消勾选当前搜索结果里的全部视频，不影响搜索结果以外已勾选的项 */
  function setFilteredChecked(checked: boolean) {
    const filteredIds = new Set(filteredFiles.map(f => f.id))
    setCheckedIds(prev =>
      checked ? Array.from(new Set([...prev, ...filteredIds])) : prev.filter(id => !filteredIds.has(id))
    )
  }

  const rightQueueItems = filteredFiles.map(f => {
    const doneResult = f.result?.status === 'done' ? f.result : null
    const actionChildren = [
      running
        ? Action({
            title: '停止处理（当前文件完成后停止）',
            icon: Icon.Stop,
            onAction: requestStop
          })
        : Action({
            title: `开始处理已选视频 (${selectedFiles.length} 个)`,
            icon: Icon.Bolt,
            onAction: () => executeBatch(selectedFiles)
          }),
      Action({
        title: doneResult ? '在资源管理器中显示输出文件' : '在资源管理器中显示',
        icon: Icon.Folder,
        onAction: () => handleReveal(f)
      }),
      Action({
        title: '仅处理此文件',
        icon: Icon.Play,
        onAction: () => executeBatch([f])
      }),
      Action({
        title: '复制等效 ffmpeg 命令',
        icon: Icon.Terminal,
        onAction: () => copyText(buildFfmpegCommand(f.path, activeFormat), '已复制 ffmpeg 命令')
      })
    ]
    if (doneResult) {
      actionChildren.push(
        Action({
          title: '复制输出文件路径',
          icon: Icon.CopyClipboard,
          onAction: () => copyText(doneResult.outputPath, '已复制输出文件路径')
        })
      )
    }
    actionChildren.push(
      Action({
        title: allFilteredChecked ? '取消全选当前列表' : '全选当前列表',
        icon: Icon.CheckCircle,
        onAction: () => setFilteredChecked(!allFilteredChecked)
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
      accessories: [
        { progress: { value: Math.max(8, Math.min(100, Math.round((f.sizeBytes / maxVideoBytes) * 100))) } },
        { tag: { value: describeOutcomeTag(f.result) } },
        { text: formatBytes(f.sizeBytes) }
      ],
      actions: ActionPanel({
        title: f.name,
        children: actionChildren
      })
    })
  })

  const previewNote = isRealHost ? '' : '未连接 ZTools 客户端，以下为示例文件 · '
  const resultText = hasResults ? ` · 已输出 ${resultSummary.done} 个，失败 ${resultSummary.failed} 个` : ''

  return List({
    searchBarPlaceholder: '搜索队列中的视频文件名或目录...',
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    isLoading,
    searchBarAccessory: List.Dropdown({
      tooltip: '选择处理任务',
      value: taskId,
      onChange: val => setTaskId(getVideoTask(val).id),
      children: VIDEO_TASKS.map(task =>
        List.Dropdown.Item({
          title: `任务：${task.tag}`,
          value: task.id
        })
      )
    }),
    filterBar: FilterBar({
      summaryText: `${previewNote}已选 ${selectedFiles.length}/${files.length} 个视频（${formatBytes(selectedBytes)}）${resultText}`,
      actions: [
        {
          id: 'rescan-video',
          label: '重新扫描',
          style: 'secondary',
          onAction: () => refreshWorkspace(true)
        }
      ]
    }),
    workbenchPanel: {
      title: '处理参数',
      subtitle: activeTask.tag,
      fields: [
        activeTask.formats.length > 1
          ? {
              id: 'wb-format',
              label: '输出格式',
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
              label: '输出格式',
              type: 'info',
              value: activeTask.formats[0]!.label
            },
        {
          id: 'wb-codec',
          label: '编码参数',
          type: 'info',
          value: 'ffmpeg 默认'
        },
        {
          id: 'wb-outdir',
          label: '输出位置',
          type: 'info',
          value: `源目录 *${OUTPUT_SUFFIX}*.${activeFormat}`
        },
        {
          id: 'wb-limit',
          label: '单个文件时限',
          type: 'info',
          value: `${HOST_FFMPEG_LIMIT_SECONDS} 秒`
        }
      ],
      previewCard: {
        title: hasResults ? '处理结果' : '处理说明',
        badge: hasResults ? `成功 ${resultSummary.done} / 失败 ${resultSummary.failed}` : '尚未处理',
        subtitle: `${activeTask.subtitle}。需要本机已安装 ffmpeg。输出文件名为「原名${OUTPUT_SUFFIX}」，同名文件已存在或无法确认时自动加序号或时间，不覆盖已有文件，也不修改原文件。`,
        metrics: [
          { label: '已输出', value: `${resultSummary.done} 个` },
          { label: '失败', value: `${resultSummary.failed} 个` },
          { label: '输出总大小', value: resultSummary.done > 0 ? formatBytes(resultSummary.outputBytes) : '—' },
          { label: '对应原文件', value: resultSummary.done > 0 ? formatBytes(doneSourceBytes) : '—' }
        ]
      }
    },
    subList: {
      title: '待处理视频（勾选后按 ↵ 开始处理）',
      subtitle: `${filteredFiles.length} 个 · 每个目录最多列出体积最大的 ${SCAN_TOP_N_PER_DIR} 个`,
      checkable: filteredFiles.length > 0,
      checked: allFilteredChecked
        ? true
        : filteredFiles.some(f => checkedIds.includes(f.id))
          ? 'indeterminate'
          : false,
      onCheckChange: checked => setFilteredChecked(Boolean(checked)),
      emptyText: isRealHost && !q ? '在视频、下载、桌面目录中没有找到视频文件' : '当前没有匹配的视频文件',
      items: rightQueueItems
    },
    children: [
      List.Section({
        title: `待处理视频 (${filteredFiles.length})`,
        children: rightQueueItems
      })
    ]
  })
}

export default BatchVideoCommand
