import type { BookmarkItem, BookmarkScannerOptions, BrowserFilterValue, BrowserType, ScanBookmarksResponse } from './types.js';
export declare function computePinyinIndex(text: string): {
    full: string;
    initials: string;
};
export declare function isSafeHttpBookmarkUrl(rawUrl: string): boolean;
export declare function formatBookmarkDate(tsMs: number): string;
export declare function normalizeBookmarkEntry(raw: {
    id: string;
    title: string;
    url: string;
    folderBreadcrumb?: string;
    browser: BrowserType;
    browserLabel: string;
    dateAdded?: number;
}): BookmarkItem | null;
export declare function parseChromiumBookmarksJson(jsonText: string, browser: BrowserType, browserLabel: string): BookmarkItem[];
export declare function scanAllBrowserBookmarksWithMeta(options?: BookmarkScannerOptions): Promise<ScanBookmarksResponse>;
export declare function scanAllBrowserBookmarks(options?: BookmarkScannerOptions): Promise<BookmarkItem[]>;
export declare function searchAndFilterBookmarks(bookmarks: readonly BookmarkItem[], query?: string, browserFilter?: BrowserFilterValue): BookmarkItem[];
