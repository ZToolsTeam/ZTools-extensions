/**
 * 屏幕录制（布局三：左侧录制参数 + 右侧录制文件）
 *
 * - 左栏只放客户端真实支持的参数：帧率、输出格式；录制范围与限制如实写明
 * - 右栏列出保存目录里的录制文件：打开 ↵ / 在文件夹中显示 ⌘↵ / 动作面板 ⌘K
 * - 开始 / 停止录制是全局动作：顶部状态条按钮，列表为空时也是底部主动作
 */
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
  RECORD_FORMAT_OPTIONS,
  RECORD_FPS_OPTIONS,
  RECORD_LIMITATION_NOTE,
  RecordFormat,
  RecordFps,
  RecordWorkspaceSnapshot,
  RecordedVideoItem,
  fetchRecordWorkspace,
  formatBytes,
  formatRecordTime,
  openRecordFileLocation,
  openRecordedVideo,
  startScreenRecording,
  stopScreenRecording
} from './logic.js'

export * from './logic.js'

const TOGGLE_SHORTCUT: { modifiers: Array<'cmd' | 'shift'>; key: string } = { modifiers: ['cmd', 'shift'], key: 'r' }

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function handleOpen(item: RecordedVideoItem) {
  if (!(await openRecordedVideo(item.path))) {
    showToast({ style: Toast.Style.Failure, title: '无法打开录制文件', message: item.path })
  }
}

async function handleReveal(item: RecordedVideoItem) {
  if (!(await openRecordFileLocation(item.path))) {
    showToast({ style: Toast.Style.Failure, title: '无法在文件夹中显示', message: item.path })
  }
}

async function handleCopyPath(item: RecordedVideoItem) {
  try {
    await Clipboard.copy(item.path)
    showToast({ style: Toast.Style.Success, title: '已复制文件路径' })
  } catch (err) {
    showToast({ style: Toast.Style.Failure, title: '复制失败', message: errorText(err) })
  }
}

/** 录制文件行：打开 ↵ / 在文件夹中显示 ⌘↵，其余进动作面板 */
function buildRecordingItem(item: RecordedVideoItem, toggleAction: ReturnType<typeof Action>) {
  return List.Item({
    id: item.id,
    title: item.name,
    subtitle: item.modifiedMs !== null ? formatRecordTime(item.modifiedMs) : undefined,
    icon: { source: item.extension === '.gif' ? Icon.Image : Icon.Video },
    accessories: [
      { tag: item.extension.replace('.', '').toUpperCase() || '未知' },
      { text: item.sizeBytes === null ? '大小未知' : formatBytes(item.sizeBytes) }
    ],
    actions: ActionPanel({
      title: item.name,
      children: [
        Action({ title: '打开录制文件', icon: Icon.Eye, onAction: () => handleOpen(item) }),
        Action({ title: '在文件夹中显示', icon: Icon.Folder, onAction: () => handleReveal(item) }),
        toggleAction,
        Action({ title: '复制文件路径', icon: Icon.CopyClipboard, onAction: () => handleCopyPath(item) })
      ]
    })
  })
}

export function RecordCommand() {
  const [searchText, setSearchText] = useState('')
  const [fps, setFps] = useState<RecordFps>('30')
  const [format, setFormat] = useState<RecordFormat>('mp4')
  const [workspace, setWorkspace] = useState<RecordWorkspaceSnapshot | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const refreshSeq = useRef(0)

  async function refreshWorkspace(announce = false) {
    const seq = ++refreshSeq.current
    setIsLoading(true)
    try {
      const ws = await fetchRecordWorkspace()
      if (seq !== refreshSeq.current) return
      setWorkspace(ws)
      if (announce) {
        if (ws.listError) {
          showToast({ style: Toast.Style.Failure, title: '读取录制文件失败', message: ws.listError })
        } else {
          showToast({
            style: Toast.Style.Success,
            title: '已重新扫描',
            message: `保存目录中有 ${ws.recordings.length} 个录制文件${ws.partial ? '（仅取回部分）' : ''}`
          })
        }
      }
    } catch (err) {
      if (seq !== refreshSeq.current) return
      showToast({ style: Toast.Style.Failure, title: '读取录制信息失败', message: errorText(err) })
    } finally {
      if (seq === refreshSeq.current) setIsLoading(false)
    }
  }

  useEffect(() => {
    void refreshWorkspace(false)
  }, [])

  const isRecording = workspace ? workspace.isRecording : null
  const saveDir = workspace?.saveDir || ''
  const recordings = workspace?.recordings || []

  async function handleStartRecording() {
    const res = await startScreenRecording({ fps, format, saveDir })
    if (!res.ok) {
      showToast({ style: Toast.Style.Failure, title: '录制启动失败', message: res.message })
      await refreshWorkspace(false)
      return
    }
    showToast({
      style: Toast.Style.Success,
      title: res.message,
      message: `正在写入 ${res.outputPath || res.saveDir || '默认保存目录'}。录制的是整个桌面，回到本插件停止并保存。`
    })
    await refreshWorkspace(false)
  }

  async function handleStopRecording() {
    const res = await stopScreenRecording()
    if (!res.ok) {
      showToast({ style: Toast.Style.Failure, title: '停止录制失败', message: res.message })
    } else {
      const sizeText = typeof res.sizeBytes === 'number' ? `（${formatBytes(res.sizeBytes)}）` : ''
      showToast({ style: Toast.Style.Success, title: res.message, message: `${res.outputPath || saveDir}${sizeText}` })
    }
    await refreshWorkspace(false)
  }

  // 状态已确认在录制才是“停止”；状态未知时按“开始”处理，开始前会再向客户端确认，已在录制会如实提示
  const toggleTitle = isRecording === true ? '停止录制并保存' : '开始录制'
  const handleToggle = () => (isRecording === true ? handleStopRecording() : handleStartRecording())

  const q = searchText.trim().toLowerCase()
  const filteredRecordings = recordings.filter(r => !q || r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q))
  const knownBytes = filteredRecordings.reduce((s, r) => s + (r.sizeBytes ?? 0), 0)

  const toggleAction = () =>
    Action({
      title: toggleTitle,
      icon: isRecording === true ? Icon.Stop : Icon.Play,
      shortcut: TOGGLE_SHORTCUT,
      onAction: handleToggle
    })
  const items = filteredRecordings.map(item => buildRecordingItem(item, toggleAction()))

  const statusText =
    isRecording === true
      ? '正在录制'
      : isRecording === false
        ? '未在录制'
        : workspace?.statusError
          ? `录制状态未知（${workspace.statusError}）`
          : '正在读取录制状态'
  const listText = workspace?.listError
    ? `录制文件读取失败：${workspace.listError}`
    : `${recordings.length} 个录制文件${workspace?.partial ? '（仅取回部分）' : ''}`

  const emptyText = workspace?.listError
    ? `读取保存目录失败：${workspace.listError}`
    : q && recordings.length > 0
      ? '没有匹配的录制文件'
      : '还没有录制文件，开始录制后会保存到这里'

  const currentSession = isRecording === true ? workspace?.sessions[0] : undefined

  return List({
    searchBarPlaceholder: '搜索录制文件名...',
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    isLoading,
    filterBar: FilterBar({
      summaryText: `${statusText} · ${listText}`,
      actions: [
        {
          id: 'toggle-record-session',
          label: toggleTitle,
          title: toggleTitle,
          style: 'primary',
          onAction: () => {
            void handleToggle()
          }
        },
        {
          id: 'rescan-record',
          label: '重新扫描',
          title: '重新扫描',
          style: 'secondary',
          onAction: () => {
            void refreshWorkspace(true)
          }
        }
      ]
    }),
    workbenchPanel: {
      title: '录制参数',
      subtitle: '整个桌面 · 不录声音',
      fields: [
        {
          id: 'wb-rec-fps',
          label: '帧率',
          type: 'select',
          value: fps,
          onChange: (val: string) => {
            if (RECORD_FPS_OPTIONS.some(o => o.value === val)) setFps(val as RecordFps)
          },
          options: RECORD_FPS_OPTIONS.map(o => ({ label: o.label, value: o.value }))
        },
        {
          id: 'wb-rec-format',
          label: '输出格式',
          type: 'select',
          value: format,
          onChange: (val: string) => {
            if (RECORD_FORMAT_OPTIONS.some(o => o.value === val)) setFormat(val as RecordFormat)
          },
          options: RECORD_FORMAT_OPTIONS.map(o => ({ label: o.label, value: o.value }))
        },
        { id: 'wb-rec-scope', label: '录制范围', type: 'info', value: '整个桌面' },
        { id: 'wb-rec-audio', label: '声音', type: 'info', value: '不录制' }
      ],
      previewCard: {
        title: '录制说明',
        badge: isRecording === true ? '录制中' : isRecording === false ? '未在录制' : '状态未知',
        subtitle: RECORD_LIMITATION_NOTE,
        metrics: currentSession
          ? [
              { label: '开始时间', value: formatRecordTime(currentSession.startedAtMs) },
              { label: '输出文件', value: currentSession.outputPath.split(/[\\/]/).pop() || '未知' }
            ]
          : []
      }
    },
    subList: {
      title: '录制文件（按时间倒序，↵ 打开）',
      subtitle: `${filteredRecordings.length} 个 · ${formatBytes(knownBytes)} · 保存目录：${saveDir || '未知'}`,
      emptyText,
      items
    },
    actions: ActionPanel({
      title: '屏幕录制',
      children: [
        toggleAction(),
        Action({ title: '重新扫描', icon: Icon.Repeat, onAction: () => refreshWorkspace(true) })
      ]
    }),
    children: [
      List.Section({
        title: `录制文件 (${filteredRecordings.length})`,
        children: items
      })
    ]
  })
}

export default RecordCommand
