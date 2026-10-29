export interface FocusState {
  id: string; title: string; status: 'idle' | 'running' | 'paused' | 'completed' | 'cancelled'
  mode: 'single' | 'pomodoro'; phase: 'focus' | 'short_break' | 'long_break'
  remainingMs: number; totalDurationMs: number; completedCycles: number; notificationWarning?: string
}
interface Bridge { transport?: { methods?: Record<string, (request: unknown) => Promise<{ success: boolean; data?: unknown; error?: { message?: string } }>> } }
let sequence = 0
// 宿主计时服务的状态冲突错误是英文，转成用户看得懂的原因（多发生在休息自动结束、或另一个窗口刚操作过）
const HOST_ERRORS: Array<[RegExp, string]> = [
  [/already running or paused/i, '已有进行中或暂停的计时，请刷新后继续或取消它'],
  [/no active running focus session to pause/i, '当前没有进行中的计时，可能刚刚到期或在其他窗口操作过，请刷新'],
  [/no paused focus session to resume/i, '当前没有暂停的计时，可能在其他窗口操作过，请刷新'],
  [/no active focus session/i, '当前没有进行中的计时，可能刚刚到期或在其他窗口操作过，请刷新']
]
export function readableHostError(message?: string): string {
  if (!message) return '专注操作未确认成功，请刷新确认状态'
  return HOST_ERRORS.find(([pattern]) => pattern.test(message))?.[1] ?? message
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export async function focusCall(method: string, params: Record<string, unknown> = {}): Promise<FocusState | null> {
  const call = (globalThis as unknown as { __ztoolsElectron?: Bridge }).__ztoolsElectron?.transport?.methods?.[method]
  if (!call) throw new Error('请升级客户端后使用持久番茄钟')
  const result = await call({ messageId: `pomodoro_${Date.now()}_${++sequence}`, params, timeoutMs: 15000 })
  if (result?.success !== true) throw new Error(readableHostError(result?.error?.message))
  if (result.data === null && method === 'focus_get_current') return null
  const s = result.data
  if (!object(s) || typeof s.id !== 'string' || !s.id || typeof s.title !== 'string' ||
      typeof s.status !== 'string' || !['idle', 'running', 'paused', 'completed', 'cancelled'].includes(s.status) ||
      typeof s.mode !== 'string' || !['single', 'pomodoro'].includes(s.mode) ||
      typeof s.phase !== 'string' || !['focus', 'short_break', 'long_break'].includes(s.phase) ||
      !Number.isSafeInteger(s.remainingMs) || Number(s.remainingMs) < 0 || !Number.isSafeInteger(s.totalDurationMs) || Number(s.totalDurationMs) < 1 || Number(s.remainingMs) > Number(s.totalDurationMs) ||
      !Number.isSafeInteger(s.completedCycles) || Number(s.completedCycles) < 0 || (s.notificationWarning !== undefined && typeof s.notificationWarning !== 'string')) throw new Error('宿主计时状态无效，请升级客户端或重新打开')
  return s as unknown as FocusState
}
