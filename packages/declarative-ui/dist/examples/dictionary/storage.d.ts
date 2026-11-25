/**
 * 生词本收藏与查词历史持久化存储管理器
 * 基于 LocalStorage 与容灾校验
 */
import { DictBookmarkItem, DictHistoryItem } from "./types.js";
export declare const DICTIONARY_STORAGE_KEYS: {
    readonly BOOKMARKS: "ztools_dictionary_bookmarks_v1";
    readonly RECENTS: "ztools_dictionary_recents_v1";
};
/**
 * 获取生词本收藏列表
 */
export declare function getBookmarks(): Promise<DictBookmarkItem[]>;
/**
 * 切换收藏状态 (Add / Remove)
 */
export declare function toggleBookmark(word: string, note?: string): Promise<{
    isBookmarked: boolean;
    list: DictBookmarkItem[];
}>;
/**
 * 判断单词是否已被收藏
 */
export declare function isBookmarked(word: string): Promise<boolean>;
/**
 * 获取查词历史
 */
export declare function getRecentSearches(): Promise<DictHistoryItem[]>;
/**
 * 记录一条查词历史
 */
export declare function recordRecentSearch(word: string): Promise<DictHistoryItem[]>;
/**
 * 清空查词历史
 */
export declare function clearRecentSearches(): Promise<void>;
