import React, { Action, ActionPanel, Detail, Form, Icon, List, Toast, showToast, useEffect, useMemo, useNavigation, useRef, useState } from '@ztools/declarative-ui'
import { FontClient } from './font-client.js'
import { DEFAULT_PREVIEW, cssFontFamily, filterFonts, licenseUrl, previewMarkdown, textMarkdown, validatePreviewText } from './font-service.js'
import type { FontFilter, FontPreview, InstalledFont } from './types.js'
const client = new FontClient()
const errorText = (error: unknown) => error instanceof Error ? error.message : '字体读取失败'

export function PreviewTextForm({ initial, save }: { initial: string; save: (text: string) => void }) {
  const [text, setText] = useState(initial), { pop } = useNavigation()
  const submit = async () => {
    try { save(validatePreviewText(text)); pop() }
    catch (error) { await showToast(Toast.Style.Failure, errorText(error)) }
  }
  return <Form navigationTitle="设置预览文字" actions={<ActionPanel><Action.SubmitForm title="应用预览文字" onSubmit={submit} /></ActionPanel>}>
    <Form.TextArea id="sample" title="预览文字" value={text} onChange={setText} />
    <Form.Description text="最多 160 个字符；缺少字形时显示回退信息或字符覆盖提示。" />
  </Form>
}
function LicenseDetail({ preview }: { preview: FontPreview }) {
  const url = licenseUrl(preview.licenseUrl)
  const markdown = `### 字体自带的许可说明\n\n${textMarkdown(preview.license || '字体文件未提供许可说明。')}\n\n### 版权信息\n\n${textMarkdown(preview.copyright || '未提供')}\n\n### 制造商\n\n${textMarkdown(preview.manufacturer || '未提供')}\n\n这些是字体内的原始信息，不能据此直接判断是否允许免费商用。`
  return <Detail navigationTitle="字体许可信息" markdown={markdown} actions={url ? <ActionPanel><Action.OpenInBrowser title="打开字体提供的许可链接" url={url} /></ActionPanel> : undefined} />
}
export default function FontManager({ initialFilter = 'all' }: { initialFilter?: FontFilter } = {}) {
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
  return <List navigationTitle="字体管理" isLoading={loading} isShowingDetail={true}
    searchText={query} onSearchTextChange={setQuery} searchBarPlaceholder="搜索字体名称或样式"
    selectedItemId={selectedId} onSelectionChange={id => setSelection(id ?? '')}
    searchBarAccessory={<List.Dropdown value={filter} onChange={value => setFilter(value as FontFilter)} tooltip="按字体信息筛选">
      <List.Dropdown.Item title="全部字体" value="all" />
      <List.Dropdown.Item title="含许可说明" value="with-license" />
      <List.Dropdown.Item title="未附许可说明" value="without-license" />
      <List.Dropdown.Item title="系统字体" value="system" />
    </List.Dropdown>}
    filterBar={{ summaryText: error || (loading ? '正在读取系统字体…' : `${fonts.length} 个字体样式 · 当前显示 ${filtered.length} 个`), actions: [
      { id: 'preview-text', title: '设置预览文字', onAction: () => push(<PreviewTextForm initial={text} save={setText} />) },
      { id: 'refresh', title: '重新扫描', onAction: load }
    ] }}>
    {filtered.map(font => <List.Item key={font.id} id={font.id} title={font.family} subtitle={font.style} icon={Icon.Text}
      accessories={[{ tag: font.hasLicense ? '含许可说明' : '未附许可说明' }]}
      detail={<List.Item.Detail markdown={font.id === selectedId ? currentPreview ? previewMarkdown(currentPreview) : textMarkdown(previewError || '正在绘制实际字形…') : ''} />}
      actions={<ActionPanel>
        <Action.CopyToClipboard title="复制字体名称" content={font.family} />
        <Action.CopyToClipboard title="复制 CSS font-family" content={cssFontFamily(font.family)} />
        {font.filePath && <Action title="定位字体文件" icon={Icon.Folder} onAction={() => reveal(font.id)} />}
        {font.id === selectedId && currentPreview && <Action.Push title="查看许可信息" target={<LicenseDetail preview={currentPreview} />} />}
      </ActionPanel>} />)}
  </List>
}
export const commands = {
  'font-manager-all': () => <FontManager />,
  'font-manager-free-commercial': () => <FontManager initialFilter="with-license" />,
  'font-manager-commercial-risk': () => <FontManager initialFilter="without-license" />
}
