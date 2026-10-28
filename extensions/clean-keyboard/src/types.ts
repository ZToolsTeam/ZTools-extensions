export interface KeyboardLockState {
  success: true; operationId: string; status: 'locked' | 'unlocked'
  remainingSeconds: number; blockedEvents: number; lockPointer: boolean; reason: string
}
export interface KeyboardLockRequest {
  action: 'start' | 'status' | 'unlock'; operationId: string; durationSeconds?: number; lockPointer?: boolean
}
