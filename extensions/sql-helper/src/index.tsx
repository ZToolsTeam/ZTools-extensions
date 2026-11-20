import React, { Action, ActionPanel, Clipboard, Form, Icon, List, ToastStyle, showToast, useEffect, useLocale, useMemo, useNavigation, useRef, useState } from '@ztools/declarative-ui'
import { t } from './i18n.js'
import { formatAndMinifySql, mergeMyBatisLog, parseDdlToEntities } from './sql-helper-service.js'
import type { SqlDialect, SqlHelperTab } from './types.js'
export * from './types.js'
export * from './sql-helper-service.js'

interface Source { text: string; dialect: SqlDialect }
interface Output { id: string; title: string; language: string; content: string }
const getModes = (): Record<SqlHelperTab, string> => ({ formatter: t('modeFormatter'), mybatis: t('modeMybatis'), ddl: t('modeDdl') })
const EMPTY: Source = { text: '', dialect: 'mysql' }
// 每个模式的空状态引导：说明需要什么输入、会得到什么；快捷键由底栏显示，这里不重复
const getGuides = (): Record<SqlHelperTab, { title: string; detail: string }> => ({
  formatter: { title: t('guideFormatterTitle'), detail: t('guideFormatterDetail') },
  mybatis: { title: t('guideMybatisTitle'), detail: t('guideMybatisDetail') },
  ddl: { title: t('guideDdlTitle'), detail: t('guideDdlDetail') },
})
function convert(tab: SqlHelperTab, source: Source): { outputs: Output[]; notice: string } {
  if (!source.text.trim()) throw new Error(t('emptyInputError'))
  if (tab === 'formatter') {
    const result = formatAndMinifySql(source.text, source.dialect)
    return { outputs: [
      { id: 'beautified', title: t('beautifiedTitle'), language: 'sql', content: result.beautified },
      { id: 'minified', title: t('minifiedTitle'), language: 'sql', content: result.minified },
    ], notice: t('formatterNotice') }
  }
  if (tab === 'mybatis') {
    const result = mergeMyBatisLog(source.text, source.dialect)
    if (!result.isSuccess) throw new Error(result.errorMessage)
    return { outputs: [{ id: 'merged', title: t('mergedTitle'), language: 'sql', content: result.beautifiedMergedSql }], notice: t('mybatisNotice', { paramCountDisplay: result.paramCountDisplay }) }
  }
  const result = parseDdlToEntities(source.text, source.dialect)
  if (!result.isValid) throw new Error(result.warningMessage)
  return { outputs: [
    { id: 'typescript', title: t('tsModelTitle'), language: 'ts', content: result.generatedCode.typescript },
    { id: 'golang', title: t('goModelTitle'), language: 'go', content: result.generatedCode.golang },
    { id: 'java', title: t('javaModelTitle'), language: 'java', content: result.generatedCode.java },
  ], notice: t('ddlNotice', { tableName: result.tableName, count: result.columns.length, warnings: result.warnings.join('\n') }) }
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
  useLocale()
  const modes = getModes()
  const [text, setText] = useState(source.text), [dialect, setDialect] = useState(source.dialect), { pop } = useNavigation()
  const submit = async () => {
    try { convert(tab, { text, dialect }); save({ text, dialect }); pop() }
    catch (error) { await showToast({ style: ToastStyle.Failure, title: t('cannotGenerate'), message: error instanceof Error ? error.message : String(error) }) }
  }
  return <Form navigationTitle={modes[tab]} actions={<ActionPanel><Action.SubmitForm title={t('generateResult')} onSubmit={submit} /></ActionPanel>}>
    <Form.Dropdown id="dialect" title={t('sqlDialect')} value={dialect} onChange={value => setDialect(value as SqlDialect)}>
      <Form.Dropdown.Item value="mysql" title={t('dialectMysql')} />
      <Form.Dropdown.Item value="postgresql" title={t('dialectPg')} />
      <Form.Dropdown.Item value="sqlite" title={t('dialectSqlite')} />
    </Form.Dropdown>
    <Form.TextArea id="source" title={tab === 'mybatis' ? t('sourceMybatisLabel') : tab === 'ddl' ? t('sourceDdlLabel') : t('sourceSqlLabel')} value={text} onChange={setText} />
    <Form.Description text={t('localOnlyHint')} />
  </Form>
}
export function SqlHelperCommand({ initialTab = 'formatter' }: { initialTab?: SqlHelperTab } = {}) {
  const locale = useLocale()
  const modes = getModes()
  const guides = getGuides()
  const [tab, setTab] = useState(initialTab), [sources, setSources] = useState<Record<SqlHelperTab, Source>>({ formatter: EMPTY, mybatis: EMPTY, ddl: EMPTY }), [query, setQuery] = useState('')
  const { push } = useNavigation(), revision = useRef(0), mounted = useRef(true)
  useEffect(() => () => { mounted.current = false; revision.current++ }, [])
  const source = sources[tab]
  const state = useMemo(() => {
    if (!source.text.trim()) return { kind: 'empty' as const }
    try { return { kind: 'ready' as const, value: convert(tab, source) } }
    catch (error) { return { kind: 'error' as const, message: error instanceof Error ? error.message : String(error) } }
  }, [tab, source, locale])
  const update = (value: Source) => { revision.current++; setSources(previous => ({ ...previous, [tab]: value })); setQuery('') }
  const edit = () => { revision.current++; push(<SqlSourceForm tab={tab} source={source} save={update} />) }
  const clipboard = async () => {
    const request = ++revision.current
    try {
      const value = { ...source, text: await Clipboard.readText() || '' }
      if (!mounted.current || request !== revision.current) return
      setSources(previous => ({ ...previous, [tab]: value })); setQuery('')
      convert(tab, value)
      await showToast({ style: ToastStyle.Success, title: t('generatedToast') })
    } catch (error) {
      if (!mounted.current || request !== revision.current) return
      await showToast({ style: ToastStyle.Failure, title: t('generateFailedToast'), message: error instanceof Error ? error.message : String(error) })
    }
  }
  const output = state.kind === 'ready' ? state.value : undefined
  return <List isShowingDetail={true} searchText={query} onSearchTextChange={setQuery} searchBarPlaceholder={t('searchPlaceholder')}
    searchBarAccessory={<List.Dropdown value={tab} onChange={value => { revision.current++; setTab(value as SqlHelperTab); setQuery('') }} tooltip={t('switchToolTooltip')}>
      {Object.entries(modes).map(([value, title]) => <List.Dropdown.Item key={value} value={value} title={title} />)}
    </List.Dropdown>}
    filterBar={output ? { summaryText: `${modes[tab]} · ${source.dialect}`, actions: [{ id: 'clipboard', title: t('loadClipboard'), onAction: () => void clipboard() }, { id: 'edit', title: t('editSource'), onAction: edit }] } : undefined}
  >
    {!output && <List.Item id="input" title={state.kind === 'error' ? t('inputErrorTitle') : guides[tab].title} subtitle={state.kind === 'error' ? state.message : t('emptyGuideSubtitle')} icon={Icon.Code}
      detail={<List.Item.Detail markdown={state.kind === 'error' ? fenced(state.message) : guides[tab].detail} />}
      actions={<ActionPanel><Action title={t('loadClipboard')} onAction={() => void clipboard()} /><Action title={t('editSource')} onAction={edit} shortcut={{ modifiers: ['cmd'], key: 'enter' }} /></ActionPanel>}
    />}
    {output?.outputs.filter(item => `${item.title} ${item.language}`.toLowerCase().includes(query.trim().toLowerCase())).map(item => <List.Item key={item.id} id={item.id} title={item.title} icon={Icon.Code}
      detail={<List.Item.Detail markdown={`${fenced(item.content, item.language)}\n\n${noticeMarkdown(output.notice)}`} />}
      actions={<ActionPanel><Action.CopyToClipboard title={t('copyItem', { title: item.title })} content={item.content} /></ActionPanel>}
    />)}
  </List>
}
export const commands = {
  'sql-formatter': () => <SqlHelperCommand initialTab="formatter" />,
  'mybatis-merge': () => <SqlHelperCommand initialTab="mybatis" />,
  'ddl-to-entity': () => <SqlHelperCommand initialTab="ddl" />,
}
export default SqlHelperCommand
