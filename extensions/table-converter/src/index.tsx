import React, { Action, ActionPanel, Clipboard, Icon, List, Toast, showToast, useEffect, useMemo, useState, useRef, useNavigation } from '@ztools/declarative-ui'
import { buildAllConversionTargets, detectAndParse, fencedPreview } from './table-service.js'
import { TableInputForm } from './input-form.js'
import type { SourceFormat } from './types.js'
export * from './types.js'
export * from './table-service.js'

export interface TableConverterCommandProps {
  featureCode?: string
  initialRawText?: string
  initialHeaderMode?: 'first-row-header' | 'no-header'
  initialSqlTableName?: string
  initialSourceFormat?: SourceFormat
}

const FEATURE_GOALS: Record<string, string> = {
  'table-to-markdown': '粘贴表格后生成 Markdown 表格',
  'table-to-json': '粘贴表格后生成 JSON 对象数组',
  'table-to-sql': '粘贴表格后生成 SQL INSERT'
}

/** 空状态说明：按入口写明目标，没有专门入口时列出全部输出格式 */
export function featureGoal(featureCode?: string): string {
  return (featureCode && FEATURE_GOALS[featureCode]) || '粘贴表格后生成 Markdown、JSON、SQL、HTML 或 CSV'
}

export function TableConverterCommand(props: TableConverterCommandProps = {}) {
  const [rawText, setRawText] = useState(props.initialRawText ?? '')
  const [headerMode, setHeaderMode] = useState(props.initialHeaderMode ?? 'first-row-header')
  const [sqlTableName, setSqlTableName] = useState(props.initialSqlTableName ?? 'my_table')
  const [source, setSource] = useState<SourceFormat>(props.initialSourceFormat ?? 'auto')
  const [searchText, setSearchText] = useState('')
  const [isReading, setIsReading] = useState(false)
  const [readError, setReadError] = useState('')
  const generation = useRef(0), alive = useRef(true)
  const { push } = useNavigation()
  useEffect(() => () => { alive.current = false; generation.current++ }, [])

  const handleReadClipboard = async () => {
    const request = ++generation.current
    setIsReading(true); setReadError('')
    try {
      const text = await Clipboard.readText()
      if (!alive.current || request !== generation.current) return
      setRawText(text ?? '')
      // 读取成功不等于转换成功；无效输入仍保存，供编辑修正。
    } catch (error) {
      if (!alive.current || request !== generation.current) return
      const message = error instanceof Error ? error.message : String(error)
      setReadError('剪贴板读取失败，保留上一次输入。')
      await showToast({ style: Toast.Style.Failure, title: '未能读取剪贴板', message })
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
  }, [rawText, headerMode, source, sqlTableName])
  const preferred = props.featureCode?.replace('table-to-', '')
  const targets = [...result.targets].sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred))
    .filter(target => [target.id, target.title, target.subtitle].some(text => text.toLowerCase().includes(searchText.trim().toLowerCase())))
  const grid = result.parsed?.grid
  const summary = result.error ? '解析失败，原文保留，可编辑后重试。' : result.parsed?.format === 'empty' ? '' : result.parsed?.format === 'unrecognized' ? '未识别到表格' : `${result.parsed?.format.toUpperCase()} · ${grid?.rows.length ?? 0} 行 × ${grid?.headers.length ?? 0} 列`
  const editInput = () => {
    generation.current++; setIsReading(false)
    push(<TableInputForm initial={{ text: rawText, source, sqlTableName }} hasHeader={headerMode === 'first-row-header'} onApply={value => {
      if (!alive.current) return
      generation.current++; setRawText(value.text); setSource(value.source); setSqlTableName(value.sqlTableName); setReadError('')
    }} />)
  }

  const goal = featureGoal(props.featureCode)
  const inputActions = <ActionPanel>
    <Action title="读取剪贴板" icon={Icon.Clipboard} onAction={handleReadClipboard} />
    <Action title="编辑输入" icon={Icon.Pencil} onAction={editInput} />
  </ActionPanel>

  return <List navigationTitle="表格互转" isLoading={isReading} isShowingDetail={true}
    searchText={searchText} onSearchTextChange={setSearchText} searchBarPlaceholder="筛选输出格式（Markdown / JSON / SQL / HTML / CSV）"
    searchBarAccessory={<List.Dropdown value={headerMode} onChange={value => setHeaderMode(value as typeof headerMode)} tooltip="表头识别模式">
      <List.Dropdown.Item title="首行为表头" value="first-row-header" />
      <List.Dropdown.Item title="无表头，自动命名列" value="no-header" />
    </List.Dropdown>}
    filterBar={{ summaryText: readError || summary, actions: [
      { id: 'read-clipboard', title: '读取剪贴板', onAction: handleReadClipboard },
      { id: 'edit-input', title: '编辑输入', onAction: editInput }
    ] }}>
    {!isReading && result.error ? <List.Item id="parse-error" title="无法转换当前输入" subtitle="原文已保留，可编辑后重试" actions={inputActions} detail={<List.Item.Detail markdown={fencedPreview(result.error, 'text')} />} /> : null}
    {!isReading && result.parsed?.format === 'unrecognized' ? <List.Item id="not-table" title="剪贴板内容不像表格，请粘贴 CSV/TSV/Markdown 表格" subtitle={goal} actions={inputActions} detail={<List.Item.Detail markdown={goal} />} /> : null}
    {!isReading && !result.error && result.parsed?.format !== 'unrecognized' && !targets.length ? <List.Item id="empty-input" title={rawText ? '没有匹配的输出格式' : '等待表格数据'} subtitle={goal} actions={inputActions} detail={<List.Item.Detail markdown={goal} />} /> : null}
    {!isReading && targets.map(target => <List.Item key={target.id} id={target.id} title={target.title} subtitle={target.subtitle}
      icon={Icon.Document} accessories={[{ tag: target.badge }]}
      detail={<List.Item.Detail markdown={target.error ? fencedPreview(target.error, 'text') : fencedPreview(target.previewText, target.language)}
        metadata={<List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label title="数据规模" text={`${grid?.rows.length ?? 0} 行 × ${grid?.headers.length ?? 0} 列`} />
          <List.Item.Detail.Metadata.Label title="输出字符数" text={String(target.fullText.length)} />
          <List.Item.Detail.Metadata.Label title="列类型" text={target.typeSummary} />
          {grid?.warnings?.map((warning, i) => <List.Item.Detail.Metadata.Label key={i} title="表头处理" text={warning} />)}
        </List.Item.Detail.Metadata>} />}
      actions={target.error ? undefined : <ActionPanel>
        <Action.CopyToClipboard title="复制转换结果" content={target.fullText} icon={Icon.Clipboard} />
        <Action.Paste title="直接上屏粘贴" content={target.fullText} icon={Icon.Text} shortcut={{ modifiers: ['cmd'], key: 'enter' }} />
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
