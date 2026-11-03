import React, { Action, ActionPanel, Form, Icon, List, Toast, showToast, useEffect, useNavigation, useRef, useState } from '@ztools/declarative-ui'
import { getPresetWatermarkTemplates, resolveTemplate } from './watermark-service.js'
import { pickImage, readClipboardImage, outputImage } from './image-io.js'
import type { ImageMetadata, WatermarkOptions } from './types.js'
export * from './types.js'
export * from './watermark-service.js'
export * from './image-codec.js'
export * from './image-io.js'

export function BusinessForm({ initial, saved }: { initial: string; saved: (value: string) => void }) {
  const [value, setValue] = useState(initial), [error, setError] = useState('')
  const { pop } = useNavigation()
  const submit = () => {
    const name = value.trim()
    if (!name || Array.from(name).length > 80) { setError('请输入 1～80 字的用途或业务名称'); return }
    saved(name); pop()
  }
  return <Form navigationTitle="修改水印用途" actions={<ActionPanel><Action.SubmitForm title="保存用途" onSubmit={submit} /></ActionPanel>}>
    <Form.TextField id="business" title="用途 / 业务名称" value={value} onChange={setValue} error={error} placeholder="如：某公司入职审核" />
  </Form>
}

export function IdWatermarkCommand({ clipboardFirst = false }: { clipboardFirst?: boolean } = {}) {
  const [image, setImage] = useState<ImageMetadata | null>(null)
  const [business, setBusiness] = useState('指定业务')
  const [template, setTemplate] = useState('仅供办理 {business} 使用 他用无效 {date}')
  const [opacity, setOpacity] = useState('25')
  const [color, setColor] = useState<'dark' | 'light'>('dark')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('保留原图，只另存 PNG 新副本；水印不能保证防篡改')
  const pending = useRef<AbortController | null>(null), mounted = useRef(true), { push } = useNavigation()
  const presets = getPresetWatermarkTemplates(business)
  const text = resolveTemplate(template, business)
  const run = async (job: (signal: AbortSignal) => Promise<void>) => {
    if (pending.current) return
    const controller = new AbortController(); pending.current = controller; setLoading(true)
    try { await job(controller.signal) }
    catch (error) {
      if (mounted.current && !controller.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error)
        setStatus(message); await showToast({ style: Toast.Style.Failure, title: message })
      }
    } finally { if (pending.current === controller) pending.current = null; if (mounted.current) setLoading(false) }
  }
  const load = (clipboard: boolean) => run(async signal => {
    const result = await (clipboard ? readClipboardImage(signal) : pickImage(signal))
    signal.throwIfAborted()
    if (result && mounted.current) { setImage(result); setStatus('已读取真实原图；另存或复制前会校验合成图片') }
  })
  const output = (copy: boolean) => run(async signal => {
    if (!image) throw new Error('请先选择原图或读取剪贴板图片')
    const options: WatermarkOptions = { text, opacityPercent: Number(opacity), rotateDegree: -30, gapPx: 220, colorMode: color }
    const result = await outputImage(image, options, copy, signal)
    if (result && mounted.current) { setStatus(result); await showToast({ style: Toast.Style.Success, title: result }) }
  })
  useEffect(() => {
    mounted.current = true
    if (clipboardFirst) void load(true)
    return () => { mounted.current = false; pending.current?.abort() }
  }, [])
  const visible = image && image.fileName.toLowerCase().includes(search.trim().toLowerCase())
  return <List navigationTitle="防盗水印" isLoading={loading} isShowingDetail={false} searchText={search} onSearchTextChange={setSearch} searchBarPlaceholder="搜索已选图片…"
    actions={<ActionPanel>
      {clipboardFirst ? <Action title="读取剪贴板图片" icon={Icon.Clipboard} onAction={() => load(true)} /> : <Action title="选择原图…" icon={Icon.Folder} onAction={() => load(false)} />}
      {clipboardFirst ? <Action title="选择原图…" icon={Icon.Folder} onAction={() => load(false)} /> : <Action title="读取剪贴板图片" icon={Icon.Clipboard} onAction={() => load(true)} />}
    </ActionPanel>}
    filterBar={{ summaryText: status, actions: [
      { id: 'pick', title: '选择原图', onAction: () => load(false) },
      { id: 'clipboard', title: '读取剪贴板', onAction: () => load(true) }
    ] }}
    workbenchPanel={{ title: '水印参数', fields: [
      { id: 'template', label: '文字模板', type: 'select', value: template, options: presets.map(p => ({ label: p.scenarioTag, value: p.rawText })), onChange: (value: unknown) => { if (!pending.current && presets.some(p => p.rawText === value)) setTemplate(String(value)) } },
      { id: 'business', label: '用途（在动作面板修改）', type: 'info', value: business },
      { id: 'opacity', label: '不透明度', type: 'select', value: opacity, options: ['15', '25', '35'].map(value => ({ label: value + '%', value })), onChange: (value: unknown) => { if (!pending.current && ['15', '25', '35'].includes(String(value))) setOpacity(String(value)) } },
      { id: 'color', label: '文字颜色', type: 'select', value: color, options: [{ label: '深灰（浅色原图）', value: 'dark' }, { label: '浅灰（深色原图）', value: 'light' }], onChange: (value: unknown) => { if (!pending.current && (value === 'dark' || value === 'light')) setColor(value) } }
    ], previewCard: { title: text, subtitle: '斜向平铺；输出 PNG，保留原图尺寸' } }}
    subList={{ title: '待处理图片', emptyText: image ? '没有匹配的图片' : '选择 JPG、PNG、WebP 原图，或读取剪贴板图片', items: visible ? [
      <List.Item key="image" id="image" title={image.fileName} subtitle={`${image.width} × ${image.height} · ${(image.rawBytes.length / 1024 / 1024).toFixed(2)} MiB`} icon={Icon.Image}
        actions={<ActionPanel>
          <Action title={clipboardFirst ? '复制加水印图片' : '另存加水印图片…'} onAction={() => output(clipboardFirst)} />
          <Action title={clipboardFirst ? '另存加水印图片…' : '复制加水印图片'} onAction={() => output(!clipboardFirst)} />
          <Action title="修改水印用途…" onAction={() => { if (!pending.current) push(<BusinessForm initial={business} saved={setBusiness} />) }} />
        </ActionPanel>} />
    ] : [] }} />
}
export const commands = {
  'id-watermark-workbench': () => IdWatermarkCommand(),
  'id-watermark-clipboard-fast': () => IdWatermarkCommand({ clipboardFirst: true })
}
export default IdWatermarkCommand
