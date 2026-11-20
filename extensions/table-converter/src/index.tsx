import React, { Action, ActionPanel, Clipboard, Icon, List, Toast, showToast, useEffect, useLocale, useMemo, useState, useRef, useNavigation } from '@ztools/declarative-ui'
import { buildAllConversionTargets, detectAndParse, fencedPreview } from './table-service.js'
import { TableInputForm } from './input-form.js'
import { createCompatFileInputProps } from './host-compat.js'
import type { SourceFormat } from './types.js'
import { t } from './i18n.js'
export * from './types.js'
export * from './table-service.js'

let tableFileSeq = 0

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readTableFileFromHost(filePath: string): Promise<string> {
  const g = globalThis as {
    window?: { __ztoolsElectron?: { transport?: { methods?: Record<string, unknown> } } }
    __ztoolsElectron?: { transport?: { methods?: Record<string, unknown> } }
  }
  const methods = g.window?.__ztoolsElectron?.transport?.methods ?? g.__ztoolsElectron?.transport?.methods
  const fn = methods?.filesystem_read_file
  if (typeof fn !== 'function') {
    throw new Error(t('errHostNoReadFile'))
  }
  tableFileSeq = (tableFileSeq + 1) % 1_000_000
  const raw = await (fn as (req: Record<string, unknown>) => Promise<unknown>)({
    messageId: `table_file_${Date.now()}_${tableFileSeq}`,
    params: { path: filePath, encoding: 'utf8' }
  })
  if (isRecord(raw) && raw.success === false) {
    const err = raw.error
    const msg = isRecord(err) ? String(err.message || err.code || t('errReadFileFailed')) : String(err || t('errReadFileFailed'))
    throw new Error(msg)
  }
  const data = isRecord(raw) && 'data' in raw ? raw.data : raw
  if (typeof data === 'string') return data
  if (isRecord(data) && typeof data.content === 'string') return data.content
  throw new Error(t('errReadFileInvalid'))
}

export interface TableConverterCommandProps {
  featureCode?: string
  initialRawText?: string
  initialHeaderMode?: 'first-row-header' | 'no-header'
  initialSqlTableName?: string
  initialSourceFormat?: SourceFormat
}

/** 空状态说明：按入口写明目标，没有专门入口时列出全部输出格式 */
export function featureGoal(featureCode?: string): string {
  switch (featureCode) {
    case 'table-to-markdown': return t('goalMarkdown')
    case 'table-to-json': return t('goalJson')
    case 'table-to-sql': return t('goalSql')
    default: return t('goalDefault')
  }
}

export function TableConverterCommand(props: TableConverterCommandProps = {}) {
  const locale = useLocale()
  const [rawText, setRawText] = useState(props.initialRawText ?? '')
  const [headerMode, setHeaderMode] = useState(props.initialHeaderMode ?? 'first-row-header')
  const [sqlTableName, setSqlTableName] = useState(props.initialSqlTableName ?? 'my_table')
  const [source, setSource] = useState<SourceFormat>(props.initialSourceFormat ?? 'auto')
  const [searchText, setSearchText] = useState('')
  const [isReading, setIsReading] = useState(false)
  const [readErrorKey, setReadErrorKey] = useState<'' | 'clipboard' | 'file'>('')
  const generation = useRef(0), alive = useRef(true)
  const { push } = useNavigation()
  useEffect(() => () => { alive.current = false; generation.current++ }, [])

  const handleReadClipboard = async () => {
    const request = ++generation.current
    setIsReading(true); setReadErrorKey('')
    try {
      const text = await Clipboard.readText()
      if (!alive.current || request !== generation.current) return
      setRawText(text ?? '')
      // 读取成功不等于转换成功；无效输入仍保存，供编辑修正。
    } catch (error) {
      if (!alive.current || request !== generation.current) return
      const message = error instanceof Error ? error.message : String(error)
      setReadErrorKey('clipboard')
      await showToast({ style: Toast.Style.Failure, title: t('toastClipboardReadFailed'), message })
    } finally {
      if (alive.current && request === generation.current) setIsReading(false)
    }
  }

  useEffect(() => {
    if (props.initialRawText === undefined) void handleReadClipboard()
  }, [props.featureCode])

  const result = useMemo(() => {
    try {
      const parsed = detectAndParse(rawText, headerMode === 'first-row-header', source)
      const targets = parsed.format === 'empty' || parsed.format === 'unrecognized' ? [] : buildAllConversionTargets(parsed.grid, sqlTableName)
      return { parsed, targets, error: '' }
    } catch (error) {
      return { parsed: null, targets: [], error: error instanceof Error ? error.message : String(error) }
    }
  }, [rawText, headerMode, source, sqlTableName, locale])
  const preferred = props.featureCode?.replace('table-to-', '')
  const targets = [...result.targets].sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred))
    .filter(target => [target.id, target.title, target.subtitle].some(text => text.toLowerCase().includes(searchText.trim().toLowerCase())))
  const grid = result.parsed?.grid
  const summary = result.error ? t('summaryParseError') : result.parsed?.format === 'empty' ? '' : result.parsed?.format === 'unrecognized' ? t('summaryUnrecognized') : t('summaryDimensions', { format: result.parsed?.format.toUpperCase() ?? '', rows: grid?.rows.length ?? 0, cols: grid?.headers.length ?? 0 })
  const readError = readErrorKey === 'clipboard' ? t('errClipboardReadBanner') : readErrorKey === 'file' ? t('errFileReadBanner') : ''
  const editInput = () => {
    generation.current++; setIsReading(false)
    push(<TableInputForm initial={{ text: rawText, source, sqlTableName }} hasHeader={headerMode === 'first-row-header'} onApply={value => {
      if (!alive.current) return
      generation.current++; setRawText(value.text); setSource(value.source); setSqlTableName(value.sqlTableName); setReadErrorKey('')
    }} />)
  }

  const goal = featureGoal(props.featureCode)
  const inputActions = <ActionPanel>
    <Action title={t('actionReadClipboard')} icon={Icon.Clipboard} onAction={handleReadClipboard} />
    <Action title={t('actionEditInput')} icon={Icon.Pencil} onAction={editInput} />
  </ActionPanel>

  const fileInputProps = createCompatFileInputProps(
    async (files) => {
      const targetPath = files[0]?.trim()
      if (!targetPath) return
      const request = ++generation.current
      setIsReading(true); setReadErrorKey('')
      try {
        const content = await readTableFileFromHost(targetPath)
        if (!alive.current || request !== generation.current) return
        setSource('auto')
        setRawText(content)
      } catch (error) {
        if (!alive.current || request !== generation.current) return
        const message = error instanceof Error ? error.message : String(error)
        setReadErrorKey('file')
        await showToast({ style: Toast.Style.Failure, title: t('toastFileReadFailed'), message })
      } finally {
        if (alive.current && request === generation.current) setIsReading(false)
      }
    },
    {
      extensions: ['.csv', '.tsv', '.json', '.md', '.txt'],
      onTextPaste: (text) => {
        if (!alive.current || !text) return
        generation.current++
        setIsReading(false)
        setReadErrorKey('')
        setRawText(text)
      }
    }
  )

  return <List {...fileInputProps} navigationTitle={t('navTitle')} isLoading={isReading} isShowingDetail={true}
    searchText={searchText} onSearchTextChange={setSearchText} searchBarPlaceholder={t('searchPlaceholder')}
    searchBarAccessory={<List.Dropdown value={headerMode} onChange={value => setHeaderMode(value as typeof headerMode)} tooltip={t('headerModeTooltip')}>
      <List.Dropdown.Item title={t('headerFirstRow')} value="first-row-header" />
      <List.Dropdown.Item title={t('headerNoHeader')} value="no-header" />
    </List.Dropdown>}
    filterBar={{ summaryText: readError || summary, actions: [
      { id: 'read-clipboard', title: t('actionReadClipboard'), onAction: handleReadClipboard },
      { id: 'edit-input', title: t('actionEditInput'), onAction: editInput }
    ] }}>
    {!isReading && result.error ? <List.Item id="parse-error" title={t('itemParseErrorTitle')} subtitle={t('itemParseErrorSub')} actions={inputActions} detail={<List.Item.Detail markdown={fencedPreview(result.error, 'text')} />} /> : null}
    {!isReading && result.parsed?.format === 'unrecognized' ? <List.Item id="not-table" title={t('itemNotTableTitle')} subtitle={goal} actions={inputActions} detail={<List.Item.Detail markdown={goal} />} /> : null}
    {!isReading && !result.error && result.parsed?.format !== 'unrecognized' && !targets.length ? <List.Item id="empty-input" title={rawText ? t('itemNoMatchTitle') : t('itemWaitingTitle')} subtitle={goal} actions={inputActions} detail={<List.Item.Detail markdown={goal} />} /> : null}
    {!isReading && targets.map(target => <List.Item key={target.id} id={target.id} title={target.title} subtitle={target.subtitle}
      icon={Icon.Document} accessories={[{ tag: target.badge }]}
      detail={<List.Item.Detail markdown={target.error ? fencedPreview(target.error, 'text') : fencedPreview(target.previewText, target.language)}
        metadata={<List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label title={t('metaSizeTitle')} text={t('metaSizeText', { rows: grid?.rows.length ?? 0, cols: grid?.headers.length ?? 0 })} />
          <List.Item.Detail.Metadata.Label title={t('metaCharsTitle')} text={String(target.fullText.length)} />
          <List.Item.Detail.Metadata.Label title={t('metaTypesTitle')} text={target.typeSummary} />
          {grid?.warnings?.map((warning, i) => <List.Item.Detail.Metadata.Label key={i} title={t('metaHeaderTitle')} text={warning} />)}
        </List.Item.Detail.Metadata>} />}
      actions={target.error ? undefined : <ActionPanel>
        <Action.CopyToClipboard title={t('actionCopyResult')} content={target.fullText} icon={Icon.Clipboard} />
        <Action.Paste title={t('actionPasteResult')} content={target.fullText} icon={Icon.Text} shortcut={{ modifiers: ['cmd'], key: 'enter' }} />
      </ActionPanel>} />)}
  </List>
}
export const commands = {
  'table-auto': TableConverterCommand,
  'table-to-markdown': () => TableConverterCommand({ featureCode: 'table-to-markdown' }),
  'table-to-json': () => TableConverterCommand({ featureCode: 'table-to-json' }),
  'table-to-sql': () => TableConverterCommand({ featureCode: 'table-to-sql' })
}
export default TableConverterCommand
