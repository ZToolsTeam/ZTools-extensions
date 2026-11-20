import React, { Action, ActionPanel, Detail, Form, Icon, List, Toast, showToast, useEffect, useLocale, useMemo, useNavigation, useRef, useState } from '@ztools/declarative-ui'
import { t } from './i18n.js'
import { FontClient } from './font-client.js'
import { DEFAULT_PREVIEW, cssFontFamily, filterFonts, licenseUrl, previewMarkdown, textMarkdown, validatePreviewText } from './font-service.js'
import type { FontFilter, FontPreview, InstalledFont } from './types.js'
const client = new FontClient()
const errorText = (error: unknown) => error instanceof Error ? error.message : t('fontReadFailed')

export function PreviewTextForm({ initial, save }: { initial: string; save: (text: string) => void }) {
  useLocale()
  const [text, setText] = useState(initial), { pop } = useNavigation()
  const submit = async () => {
    try { save(validatePreviewText(text)); pop() }
    catch (error) { await showToast(Toast.Style.Failure, errorText(error)) }
  }
  return <Form navigationTitle={t('formNavTitle')} actions={<ActionPanel><Action.SubmitForm title={t('formSubmitTitle')} onSubmit={submit} /></ActionPanel>}>
    <Form.TextArea id="sample" title={t('formFieldTitle')} value={text} onChange={setText} />
    <Form.Description text={t('formDescText')} />
  </Form>
}
function LicenseDetail({ preview }: { preview: FontPreview }) {
  useLocale()
  const url = licenseUrl(preview.licenseUrl)
  const markdown = t('licenseMarkdown', {
    license: textMarkdown(preview.license || t('licenseDefault')),
    copyright: textMarkdown(preview.copyright || t('notProvided')),
    manufacturer: textMarkdown(preview.manufacturer || t('notProvided'))
  })
  return <Detail navigationTitle={t('licenseNavTitle')} markdown={markdown} actions={url ? <ActionPanel><Action.OpenInBrowser title={t('openLicenseUrlAction')} url={url} /></ActionPanel> : undefined} />
}
export default function FontManager({ initialFilter = 'all' }: { initialFilter?: FontFilter } = {}) {
  useLocale()
  const [fonts, setFonts] = useState<InstalledFont[]>([]), [filter, setFilter] = useState<FontFilter>(initialFilter)
  const [query, setQuery] = useState(''), [selection, setSelection] = useState(''), [text, setText] = useState(DEFAULT_PREVIEW)
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [revision, setRevision] = useState(0)
  const [preview, setPreview] = useState<FontPreview | null>(null), [previewError, setPreviewError] = useState('')
  const pending = useRef<AbortController | null>(null), mounted = useRef(true), otherJobs = useRef(new Set<AbortController>())
  const { push } = useNavigation()
  const filtered = useMemo(() => filterFonts(fonts, filter, query), [fonts, filter, query])
  const selected = filtered.find(font => font.id === selection) ?? filtered[0]
  const selectedId = selected?.id ?? ''
  const load = async () => {
    if (pending.current) return
    const controller = new AbortController(); pending.current = controller
    setLoading(true); setError('')
    try {
      const list = await client.list(controller.signal)
      if (mounted.current) { setFonts(list); setRevision(value => value + 1) }
    } catch (failure) { if (mounted.current && !controller.signal.aborted) { setError(errorText(failure)); await showToast(Toast.Style.Failure, errorText(failure)) } }
    finally { pending.current = null; if (mounted.current) setLoading(false) }
  }
  useEffect(() => {
    mounted.current = true; void load()
    return () => { mounted.current = false; pending.current?.abort(); for (const job of otherJobs.current) job.abort() }
  }, [])
  useEffect(() => {
    setPreview(null); setPreviewError('')
    if (!selectedId) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void client.preview(selectedId, text, controller.signal).then(value => {
        if (!controller.signal.aborted) setPreview(value)
      }).catch(failure => { if (!controller.signal.aborted) setPreviewError(errorText(failure)) })
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [selectedId, text, revision])
  const reveal = async (id: string) => {
    const controller = new AbortController(); otherJobs.current.add(controller)
    try { await client.reveal(id, controller.signal) }
    catch (failure) { if (mounted.current && !controller.signal.aborted) await showToast(Toast.Style.Failure, errorText(failure)) }
    finally { otherJobs.current.delete(controller) }
  }
  const currentPreview = preview?.id === selectedId ? preview : null
  return <List navigationTitle={t('navTitle')} isLoading={loading} isShowingDetail={true}
    searchText={query} onSearchTextChange={setQuery} searchBarPlaceholder={t('searchPlaceholder')}
    selectedItemId={selectedId} onSelectionChange={id => setSelection(id ?? '')}
    searchBarAccessory={<List.Dropdown value={filter} onChange={value => setFilter(value as FontFilter)} tooltip={t('filterTooltip')}>
      <List.Dropdown.Item title={t('filterAll')} value="all" />
      <List.Dropdown.Item title={t('filterWithLicense')} value="with-license" />
      <List.Dropdown.Item title={t('filterWithoutLicense')} value="without-license" />
      <List.Dropdown.Item title={t('filterSystem')} value="system" />
    </List.Dropdown>}
    filterBar={{ summaryText: error || (loading ? t('summaryLoading') : t('summaryLoaded', { total: fonts.length, shown: filtered.length })), actions: [
      { id: 'preview-text', title: t('btnPreviewText'), onAction: () => push(<PreviewTextForm initial={text} save={setText} />) },
      { id: 'refresh', title: t('btnRescan'), onAction: load }
    ] }}>
    {filtered.map(font => <List.Item key={font.id} id={font.id} title={font.family} subtitle={font.style} icon={Icon.Text}
      accessories={[{ tag: font.hasLicense ? t('filterWithLicense') : t('filterWithoutLicense') }]}
      detail={<List.Item.Detail markdown={font.id === selectedId ? currentPreview ? previewMarkdown(currentPreview) : textMarkdown(previewError || t('renderingPreview')) : ''} />}
      actions={<ActionPanel>
        <Action.CopyToClipboard title={t('actionCopyFamily')} content={font.family} />
        <Action.CopyToClipboard title={t('actionCopyCss')} content={cssFontFamily(font.family)} />
        {font.filePath && <Action title={t('actionRevealFile')} icon={Icon.Folder} onAction={() => reveal(font.id)} />}
        {font.id === selectedId && currentPreview && <Action.Push title={t('actionViewLicense')} target={<LicenseDetail preview={currentPreview} />} />}
      </ActionPanel>} />)}
  </List>
}
export const commands = {
  'font-manager-all': () => <FontManager />,
  'font-manager-free-commercial': () => <FontManager initialFilter="with-license" />,
  'font-manager-commercial-risk': () => <FontManager initialFilter="without-license" />
}
