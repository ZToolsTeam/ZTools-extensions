export type PomodoroPhase = 'idle' | 'focus' | 'short_break' | 'long_break'
export type CountdownCategory = 'work' | 'finance' | 'life'
export type CountdownRepeat = 'none' | 'monthly' | 'yearly'

export interface PomodoroState {
  phase: PomodoroPhase
  startTime: number
  durationMs: number
  pausedRemainingMs?: number
  completedCycles: number
}

export interface CountdownItem {
  id: string
  title: string
  targetDate: string
  category: CountdownCategory
  isRecurring: boolean
  repeat?: CountdownRepeat
  createdAt: number
}

export interface EnrichedCountdownItem extends CountdownItem {
  daysLeft: number
  daysLeftText: string
  targetDateFormatted: string
}
