import React, { Action, ActionPanel, Form, Icon, List, Toast, showToast, useEffect, useLocale, useNavigation, useRef, useState } from '@ztools/declarative-ui'
import { getPresetWatermarkTemplates, resolveTemplate } from './watermark-service.js'
import { pickImage, readClipboardImage, readDroppedImage, outputImage } from './image-io.js'
import { createCompatFileInputProps, isDeclarativeFileInputSupported } from './host-compat.js'
import { t } from './i18n.js'
import type { ImageMetadata, WatermarkOptions } from './types.js'
export * from './types.js'
export * from './watermark-service.js'
export * from './image-codec.js'
export * from './image-io.js'

export function BusinessForm({ initial, saved }: { initial: string; saved: (value: string) => void }) {
  useLocale()
  const [value, setValue] = useState(initial), [error, setError] = useState('')
  const { pop } = useNavigation()
  const submit = () => {
    const name = value.trim()
    if (!name || Array.from(name).length > 80) { setError(t('errBusinessLength')); return }
    saved(name); pop()
  }
  return <Form navigationTitle={t('formNavTitle')} actions={<ActionPanel><Action.SubmitForm title={t('formSaveAction')} onSubmit={submit} /></ActionPanel>}>
    <Form.TextField id="business" title={t('formFieldTitle')} value={value} onChange={setValue} error={error} placeholder={t('formFieldPlaceholder')} />
  </Form>
}

export function IdWatermarkCommand({ clipboardFirst = false }: { clipboardFirst?: boolean } = {}) {
  const locale = useLocale()
  const [image, setImage] = useState<ImageMetadata | null>(null)
  const [customBusiness, setCustomBusiness] = useState<string | null>(null)
  const [templateId, setTemplateId] = useState('tpl-general')
  const [opacity, setOpacity] = useState('25')
  const [color, setColor] = useState<'dark' | 'light'>('dark')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [statusOverride, setStatusOverride] = useState<string | null>(null)
  const pending = useRef<AbortController | null>(null), mounted = useRef(true), { push } = useNavigation()
  const business = customBusiness ?? t('defaultBusiness')
  const presets = getPresetWatermarkTemplates(business)
  const activeTemplate = presets.find((p) => p.id === templateId)?.rawText ?? presets[0]?.rawText ?? t('tplGeneralRaw')
  const text = resolveTemplate(activeTemplate, business)
  const status = statusOverride ?? t('statusInitial')
  useEffect(() => {
    setStatusOverride(null)
  }, [locale])
  const run = async (job: (signal: AbortSignal) => Promise<void>) => {
    if (pending.current) return
    const controller = new AbortController(); pending.current = controller; setLoading(true)
    try { await job(controller.signal) }
    catch (error) {
      if (mounted.current && !controller.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error)
        setStatusOverride(message); await showToast({ style: Toast.Style.Failure, title: message })
      }
    } finally { if (pending.current === controller) pending.current = null; if (mounted.current) setLoading(false) }
  }
  const load = (clipboard: boolean) => run(async signal => {
    const result = await (clipboard ? readClipboardImage(signal) : pickImage(signal))
    signal.throwIfAborted()
    if (result && mounted.current) { setImage(result); setStatusOverride(t('statusLoadedImage')) }
  })
  const output = (copy: boolean) => run(async signal => {
    if (!image) throw new Error(t('errSelectImageFirst'))
    const options: WatermarkOptions = { text, opacityPercent: Number(opacity), rotateDegree: -30, gapPx: 220, colorMode: color }
    const result = await outputImage(image, options, copy, signal)
    if (result && mounted.current) { setStatusOverride(result); await showToast({ style: Toast.Style.Success, title: result }) }
  })
  useEffect(() => {
    mounted.current = true
    if (clipboardFirst) void load(true)
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
    const handleFilesDropped = (envelopeOrPayload: unknown) => {
      void run(async signal => {
        const result = await readDroppedImage(envelopeOrPayload, signal)
        signal.throwIfAborted()
        if (result && mounted.current) { setImage(result); setStatusOverride(t('statusLoadedImage')) }
      })
    }
    const dispose = !isDeclarativeFileInputSupported() && events && typeof events.on === 'function' ? events.on('plugin_files_dropped', handleFilesDropped) : undefined
    return () => {
      mounted.current = false
      pending.current?.abort()
      if (typeof dispose === 'function') dispose()
      else if (!isDeclarativeFileInputSupported() && events && typeof events.off === 'function') events.off('plugin_files_dropped', handleFilesDropped)
    }
  }, [])
  const fileInputProps = createCompatFileInputProps(
    (files) => {
      void run(async signal => {
        const result = await readDroppedImage({ files }, signal)
        signal.throwIfAborted()
        if (result && mounted.current) { setImage(result); setStatusOverride(t('statusLoadedImage')) }
      })
    },
    {
      extensions: ['.png', '.jpg', '.jpeg', '.webp', '.bmp'],
      allowClipboardImage: true
    }
  )
  const visible = image && image.fileName.toLowerCase().includes(search.trim().toLowerCase())
  return <List {...fileInputProps} navigationTitle={t('navTitle')} isLoading={loading} isShowingDetail={false} searchText={search} onSearchTextChange={setSearch} searchBarPlaceholder={t('searchPlaceholder')}
    actions={<ActionPanel>
      {clipboardFirst ? <Action title={t('actionReadClipboard')} icon={Icon.Clipboard} onAction={() => load(true)} /> : <Action title={t('actionPickImage')} icon={Icon.Folder} onAction={() => load(false)} />}
      {clipboardFirst ? <Action title={t('actionPickImage')} icon={Icon.Folder} onAction={() => load(false)} /> : <Action title={t('actionReadClipboard')} icon={Icon.Clipboard} onAction={() => load(true)} />}
    </ActionPanel>}
    filterBar={{ summaryText: status, actions: [
      { id: 'pick', title: t('barPickImage'), onAction: () => load(false) },
      { id: 'clipboard', title: t('barReadClipboard'), onAction: () => load(true) }
    ] }}
    workbenchPanel={{ title: t('panelTitle'), fields: [
      { id: 'template', label: t('fieldTemplate'), type: 'select', value: templateId, options: presets.map(p => ({ label: p.scenarioTag, value: p.id })), onChange: (value: unknown) => { if (!pending.current && presets.some(p => p.id === value)) setTemplateId(String(value)) } },
      { id: 'business', label: t('fieldBusiness'), type: 'info', value: business },
      { id: 'opacity', label: t('fieldOpacity'), type: 'select', value: opacity, options: ['15', '25', '35'].map(value => ({ label: value + '%', value })), onChange: (value: unknown) => { if (!pending.current && ['15', '25', '35'].includes(String(value))) setOpacity(String(value)) } },
      { id: 'color', label: t('fieldColor'), type: 'select', value: color, options: [{ label: t('colorDark'), value: 'dark' }, { label: t('colorLight'), value: 'light' }], onChange: (value: unknown) => { if (!pending.current && (value === 'dark' || value === 'light')) setColor(value) } }
    ], previewCard: { title: text, subtitle: t('previewSubtitle') } }}
    subList={{ title: t('subListTitle'), emptyText: image ? t('emptyMatched') : t('emptyNoImage'), items: visible ? [
      <List.Item key="image" id="image" title={image.fileName} subtitle={`${image.width} × ${image.height} · ${(image.rawBytes.length / 1024 / 1024).toFixed(2)} MiB`} icon={Icon.Image}
        actions={<ActionPanel>
          <Action title={clipboardFirst ? t('actionCopyWatermark') : t('actionSaveWatermark')} onAction={() => output(clipboardFirst)} />
          <Action title={clipboardFirst ? t('actionSaveWatermark') : t('actionCopyWatermark')} onAction={() => output(!clipboardFirst)} />
          <Action title={t('actionEditBusiness')} onAction={() => { if (!pending.current) push(<BusinessForm initial={business} saved={(val) => setCustomBusiness(val)} />) }} />
        </ActionPanel>} />
    ] : [] }} />
}
export const commands = {
  'id-watermark-workbench': () => IdWatermarkCommand(),
  'id-watermark-clipboard-fast': () => IdWatermarkCommand({ clipboardFirst: true })
}
export default IdWatermarkCommand
