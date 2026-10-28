import React, { List, Form, ActionPanel, Action, Icon, Clipboard, showToast, ToastStyle, useState, useMemo, useNavigation, useRef, useEffect } from '@ztools/declarative-ui'
import { optimizeSvgSource } from './svg-service.js'

export * from './types.js'
export * from './svg-service.js'

export function SvgSourceForm({ initial, save }: { initial: string; save: (source: string) => void }) {
  const [source, setSource] = useState(initial), { pop } = useNavigation()
  const submit = async () => {
    try { optimizeSvgSource(source); save(source); pop() }
    catch (error) { await showToast({ style: ToastStyle.Failure, title: 'SVG 校验未通过', message: error instanceof Error ? error.message : String(error) }) }
  }
  return <Form navigationTitle="编辑 SVG 源码" actions={<ActionPanel><Action.SubmitForm title="校验并生成" onSubmit={submit} /></ActionPanel>}>
    <Form.TextArea id="source" title="SVG 源码" value={source} onChange={setSource} />
    <Form.Description text="保留多行文字和空白；最多 256 KiB。⌘/Ctrl+Enter 校验并生成，Esc 取消修改。" />
  </Form>
}

function codeBlock(source: string, language: string): string {
  let length = 3
  for (const match of source.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1)
  const fence = '`'.repeat(length)
  return `${fence}${language}\n${source}\n${fence}`
}

export function SvgIconStudioCommand() {
  const [rawSvg, setRawSvg] = useState('')
  const [query, setQuery] = useState(''), { push } = useNavigation()
  const revision = useRef(0), mounted = useRef(true)
  useEffect(() => () => { mounted.current = false; revision.current++ }, [])
  const updateSource = (source: string) => { setRawSvg(source); setQuery('') }
  const saveSource = (source: string) => { revision.current++; updateSource(source) }
  const editSource = () => { revision.current++; push(<SvgSourceForm initial={rawSvg} save={saveSource} />) }
  const svgState = useMemo(() => {
    if (!rawSvg.trim()) return { status: 'empty' as const }
    try { return { status: 'ready' as const, result: optimizeSvgSource(rawSvg) } }
    catch (error) { return { status: 'error' as const, error: error instanceof Error ? error.message : String(error) } }
  }, [rawSvg])
  const handleLoadClipboard = async (): Promise<void> => {
    const request = ++revision.current
    try {
      const text = await Clipboard.readText()
      if (!mounted.current || request !== revision.current) return
      updateSource(text || '')
      optimizeSvgSource(text || '')
      await showToast({ style: ToastStyle.Success, title: '已载入并校验 SVG' })
    } catch (error) {
      if (!mounted.current || request !== revision.current) return
      await showToast({ style: ToastStyle.Failure, title: '未能载入有效 SVG', message: error instanceof Error ? error.message : String(error) })
    }
  }
  const result = svgState.status === 'ready' ? svgState.result : null
  const exports = result ? [
    { id: 'svg', title: '清理后的 SVG', subtitle: '保留文字、空白和数值精度', language: 'xml', content: result.optimizedSvg },
    { id: 'react', title: 'React TSX 组件', subtitle: '字符串文本与属性，支持 SVGProps', language: 'tsx', content: result.reactTsxCode },
    { id: 'vue', title: 'Vue 3 SFC 组件', subtitle: 'script setup，文本按字面内容保留', language: 'vue', content: result.vueSfcCode },
    { id: 'uri', title: 'Data URI', subtitle: 'UTF-8；次动作复制 Base64', language: 'text', content: result.dataUri },
  ] : []
  const summary = result ? `${result.metrics.originalBytes} B → ${result.metrics.optimizedBytes} B · ${result.metrics.savedBytes >= 0 ? '减少' : '增加'} ${Math.abs(result.metrics.savedBytes)} B${result.metrics.removedItems ? ` · 移除 ${result.metrics.removedItems} 项，请检查外观` : ''}` : ''
  return (
    <List
      isShowingDetail={true}
      searchBarPlaceholder="筛选导出格式；SVG 请用编辑源码或载入剪贴板"
      searchText={query}
      onSearchTextChange={setQuery}
      filterBar={result ? { summaryText: summary, actions: [
        { id: 'load', title: '载入剪贴板', onAction: () => void handleLoadClipboard() },
        { id: 'edit', title: '编辑源码', onAction: editSource },
      ] } : undefined}
    >
      {!result && (
        <List.Item
          id="svg-input"
          title={svgState.status === 'error' ? 'SVG 无法处理' : '载入 SVG 源码开始'}
          subtitle={svgState.status === 'error' ? svgState.error : '仅在本地处理静态 SVG，支持最多 256 KiB'}
          icon={svgState.status === 'error' ? Icon.ExclamationMark : Icon.Code}
          detail={<List.Item.Detail markdown={svgState.status === 'error' ? codeBlock(svgState.error, 'text') : '按 Enter 从剪贴板载入完整 SVG；按 ⌘/Ctrl+Enter 打开多行源码编辑器。\n\n保留文字、空白与坐标精度；移除的内容会列出提示。复杂样式或无效 XML 会停止处理。'} />}
          actions={<ActionPanel>
            <Action title="从剪贴板载入 SVG" icon={Icon.Clipboard} onAction={() => void handleLoadClipboard()} />
            <Action title="编辑源码" icon={Icon.Code} onAction={editSource} shortcut={{ modifiers: ['cmd'], key: 'enter' }} />
          </ActionPanel>}
        />
      )}
      {exports.filter(item => item.title.toLowerCase().includes(query.trim().toLowerCase())).map(item => (
        <List.Item
          key={item.id}
          id={item.id}
          title={item.title}
          subtitle={item.subtitle}
          icon={Icon.Code}
          detail={<List.Item.Detail markdown={`${result!.warnings.length ? `清理提示（可能改变外观）：\n\n${codeBlock(result!.warnings.join('\n'), 'text')}\n\n` : ''}${codeBlock(item.content, item.language)}`} />}
          actions={<ActionPanel>
            <Action.CopyToClipboard title={`复制${item.title}`} content={item.content} />
            {item.id === 'uri' && <Action.CopyToClipboard title="复制 Base64 Data URI" content={result!.base64DataUri} shortcut={{ modifiers: ['cmd'], key: 'enter' }} />}
          </ActionPanel>}
        />
      ))}
    </List>
  )
}

export default SvgIconStudioCommand
