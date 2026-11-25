/**
 * 多语言语言定义与自动检测引擎
 * 对标 Raycast Translator 官方支持语言规范
 */
export interface LanguageDefinition {
    readonly code: string;
    readonly label: string;
    readonly nativeName: string;
    readonly flag: string;
    readonly phoneticsType?: "pinyin" | "ipa" | "romaji" | "hangul";
}
export declare const SUPPORTED_LANGUAGES: readonly LanguageDefinition[];
export declare function getLanguageByCode(code: string): LanguageDefinition;
/**
 * 智能语种探测（基于 Unicode 码点特征与字符集匹配）
 */
export declare function detectLanguage(text: string): {
    code: string;
    label: string;
    confidence: number;
};
