import React, { List, ActionPanel, Action, Icon, showToast, Toast, useLocale, useState, useRef, useEffect, useMemo } from '@ztools/declarative-ui'
import { createCompatFileInputProps, isDeclarativeFileInputSupported } from './host-compat.js'
import type { FileReference, OfficeDocSummary, OfficeResult } from './types.js'
import { extractDroppedOfficeDoc, formatOfficeBytes, OfficeClient } from './office-slim-service.js'
import { t } from './i18n.js'

export * from './types.js'
export * from './office-slim-service.js'

const OFFICE_EXTENSIONS = ['.docx', '.pptx', '.xlsx']

export function OfficeSlim({ featureCode = 'office-slim-workbench' }: { featureCode?: string } = {}) {
  useLocale()
  const client = useMemo(() => new OfficeClient(), [])
  const ref = useRef<FileReference | null>(null), operation = useRef<AbortController | null>(null), mounted = useRef(true)
  const [summary, setSummary] = useState<OfficeDocSummary | null>(null)
  const [result, setResult] = useState<OfficeResult | null>(null)
  const [loading, setLoading] = useState(false), [error, setError] = useState('')
  const [clean, setClean] = useState(true), [search, setSearch] = useState('')
  const mode = featureCode === 'office-extract-images' ? 'extract' : 'slim'
  const run = async (task: (signal: AbortSignal) => Promise<void>) => {
    if (operation.current) return
    const controller = new AbortController(); operation.current = controller; setLoading(true); setError('')
    try { await task(controller.signal) } catch (failure) {
      if (mounted.current && !controller.signal.aborted) {
        const message = failure instanceof Error ? failure.message : String(failure)
        setError(message); await showToast({ style: Toast.Style.Failure, title: message })
      }
    } finally { if (operation.current === controller) operation.current = null; if (mounted.current) setLoading(false) }
  }
  const handleFilesDropped = (envelopeOrPayload: unknown) => {
    void run(async signal => {
      const chosen = extractDroppedOfficeDoc(envelopeOrPayload)
      signal.throwIfAborted()
      const inspected = await client.inspect(chosen, signal)
      signal.throwIfAborted()
      if (!mounted.current) return
      ref.current = chosen; setSummary(inspected); setResult(null)
    })
  }
  const fileInputProps = createCompatFileInputProps(
    files => handleFilesDropped({ files }),
    { extensions: OFFICE_EXTENSIONS }
  )
  useEffect(() => {
    mounted.current = true
    if (isDeclarativeFileInputSupported()) {
      return () => {
        mounted.current = false
        operation.current?.abort()
        ref.current = null
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
      mounted.current = false
      operation.current?.abort()
      ref.current = null
      if (typeof dispose === 'function') dispose()
      else if (events && typeof events.off === 'function') events.off('plugin_files_dropped', handleFilesDropped)
    }
  }, [])
  const pick = () => run(async signal => {
    const chosen = await client.choose('open', undefined, signal)
    if (!chosen) return
    signal.throwIfAborted()
    const inspected = await client.inspect(chosen, signal)
    signal.throwIfAborted()
    if (!mounted.current) return
    ref.current = chosen; setSummary(inspected); setResult(null)
  })
  const process = () => run(async signal => {
    if (!ref.current || !summary) throw new Error(t('errSelectDocFirst'))
    if (mode === 'extract' && summary.images.length === 0) throw new Error(t('errNoImagesToExtract'))
    const defaultName = summary.name.replace(/\.(docx|pptx|xlsx)$/i, '') + (mode === 'extract' ? '_images.zip' : `_slim.${summary.type}`)
    const save = await client.choose('save', defaultName, signal)
    if (!save) return
    signal.throwIfAborted()
    const completed = await client.process(ref.current, summary, save, mode, clean, signal)
    if (mounted.current && !signal.aborted) {
      setResult(completed)
      await showToast({ style: Toast.Style.Success, title: t('toastSavedTitle'), message: `${completed.name} · ${formatOfficeBytes(completed.size)}` })
    }
  })
  const visible = summary && summary.name.toLowerCase().includes(search.trim().toLowerCase())
  return <List {...fileInputProps} isLoading={loading} isShowingDetail={false} searchText={search} onSearchTextChange={setSearch} searchBarPlaceholder={t('searchPlaceholder')}
    actions={<ActionPanel><Action title={t('actionPickDocEllipsis')} icon={Icon.Folder} onAction={pick} /></ActionPanel>}
    filterBar={{ summaryText: error || (result ? t('summarySaved', { name: result.name, size: formatOfficeBytes(result.size), originalSize: formatOfficeBytes(result.originalSize) }) : t('summaryDefault')), actions: [{ id: 'pick', title: t('btnPickDoc'), onAction: pick }] }}
    workbenchPanel={{ title: mode === 'extract' ? t('panelTitleExtract') : t('panelTitleSlim'), subtitle: t('panelSubtitle'), fields: [
      { id: 'method', label: t('fieldMethodLabel'), type: 'info', value: mode === 'extract' ? t('fieldMethodExtract') : t('fieldMethodSlim') },
      ...(mode === 'slim' ? [{ id: 'clean', label: t('fieldCleanLabel'), type: 'toggle' as const, value: clean, onChange: (value: unknown) => { if (!operation.current) setClean(value === true) } }] : []),
      { id: 'scope', label: t('fieldScopeLabel'), type: 'info', value: mode === 'extract' ? t('fieldScopeExtract') : t('fieldScopeSlim') }
    ] }}
    subList={{ title: t('subListTitle'), emptyText: summary ? t('emptyNoMatch') : t('emptySelectDoc'), items: visible ? [
      <List.Item key="document" id="document" title={summary.name} subtitle={t('itemSubtitle', {
        size: formatOfficeBytes(summary.size),
        imageCount: summary.images.length,
        authorStatus: summary.hasAuthor ? t('hasAuthorYes') : t('hasAuthorNo'),
        commentsStatus: summary.hasComments ? t('hasCommentsYes') : t('hasCommentsNo')
      })} icon={Icon.Document}
        actions={<ActionPanel><Action title={mode === 'extract' ? t('actionExtractZip') : t('actionProcessSave')} icon={Icon.Download} onAction={process} /></ActionPanel>} />
    ] : [] }} />
}
export const commands = {
  'office-slim-workbench': () => <OfficeSlim />,
  'office-clean-metadata': () => <OfficeSlim featureCode="office-clean-metadata" />,
  'office-extract-images': () => <OfficeSlim featureCode="office-extract-images" />
}
export const OfficeSlimCommand = OfficeSlim
export default OfficeSlim
