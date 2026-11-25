import type { Quicklink, QuicklinkCategory, QuicklinkItem, QuicklinkResolved } from './types.js';
export declare const DEFAULT_QUICKLINKS: Quicklink[];
export declare function validateQuicklinkUrlPattern(rawUrl: string): {
    valid: boolean;
    normalizedUrl: string;
    error?: string;
};
/**
 * 构建目标访问 URL：
 * - 若传入 queryText，进行严格的 encodeURIComponent 替换；
 * - 若未传入 queryText 且模板带 {query}，智能降级返回站点首页 origin
 */
export declare function buildTargetUrl(pattern: string, queryText?: string): string;
export declare function launchQuicklink(item: QuicklinkItem | Quicklink, queryText?: string, opener?: (url: string) => Promise<void> | void): Promise<string[]>;
export declare function getQuicklinks(): Promise<Quicklink[]>;
export declare function saveQuicklinks(quicklinks: Quicklink[]): Promise<void>;
export declare function resolveQuicklinkUrl(linkTemplate: string, queryParam?: string, defaultParam?: string): QuicklinkResolved;
export declare function filterQuicklinks(quicklinks: Quicklink[], searchQuery: string, categoryFilter?: 'all' | QuicklinkCategory): {
    matches: Quicklink[];
    directMatch?: {
        quicklink: Quicklink;
        queryArg: string;
    };
};
export declare function exportQuicklinksJson(quicklinks: Quicklink[]): string;
export declare function importQuicklinksJson(jsonStr: string, existing: Quicklink[]): {
    success: boolean;
    importedCount: number;
    result: Quicklink[];
    error?: string;
};
