import {
  List,
  Detail,
  ActionPanel,
  Action,
  Icon,
  Clipboard,
  LocalStorage,
  useState,
  useEffect,
  useRef,
  useCachedState,
  showToast,
  Toast
} from '@ztools/declarative-ui'
import {
  NOT_IN_CLIENT_MESSAGE,
  OCR_LANGUAGES,
  type HostTransport,
  type OcrLanguage,
  type OcrOutcome,
  countCharacters,
  fileNameOf,
  firstLine,
  getClientTransport,
  notify,
  pickImageFiles,
  recognizeClipboardImage,
  recognizeImageFile,
  recognizeScreenRegion,
  resolveLanguage,
  textAsMarkdown
} from './ocr-service.js'

export * from './ocr-service.js'

const LANGUAGE_KEY = 'language'

export interface OcrEntry {
  id: string
  source: 'file' | 'region' | 'clipboard'
  title: string
  /** 图片文件路径；框选和剪贴板没有 */
  path?: string
  status: 'running' | 'done' | 'failed'
  text: string
  error?: string
}

async function loadLanguage(): Promise<OcrLanguage> {
  try {
    return resolveLanguage(await LocalStorage.getItem(LANGUAGE_KEY))
  } catch {
    return resolveLanguage(undefined)
  }
}

function requireTransport(): HostTransport {
  const transport = getClientTransport()
  if (!transport) throw new Error(NOT_IN_CLIENT_MESSAGE)
  return transport
}

function timeLabel(): string {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

let entrySeq = 0
function newEntryId(): string {
  entrySeq += 1
  return `ocr-${Date.now()}-${entrySeq}`
}

function applyOutcome(entry: OcrEntry, outcome: OcrOutcome): OcrEntry {
  return outcome.ok
    ? { ...entry, status: 'done', text: outcome.text, error: undefined }
    : { ...entry, status: 'failed', text: '', error: outcome.error }
}

/** 无界面命令：框选屏幕区域，识别后复制到剪贴板 */
export async function ocrRegion(): Promise<string> {
  const transport = requireTransport()
  const outcome = await recognizeScreenRegion(transport, await loadLanguage(), false)
  if (!outcome.ok) {
    if (outcome.canceled) return '已取消框选'
    throw new Error(outcome.error)
  }
  await Clipboard.copy(outcome.text)
  // 框选时 ZTools 窗口已经收起，用系统通知告诉用户结果
  await notify(transport, '已复制识别的文字', firstLine(outcome.text, 80))
  return `已复制 ${countCharacters(outcome.text)} 个字`
}

/** 无界面命令：识别剪贴板里的图片，结果复制回剪贴板 */
export async function ocrClipboard(): Promise<string> {
  const transport = requireTransport()
  const outcome = await recognizeClipboardImage(transport, await loadLanguage())
  if (!outcome.ok) throw new Error(outcome.error)
  await Clipboard.copy(outcome.text)
  return `已复制 ${countCharacters(outcome.text)} 个字`
}

export function OcrCommand() {
  const transport = getClientTransport()
  const [language, setLanguage] = useState<OcrLanguage>(OCR_LANGUAGES[0])
  const [entries, setEntries] = useCachedState<OcrEntry[]>('entries', [])
  const [searchText, setSearchText] = useState('')
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  useEffect(() => {
    void loadLanguage().then(setLanguage)
  }, [])

  function changeLanguage(id: string) {
    const next = resolveLanguage(id)
    setLanguage(next)
    void LocalStorage.setItem(LANGUAGE_KEY, next.id).catch(() => undefined)
  }

  function updateEntry(id: string, change: (entry: OcrEntry) => OcrEntry) {
    setEntries(previous => previous.map(entry => (entry.id === id ? change(entry) : entry)))
  }

  /** 同一时间只做一件事：框选、选择图片、识别都会占用识别组件 */
  async function exclusive(task: (host: HostTransport) => Promise<void>) {
    if (!transport) {
      await showToast({ style: Toast.Style.Failure, title: NOT_IN_CLIENT_MESSAGE })
      return
    }
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await task(transport)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  async function recognizeInto(entry: OcrEntry, run: () => Promise<OcrOutcome>): Promise<OcrOutcome> {
    const outcome = await run()
    updateEntry(entry.id, current => applyOutcome(current, outcome))
    return outcome
  }

  function addEntry(entry: OcrEntry) {
    setEntries(previous => [entry, ...previous])
    setSelectedId(entry.id)
  }

  async function handleRegion() {
    await exclusive(async host => {
      const entry: OcrEntry = { id: newEntryId(), source: 'region', title: `框选截图 ${timeLabel()}`, status: 'running', text: '' }
      const outcome = await recognizeScreenRegion(host, language)
      if (!outcome.ok && outcome.canceled) return
      addEntry(applyOutcome(entry, outcome))
      if (outcome.ok) {
        await Clipboard.copy(outcome.text)
        await showToast({ style: Toast.Style.Success, title: '已识别并复制', message: firstLine(outcome.text) })
      } else {
        await showToast({ style: Toast.Style.Failure, title: '截图识别失败', message: outcome.error })
      }
    })
  }

  async function handleClipboard() {
    await exclusive(async host => {
      const outcome = await recognizeClipboardImage(host, language)
      if (!outcome.ok && !outcome.empty && outcome.error === '剪贴板里没有图片') {
        await showToast({ style: Toast.Style.Failure, title: '剪贴板里没有图片' })
        return
      }
      addEntry(applyOutcome({ id: newEntryId(), source: 'clipboard', title: `剪贴板图片 ${timeLabel()}`, status: 'running', text: '' }, outcome))
      if (!outcome.ok) await showToast({ style: Toast.Style.Failure, title: '识别失败', message: outcome.error })
    })
  }

  async function handleAddImages() {
    await exclusive(async host => {
      let paths: string[]
      try {
        paths = await pickImageFiles(host)
      } catch (error) {
        await showToast({ style: Toast.Style.Failure, title: '无法打开选择图片窗口', message: error instanceof Error ? error.message : String(error) })
        return
      }
      if (paths.length === 0) return
      const added = paths.map((path): OcrEntry => ({ id: newEntryId(), source: 'file', title: fileNameOf(path), path, status: 'running', text: '' }))
      setEntries(previous => [...added, ...previous])
      setSelectedId(added[0].id)
      let failed = 0
      for (const entry of added) {
        const outcome = await recognizeInto(entry, () => recognizeImageFile(host, entry.path as string, language))
        if (!outcome.ok) failed += 1
      }
      const done = added.length - failed
      await showToast({
        style: failed > 0 ? Toast.Style.Failure : Toast.Style.Success,
        title: failed > 0 ? `${done} 张识别成功，${failed} 张失败` : `已识别 ${done} 张图片`
      })
    })
  }

  async function handleRetry(entry: OcrEntry) {
    if (!entry.path) return
    await exclusive(async host => {
      updateEntry(entry.id, current => ({ ...current, status: 'running', error: undefined }))
      const outcome = await recognizeInto(entry, () => recognizeImageFile(host, entry.path as string, language))
      if (!outcome.ok) await showToast({ style: Toast.Style.Failure, title: '识别失败', message: outcome.error })
    })
  }

  function handleRemove(entry: OcrEntry) {
    setEntries(previous => previous.filter(item => item.id !== entry.id))
  }

  const query = searchText.trim().toLowerCase()
  const visible = entries.filter(entry => !query || entry.title.toLowerCase().includes(query) || entry.text.toLowerCase().includes(query))
  const doneEntries = entries.filter(entry => entry.status === 'done')
  const allText = doneEntries.map(entry => (doneEntries.length > 1 ? `${entry.title}\n${entry.text}` : entry.text)).join('\n\n')

  const clipboardAction = Action({
    title: '识别剪贴板图片',
    icon: Icon.Clipboard,
    shortcut: { modifiers: ['cmd', 'shift'], key: 'v' },
    onAction: handleClipboard
  })
  const startActions = [
    Action({ title: '截图识别', icon: Icon.Camera, onAction: handleRegion }),
    Action({ title: '添加图片', icon: Icon.Plus, shortcut: { modifiers: ['cmd'], key: 'o' }, onAction: handleAddImages }),
    clipboardAction
  ]

  const items = visible.map(entry => {
    const subtitle = entry.status === 'done' ? firstLine(entry.text) : entry.status === 'failed' ? entry.error || '识别失败' : '正在识别'
    const markdown = entry.status === 'done' ? textAsMarkdown(entry.text) : entry.status === 'failed' ? `识别失败：${entry.error || '未知原因'}` : '正在识别…'
    const entryActions = [
      ...(entry.status === 'done'
        ? [Action.CopyToClipboard({ title: '复制文字', content: entry.text })]
        : []),
      ...(entry.path && entry.status !== 'running'
        ? [Action({ title: '重新识别', icon: Icon.ArrowClockwise, shortcut: { modifiers: ['cmd'], key: 'r' }, onAction: () => handleRetry(entry) })]
        : []),
      ...(doneEntries.length > 1
        ? [Action.CopyToClipboard({ title: `复制全部 ${doneEntries.length} 条结果`, content: allText, shortcut: { modifiers: ['cmd', 'shift'], key: 'c' } })]
        : []),
      ...(entry.path ? [Action.ShowInFinder({ path: entry.path })] : []),
      Action({ title: '从列表移除', icon: Icon.Trash, shortcut: { modifiers: ['cmd'], key: 'backspace' }, onAction: () => handleRemove(entry) })
    ]
    return List.Item({
      id: entry.id,
      title: entry.title,
      subtitle,
      icon: entry.source === 'file' ? Icon.Image : entry.source === 'region' ? Icon.Camera : Icon.Clipboard,
      accessories: entry.status === 'done'
        ? [{ text: `${countCharacters(entry.text)} 字` }]
        : [{ tag: entry.status === 'failed' ? '失败' : '识别中' }],
      detail: Detail({ markdown }),
      actions: ActionPanel({
        children: [
          ActionPanel.Section({ children: entryActions }),
          ActionPanel.Section({ title: '新的识别', children: startActions })
        ]
      })
    })
  })

  const summaryText = !transport
    ? NOT_IN_CLIENT_MESSAGE
    : entries.length === 0
      ? '框选屏幕上的文字，或添加图片，在本机识别'
      : `${doneEntries.length} 条识别结果${busy ? '，正在处理' : ''}`

  return List({
    searchBarPlaceholder: '搜索识别结果',
    onSearchTextChange: setSearchText,
    isLoading: busy,
    isShowingDetail: visible.length > 0,
    selectedItemId: selectedId,
    onSelectionChange: (id: string | null) => setSelectedId(id ?? undefined),
    searchBarAccessory: List.Dropdown({
      tooltip: '识别语言',
      value: language.id,
      onChange: changeLanguage,
      children: OCR_LANGUAGES.map(item => List.Dropdown.Item({ title: item.title, value: item.id }))
    }),
    filterBar: {
      summaryText,
      actions: transport
        ? [
            { id: 'ocr-region', title: '截图识别', icon: Icon.Camera, onAction: handleRegion },
            { id: 'ocr-add', title: '添加图片', icon: Icon.Plus, onAction: handleAddImages }
          ]
        : []
    },
    actions: ActionPanel({ children: startActions }),
    children: items
  })
}

export const ocrWorkbench = OcrCommand
export default OcrCommand
