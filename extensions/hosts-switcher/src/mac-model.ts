import { LocalStorage } from '@ztools/declarative-ui'
export interface Profile { id: string; name: string; content: string; updatedAt: number }
export const STORAGE_KEY = 'hosts.profiles.v1'
const START = '# >>> ZTools Hosts v1 >>>', END = '# <<< ZTools Hosts v1 <<<', PROFILE = '# ztools-profile ', STOP = '# ztools-end-profile'
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const byteSize = (text: string) => new TextEncoder().encode(text).length
export function validIp(value: string) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(value)) return value.split('.').every(p => /^(0|[1-9]\d{0,2})$/.test(p) && +p <= 255)
  if (!value.includes(':') || /[^a-fA-F0-9:.]/.test(value)) return false
  try { return new URL(`http://[${value}]/`).hostname.startsWith('[') } catch { return false }
}
function validName(value: string) { return value.length <= 253 && value.replace(/\.$/, '').split('.').every(p => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(p)) }
export function rules(content: string, strict = true) {
  if (byteSize(content) > 1024 * 1024 || /[\0\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(content)) throw new Error('规则包含非法字符或超过 1 MiB')
  const result: Array<{ ip: string; domain: string }> = []
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const text = line.split('#')[0].trim(); if (!text) continue
    const [ip, ...names] = text.split(/\s+/)
    if (!validIp(ip) || !names.length || names.some(v => !validName(v))) { if (strict) throw new Error(`第 ${index + 1} 行规则无效，请使用 IP 域名格式`); else continue }
    for (const domain of names) result.push({ ip, domain: domain.toLowerCase().replace(/\.$/, '') })
  }
  return result
}
export function validateProfile(value: unknown): asserts value is Profile {
  if (!record(value) || typeof value.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(value.id) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120 || /[\r\n\0]/.test(value.name) || typeof value.content !== 'string' || !Number.isFinite(value.updatedAt)) throw new Error('本地 Hosts 方案数据损坏，已停止写入')
  const content = value.content
  if ([START, END, PROFILE, STOP].some(marker => content.includes(marker))) throw new Error('方案不能包含 ZTools 管理区标记')
  rules(value.content)
}
function stored(value: unknown): Profile[] {
  if (value === undefined) return []
  if (!record(value) || value.version !== 1 || !Array.isArray(value.profiles) || value.profiles.length > 256) throw new Error('Hosts 本地方案读取失败，保留原数据')
  const seen = new Set<string>()
  for (const profile of value.profiles) { validateProfile(profile); if (seen.has(profile.id)) throw new Error('Hosts 方案编号重复'); seen.add(profile.id) }
  return value.profiles as Profile[]
}
export async function loadProfiles() { return stored(await LocalStorage.getItem(STORAGE_KEY)) }
export async function saveProfile(profile: Profile, expected?: Profile) {
  validateProfile(profile)
  if (typeof LocalStorage.updateItem !== 'function') throw new Error('请升级客户端以安全保存 Hosts 方案')
  const value = await LocalStorage.updateItem(STORAGE_KEY, raw => {
    const list = stored(raw), previous = list.find(p => p.id === profile.id)
    if (JSON.stringify(previous) !== JSON.stringify(expected)) throw new Error('方案已被其他窗口修改，请返回重新读取')
    const next = previous ? list.map(p => p.id === profile.id ? profile : p) : [...list, profile]
    const result = { version: 1, profiles: next }; stored(result); return result
  })
  return stored(value)
}
export async function removeProfile(profile: Profile) {
  if (typeof LocalStorage.updateItem !== 'function') throw new Error('请升级客户端以安全保存 Hosts 方案')
  return stored(await LocalStorage.updateItem(STORAGE_KEY, raw => {
    const list = stored(raw)
    if (JSON.stringify(list.find(p => p.id === profile.id)) !== JSON.stringify(profile)) throw new Error('方案已被其他窗口修改，请重新读取')
    return { version: 1, profiles: list.filter(p => p.id !== profile.id) }
  }))
}
export function splitHosts(content: string): { base: string; active: Profile[] } {
  const start = content.indexOf(START)
  if (start < 0) { if (content.includes(END) || content.includes(PROFILE) || content.includes(STOP)) throw new Error('系统 Hosts 管理区不完整，请检查原文件'); return { base: content, active: [] } }
  const firstLine = content.slice(start).split('\n')[0]
  if ((start > 0 && content[start - 1] !== '\n') || firstLine !== START || content.indexOf(START, start + START.length) >= 0 || !content.endsWith(END + '\n')) throw new Error('系统 Hosts 管理区已被外部修改，请检查原文件')
  // 首行元数据记录追加前的精确末尾状态，禁用全部方案时按字节还原基础内容。
  const lines = content.slice(start + START.length + 1, -(END.length + 1)).split('\n')
  const meta = lines.shift(); if (meta !== '# base-newline: yes' && meta !== '# base-newline: no') throw new Error('系统 Hosts 管理区元数据无效')
  let base = content.slice(0, start); if (meta.endsWith('no')) { if (!base.endsWith('\n')) throw new Error('系统 Hosts 基础内容边界无效'); base = base.slice(0, -1) }
  const active: Profile[] = []
  while (lines.length && lines[0] !== '') {
    const header = lines.shift()!; if (!header.startsWith(PROFILE)) throw new Error('系统 Hosts 方案区无效')
    let profile: unknown
    try { profile = JSON.parse(header.slice(PROFILE.length)) } catch { throw new Error('系统 Hosts 方案元数据损坏') }
    const end = lines.indexOf(STOP); if (end < 0) throw new Error('系统 Hosts 方案没有结束标记')
    const body = lines.splice(0, end).join('\n'); lines.shift()
    if (!record(profile) || typeof profile.trailingNewline !== 'boolean') throw new Error('系统 Hosts 方案元数据无效')
    const item = { id: profile.id, name: profile.name, updatedAt: profile.updatedAt, content: body + (profile.trailingNewline ? '\n' : '') }
    validateProfile(item); if (active.some(p => p.id === item.id)) throw new Error('系统 Hosts 方案重复'); active.push(item)
  }
  if (lines.some(line => line !== '') || active.length > 256) throw new Error('系统 Hosts 管理区包含无法识别的数据')
  return { base, active }
}
export function combineHosts(base: string, active: Profile[]) {
  if (!active.length) return base
  const map = new Map<string, Set<string>>()
  const canonical = (ip: string) => ip.includes(':') ? new URL(`http://[${ip}]/`).hostname.toLowerCase() : ip
  for (const entry of rules(base, false)) {
    const key = `${entry.domain}:${entry.ip.includes(':') ? 6 : 4}`, values = map.get(key) ?? new Set<string>()
    values.add(canonical(entry.ip)); map.set(key, values)
  }
  const sections: string[] = []
  for (const profile of active) {
    validateProfile(profile)
    for (const entry of rules(profile.content)) {
      const key = `${entry.domain}:${entry.ip.includes(':') ? 6 : 4}`, previous = map.get(key)
      if (previous && [...previous].some(ip => ip !== canonical(entry.ip))) throw new Error(`${entry.domain} 与现有映射冲突，请先编辑方案；原系统规则不会被覆盖`)
      map.set(key, new Set([canonical(entry.ip)]))
    }
    sections.push(PROFILE + JSON.stringify({ id: profile.id, name: profile.name, updatedAt: profile.updatedAt, trailingNewline: profile.content.endsWith('\n') }), profile.content.replace(/\n$/, ''), STOP)
  }
  const result = base + (base.endsWith('\n') ? '' : '\n') + START + '\n# base-newline: ' + (base.endsWith('\n') ? 'yes' : 'no') + '\n' + sections.join('\n') + '\n' + END + '\n'
  if (byteSize(result) > 1024 * 1024) throw new Error('合并后的 Hosts 超过 1 MiB')
  return result
}

/** 内容只作为代码显示；围栏长于原文中的任何围栏，注释里的链接不参与 Markdown。 */
export function hostsCodeBlock(content: string) {
  const normalized = content.replace(/\r\n?/g, '\n')
  let length = 3
  for (const match of normalized.matchAll(/[`~]+/g)) length = Math.max(length, match[0].length + 1)
  const fence = '`'.repeat(length)
  return `\n${fence}text\n${normalized}\n${fence}\n`
}
