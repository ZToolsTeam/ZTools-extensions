import type { KeyboardLockRequest, KeyboardLockState } from './types.js'
interface BridgeReply { success?: boolean; data?: unknown; error?: { message?: string } }
interface Bridge { transport?: { methods?: { keyboard_lock?: (request: unknown) => Promise<BridgeReply> } } }
let sequence = 0
export const CLEAN_DURATION_PRESETS = [15, 30, 60, 120, 300] as const
export function createLockOperationId() { return `keyboard_${Date.now()}_${++sequence}` }
export function validateLockState(value: unknown, id: string): KeyboardLockState {
  const state = value as KeyboardLockState | null
  if (!state || state.success !== true || state.operationId !== id || !['locked', 'unlocked'].includes(state.status) ||
      !Number.isSafeInteger(state.remainingSeconds) || state.remainingSeconds < 0 || state.remainingSeconds > 300 ||
      !Number.isSafeInteger(state.blockedEvents) || state.blockedEvents < 0 || typeof state.lockPointer !== 'boolean' ||
      typeof state.reason !== 'string' || state.reason.length > 64 ||
      (state.status === 'unlocked' && state.remainingSeconds !== 0)) throw new Error('客户端未返回可信的输入锁状态')
  return state
}
export async function keyboardLock(request: KeyboardLockRequest): Promise<KeyboardLockState> {
  const method = (globalThis as unknown as { __ztoolsElectron?: Bridge }).__ztoolsElectron?.transport?.methods?.keyboard_lock
  if (!method) throw new Error('请更新客户端后使用系统键盘清洁锁')
  const response = await method({ messageId: `lock_${Date.now()}_${++sequence}`, params: request, timeoutMs: 5000 })
  if (response?.success !== true) throw new Error(response?.error?.message || '系统输入锁操作失败')
  return validateLockState(response.data, request.operationId)
}
export function formatCleanDuration(seconds: number) { return seconds < 60 ? `${seconds} 秒` : `${seconds / 60} 分钟` }
export const unlockReasons: Record<string, string> = {
  timer: '倒计时结束，输入已恢复', emergency: '已通过紧急快捷键解除', manual: '输入已恢复',
  connection_lost: '与客户端失联，输入锁已自动解除', tap_disabled: '系统停止了输入拦截，输入锁已解除',
  secure_input: '进入系统安全输入，输入锁已解除', error: '输入锁发生异常并已退出，请检查权限后重试',
  process_exit: '输入锁进程已退出，输入已恢复'
}
