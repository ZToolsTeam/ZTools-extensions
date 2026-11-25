/**
 * 权威英汉/英英生词词库与智能检索算法
 * 对标 Raycast Dictionary & macOS Dictionary 官方数据模型
 */
import { DictWordEntry } from "./types.js";
export declare const BUILTIN_DICTIONARY: readonly DictWordEntry[];
/**
 * 词形还原归一化（去除常见复数、过去式、进行时、形容词副词后缀）
 */
export declare function normalizeWord(raw: string): string;
/**
 * 计算编辑距离 (Levenshtein Distance) 用于 "Did you mean?" 拼写容错建议
 */
export declare function calculateLevenshtein(a: string, b: string): number;
export interface DictSearchResult {
    readonly exactMatches: DictWordEntry[];
    readonly suggestions: DictWordEntry[];
    readonly guesses: DictWordEntry[];
}
/**
 * 智能查词检索：精准匹配 + 前缀匹配 + 编辑距离猜词
 */
export declare function lookupWord(query: string, dict?: readonly DictWordEntry[]): DictSearchResult;
/**
 * 生成外部权威在线词典的 URL
 */
export declare function getOnlineDictionaryUrls(word: string): {
    cambridge: string;
    youdao: string;
    bing: string;
    wordReference: string;
};
/**
 * 在真实 Electron 宿主中通过 dictionary_lookup / dictionary_define IPC 查询系统词典
 */
export declare function lookupWordFromHost(word: string, hostOverride?: any): Promise<DictWordEntry | null>;
/**
 * 在真实 Electron 宿主中调用 dictionary_speak 触发 macOS /usr/bin/say 或 Windows TTS 朗读
 */
export declare function speakWordOnHost(word: string, dialect?: "US" | "UK", hostOverride?: any): Promise<boolean>;
