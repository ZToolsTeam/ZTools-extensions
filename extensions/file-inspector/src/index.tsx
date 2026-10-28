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
  const [lineEndingTarget, setLineEndingTarget] = useState<'CRLF' | 'LF'>('CRLF')
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

  return (
    <List
      navigationTitle="文件透视与转码"
      isLoading={isLoading}
      isShowingDetail={false}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="搜索文本前 100 行解码预览内容..."
      filterBar={{
        summaryText: fileInfo
          ? `真实类型: ${fileInfo.realMimeType}（${fileInfo.extensionMismatch ? `扩展名不符，应为 .${fileInfo.realExtension}` : '扩展名一致'}）· 编码: ${fileInfo.detectedEncoding}（${fileInfo.detectionBasis}）· 换行符: ${fileInfo.lineEnding}`
          : '选择文件后按文件头识别真实格式，并检查文本编码和换行符',
        actions: [
          {
            id: 'pick-file',
            title: '选择本地文件',
            onAction: () => {
              void handlePickFile()
            }
          }
        ]
      }}
      workbenchPanel={{
        title: fileInfo ? fileInfo.fileName : '请选择需要透视与转码的文件',
        subtitle: fileInfo ? fileInfo.filePath : '识别 PNG、JPEG、WebP、AVIF、GIF、PDF、ZIP 文件头；文本可另存为 UTF-8-BOM',
        fields: [
          {
            id: 'previewEncoding',
            label: '读取与转码字符集',
            type: 'select',
            value: previewEncoding,
            options: [
              { label: '自动探测 (UTF-8 / GBK)', value: 'auto' },
              { label: 'UTF-8 (标准无 BOM)', value: 'UTF-8' },
              { label: 'GBK / GB18030 (国标中文)', value: 'GBK' },
              { label: 'Big5 (繁体中文)', value: 'Big5' },
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
              { label: 'Windows 标准 (CRLF)', value: 'CRLF' },
              { label: 'Unix / macOS 标准 (LF)', value: 'LF' }
            ],
            onChange: (val: unknown) => setLineEndingTarget(val as 'CRLF' | 'LF')
          },
          {
            id: 'magicHex',
            label: '文件头魔数 (Magic Bytes)',
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
        title: `文本前 100 行安全解码预览 (${filteredLines.length} 行)`,
        subtitle: fileInfo?.isText ? '按 Enter 另存为 UTF-8-BOM，或复制单行文本' : '根据文件头识别格式，不对二进制文件进行文本转码',
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
                {fileInfo?.isText && <Action
                  title="另存为 UTF-8-BOM"
                  icon={Icon.CheckCircle}
                  onAction={handleConvertToUtf8Bom}
                />}
                {fileInfo?.extensionMismatch && <Action
                  title={`修正扩展名为 .${fileInfo?.realExtension || 'txt'}`}
                  icon={Icon.Pencil}
                  onAction={handleFixExtension}
                />}
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
