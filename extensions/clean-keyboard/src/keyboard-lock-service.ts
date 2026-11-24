import type { KeyboardLockRequest, KeyboardLockState } from './types.js'
import { t } from './i18n.js'
import { resolveErrorMessage } from './error-i18n.js'
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
      (state.status === 'unlocked' && state.remainingSeconds !== 0)) throw new Error(t('errUntrustedLockState'))
  return state
}
export async function keyboardLock(request: KeyboardLockRequest): Promise<KeyboardLockState> {
  const method = (globalThis as unknown as { __ztoolsElectron?: Bridge }).__ztoolsElectron?.transport?.methods?.keyboard_lock
  if (!method) throw new Error(t('errUpdateClient'))
  const response = await method({ messageId: `lock_${Date.now()}_${++sequence}`, params: request, timeoutMs: 5000 })
  if (response?.success !== true) throw new Error(resolveErrorMessage(response?.error, t('errLockOpFailed')))
  return validateLockState(response.data, request.operationId)
}
export function formatCleanDuration(seconds: number) {
  return seconds < 60 ? t('durationSeconds', { seconds }) : t('durationMinutes', { minutes: seconds / 60 })
}
const UNLOCK_REASON_KEYS = {
  timer: 'reasonTimer',
  emergency: 'reasonEmergency',
  manual: 'reasonManual',
  connection_lost: 'reasonConnectionLost',
  tap_disabled: 'reasonTapDisabled',
  secure_input: 'reasonSecureInput',
  error: 'reasonError',
  process_exit: 'reasonProcessExit'
} as const
type UnlockReasonKey = keyof typeof UNLOCK_REASON_KEYS
export function getUnlockReason(reason: string): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(UNLOCK_REASON_KEYS, reason)) return undefined
  return t(UNLOCK_REASON_KEYS[reason as UnlockReasonKey])
}
export const unlockReasons: Record<string, string> = new Proxy({} as Record<string, string>, {
  get(_target, prop) {
    return typeof prop === 'string' ? getUnlockReason(prop) : undefined
  },
  ownKeys() {
    return Object.keys(UNLOCK_REASON_KEYS)
  },
  getOwnPropertyDescriptor(_target, prop) {
    if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(UNLOCK_REASON_KEYS, prop)) {
      return { configurable: true, enumerable: true, value: getUnlockReason(prop) }
    }
    return undefined
  }
})
