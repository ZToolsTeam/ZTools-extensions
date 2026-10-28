import React, { Action, ActionPanel, Form, Icon, List, Toast, showToast, useEffect, useMemo, useNavigation, useRef, useState } from '@ztools/declarative-ui'
import { MarkdownClient, validMarkdown } from './md-to-office-service.js'
import { DEFAULT_OPTIONS, type ConvertOptions, type DocSummary } from './types.js'
const message = (e: unknown) => e instanceof Error ? e.message : String(e)
function MarkdownForm({ initial, onApply }: { initial: string; onApply: (text: string, active: () => boolean) => Promise<boolean> }) {
  const [text, setText] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const alive = useRef(true), guard = useRef(false), { pop } = useNavigation()
  useEffect(() => () => { alive.current = false }, [])
  const submit = async () => {
    if (guard.current) return
    guard.current = true; setBusy(true)
    try { validMarkdown(text); if (await onApply(text, () => alive.current) && alive.current) pop() }
    catch (e) { if (alive.current) setError(message(e)) }
    finally { guard.current = false; if (alive.current) setBusy(false) }
  }
  return <Form navigationTitle="编辑 Markdown" isLoading={busy} actions={<ActionPanel><Action.SubmitForm title="载入文档" onSubmit={submit} /></ActionPanel>}>
    <Form.TextArea id="markdown" title="Markdown 文本" value={text} onChange={setText} placeholder="输入或粘贴 Markdown，最多 256 KiB" />
    <Form.Description title="说明" text={error || '支持标题、加粗、列表、表格、链接和代码块；原始 HTML 按文字保留。'} />
  </Form>
}
export function MdToOfficeCommand({ copyImmediately = false }: { copyImmediately?: boolean } = {}) {
  const client = useMemo(() => new MarkdownClient(), []), { push } = useNavigation()
  const [text, setText] = useState(''), [summary, setSummary] = useState<DocSummary | null>(null)
  const [options, setOptions] = useState<ConvertOptions>({ ...DEFAULT_OPTIONS }), [busy, setBusy] = useState(false), [status, setStatus] = useState('读取剪贴板…')
  const alive = useRef(true), guard = useRef(false)
  const perform = async (work: () => Promise<void>) => {
    if (guard.current || !alive.current) return
    guard.current = true; setBusy(true)
    try { await work() }
    catch (e) { if (alive.current) { setStatus(message(e)); await showToast({ style: Toast.Style.Failure, title: '操作未完成', message: message(e) }) } }
    finally { guard.current = false; if (alive.current) setBusy(false) }
  }
  const accept = async (next: string, active = () => true) => {
    const parsed = await client.inspect(next, options)
    if (!alive.current || !active()) return false
    setText(next); setSummary(parsed); setStatus(parsed.warnings.join('；') || `已载入 ${parsed.characters} 字 · ${parsed.blocks} 个结构块`); return true
  }
  const clipboard = (copy = false) => perform(async () => {
    const next = await client.clipboard()
    if (!alive.current || !await accept(next)) return
    if (copy) { const result = await client.copy(next, options); if (alive.current) { setStatus(result.warnings.join('；') || '已复制富文本，可粘贴到 Word、WPS 或文本编辑'); await showToast({ style: Toast.Style.Success, title: '已复制为 Word 富文本' }) } }
  })
  useEffect(() => { void clipboard(copyImmediately); return () => { alive.current = false; void client.cancel().catch(e => console.warn('文档取消请求失败', e)) } }, [])
  const edit = () => { if (!guard.current) push(<MarkdownForm initial={text} onApply={async (next, active) => { let applied = false; await perform(async () => { applied = await accept(next, active) }); return applied }} />) }
  const openFile = () => perform(async () => { const path = await client.choose('open'); if (!path || !alive.current) return; const next = await client.read(path); if (alive.current) await accept(next) })
  const exportFile = () => perform(async () => {
    if (!summary) return
    const output = await client.choose('save', summary.title)
    if (!output || !alive.current) return
    const result = await client.export(text, options, output)
    if (alive.current) { setStatus(`已另存 ${result.name} · ${(result.size / 1024).toFixed(1)} KB`); await showToast({ style: Toast.Style.Success, title: 'Word 新副本已保存', message: result.name }) }
  })
  const copyRich = () => perform(async () => { const result = await client.copy(text, options); if (alive.current) { setStatus(result.warnings.join('；') || '已复制富文本，可粘贴到 Word、WPS 或文本编辑'); await showToast({ style: Toast.Style.Success, title: '已复制富文本' }) } })
  const change = (patch: Partial<ConvertOptions>) => { if (!guard.current) setOptions(current => ({ ...current, ...patch })) }
  return <List navigationTitle="AI 文档转 Word" isShowingDetail={false} isLoading={busy} searchBarPlaceholder="当前文档"
    filterBar={{ summaryText: status, actions: [{ id: 'clipboard', title: '读取剪贴板', onAction: () => clipboard() }, { id: 'open', title: '打开文件', onAction: openFile }] }}
    workbenchPanel={{ title: '排版选项', fields: [
      { id: 'preset', label: '排版风格', type: 'select', value: options.preset, options: [{ label: '公文风格', value: 'official' }, { label: '商务报告', value: 'business' }, { label: '学术三线表', value: 'academic' }], onChange: (value: unknown) => { if (typeof value === 'string' && ['official','business','academic'].includes(value)) change({ preset: value as ConvertOptions['preset'] }) } },
      { id: 'fontSize', label: '正文字号', type: 'select', value: options.fontSize, options: [{ label: '三号 16pt', value: 'size-3' }, { label: '小四 12pt', value: 'size-s4' }, { label: '五号 10.5pt', value: 'size-5' }], onChange: (value: unknown) => { if (typeof value === 'string' && ['size-3','size-s4','size-5'].includes(value)) change({ fontSize: value as ConvertOptions['fontSize'] }) } },
      { id: 'indent', label: '正文首行缩进', type: 'toggle', value: options.firstLineIndent, onChange: (value: unknown) => { if (typeof value === 'boolean') change({ firstLineIndent: value }) } }
    ], previewCard: { title: '另存为 DOCX 新副本', subtitle: '原文件保留；实际字体由打开文档的设备决定' } }}
    subList={{ title: '待转换文档', items: [summary ? <List.Item key="document" id="document" title={summary.title} subtitle={`${summary.characters} 字 · ${summary.blocks} 个结构块`} icon={Icon.Document} actions={<ActionPanel>
      <Action title="另存 Word 新副本" icon={Icon.Download} onAction={exportFile} />
      <Action title="复制为富文本" icon={Icon.Clipboard} onAction={copyRich} />
      <Action title="编辑 Markdown" onAction={edit} />
      <Action.CopyToClipboard title="复制 Markdown 原文" content={text} />
    </ActionPanel>} /> : <List.Item key="empty" id="empty" title="输入 Markdown 文本" subtitle="也可以读取剪贴板或打开 Markdown 文件" icon={Icon.Document} actions={<ActionPanel><Action title="输入 Markdown" onAction={edit} /></ActionPanel>} />] }} />
}
export const commands = { 'md-to-office-workbench': MdToOfficeCommand, 'md-to-office-clipboard-fast': () => MdToOfficeCommand({ copyImmediately: true }) }
export default MdToOfficeCommand
