/**
 * ZTools Raycast-Compat Dictionary 类型定义
 * 对标 Raycast Dictionary & macOS Dictionary 官方规范
 */
export interface DictExampleItem {
    readonly en: string;
    readonly zh: string;
}
export interface DictDefinitionItem {
    readonly partOfSpeech: string;
    readonly definitionZh: string;
    readonly definitionEn?: string;
    readonly synonyms?: readonly string[];
    readonly antonyms?: readonly string[];
    readonly examples?: readonly DictExampleItem[];
}
export interface DictWordEntry {
    readonly word: string;
    readonly phoneticUs: string;
    readonly phoneticUk: string;
    readonly pos: readonly string[];
    readonly definitionZh: string;
    readonly definitionEn: string;
    readonly definitions: readonly DictDefinitionItem[];
    readonly synonyms: readonly string[];
    readonly antonyms: readonly string[];
    readonly examples?: readonly DictExampleItem[];
    readonly tags?: readonly string[];
    readonly frequencyRank?: number;
}
export interface DictHistoryItem {
    readonly word: string;
    readonly timestamp: number;
}
export interface DictBookmarkItem {
    readonly word: string;
    readonly addedAt: number;
    readonly note?: string;
}
export type DictFilterTab = "all" | "bookmarks" | "history";
