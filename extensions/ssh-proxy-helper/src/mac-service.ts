export interface SshHost { alias: string; hostName?: string; user?: string; port?: number; identityFiles: string[]; proxyJump?: string; localForwards: string[]; previewComplete: boolean; notices: string[] }
export type ProxyTool = 'git' | 'npm'
export interface ProxyValue { key: string; value: string; hasCredentials: boolean; dynamic: boolean }
export type ProxyRow = { tool: ProxyTool; status: 'error'; error: string } | { tool: ProxyTool; status: 'ready'; location: string; exists: boolean; values: ProxyValue[]; notices: string[] }
export interface Snapshot { sessionId: string; ssh: { status: 'ready' | 'error'; hosts: SshHost[]; warnings: string[]; error?: string }; proxies: ProxyRow[]; backups: Array<{ id: string; createdAt: string; summary: string; tool: ProxyTool }>; backupError: string }
export type ProxyChange = { kind: 'set'; port: number } | { kind: 'clear' } | { kind: 'restore'; backupId: string }
export interface ProxyPlan { planId: string; summary: string; location: string; before: ProxyValue[]; after: ProxyValue[]; notices: string[] }
interface Bridge { transport?: { methods?: Record<string, (request: unknown) => Promise<{ success?: boolean; data?: unknown; error?: { message?: string } }>> } }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string' && v.length <= 32768
const texts = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 256 && v.every(text)
const id = (v: unknown) => typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v)
const tool = (v: unknown) => v === 'git' || v === 'npm'
/** 配置文件位置须为绝对路径：Mac 以 / 开头，Windows 为盘符路径或 UNC 路径。 */
const absolute = (v: string) => v.startsWith('/') || /^[A-Za-z]:\\/.test(v) || /^\\\\[^\\]+\\[^\\]+/.test(v)
const values = (v: unknown) => Array.isArray(v) && v.length <= 2 && v.every(p => record(p) && text(p.key) && text(p.value) && typeof p.hasCredentials === 'boolean' && typeof p.dynamic === 'boolean')
let sequence = 0
export async function sshInvoke(method: 'ssh_proxy' | 'system_get_platform', params: Record<string, unknown>) {
  const call = (globalThis as unknown as { __ztoolsElectron?: Bridge }).__ztoolsElectron?.transport?.methods?.[method]
  if (!call) throw new Error('请升级客户端后使用主机与代理')
  const result = await call({ messageId: `ssh_${Date.now()}_${++sequence}`, params, timeoutMs: 90000 })
  if (result?.success !== true || !record(result.data) || result.data.success !== true) throw new Error(result?.error?.message || '客户端未确认操作结果，请刷新后检查')
  return result.data
}
export async function scanSsh(): Promise<Snapshot> {
  const d = await sshInvoke('ssh_proxy', { action: 'scan' }), ssh = d.ssh
  if (!id(d.sessionId) || !record(ssh) || (ssh.status !== 'ready' && ssh.status !== 'error') || !Array.isArray(ssh.hosts) || ssh.hosts.length > 1024 || !texts(ssh.warnings) || (ssh.status === 'error' && (!text(ssh.error) || !ssh.error)) || !text(d.backupError)) throw new Error('主机读取结果不完整，请刷新')
  const aliases = new Set<string>()
  for (const h of ssh.hosts) {
    if (!record(h) || typeof h.alias !== 'string' || !/^[\p{L}\p{N}_][\p{L}\p{N}_.:-]{0,254}$/u.test(h.alias) || aliases.has(h.alias) || !texts(h.identityFiles) || !texts(h.localForwards) || !texts(h.notices) || typeof h.previewComplete !== 'boolean' || ['hostName', 'user', 'proxyJump'].some(k => h[k] !== undefined && !text(h[k])) || (h.port !== undefined && (!Number.isInteger(h.port) || Number(h.port) < 1 || Number(h.port) > 65535))) throw new Error('主机条目无效')
    aliases.add(h.alias)
  }
  if (!Array.isArray(d.proxies) || d.proxies.length !== 2 || new Set(d.proxies.map(p => record(p) ? p.tool : '')).size !== 2 || !d.proxies.every(p => record(p) && tool(p.tool) && (p.status === 'error' ? text(p.error) && !!p.error : p.status === 'ready' && text(p.location) && absolute(p.location) && typeof p.exists === 'boolean' && values(p.values) && texts(p.notices)))) throw new Error('代理配置结果不完整')
  if (!Array.isArray(d.backups) || d.backups.length > 4096 || !d.backups.every(b => record(b) && id(b.id) && tool(b.tool) && text(b.createdAt) && text(b.summary))) throw new Error('备份列表无效')
  return d as unknown as Snapshot
}
export async function prepareProxy(sessionId: string, target: ProxyTool, change: ProxyChange): Promise<ProxyPlan> {
  const d = await sshInvoke('ssh_proxy', { action: 'prepare', sessionId, tool: target, change })
  if (!id(d.planId) || !text(d.summary) || !text(d.location) || !values(d.before) || !values(d.after) || !texts(d.notices)) throw new Error('修改预览不完整，未执行写入')
  return d as unknown as ProxyPlan
}
export async function applyProxy(planId: string) {
  const d = await sshInvoke('ssh_proxy', { action: 'apply', planId })
  if (d.verified !== true || !id(d.backupId) || !text(d.summary) || (d.recoveryPath !== undefined && !text(d.recoveryPath))) throw new Error('写入结果未完整确认，请先刷新，不要重复提交')
  return { summary: d.summary, backupId: String(d.backupId), recoveryPath: d.recoveryPath as string | undefined }
}
export function sourceMarkdown(row: Extract<ProxyRow, { status: 'ready' }>) {
  const literal = (value: string) => value.replace(/[\\`*_{}[\]()#+.!|><~:\-]/g, '\\$&')
  return `配置文件：\n\n${literal(row.location)}\n\n${row.notices.map(literal).join('\n\n')}`
}
export async function openSshTerminal(params: Record<string, unknown>) {
  const d = await sshInvoke('ssh_proxy', params)
  if (d.opened !== true || !text(d.notice) || !d.notice) throw new Error('终端打开请求未确认，请检查终端窗口')
  return d.notice
}
export async function cancelSsh() { await sshInvoke('ssh_proxy', { action: 'cancel' }) }
