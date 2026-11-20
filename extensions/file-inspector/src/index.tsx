import React, {
  Action,
  ActionPanel,
  Icon,
  List,
  Toast,
  showToast,
  useEffect,
  useLocale,
  useMemo,
  useRef,
  useState
} from '@ztools/declarative-ui'
import { t } from './i18n.js'
import {
  convertTextBufferEncoding,
  fixFileExtension,
  inspectFileFromBuffer,
  pickAndReadLocalFile,
  readDroppedLocalFile,
  saveConvertedTextFile
} from './inspector-service.js'
import { createCompatFileInputProps, isDeclarativeFileInputSupported } from './host-compat.js'
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
  const locale = useLocale()
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
  }, [rawBytes, selectedFilePath, props.initialDiagnostic, previewEncoding, locale])

  const busy = useRef(false)
  const alive = useRef(true)

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

  const handleFilesDropped = (envelopeOrPayload: unknown) => {
    void runOperation(async () => {
      const res = await readDroppedLocalFile(envelopeOrPayload, props.hostOverride)
      if (!alive.current || res.canceled) return
      if (!res.ok || !res.bytes || !res.filePath) throw new Error(res.error || t('errReadFileFailed'))
      setSelectedFilePath(res.filePath)
      setPreviewEncoding('auto')
      setRawBytes(res.bytes)
      setSearchText('')
      await showToast({ style: Toast.Style.Success, title: t('toastLoadedFile', { bytes: res.bytes.byteLength }) })
    })
  }

  useEffect(() => {
    alive.current = true
    if (isDeclarativeFileInputSupported()) {
      return () => {
        alive.current = false
      }
    }
    const events = (globalThis as {
      window?: {
        ztools?: {
          events?: {
            on?: (event: string, cb: (payload: unknown) => void) => (() => void) | void
            off?: (event: string, cb: (payload: unknown) => void) => void
          }
        }
      }
    }).window?.ztools?.events
    const dispose = events && typeof events.on === 'function' ? events.on('plugin_files_dropped', handleFilesDropped) : undefined
    return () => {
      alive.current = false
      if (typeof dispose === 'function') dispose()
      else if (events && typeof events.off === 'function') events.off('plugin_files_dropped', handleFilesDropped)
    }
  }, [])

  const fileInputProps = createCompatFileInputProps((_files, payload) => {
    handleFilesDropped(payload)
  })

  const handlePickFile = () => runOperation(async () => {
    const res = await pickAndReadLocalFile(props.hostOverride)
    if (!alive.current || res.canceled) return
    if (!res.ok || !res.bytes || !res.filePath) throw new Error(res.error || t('errReadFileFailed'))
    setSelectedFilePath(res.filePath)
    setPreviewEncoding('auto')
    setRawBytes(res.bytes)
    setSearchText('')
    await showToast({ style: Toast.Style.Success, title: t('toastLoadedFile', { bytes: res.bytes.byteLength }) })
  })

  const filteredLines = useMemo(() => {
    const lines = fileInfo?.previewLines ?? []
    const q = searchText.trim().toLowerCase()
    if (!q) return lines
    return lines.filter((l) => l.text.toLowerCase().includes(q))
  }, [fileInfo, searchText])

  const handleConvertToUtf8Bom = () => runOperation(async () => {
    if (!fileInfo?.isText || !rawBytes) throw new Error(t('errSelectTextFileFirst'))
    const converted = convertTextBufferEncoding(
      rawBytes, previewEncoding === 'auto' ? fileInfo.detectedEncoding : previewEncoding,
      'utf-8-bom', lineEndingTarget
    )
    const res = await saveConvertedTextFile(fileInfo.filePath, converted, props.hostOverride)
    if (!alive.current || res.canceled) return
    if (!res.ok) throw new Error(res.error || t('errSaveConvertedFailed'))
    await showToast({ style: Toast.Style.Success, title: t('toastConvertedSaved'), message: res.outputPath })
  })

  const handleFixExtension = () => runOperation(async () => {
    if (!fileInfo?.extensionMismatch) return
    const res = await fixFileExtension(fileInfo.filePath, fileInfo.realExtension, props.hostOverride)
    if (!alive.current || res.canceled) return
    if (!res.ok || !res.newPath) throw new Error(res.error || t('errFixExtensionFailed'))
    setSelectedFilePath(res.newPath)
    await showToast({ style: Toast.Style.Success, title: t('toastFixedExtension', { ext: fileInfo.realExtension }) })
  })

  const pickAction = <Action key="pick" title={fileInfo ? t('actionPickOtherFile') : t('actionPickFileEllipsis')} icon={Icon.Folder} onAction={handlePickFile} />
  const bomAction = fileInfo?.isText
    ? <Action key="bom" title={t('actionSaveUtf8Bom')} icon={Icon.CheckCircle} onAction={handleConvertToUtf8Bom} />
    : null
  const extAction = fileInfo?.extensionMismatch
    ? <Action key="ext" title={t('actionFixExt', { ext: fileInfo.realExtension })} icon={Icon.Pencil} onAction={handleFixExtension} />
    : null
  // 按命令决定主动作：转码命令把“另存为 UTF-8-BOM”放第一位，扩展名命令把“修正扩展名”放第一位；还没有可执行的操作时主动作是选择文件
  const preferred = mode === 'file-fix-extension' ? [extAction, bomAction] : [bomAction, extAction]
  const globalActions = [...preferred, pickAction].filter(Boolean)
  const primaryRow = preferred.find(Boolean)
  const primaryRowTitle = primaryRow ? String(primaryRow.props.title) : ''
  const idleHint = mode === 'file-fix-csv-bom'
    ? t('idleHintBom')
    : mode === 'file-fix-extension'
      ? t('idleHintExt')
      : t('idleHintDefault')

  return (
    <List
      {...fileInputProps}
      navigationTitle={t('navTitle')}
      isLoading={isLoading}
      isShowingDetail={false}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder={t('searchPlaceholder')}
      actions={<ActionPanel>{globalActions}</ActionPanel>}
      filterBar={{
        summaryText: fileInfo
          ? t('summaryText', {
              mime: fileInfo.realMimeType,
              extStatus: fileInfo.extensionMismatch ? t('extMismatchText', { ext: fileInfo.realExtension }) : t('extMatchText'),
              encoding: fileInfo.detectedEncoding,
              basis: fileInfo.detectionBasis,
              eol: fileInfo.lineEnding
            })
          : idleHint,
        actions: [
          {
            id: 'pick-file',
            title: t('btnSelectFile'),
            onAction: () => {
              void handlePickFile()
            }
          }
        ]
      }}
      workbenchPanel={{
        title: fileInfo ? fileInfo.fileName : t('wbNoFileTitle'),
        subtitle: fileInfo ? fileInfo.filePath : t('wbNoFileSub'),
        fields: [
          {
            id: 'previewEncoding',
            label: t('fieldEncodingLabel'),
            type: 'select',
            value: previewEncoding,
            options: [
              { label: t('optAuto'), value: 'auto' },
              { label: t('optUtf8'), value: 'UTF-8' },
              { label: t('optGbk'), value: 'GBK' },
              { label: t('optBig5'), value: 'Big5' },
              { label: 'UTF-16LE', value: 'UTF-16LE' }
            ],
            onChange: (val: unknown) => setPreviewEncoding(String(val))
          },
          {
            id: 'lineEndingTarget',
            label: t('fieldEolLabel'),
            type: 'select',
            value: lineEndingTarget,
            options: [
              { label: t('optCrlf'), value: 'CRLF' },
              { label: t('optLf'), value: 'LF' }
            ],
            onChange: (val: unknown) => setLineEndingTarget(val as 'CRLF' | 'LF')
          },
          {
            id: 'magicHex',
            label: t('fieldMagicLabel'),
            type: 'info',
            value: fileInfo?.hexHeaderPreview || t('waitingRead')
          },
          {
            id: 'mimeInfo',
            label: t('fieldMimeLabel'),
            type: 'info',
            value: fileInfo
              ? `${fileInfo.realMimeType} (.${fileInfo.realExtension})`
              : t('notLoaded')
          }
        ],
        previewCard: {
          title: !fileInfo ? t('cardWaitingTitle') : fileInfo.extensionMismatch
            ? t('cardMismatchTitle', { cur: fileInfo.currentExtension, real: fileInfo.realExtension })
            : fileInfo?.isText
              ? t('cardTextTitle', { encoding: fileInfo.detectedEncoding, eol: fileInfo.lineEnding })
              : t('cardBinaryTitle'),
          subtitle: fileInfo
            ? t('cardFileSub', { kb: (fileInfo.fileSize / 1024).toFixed(1), basis: fileInfo.detectionBasis })
            : t('cardIdleSub')
        }
      }}
      subList={{
        title: t('subListTitle', { count: filteredLines.length }),
        subtitle: primaryRowTitle
          ? t('subListSubPrimary', { action: primaryRowTitle })
          : fileInfo && !fileInfo.isText ? t('subListSubBinary') : undefined,
        emptyText: fileInfo?.fileSize === 0 ? t('emptyZeroBytes') : fileInfo ? t('emptyNoMatchLines') : t('emptyIdle'),
        items: filteredLines.map((line) => (
          <List.Item
            key={`line-${line.lineNumber}`}
            id={`line-${line.lineNumber}`}
            title={line.text || t('emptyLineLabel')}
            icon={Icon.Text}
            accessories={[
              fileInfo?.extensionMismatch && line.lineNumber === 1
                ? { tag: t('tagShouldBeExt', { ext: fileInfo.realExtension }) }
                : { tag: `L${line.lineNumber}` }
            ]}
            actions={
              <ActionPanel>
                {preferred.filter(Boolean)}
                <Action.CopyToClipboard title={t('actionCopyLine')} content={line.text} />
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
