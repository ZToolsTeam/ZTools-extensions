import React, { Action, ActionPanel, Form, Icon, List, Toast, showToast, useEffect, useLocale, useMemo, useNavigation, useRef, useState } from '@ztools/declarative-ui'
import { createCompatFileInputProps, isDeclarativeFileInputSupported } from './host-compat.js'
import { t } from './i18n.js'
import { documentTitle, extractDroppedMarkdownPath, MarkdownClient, validMarkdown } from './md-to-office-service.js'
import { DEFAULT_OPTIONS, type ConvertOptions, type DocSummary } from './types.js'
const message = (e: unknown) => e instanceof Error ? e.message : String(e)
const basename = (path: string) => path.split(/[\\/]/).pop()?.replace(/\.(md|markdown|txt)$/i, '') || t('fallbackFileTitle')
function MarkdownForm({ initial, onApply }: { initial: string; onApply: (text: string, active: () => boolean) => Promise<boolean> }) {
  useLocale()
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
  return <Form navigationTitle={t('formNavTitle')} isLoading={busy} actions={<ActionPanel><Action.SubmitForm title={t('formSubmitTitle')} onSubmit={submit} /></ActionPanel>}>
    <Form.TextArea id="markdown" title={t('formFieldTitle')} value={text} onChange={setText} placeholder={t('formFieldPlaceholder')} />
    <Form.Description title={t('formDescTitle')} text={error || t('formDescHelp')} />
  </Form>
}
export function MdToOfficeCommand({ copyImmediately = false }: { copyImmediately?: boolean } = {}) {
  useLocale()
  const client = useMemo(() => new MarkdownClient(), []), { push } = useNavigation()
  const [text, setText] = useState(''), [summary, setSummary] = useState<DocSummary | null>(null)
  const [lastExported, setLastExported] = useState<{ path: string; name: string; size: number } | null>(null)
  const [options, setOptions] = useState<ConvertOptions>({ ...DEFAULT_OPTIONS }), [busy, setBusy] = useState(false), [status, setStatus] = useState('')
  const [query, setQuery] = useState('')
  const alive = useRef(true), guard = useRef(false)
  const optionsRef = useRef(options)
  optionsRef.current = options
  const perform = async (work: () => Promise<void>) => {
    if (guard.current || !alive.current) return
    guard.current = true; setBusy(true)
    try { await work() }
    catch (e) { if (alive.current) { setStatus(message(e)); await showToast({ style: Toast.Style.Failure, title: t('toastOpFailed'), message: message(e) }) } }
    finally { guard.current = false; if (alive.current) setBusy(false) }
  }
  // source 是来源名称：文档没有标题时用它作文档名；字数与结构块只显示在文档条目上，状态栏不重复
  const accept = async (next: string, source: string, active = () => true) => {
    const parsed = await client.inspect(next, optionsRef.current)
    if (!alive.current || !active()) return false
    setText(next); setSummary({ ...parsed, title: documentTitle(next, parsed.title, source) }); setStatus(parsed.warnings.join('; ') || t('statusLoadedSource', { source })); return true
  }
  const clipboard = (copy = false) => perform(async () => {
    const next = await client.clipboard()
    if (!alive.current || !await accept(next, t('sourceClipboard'))) return
    if (copy) { const result = await client.copy(next, optionsRef.current); if (alive.current) { setStatus(result.warnings.join('; ') || t('statusRichCopied')); await showToast({ style: Toast.Style.Success, title: t('toastRichCopiedWord') }) } }
  })
  const handleFilesDropped = (envelopeOrPayload: unknown) => {
    void perform(async () => {
      const path = extractDroppedMarkdownPath(envelopeOrPayload)
      if (!alive.current) return
      const next = await client.read(path)
      if (alive.current) await accept(next, basename(path))
    })
  }
  const fileInputProps = createCompatFileInputProps(
    files => handleFilesDropped({ files }),
    {
      extensions: ['.md', '.markdown', '.txt'],
      onTextPaste: (pastedText: string) => {
        void perform(async () => {
          validMarkdown(pastedText)
          if (alive.current) await accept(pastedText, t('sourceClipboard'))
        })
      }
    }
  )
  useEffect(() => {
    alive.current = true
    void clipboard(copyImmediately)
    if (isDeclarativeFileInputSupported()) {
      return () => {
        alive.current = false
        void client.cancel().catch(e => console.warn(t('warnCancelFailed'), e))
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
      void client.cancel().catch(e => console.warn(t('warnCancelFailed'), e))
      if (typeof dispose === 'function') dispose()
      else if (events && typeof events.off === 'function') events.off('plugin_files_dropped', handleFilesDropped)
    }
  }, [])
  // 搜索框用来起草：输入的文字带进编辑表单，载入成功后清空搜索框
  const edit = (initial = text) => { if (!guard.current) push(<MarkdownForm initial={initial} onApply={async (next, active) => { let applied = false; await perform(async () => { applied = await accept(next, t('sourceTyped'), active) }); if (applied && alive.current) setQuery(''); return applied }} />) }
  const openFile = () => perform(async () => { const path = await client.choose('open'); if (!path || !alive.current) return; const next = await client.read(path); if (alive.current) await accept(next, basename(path)) })
  const exportFile = () => perform(async () => {
    if (!summary) return
    const output = await client.choose('save', summary.title)
    if (!output || !alive.current) return
    const result = await client.export(text, options, output)
    if (alive.current) {
      setLastExported({ path: output, name: result.name, size: result.size })
      setStatus(t('statusSavedFile', { name: result.name, sizeKb: (result.size / 1024).toFixed(1) }))
      await showToast({ style: Toast.Style.Success, title: t('toastSavedWord'), message: result.name })
    }
  })
  const copyRich = () => perform(async () => { const result = await client.copy(text, options); if (alive.current) { setStatus(result.warnings.join('; ') || t('statusRichCopied')); await showToast({ style: Toast.Style.Success, title: t('toastRichCopied') }) } })
  const change = (patch: Partial<ConvertOptions>) => { if (!guard.current) setOptions(current => ({ ...current, ...patch })) }
  return <List {...fileInputProps} navigationTitle={t('navTitle')} isShowingDetail={false} isLoading={busy} searchBarPlaceholder={t('searchPlaceholder')} searchText={query} onSearchTextChange={setQuery}
    filterBar={{ summaryText: status || t('statusReadingClipboard'), actions: [{ id: 'clipboard', title: t('actionReadClipboard'), onAction: () => clipboard() }, { id: 'open', title: t('actionOpenFile'), onAction: openFile }] }}
    workbenchPanel={{ title: t('panelTitle'), fields: [
      { id: 'preset', label: t('fieldPresetLabel'), type: 'select', value: options.preset, options: [{ label: t('presetOfficial'), value: 'official' }, { label: t('presetBusiness'), value: 'business' }, { label: t('presetAcademic'), value: 'academic' }], onChange: (value: unknown) => { if (typeof value === 'string' && ['official','business','academic'].includes(value)) change({ preset: value as ConvertOptions['preset'] }) } },
      { id: 'fontSize', label: t('fieldFontSizeLabel'), type: 'select', value: options.fontSize, options: [{ label: t('fontSize3'), value: 'size-3' }, { label: t('fontSizeS4'), value: 'size-s4' }, { label: t('fontSize5'), value: 'size-5' }], onChange: (value: unknown) => { if (typeof value === 'string' && ['size-3','size-s4','size-5'].includes(value)) change({ fontSize: value as ConvertOptions['fontSize'] }) } },
      { id: 'indent', label: t('fieldIndentLabel'), type: 'toggle', value: options.firstLineIndent, onChange: (value: unknown) => { if (typeof value === 'boolean') change({ firstLineIndent: value }) } },
      { id: 'note', label: t('fieldNoteLabel'), type: 'info', value: t('fieldNoteValue') }
    ] }}
    subList={{ title: t('subListTitle'), items: [query.trim() ? <List.Item key="draft" id="draft" title={t('draftTitle')} subtitle={query.trim()} icon={Icon.Pencil} actions={<ActionPanel><Action title={t('draftActionContinue')} onAction={() => edit(query)} /></ActionPanel>} /> : null, summary ? <List.Item key="document" id="document" title={summary.title} subtitle={t('docSubtitle', { characters: summary.characters, blocks: summary.blocks })} icon={Icon.Document} actions={<ActionPanel>
      <Action title={t('actionSaveWord')} icon={Icon.Download} onAction={exportFile} />
      <Action title={t('actionCopyRich')} icon={Icon.Clipboard} onAction={copyRich} />
      {lastExported ? <Action.Open title={t('actionOpenExported')} target={lastExported.path} icon={Icon.Document} /> : null}
      {lastExported ? <Action.ShowInFinder title={t('actionRevealExported')} path={lastExported.path} icon={Icon.Folder} /> : null}
      <Action title={t('actionEditMarkdown')} onAction={() => edit()} />
      <Action.CopyToClipboard title={t('actionCopyMarkdown')} content={text} />
    </ActionPanel>} /> : query.trim() ? null : <List.Item key="empty" id="empty" title={t('emptyTitle')} subtitle={t('emptySubtitle')} icon={Icon.Document} actions={<ActionPanel><Action title={t('emptyActionInput')} onAction={() => edit()} /></ActionPanel>} />, lastExported ? <List.Item key="exported-file" id="exported-file" title={t('exportedItemTitle', { name: lastExported.name })} subtitle={lastExported.path} icon={Icon.CheckCircle} actions={<ActionPanel>
      <Action.Open title={t('actionOpenExported')} target={lastExported.path} icon={Icon.Document} />
      <Action.ShowInFinder title={t('actionRevealExported')} path={lastExported.path} icon={Icon.Folder} />
      <Action.CopyToClipboard title={t('actionCopyExportedPath')} content={lastExported.path} />
    </ActionPanel>} /> : null].filter((item): item is NonNullable<typeof item> => item !== null) }} />
}
export const commands = { 'md-to-office-workbench': MdToOfficeCommand, 'md-to-office-clipboard-fast': () => MdToOfficeCommand({ copyImmediately: true }) }
export default MdToOfficeCommand
