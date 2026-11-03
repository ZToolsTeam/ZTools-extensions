import React, {
  Action,
  ActionPanel,
  Icon,
  List,
  Toast,
  showToast,
  useEffect,
  useMemo,
  useRef,
  useState
} from '@ztools/declarative-ui'
import {
  convertTextBufferEncoding,
  fixFileExtension,
  inspectFileFromBuffer,
  pickAndReadLocalFile,
  saveConvertedTextFile
} from './inspector-service.js'
import type { FileDiagnosticResult } from './types.js'

export * from './types.js'
export * from './inspector-service.js'

/** 三个命令：工作台、CSV 转 UTF-8-BOM、修正扩展名；后两个命令把对应操作放到主动作 */
export type FileInspectorMode = 'file-inspector-workbench' | 'file-fix-csv-bom' | 'file-fix-extension'

const isMacPlatform = () => {
  try {
    const nav = (globalThis as { navigator?: { platform?: string; userAgent?: string } }).navigator
    return /Mac/i.test(nav?.platform || nav?.userAgent || '')
  } catch {
    return false
  }
}

/** 换行符默认值跟随当前系统：macOS 用 LF，Windows 用 CRLF */
export const defaultLineEnding = (): 'CRLF' | 'LF' => (isMacPlatform() ? 'LF' : 'CRLF')

export interface FileInspectorCommandProps {
  featureCode?: string
  initialDiagnostic?: FileDiagnosticResult | null
  initialRawBytes?: Uint8Array
  hostOverride?: unknown
}

export function FileInspectorCommand(props: FileInspectorCommandProps = {}) {
  const [rawBytes, setRawBytes] = useState<Uint8Array | null>(props.initialRawBytes ?? null)
  const [selectedFilePath, setSelectedFilePath] = useState<string>(
    props.initialDiagnostic?.filePath || ''
  )
  const [previewEncoding, setPreviewEncoding] = useState<string>(
    'auto'
  )
  const mode: FileInspectorMode = props.featureCode === 'file-fix-csv-bom' || props.featureCode === 'file-fix-extension'
    ? props.featureCode
    : 'file-inspector-workbench'
  const [lineEndingTarget, setLineEndingTarget] = useState<'CRLF' | 'LF'>(defaultLineEnding)
  const [searchText, setSearchText] = useState<string>('')
  const [isLoading, setIsLoading] = useState<boolean>(false)

  const fileInfo = useMemo<FileDiagnosticResult | null>(() => {
    if (rawBytes) {
      return inspectFileFromBuffer(
        rawBytes,
        selectedFilePath,
        previewEncoding === 'auto' ? undefined : previewEncoding
      )
    }
    return props.initialDiagnostic ?? null
  }, [rawBytes, selectedFilePath, props.initialDiagnostic, previewEncoding])

  const busy = useRef(false)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const runOperation = async (operation: () => Promise<void>) => {
    if (busy.current || !alive.current) return
    busy.current = true
    setIsLoading(true)
    try {
      await operation()
    } catch (error) {
      if (alive.current) await showToast({
        style: Toast.Style.Failure,
        title: error instanceof Error ? error.message : String(error)
      })
    } finally {
      busy.current = false
      if (alive.current) setIsLoading(false)
    }
  }

  const handlePickFile = () => runOperation(async () => {
    const res = await pickAndReadLocalFile(props.hostOverride)
    if (!alive.current || res.canceled) return
    if (!res.ok || !res.bytes || !res.filePath) throw new Error(res.error || '读取文件失败')
    setSelectedFilePath(res.filePath)
    setPreviewEncoding('auto')
    setRawBytes(res.bytes)
    setSearchText('')
    await showToast({ style: Toast.Style.Success, title: `已载入文件 (${res.bytes.byteLength} 字节)` })
  })

  const filteredLines = useMemo(() => {
    const lines = fileInfo?.previewLines ?? []
    const q = searchText.trim().toLowerCase()
    if (!q) return lines
    return lines.filter((l) => l.text.toLowerCase().includes(q))
  }, [fileInfo, searchText])

  const handleConvertToUtf8Bom = () => runOperation(async () => {
    if (!fileInfo?.isText || !rawBytes) throw new Error('请先选择完整的文本文件，二进制文件或空文件不能转码')
    const converted = convertTextBufferEncoding(
      rawBytes, previewEncoding === 'auto' ? fileInfo.detectedEncoding : previewEncoding,
      'utf-8-bom', lineEndingTarget
    )
    const res = await saveConvertedTextFile(fileInfo.filePath, converted, props.hostOverride)
    if (!alive.current || res.canceled) return
    if (!res.ok) throw new Error(res.error || '转码保存失败')
    await showToast({ style: Toast.Style.Success, title: '转码文件已保存', message: res.outputPath })
  })

  const handleFixExtension = () => runOperation(async () => {
    if (!fileInfo?.extensionMismatch) return
    const res = await fixFileExtension(fileInfo.filePath, fileInfo.realExtension, props.hostOverride)
    if (!alive.current || res.canceled) return
    if (!res.ok || !res.newPath) throw new Error(res.error || '修正扩展名失败')
    setSelectedFilePath(res.newPath)
    await showToast({ style: Toast.Style.Success, title: `已把扩展名改为 .${fileInfo.realExtension}` })
  })

  const pickAction = <Action key="pick" title={fileInfo ? '选择其他文件…' : '选择文件…'} icon={Icon.Folder} onAction={handlePickFile} />
  const bomAction = fileInfo?.isText
    ? <Action key="bom" title="另存为 UTF-8-BOM" icon={Icon.CheckCircle} onAction={handleConvertToUtf8Bom} />
    : null
  const extAction = fileInfo?.extensionMismatch
    ? <Action key="ext" title={`修正扩展名为 .${fileInfo.realExtension}`} icon={Icon.Pencil} onAction={handleFixExtension} />
    : null
  // 按命令决定主动作：转码命令把“另存为 UTF-8-BOM”放第一位，扩展名命令把“修正扩展名”放第一位；还没有可执行的操作时主动作是选择文件
  const preferred = mode === 'file-fix-extension' ? [extAction, bomAction] : [bomAction, extAction]
  const globalActions = [...preferred, pickAction].filter(Boolean)
  const primaryRow = preferred.find(Boolean)
  const primaryRowTitle = primaryRow ? String(primaryRow.props.title) : ''
  const idleHint = mode === 'file-fix-csv-bom'
    ? '选择 CSV 或文本文件，另存为 UTF-8-BOM，Excel 打开不再乱码'
    : mode === 'file-fix-extension'
      ? '选择文件，按文件头识别真实格式并修正扩展名'
      : '选择文件后按文件头识别真实格式，并检查文本编码和换行符'

  return (
    <List
      navigationTitle="文件透视与转码"
      isLoading={isLoading}
      isShowingDetail={false}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="搜索文本前 100 行预览内容"
      actions={<ActionPanel>{globalActions}</ActionPanel>}
      filterBar={{
        summaryText: fileInfo
          ? `真实类型: ${fileInfo.realMimeType}（${fileInfo.extensionMismatch ? `扩展名不符，应为 .${fileInfo.realExtension}` : '扩展名一致'}）· 编码: ${fileInfo.detectedEncoding}（${fileInfo.detectionBasis}）· 换行符: ${fileInfo.lineEnding}`
          : idleHint,
        actions: [
          {
            id: 'pick-file',
            title: '选择文件',
            onAction: () => {
              void handlePickFile()
            }
          }
        ]
      }}
      workbenchPanel={{
        title: fileInfo ? fileInfo.fileName : '未选择文件',
        subtitle: fileInfo ? fileInfo.filePath : '识别 PNG、JPEG、WebP、AVIF、GIF、PDF、ZIP 文件头；文本可另存为 UTF-8-BOM',
        fields: [
          {
            id: 'previewEncoding',
            label: '读取与转码字符集',
            type: 'select',
            value: previewEncoding,
            options: [
              { label: '自动探测（UTF-8 / GBK）', value: 'auto' },
              { label: 'UTF-8（无 BOM）', value: 'UTF-8' },
              { label: 'GBK / GB18030（简体中文）', value: 'GBK' },
              { label: 'Big5（繁体中文）', value: 'Big5' },
              { label: 'UTF-16LE', value: 'UTF-16LE' }
            ],
            onChange: (val: unknown) => setPreviewEncoding(String(val))
          },
          {
            id: 'lineEndingTarget',
            label: '目标换行符规范',
            type: 'select',
            value: lineEndingTarget,
            options: [
              { label: 'CRLF（Windows）', value: 'CRLF' },
              { label: 'LF（macOS / Linux）', value: 'LF' }
            ],
            onChange: (val: unknown) => setLineEndingTarget(val as 'CRLF' | 'LF')
          },
          {
            id: 'magicHex',
            label: '文件头字节',
            type: 'info',
            value: fileInfo?.hexHeaderPreview || '等待读取'
          },
          {
            id: 'mimeInfo',
            label: '真实 MIME 与扩展名',
            type: 'info',
            value: fileInfo
              ? `${fileInfo.realMimeType} (.${fileInfo.realExtension})`
              : '未载入'
          }
        ],
        previewCard: {
          title: !fileInfo ? '等待读取文件' : fileInfo.extensionMismatch
            ? `扩展名为 .${fileInfo.currentExtension}，文件头显示是 .${fileInfo.realExtension} 格式`
            : fileInfo?.isText
              ? `字符编码: ${fileInfo.detectedEncoding} · 换行符: ${fileInfo.lineEnding}`
              : '二进制文件，不提供文本转码',
          subtitle: fileInfo
            ? `文件大小 ${(fileInfo.fileSize / 1024).toFixed(1)} KB · ${fileInfo.detectionBasis}`
            : '选择文件后显示前 100 行，转码时保存完整内容'
        }
      }}
      subList={{
        title: `文本前 100 行预览（${filteredLines.length} 行）`,
        subtitle: primaryRowTitle
          ? `按 Enter ${primaryRowTitle}，或复制单行文本`
          : fileInfo && !fileInfo.isText ? '根据文件头识别格式，不对二进制文件进行文本转码' : undefined,
        emptyText: fileInfo?.fileSize === 0 ? '空文件，没有可预览或转码的内容' : fileInfo ? '没有匹配的预览行' : '请先选择需要透视或转码的本地文件',
        items: filteredLines.map((line) => (
          <List.Item
            key={`line-${line.lineNumber}`}
            id={`line-${line.lineNumber}`}
            title={line.text || '(空行)'}
            icon={Icon.Text}
            accessories={[
              fileInfo?.extensionMismatch && line.lineNumber === 1
                ? { tag: `应为 .${fileInfo.realExtension}` }
                : { tag: `L${line.lineNumber}` }
            ]}
            actions={
              <ActionPanel>
                {preferred.filter(Boolean)}
                <Action.CopyToClipboard title="复制该行文本" content={line.text} />
              </ActionPanel>
            }
          />
        ))
      }}
    />
  )
}

export default FileInspectorCommand

export const commands = {
  'file-inspector-workbench': () => FileInspectorCommand({ featureCode: 'file-inspector-workbench' }),
  'file-fix-csv-bom': () => FileInspectorCommand({ featureCode: 'file-fix-csv-bom' }),
  'file-fix-extension': () => FileInspectorCommand({ featureCode: 'file-fix-extension' })
}
