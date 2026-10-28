import type { CronParseResult, RegexPresetItem } from './types.js'

export const REGEX_PRESETS: RegexPresetItem[] = [
  {
    id: 'cn-id-card-18',
    title: '18位居民身份证号（常见格式）',
    category: 'identity',
    categoryLabel: '身份与通信',
    tags: ['身份证', '实名认证', 'GB11643'],
    pattern:
      '^(?:1[1-5]|2[1-3]|3[1-7]|4[1-6]|5[0-4]|6[1-5]|71|8[1-3])\\d{4}(?:19|20)\\d{2}(?:(?:0[13578]|1[02])(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)(?:0[1-9]|[12]\\d|30)|02(?:0[1-9]|1\\d|2[0-9]))\\d{3}[\\dX]$',
    description:
      '匹配常见省级代码、1900~2099年份及日期外形，不核实区县代码、闰年或末位校验码，不能代替身份核验。',
    scope: 'JavaScript / Java / Go / Python',
    validExamples: ['11010519900307281X', '440305199510241028'],
    invalidExamples: ['11010520261301281X', '990105199003072812', '11010519900230281X']
  },
  {
    id: 'cn-mobile-phone',
    title: '中国大陆11位手机号码（三大运营商及广电/虚商）',
    category: 'identity',
    categoryLabel: '身份与通信',
    tags: ['手机号', '短信验证', '移动联通电信'],
    pattern: '^1(?:3\\d|4[5-9]|5[0-35-9]|6[2567]|7[0-8]|8\\d|9[0-35-9])\\d{8}$',
    description:
      '精准覆盖中国移动、中国联通、中国电信、中国广电（192）及主流虚拟运营商11位号段，拦截10/11/12等无效号段。',
    scope: '全平台通用',
    validExamples: ['13800138000', '19216801234', '18612345678'],
    invalidExamples: ['12012345678', '1380013800', '23800138000']
  },
  {
    id: 'cn-credit-code',
    title: '18位统一社会信用代码（GB 32100-2015 排除I/O/Z/S/V）',
    category: 'business',
    categoryLabel: '政务与企业',
    tags: ['税号', '营业执照', '信用代码', '企业认证'],
    pattern: '^[0-9A-HJ-NPQRTUWXY]{2}\\d{6}[0-9A-HJ-NPQRTUWXY]{10}$',
    description:
      '严格遵循国家标准 GB 32100-2015，由2位登记管理部门与机构类别码 + 6位行政区划数字码 + 9位组织机构码 + 1位校验码组成，剔除易混淆字母 I、O、Z、S、V。',
    scope: '政务与财税开票系统',
    validExamples: ['91350100M000100Y43', '91440300MA5D88991K'],
    invalidExamples: ['91350100I000100Y43', '91350100O000100Z43', '123456789012345']
  },
  {
    id: 'cn-license-plate',
    title: '中国机动车号牌（7位传统蓝黄牌 + 8位绿色新能源）',
    category: 'traffic',
    categoryLabel: '交通与车务',
    tags: ['车牌号', '新能源车牌', '智慧停车'],
    pattern:
      '^[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼使领][A-HJ-NP-Z](?:[A-HJ-NP-Z0-9]{4}[A-HJ-NP-Z0-9挂学警港澳]|[DF][A-HJ-NP-Z0-9]\\d{4}|\\d{5}[DF])$',
    description:
      '同时兼容7位传统燃油车牌（含挂、学、警、港、澳特殊字样）与8位新能源汽车专用号牌（小型车D/F开头，大型车D/F结尾，不含字母I和O）。',
    scope: '车联网与ETC门禁系统',
    validExamples: ['京AD12345', '粤B8899A', '沪AF01234', '浙A12345D'],
    invalidExamples: ['京IO12345', '美A12345', '粤B123']
  },
  {
    id: 'cn-landline',
    title: '中国固定电话号码（含区号与分机号）',
    category: 'identity',
    categoryLabel: '身份与通信',
    tags: ['座机', '固话', '区号'],
    pattern: '^(?:0\\d{2,3}-)?[2-9]\\d{6,7}(?:-\\d{1,4})?$',
    description: '支持3~4位0开头区号（如010-、0755-）、7~8位本地座机号码以及1~4位可选分机号。',
    scope: '全平台通用',
    validExamples: ['010-88886666', '0755-26001234-801', '88886666'],
    invalidExamples: ['110-12345', '0755-01234567']
  },
  {
    id: 'bank-card-number',
    title: '银行卡号（16~19位借记卡/信用卡）',
    category: 'business',
    categoryLabel: '政务与企业',
    tags: ['银行卡', '银联', '结算账户'],
    pattern: '^[1-9]\\d{15,18}$',
    description: '匹配16至19位非0开头的银行卡卡号，工程实践中建议配合 Luhn 模10校验位算法二次核验。',
    scope: '金融与支付收银台',
    validExamples: ['6222021234567890123', '4367421234567890'],
    invalidExamples: ['0222021234567890', '622202123']
  },
  {
    id: 'ipv4-strict',
    title: 'IPv4 地址（0~255 严格数值边界校验）',
    category: 'network',
    categoryLabel: '网络与协议',
    tags: ['IPv4', 'IP地址', '网段'],
    pattern: '^(?:(?:25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)$',
    description: '精确限制每一段八位组在 0~255 之间，防止 999.999.999.999 等越界伪IP混入。',
    scope: '运维与安全防火墙',
    validExamples: ['192.168.1.1', '255.255.255.0', '10.0.0.1'],
    invalidExamples: ['256.100.0.1', '192.168.1.999', '192.168.1']
  },
  {
    id: 'network-port-strict',
    title: '网络端口号（1~65535 严格范围校验）',
    category: 'network',
    categoryLabel: '网络与协议',
    tags: ['端口号', 'TCP', 'UDP'],
    pattern: '^(?:[1-9]\\d{0,3}|[1-5]\\d{4}|6[0-4]\\d{3}|65[0-4]\\d{2}|655[0-2]\\d|6553[0-5])$',
    description: '严格校验 TCP/UDP 端口号落在 1~65535 合法整数区间，拒绝 0 和 65536 以上越界值。',
    scope: '网关与容器编排配置',
    validExamples: ['80', '443', '6379', '65535'],
    invalidExamples: ['0', '65536', '99999']
  },
  {
    id: 'email-rfc5322',
    title: '电子邮箱地址（常见 ASCII 格式）',
    category: 'format',
    categoryLabel: '开发常用格式',
    tags: ['邮箱', 'Email', '账号'],
    pattern: '^[a-zA-Z0-9_%+-]+(?:\\.[a-zA-Z0-9_%+-]+)*@(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\\.)+[a-zA-Z]{2,}$',
    recommendedFlags: 'i',
    description: '匹配常见 ASCII 邮箱，支持加号别名与多级域名，不支持引号本地部分或国际化邮箱，不验证地址是否可投递。',
    scope: '全平台通用',
    validExamples: ['dev+ztools@example.com', 'admin@mail.ztools.cn'],
    invalidExamples: ['plainaddress', '@missing-user.com', 'user@.invalid.com']
  }
]

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

function parseCronField(
  rawToken: string,
  min: number,
  max: number,
  fieldName: string,
  aliasMap?: Record<string, number>,
  allowQuestion = false,
  spring = false
): ParsedFieldSpec {
  const weekday = fieldName === '周 (Day of Week)'
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
    if (!match) throw new Error(`字段 [${fieldName}] 语法 "${part}" 不支持；仅支持整数、*、列表、范围与步长，六位表达式的日/周可单独使用 ?`)
    const range = match[1]!
    const step = match[2] === undefined ? 1 : Number(match[2])
    if (!Number.isSafeInteger(step) || step <= 0) throw new Error(`字段 [${fieldName}] 步长值 "${part}" 不合法`)
    const [first, last] = range.split('-')
    if (!spring && match[2] !== undefined && range !== '*' && last === undefined) throw new Error(`字段 [${fieldName}] 五位 Linux 语法的步长须跟在 * 或范围后`)
    let start = range === '*' ? min : Number(first)
    let end = range === '*' ? max : last !== undefined ? Number(last) : match[2] !== undefined ? max : start
    if (weekday && last !== undefined) {
      if (spring && start === 7) start = 0
      if (!spring && start > end && end === 0) end = 7
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < (weekday ? 0 : min) || end > max || start > end) {
      throw new Error(`字段 [${fieldName}] 取值 "${part}" 超出有效范围 (${min}~${max})`)
    }
    for (let v = start; v <= end; v += step) values.add(weekday && v === 7 ? 0 : v)
  }

  if (values.size === 0) {
    throw new Error(`字段 [${fieldName}] 未能解析出有效时间点`)
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
  if (diffSec < 60) return `${diffSec} 秒后`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} 分钟后`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) {
    const remMin = diffMin % 60
    return remMin > 0 ? `${diffHours} 小时 ${remMin} 分钟后` : `${diffHours} 小时后`
  }
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays} 天后`
}

function explainSlotMeaning(name: string, raw: string): string {
  if (raw === '*' || raw === '?') return `每个${name.split(' ')[0]}均触发`
  if (raw.startsWith('*/')) return `每隔 ${raw.slice(2)} ${name.split(' ')[0]}触发`
  return `限定在 ${raw} ${name.split(' ')[0]}`
}

function buildChineseCronSummary(
  secToken: string, minToken: string, hourToken: string,
  domToken: string, monToken: string, dowToken: string, daysUseAnd: boolean
): string {
  const unrestricted = (value: string) => value === '*' || value === '?'
  const days: string[] = []
  if (!unrestricted(domToken)) days.push(`日期 ${domToken}`)
  if (!unrestricted(dowToken)) days.push(`星期 ${dowToken}`)
  const calendar = [
    ...(!unrestricted(monToken) ? [`月份 ${monToken}`] : []),
    days.length ? `（${days.join(daysUseAnd ? ' 且 ' : ' 或 ')}）` : '每天'
  ].join(' ')
  // 仅把纯数字时分秒合成时刻，不能把 0,30 或 * 转成虚假的 00 分。
  const time = [hourToken, minToken, secToken].every(value => /^\d+$/.test(value))
    ? `${pad2(Number(hourToken))}:${pad2(Number(minToken))}:${pad2(Number(secToken))}`
    : `小时 ${hourToken}；分钟 ${minToken}；秒 ${secToken}`
  return `${calendar} ${time} 执行`
}

/**
 * 解析 5 位（Linux Crontab）或 6 位（Spring 基础语法）Cron 表达式，输出中文语义与未来 5 次触发时间
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
      chineseSummary: '请输入 Cron 表达式',
      errorMessage: '表达式不能为空',
      slots: [],
      nextRuns: []
    }
  }

  const tokens = trimmed.split(/\s+/)
  if (tokens.length !== 5 && tokens.length !== 6) {
    return {
      isValid: false,
      expression: trimmed,
      chineseSummary: 'Cron 字段数量不合法',
      errorMessage: `标准 Cron 需包含 5 位（分 时 日 月 周）或 6 位（秒 分 时 日 月 周），当前为 ${tokens.length} 位`,
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
    if (trimmed.length > 1000) throw new Error('表达式超过 1000 字符限制')
    if (!Number.isFinite(baseDate.getTime())) throw new Error('起算时间无效')
    if (!Number.isInteger(count) || count < 1 || count > 50) throw new Error('推算次数须为 1~50 的整数')
    const secSpec = parseCronField(secToken, 0, 59, '秒 (Second)', undefined, false, isSixField)
    const minSpec = parseCronField(minToken, 0, 59, '分 (Minute)', undefined, false, isSixField)
    const hourSpec = parseCronField(hourToken, 0, 23, '时 (Hour)', undefined, false, isSixField)
    const domSpec = parseCronField(domToken, 1, 31, '日 (Day of Month)', undefined, isSixField, isSixField)
    const monSpec = parseCronField(monToken, 1, 12, '月 (Month)', MONTH_MAP, false, isSixField)
    const dowSpec = parseCronField(dowToken, isSixField ? 1 : 0, 7, '周 (Day of Week)', isSixField ? { ...WEEKDAY_MAP, SUN: 7 } : WEEKDAY_MAP, isSixField, isSixField)
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
          chineseSummary: '永不触发的非法日期组合',
          errorMessage: `指定的月份 (${monToken}) 与日期 (${domToken}) 在日历上永远不可能同时成立（如 2月30日）`,
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
        chineseSummary: '无法推算出有效触发时间',
        errorMessage: `在安全搜索步长内未找到完整的 ${count} 次触发时间`,
        slots: [],
        nextRuns: []
      }
    }

    const slots = [
      ...(isSixField
        ? [{ name: '秒 (Second)', value: secToken, meaning: explainSlotMeaning('秒 (Second)', secToken) }]
        : []),
      { name: '分 (Minute)', value: minToken, meaning: explainSlotMeaning('分 (Minute)', minToken) },
      { name: '时 (Hour)', value: hourToken, meaning: explainSlotMeaning('时 (Hour)', hourToken) },
      { name: '日 (Day)', value: domToken, meaning: explainSlotMeaning('日 (Day)', domToken) },
      { name: '月 (Month)', value: monToken, meaning: explainSlotMeaning('月 (Month)', monToken) },
      { name: '周 (Weekday)', value: dowToken, meaning: explainSlotMeaning('周 (Weekday)', dowToken) }
    ]

    return {
      isValid: true,
      expression: trimmed,
      chineseSummary: buildChineseCronSummary(secToken, minToken, hourToken, domToken, monToken, dowToken, daysUseAnd),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      calculatedAt: formatDateTime(baseDate),
      dialect: isSixField ? 'Spring 六位基础语法（日与周同时匹配）' : 'Linux 五位语法（受限的日与周任一匹配）',
      slots,
      nextRuns
    }
  } catch (err) {
    return {
      isValid: false,
      expression: trimmed,
      chineseSummary: 'Cron 表达式语法错误',
      errorMessage: err instanceof Error ? err.message : '未知语法错误',
      slots: [],
      nextRuns: []
    }
  }
}
