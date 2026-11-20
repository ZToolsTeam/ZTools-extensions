import React, { List, Form, ActionPanel, Action, Icon, Clipboard, showToast, ToastStyle, useState, useMemo, useNavigation, useRef, useEffect, useLocale } from '@ztools/declarative-ui'
import { createCompatFileInputProps, isDeclarativeFileInputSupported } from './host-compat.js'
import { optimizeSvgSource, extractDroppedSvgPath, pickSvgFilePath, readSvgFileContent } from './svg-service.js'
import { t } from './i18n.js'

export * from './types.js'
export * from './svg-service.js'

/** 快捷键文案按平台区分：macOS 只写 ⌘，Windows 写 Ctrl */
export function modEnterLabel(): string {
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  return /Mac/i.test(nav?.platform || nav?.userAgent || '') ? '⌘Enter' : 'Ctrl+Enter'
}

export function SvgSourceForm({ initial, save }: { initial: string; save: (source: string) => void }) {
  useLocale()
  const [source, setSource] = useState(initial), { pop } = useNavigation()
  const submit = async () => {
    try { optimizeSvgSource(source); save(source); pop() }
    catch (error) { await showToast({ style: ToastStyle.Failure, title: t('toastValidationFailed'), message: error instanceof Error ? error.message : String(error) }) }
  }
  return <Form navigationTitle={t('formNavTitle')} actions={<ActionPanel><Action.SubmitForm title={t('formSubmitTitle')} onSubmit={submit} /></ActionPanel>}>
    <Form.TextArea id="source" title={t('formFieldTitle')} value={source} onChange={setSource} />
    <Form.Description text={t('formDesc', { modEnter: modEnterLabel() })} />
  </Form>
}

/** 清理后 SVG 的真实渲染预览：以图片方式显示（不执行脚本、不插入界面 DOM），看清理是否改变了外观 */
function previewImage(base64DataUri: string): string {
  return `![${t('previewAlt')}](${base64DataUri})\n\n`
}

function codeBlock(source: string, language: string): string {
  let length = 3
  for (const match of source.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1)
  const fence = '`'.repeat(length)
  return `${fence}${language}\n${source}\n${fence}`
}

export function SvgIconStudioCommand() {
  const locale = useLocale()
  const [rawSvg, setRawSvg] = useState('')
  const [query, setQuery] = useState(''), { push } = useNavigation()
  const revision = useRef(0), mounted = useRef(true)
  useEffect(() => () => { mounted.current = false; revision.current++ }, [])
  const loadSvgFromFile = async (filePath: string): Promise<void> => {
    const request = ++revision.current
    try {
      const text = await readSvgFileContent(filePath)
      if (!mounted.current || request !== revision.current) return
      updateSource(text || '')
      optimizeSvgSource(text || '')
      await showToast({ style: ToastStyle.Success, title: t('toastLoadedSuccess') })
    } catch (error) {
      if (!mounted.current || request !== revision.current) return
      await showToast({ style: ToastStyle.Failure, title: t('toastLoadFailed'), message: error instanceof Error ? error.message : String(error) })
    }
  }
  const handlePickSvgFile = async (): Promise<void> => {
    try {
      const picked = await pickSvgFilePath()
      if (picked.canceled || !picked.filePath || !mounted.current) return
      await loadSvgFromFile(picked.filePath)
    } catch (error) {
      if (!mounted.current) return
      await showToast({ style: ToastStyle.Failure, title: t('toastLoadFailed'), message: error instanceof Error ? error.message : String(error) })
    }
  }
  const handleDrop = (envelope: unknown) => {
    const dropped = extractDroppedSvgPath(envelope)
    if (!dropped) {
      void showToast({ style: ToastStyle.Failure, title: t('toastLoadFailed'), message: t('toastDropInvalid') })
      return
    }
    void loadSvgFromFile(dropped)
  }
  const fileInputProps = createCompatFileInputProps(
    files => handleDrop({ files }),
    {
      extensions: ['.svg'],
      onTextPaste: async (text: string) => {
        if (!/<svg/i.test(text)) {
          await showToast({ style: ToastStyle.Failure, title: t('toastLoadFailed'), message: t('toastPasteInvalid') })
          return
        }
        const request = ++revision.current
        try {
          updateSource(text)
          optimizeSvgSource(text)
          if (!mounted.current || request !== revision.current) return
          await showToast({ style: ToastStyle.Success, title: t('toastLoadedSuccess') })
        } catch (error) {
          if (!mounted.current || request !== revision.current) return
          await showToast({ style: ToastStyle.Failure, title: t('toastLoadFailed'), message: error instanceof Error ? error.message : String(error) })
        }
      }
    }
  )
  useEffect(() => {
    if (isDeclarativeFileInputSupported()) return undefined
    const w = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : null
    const eventsApi = (w?.ztools as { events?: { on?: (ev: string, cb: (payload: unknown) => void) => unknown; off?: (ev: string, cb: (payload: unknown) => void) => void } } | undefined)?.events
    if (!eventsApi || typeof eventsApi.on !== 'function') return undefined
    const dispose = eventsApi.on('plugin_files_dropped', handleDrop)
    return () => {
      if (typeof dispose === 'function') (dispose as () => void)()
      else if (typeof eventsApi.off === 'function') eventsApi.off('plugin_files_dropped', handleDrop)
    }
  }, [])
  const updateSource = (source: string) => { setRawSvg(source); setQuery('') }
  const saveSource = (source: string) => { revision.current++; updateSource(source) }
  const editSource = () => { revision.current++; push(<SvgSourceForm initial={rawSvg} save={saveSource} />) }
  const svgState = useMemo(() => {
    if (!rawSvg.trim()) return { status: 'empty' as const }
    try { return { status: 'ready' as const, result: optimizeSvgSource(rawSvg) } }
    catch (error) { return { status: 'error' as const, error: error instanceof Error ? error.message : String(error) } }
  }, [rawSvg, locale])
  const handleLoadClipboard = async (): Promise<void> => {
    const request = ++revision.current
    try {
      const text = await Clipboard.readText()
      if (!mounted.current || request !== revision.current) return
      updateSource(text || '')
      optimizeSvgSource(text || '')
      await showToast({ style: ToastStyle.Success, title: t('toastLoadedSuccess') })
    } catch (error) {
      if (!mounted.current || request !== revision.current) return
      await showToast({ style: ToastStyle.Failure, title: t('toastLoadFailed'), message: error instanceof Error ? error.message : String(error) })
    }
  }
  const result = svgState.status === 'ready' ? svgState.result : null
  const exports = result ? [
    { id: 'svg', title: t('exportSvgTitle'), subtitle: t('exportSvgSub'), language: 'xml', content: result.optimizedSvg },
    { id: 'react', title: t('exportReactTitle'), subtitle: t('exportReactSub'), language: 'tsx', content: result.reactTsxCode },
    { id: 'vue', title: t('exportVueTitle'), subtitle: t('exportVueSub'), language: 'vue', content: result.vueSfcCode },
    { id: 'uri', title: t('exportUriTitle'), subtitle: t('exportUriSub'), language: 'text', content: result.dataUri },
  ] : []
  const summary = result ? `${result.metrics.originalBytes} B → ${result.metrics.optimizedBytes} B · ${result.metrics.savedBytes >= 0 ? t('summaryReduced') : t('summaryIncreased')} ${Math.abs(result.metrics.savedBytes)} B${result.metrics.removedItems ? t('summaryRemovedItems', { count: result.metrics.removedItems }) : ''}` : ''
  return (
    <List
      {...fileInputProps}
      isShowingDetail={true}
      searchBarPlaceholder={t('searchPlaceholder')}
      searchText={query}
      onSearchTextChange={setQuery}
      filterBar={result ? { summaryText: summary, actions: [
        { id: 'load', title: t('actionLoadClipboard'), onAction: () => void handleLoadClipboard() },
        { id: 'edit', title: t('actionEditSource'), onAction: editSource },
        { id: 'pick-file', title: t('actionPickFile'), onAction: () => void handlePickSvgFile() },
      ] } : undefined}
    >
      {!result && (
        <List.Item
          id="svg-input"
          title={svgState.status === 'error' ? t('emptyErrorTitle') : t('emptyReadyTitle')}
          subtitle={svgState.status === 'error' ? svgState.error : t('emptyReadySub')}
          icon={svgState.status === 'error' ? Icon.ExclamationMark : Icon.Code}
          detail={<List.Item.Detail markdown={svgState.status === 'error' ? codeBlock(svgState.error, 'text') : t('emptyReadyDetail', { modEnter: modEnterLabel() })} />}
          actions={<ActionPanel>
            <Action title={t('actionLoadFromClipboard')} icon={Icon.Clipboard} onAction={() => void handleLoadClipboard()} />
            <Action title={t('actionEditSource')} icon={Icon.Code} onAction={editSource} shortcut={{ modifiers: ['cmd'], key: 'enter' }} />
            <Action title={t('actionPickSvgFile')} icon={Icon.Folder} onAction={() => void handlePickSvgFile()} />
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
          detail={<List.Item.Detail markdown={`${previewImage(result!.base64DataUri)}${result!.warnings.length ? t('warningsHeading', { warnings: codeBlock(result!.warnings.join('\n'), 'text') }) : ''}${codeBlock(item.content, item.language)}`} />}
          actions={<ActionPanel>
            <Action.CopyToClipboard title={t('actionCopyPrefix', { title: item.title })} content={item.content} />
            {item.id === 'uri' && <Action.CopyToClipboard title={t('actionCopyBase64Uri')} content={result!.base64DataUri} shortcut={{ modifiers: ['cmd'], key: 'enter' }} />}
          </ActionPanel>}
        />
      ))}
    </List>
  )
}

export default SvgIconStudioCommand
