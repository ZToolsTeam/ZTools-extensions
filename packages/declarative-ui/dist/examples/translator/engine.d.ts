/**
 * 极速离线与多语言翻译引擎
 * 对标 Raycast Translator 交互逻辑与反向对照规范
 */
export interface ReverseTranslationItem {
    readonly term: string;
    readonly pos?: string;
    readonly meaning: string;
    readonly alternates?: readonly string[];
}
export interface TranslationResult {
    readonly sourceText: string;
    readonly translatedText: string;
    readonly sourceLanguage: string;
    readonly targetLanguage: string;
    readonly detectedLanguage: {
        code: string;
        label: string;
        confidence: number;
    };
    readonly phonetic?: string;
    readonly reverseTranslations?: readonly ReverseTranslationItem[];
}
export interface RecentTranslationRecord {
    readonly id: string;
    readonly sourceText: string;
    readonly translatedText: string;
    readonly sourceLang: string;
    readonly targetLang: string;
    readonly timestamp: number;
}
export declare function translateText(text: string, sourceLang?: string, targetLang?: string, hostOverride?: unknown): Promise<TranslationResult>;
/**
 * 双向语言切换 (Swap Languages)
 * 对标 Raycast: 如果源语言是 auto，则将目标语言对调为探测语言，源语言设为旧目标语言
 */
export declare function swapLanguages(sourceLang: string, targetLang: string, detectedSourceLang?: string): {
    newSource: string;
    newTarget: string;
};
/**
 * 历史翻译记录读取与持久化
 */
export declare function getRecentTranslations(): Promise<RecentTranslationRecord[]>;
export declare function saveRecentTranslation(sourceText: string, translatedText: string, sourceLang: string, targetLang: string): Promise<RecentTranslationRecord[]>;
export declare function clearRecentTranslations(): Promise<void>;
/**
 * 外部 Web 翻译器跳转 URL 生成器
 */
export declare function getWebTranslatorUrls(text: string, sourceLang: string, targetLang: string): {
    deepL: string;
    googleTranslate: string;
    baidu: string;
};
