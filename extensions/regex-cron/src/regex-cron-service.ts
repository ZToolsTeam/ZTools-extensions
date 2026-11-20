import type { CronParseResult, RegexPresetItem } from './types.js'
import { t } from './i18n.js'

const REGEX_PRESET_DEFS = [
  {
    id: 'cn-id-card-18',
    titleKey: 'presetIdCardTitle',
    category: 'identity',
    categoryLabelKey: 'catIdentity',
    tagsKey: 'presetIdCardTags',
    pattern:
      '^(?:1[1-5]|2[1-3]|3[1-7]|4[1-6]|5[0-4]|6[1-5]|71|8[1-3])\\d{4}(?:19|20)\\d{2}(?:(?:0[13578]|1[02])(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)(?:0[1-9]|[12]\\d|30)|02(?:0[1-9]|1\\d|2[0-9]))\\d{3}[\\dX]$',
    descKey: 'presetIdCardDesc',
    scopeLiteral: 'JavaScript / Java / Go / Python',
    validExamples: ['11010519900307281X', '440305199510241028'],
    invalidExamples: ['11010520261301281X', '990105199003072812', '11010519900230281X']
  },
  {
    id: 'cn-mobile-phone',
    titleKey: 'presetMobileTitle',
    category: 'identity',
    categoryLabelKey: 'catIdentity',
    tagsKey: 'presetMobileTags',
    pattern: '^1(?:3\\d|4[5-9]|5[0-35-9]|6[2567]|7[0-8]|8\\d|9[0-35-9])\\d{8}$',
    descKey: 'presetMobileDesc',
    scopeKey: 'scopeAllPlatforms',
    validExamples: ['13800138000', '19216801234', '18612345678'],
    invalidExamples: ['12012345678', '1380013800', '23800138000']
  },
  {
    id: 'cn-credit-code',
    titleKey: 'presetCreditTitle',
    category: 'business',
    categoryLabelKey: 'catBusiness',
    tagsKey: 'presetCreditTags',
    pattern: '^[0-9A-HJ-NPQRTUWXY]{2}\\d{6}[0-9A-HJ-NPQRTUWXY]{10}$',
    descKey: 'presetCreditDesc',
    scopeKey: 'scopeGovTax',
    validExamples: ['91350100M000100Y43', '91440300MA5D88991K'],
    invalidExamples: ['91350100I000100Y43', '91350100O000100Z43', '123456789012345']
  },
  {
    id: 'cn-license-plate',
    titleKey: 'presetPlateTitle',
    category: 'traffic',
    categoryLabelKey: 'catTraffic',
    tagsKey: 'presetPlateTags',
    pattern:
      '^[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼使领][A-HJ-NP-Z](?:[A-HJ-NP-Z0-9]{4}[A-HJ-NP-Z0-9挂学警港澳]|[DF][A-HJ-NP-Z0-9]\\d{4}|\\d{5}[DF])$',
    descKey: 'presetPlateDesc',
    scopeKey: 'scopeTrafficEtc',
    validExamples: ['京AD12345', '粤B8899A', '沪AF01234', '浙A12345D'],
    invalidExamples: ['京IO12345', '美A12345', '粤B123']
  },
  {
    id: 'cn-landline',
    titleKey: 'presetLandlineTitle',
    category: 'identity',
    categoryLabelKey: 'catIdentity',
    tagsKey: 'presetLandlineTags',
    pattern: '^(?:0\\d{2,3}-)?[2-9]\\d{6,7}(?:-\\d{1,4})?$',
    descKey: 'presetLandlineDesc',
    scopeKey: 'scopeAllPlatforms',
    validExamples: ['010-88886666', '0755-26001234-801', '88886666'],
    invalidExamples: ['110-12345', '0755-01234567']
  },
  {
    id: 'bank-card-number',
    titleKey: 'presetBankCardTitle',
    category: 'finance',
    categoryLabelKey: 'catFinance',
    tagsKey: 'presetBankCardTags',
    pattern: '^[1-9]\\d{15,18}$',
    descKey: 'presetBankCardDesc',
    scopeKey: 'scopeFinancePay',
    validExamples: ['6222021234567890123', '4367421234567890'],
    invalidExamples: ['0222021234567890', '622202123']
  },
  {
    id: 'ipv4-strict',
    titleKey: 'presetIpv4Title',
    category: 'network',
    categoryLabelKey: 'catNetwork',
    tagsKey: 'presetIpv4Tags',
    pattern: '^(?:(?:25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)$',
    descKey: 'presetIpv4Desc',
    scopeKey: 'scopeOpsFirewall',
    validExamples: ['192.168.1.1', '255.255.255.0', '10.0.0.1'],
    invalidExamples: ['256.100.0.1', '192.168.1.999', '192.168.1']
  },
  {
    id: 'network-port-strict',
    titleKey: 'presetPortTitle',
    category: 'network',
    categoryLabelKey: 'catNetwork',
    tagsKey: 'presetPortTags',
    pattern: '^(?:[1-9]\\d{0,3}|[1-5]\\d{4}|6[0-4]\\d{3}|65[0-4]\\d{2}|655[0-2]\\d|6553[0-5])$',
    descKey: 'presetPortDesc',
    scopeKey: 'scopeGatewayK8s',
    validExamples: ['80', '443', '6379', '65535'],
    invalidExamples: ['0', '65536', '99999']
  },
  {
    id: 'email-rfc5322',
    titleKey: 'presetEmailTitle',
    category: 'format',
    categoryLabelKey: 'catFormat',
    tagsKey: 'presetEmailTags',
    pattern: '^[a-zA-Z0-9_%+-]+(?:\\.[a-zA-Z0-9_%+-]+)*@(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\\.)+[a-zA-Z]{2,}$',
    recommendedFlags: 'i',
    descKey: 'presetEmailDesc',
    scopeKey: 'scopeAllPlatforms',
    validExamples: ['dev+ztools@example.com', 'admin@mail.ztools.cn'],
    invalidExamples: ['plainaddress', '@missing-user.com', 'user@.invalid.com']
  }
] as const

export function getRegexPresets(): RegexPresetItem[] {
  return REGEX_PRESET_DEFS.map(def => ({
    id: def.id,
    title: t(def.titleKey),
    category: def.category,
    categoryLabel: t(def.categoryLabelKey),
    tags: t(def.tagsKey).split(','),
    pattern: def.pattern,
    ...('recommendedFlags' in def ? { recommendedFlags: def.recommendedFlags } : {}),
    description: t(def.descKey),
    scope: 'scopeKey' in def ? t(def.scopeKey) : def.scopeLiteral,
    validExamples: [...def.validExamples],
    invalidExamples: [...def.invalidExamples]
  }))
}

export const REGEX_PRESETS: RegexPresetItem[] = getRegexPresets()

const WEEKDAY_MAP: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6
}

const MONTH_MAP: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12
}

interface ParsedFieldSpec {
  any: boolean
  wildcard: boolean
  values: Set<number>
  raw: string
}

function replaceNamedTokens(token: string, map: Record<string, number>): string {
  return token.toUpperCase().replace(/[A-Z]+/g, (m) => {
    return map[m] !== undefined ? String(map[m]) : m
  })
}

type CronSlotKey = 'slotSec' | 'slotMin' | 'slotHour' | 'slotDom' | 'slotMon' | 'slotDow'

function parseCronField(
  rawToken: string,
  min: number,
  max: number,
  slotKey: CronSlotKey,
  aliasMap?: Record<string, number>,
  allowQuestion = false,
  spring = false
): ParsedFieldSpec {
  const fieldName = t(slotKey)
  const weekday = slotKey === 'slotDow'
  const token = aliasMap ? replaceNamedTokens(rawToken.trim(), aliasMap) : rawToken.trim()
  if (token === '*' || (allowQuestion && token === '?')) {
    const all = new Set<number>()
    for (let v = min; v <= max; v++) all.add(weekday && v === 7 ? 0 : v)
    return { any: true, wildcard: true, values: all, raw: rawToken }
  }

  const values = new Set<number>()
  const parts = token.split(',')

  for (const part of parts) {
    // 先验证完整语法，不能让 Number('')、科学计数法或被 split 丢弃的尾部悄悄通过。
    const match = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/)
    if (!match) throw new Error(t('cronFieldSyntaxErr', { field: fieldName, part }))
    const range = match[1]!
    const step = match[2] === undefined ? 1 : Number(match[2])
    if (!Number.isSafeInteger(step) || step <= 0) throw new Error(t('cronFieldStepErr', { field: fieldName, part }))
    const [first, last] = range.split('-')
    if (!spring && match[2] !== undefined && range !== '*' && last === undefined) throw new Error(t('cronFieldLinuxStepErr', { field: fieldName }))
    let start = range === '*' ? min : Number(first)
    let end = range === '*' ? max : last !== undefined ? Number(last) : match[2] !== undefined ? max : start
    if (weekday && last !== undefined) {
      if (spring && start === 7) start = 0
      if (!spring && start > end && end === 0) end = 7
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < (weekday ? 0 : min) || end > max || start > end) {
      throw new Error(t('cronFieldRangeErr', { field: fieldName, part, min, max }))
    }
    for (let v = start; v <= end; v += step) values.add(weekday && v === 7 ? 0 : v)
  }

  if (values.size === 0) {
    throw new Error(t('cronFieldEmptyErr', { field: fieldName }))
  }
  return { any: false, wildcard: token.startsWith('*'), values, raw: rawToken }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function formatDateTime(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

function formatRelativeDiff(targetMs: number, baseMs: number): string {
  const diffSec = Math.max(1, Math.round((targetMs - baseMs) / 1000))
  if (diffSec < 60) return t('relSec', { n: diffSec })
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return t('relMin', { n: diffMin })
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) {
    const remMin = diffMin % 60
    return remMin > 0 ? t('relHourMin', { h: diffHours, m: remMin }) : t('relHour', { h: diffHours })
  }
  const diffDays = Math.floor(diffHours / 24)
  return t('relDay', { n: diffDays })
}

function explainSlotMeaning(name: string, raw: string): string {
  if (raw === '*' || raw === '?') return t('slotAny', { name })
  if (raw.startsWith('*/')) return t('slotStep', { step: raw.slice(2), name })
  return t('slotFixed', { raw })
}

type TokenKind = 'any' | 'step' | 'number' | 'other'
function tokenKind(token: string): TokenKind {
  if (token === '*' || token === '?') return 'any'
  if (/^\*\/\d+$/.test(token)) return 'step'
  if (/^\d+$/.test(token)) return 'number'
  return 'other'
}

/**
 * 把时、分、秒字段翻译成自然语句：常见的 *、*\/N、固定值合成“每 15 分钟”“每小时第 30 分”“09:00”等说法；
 * 五位表达式没有秒字段，不提秒。列表、范围等复杂写法原样保留，不能把 0,30 抹成 00 分。
 */
function describeCronTime(secToken: string, minToken: string, hourToken: string, hasSeconds: boolean): { clock: boolean; text: string } {
  const sec = tokenKind(secToken), min = tokenKind(minToken), hour = tokenKind(hourToken)
  const step = (token: string) => Number(token.slice(2))
  if (hour === 'number' && min === 'number' && (!hasSeconds || sec === 'number')) {
    const hm = `${pad2(Number(hourToken))}:${pad2(Number(minToken))}`
    return { clock: true, text: hasSeconds ? `${hm}:${pad2(Number(secToken))}` : hm }
  }
  const secondText = !hasSeconds || secToken === '0' ? '' : sec === 'any' ? t('timeEverySec') : sec === 'step' ? t('timeStepSec', { step: step(secToken) }) : t('timeAtSec', { token: secToken })
  const recurringSecond = sec === 'any' || sec === 'step'
  if (hasSeconds && recurringSecond && min === 'any' && hour === 'any') return { clock: false, text: secondText }
  const minuteText = min === 'any' ? t('timeEveryMin') : min === 'step' ? t('timeStepMin', { step: step(minToken) }) : t('timeAtMin', { token: minToken })
  const hourText = hour === 'step' ? t('timeStepHour', { step: step(hourToken) }) : hour === 'any' ? '' : t('timeAtHour', { token: hourToken })
  let text: string
  if (min === 'any' || min === 'step') {
    text = hour === 'any' ? minuteText : hour === 'step' ? t('timeHourStepMin', { hour: hourText, min: minuteText }) : t('timeHourFixedMin', { hour: hourText, min: minuteText })
  } else {
    text = hour === 'any' ? t('timeEveryHourAtMin', { min: minuteText }) : t('timeHourAtMin', { hour: hourText, min: minuteText })
  }
  if (secondText) text = t('timeWithSec', { base: text, sec: secondText })
  return { clock: false, text }
}

function buildChineseCronSummary(
  secToken: string, minToken: string, hourToken: string,
  domToken: string, monToken: string, dowToken: string, daysUseAnd: boolean, hasSeconds: boolean
): string {
  const unrestricted = (value: string) => value === '*' || value === '?'
  const days: string[] = []
  if (!unrestricted(domToken)) days.push(t('calDom', { token: domToken }))
  if (!unrestricted(dowToken)) days.push(t('calDow', { token: dowToken }))
  const everyDay = t('calEveryDay')
  const calendar = [
    ...(!unrestricted(monToken) ? [t('calMon', { token: monToken })] : []),
    days.length ? t('calDaysWrap', { days: days.join(daysUseAnd ? t('calAnd') : t('calOr')) }) : everyDay
  ].join(' ')
  const time = describeCronTime(secToken, minToken, hourToken, hasSeconds)
  if (time.clock) return t('cronSummaryClock', { calendar, time: time.text })
  return calendar === everyDay ? t('cronSummaryEveryDay', { time: time.text }) : t('cronSummaryCalendarTime', { calendar, time: time.text })
}

/**
 * 解析 5 位（Linux Crontab）或 6 位（Spring 基础语法）Cron 表达式，输出自然语言语义与未来 5 次触发时间
 */
export function parseAndExplainCron(
  rawExpression: string,
  baseDate: Date = new Date(),
  count = 5
): CronParseResult {
  const trimmed = String(rawExpression ?? '').trim()
  if (!trimmed) {
    return {
      isValid: false,
      expression: '',
      chineseSummary: t('cronEmptySummary'),
      errorMessage: t('cronEmptyError'),
      slots: [],
      nextRuns: []
    }
  }

  const tokens = trimmed.split(/\s+/)
  if (tokens.length !== 5 && tokens.length !== 6) {
    return {
      isValid: false,
      expression: trimmed,
      chineseSummary: t('cronInvalidCountSummary'),
      errorMessage: t('cronInvalidCountError', { count: tokens.length }),
      slots: [],
      nextRuns: []
    }
  }

  const isSixField = tokens.length === 6
  const secToken = isSixField ? tokens[0]! : '0'
  const minToken = isSixField ? tokens[1]! : tokens[0]!
  const hourToken = isSixField ? tokens[2]! : tokens[1]!
  const domToken = isSixField ? tokens[3]! : tokens[2]!
  const monToken = isSixField ? tokens[4]! : tokens[3]!
  const dowToken = isSixField ? tokens[5]! : tokens[4]!

  try {
    if (trimmed.length > 1000) throw new Error(t('cronTooLongError'))
    if (!Number.isFinite(baseDate.getTime())) throw new Error(t('cronInvalidBaseDateError'))
    if (!Number.isInteger(count) || count < 1 || count > 50) throw new Error(t('cronInvalidCountRangeError'))
    const secSpec = parseCronField(secToken, 0, 59, 'slotSec', undefined, false, isSixField)
    const minSpec = parseCronField(minToken, 0, 59, 'slotMin', undefined, false, isSixField)
    const hourSpec = parseCronField(hourToken, 0, 23, 'slotHour', undefined, false, isSixField)
    const domSpec = parseCronField(domToken, 1, 31, 'slotDom', undefined, isSixField, isSixField)
    const monSpec = parseCronField(monToken, 1, 12, 'slotMon', MONTH_MAP, false, isSixField)
    const dowSpec = parseCronField(dowToken, isSixField ? 1 : 0, 7, 'slotDow', isSixField ? { ...WEEKDAY_MAP, SUN: 7 } : WEEKDAY_MAP, isSixField, isSixField)
    // Linux 的两个受限日期字段用 OR；含通配符时用 AND。Spring 六位始终逐字段匹配。
    const daysUseAnd = isSixField || domSpec.wildcard || dowSpec.wildcard

    // 校验永远不可能存在的静态非法月日组合（如 2月30日/2月31日/4月31日）
    if (daysUseAnd && !monSpec.any && !domSpec.any) {
      const maxDaysPerMonth: Record<number, number> = {
        1: 31,
        2: 29,
        3: 31,
        4: 30,
        5: 31,
        6: 30,
        7: 31,
        8: 31,
        9: 30,
        10: 31,
        11: 30,
        12: 31
      }
      let hasPossibleDate = false
      for (const m of monSpec.values) {
        const limit = maxDaysPerMonth[m] ?? 31
        for (const d of domSpec.values) {
          if (d <= limit) {
            hasPossibleDate = true
            break
          }
        }
      }
      if (!hasPossibleDate) {
        return {
          isValid: false,
          expression: trimmed,
          chineseSummary: t('cronImpossibleDateSummary'),
          errorMessage: t('cronImpossibleDateError', { mon: monToken, dom: domToken }),
          slots: [],
          nextRuns: []
        }
      }
    }

    const nextRuns: CronParseResult['nextRuns'] = []
    const baseMs = baseDate.getTime()
    const cursor = new Date(Math.floor(baseMs / 1000) * 1000 + 1000)

    let iterations = 0
    const maxIterations = 200_000

    while (nextRuns.length < count && iterations < maxIterations) {
      iterations++
      if (!monSpec.values.has(cursor.getMonth() + 1)) {
        cursor.setMonth(cursor.getMonth() + 1, 1)
        cursor.setHours(0, 0, 0, 0)
        continue
      }

      const domMatch = domSpec.values.has(cursor.getDate())
      const dowMatch = dowSpec.values.has(cursor.getDay())
      const dayMatches = daysUseAnd ? domMatch && dowMatch : domMatch || dowMatch

      if (!dayMatches) {
        cursor.setDate(cursor.getDate() + 1)
        cursor.setHours(0, 0, 0, 0)
        continue
      }

      if (!hourSpec.values.has(cursor.getHours())) {
        cursor.setTime(cursor.getTime() + (3600 - cursor.getMinutes() * 60 - cursor.getSeconds()) * 1000)
        continue
      }

      if (!minSpec.values.has(cursor.getMinutes())) {
        cursor.setTime(cursor.getTime() + (60 - cursor.getSeconds()) * 1000)
        continue
      }

      if (!secSpec.values.has(cursor.getSeconds())) {
        cursor.setTime(cursor.getTime() + 1000)
        continue
      }

      const ts = cursor.getTime()
      nextRuns.push({
        formattedTime: formatDateTime(cursor),
        utcOffset: `UTC${cursor.getTimezoneOffset() <= 0 ? '+' : '-'}${pad2(Math.floor(Math.abs(cursor.getTimezoneOffset()) / 60))}:${pad2(Math.abs(cursor.getTimezoneOffset()) % 60)}`,
        relativeTime: formatRelativeDiff(ts, baseMs),
        timestamp: ts
      })

      // 绝对时间前进，不用本地 setSeconds；夏令时回拨的重复小时也能逐次命中。
      cursor.setTime(cursor.getTime() + 1000)
    }

    if (nextRuns.length < count) {
      return {
        isValid: false,
        expression: trimmed,
        chineseSummary: t('cronNoRunsSummary'),
        errorMessage: t('cronNoRunsError', { count }),
        slots: [],
        nextRuns: []
      }
    }

    const secLabel = t('slotSec')
    const minLabel = t('slotMin')
    const hourLabel = t('slotHour')
    const domLabel = t('slotDom')
    const monLabel = t('slotMon')
    const dowLabel = t('slotDow')
    const slots = [
      ...(isSixField
        ? [{ name: secLabel, value: secToken, meaning: explainSlotMeaning(secLabel, secToken) }]
        : []),
      { name: minLabel, value: minToken, meaning: explainSlotMeaning(minLabel, minToken) },
      { name: hourLabel, value: hourToken, meaning: explainSlotMeaning(hourLabel, hourToken) },
      { name: domLabel, value: domToken, meaning: explainSlotMeaning(domLabel, domToken) },
      { name: monLabel, value: monToken, meaning: explainSlotMeaning(monLabel, monToken) },
      { name: dowLabel, value: dowToken, meaning: explainSlotMeaning(dowLabel, dowToken) }
    ]

    return {
      isValid: true,
      expression: trimmed,
      chineseSummary: buildChineseCronSummary(secToken, minToken, hourToken, domToken, monToken, dowToken, daysUseAnd, isSixField),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      calculatedAt: formatDateTime(baseDate),
      dialect: isSixField ? t('cronDialectSpring') : t('cronDialectLinux'),
      slots,
      nextRuns
    }
  } catch (err) {
    return {
      isValid: false,
      expression: trimmed,
      chineseSummary: t('cronSyntaxErrorSummary'),
      errorMessage: err instanceof Error ? err.message : t('cronUnknownSyntaxError'),
      slots: [],
      nextRuns: []
    }
  }
}
