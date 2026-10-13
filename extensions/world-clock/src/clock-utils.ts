/**
 * 世界时钟插件 - 纯工具函数
 * 从 world-clock.vue 中抽取的无副作用逻辑，便于单元测试
 */

/** 时区 → emoji 映射（按大洲） */
export function cityEmoji(tz: string): string {
  if (tz.startsWith('Asia')) return '🌏'
  if (tz.startsWith('Europe')) return '🌍'
  if (tz.startsWith('America')) return '🌎'
  if (tz.startsWith('Africa')) return '🌍'
  if (tz.startsWith('Australia') || tz.startsWith('Pacific')) return '🌏'
  if (tz.startsWith('Indian') || tz.startsWith('Atlantic')) return '🌍'
  return '🌐'
}

/** 格式化时间 HH:MM:SS */
export function formatTime(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(date)
}

/** 格式化日期 M月D日 周X */
export function formatDate(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: tz, month: 'numeric', day: 'numeric', weekday: 'short'
  }).format(date)
}

/** 获取时区偏移标签（如 GMT+8） */
export function getTzLabel(date: Date, tz: string): string {
  try {
    const fmt = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' })
    const parts = fmt.formatToParts(date)
    const offset = parts.find(p => p.type === 'timeZoneName')?.value ?? ''
    if (offset) return offset
  } catch { /* fallback */ }
  try {
    const getHM = (d: Date, zone: string) => {
      const p = new Intl.DateTimeFormat('en', {
        timeZone: zone, hour: 'numeric', minute: 'numeric', hour12: false
      }).formatToParts(d)
      return parseInt(p.find(x => x.type === 'hour')?.value ?? '0') * 60
           + parseInt(p.find(x => x.type === 'minute')?.value ?? '0')
    }
    let diff = getHM(date, tz) - getHM(date, 'UTC')
    if (diff > 720) diff -= 1440
    if (diff < -720) diff += 1440
    const sign = diff >= 0 ? '+' : '-'
    const h = Math.floor(Math.abs(diff) / 60)
    const m = Math.abs(diff) % 60
    return `GMT${sign}${h}${m ? ':' + String(m).padStart(2, '0') : ''}`
  } catch { return '' }
}

/** 获取目标时区与本地时区的日期差（-1/0/+1） */
export function getDayDiff(date: Date, tz: string, localTz: string): number {
  const getParts = (zone: string) => {
    const p = new Intl.DateTimeFormat('en', {
      timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric'
    }).formatToParts(date)
    return {
      y: parseInt(p.find(x => x.type === 'year')?.value || '0'),
      m: parseInt(p.find(x => x.type === 'month')?.value || '0'),
      d: parseInt(p.find(x => x.type === 'day')?.value || '0'),
    }
  }
  const local = getParts(localTz)
  const target = getParts(tz)
  const localDay = Date.UTC(local.y, local.m - 1, local.d) / 86400000
  const targetDay = Date.UTC(target.y, target.m - 1, target.d) / 86400000
  return targetDay - localDay
}

/** 获取目标时区当前是一天中的第几分钟（0-1439） */
export function getDayMinutes(date: Date, tz: string): number {
  const p = new Intl.DateTimeFormat('en', {
    timeZone: tz, hour: 'numeric', minute: 'numeric', hour12: false
  }).formatToParts(date)
  const h = parseInt(p.find(x => x.type === 'hour')?.value || '0')
  const m = parseInt(p.find(x => x.type === 'minute')?.value || '0')
  return h * 60 + m
}

/** 计算与换算基准时区的小时差标签 */
export function getDiffLabel(date: Date, tz: string, sourceTz: string): string {
  const toWallClockMinutes = (zone: string) => {
    const parts = getZonedDateTimeParts(date, zone)
    return Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute
    ) / 60000
  }
  const diff = toWallClockMinutes(tz) - toWallClockMinutes(sourceTz)
  if (diff === 0) return '与基准相同'
  const h = Math.floor(Math.abs(diff) / 60)
  const m = Math.abs(diff) % 60
  const label = h > 0 ? `${h}小时${m ? m + '分' : ''}` : `${m}分钟`
  return diff > 0 ? `早${label}` : `晚${label}`
}

/** 判断是否是白天（6:00-18:00） */
export function isDaytime(date: Date, tz: string): boolean {
  const mins = getDayMinutes(date, tz)
  return mins >= 360 && mins < 1080
}

interface ZonedDateTimeParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function getZonedDateTimeParts(date: Date, tz: string): ZonedDateTimeParts {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find(part => part.type === type)?.value ?? Number.NaN)

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second')
  }
}

/** 将绝对时间格式化为 datetime-local 可使用的目标时区当地时间。 */
export function formatDateTimeInput(date: Date, tz: string): string {
  const parts = getZonedDateTimeParts(date, tz)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`
}

/**
 * 把不带偏移量的当地日期时间按指定 IANA 时区解释为绝对时间。
 * 夏令时回拨产生两个候选时取较早的一次；被夏令时跳过的无效时间返回 null。
 */
export function parseZonedDateTime(value: string, tz: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) return null

  const expected: ZonedDateTimeParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0)
  }
  const wallClockUtc = Date.UTC(
    expected.year,
    expected.month - 1,
    expected.day,
    expected.hour,
    expected.minute,
    expected.second
  )
  const validated = new Date(wallClockUtc)
  if (
    validated.getUTCFullYear() !== expected.year ||
    validated.getUTCMonth() + 1 !== expected.month ||
    validated.getUTCDate() !== expected.day ||
    validated.getUTCHours() !== expected.hour ||
    validated.getUTCMinutes() !== expected.minute ||
    validated.getUTCSeconds() !== expected.second
  ) return null

  try {
    const offsets = new Set<number>()
    for (const delta of [-86400000, 0, 86400000]) {
      const sample = new Date(wallClockUtc + delta)
      const parts = getZonedDateTimeParts(sample, tz)
      offsets.add(Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second
      ) - sample.getTime())
    }

    const candidates = [...offsets]
      .map(offset => new Date(wallClockUtc - offset))
      .filter(candidate => {
        const parts = getZonedDateTimeParts(candidate, tz)
        return Object.keys(expected).every(key =>
          parts[key as keyof ZonedDateTimeParts] === expected[key as keyof ZonedDateTimeParts]
        )
      })
      .sort((a, b) => a.getTime() - b.getTime())

    return candidates[0] ?? null
  } catch {
    return null
  }
}
