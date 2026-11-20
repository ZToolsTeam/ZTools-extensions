/**
 * 翻译插件业务逻辑
 *
 * - 翻译只走客户端的 `translator_translate` 接口，插件自己不带词库、不编造译文
 * - 方向固定为中英互译：输入含中文时译为英语，其余译为中文
 * - 变量命名：把英文（原文或译文）转成 camelCase / snake_case / CONSTANT_CASE
 */

import { callHostTransport, isRealElectronHost } from './native-ipc.js'
import { t } from './i18n.js'

export const NOT_IN_CLIENT_MESSAGE = t('notInClient')

export interface TranslationResult {
  originalText: string
  translatedText: string
  sourceLanguage: string
  targetLanguage: string
  /** 客户端返回的翻译来源说明 */
  engineLabel: string
}

export interface TranslationHistoryEntry {
  id: string
  originalText: string
  translatedText: string
  sourceLanguage: string
  targetLanguage: string
  timestampText: string
}

export type TranslateOutcome =
  | { ok: true; result: TranslationResult }
  | { ok: false; error: string }

export function languageName(code: string): string {
  switch (code) {
    case 'zh-CN': return t('langZh')
    case 'en': return t('langEn')
    case 'ja': return t('langJa')
    case 'ko': return t('langKo')
    case 'ru': return t('langRu')
    default: return code
  }
}

export function detectLanguageLocal(text: string): string {
  const clean = String(text || '').trim()
  if (!clean) return 'en'
  if (/[぀-ヿ]/.test(clean)) return 'ja'
  if (/[가-힯]/.test(clean)) return 'ko'
  if (/[Ѐ-ӿ]/.test(clean)) return 'ru'
  if (/[一-龥]/.test(clean)) return 'zh-CN'
  return 'en'
}

/**
 * 中英互译方向：输入是中文时译为英语，其余译为中文。
 */
export function resolveLanguagePair(text: string): { sourceLanguage: string; targetLanguage: string } {
  const sourceLanguage = detectLanguageLocal(text)
  return { sourceLanguage, targetLanguage: sourceLanguage === 'zh-CN' ? 'en' : 'zh-CN' }
}

export function formatIdentifierCase(text: string, style: 'camel' | 'snake' | 'constant'): string {
  const words = String(text || '')
    .replace(/[^A-Za-z0-9\s_-]+/g, ' ')
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase())

  if (words.length === 0) return ''
  if (style === 'snake') return words.join('_')
  if (style === 'constant') return words.map((w) => w.toUpperCase()).join('_')
  return words.map((w, idx) => (idx === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1))).join('')
}

/**
 * 结果里可用来生成变量名的英文：译文是英语时取译文，原文是英语时取原文，都不是返回空串。
 */
export function englishTextOf(result: TranslationResult): string {
  if (result.targetLanguage === 'en') return result.translatedText
  if (result.sourceLanguage === 'en') return result.originalText
  return ''
}

/**
 * 原文已经是英文时，变量命名不需要翻译，直接用原文生成。
 */
export function buildDirectNamingResult(text: string): TranslationResult | null {
  const clean = String(text ?? '').trim()
  if (!clean || detectLanguageLocal(clean) !== 'en' || !formatIdentifierCase(clean, 'camel')) return null
  return {
    originalText: clean,
    translatedText: clean,
    sourceLanguage: 'en',
    targetLanguage: 'en',
    engineLabel: t('engineDirectNaming')
  }
}

function engineLabelOf(engine: unknown): string {
  if (engine === 'offline') return t('engineOffline')
  if (engine === 'web') return t('engineWeb')
  if (engine === 'ai') return t('engineAi')
  return t('engineDefault')
}

export async function translateTextWithHost(text: string, hostOverride?: unknown): Promise<TranslateOutcome> {
  const clean = String(text ?? '').trim()
  if (!clean) return { ok: false, error: t('errEmptyText') }
  if (!hostOverride && !isRealElectronHost()) return { ok: false, error: t('notInClient') }

  const { sourceLanguage, targetLanguage } = resolveLanguagePair(clean)
  const ipcRes = await callHostTransport<{
    originalText?: unknown
    translatedText?: unknown
    sourceLanguage?: unknown
    targetLanguage?: unknown
    engine?: unknown
  }>('translator_translate', { text: clean, sourceLanguage, targetLanguage }, hostOverride)

  if (!ipcRes.ok) return { ok: false, error: ipcRes.error || t('errTranslateIpcFailed') }
  const data = ipcRes.data
  const translated = data && typeof data.translatedText === 'string' ? data.translatedText.trim() : ''
  if (!translated) return { ok: false, error: t('errInvalidTranslateResult') }

  return {
    ok: true,
    result: {
      originalText: clean,
      translatedText: translated,
      sourceLanguage: typeof data!.sourceLanguage === 'string' && data!.sourceLanguage ? data!.sourceLanguage : sourceLanguage,
      targetLanguage: typeof data!.targetLanguage === 'string' && data!.targetLanguage ? data!.targetLanguage : targetLanguage,
      engineLabel: engineLabelOf(data!.engine)
    }
  }
}

export interface HistoryFetchOutcome {
  ok: boolean
  items: TranslationHistoryEntry[]
  error?: string
}

export async function fetchTranslationHistoryFromHost(hostOverride?: unknown): Promise<HistoryFetchOutcome> {
  if (!hostOverride && !isRealElectronHost()) return { ok: false, items: [], error: t('notInClient') }
  const res = await callHostTransport<{ items?: Array<Record<string, unknown>> }>(
    'translator_get_history',
    {},
    hostOverride
  )
  if (!res.ok) return { ok: false, items: [], error: res.error || t('errReadHistoryFailed') }
  if (!res.data || !Array.isArray(res.data.items)) {
    return { ok: false, items: [], error: t('errInvalidHistoryFormat') }
  }
  const items = res.data.items
    .filter((item) => typeof item?.originalText === 'string' && typeof item?.translatedText === 'string')
    .slice(0, 15)
    .map((item, idx) => ({
      id: String(item.id ?? `hist-${idx}`),
      originalText: String(item.originalText),
      translatedText: String(item.translatedText),
      sourceLanguage: String(item.sourceLanguage ?? ''),
      targetLanguage: String(item.targetLanguage ?? ''),
      timestampText:
        typeof item.timestamp === 'number'
          ? new Date(item.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
          : ''
    }))
  return { ok: true, items }
}

/**
 * 把客户端的报错整理成给用户看的说明。客户端离线词库查不到时只返回通用的内部错误，插件无法与其他失败区分，
 * 所以在原因后面说明词库收录有限。
 */
export function describeTranslateError(error: string): string {
  const reason = String(error || '').trim() || t('errUnknownReason')
  if (reason === t('notInClient') || reason === t('errEmptyText')) return reason
  return t('errDescribeFormat', { reason })
}
