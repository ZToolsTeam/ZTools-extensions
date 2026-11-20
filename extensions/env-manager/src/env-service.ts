import { t } from './i18n.js'
import type { EnvChange, EnvPlan, EnvSnapshot } from './types.js'
interface Reply { success?: boolean; data?: unknown; error?: { message?: string } }
interface Bridge { transport?: { methods?: Record<string, (request: unknown) => Promise<Reply>> } }
let sequence = 0
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v)
const scope = (v: unknown) => v === 'user' || v === 'system'
const text = (v: unknown): v is string => typeof v === 'string'
async function invoke(params: Record<string, unknown>) {
  const call = (globalThis as unknown as { __ztoolsElectron?: Bridge }).__ztoolsElectron?.transport?.methods?.environment_manager
  if (!call) throw new Error(t('upgradeClient'))
  const result = await call({ messageId: `environment_${Date.now()}_${++sequence}`, params, timeoutMs: 90000 })
  if (result?.success !== true) throw new Error(result?.error?.message || t('envRequestFailed'))
  if (!record(result.data) || result.data.success !== true) throw new Error(t('envUnconfirmed'))
  return result.data
}
export async function loadEnvironment(): Promise<EnvSnapshot> {
  const d = await invoke({ action: 'list' })
  if (!id(d.sessionId) || !text(d.platform) || !text(d.notice) || !Array.isArray(d.sources) || !d.sources.every(v => record(v) && scope(v.id) && text(v.label)) ||
      !Array.isArray(d.variables) || !d.variables.every(v => record(v) && text(v.key) && text(v.value) && (scope(v.scope) || v.scope === 'process')) ||
      !Array.isArray(d.paths) || !d.paths.every(v => record(v) && (scope(v.scope) || v.scope === 'process') && Number.isSafeInteger(v.index) && Number(v.index) >= 0 && text(v.value) && text(v.reason) && typeof v.status === 'string' && ['directory', 'missing', 'unknown'].includes(v.status)) ||
      !Array.isArray(d.backups) || !d.backups.every(v => record(v) && id(v.id) && scope(v.source) && text(v.createdAt) && text(v.summary))) throw new Error(t('envListIncomplete'))
  return d as unknown as EnvSnapshot
}
export async function prepareEnvironment(sessionId: string, change: EnvChange): Promise<EnvPlan> {
  const d = await invoke({ action: 'prepare', sessionId, change })
  if (!id(d.planId) || !text(d.summary) || !text(d.location) || !text(d.notice) || !Array.isArray(d.removed) || !d.removed.every(text)) throw new Error(t('planIncomplete'))
  return d as unknown as EnvPlan
}
export async function applyEnvironment(planId: string) {
  const d = await invoke({ action: 'apply', planId })
  if (d.verified !== true || !id(d.backupId) || !text(d.summary) || (d.recoveryPath !== undefined && !text(d.recoveryPath))) throw new Error(t('applyUnconfirmed'))
  return { backupId: d.backupId, summary: d.summary, recoveryPath: d.recoveryPath as string | undefined }
}
export async function cancelEnvironment() { await invoke({ action: 'cancel' }) }
/** PATH 变量名：Windows 注册表不区分大小写（常见为 Path），macOS shell 区分大小写，只认 PATH。 */
export function isPathKey(key: string, platform: string) { return platform === 'win32' ? key.toUpperCase() === 'PATH' : key === 'PATH' }
/**
 * macOS 终端配置按字面量写入 export PATH='...'，会整体替换终端里的 PATH；
 * $PATH、$HOME、~ 不会展开，缺少 /usr/bin、/bin 时新终端连 ls 都找不到。返回拒绝原因，合格时返回空串。
 */
export function darwinPathProblem(value: string) {
  if (/[$`]/.test(value)) return t('darwinPathNoExpand')
  const parts = value.split(':')
  if (parts.some(p => p.startsWith('~'))) return t('darwinPathNoTilde')
  if (parts.some(p => p && !p.startsWith('/'))) return t('darwinPathMustAbs')
  if (!parts.includes('/usr/bin') || !parts.includes('/bin')) return t('darwinPathKeepSys')
  return ''
}
export function exportEnvSnapshot(snapshot: EnvSnapshot) {
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), platform: snapshot.platform, notice: snapshot.notice, sources: snapshot.sources, variables: snapshot.variables, paths: snapshot.paths }, null, 2)
}
