export interface LockProcess { pid: number; name: string; executablePath: string; userId: number; paths: string[]; protected: boolean; reason: string }
export interface LockSnapshot { sessionId: string; targetPath: string; isDirectory: boolean; processes: LockProcess[]; notice: string; mutationBlockedReason: string }
interface Bridge { transport?: { methods?: Record<string, (request: unknown) => Promise<{ success?: boolean; data?: unknown; error?: { message?: string } }>> } }
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string'
const pid = (v: unknown): v is number => Number.isInteger(v) && Number(v) > 0
let sequence = 0
export async function unlockInvoke(method: string, params: Record<string, unknown>) {
  const call = (globalThis as unknown as { __ztoolsElectron?: Bridge }).__ztoolsElectron?.transport?.methods?.[method]
  if (!call) throw new Error('请升级客户端后使用 Mac 文件解锁')
  const reply = await call({ messageId: `file_unlock_${Date.now()}_${++sequence}`, params, timeoutMs: 120000 })
  if (reply?.success !== true) throw new Error(reply?.error?.message || '文件解锁请求失败')
  if (!record(reply.data)) throw new Error('客户端返回的文件解锁结果不完整')
  return reply.data
}
async function invoke(params: Record<string, unknown>, partial = false) {
  const data = await unlockInvoke('file_unlock', params)
  if (data.success !== true && !(partial && data.success === false)) throw new Error('客户端没有确认操作成功')
  return data
}
export function parseLockSnapshot(data: unknown): LockSnapshot {
  if (!record(data) || data.success !== true || !text(data.sessionId) || !/^[a-f0-9-]{36}$/.test(data.sessionId) || !text(data.targetPath) || !data.targetPath.startsWith('/') || typeof data.isDirectory !== 'boolean' || !text(data.notice) || !text(data.mutationBlockedReason) || !Array.isArray(data.processes) || data.processes.some(p => !record(p) || !pid(p.pid) || !text(p.name) || !text(p.executablePath) || !Number.isInteger(p.userId) || !Array.isArray(p.paths) || !p.paths.every(text) || typeof p.protected !== 'boolean' || !text(p.reason))) throw new Error('占用检测结果不完整，请重新扫描')
  return data as unknown as LockSnapshot
}
export async function inspectMacLocks(targetPath: string) { return parseLockSnapshot(await invoke({ action: 'inspect', targetPath })) }
export async function macDrives() {
  const data = await invoke({ action: 'drives' })
  if (!Array.isArray(data.drives) || !data.drives.every(d => record(d) && text(d.path) && d.path.startsWith('/') && text(d.label))) throw new Error('外接磁盘列表不完整')
  return data.drives as Array<{ path: string; label: string }>
}
export async function terminateMacLocks(sessionId: string, pids: number[], mode: 'graceful' | 'force') {
  const data = await invoke({ action: 'terminate', sessionId, pids, mode }, true)
  if (!Array.isArray(data.terminated) || !data.terminated.every(pid) || !data.terminated.every(v => pids.includes(v)) || !Array.isArray(data.failures) || !data.failures.every(v => record(v) && pid(v.pid) && text(v.message)) || !text(data.refreshError) || (data.success === true && (data.failures.length || data.refreshError || data.terminated.length !== pids.length))) throw new Error('结束进程结果未得到完整确认，请重新扫描，勿重复结束')
  const snapshot = data.snapshot === undefined ? null : parseLockSnapshot(data.snapshot)
  if (data.success === true && !snapshot) throw new Error('结束进程后的扫描缺失，请重新检测')
  return { success: data.success === true, terminated: data.terminated as number[], failures: data.failures as Array<{ pid: number; message: string }>, refreshError: data.refreshError, snapshot }
}
export async function mutateMacTarget(sessionId: string, action: 'trash' | 'rename', name?: string) {
  const data = await invoke({ action, sessionId, ...(action === 'rename' ? { name } : {}) })
  if (data.status !== (action === 'trash' ? 'trashed' : 'renamed') || !text(data.targetPath) || !data.targetPath.startsWith('/')) throw new Error('文件操作结果未确认，请检查原路径和回收站，勿重复操作')
  return data.targetPath
}
export async function finishMacLocks(action: 'cancel' | 'close') { await invoke({ action }) }
export async function selectMacTarget(directory: boolean) {
  const data = await unlockInvoke('window_show_open_dialog', { title: directory ? '选择需要检测的文件夹或磁盘' : '选择需要检测的文件', properties: [directory ? 'openDirectory' : 'openFile'] })
  if (data.canceled === true) return null
  if (data.canceled !== false || !text(data.filePath)) throw new Error('选择目标未完成')
  return data.filePath
}
