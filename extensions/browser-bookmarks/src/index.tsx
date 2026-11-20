import React, { List, Detail, Action, ActionPanel, Icon, Toast, showToast, useEffect, useLocale, useMemo, useRef, useState, useNavigation } from '@ztools/declarative-ui'
import { type BookmarkItem, type BrowserFilterValue } from './types.js'
import { scanAllBrowserBookmarksWithMeta, searchAndFilterBookmarks, UnreadableSourcesError, getFullDiskAccessGuide, hasSafariWarning, formatBookmarkDate, bookmarkMarkdown, browserOptions, detectPlatform, domesticLabel, emptyState, hasCredentials, type HostPlatform } from './bookmark-scanner.js'
import { t } from './i18n.js'
export * from './types.js'
export * from './bookmark-scanner.js'
const message = (error: unknown) => error instanceof Error ? error.message : t('readFailedFallback')
const markdownText = (text: string) => text.replace(/[\\`*_{}\[\]()<>#!|]/g, value => `\\${value}`)

export default function BrowserBookmarks({ initialFilter = 'all', platform = detectPlatform() }: { initialFilter?: BrowserFilterValue; platform?: HostPlatform } = {}) {
  useLocale()
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
      setError(message(failure)); await showToast(Toast.Style.Failure, t('notUpdatedTitle'), message(failure))
    } finally { pending.current = null; if (mounted.current) setLoading(false) }
  }
  useEffect(() => { mounted.current = true; void reload(); return () => { mounted.current = false; pending.current?.abort() } }, [])
  const filtered = useMemo(() => searchAndFilterBookmarks(items, query, filter), [items, query, filter])
  const details = [error, ...warnings].filter(Boolean)
  const browserCount = new Set(items.map(item => item.browser)).size
  const status = error ? (loadedOnce ? t('statusRefreshFailed') : t('statusReadFailed')) : unreadable ? t('statusUnreadable') : warnings.length ? t('statusPartialWarnings') : ''
  const browsers = browserCount ? t('summaryBrowserCount', { count: browserCount }) : ''
  const summary = loading ? t('summaryLoading') : t('summaryShowing', { status, browsers, visible: Math.min(visible, filtered.length), total: filtered.length })
  const fdaGuide = getFullDiskAccessGuide()
  const openDetails = () => push(<Detail navigationTitle={t('detailNavTitle')} markdown={details.map(value => markdownText(value)).join('\n\n') + (hasSafariWarning(warnings) ? `\n\n> ${t('safariGuidePrefix')}${markdownText(fdaGuide)}` : '')}
    actions={hasSafariWarning(warnings) ? <ActionPanel><Action.CopyToClipboard title={t('copyFdaGuide')} content={fdaGuide} /></ActionPanel> : undefined} />)
  const empty = emptyState({ items, warnings, sources, error, query, filter, platform, warningsPartial })
  const emptyFailed = Boolean(empty.failed)
  // 空状态行自带刷新与读取详情动作时，顶部状态条不再重复这两个按钮（同一功能只出现一次）
  const showEmpty = !loading && !filtered.length
  return <List isShowingDetail={false} isLoading={loading} searchText={query} onSearchTextChange={value => { setQuery(value); setVisible(200) }} searchBarPlaceholder={t('searchPlaceholder')}
    searchBarAccessory={<List.Dropdown value={filter} onChange={value => { setFilter(value as BrowserFilterValue); setVisible(200) }} tooltip={t('filterTooltip')}>
      <List.Dropdown.Item title={t('allBrowsers')} value="all" />
      {browserOptions(platform).map(([value, title]) => <List.Dropdown.Item key={value} value={value} title={title} />)}
      <List.Dropdown.Item title={domesticLabel(platform)} value="domestic" />
    </List.Dropdown>}
    filterBar={{ summaryText: summary, actions: showEmpty ? [] : [
      { id: 'refresh', title: t('refreshBookmarks'), onAction: reload },
      ...(details.length ? [{ id: 'errors', title: t('readDetails'), onAction: openDetails }] : [])
    ] }}>
    {filtered.slice(0, visible).map(item => <List.Item key={item.id} id={item.id} title={item.title} icon={Icon.Globe}
      subtitle={[item.folderBreadcrumb, item.hostname].filter(Boolean).join(' · ')}
      accessories={[{ tag: `${item.browserLabel} / ${item.profile}` }, { text: formatBookmarkDate(item.dateAdded) }]}
      actions={<ActionPanel>
        {hasCredentials(item.url)
          // 客户端只打开不含用户名、密码的网址（shell_open_external 会拒绝），这类书签只提供复制
          ? <Action.CopyToClipboard title={t('copyLinkWithCredentials')} content={item.url} />
          : <Action.OpenInBrowser title={t('openInBrowser')} url={item.url} />}
        {!hasCredentials(item.url) && <Action.CopyToClipboard title={t('copyLink')} content={item.url} shortcut={{ modifiers: ['cmd'], key: 'enter' }} />}
        <Action.CopyToClipboard title={t('copyMarkdownLink')} content={bookmarkMarkdown(item)} />
        <Action.CopyToClipboard title={t('copyTitle')} content={item.title} />
      </ActionPanel>} />)}
    {filtered.length > visible && <List.Item id="more" title={t('showMoreTitle', { remaining: filtered.length - visible })} subtitle={t('showMoreSubtitle')} icon={Icon.ArrowDown}
      actions={<ActionPanel><Action title={t('showMoreAction')} onAction={() => setVisible(count => count + 200)} /></ActionPanel>} />}
    {showEmpty && <List.Item id="empty" title={empty.title} subtitle={empty.subtitle} icon={emptyFailed ? Icon.ExclamationMark : Icon.Globe}
      actions={<ActionPanel>
        {emptyFailed && hasSafariWarning(warnings) && (filter === 'all' || filter === 'safari') && <Action.CopyToClipboard title={t('copyFdaGuide')} content={fdaGuide} />}
        <Action title={t('refreshBookmarks')} icon={Icon.ArrowClockwise} onAction={reload} />
        {details.length > 0 && <Action title={t('readDetails')} icon={Icon.Info} onAction={openDetails} />}
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
