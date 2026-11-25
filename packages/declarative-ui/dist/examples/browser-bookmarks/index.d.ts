import type { BookmarkItem } from './types.js';
export * from './types.js';
export * from './bookmark-scanner.js';
export interface BrowserBookmarksProps {
    featureCode?: string;
    initialBookmarks?: BookmarkItem[];
    hostOverride?: unknown;
}
export declare function BrowserBookmarks({ featureCode, initialBookmarks, hostOverride }?: BrowserBookmarksProps): JSX.Element;
export declare const BrowserBookmarksCommand: typeof BrowserBookmarks;
export default BrowserBookmarks;
