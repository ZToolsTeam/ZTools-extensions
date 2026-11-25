import type {
  CountdownCategory,
  CountdownItem,
  CountdownRepeat,
  EnrichedCountdownItem
} from './types.js'
import { t } from './i18n.js'

export const FOCUS_DURATION_MS = 25 * 60 * 1000
export const SHORT_BREAK_DURATION_MS = 5 * 60 * 1000
export const LONG_BREAK_DURATION_MS = 15 * 60 * 1000
export const CUSTOM_FOCUS_MIN_MINUTES = 5
export const CUSTOM_FOCUS_MAX_MINUTES = 180

export function parseCustomFocusMinutes(query: string): number | null {
  const trimmed = (query || '').trim()
  if (!/^\d+$/.test(trimmed)) return null
  const minutes = Number(trimmed)
  if (!Number.isSafeInteger(minutes) || minutes < CUSTOM_FOCUS_MIN_MINUTES || minutes > CUSTOM_FOCUS_MAX_MINUTES) {
    return null
  }
  return minutes
}

export function resolveCountdownRepeat(item: { isRecurring?: boolean; repeat?: CountdownRepeat }): CountdownRepeat {
  if (item.repeat === 'none' || item.repeat === 'monthly' || item.repeat === 'yearly') {
    return item.repeat
  }
  return item.isRecurring ? 'monthly' : 'none'
}

export function formatRemainingMmSs(remainingMs: number): string {
  const safeSec = Math.max(0, Math.ceil(remainingMs / 1000))
  const mm = String(Math.floor(safeSec / 60)).padStart(2, '0')
  const ss = String(safeSec % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

function getDaysInYearMonth(year: number, month1To12: number): number {
  return new Date(Date.UTC(year, month1To12, 0)).getUTCDate()
}

export function validateCountdownInput(input: {
  title: string
  targetDate: string
  category?: CountdownCategory
}): {
  valid: boolean
  error?: string
} {
  if (!input || typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 200) {
    return { valid: false, error: t('errTitleRequired') }
  }
  if (input.category !== undefined && !['work', 'finance', 'life'].includes(input.category)) return { valid: false, error: t('errInvalidCategory') }
  const dateStr = typeof input.targetDate === 'string' ? input.targetDate.trim() : ''
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) {
    return { valid: false, error: t('errDateFormat') }
  }
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (y < 1900 || y > 9999 || m < 1 || m > 12) {
    return { valid: false, error: t('errMonthRange') }
  }
  const maxDay = getDaysInYearMonth(y, m)
  if (d < 1 || d > maxDay) {
    return { valid: false, error: t('errInvalidDay', { year: y, month: m, day: d }) }
  }
  return { valid: true }
}

/**
 * 计算倒数天数，支持按月循环（每月 31 号在 2 月自动对齐至 28/29 号）与按年循环（闰日 02-29 在平年对齐至 02-28，闰年恢复 02-29）
 */
export function calculateDaysLeft(
  targetDate: string,
  recurrence: boolean | CountdownRepeat = false,
  referenceDate: Date | string = new Date()
): {
  days: number
  text: string
  resolvedDate: string
} {
  const check = validateCountdownInput({ title: 'check', targetDate })
  if (!check.valid) {
    throw new Error(check.error)
  }

  const refObj = typeof referenceDate === 'string' ? new Date(`${referenceDate}T00:00:00Z`) : referenceDate
  if (Number.isNaN(refObj.getTime())) {
    throw new Error(t('errInvalidRefDate'))
  }

  const stringDate = typeof referenceDate === 'string'
  const refYear = stringDate ? refObj.getUTCFullYear() : refObj.getFullYear()
  const refMonth = (stringDate ? refObj.getUTCMonth() : refObj.getMonth()) + 1
  const refDay = stringDate ? refObj.getUTCDate() : refObj.getDate()
  const refUtcMs = Date.UTC(refYear, refMonth - 1, refDay)

  const [origY, origM, origD] = targetDate.split('-').map(Number) as [number, number, number]
  const repeatMode: CountdownRepeat =
    typeof recurrence === 'boolean' ? (recurrence ? 'monthly' : 'none') : recurrence

  let finalY = origY
  let finalM = origM
  let finalD = origD

  if (repeatMode === 'monthly') {
    // 优先计算当月对应的循环日（若当月只有 28/29/30 天，自动钳位至当月最后一天）
    const maxDayThisMonth = getDaysInYearMonth(refYear, refMonth)
    const clampedThisMonthDay = Math.min(origD, maxDayThisMonth)
    const candidateThisMonthMs = Date.UTC(refYear, refMonth - 1, clampedThisMonthDay)

    if (candidateThisMonthMs >= refUtcMs) {
      finalY = refYear
      finalM = refMonth
      finalD = clampedThisMonthDay
    } else {
      const nextY = refMonth === 12 ? refYear + 1 : refYear
      const nextM = refMonth === 12 ? 1 : refMonth + 1
      const maxDayNextMonth = getDaysInYearMonth(nextY, nextM)
      finalY = nextY
      finalM = nextM
      finalD = Math.min(origD, maxDayNextMonth)
    }
  } else if (repeatMode === 'yearly') {
    // 优先计算今年的周年日（闰日 02-29 在平年钳位至 02-28）；已过则顺延至下一年（闰年自动恢复 02-29）
    const maxDayThisYear = getDaysInYearMonth(refYear, origM)
    const clampedThisYearDay = Math.min(origD, maxDayThisYear)
    const candidateThisYearMs = Date.UTC(refYear, origM - 1, clampedThisYearDay)

    if (candidateThisYearMs >= refUtcMs) {
      finalY = refYear
      finalM = origM
      finalD = clampedThisYearDay
    } else {
      const nextY = refYear + 1
      const maxDayNextYear = getDaysInYearMonth(nextY, origM)
      finalY = nextY
      finalM = origM
      finalD = Math.min(origD, maxDayNextYear)
    }
  }

  const targetUtcMs = Date.UTC(finalY, finalM - 1, finalD)
  const diffDays = Math.round((targetUtcMs - refUtcMs) / (24 * 3600 * 1000))
  const resolvedDate = `${finalY}-${String(finalM).padStart(2, '0')}-${String(finalD).padStart(2, '0')}`

  if (diffDays === 0) {
    return { days: 0, text: t('daysLeftToday'), resolvedDate }
  }
  if (diffDays > 0) {
    return { days: diffDays, text: t('daysLeftFuture', { days: diffDays }), resolvedDate }
  }
  return { days: diffDays, text: t('daysLeftPast', { days: Math.abs(diffDays) }), resolvedDate }
}

export function enrichAndSortCountdowns(
  items: CountdownItem[],
  referenceDate: Date | string = new Date()
): EnrichedCountdownItem[] {
  const enriched = items.map((item) => {
    const repeat = resolveCountdownRepeat(item)
    const calc = calculateDaysLeft(item.targetDate, repeat, referenceDate)
    const targetDateFormatted =
      repeat === 'yearly'
        ? t('yearlyDateFormatted', {
            month: item.targetDate.slice(5, 7),
            day: item.targetDate.slice(8),
            resolvedDate: calc.resolvedDate
          })
        : repeat === 'monthly'
          ? t('recurringDateFormatted', { day: item.targetDate.slice(8), resolvedDate: calc.resolvedDate })
          : calc.resolvedDate
    return {
      ...item,
      repeat,
      daysLeft: calc.days,
      daysLeftText: calc.text,
      targetDateFormatted
    }
  })

  return enriched.sort((a, b) => {
    if (a.daysLeft >= 0 && b.daysLeft < 0) return -1
    if (a.daysLeft < 0 && b.daysLeft >= 0) return 1
    return a.daysLeft - b.daysLeft
  })
}
