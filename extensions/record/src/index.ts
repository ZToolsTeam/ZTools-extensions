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
  useLocale,
  showToast,
  Toast,
  FilterBar
} from '@ztools/declarative-ui'
import { t } from './i18n.js'
import {
  RECORD_FORMAT_OPTIONS,
  RECORD_FPS_OPTIONS,
  getRecordFormatOptions,
  getRecordLimitationNote,
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
    showToast({ style: Toast.Style.Failure, title: t('openFailedTitle'), message: item.path })
  }
}

async function handleReveal(item: RecordedVideoItem) {
  if (!(await openRecordFileLocation(item.path))) {
    showToast({ style: Toast.Style.Failure, title: t('revealFailedTitle'), message: item.path })
  }
}

async function handleCopyPath(item: RecordedVideoItem) {
  try {
    await Clipboard.copy(item.path)
    showToast({ style: Toast.Style.Success, title: t('copiedPathToast') })
  } catch (err) {
    showToast({ style: Toast.Style.Failure, title: t('copyFailedToast'), message: errorText(err) })
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
      { tag: item.extension.replace('.', '').toUpperCase() || t('unknownExt') },
      { text: item.sizeBytes === null ? t('sizeUnknown') : formatBytes(item.sizeBytes) }
    ],
    actions: ActionPanel({
      title: item.name,
      children: [
        Action({ title: t('openRecording'), icon: Icon.Eye, onAction: () => handleOpen(item) }),
        Action({ title: t('revealInFolder'), icon: Icon.Folder, onAction: () => handleReveal(item) }),
        toggleAction,
        Action({ title: t('copyFilePath'), icon: Icon.CopyClipboard, onAction: () => handleCopyPath(item) })
      ]
    })
  })
}

export function RecordCommand() {
  useLocale()
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
          showToast({ style: Toast.Style.Failure, title: t('readFilesFailed'), message: ws.listError })
        } else {
          showToast({
            style: Toast.Style.Success,
            title: t('rescannedTitle'),
            message: t('rescannedMsg', { count: ws.recordings.length, partial: ws.partial ? t('partialSuffix') : '' })
          })
        }
      }
    } catch (err) {
      if (seq !== refreshSeq.current) return
      showToast({ style: Toast.Style.Failure, title: t('readInfoFailed'), message: errorText(err) })
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
      showToast({ style: Toast.Style.Failure, title: t('startFailedTitle'), message: res.message })
      await refreshWorkspace(false)
      return
    }
    showToast({
      style: Toast.Style.Success,
      title: res.message,
      message: t('writingMsg', { dir: res.outputPath || res.saveDir || t('defaultSaveDir') })
    })
    await refreshWorkspace(false)
  }

  async function handleStopRecording() {
    const res = await stopScreenRecording()
    if (!res.ok) {
      showToast({ style: Toast.Style.Failure, title: t('stopFailedTitle'), message: res.message })
    } else {
      const sizeText = typeof res.sizeBytes === 'number' ? t('sizeParen', { size: formatBytes(res.sizeBytes) }) : ''
      showToast({ style: Toast.Style.Success, title: res.message, message: `${res.outputPath || saveDir}${sizeText}` })
    }
    await refreshWorkspace(false)
  }

  // 状态已确认在录制才是“停止”；状态未知时按“开始”处理，开始前会再向客户端确认，已在录制会如实提示
  const toggleTitle = isRecording === true ? t('stopRecordingSave') : t('startRecording')
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
      ? t('statusRecording')
      : isRecording === false
        ? t('statusIdle')
        : workspace?.statusError
          ? t('statusUnknownErr', { error: workspace.statusError })
          : t('statusLoading')
  const listText = workspace?.listError
    ? t('listReadFailed', { error: workspace.listError })
    : t('listSummary', { count: recordings.length, partial: workspace?.partial ? t('partialSuffix') : '' })

  const emptyText = workspace?.listError
    ? t('emptyReadFailed', { error: workspace.listError })
    : q && recordings.length > 0
      ? t('emptyNoMatch')
      : t('emptyNoRecordings')

  const currentSession = isRecording === true ? workspace?.sessions[0] : undefined

  return List({
    searchBarPlaceholder: t('searchPlaceholder'),
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
          label: t('rescan'),
          title: t('rescan'),
          style: 'secondary',
          onAction: () => {
            void refreshWorkspace(true)
          }
        }
      ]
    }),
    workbenchPanel: {
      title: t('wbTitle'),
      subtitle: t('wbSubtitle'),
      fields: [
        {
          id: 'wb-rec-fps',
          label: t('wbFpsLabel'),
          type: 'select',
          value: fps,
          onChange: (val: string) => {
            if (RECORD_FPS_OPTIONS.some(o => o.value === val)) setFps(val as RecordFps)
          },
          options: RECORD_FPS_OPTIONS.map(o => ({ label: o.label, value: o.value }))
        },
        {
          id: 'wb-rec-format',
          label: t('wbFormatLabel'),
          type: 'select',
          value: format,
          onChange: (val: string) => {
            if (RECORD_FORMAT_OPTIONS.some(o => o.value === val)) setFormat(val as RecordFormat)
          },
          options: getRecordFormatOptions().map(o => ({ label: o.label, value: o.value }))
        },
        { id: 'wb-rec-scope', label: t('wbScopeLabel'), type: 'info', value: t('wbScopeValue') },
        { id: 'wb-rec-audio', label: t('wbAudioLabel'), type: 'info', value: t('wbAudioValue') }
      ],
      previewCard: {
        title: t('wbCardTitle'),
        badge: isRecording === true ? t('badgeRecording') : isRecording === false ? t('badgeIdle') : t('badgeUnknown'),
        subtitle: getRecordLimitationNote(),
        metrics: currentSession
          ? [
              { label: t('metricStartTime'), value: formatRecordTime(currentSession.startedAtMs) },
              { label: t('metricOutputFile'), value: currentSession.outputPath.split(/[\\/]/).pop() || t('unknownValue') }
            ]
          : []
      }
    },
    subList: {
      title: t('subListTitle'),
      subtitle: t('subListSubtitle', { count: filteredRecordings.length, size: formatBytes(knownBytes), dir: saveDir || t('unknownValue') }),
      emptyText,
      items
    },
    actions: ActionPanel({
      title: t('panelTitle'),
      children: [
        toggleAction(),
        Action({ title: t('rescan'), icon: Icon.Repeat, onAction: () => refreshWorkspace(true) })
      ]
    }),
    children: [
      List.Section({
        title: t('sectionTitle', { count: filteredRecordings.length }),
        children: items
      })
    ]
  })
}

export default RecordCommand
