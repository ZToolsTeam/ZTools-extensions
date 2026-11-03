export interface MacProject { id: string; path: string; name: string; editor: string; editorName: string; family: 'vsc' | 'jetbrains'; kind: 'folder' | 'workspace'; lastOpenedMs: number | null; gitBranch: string | null; pathState: 'available' | 'missing' | 'unreadable'; pathError: string | null }
export interface MacProjectsReport { projects: MacProject[]; warnings: string[]; sourcesRead: number; skippedRemote: number }
interface Bridge { transport?: { methods?: Record<string, (request: unknown) => Promise<{ success?: boolean; data?: unknown; error?: { message?: string } }>> } }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
let sequence = 0
export const projectOperationId = () => `projects_${Date.now()}_${++sequence}`
export async function projectsInvoke(method: string, params: Record<string, unknown>) {
  const invoke = (globalThis as unknown as { __ztoolsElectron?: Bridge }).__ztoolsElectron?.transport?.methods?.[method]
  if (!invoke) throw new Error('请升级客户端后使用最近项目')
  const result = await invoke({ messageId: projectOperationId(), params, timeoutMs: 25000 })
  if (result?.success !== true || !record(result.data) || result.data.success !== true) throw new Error(result?.error?.message || '项目操作未确认成功')
  return result.data
}
export async function scanMacProjects(operationId: string): Promise<MacProjectsReport> {
  const data = await projectsInvoke('recent_projects', { action: 'scan', operationId })
  if (!Array.isArray(data.projects) || data.projects.length > 5000 || !Array.isArray(data.warnings) || data.warnings.some(w => typeof w !== 'string') ||
      !Number.isSafeInteger(data.sourcesRead) || Number(data.sourcesRead) < 0 || !Number.isSafeInteger(data.skippedRemote) || Number(data.skippedRemote) < 0) throw new Error('项目扫描结果不完整')
  const ids = new Set<string>()
  for (const p of data.projects) {
    if (!record(p) || typeof p.id !== 'string' || !/^[a-f0-9]{64}$/.test(p.id) || ids.has(p.id) ||
        !['path', 'name', 'editor', 'editorName'].every(k => typeof p[k] === 'string') || !/^(\/|[A-Za-z]:\\|\\\\)/.test(String(p.path)) ||
        (typeof p.family !== 'string' || !['vsc', 'jetbrains'].includes(p.family)) || (typeof p.kind !== 'string' || !['folder', 'workspace'].includes(p.kind)) ||
        (typeof p.pathState !== 'string' || !['available', 'missing', 'unreadable'].includes(p.pathState)) ||
        (p.lastOpenedMs !== null && (!Number.isSafeInteger(p.lastOpenedMs) || Number(p.lastOpenedMs) <= 0)) ||
        (p.gitBranch !== null && typeof p.gitBranch !== 'string') || (p.pathError !== null && typeof p.pathError !== 'string')) throw new Error('项目条目无效')
    ids.add(p.id)
  }
  // 一份历史都没读到却有警告：把具体原因带出来，不用笼统的"检查权限"盖掉真实错误
  if (!data.sourcesRead && data.warnings.length) throw new Error(`未能读取项目历史：${(data.warnings as string[]).slice(0, 3).join('；')}`)
  if (!data.sourcesRead && data.projects.length) throw new Error('项目历史缺少来源记录')
  return data as unknown as MacProjectsReport
}
export async function openMacProject(project: MacProject, action: 'open' | 'terminal') {
  const result = await projectsInvoke('recent_projects', { action, id: project.id })
  if (result.accepted !== true || result.id !== project.id || result.action !== action) throw new Error('系统未确认项目打开请求')
}
/** 宿主打开失败时常带 Node 原始错误（ENOENT / EACCES），换成用户看得懂的中文说明，保留原文便于排查 */
export function describeOpenError(error: unknown, project: Pick<MacProject, 'path'>) {
  const raw = error instanceof Error ? error.message : String(error)
  // 只有报错指向项目路径本身才改写；编辑器程序缺失等其他 ENOENT 保留原文，避免误报成项目被删除
  if (!raw.includes(project.path)) return raw
  if (/\bENOENT\b|\bENOTDIR\b/.test(raw)) return `项目路径已不存在：${project.path}。若已恢复请重新扫描`
  if (/\bEACCES\b|\bEPERM\b/.test(raw)) return `没有访问项目路径的权限：${project.path}（${raw}）`
  return raw
}
export const cancelMacProjects = (operationId: string) => projectsInvoke('recent_projects', { action: 'cancel', operationId })
export function filterMacProjects(items: MacProject[], query: string, family: string, hideMissing: boolean) {
  const q = query.trim().toLocaleLowerCase()
  return items.filter(p => (family === 'all' || p.family === family) && (!hideMissing || p.pathState !== 'missing') &&
    [p.name, p.path, p.editorName, p.gitBranch || ''].some(v => v.toLocaleLowerCase().includes(q)))
}
