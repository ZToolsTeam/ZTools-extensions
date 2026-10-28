import { BROWSERS, type BookmarkItem, type BrowserFilterValue, type ScanBookmarksResponse } from './types.js'
interface BridgeReply { success?: boolean; data?: unknown; error?: { message?: string } }
interface Bridge { transport?: { methods?: Record<string, (request: unknown) => Promise<BridgeReply>> } }
let sequence = 0
export function validateScan(value: unknown): ScanBookmarksResponse {
  const data = value as ScanBookmarksResponse | null
  if (!data || data.success !== true || !Array.isArray(data.bookmarks) || data.bookmarks.length > 20000 ||
    !Array.isArray(data.warnings) || data.warnings.some(w => typeof w !== 'string') || !Number.isSafeInteger(data.sourcesRead) || data.sourcesRead < 0) throw new Error('客户端返回的书签结果无效')
  if (data.sourcesRead === 0 && data.warnings.length) throw new Error(`未能读取任何浏览器书签：${data.warnings.slice(0, 5).join('；')}`)
  if (data.sourcesRead === 0 && data.bookmarks.length) throw new Error('书签来源缺失')
  const ids = new Set<string>()
  for (const item of data.bookmarks) {
    if (!item || !Object.hasOwn(BROWSERS, item.browser) || !['id', 'title', 'url', 'hostname', 'folderBreadcrumb', 'browserLabel', 'profile', 'pinyinFull', 'pinyinInitials'].every(key => typeof item[key as keyof BookmarkItem] === 'string') || !item.id || ids.has(item.id) ||
      (item.dateAdded !== null && (!Number.isFinite(item.dateAdded) || item.dateAdded <= 0 || item.dateAdded > 8640000000000000))) throw new Error('客户端返回的书签条目无效')
    const url = new URL(item.url)
    if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== item.hostname) throw new Error('书签网址不安全')
    ids.add(item.id)
  }
  return data
}
export async function scanAllBrowserBookmarksWithMeta(signal: AbortSignal): Promise<ScanBookmarksResponse> {
  const methods = (globalThis as unknown as { __ztoolsElectron?: Bridge }).__ztoolsElectron?.transport?.methods
  if (!methods?.browser_bookmarks_scan || !methods.browser_bookmarks_cancel) throw new Error('请升级客户端后使用网页书签')
  signal.throwIfAborted()
  const id = `bookmarks_${Date.now()}_${++sequence}`
  const cancel = () => { void methods.browser_bookmarks_cancel!({ messageId: `cancel_${id}`, params: { operationId: id }, timeoutMs: 5000 }).catch(error => console.warn('取消书签读取失败', error)) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    const response = await methods.browser_bookmarks_scan({ messageId: id, params: { operationId: id }, timeoutMs: 20000 })
    signal.throwIfAborted()
    if (response?.success !== true) throw new Error(response?.error?.message || '读取浏览器书签失败')
    return validateScan(response.data)
  } finally { signal.removeEventListener('abort', cancel) }
}
export function formatBookmarkDate(date: number | null) { return date === null ? '日期未知' : new Date(date).toLocaleDateString('zh-CN') }
export function bookmarkMarkdown(item: BookmarkItem) {
  const title = item.title.replace(/[\\\[\]`*_<>]/g, value => `\\${value}`).replace(/[\r\n]+/g, ' ')
  const url = item.url.replace(/[<>\s\\]/g, value => encodeURIComponent(value))
  return `[${title}](<${url}>)`
}
export function searchAndFilterBookmarks(items: readonly BookmarkItem[], query = '', browser: BrowserFilterValue = 'all'): BookmarkItem[] {
  const target = query.trim().toLowerCase(), domain = target.startsWith('domain:') ? target.slice(7).trim() : null
  return items.filter(item => {
    if (browser !== 'all' && (browser === 'domestic' ? !['360se', '360chrome', 'qqbrowser'].includes(item.browser) : item.browser !== browser)) return false
    if (domain !== null) return item.hostname.toLowerCase().includes(domain)
    return !target || [item.title, item.url, item.folderBreadcrumb, item.profile, item.pinyinFull, item.pinyinInitials].some(value => value.toLowerCase().includes(target))
  })
}
