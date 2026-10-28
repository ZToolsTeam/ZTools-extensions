import React, { Action, ActionPanel, Detail, Icon, List, Toast, showToast, useEffect, useMemo, useRef, useState } from '@ztools/declarative-ui'
import { MediaClient, mediaSize } from './media-service.js'
import type { CleaningMode, MediaMetadataSummary, SavedMedia } from './types.js'
export * from './types.js'
export * from './media-service.js'

export function MediaMetadataCommand({ featureCode = 'media-metadata-workbench' }: { featureCode?: string } = {}) {
  const client = useMemo(() => new MediaClient(), [])
  const active = useRef<AbortController | null>(null), alive = useRef(true), source = useRef('')
  const [summary, setSummary] = useState<MediaMetadataSummary | null>(null), [saved, setSaved] = useState<SavedMedia | null>(null)
  const [mode, setMode] = useState<CleaningMode>('location'), [query, setQuery] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => () => { alive.current = false; active.current?.abort(); source.current = '' }, [])
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
  const pick = () => operate(async signal => {
    const selected = await client.choose(signal)
    if (!selected) return
    signal.throwIfAborted()
    const info = await client.inspect(selected, signal)
    if (alive.current && !signal.aborted) { source.current = selected; setSummary(info); setSaved(null) }
  })
  const clean = () => operate(async signal => {
    if (!summary?.canClean || !source.current) throw new Error('请选择支持清理的照片')
    const extension = summary.type === 'JPEG' ? 'jpg' : summary.type === 'PNG' ? 'png' : 'heic'
    const output = await client.choose(signal, summary.name.replace(/\.[^.]+$/, '') + `_clean.${extension}`)
    if (!output) return
    signal.throwIfAborted()
    const result = await client.clean(source.current, summary, output, mode, signal)
    if (alive.current && !signal.aborted) {
      setSaved(result)
      await showToast({ style: Toast.Style.Success, title: '副本已保存，定位标签检查通过', message: `${result.name} · ${mediaSize(result.size)}` })
    }
  })
  const readonly = featureCode === 'media-stream-info'
  const visible = summary && summary.name.toLowerCase().includes(query.trim().toLowerCase())
  const details = <Detail markdown="读取自文件的元数据；未识别到的字段不代表不存在。" metadata={<Detail.Metadata>{summary?.fields.map(field => <Detail.Metadata.Label key={field.key} title={field.key} text={field.value} />)}</Detail.Metadata>} />
  return <List navigationTitle={readonly ? '媒体参数' : '照片隐私清理'} isLoading={busy} isShowingDetail={false} searchText={query} onSearchTextChange={setQuery} searchBarPlaceholder="搜索已选文件…"
    filterBar={{ summaryText: error || (saved ? `已另存 ${saved.name} · ${mediaSize(saved.size)}` : '仅在本机处理，原文件保留 · 单文件最大 16 MiB'), actions: [{ id: 'pick', title: '选择文件', onAction: pick }] }}
    workbenchPanel={{ title: readonly ? '参数查看' : '副本处理', fields: [
      ...(readonly ? [] : [{ id: 'mode', label: '清理内容', type: 'select' as const, value: mode, options: [{ label: '定位及相关附属元数据', value: 'location' }, { label: 'EXIF / XMP / IPTC（保留显示参数）', value: 'metadata' }], onChange: (v: unknown) => { if (!active.current && (v === 'location' || v === 'metadata')) setMode(v) } }]),
      { id: 'formats', label: '支持范围', type: 'info', value: 'JPEG / PNG / HEIC 可清理，音视频只查看真实参数' },
      { id: 'scope', label: '清理说明', type: 'info', value: '定位模式也移除 XMP、IPTC 和厂商注记；不处理画面、文件名或文字里的个人信息' }
    ] }}
    subList={{ title: '已选文件', emptyText: summary ? '没有匹配的文件' : '选择文件后读取元数据', items: visible ? [
      <List.Item id="media" key="media" title={summary.name} subtitle={`${summary.type} · ${mediaSize(summary.size)} · ${summary.hasLocation ? '检测到定位标签' : '未检测到已识别的定位标签'}`} icon={Icon.Document}
        actions={<ActionPanel>{summary.canClean && !readonly ? <Action title="清理并另存副本…" icon={Icon.Download} onAction={clean} /> : null}<Action.Push title="查看原始参数" target={details} /></ActionPanel>} />
    ] : [] }} />
}
export const commands = {
  'media-metadata-workbench': () => <MediaMetadataCommand />,
  'media-clean-gps-fast': () => <MediaMetadataCommand featureCode="media-clean-gps-fast" />,
  'media-stream-info': () => <MediaMetadataCommand featureCode="media-stream-info" />
}
export default MediaMetadataCommand
