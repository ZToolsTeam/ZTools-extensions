export const BROWSERS = { chrome: 'Chrome', edge: 'Edge', brave: 'Brave', '360se': '360安全', '360chrome': '360极速', qqbrowser: 'QQ浏览器', firefox: 'Firefox', safari: 'Safari' } as const
export type BrowserType = keyof typeof BROWSERS
export type BrowserFilterValue = 'all' | 'domestic' | BrowserType
export interface BookmarkItem {
  id: string; title: string; url: string; hostname: string; folderBreadcrumb: string
  browser: BrowserType; browserLabel: string; profile: string; dateAdded: number | null
  pinyinFull: string; pinyinInitials: string
}
export interface ScanBookmarksResponse { success: true; bookmarks: BookmarkItem[]; warnings: string[]; sourcesRead: number }
