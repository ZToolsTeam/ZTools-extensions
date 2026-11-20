import type {
  CountdownCategory,
  CountdownItem,
  EnrichedCountdownItem
} from './types.js'
import { t } from './i18n.js'

export const FOCUS_DURATION_MS = 25 * 60 * 1000
export const SHORT_BREAK_DURATION_MS = 5 * 60 * 1000
export const LONG_BREAK_DURATION_MS = 15 * 60 * 1000

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
 * 计算倒数天数，支持按月循环日程（如每月 31 号发薪日在 2 月自动对齐至 28/29 号，绝不产生 NaN 或越界）
 */
export function calculateDaysLeft(
  targetDate: string,
  isRecurring = false,
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

  let finalY = origY
  let finalM = origM
  let finalD = origD

  if (isRecurring) {
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
    const calc = calculateDaysLeft(item.targetDate, item.isRecurring, referenceDate)
    return {
      ...item,
      daysLeft: calc.days,
      daysLeftText: calc.text,
      targetDateFormatted: item.isRecurring
        ? t('recurringDateFormatted', { day: item.targetDate.slice(8), resolvedDate: calc.resolvedDate })
        : calc.resolvedDate
    }
  })

  return enriched.sort((a, b) => {
    if (a.daysLeft >= 0 && b.daysLeft < 0) return -1
    if (a.daysLeft < 0 && b.daysLeft >= 0) return 1
    return a.daysLeft - b.daysLeft
  })
}
