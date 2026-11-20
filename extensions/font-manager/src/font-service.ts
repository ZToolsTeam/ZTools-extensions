import { t } from './i18n.js'
import type { FontFilter, FontPreview, InstalledFont } from './types.js'
export const DEFAULT_PREVIEW = '天地玄黄 宇宙洪荒\nThe quick brown fox 0123456789'
export function validatePreviewText(text: string) {
  if (!text.trim()) throw new Error(t('enterPreviewText'))
  if ([...text].length > 160) throw new Error(t('previewTooLong'))
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error(t('previewControlChars'))
  return text
}
export function filterFonts(fonts: InstalledFont[], filter: FontFilter, query: string) {
  const search = query.trim().toLocaleLowerCase()
  return fonts.filter(font => (filter === 'all' || (filter === 'system' ? font.system : filter === 'with-license' ? font.hasLicense : !font.hasLicense)) &&
    (!search || [font.family, font.style, font.id].some(value => value.toLocaleLowerCase().includes(search))))
}
export function cssFontFamily(family: string) {
  const escaped = family.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r\f]/g, char => `\\${char.charCodeAt(0).toString(16)} `)
  return `font-family: "${escaped}", sans-serif;`
}
export function licenseUrl(value: string) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined } catch { return undefined }
}
export function textMarkdown(value: string) { return value.replace(/[\\`*_[\]!#|]/g, '\\$&') }
/** macOS 在本机没有任何字体含该字形时用 LastResort 画占位方框；它不是可用的回退字体，要单独说明 */
const LAST_RESORT = 'LastResort'
export function previewMarkdown(preview: FontPreview) {
  const fallbacks = preview.fallbacks.filter(name => name !== LAST_RESORT)
  const notes = preview.coverageWarning ? [textMarkdown(preview.coverageWarning)] : [
    ...(fallbacks.length ? [t('fallbackFontsNote', { fonts: fallbacks.map(textMarkdown).join(t('listSep')) })] : []),
    ...(preview.fallbacks.includes(LAST_RESORT) ? [t('lastResortNote')] : [])
  ]
  const note = notes.length ? notes.join('\n\n') : t('renderedBySelectedNote')
  return `![${t('previewImageAlt')}](data:image/png;base64,${preview.png})\n\n${note}`
}
