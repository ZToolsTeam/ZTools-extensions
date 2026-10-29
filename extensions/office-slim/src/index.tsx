import React, { List, ActionPanel, Action, Icon, showToast, Toast, useState, useRef, useEffect, useMemo } from '@ztools/declarative-ui'
import type { FileReference, OfficeDocSummary, OfficeResult } from './types.js'
import { formatOfficeBytes, OfficeClient } from './office-slim-service.js'
export * from './types.js'
export * from './office-slim-service.js'

export function OfficeSlim({ featureCode = 'office-slim-workbench' }: { featureCode?: string } = {}) {
  const client = useMemo(() => new OfficeClient(), [])
  const ref = useRef<FileReference | null>(null), operation = useRef<AbortController | null>(null), mounted = useRef(true)
  const [summary, setSummary] = useState<OfficeDocSummary | null>(null)
  const [result, setResult] = useState<OfficeResult | null>(null)
  const [loading, setLoading] = useState(false), [error, setError] = useState('')
  const [clean, setClean] = useState(true), [search, setSearch] = useState('')
  const mode = featureCode === 'office-extract-images' ? 'extract' : 'slim'
  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false; operation.current?.abort()
    ref.current = null
  } }, [])
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
    if (!ref.current || !summary) throw new Error('请先选择文档')
    if (mode === 'extract' && summary.images.length === 0) throw new Error('文档中没有可导出的原图')
    const defaultName = summary.name.replace(/\.(docx|pptx|xlsx)$/i, '') + (mode === 'extract' ? '_images.zip' : `_slim.${summary.type}`)
    const save = await client.choose('save', defaultName, signal)
    if (!save) return
    signal.throwIfAborted()
    const completed = await client.process(ref.current, summary, save, mode, clean, signal)
    if (mounted.current && !signal.aborted) {
      setResult(completed)
      await showToast({ style: Toast.Style.Success, title: '新副本已保存并通过校验', message: `${completed.name} · ${formatOfficeBytes(completed.size)}` })
    }
  })
  const visible = summary && summary.name.toLowerCase().includes(search.trim().toLowerCase())
  return <List isLoading={loading} isShowingDetail={false} searchText={search} onSearchTextChange={setSearch} searchBarPlaceholder="搜索已选文档…"
    actions={<ActionPanel><Action title="选择文档…" icon={Icon.Folder} onAction={pick} /></ActionPanel>}
    filterBar={{ summaryText: error || (result ? `已保存 ${result.name} · ${formatOfficeBytes(result.size)}（原文档 ${formatOfficeBytes(result.originalSize)}）` : '原文件保留，只另存新副本 · 单文档最大 16 MiB'), actions: [{ id: 'pick', title: '选择文档', onAction: pick }] }}
    workbenchPanel={{ title: mode === 'extract' ? '原图导出' : '文档处理', subtitle: '标准 OOXML · 图片保持原始字节', fields: [
      { id: 'method', label: '处理方式', type: 'info', value: mode === 'extract' ? '把全部原图打包为 ZIP' : '无损重新压缩文档结构' },
      ...(mode === 'slim' ? [{ id: 'clean', label: '移除作者属性与批注', type: 'toggle' as const, value: clean, onChange: (value: unknown) => { if (!operation.current) setClean(value === true) } }] : []),
      { id: 'scope', label: '说明', type: 'info', value: mode === 'extract' ? '图片按原始字节打包，不重新编码；原文档保持不变' : '不处理正文中的个人信息和修订内容；压缩后不一定更小' }
    ] }}
    subList={{ title: '待处理文档', emptyText: summary ? '没有匹配的文档' : '选择 Word、Excel 或 PowerPoint 文档', items: visible ? [
      <List.Item key="document" id="document" title={summary.name} subtitle={`${formatOfficeBytes(summary.size)} · ${summary.images.length} 张原图 · ${summary.hasAuthor ? '含作者属性' : '未检测到作者属性'} · ${summary.hasComments ? '含批注' : '未检测到批注'}`} icon={Icon.Document}
        actions={<ActionPanel><Action title={mode === 'extract' ? '导出原图 ZIP…' : '处理并另存副本…'} icon={Icon.Download} onAction={process} /></ActionPanel>} />
    ] : [] }} />
}
export const commands = {
  'office-slim-workbench': () => <OfficeSlim />,
  'office-clean-metadata': () => <OfficeSlim featureCode="office-clean-metadata" />,
  'office-extract-images': () => <OfficeSlim featureCode="office-extract-images" />
}
export const OfficeSlimCommand = OfficeSlim
export default OfficeSlim
