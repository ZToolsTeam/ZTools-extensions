import React, { Action, ActionPanel, Clipboard, Form, Icon, List, ToastStyle, showToast, useEffect, useMemo, useNavigation, useRef, useState } from '@ztools/declarative-ui'
import { formatAndMinifySql, mergeMyBatisLog, parseDdlToEntities } from './sql-helper-service.js'
import type { SqlDialect, SqlHelperTab } from './types.js'
export * from './types.js'
export * from './sql-helper-service.js'

interface Source { text: string; dialect: SqlDialect }
interface Output { id: string; title: string; language: string; content: string }
const MODES: Record<SqlHelperTab, string> = { formatter: 'SQL 美化与精简', mybatis: 'MyBatis 日志还原', ddl: '建表语句转模型' }
const EMPTY: Source = { text: '', dialect: 'mysql' }
// 每个模式的空状态引导：说明需要什么输入、会得到什么；快捷键由底栏显示，这里不重复
const GUIDES: Record<SqlHelperTab, { title: string; detail: string }> = {
  formatter: { title: '载入 SQL 开始美化与精简', detail: '把 SQL 复制到剪贴板后按回车载入，或打开多行编辑器粘贴。\n\n同时输出美化和精简两种格式；保留大小写、字符串与注释，只调整排版，不检查数据库语法。可选择 MySQL、PostgreSQL 或 SQLite 方言。' },
  mybatis: { title: '载入 MyBatis 日志还原 SQL', detail: '需要同一次调用的 Preparing 和 Parameters 两行日志，复制后按回车载入，或打开多行编辑器粘贴。\n\n参数按所选方言转成字面量填回 SQL；日志是有损文本，日期、二进制及自定义类型需核对原始绑定。' },
  ddl: { title: '载入建表语句生成模型', detail: '需要一条 CREATE TABLE 语句，一次处理一张表，复制后按回车载入，或打开多行编辑器粘贴。\n\n生成 TypeScript、Go 与 Java 模型代码。' },
}
function convert(tab: SqlHelperTab, source: Source): { outputs: Output[]; notice: string } {
  if (!source.text.trim()) throw new Error('请先输入 SQL 或日志')
  if (tab === 'formatter') {
    const result = formatAndMinifySql(source.text, source.dialect)
    return { outputs: [
      { id: 'beautified', title: '美化 SQL', language: 'sql', content: result.beautified },
      { id: 'minified', title: '精简空白', language: 'sql', content: result.minified },
    ], notice: '保留大小写、字符串、注释与必要换行；仅排版，不验证数据库语法。' }
  }
  if (tab === 'mybatis') {
    const result = mergeMyBatisLog(source.text, source.dialect)
    if (!result.isSuccess) throw new Error(result.errorMessage)
    return { outputs: [{ id: 'merged', title: '参数还原参考 SQL', language: 'sql', content: result.beautifiedMergedSql }], notice: result.paramCountDisplay + '。日志是有损文本，日期、二进制及自定义类型需核对原始绑定。' }
  }
  const result = parseDdlToEntities(source.text, source.dialect)
  if (!result.isValid) throw new Error(result.warningMessage)
  return { outputs: [
    { id: 'typescript', title: 'TypeScript 模型', language: 'ts', content: result.generatedCode.typescript },
    { id: 'golang', title: 'Go 模型', language: 'go', content: result.generatedCode.golang },
    { id: 'java', title: 'Java 模型', language: 'java', content: result.generatedCode.java },
  ], notice: `${result.tableName} · ${result.columns.length} 个字段\n${result.warnings.join('\n')}` }
}
function noticeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}\[\]()#+.!<>|~-]/g, '\\$&').split('\n').join('\n\n')
}
function fenced(value: string, language = 'text'): string {
  let n = 3
  for (const match of value.matchAll(/`+/g)) n = Math.max(n, match[0].length + 1)
  const fence = '`'.repeat(n)
  return `${fence}${language}\n${value}\n${fence}`
}
export function SqlSourceForm({ tab, source, save }: { tab: SqlHelperTab; source: Source; save: (value: Source) => void }) {
  const [text, setText] = useState(source.text), [dialect, setDialect] = useState(source.dialect), { pop } = useNavigation()
  const submit = async () => {
    try { convert(tab, { text, dialect }); save({ text, dialect }); pop() }
    catch (error) { await showToast({ style: ToastStyle.Failure, title: '无法生成结果', message: error instanceof Error ? error.message : String(error) }) }
  }
  return <Form navigationTitle={MODES[tab]} actions={<ActionPanel><Action.SubmitForm title="生成结果" onSubmit={submit} /></ActionPanel>}>
    <Form.Dropdown id="dialect" title="SQL 方言" value={dialect} onChange={value => setDialect(value as SqlDialect)}>
      <Form.Dropdown.Item value="mysql" title="MySQL（默认反斜杠转义）" />
      <Form.Dropdown.Item value="postgresql" title="PostgreSQL（标准字符串）" />
      <Form.Dropdown.Item value="sqlite" title="SQLite" />
    </Form.Dropdown>
    <Form.TextArea id="source" title={tab === 'mybatis' ? '两行 MyBatis 日志' : tab === 'ddl' ? 'CREATE TABLE 语句' : 'SQL 源码'} value={text} onChange={setText} />
    <Form.Description text="只在本地处理，最多 256 KiB。" />
  </Form>
}
export function SqlHelperCommand({ initialTab = 'formatter' }: { initialTab?: SqlHelperTab } = {}) {
  const [tab, setTab] = useState(initialTab), [sources, setSources] = useState<Record<SqlHelperTab, Source>>({ formatter: EMPTY, mybatis: EMPTY, ddl: EMPTY }), [query, setQuery] = useState('')
  const { push } = useNavigation(), revision = useRef(0), mounted = useRef(true)
  useEffect(() => () => { mounted.current = false; revision.current++ }, [])
  const source = sources[tab]
  const state = useMemo(() => {
    if (!source.text.trim()) return { kind: 'empty' as const }
    try { return { kind: 'ready' as const, value: convert(tab, source) } }
    catch (error) { return { kind: 'error' as const, message: error instanceof Error ? error.message : String(error) } }
  }, [tab, source])
  const update = (value: Source) => { revision.current++; setSources(previous => ({ ...previous, [tab]: value })); setQuery('') }
  const edit = () => { revision.current++; push(<SqlSourceForm tab={tab} source={source} save={update} />) }
  const clipboard = async () => {
    const request = ++revision.current
    try {
      const value = { ...source, text: await Clipboard.readText() || '' }
      if (!mounted.current || request !== revision.current) return
      setSources(previous => ({ ...previous, [tab]: value })); setQuery('')
      convert(tab, value)
      await showToast({ style: ToastStyle.Success, title: '已生成结果' })
    } catch (error) {
      if (!mounted.current || request !== revision.current) return
      await showToast({ style: ToastStyle.Failure, title: '未能生成结果', message: error instanceof Error ? error.message : String(error) })
    }
  }
  const output = state.kind === 'ready' ? state.value : undefined
  return <List isShowingDetail={true} searchText={query} onSearchTextChange={setQuery} searchBarPlaceholder="筛选结果；用编辑源码或载入剪贴板输入多行内容"
    searchBarAccessory={<List.Dropdown value={tab} onChange={value => { revision.current++; setTab(value as SqlHelperTab); setQuery('') }} tooltip="切换工具">
      {Object.entries(MODES).map(([value, title]) => <List.Dropdown.Item key={value} value={value} title={title} />)}
    </List.Dropdown>}
    filterBar={output ? { summaryText: `${MODES[tab]} · ${source.dialect}`, actions: [{ id: 'clipboard', title: '载入剪贴板', onAction: () => void clipboard() }, { id: 'edit', title: '编辑源码', onAction: edit }] } : undefined}
  >
    {!output && <List.Item id="input" title={state.kind === 'error' ? '输入无法处理' : GUIDES[tab].title} subtitle={state.kind === 'error' ? state.message : '回车载入剪贴板，也可以打开多行编辑'} icon={Icon.Code}
      detail={<List.Item.Detail markdown={state.kind === 'error' ? fenced(state.message) : GUIDES[tab].detail} />}
      actions={<ActionPanel><Action title="载入剪贴板" onAction={() => void clipboard()} /><Action title="编辑源码" onAction={edit} shortcut={{ modifiers: ['cmd'], key: 'enter' }} /></ActionPanel>}
    />}
    {output?.outputs.filter(item => `${item.title} ${item.language}`.toLowerCase().includes(query.trim().toLowerCase())).map(item => <List.Item key={item.id} id={item.id} title={item.title} icon={Icon.Code}
      detail={<List.Item.Detail markdown={`${fenced(item.content, item.language)}\n\n${noticeMarkdown(output.notice)}`} />}
      actions={<ActionPanel><Action.CopyToClipboard title={`复制${item.title}`} content={item.content} /></ActionPanel>}
    />)}
  </List>
}
export const commands = {
  'sql-formatter': () => <SqlHelperCommand initialTab="formatter" />,
  'mybatis-merge': () => <SqlHelperCommand initialTab="mybatis" />,
  'ddl-to-entity': () => <SqlHelperCommand initialTab="ddl" />,
}
export default SqlHelperCommand
