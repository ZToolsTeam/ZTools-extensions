import { callHostTransport } from './native-ipc.js'
import type { CompareFoldersResponse, DiffFilterType, ExecuteSyncResponse, FolderSyncDiffItem, SyncMode } from './types.js'
let sequence = 0
interface Reply { success?: boolean; data?: unknown; error?: { message?: string } }
interface Bridge { transport?: { methods?: Record<string, (request: unknown) => Promise<Reply>> } }

async function request(params: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  const methods = (globalThis as unknown as { __ztoolsElectron?: Bridge }).__ztoolsElectron?.transport?.methods
  if (!methods?.folder_sync || !methods.folder_sync_cancel) throw new Error('请升级至 1.1.8.5 或更新客户端后使用目录同步')
  signal.throwIfAborted()
  const id = `sync_${Date.now()}_${++sequence}`
  const cancel = () => { void methods.folder_sync_cancel!({ messageId: `cancel_${id}`, params: { operationId: id }, timeoutMs: 10000 }).catch(error => console.warn('同步取消请求失败', error)) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    const reply = await methods.folder_sync({ messageId: id, params: { ...params, operationId: id }, timeoutMs: 300000 })
    // 执行后仍读取宿主结果，不能把已完成的写入假称为“取消后无变化”。
    if (reply?.success !== true || !reply.data || typeof reply.data !== 'object') throw new Error(reply?.error?.message || '同步结果未确认，请检查备份目录并重新比对')
    return reply.data
  } finally { signal.removeEventListener('abort', cancel) }
}
export async function compareFolderTrees(options: { sourceDir: string; targetDir: string; syncMode: SyncMode; ignoreDevJunk: boolean }, signal: AbortSignal): Promise<CompareFoldersResponse> {
  const result = await request({ action: 'compare', ...options }, signal) as CompareFoldersResponse
  signal.throwIfAborted()
  if (result.ok !== true || typeof result.planId !== 'string' || !Array.isArray(result.diffs)) throw new Error('没有收到完整的比对清单')
  return result
}
export async function executeFolderSync(planId: string, selectedRelPaths: string[], signal: AbortSignal): Promise<ExecuteSyncResponse> {
  const result = await request({ action: 'execute', planId, selectedRelPaths }, signal) as ExecuteSyncResponse
  if (typeof result.ok !== 'boolean' || !Array.isArray(result.failures) || !Array.isArray(result.recoveryPaths) ||
    ![result.syncedCount, result.deletedCount, result.transferredBytes, result.remainingCount].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('同步结果不完整，请检查备份目录并重新比对')
  return result
}
export async function chooseFolder(title: string): Promise<string | undefined> {
  const result = await callHostTransport<{ canceled?: boolean; folderPath?: string }>('window_show_select_folder_dialog', { title })
  if (!result.ok) throw new Error(result.error || '目录选择失败')
  if (result.data?.canceled) return
  const file = result.data?.folderPath
  if (typeof file !== 'string' || !file) return
  return file
}
export async function revealRecovery(file: string) {
  const result = await callHostTransport('shell_show_item_in_folder', { fullPath: file })
  if (!result.ok) throw new Error(result.error || '无法打开备份目录')
}
export function formatSyncBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}
export function filterSyncDiffItems(items: readonly FolderSyncDiffItem[], filter: DiffFilterType, query: string) {
  const q = query.trim().toLowerCase()
  return items.filter(item => (filter === 'all' || item.diffType === filter || (filter === 'added' && item.diffType === 'reverse-add')) && `${item.relPath} ${item.reasonText}`.toLowerCase().includes(q))
}
