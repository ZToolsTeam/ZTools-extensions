export interface TranslationResult {
    sourceText: string;
    translatedText: string;
    sourceLang: string;
    targetLang: string;
    phonetic?: string;
    synonyms?: string[];
    examples?: {
        source: string;
        target: string;
    }[];
    timestamp: string;
}
export interface TranslateHistoryItem extends TranslationResult {
    id: string;
}
/** 未配置在线翻译服务时的错误码 */
export declare const TRANSLATION_NOT_CONFIGURED = "TRANSLATION_NOT_CONFIGURED";
export declare function toApiLang(code: string): string;
/**
 * 联网请求真实在线翻译结果
 */
export declare function fetchLiveTranslation(sourceText: string, sourceLang?: string, targetLang?: string, signal?: AbortSignal): Promise<TranslationResult>;
/**
 * 核心即时翻译逻辑 (支持同步首屏/离线词典)
 */
export declare function translateText(sourceText: string, sourceLang: string, targetLang: string): TranslationResult | null;
/**
 * 历史记录 LocalStorage 持久化操作
 */
export declare function getTranslateHistory(): Promise<TranslateHistoryItem[]>;
export declare function saveTranslateHistory(result: TranslationResult): Promise<TranslateHistoryItem[]>;
export declare function clearTranslateHistory(): Promise<void>;
export declare function removeTranslateHistoryItem(id: string): Promise<TranslateHistoryItem[]>;
