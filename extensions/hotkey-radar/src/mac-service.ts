export interface MacProbeItem { combo: string; status: 'registered' | 'occupied' | 'system' | 'owned' }
export interface MacProbeReport { checkedAt: string; results: MacProbeItem[] }
interface Bridge { transport?: { methods?: Record<string, (request: unknown) => Promise<{ success?: boolean; data?: unknown; error?: { message?: string } }>> } }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
let sequence = 0
export async function hotkeyInvoke(method: string, params: Record<string, unknown>) {
  const invoke = (globalThis as unknown as { __ztoolsElectron?: Bridge }).__ztoolsElectron?.transport?.methods?.[method]
  if (!invoke) throw new Error('请升级客户端后使用 Mac 热键侦测')
  const reply = await invoke({ messageId: `hotkey_${Date.now()}_${++sequence}`, params, timeoutMs: 15000 })
  if (reply?.success !== true) throw new Error(reply?.error?.message || '快捷键请求失败')
  if (!record(reply.data) || reply.data.success !== true) throw new Error('客户端未确认快捷键请求成功')
  return reply.data
}
const aliases: Record<string, string> = { control: 'ctrl', '⌃': 'ctrl', alt: 'option', opt: 'option', '⌥': 'option', command: 'cmd', '⌘': 'cmd', '⇧': 'shift', enter: 'return', esc: 'escape', del: 'delete', minus: '-' }
export function hotkeyFingerprint(combo: string) { return combo.toLowerCase().split('+').map(s => { const key = s.trim(); return Object.hasOwn(aliases, key) ? aliases[key] : key }).sort().join('+') }
export async function probeMac(combos: string[]): Promise<MacProbeReport> {
  const data = await hotkeyInvoke('hotkey_probe', { combos })
  if (typeof data.checkedAt !== 'string' || !Number.isFinite(Date.parse(data.checkedAt)) || !Array.isArray(data.results) || data.results.length === 0 || data.results.length > combos.length || data.results.some(r => !record(r) || typeof r.combo !== 'string' || !r.combo || typeof r.status !== 'string' || !['registered','occupied','system','owned'].includes(String(r.status))) || new Set(data.results.map(r => r.combo)).size !== data.results.length) throw new Error('热键探测回执不完整，请重新检测')
  const expected = new Set(combos.map(hotkeyFingerprint)), actual = new Set(data.results.map(r => hotkeyFingerprint(r.combo)))
  if (expected.size !== actual.size || actual.size !== data.results.length || [...actual].some(combo => !expected.has(combo))) throw new Error('热键探测结果与请求不一致，请重新检测')
  return { checkedAt: data.checkedAt, results: data.results as MacProbeItem[] }
}
