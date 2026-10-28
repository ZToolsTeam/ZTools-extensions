export interface MacStartupItem {
  id: string; label: string; file: string; domain: string; scope: 'user-agent' | 'system-agent' | 'daemon'
  program: string; args: string[]; scheduled: boolean; enabled: boolean; loaded: boolean; running: boolean
  pid: number | null; programState: 'available' | 'missing' | 'unknown'; requiresAdmin: boolean; blockedReason: string | null
}
export interface StartupBackup { id: string; kind: 'toggle' | 'remove'; createdAt: string; label: string; beforeEnabled: boolean; afterEnabled: boolean }
export interface StartupReport { items: MacStartupItem[]; warnings: string[]; backups: StartupBackup[] }
interface Bridge { transport?: { methods?: Record<string, (value: unknown) => Promise<{ success?: boolean; data?: unknown; error?: { message?: string } }>> } }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
let nextId = 0
export const startupOperation = () => `startup_${Date.now()}_${++nextId}`
export async function startupInvoke(method: string, params: Record<string, unknown>) {
  const bridge = (globalThis as unknown as { __ztoolsElectron?: Bridge }).__ztoolsElectron
  const invoke = bridge?.transport?.methods?.[method]
  if (!invoke) throw new Error('请升级客户端后使用 Mac 启动管理')
  const writing = ['set-enabled', 'remove', 'restore'].includes(String(params.action))
  const reply = await invoke({ messageId: startupOperation(), params, timeoutMs: writing ? 120000 : 30000 })
  if (reply?.success !== true || !record(reply.data) || reply.data.success !== true) throw new Error(reply?.error?.message || '启动管理未确认成功')
  return reply.data
}
export async function scanStartup(operationId: string): Promise<StartupReport> {
  const data = await startupInvoke('startup_manager', { action: 'scan', operationId })
  if (!Array.isArray(data.items) || data.items.length > 1536 || !Array.isArray(data.warnings) || data.warnings.some(w => typeof w !== 'string') || !Array.isArray(data.backups)) throw new Error('启动管理返回的列表不完整')
  const ids = new Set<string>()
  for (const item of data.items) {
    if (!record(item) || typeof item.id !== 'string' || !/^[a-f0-9]{64}$/.test(item.id) || ids.has(item.id) ||
        !['label', 'file', 'domain', 'program'].every(k => typeof item[k] === 'string') ||
        typeof item.scope !== 'string' || !['user-agent', 'system-agent', 'daemon'].includes(item.scope) ||
        !['scheduled', 'enabled', 'loaded', 'running', 'requiresAdmin'].every(k => typeof item[k] === 'boolean') ||
        !Array.isArray(item.args) || item.args.some(a => typeof a !== 'string') ||
        (item.pid !== null && (!Number.isSafeInteger(item.pid) || Number(item.pid) <= 0)) ||
        (item.blockedReason !== null && typeof item.blockedReason !== 'string') ||
        typeof item.programState !== 'string' || !['available', 'missing', 'unknown'].includes(item.programState)) throw new Error('启动项返回了无效状态')
    ids.add(item.id)
  }
  for (const backup of data.backups) {
    if (!record(backup) || !['id', 'createdAt', 'label'].every(k => typeof backup[k] === 'string') ||
        (backup.kind !== 'toggle' && backup.kind !== 'remove') ||
        !Number.isFinite(Date.parse(String(backup.createdAt))) || typeof backup.beforeEnabled !== 'boolean' || typeof backup.afterEnabled !== 'boolean') throw new Error('恢复记录返回结果无效')
  }
  return data as unknown as StartupReport
}
export function filterStartup(items: MacStartupItem[], query: string, filter: string) {
  const q = query.trim().toLocaleLowerCase()
  return items.filter(i => (filter === 'all' || (filter === 'user' && i.scope === 'user-agent') || (filter === 'service' && i.scope !== 'user-agent') ||
    (filter === 'task' && i.scheduled) || (filter === 'disabled' && !i.enabled) || (filter === 'broken' && i.programState === 'missing')) &&
    [i.label, i.program, i.file, ...i.args].some(text => text.toLocaleLowerCase().includes(q)))
}
