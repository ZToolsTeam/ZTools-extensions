import React, { Action, ActionPanel, Detail, Icon, List, Toast, showToast, useEffect, useLocale, useMemo, useRef, useState } from '@ztools/declarative-ui'
import { createCompatFileInputProps, isDeclarativeFileInputSupported } from './host-compat.js'
import { t } from './i18n.js'
import { extractDroppedMediaPath, MediaClient, mediaSize, photoFormat } from './media-service.js'
import type { CleaningMode, MediaMetadataSummary, SavedMedia } from './types.js'
export * from './types.js'
export * from './media-service.js'

const MEDIA_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.mp4', '.mov', '.mp3', '.m4a', '.wav', '.flac']

/** 每个命令只说明自己处理的格式：只读命令写音视频，清理命令写照片 */
export function supportScope(featureCode: string): string {
  if (featureCode === 'media-stream-info') return t('scopeReadonly')
  if (featureCode === 'media-clean-gps-fast') return t('scopeCleanGps')
  return t('scopeWorkbench')
}

export function MediaMetadataCommand({ featureCode = 'media-metadata-workbench' }: { featureCode?: string } = {}) {
  useLocale()
  const client = useMemo(() => new MediaClient(), [])
  const active = useRef<AbortController | null>(null), alive = useRef(true), source = useRef('')
  const [summary, setSummary] = useState<MediaMetadataSummary | null>(null), [saved, setSaved] = useState<SavedMedia | null>(null)
  const [mode, setMode] = useState<CleaningMode>('location'), [query, setQuery] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function operate(task: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return
    const job = new AbortController(); active.current = job; setBusy(true); setError('')
    try { await task(job.signal) } catch (reason) {
      if (alive.current && !job.signal.aborted) {
        const message = reason instanceof Error ? reason.message : String(reason)
        setError(message); await showToast({ style: Toast.Style.Failure, title: message })
      }
    } finally { active.current = null; if (alive.current) setBusy(false) }
  }
  const handleFilesDropped = (envelopeOrPayload: unknown) => {
    void operate(async signal => {
      const selected = extractDroppedMediaPath(envelopeOrPayload)
      signal.throwIfAborted()
      const info = await client.inspect(selected, signal)
      if (alive.current && !signal.aborted) { source.current = selected; setSummary(info); setSaved(null) }
    })
  }
  const fileInputProps = createCompatFileInputProps(
    files => handleFilesDropped({ files }),
    { extensions: MEDIA_EXTENSIONS, allowClipboardImage: true }
  )
  useEffect(() => {
    alive.current = true
    if (isDeclarativeFileInputSupported()) {
      return () => {
        alive.current = false
        active.current?.abort()
        source.current = ''
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
      active.current?.abort()
      source.current = ''
      if (typeof dispose === 'function') dispose()
      else if (events && typeof events.off === 'function') events.off('plugin_files_dropped', handleFilesDropped)
    }
  }, [])
  const pick = () => operate(async signal => {
    const selected = await client.choose(signal)
    if (!selected) return
    signal.throwIfAborted()
    const info = await client.inspect(selected, signal)
    if (alive.current && !signal.aborted) { source.current = selected; setSummary(info); setSaved(null) }
  })
  const clean = () => operate(async signal => {
    if (!summary?.canClean || !source.current) throw new Error(t('errChooseCleanablePhoto'))
    const format = photoFormat(summary.type)
    if (!format) throw new Error(t('errChooseCleanablePhoto'))
    const output = await client.choose(signal, summary.name.replace(/\.[^.]+$/, '') + `_clean.${format.extensions[0]}`, summary.type)
    if (!output) return
    signal.throwIfAborted()
    const result = await client.clean(source.current, summary, output, mode, signal)
    if (alive.current && !signal.aborted) {
      setSaved(result)
      await showToast({ style: Toast.Style.Success, title: t('toastCleanedTitle'), message: `${result.name} · ${mediaSize(result.size)}` })
    }
  })
  const readonly = featureCode === 'media-stream-info'
  const visible = summary && summary.name.toLowerCase().includes(query.trim().toLowerCase())
  const details = <Detail markdown={t('detailMarkdown')} metadata={<Detail.Metadata>{summary?.fields.map(field => <Detail.Metadata.Label key={field.key} title={field.key} text={field.value} />)}</Detail.Metadata>} />
  return <List {...fileInputProps} navigationTitle={readonly ? t('navTitleReadonly') : t('navTitleClean')} isLoading={busy} isShowingDetail={false} searchText={query} onSearchTextChange={setQuery} searchBarPlaceholder={t('searchPlaceholder')}
    actions={<ActionPanel><Action title={t('actionChooseFileEllipsis')} icon={Icon.Folder} onAction={pick} /></ActionPanel>}
    filterBar={{ summaryText: error || (saved ? t('summarySaved', { name: saved.name, size: mediaSize(saved.size) }) : t('summaryLocalLimit')), actions: [{ id: 'pick', title: t('actionChooseFile'), onAction: pick }] }}
    workbenchPanel={{ title: readonly ? t('panelTitleReadonly') : t('panelTitleClean'), fields: [
      ...(readonly ? [] : [{ id: 'mode', label: t('fieldModeLabel'), type: 'select' as const, value: mode, options: [{ label: t('modeLocation'), value: 'location' }, { label: t('modeMetadata'), value: 'metadata' }], onChange: (v: unknown) => { if (!active.current && (v === 'location' || v === 'metadata')) setMode(v) } }]),
      { id: 'formats', label: t('fieldFormatsLabel'), type: 'info', value: supportScope(featureCode) },
      ...(readonly ? [] : [{ id: 'scope', label: t('fieldScopeLabel'), type: 'info' as const, value: t('fieldScopeValue') }])
    ] }}
    subList={{ title: t('subListTitle'), emptyText: summary ? t('emptyNoMatch') : t('emptyPickFirst'), items: visible ? [
      <List.Item id="media" key="media" title={summary.name} subtitle={`${summary.type} · ${mediaSize(summary.size)} · ${summary.hasLocation ? t('statusHasLocation') : t('statusNoLocation')}`} icon={Icon.Document}
        actions={<ActionPanel>{summary.canClean && !readonly ? <Action title={t('actionCleanAndSave')} icon={Icon.Download} onAction={clean} /> : null}<Action.Push title={t('actionViewRawMetadata')} target={details} /></ActionPanel>} />
    ] : [] }} />
}
export const commands = {
  'media-metadata-workbench': () => <MediaMetadataCommand />,
  'media-clean-gps-fast': () => <MediaMetadataCommand featureCode="media-clean-gps-fast" />,
  'media-stream-info': () => <MediaMetadataCommand featureCode="media-stream-info" />
}
export default MediaMetadataCommand
