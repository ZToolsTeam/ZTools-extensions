export declare const SUPPORTED_LOCALES: readonly ["zh-CN", "en-US"];
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export declare const DEFAULT_LOCALE: SupportedLocale;
export type LocaleChangeListener = (locale: string) => void;
export type TranslationParamValue = string | number | boolean | null | undefined;
export type TranslationParams = Record<string, TranslationParamValue>;
export interface CreateTranslatorOptions {
    defaultLocale?: string;
}
export type Translator<K extends string = string> = (key: K, params?: TranslationParams) => string;
/**
 * 将任意原始语言标识归一化为受支持的 locale（当前支持 zh-CN / en-US）。
 * 无法识别时回退至 fallback，若 fallback 亦无效则回退至 DEFAULT_LOCALE ('en-US')。
 */
export declare function resolveLocale(raw?: string | null, fallback?: string): SupportedLocale;
/**
 * 读取当前声明式运行时生效的语言标识。
 */
export declare function getLocale(): string;
/**
 * 订阅运行时语言变更事件；返回幂等的取消订阅函数。
 */
export declare function onLocaleChange(listener: LocaleChangeListener): () => void;
/**
 * 供宿主 Worker 入口在 initialize / updateLocale 时调用，更新当前运行时语言并通知所有订阅者
 * （包含全部已挂载的 DeclarativeRenderInstance 触发 scheduleRender 热重绘）。
 */
export declare function setRuntimeLocale(nextLocale: string): void;
export type MessageCatalog<T extends Record<string, string>> = {
    readonly [K in keyof T]?: string;
};
/**
 * 创建带 `{var}` 插值与自动逐级回退（当前 locale → 'en-US' → defaultLocale → Key）的翻译函数。
 */
export declare function createTranslator<T extends Record<string, string> = Record<string, string>>(messages: Record<string, MessageCatalog<T>>, options?: CreateTranslatorOptions): Translator<Extract<keyof T, string>>;
