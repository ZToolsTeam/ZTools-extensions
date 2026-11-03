import React, { List, Detail, Action, ActionPanel, Icon, Toast, showToast, useEffect, useMemo, useRef, useState, useNavigation } from '@ztools/declarative-ui'
import { type BookmarkItem, type BrowserFilterValue } from './types.js'
import { scanAllBrowserBookmarksWithMeta, searchAndFilterBookmarks, UnreadableSourcesError, FULL_DISK_ACCESS_GUIDE, hasSafariWarning, formatBookmarkDate, bookmarkMarkdown, browserOptions, detectPlatform, domesticLabel, emptyState, hasCredentials, type HostPlatform } from './bookmark-scanner.js'
export * from './types.js'
export * from './bookmark-scanner.js'
const message = (error: unknown) => error instanceof Error ? error.message : '读取书签失败'
const markdownText = (text: string) => text.replace(/[\\`*_{}\[\]()<>#!|]/g, value => `\\${value}`)

export default function BrowserBookmarks({ initialFilter = 'all', platform = detectPlatform() }: { initialFilter?: BrowserFilterValue; platform?: HostPlatform } = {}) {
  const [items, setItems] = useState<BookmarkItem[]>([]), [warnings, setWarnings] = useState<string[]>([]), [sources, setSources] = useState(0)
  const [query, setQuery] = useState(''), [filter, setFilter] = useState<BrowserFilterValue>(initialFilter), [visible, setVisible] = useState(200)
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [loadedOnce, setLoadedOnce] = useState(false), [unreadable, setUnreadable] = useState(false), [warningsPartial, setWarningsPartial] = useState(false)
  const pending = useRef<AbortController | null>(null), mounted = useRef(true), loadedOnceRef = useRef(false), { push } = useNavigation()
  loadedOnceRef.current = loadedOnce
  const reload = async () => {
    if (pending.current) return
    const task = new AbortController(); pending.current = task; setLoading(true); setError(''); setUnreadable(false); setWarningsPartial(false)
    try {
      const result = await scanAllBrowserBookmarksWithMeta(task.signal)
      if (mounted.current) { setItems(result.bookmarks); setWarnings(result.warnings); setSources(result.sourcesRead); setVisible(200); setLoadedOnce(true) }
    } catch (failure) {
      if (!mounted.current || task.signal.aborted) return
      // 从未读成功过且只是各来源都读不了：按来源原因展示，按所选浏览器给结论；读成功过则保留上次结果
      if (failure instanceof UnreadableSourcesError && !loadedOnceRef.current) { setWarnings(failure.warnings); setWarningsPartial(failure.partial); setSources(0); setUnreadable(true); return }
      setError(message(failure)); await showToast(Toast.Style.Failure, '书签未更新', message(failure))
    } finally { pending.current = null; if (mounted.current) setLoading(false) }
  }
  useEffect(() => { mounted.current = true; void reload(); return () => { mounted.current = false; pending.current?.abort() } }, [])
  const filtered = useMemo(() => searchAndFilterBookmarks(items, query, filter), [items, query, filter])
  const details = [error, ...warnings].filter(Boolean)
  const browserCount = new Set(items.map(item => item.browser)).size
  const status = error ? (loadedOnce ? '刷新失败，保留上次结果 · ' : '读取失败 · ') : unreadable ? '没有可读取的浏览器 · ' : warnings.length ? '部分来源未读取 · ' : ''
  const summary = loading ? '正在读取本机书签…' : `${status}${browserCount ? `来自 ${browserCount} 个浏览器 · ` : ''}显示 ${Math.min(visible, filtered.length)} / ${filtered.length} 条`
  const openDetails = () => push(<Detail navigationTitle="书签读取详情" markdown={details.map(value => markdownText(value)).join('\n\n') + (hasSafariWarning(warnings) ? `\n\n> Safari：${markdownText(FULL_DISK_ACCESS_GUIDE)}` : '')}
    actions={hasSafariWarning(warnings) ? <ActionPanel><Action.CopyToClipboard title="复制完全磁盘访问设置路径" content={FULL_DISK_ACCESS_GUIDE} /></ActionPanel> : undefined} />)
  const empty = emptyState({ items, warnings, sources, error, query, filter, platform, warningsPartial })
  const emptyFailed = /^(未能读取|未能确认|书签读取失败)/.test(empty.title)
  // 空状态行自带刷新与读取详情动作时，顶部状态条不再重复这两个按钮（同一功能只出现一次）
  const showEmpty = !loading && !filtered.length
  return <List isShowingDetail={false} isLoading={loading} searchText={query} onSearchTextChange={value => { setQuery(value); setVisible(200) }} searchBarPlaceholder="搜索标题、拼音、网址或文件夹；domain: 限定域名"
    searchBarAccessory={<List.Dropdown value={filter} onChange={value => { setFilter(value as BrowserFilterValue); setVisible(200) }} tooltip="按浏览器筛选">
      <List.Dropdown.Item title="全部浏览器" value="all" />
      {browserOptions(platform).map(([value, title]) => <List.Dropdown.Item key={value} value={value} title={title} />)}
      <List.Dropdown.Item title={domesticLabel(platform)} value="domestic" />
    </List.Dropdown>}
    filterBar={{ summaryText: summary, actions: showEmpty ? [] : [
      { id: 'refresh', title: '刷新书签', onAction: reload },
      ...(details.length ? [{ id: 'errors', title: '读取详情', onAction: openDetails }] : [])
    ] }}>
    {filtered.slice(0, visible).map(item => <List.Item key={item.id} id={item.id} title={item.title} icon={Icon.Globe}
      subtitle={[item.folderBreadcrumb, item.hostname].filter(Boolean).join(' · ')}
      accessories={[{ tag: `${item.browserLabel} / ${item.profile}` }, { text: formatBookmarkDate(item.dateAdded) }]}
      actions={<ActionPanel>
        {hasCredentials(item.url)
          // 客户端只打开不含用户名、密码的网址（shell_open_external 会拒绝），这类书签只提供复制
          ? <Action.CopyToClipboard title="复制链接（含登录信息，不直接打开）" content={item.url} />
          : <Action.OpenInBrowser title="打开网页" url={item.url} />}
        {!hasCredentials(item.url) && <Action.CopyToClipboard title="复制链接" content={item.url} shortcut={{ modifiers: ['cmd'], key: 'enter' }} />}
        <Action.CopyToClipboard title="复制 Markdown 链接" content={bookmarkMarkdown(item)} />
        <Action.CopyToClipboard title="复制标题" content={item.title} />
      </ActionPanel>} />)}
    {filtered.length > visible && <List.Item id="more" title={`显示更多书签（还剩 ${filtered.length - visible} 条）`} subtitle="搜索会检索全部已读取的书签" icon={Icon.ArrowDown}
      actions={<ActionPanel><Action title="显示更多" onAction={() => setVisible(count => count + 200)} /></ActionPanel>} />}
    {showEmpty && <List.Item id="empty" {...empty} icon={emptyFailed ? Icon.ExclamationMark : Icon.Globe}
      actions={<ActionPanel>
        {emptyFailed && hasSafariWarning(warnings) && (filter === 'all' || filter === 'safari') && <Action.CopyToClipboard title="复制完全磁盘访问设置路径" content={FULL_DISK_ACCESS_GUIDE} />}
        <Action title="刷新书签" icon={Icon.ArrowClockwise} onAction={reload} />
        {details.length > 0 && <Action title="读取详情" icon={Icon.Info} onAction={openDetails} />}
      </ActionPanel>} />}
  </List>
}
export const commands = {
  'bookmarks-all': () => <BrowserBookmarks />,
  'bookmarks-edge': () => <BrowserBookmarks initialFilter="edge" />,
  'bookmarks-chrome': () => <BrowserBookmarks initialFilter="chrome" />,
  'bookmarks-domestic': () => <BrowserBookmarks initialFilter="domestic" />,
  'bookmarks-firefox': () => <BrowserBookmarks initialFilter="firefox" />
}
