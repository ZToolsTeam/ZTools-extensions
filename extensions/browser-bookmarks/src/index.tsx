import React, { List, Detail, Action, ActionPanel, Icon, Toast, showToast, useEffect, useMemo, useRef, useState, useNavigation } from '@ztools/declarative-ui'
import { BROWSERS, type BookmarkItem, type BrowserFilterValue } from './types.js'
import { scanAllBrowserBookmarksWithMeta, searchAndFilterBookmarks, formatBookmarkDate, bookmarkMarkdown } from './bookmark-scanner.js'
export * from './types.js'
export * from './bookmark-scanner.js'
const message = (error: unknown) => error instanceof Error ? error.message : '读取书签失败'
const markdownText = (text: string) => text.replace(/[\\`*_{}\[\]()<>#!|]/g, value => `\\${value}`)

export default function BrowserBookmarks({ initialFilter = 'all' }: { initialFilter?: BrowserFilterValue } = {}) {
  const [items, setItems] = useState<BookmarkItem[]>([]), [warnings, setWarnings] = useState<string[]>([]), [sources, setSources] = useState(0)
  const [query, setQuery] = useState(''), [filter, setFilter] = useState<BrowserFilterValue>(initialFilter), [visible, setVisible] = useState(200)
  const [loading, setLoading] = useState(true), [error, setError] = useState('')
  const pending = useRef<AbortController | null>(null), mounted = useRef(true), { push } = useNavigation()
  const reload = async () => {
    if (pending.current) return
    const task = new AbortController(); pending.current = task; setLoading(true); setError('')
    try {
      const result = await scanAllBrowserBookmarksWithMeta(task.signal)
      if (mounted.current) { setItems(result.bookmarks); setWarnings(result.warnings); setSources(result.sourcesRead); setVisible(200) }
    } catch (failure) {
      if (mounted.current && !task.signal.aborted) { setError(message(failure)); await showToast(Toast.Style.Failure, '书签未更新', message(failure)) }
    } finally { pending.current = null; if (mounted.current) setLoading(false) }
  }
  useEffect(() => { mounted.current = true; void reload(); return () => { mounted.current = false; pending.current?.abort() } }, [])
  const filtered = useMemo(() => searchAndFilterBookmarks(items, query, filter), [items, query, filter])
  const details = [error, ...warnings].filter(Boolean)
  const summary = loading ? '正在读取本机书签…' : `${error ? '刷新失败，保留上次结果 · ' : warnings.length ? '部分来源未读取 · ' : ''}${sources} 个配置 · 显示 ${Math.min(visible, filtered.length)} / ${filtered.length} 条`
  return <List isShowingDetail={false} isLoading={loading} searchText={query} onSearchTextChange={value => { setQuery(value); setVisible(200) }} searchBarPlaceholder="搜索标题、拼音、网址或文件夹；domain: 限定域名"
    searchBarAccessory={<List.Dropdown value={filter} onChange={value => { setFilter(value as BrowserFilterValue); setVisible(200) }} tooltip="按浏览器筛选">
      <List.Dropdown.Item title="全部浏览器" value="all" />
      {Object.entries(BROWSERS).map(([value, title]) => <List.Dropdown.Item key={value} value={value} title={title} />)}
      <List.Dropdown.Item title="国内浏览器（360 / QQ）" value="domestic" />
    </List.Dropdown>}
    filterBar={{ summaryText: summary, actions: [
      { id: 'refresh', title: '刷新书签', onAction: reload },
      ...(details.length ? [{ id: 'errors', title: '读取详情', onAction: () => push(<Detail navigationTitle="书签读取详情" markdown={details.map(value => markdownText(value)).join('\n\n')} />) }] : [])
    ] }}>
    {filtered.slice(0, visible).map(item => <List.Item key={item.id} id={item.id} title={item.title} icon={Icon.Globe}
      subtitle={[item.folderBreadcrumb, item.hostname].filter(Boolean).join(' · ')}
      accessories={[{ tag: `${item.browserLabel} / ${item.profile}` }, { text: formatBookmarkDate(item.dateAdded) }]}
      actions={<ActionPanel>
        <Action.OpenInBrowser title="打开网页" url={item.url} />
        <Action.CopyToClipboard title="复制链接" content={item.url} shortcut={{ modifiers: ['cmd'], key: 'enter' }} />
        <Action.CopyToClipboard title="复制 Markdown 链接" content={bookmarkMarkdown(item)} />
        <Action.CopyToClipboard title="复制标题" content={item.title} />
      </ActionPanel>} />)}
    {filtered.length > visible && <List.Item id="more" title={`显示更多书签（还剩 ${filtered.length - visible} 条）`} subtitle="搜索会检索全部已读取的书签" icon={Icon.ArrowDown}
      actions={<ActionPanel><Action title="显示更多" onAction={() => setVisible(count => count + 200)} /></ActionPanel>} />}
    {!loading && !filtered.length && <List.Item id="empty" title={error ? '书签读取失败' : warnings.length && !sources ? '未能读取浏览器书签' : query || filter !== 'all' ? '没有匹配的书签' : '未发现本机网页书签'}
      subtitle={error || (warnings.length && !sources ? '打开读取详情查看原因，处理后刷新' : '只读本机浏览器配置中的 HTTP / HTTPS 网页书签')} icon={Icon.Globe} />}
  </List>
}
export const commands = {
  'bookmarks-all': () => <BrowserBookmarks />,
  'bookmarks-edge': () => <BrowserBookmarks initialFilter="edge" />,
  'bookmarks-chrome': () => <BrowserBookmarks initialFilter="chrome" />,
  'bookmarks-domestic': () => <BrowserBookmarks initialFilter="domestic" />,
  'bookmarks-firefox': () => <BrowserBookmarks initialFilter="firefox" />
}
