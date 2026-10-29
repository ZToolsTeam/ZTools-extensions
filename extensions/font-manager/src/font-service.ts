import type { FontFilter, FontPreview, InstalledFont } from './types.js'
export const DEFAULT_PREVIEW = '天地玄黄 宇宙洪荒\nThe quick brown fox 0123456789'
export function validatePreviewText(text: string) {
  if (!text.trim()) throw new Error('请输入预览文字')
  if ([...text].length > 160) throw new Error('预览文字最多 160 个字符')
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error('预览文字含不支持的控制字符')
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
    ...(fallbacks.length ? [`部分字形使用系统回退字体：${fallbacks.map(textMarkdown).join('、')}`] : []),
    ...(preview.fallbacks.includes(LAST_RESORT) ? ['部分字符本机没有任何字体包含，显示为占位方框。'] : [])
  ]
  const note = notes.length ? notes.join('\n\n') : '以上字形由所选字体绘制。'
  return `![所选字体的实际字形](data:image/png;base64,${preview.png})\n\n${note}`
}
