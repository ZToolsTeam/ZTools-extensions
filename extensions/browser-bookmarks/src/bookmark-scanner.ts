import { BROWSERS, type BookmarkItem, type BrowserFilterValue, type BrowserType, type ScanBookmarksResponse } from './types.js'
interface BridgeReply { success?: boolean; data?: unknown; error?: { message?: string } }
interface Bridge { transport?: { methods?: Record<string, (request: unknown) => Promise<BridgeReply>> } }
let sequence = 0
/** 客户端调用成功，但所有书签来源都读不了（例如只有 Safari 且没有完全磁盘访问权限）；附带各来源原因，界面按所选浏览器给结论 */
export class UnreadableSourcesError extends Error {
  readonly warnings: string[]
  /** 原因列表可能不全（客户端整体报错时最多带 5 条），不能据此断定某个浏览器没有问题 */
  readonly partial: boolean
  constructor(warnings: readonly string[], partial = false) { super(`${UNREADABLE_PREFIX}${warnings.slice(0, 5).join('；')}`); this.name = 'UnreadableSourcesError'; this.warnings = [...warnings]; this.partial = partial }
}
const UNREADABLE_PREFIX = '未能读取任何浏览器书签：'
const HOST_WARNING_LIMIT = 5
/**
 * 客户端在一个来源都读不到时整体报错，错误文本为“未能读取任何浏览器书签：原因1；原因2…”（最多 5 条）。
 * 拆回逐个来源的原因，界面才能按所选浏览器下结论；认不出的错误返回 null，按普通失败处理。
 */
export function parseUnreadableSourcesError(message: string): UnreadableSourcesError | null {
  const at = message.indexOf(UNREADABLE_PREFIX)
  if (at < 0) return null
  const warnings = message.slice(at + UNREADABLE_PREFIX.length).split('；').map(value => value.trim()).filter(Boolean)
  return warnings.length ? new UnreadableSourcesError(warnings, warnings.length >= HOST_WARNING_LIMIT) : null
}
/** Safari 书签需要“完全磁盘访问权限”；客户端只允许打开网页链接，不能直接跳到系统设置，因此提供设置路径 */
export const FULL_DISK_ACCESS_GUIDE = '打开“系统设置 › 隐私与安全性 › 完全磁盘访问权限”，打开 ZTools 的开关，然后回到网页书签刷新'
export function hasSafariWarning(warnings: readonly string[]) { return warnings.some(w => /^Safari[ ：]/.test(w)) }
export function validateScan(value: unknown): ScanBookmarksResponse {
  const data = value as ScanBookmarksResponse | null
  if (!data || data.success !== true || !Array.isArray(data.bookmarks) || data.bookmarks.length > 20000 ||
    !Array.isArray(data.warnings) || data.warnings.some(w => typeof w !== 'string') || !Number.isSafeInteger(data.sourcesRead) || data.sourcesRead < 0) throw new Error('客户端返回的书签结果无效')
  if (data.sourcesRead === 0 && data.warnings.length) throw new UnreadableSourcesError(data.warnings)
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
    if (response?.success !== true) {
      const text = response?.error?.message || '读取浏览器书签失败'
      throw parseUnreadableSourcesError(text) || new Error(text)
    }
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
export function domesticLabel(platform: HostPlatform) { return platform === 'mac' ? '国内浏览器（QQ / 360极速）' : '国内浏览器（360 / QQ）' }
function filterLabel(filter: BrowserFilterValue, platform: HostPlatform) { return filter === 'all' ? '浏览器' : filter === 'domestic' ? (platform === 'mac' ? 'QQ 浏览器与 360 极速浏览器' : '360 与 QQ 浏览器') : BROWSERS[filter] }
/** URL 中带用户名或密码时客户端拒绝直接打开，只能复制 */
export function hasCredentials(url: string) { try { const value = new URL(url); return value.username !== '' || value.password !== '' } catch { return false } }
export interface EmptyStateInput { items: readonly BookmarkItem[]; warnings: readonly string[]; sources: number; error: string; query: string; filter: BrowserFilterValue; platform: HostPlatform; warningsPartial?: boolean }
/** 空列表时说明真实原因：读取失败、搜索无结果、所选浏览器没有书签，或本机确实没有书签 */
export function emptyState({ items, warnings, sources, error, query, filter, platform, warningsPartial = false }: EmptyStateInput): { title: string; subtitle: string } {
  // 整次读取失败（客户端调用出错）时无法对任何浏览器下结论；各来源读不了的情况走下面按浏览器的判断
  if (error && !items.length) return { title: filter === 'all' ? '书签读取失败' : `未能读取 ${filterLabel(filter, platform)} 书签`, subtitle: error }
  if (query.trim()) return { title: '没有匹配的书签', subtitle: filter === 'all' ? '换个关键词，或检查网址、拼音与文件夹名' : `只在 ${filterLabel(filter, platform)} 中检索，可在右侧切换为全部浏览器` }
  if (filter !== 'all') {
    const label = filterLabel(filter, platform)
    const only = filter === 'domestic' ? null : PLATFORM_ONLY[filter]
    if (only && platform !== 'unknown' && only !== platform) return { title: `${label} 只在 ${only === 'mac' ? 'macOS' : 'Windows'} 上读取`, subtitle: '当前系统没有这个浏览器的书签来源，可在右侧切换为全部浏览器' }
    // 客户端的读取提示以“浏览器名 / 配置：原因”或“浏览器名：原因”开头
    const failed = filter === 'domestic' ? warnings.some(w => /^(360|QQ)/.test(w)) : warnings.some(w => w.startsWith(`${BROWSERS[filter]} `) || w.startsWith(`${BROWSERS[filter]}：`))
    if (failed) return { title: `未能读取 ${label} 书签`, subtitle: filter === 'safari' ? '需要给 ZTools 开启“完全磁盘访问权限”，开启后刷新' : '打开读取详情查看原因，处理后刷新' }
    // 原因列表被截断时，没列出所选浏览器不代表它没有问题
    if (warningsPartial && !sources) return { title: `未能确认 ${label} 书签`, subtitle: '客户端只返回了部分读取原因，打开读取详情查看' }
    // 其它浏览器（例如 Safari 没有权限）的问题不算在所选浏览器头上，原因放在读取详情
    return { title: `未发现 ${label} 书签`, subtitle: warnings.length ? '本机未安装该浏览器或没有书签文件；其它浏览器的读取问题见读取详情' : '本机未安装该浏览器或没有书签文件' }
  }
  if (warnings.length && !sources) return { title: '未能读取浏览器书签', subtitle: '打开读取详情查看原因，处理后刷新' }
  return { title: '未发现本机网页书签', subtitle: '只读本机浏览器配置中的 HTTP / HTTPS 网页书签' }
}
