import { t } from './i18n.js'

export const BROWSERS = {
  chrome: 'Chrome',
  edge: 'Edge',
  brave: 'Brave',
  get '360se'() {
    return t('browser360se')
  },
  get '360chrome'() {
    return t('browser360chrome')
  },
  get qqbrowser() {
    return t('browserQQ')
  },
  firefox: 'Firefox',
  safari: 'Safari'
} as const
export type BrowserType = keyof typeof BROWSERS
export type BrowserFilterValue = 'all' | 'domestic' | BrowserType
export interface BookmarkItem {
  id: string; title: string; url: string; hostname: string; folderBreadcrumb: string
  browser: BrowserType; browserLabel: string; profile: string; dateAdded: number | null
  pinyinFull: string; pinyinInitials: string
}
export interface ScanBookmarksResponse { success: true; bookmarks: BookmarkItem[]; warnings: string[]; sourcesRead: number }
