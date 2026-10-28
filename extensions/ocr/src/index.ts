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
  NOT_IN_CLIENT_MESSAGE,
  OCR_LANGUAGE_MODELS,
  OcrBatchResult,
  OcrLayoutStrategy,
  OcrPostAction,
  OcrQueueItem,
  captureScreenAreaOcr,
  executeBatchOcr,
  fetchOcrWorkspace,
  formatBytes,
  openOcrFileLocation,
  resolveOcrLanguage
} from './logic.js'
import { isRealElectronHost } from './native-ipc.js'

export * from './logic.js'

const POST_ACTION_LABELS: Record<OcrPostAction, string> = {
  copy_clipboard: '复制到剪贴板',
  export_file: '导出为同名 .txt 或 .md 文件',
  copy_and_export: '复制到剪贴板并导出文件'
}

/** 把一次批量识别的结果整理成一句如实的说明（成功、失败、复制、导出各自的结果） */
export function describeOcrBatchResult(res: OcrBatchResult): { failed: boolean; title: string; message: string } {
  if (!res.ok) {
    return { failed: true, title: '识别失败', message: res.error || '没有识别到文字' }
  }
  const parts: string[] = []
  let failed = res.failedCount > 0
  if (res.failedCount > 0) parts.push(`${res.failedCount} 张失败`)
  if (res.copied === true) parts.push('已复制到剪贴板')
  if (res.copied === false) {
    failed = true
    parts.push(res.copyError || '写入剪贴板失败')
  }
  if (res.exportCanceled) parts.push('已取消导出')
  if (res.exportError) {
    failed = true
    parts.push(`导出失败：${res.exportError}`)
  }
  if (res.exportedFiles.length > 0) parts.push(`已导出 ${res.exportedFiles.length} 个文件`)
  if (res.exportFailures.length > 0) {
    failed = true
    parts.push(`${res.exportFailures.length} 个文件未导出：${res.exportFailures[0].error}`)
  }
  return {
    failed,
    title: `已识别 ${res.recognizedCount} 张图片`,
    message: parts.join('；')
  }
}

export function OcrCommand() {
  const isRealHost = isRealElectronHost()
  const [searchText, setSearchText] = useState('')
  const [languageModelId, setLanguageModelId] = useState<string>(OCR_LANGUAGE_MODELS[0].id)
  const [layoutStrategy, setLayoutStrategy] = useState<OcrLayoutStrategy>('natural_paragraph')
  const [postAction, setPostAction] = useState<OcrPostAction>('copy_clipboard')
  const [filterStampNoise, setFilterStampNoise] = useState<boolean>(true)
  const [items, setItems] = useState<OcrQueueItem[]>([])
  const [checkedIds, setCheckedIds] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(isRealHost)
  const [statusText, setStatusText] = useState<string>(isRealHost ? '' : NOT_IN_CLIENT_MESSAGE)
  const busy = useRef(false)

  async function refreshWorkspace(showIndicator = false) {
    if (!isRealHost) return
    setIsLoading(true)
    try {
      const ws = await fetchOcrWorkspace()
      setItems(ws.items)
      setCheckedIds(ws.items.map(i => i.id))
      if (ws.error) {
        setStatusText(`扫描失败：${ws.error}`)
        await showToast({ style: Toast.Style.Failure, title: '扫描图片失败', message: ws.error })
        return
      }
      setStatusText('')
      if (showIndicator) {
        await showToast({
          style: Toast.Style.Success,
          title: '已重新扫描',
          message: `找到 ${ws.items.length} 张图片`
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setStatusText(`扫描失败：${message}`)
      await showToast({ style: Toast.Style.Failure, title: '扫描图片失败', message })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void refreshWorkspace(false)
  }, [])

  const activeLanguage = resolveOcrLanguage(languageModelId)

  async function runExclusive(task: () => Promise<void>) {
    if (busy.current) return
    busy.current = true
    setIsLoading(true)
    try {
      await task()
    } finally {
      busy.current = false
      setIsLoading(false)
    }
  }

  async function handleRunBatchOcr() {
    if (!isRealHost) {
      await showToast({ style: Toast.Style.Failure, title: NOT_IN_CLIENT_MESSAGE })
      return
    }
    await runExclusive(async () => {
      const selected = items.filter(i => checkedIds.includes(i.id))
      const res = await executeBatchOcr(selected, {
        languageModelId,
        layoutStrategy,
        postAction,
        filterStampNoise
      })
      if (res.items.length > 0) {
        const byId = new Map(res.items.map(i => [i.id, i]))
        setItems(prev => prev.map(i => byId.get(i.id) || i))
      }
      const summary = describeOcrBatchResult(res)
      setStatusText(summary.message ? `${summary.title}：${summary.message}` : summary.title)
      await showToast({
        style: summary.failed ? Toast.Style.Failure : Toast.Style.Success,
        title: summary.title,
        message: summary.message
      })
    })
  }

  async function handleCaptureScreenOcr() {
    if (!isRealHost) {
      await showToast({ style: Toast.Style.Failure, title: NOT_IN_CLIENT_MESSAGE })
      return
    }
    await runExclusive(async () => {
      const res = await captureScreenAreaOcr(languageModelId)
      if (!res.ok) {
        await showToast({ style: Toast.Style.Failure, title: '截屏识别失败', message: res.error })
        return
      }
      if (!res.copied) {
        await showToast({ style: Toast.Style.Failure, title: res.error || '写入剪贴板失败', message: res.text.slice(0, 64) })
        return
      }
      await showToast({ style: Toast.Style.Success, title: '已识别截图文字并复制', message: res.text.slice(0, 64) })
    })
  }

  async function handleCopyItemText(item: OcrQueueItem) {
    try {
      await Clipboard.copy(item.recognizedText)
      await showToast({ style: Toast.Style.Success, title: `已复制 ${item.name} 的识别结果` })
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: '复制失败',
        message: err instanceof Error ? err.message : String(err)
      })
    }
  }

  async function handleShowInFolder(item: OcrQueueItem) {
    const ok = await openOcrFileLocation(item.path)
    if (!ok) {
      await showToast({ style: Toast.Style.Failure, title: '无法在资源管理器中显示', message: item.path })
    }
  }

  const selectedItems = items.filter(i => checkedIds.includes(i.id))
  const totalBytes = selectedItems.reduce((s, i) => s + i.sizeBytes, 0)
  const q = searchText.trim().toLowerCase()
  const filteredItems = items.filter(
    i =>
      !q ||
      i.name.toLowerCase().includes(q) ||
      i.path.toLowerCase().includes(q) ||
      i.recognizedText.toLowerCase().includes(q)
  )

  const maxImgBytes = Math.max(1, ...filteredItems.map(i => i.sizeBytes))
  const rightQueueItems = filteredItems.map(item => {
    const isChecked = checkedIds.includes(item.id)
    const volRatio = Math.max(10, Math.min(100, Math.round((item.sizeBytes / maxImgBytes) * 100)))
    const subtitle =
      item.status === 'recognized'
        ? item.recognizedText.replace(/\s+/g, ' ').slice(0, 65)
        : item.status === 'failed'
          ? `识别失败：${item.error || '未知原因'}`
          : item.parentDir

    return List.Item({
      id: item.id,
      title: item.name,
      subtitle,
      checkable: true,
      checked: isChecked,
      onCheckChange: c => {
        if (c) {
          setCheckedIds(Array.from(new Set([...checkedIds, item.id])))
        } else {
          setCheckedIds(checkedIds.filter(id => id !== item.id))
        }
      },
      icon: {
        source: Icon.Text
      },
      accessories: [
        { progress: { value: volRatio } },
        ...(item.status === 'pending' ? [] : [{ tag: { value: item.status === 'recognized' ? '已识别' : '识别失败' } }]),
        { text: formatBytes(item.sizeBytes) }
      ],
      actions: ActionPanel({
        title: item.name,
        children: [
          Action({
            title: `识别已勾选的 ${selectedItems.length} 张图片`,
            icon: Icon.Text,
            onAction: handleRunBatchOcr
          }),
          Action({
            title: '截取主屏幕并识别',
            icon: Icon.Camera,
            onAction: handleCaptureScreenOcr
          }),
          ...(item.status === 'recognized'
            ? [
                Action({
                  title: '复制这张图片的识别结果',
                  icon: Icon.CopyClipboard,
                  onAction: () => handleCopyItemText(item)
                })
              ]
            : []),
          Action({
            title: '在资源管理器中显示',
            icon: Icon.Folder,
            onAction: () => handleShowInFolder(item)
          })
        ]
      })
    })
  })

  return List({
    searchBarPlaceholder: '搜索图片文件名、路径或识别结果',
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    isLoading,
    searchBarAccessory: List.Dropdown({
      tooltip: '识别语言',
      value: languageModelId,
      onChange: val => setLanguageModelId(val),
      children: OCR_LANGUAGE_MODELS.map(m =>
        List.Dropdown.Item({
          title: `识别语言：${m.title}`,
          value: m.id
        })
      )
    }),
    filterBar: FilterBar({
      summaryText:
        statusText || `已选 ${selectedItems.length}/${items.length} 张图片（${formatBytes(totalBytes)}）`,
      actions: isRealHost
        ? [
            {
              id: 'rescan-ocr',
              label: '重新扫描',
              title: '重新扫描',
              style: 'secondary',
              onAction: () => refreshWorkspace(true)
            }
          ]
        : []
    }),
    workbenchPanel: {
      title: '图片识字',
      subtitle: `识别语言：${activeLanguage.title}（需安装对应的 Windows OCR 语言包）`,
      fields: [
        {
          id: 'wb-ocr-layout',
          label: '结果排版',
          type: 'select',
          value: layoutStrategy,
          onChange: val => setLayoutStrategy(val as OcrLayoutStrategy),
          options: [
            { label: '保持识别出的分行（多张时按文件分段）', value: 'natural_paragraph' },
            { label: '合并为单行纯文本', value: 'single_line' },
            { label: '按文件汇总为 Markdown 表格', value: 'markdown_table' }
          ]
        },
        {
          id: 'wb-ocr-post',
          label: '识别后',
          type: 'select',
          value: postAction,
          onChange: val => setPostAction(val as OcrPostAction),
          options: (Object.keys(POST_ACTION_LABELS) as OcrPostAction[]).map(value => ({
            label: POST_ACTION_LABELS[value],
            value
          }))
        },
        {
          id: 'wb-ocr-stamp',
          label: '删除页码行和印章文字行',
          type: 'toggle',
          value: filterStampNoise,
          onChange: val => setFilterStampNoise(Boolean(val))
        },
        {
          id: 'wb-ocr-runtime',
          label: '识别方式',
          type: 'info',
          value: 'Windows 系统文字识别，在本机完成'
        }
      ],
      previewCard: {
        title: `已选 ${selectedItems.length} 张图片`,
        subtitle: `${formatBytes(totalBytes)} · 识别后${POST_ACTION_LABELS[postAction]}`
      }
    },
    subList: {
      title: '待识别图片',
      subtitle: `${filteredItems.length} 张图片 · 已选 ${selectedItems.length} 张`,
      checkable: filteredItems.length > 0,
      checked:
        filteredItems.length > 0 && filteredItems.every(i => checkedIds.includes(i.id))
          ? true
          : filteredItems.some(i => checkedIds.includes(i.id))
            ? 'indeterminate'
            : false,
      onCheckChange: checked => {
        setCheckedIds(checked ? filteredItems.map(i => i.id) : [])
      },
      emptyText: isRealHost ? '没有找到待识别的图片' : NOT_IN_CLIENT_MESSAGE,
      items: rightQueueItems
    },
    children: [
      List.Section({
        title: `待识别图片 (${filteredItems.length})`,
        children: rightQueueItems
      })
    ]
  })
}

export default OcrCommand
