import { LocalStorage } from '@ztools/declarative-ui'
export interface MacInterface { id: string; name: string; ip: string; netmask: string; subnet: string; broadcast: string | null; prefix: number }
export interface MacDevice { ip: string; mac: string | null; openPorts: number[]; response: 'ICMP' | 'TCP' | '本机'; latencyMs: number | null }
export interface MacScan { devices: MacDevice[]; warnings: string[]; range: string; scanned: number; durationMs: number; checkedAt: string }
interface Bridge { transport?: { methods?: Record<string, (request: unknown) => Promise<{ success?: boolean; data?: unknown; error?: { message?: string } }>> } }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const ip = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(v) && v.split('.').every(n => Number(n) < 256)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
let sequence = 0
export const lanOperationId = () => `lan_${Date.now()}_${++sequence}`
export async function lanInvoke(method: string, params: Record<string, unknown>) {
  const invoke = (globalThis as unknown as { __ztoolsElectron?: Bridge }).__ztoolsElectron?.transport?.methods?.[method]
  if (!invoke) throw new Error('请升级客户端后使用局域网扫描')
  const reply = await invoke({ messageId: lanOperationId(), params, timeoutMs: 30000 })
  if (reply?.success !== true || !record(reply.data) || reply.data.success !== true) throw new Error(reply?.error?.message || '局域网操作未确认成功')
  return reply.data
}
export async function readMacInterfaces(): Promise<MacInterface[]> {
  const result = await lanInvoke('lan_network', { action: 'interfaces' })
  if (!Array.isArray(result.interfaces) || result.interfaces.some(v => !record(v) || typeof v.name !== 'string' || !ip(v.ip) || !ip(v.netmask) || v.id !== `${v.name}|${v.ip}|${v.netmask}` || typeof v.subnet !== 'string' || !Number.isInteger(v.prefix) || Number(v.prefix) < 1 || Number(v.prefix) > 32 || (v.broadcast !== null && !ip(v.broadcast)))) throw new Error('网卡读取结果无效')
  return result.interfaces as MacInterface[]
}
export async function scanMacNetwork(iface: MacInterface, address: string, operationId: string): Promise<MacScan> {
  const result = await lanInvoke('lan_network', { action: 'scan', interfaceId: iface.id, scanAddress: address, operationId })
  if (!Array.isArray(result.devices) || result.devices.length > 256 || result.devices.some(d => !record(d) || !ip(d.ip) || (d.mac !== null && (typeof d.mac !== 'string' || !/^[\dA-F]{2}(:[\dA-F]{2}){5}$/.test(d.mac))) || !Array.isArray(d.openPorts) || d.openPorts.some(p => ![22, 80, 443, 445, 3389, 5900, 8080, 8443].includes(Number(p)) || typeof p !== 'number') || (d.latencyMs !== null && !finite(d.latencyMs)) || typeof d.response !== 'string' || !['ICMP','TCP','本机'].includes(d.response)) || !Array.isArray(result.warnings) || result.warnings.some(w => typeof w !== 'string') || typeof result.range !== 'string' || !Number.isInteger(result.scanned) || Number(result.scanned) < 1 || Number(result.scanned) > 256 || !finite(result.durationMs) || typeof result.checkedAt !== 'string' || !Number.isFinite(Date.parse(result.checkedAt))) throw new Error('扫描回执不完整，请重新扫描')
  if (new Set(result.devices.map(d => d.ip)).size !== result.devices.length) throw new Error('扫描结果含重复地址')
  const numeric = (v: string) => v.split('.').reduce((n, part) => n * 256 + Number(part), 0)
  const mask = numeric(iface.netmask), first = (numeric(iface.ip) & mask) >>> 0, last = first + ((~mask) >>> 0)
  const block = Math.floor(numeric(address) / 256) * 256, start = Math.max(first, block), end = Math.min(last, block + 255)
  const firstIp = [24, 16, 8, 0].map(s => (start >>> s) & 255).join('.')
  const count = end - start + 1 - (iface.prefix < 31 && start === first ? 1 : 0) - (iface.prefix < 31 && end === last ? 1 : 0)
  if (result.range !== `${firstIp}/${Math.max(24, iface.prefix)}` || result.scanned !== count || result.devices.length > count || result.devices.some(d => numeric(d.ip) < start || numeric(d.ip) > end || (iface.prefix < 31 && [first, last].includes(numeric(d.ip))) || new Set(d.openPorts).size !== d.openPorts.length)) throw new Error('扫描结果与请求网段不一致')
  return result as unknown as MacScan
}
export function normalizeMacInput(value: string) {
  const raw = value.trim()
  if (!/^(?:[\da-f]{12}|[\da-f]{2}(?::[\da-f]{2}){5}|[\da-f]{2}(?:-[\da-f]{2}){5})$/i.test(raw)) throw new Error('请输入 6 组十六进制 MAC 地址')
  const hex = raw.replace(/[:-]/g, '').toUpperCase()
  if (/^0+$/.test(hex) || (parseInt(hex.slice(0, 2), 16) & 1)) throw new Error('请输入有效的单播设备 MAC 地址')
  return hex.match(/../g)!.join(':')
}
export async function wakeMacDevice(iface: MacInterface, raw: string, operationId: string) {
  const mac = normalizeMacInput(raw)
  const result = await lanInvoke('lan_network', { action: 'wake', operationId, interfaceId: iface.id, mac })
  if (result.bytes !== 102 || result.mac !== mac || !iface.broadcast || result.broadcast !== iface.broadcast) throw new Error('唤醒包发送结果未确认，请检查目标设备状态')
}
const favoritesKey = 'lan.saved-macs.v1'
function savedMacs(value: unknown) {
  if (value === undefined) return [] as string[]
  if (!Array.isArray(value) || value.length > 100 || value.some(v => typeof v !== 'string' || normalizeMacInput(v) !== v)) throw new Error('收藏数据损坏，原记录已保留')
  return value as string[]
}
export async function readSavedMacs() { return savedMacs(await LocalStorage.getItem<unknown>(favoritesKey)) }
export async function saveMac(raw: string) {
  const mac = normalizeMacInput(raw)
  await LocalStorage.updateItem(favoritesKey, value => {
    const current = savedMacs(value)
    if (current.includes(mac)) return current
    if (current.length >= 100) throw new Error('最多收藏 100 个设备')
    return [...current, mac]
  })
}
export async function cancelMacNetwork(operationId: string) { await lanInvoke('lan_network', { action: 'cancel', operationId }) }
