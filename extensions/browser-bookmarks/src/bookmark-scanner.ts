import { getLocale } from '@ztools/declarative-ui'
import { BROWSERS, type BookmarkItem, type BrowserFilterValue, type BrowserType, type ScanBookmarksResponse } from './types.js'
import { t } from './i18n.js'
import { resolveErrorMessage } from './error-i18n.js'
import { HOST_UNREADABLE_PREFIX_ZH, HOST_WARNING_NAMES_ZH } from './host-warnings.zh-data.js'
interface BridgeReply { success?: boolean; data?: unknown; error?: { message?: string } }
interface Bridge { transport?: { methods?: Record<string, (request: unknown) => Promise<BridgeReply>> } }
let sequence = 0
/** 客户端调用成功，但所有书签来源都读不了（例如只有 Safari 且没有完全磁盘访问权限）；附带各来源原因，界面按所选浏览器给结论 */
export class UnreadableSourcesError extends Error {
  readonly warnings: string[]
  /** 原因列表可能不全（客户端整体报错时最多带 5 条），不能据此断定某个浏览器没有问题 */
  readonly partial: boolean
  constructor(warnings: readonly string[], partial = false) { super(`${t('unreadablePrefix')}${warnings.slice(0, 5).join(t('warningSep'))}`); this.name = 'UnreadableSourcesError'; this.warnings = [...warnings]; this.partial = partial }
}
const HOST_UNREADABLE_PREFIXES = [HOST_UNREADABLE_PREFIX_ZH, 'Failed to read any browser bookmarks: '] as const
const HOST_WARNING_LIMIT = 5
/**
 * 客户端在一个来源都读不到时整体报错，错误文本为“未能读取任何浏览器书签：原因1；原因2…”（最多 5 条）。
 * 拆回逐个来源的原因，界面才能按所选浏览器下结论；认不出的错误返回 null，按普通失败处理。
 */
export function parseUnreadableSourcesError(message: string): UnreadableSourcesError | null {
  for (const prefix of HOST_UNREADABLE_PREFIXES) {
    const at = message.indexOf(prefix)
    if (at < 0) continue
    const warnings = message.slice(at + prefix.length).split(/[；;]/).map(value => value.trim()).filter(Boolean)
    return warnings.length ? new UnreadableSourcesError(warnings, warnings.length >= HOST_WARNING_LIMIT) : null
  }
  return null
}
/** Safari 书签需要“完全磁盘访问权限”；客户端只允许打开网页链接，不能直接跳到系统设置，因此提供设置路径 */
export function getFullDiskAccessGuide(): string { return t('fullDiskAccessGuide') }
export function hasSafariWarning(warnings: readonly string[]) { return warnings.some(w => /^Safari[ ：:]/.test(w)) }
export function validateScan(value: unknown): ScanBookmarksResponse {
  const data = value as ScanBookmarksResponse | null
  if (!data || data.success !== true || !Array.isArray(data.bookmarks) || data.bookmarks.length > 20000 ||
    !Array.isArray(data.warnings) || data.warnings.some(w => typeof w !== 'string') || !Number.isSafeInteger(data.sourcesRead) || data.sourcesRead < 0) throw new Error(t('invalidScanResult'))
  if (data.sourcesRead === 0 && data.warnings.length) throw new UnreadableSourcesError(data.warnings)
  if (data.sourcesRead === 0 && data.bookmarks.length) throw new Error(t('missingBookmarkSources'))
  const ids = new Set<string>()
  for (const item of data.bookmarks) {
    if (!item || !Object.hasOwn(BROWSERS, item.browser) || !['id', 'title', 'url', 'hostname', 'folderBreadcrumb', 'browserLabel', 'profile', 'pinyinFull', 'pinyinInitials'].every(key => typeof item[key as keyof BookmarkItem] === 'string') || !item.id || ids.has(item.id) ||
      (item.dateAdded !== null && (!Number.isFinite(item.dateAdded) || item.dateAdded <= 0 || item.dateAdded > 8640000000000000))) throw new Error(t('invalidBookmarkEntry'))
    const url = new URL(item.url)
    if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== item.hostname) throw new Error(t('unsafeBookmarkUrl'))
    ids.add(item.id)
  }
  return data
}
export async function scanAllBrowserBookmarksWithMeta(signal: AbortSignal): Promise<ScanBookmarksResponse> {
  const methods = (globalThis as unknown as { __ztoolsElectron?: Bridge }).__ztoolsElectron?.transport?.methods
  if (!methods?.browser_bookmarks_scan || !methods.browser_bookmarks_cancel) throw new Error(t('upgradeClientRequired'))
  signal.throwIfAborted()
  const id = `bookmarks_${Date.now()}_${++sequence}`
  const cancel = () => { void methods.browser_bookmarks_cancel!({ messageId: `cancel_${id}`, params: { operationId: id }, timeoutMs: 5000 }).catch(error => console.warn(t('cancelScanFailed'), error)) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    const response = await methods.browser_bookmarks_scan({ messageId: id, params: { operationId: id }, timeoutMs: 20000 })
    signal.throwIfAborted()
    if (response?.success !== true) {
      const text = resolveErrorMessage(response?.error, t('readBrowserBookmarksFailed'))
      throw parseUnreadableSourcesError(text) || new Error(text)
    }
    return validateScan(response.data)
  } finally { signal.removeEventListener('abort', cancel) }
}
export function formatBookmarkDate(date: number | null) { return date === null ? t('dateUnknown') : new Date(date).toLocaleDateString(getLocale()) }
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
export type HostPlatform = 'mac' | 'windows' | 'unknown'
/** 只用来决定筛选项与空状态文案；识别不出时按“未知”处理，列出全部浏览器 */
export function detectPlatform(nav: { platform?: string; userAgent?: string } | undefined = (globalThis as { navigator?: { platform?: string; userAgent?: string } }).navigator): HostPlatform {
  const value = `${nav?.platform || ''} ${nav?.userAgent || ''}`
  return /Mac/i.test(value) ? 'mac' : /Win/i.test(value) ? 'windows' : 'unknown'
}
// 客户端只在 Windows 读取 360 安全浏览器，只在 macOS 读取 Safari
const PLATFORM_ONLY: Partial<Record<BrowserType, HostPlatform>> = { '360se': 'windows', safari: 'mac' }
export function browserOptions(platform: HostPlatform): Array<[BrowserType, string]> {
  return (Object.entries(BROWSERS) as Array<[BrowserType, string]>).filter(([value]) => platform === 'unknown' || !PLATFORM_ONLY[value] || PLATFORM_ONLY[value] === platform)
}
export function domesticLabel(platform: HostPlatform) { return platform === 'mac' ? t('domesticLabelMac') : t('domesticLabelWin') }
function filterLabel(filter: BrowserFilterValue, platform: HostPlatform) {
  return filter === 'all' ? t('filterLabelAll') : filter === 'domestic' ? (platform === 'mac' ? t('filterLabelDomesticMac') : t('filterLabelDomesticWin')) : BROWSERS[filter]
}
const HOST_WARNING_NAMES: Record<BrowserType, readonly string[]> = {
  chrome: ['Chrome'],
  edge: ['Edge'],
  brave: ['Brave'],
  '360se': [...(HOST_WARNING_NAMES_ZH['360se'] ?? []), '360 Safe'],
  '360chrome': [...(HOST_WARNING_NAMES_ZH['360chrome'] ?? []), '360 Extreme'],
  qqbrowser: [...(HOST_WARNING_NAMES_ZH.qqbrowser ?? []), 'QQ Browser'],
  firefox: ['Firefox'],
  safari: ['Safari']
}
/** URL 中带用户名或密码时客户端拒绝直接打开，只能复制 */
export function hasCredentials(url: string) { try { const value = new URL(url); return value.username !== '' || value.password !== '' } catch { return false } }
export interface EmptyStateInput { items: readonly BookmarkItem[]; warnings: readonly string[]; sources: number; error: string; query: string; filter: BrowserFilterValue; platform: HostPlatform; warningsPartial?: boolean }
/** 空列表时说明真实原因：读取失败、搜索无结果、所选浏览器没有书签，或本机确实没有书签 */
export function emptyState({ items, warnings, sources, error, query, filter, platform, warningsPartial = false }: EmptyStateInput): { title: string; subtitle: string; failed?: boolean } {
  // 整次读取失败（客户端调用出错）时无法对任何浏览器下结论；各来源读不了的情况走下面按浏览器的判断
  if (error && !items.length) return { title: filter === 'all' ? t('emptyReadFailedAll') : t('emptyReadFailedBrowser', { label: filterLabel(filter, platform) }), subtitle: error, failed: true }
  if (query.trim()) return { title: t('emptyNoMatchTitle'), subtitle: filter === 'all' ? t('emptyNoMatchAllSub') : t('emptyNoMatchBrowserSub', { label: filterLabel(filter, platform) }) }
  if (filter !== 'all') {
    const label = filterLabel(filter, platform)
    const only = filter === 'domestic' ? null : PLATFORM_ONLY[filter]
    if (only && platform !== 'unknown' && only !== platform) return { title: t('emptyPlatformOnlyTitle', { label, os: only === 'mac' ? 'macOS' : 'Windows' }), subtitle: t('emptyPlatformOnlySub') }
    // 客户端的读取提示以“浏览器名 / 配置：原因”或“浏览器名：原因”开头
    const failed = filter === 'domestic'
      ? warnings.some(w => /^(360|QQ)/.test(w))
      : warnings.some(w => HOST_WARNING_NAMES[filter].some(name => w.startsWith(`${name} `) || w.startsWith(`${name}：`) || w.startsWith(`${name}:`)))
    if (failed) return { title: t('emptyReadFailedBrowser', { label }), subtitle: filter === 'safari' ? t('emptySafariPermissionSub') : t('emptyOpenDetailsSub'), failed: true }
    // 原因列表被截断时，没列出所选浏览器不代表它没有问题
    if (warningsPartial && !sources) return { title: t('emptyUnconfirmedTitle', { label }), subtitle: t('emptyUnconfirmedSub'), failed: true }
    // 其它浏览器（例如 Safari 没有权限）的问题不算在所选浏览器头上，原因放在读取详情
    return { title: t('emptyNotFoundBrowserTitle', { label }), subtitle: warnings.length ? t('emptyNotFoundWithWarningsSub') : t('emptyNotFoundSub') }
  }
  if (warnings.length && !sources) return { title: t('emptyUnreadableAllTitle'), subtitle: t('emptyOpenDetailsSub'), failed: true }
  return { title: t('emptyNoBookmarksTitle'), subtitle: t('emptyNoBookmarksSub') }
}
