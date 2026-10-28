export function normalizeDomainInput(raw: string): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 2048) throw new Error('请输入有效域名')
  const value = raw.trim()
  if (/\s/.test(value)) throw new Error('域名不能包含空白字符')
  let url: URL
  try { url = new URL(value.includes('://') ? value : `https://${value}`) }
  catch { throw new Error('无法识别域名或网址') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('只接受域名或 HTTP/HTTPS 网址，不要包含账号信息')
  if (url.port && url.port !== '443') throw new Error('当前查询 HTTPS 的 443 端口，请移除网址中的其他端口')
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (hostname.length > 253 || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(hostname)) throw new Error('请输入完整域名，例如 example.com')
  return hostname
}
/** 用长于内容的围栏保留原文，避免对端字段生成图片或链接。 */
export function markdownLiteral(value: string): string {
  const longest = Math.max(0, ...(value.match(/`+/g) ?? []).map(run => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}text\n${value}\n${fence}`
}
