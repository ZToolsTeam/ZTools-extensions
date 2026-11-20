export const SUPPORTED_LOCALES = ["zh-CN", "en-US"];
export const DEFAULT_LOCALE = "en-US";
function matchSupportedLocale(raw) {
    if (typeof raw !== "string")
        return null;
    const normalized = raw.trim().replace(/_/g, "-").toLowerCase();
    if (!normalized)
        return null;
    for (const supported of SUPPORTED_LOCALES) {
        if (supported.toLowerCase() === normalized) {
            return supported;
        }
    }
    const primary = normalized.split("-")[0];
    if (primary === "zh")
        return "zh-CN";
    if (primary === "en")
        return "en-US";
    return null;
}
/**
 * 将任意原始语言标识归一化为受支持的 locale（当前支持 zh-CN / en-US）。
 * 无法识别时回退至 fallback，若 fallback 亦无效则回退至 DEFAULT_LOCALE ('en-US')。
 */
export function resolveLocale(raw, fallback = DEFAULT_LOCALE) {
    return (matchSupportedLocale(raw) ??
        matchSupportedLocale(fallback) ??
        DEFAULT_LOCALE);
}
function readInitialGlobalLocale() {
    const globalRecord = globalThis;
    const raw = typeof globalRecord.__ztoolsLocale === "string"
        ? globalRecord.__ztoolsLocale
        : undefined;
    return raw ? resolveLocale(raw, DEFAULT_LOCALE) : DEFAULT_LOCALE;
}
let currentLocale = readInitialGlobalLocale();
const localeListeners = new Set();
/**
 * 读取当前声明式运行时生效的语言标识。
 */
export function getLocale() {
    return currentLocale;
}
/**
 * 订阅运行时语言变更事件；返回幂等的取消订阅函数。
 */
export function onLocaleChange(listener) {
    localeListeners.add(listener);
    return () => {
        localeListeners.delete(listener);
    };
}
/**
 * 供宿主 Worker 入口在 initialize / updateLocale 时调用，更新当前运行时语言并通知所有订阅者
 * （包含全部已挂载的 DeclarativeRenderInstance 触发 scheduleRender 热重绘）。
 */
export function setRuntimeLocale(nextLocale) {
    const resolved = resolveLocale(nextLocale, DEFAULT_LOCALE);
    if (resolved === currentLocale)
        return;
    currentLocale = resolved;
    for (const listener of Array.from(localeListeners)) {
        try {
            listener(currentLocale);
        }
        catch (err) {
            console.error("[declarative-ui] Error in locale change listener:", err);
        }
    }
}
;
globalThis.__ztoolsSetRuntimeLocale = setRuntimeLocale;
function lookupMessage(messages, locale, key) {
    const dict = messages[locale];
    if (!dict || !Object.prototype.hasOwnProperty.call(dict, key)) {
        return undefined;
    }
    const value = dict[key];
    if (typeof value !== "string" || value.length === 0) {
        return undefined;
    }
    return value;
}
function interpolate(template, params) {
    if (!params)
        return template;
    return template.replace(/\{([A-Za-z0-9_.-]+)\}/g, (match, token) => {
        if (!Object.prototype.hasOwnProperty.call(params, token)) {
            return match;
        }
        const value = params[token];
        if (value === undefined || value === null) {
            return match;
        }
        return String(value);
    });
}
/**
 * 创建带 `{var}` 插值与自动逐级回退（当前 locale → 'en-US' → defaultLocale → Key）的翻译函数。
 */
export function createTranslator(messages, options) {
    const optionDefaultLocale = typeof options?.defaultLocale === "string" && options.defaultLocale.trim().length > 0
        ? options.defaultLocale.trim()
        : undefined;
    const resolvedOptionDefault = optionDefaultLocale
        ? resolveLocale(optionDefaultLocale, DEFAULT_LOCALE)
        : undefined;
    return (key, params) => {
        const activeLocale = getLocale();
        const candidates = [];
        const pushCandidate = (loc) => {
            if (loc && !candidates.includes(loc)) {
                candidates.push(loc);
            }
        };
        pushCandidate(activeLocale);
        pushCandidate(DEFAULT_LOCALE);
        pushCandidate(optionDefaultLocale);
        pushCandidate(resolvedOptionDefault);
        let template;
        for (const candidate of candidates) {
            template = lookupMessage(messages, candidate, key);
            if (template !== undefined) {
                break;
            }
        }
        return interpolate(template ?? String(key), params);
    };
}
