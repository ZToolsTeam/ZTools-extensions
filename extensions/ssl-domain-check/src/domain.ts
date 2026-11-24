import { t } from './i18n.js'

export function normalizeDomainInput(raw: string): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 2048) throw new Error(t('errInvalidDomain'))
  const value = raw.trim()
  if (/\s/.test(value)) throw new Error(t('errDomainWhitespace'))
  let url: URL
  try { url = new URL(value.includes('://') ? value : `https://${value}`) }
  catch { throw new Error(t('errUnrecognizedDomain')) }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(t('errHttpHttpsOnly'))
  if (url.port && url.port !== '443') throw new Error(t('errPort443Only'))
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (hostname.length > 253 || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(hostname)) throw new Error(t('errFullDomainRequired'))
  return hostname
}
/** 用长于内容的围栏保留原文，避免对端字段生成图片或链接。 */
export function markdownLiteral(value: string): string {
  const longest = Math.max(0, ...(value.match(/`+/g) ?? []).map(run => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}text\n${value}\n${fence}`
}
