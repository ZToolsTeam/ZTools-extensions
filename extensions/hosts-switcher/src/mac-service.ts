import { t } from './i18n.js'
export interface HostsState { sessionId: string; content: string; path: string; backups: Array<{ id: string; createdAt: string }> }
export interface HostsPlan { planId: string; before: string; content: string; path: string }
interface Bridge { transport?: { methods?: Record<string, (request: unknown) => Promise<{ success?: boolean; data?: unknown; error?: { message?: string } }>> } }
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const string = (v: unknown): v is string => typeof v === 'string'
let sequence = 0
export async function hostsInvoke(method: string, params: Record<string, unknown>) {
  const methodFn = (globalThis as unknown as { __ztoolsElectron?: Bridge }).__ztoolsElectron?.transport?.methods?.[method]
  if (!methodFn) throw new Error(t('errUpgradeForMacHosts'))
  const reply = await methodFn({ messageId: `hosts_${Date.now()}_${++sequence}`, params, timeoutMs: 120000 })
  if (reply?.success !== true || !record(reply.data) || reply.data.success !== true) throw new Error(reply?.error?.message || t('errHostsOpUnconfirmed'))
  return reply.data
}
export async function readHosts() {
  const data = await hostsInvoke('hosts_manager', { action: 'read' })
  if (!string(data.sessionId) || !string(data.content) || !string(data.path) || !Array.isArray(data.backups) || data.backups.some(b => !record(b) || !string(b.id) || !string(b.createdAt))) throw new Error(t('errHostsReadIncomplete'))
  return data as unknown as HostsState
}
export async function prepareHosts(sessionId: string, change: { content: string } | { backupId: string }) {
  const data = await hostsInvoke('hosts_manager', { action: 'content' in change ? 'prepare' : 'restore', sessionId, ...change })
  if (!string(data.planId) || !string(data.before) || !string(data.content) || !string(data.path)) throw new Error(t('errHostsPreviewIncomplete'))
  return data as unknown as HostsPlan
}
export async function applyHosts(planId: string) {
  const data = await hostsInvoke('hosts_manager', { action: 'apply', planId })
  if (data.written !== true || typeof data.dnsFlushed !== 'boolean' || !string(data.dnsError) || !string(data.backupId) || !string(data.recoveryPath) || (data.dnsFlushed && data.dnsError)) throw new Error(t('errHostsWriteReceiptIncomplete'))
  return { dnsFlushed: data.dnsFlushed, dnsError: data.dnsError, backupId: data.backupId, recoveryPath: data.recoveryPath }
}
export async function flushHostsDns() {
  const data = await hostsInvoke('hosts_manager', { action: 'flush' }); if (data.flushed !== true) throw new Error(t('errDnsFlushUnconfirmed'))
}
export async function cancelHosts() { await hostsInvoke('hosts_manager', { action: 'cancel' }) }
