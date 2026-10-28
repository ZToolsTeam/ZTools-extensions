export interface NetworkService {
  name: string; device: string; addresses: string[]; servers: string[]
  backup: { id: string; servers: string[]; createdAt: string } | null
}
export interface ProbeResult { server: string; milliseconds: number | null; answers: string[]; error: string | null }
interface Reply { success?: boolean; data?: unknown; error?: { message?: string } }
interface Bridge { transport?: { methods?: Record<string, (request: unknown) => Promise<Reply>> } }
let sequence = 0
export function operationId() { return `dns_${Date.now()}_${++sequence}` }
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(v => typeof v === 'string' && v.length > 0) }
export function validService(value: unknown): value is NetworkService {
  if (!record(value) || typeof value.name !== 'string' || !value.name || typeof value.device !== 'string' || !value.device || !strings(value.addresses) || !strings(value.servers)) return false
  const backup = value.backup
  return backup === null || record(backup) && typeof backup.id === 'string' && /^[0-9a-f-]{36}$/.test(backup.id) && strings(backup.servers) && typeof backup.createdAt === 'string' && Number.isFinite(Date.parse(backup.createdAt))
}
async function invoke(method: string, params: unknown) {
  const call = (globalThis as unknown as { __ztoolsElectron?: Bridge }).__ztoolsElectron?.transport?.methods?.[method]
  if (!call) throw new Error('请升级客户端后使用 DNS 工具')
  const result = await call({ messageId: operationId(), params, timeoutMs: method === 'dns_benchmark' ? 240000 : 10000 })
  if (result?.success !== true) throw new Error(result?.error?.message || 'DNS 请求失败')
  if (!record(result.data) || result.data.success !== true) throw new Error('客户端未确认 DNS 操作结果')
  return result.data
}
export async function clientPlatform() {
  const data = await invoke('system_get_platform', {})
  if (!['macos', 'windows', 'linux'].includes(String(data.platform))) throw new Error('无法识别客户端平台')
  return String(data.platform)
}
export async function listServices(id: string) {
  const data = await invoke('dns_benchmark', { action: 'list', operationId: id })
  if (!Array.isArray(data.services) || !data.services.every(validService) || new Set(data.services.map(v => v.name)).size !== data.services.length) throw new Error('客户端返回的网络服务列表无效')
  return data.services as NetworkService[]
}
export async function probeServers(id: string, servers: string[]) {
  const data = await invoke('dns_benchmark', { action: 'benchmark', operationId: id, servers })
  if (data.domain !== 'example.com' || !Array.isArray(data.results) || data.results.length !== servers.length || !data.results.every(v => record(v) &&
    servers.includes(String(v.server)) && strings(v.answers) && (v.milliseconds === null ? v.answers.length === 0 && typeof v.error === 'string' :
      typeof v.milliseconds === 'number' && Number.isFinite(v.milliseconds) && v.milliseconds >= 0 && v.answers.length > 0 && v.error === null)) ||
    new Set(data.results.map(v => v.server)).size !== servers.length) throw new Error('客户端返回的 DNS 解析结果不完整')
  return data.results as unknown as ProbeResult[]
}
export async function changeDns(id: string, service: NetworkService, action: 'apply' | 'reset' | 'restore', server?: string) {
  const data = await invoke('dns_benchmark', { action, operationId: id, service: service.name, expectedServers: service.servers,
    ...(action === 'apply' ? { servers: [server] } : action === 'restore' ? { backupId: service.backup?.id } : {}) })
  if (!validService(data.service) || data.service.name !== service.name || data.service.device !== service.device) throw new Error('客户端未返回可核对的网络配置，请刷新检查')
  return data.service
}
export async function flushDns(id: string) { await invoke('dns_benchmark', { action: 'flush', operationId: id }) }
export async function cancelDns(id: string) { await invoke('dns_benchmark', { action: 'cancel', operationId: id }) }
