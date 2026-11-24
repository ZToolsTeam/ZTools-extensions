import type { MockSingleItem, MockUserRecord } from './types'
import { t } from './i18n.js'
import { CN_GENDER_MALE, CN_GENDER_FEMALE, type CnGender } from './mock-cn.zh-data.js'

const ID_CARD_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const ID_CARD_CHECK_CODES = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']

const CREDIT_CODE_CHARSET = '0123456789ABCDEFGHJKLMNPQRTUWXY'
const CREDIT_CODE_WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28]

const AREA_CODES = [
  { code: '110105', nameKey: 'area110105' as const },
  { code: '110108', nameKey: 'area110108' as const },
  { code: '310115', nameKey: 'area310115' as const },
  { code: '440106', nameKey: 'area440106' as const },
  { code: '440305', nameKey: 'area440305' as const },
  { code: '330106', nameKey: 'area330106' as const },
  { code: '320102', nameKey: 'area320102' as const },
  { code: '510107', nameKey: 'area510107' as const }
]

const MOBILE_PREFIXES = [
  '138',
  '139',
  '150',
  '158',
  '188',
  '198',
  '130',
  '131',
  '155',
  '186',
  '166',
  '133',
  '153',
  '189',
  '199',
  '192'
]

const BANK_BINS = [
  { bin: '622202', bankKey: 'bank622202' as const, totalLen: 19 },
  { bin: '622848', bankKey: 'bank622848' as const, totalLen: 19 },
  { bin: '621483', bankKey: 'bank621483' as const, totalLen: 16 },
  { bin: '622700', bankKey: 'bank622700' as const, totalLen: 19 }
]

let internalCounter = 104729

function createPrng(seedInput?: number): () => number {
  let state =
    typeof seedInput === 'number' && Number.isFinite(seedInput)
      ? (Math.floor(seedInput) ^ 0x6d2b79f5) >>> 0
      : ((Date.now() + (internalCounter += 7919)) ^ 0x9e3779b9) >>> 0

  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function getDaysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  if ([4, 6, 9, 11].includes(month)) return 30
  return 31
}

function padNum(val: number, len: number): string {
  return String(val).padStart(len, '0')
}

/**
 * 计算国家标准 GB 11643-1999 18位身份证末位校验码
 */
export function calculateIdCardCheckDigit(first17: string): string {
  const clean = String(first17 ?? '').trim()
  if (!/^\d{17}$/.test(clean)) {
    throw new Error(t('errIdCardPrefix'))
  }
  let sum = 0
  for (let i = 0; i < 17; i++) {
    sum += Number(clean[i]) * ID_CARD_WEIGHTS[i]!
  }
  return ID_CARD_CHECK_CODES[sum % 11]!
}

/**
 * 严格核验 18 位身份证号（包含闰年 2月29日 与末位加权模 11 校验位）
 */
export function verifyIdCard(idCard: string): boolean {
  const clean = String(idCard ?? '')
    .trim()
    .toUpperCase()
  if (!/^\d{17}[\dX]$/.test(clean)) return false
  const year = Number(clean.slice(6, 10))
  const month = Number(clean.slice(10, 12))
  const day = Number(clean.slice(12, 14))
  if (year < 1900 || year > 2099) return false
  if (month < 1 || month > 12) return false
  if (day < 1 || day > getDaysInMonth(year, month)) return false
  return calculateIdCardCheckDigit(clean.slice(0, 17)) === clean[17]
}

/**
 * 生成 100% 符合 GB 11643-1999 校验算法的虚拟 18 位二代居民身份证号
 */
export function generateValidIdCard(options?: {
  seed?: number
  year?: number
  month?: number
  day?: number
}): {
  idCard: string
  areaName: string
  birthDate: string
  gender: CnGender
} {
  const rand = createPrng(options?.seed)
  const area = AREA_CODES[Math.floor(rand() * AREA_CODES.length)]!
  const year = options?.year ?? 1978 + Math.floor(rand() * 26)
  const month = options?.month ?? 1 + Math.floor(rand() * 12)
  const maxDay = getDaysInMonth(year, month)
  const requestedDay = options?.day ?? 1 + Math.floor(rand() * maxDay)
  const day = Math.min(Math.max(1, requestedDay), maxDay)
  const seq = 100 + Math.floor(rand() * 899)
  const first17 = `${area.code}${padNum(year, 4)}${padNum(month, 2)}${padNum(day, 2)}${padNum(seq, 3)}`
  const checkDigit = calculateIdCardCheckDigit(first17)

  return {
    idCard: `${first17}${checkDigit}`,
    areaName: t(area.nameKey),
    birthDate: `${padNum(year, 4)}-${padNum(month, 2)}-${padNum(day, 2)}`,
    gender: seq % 2 === 1 ? CN_GENDER_MALE : CN_GENDER_FEMALE
  }
}

/**
 * 计算国家标准 GB 32100-2015 统一社会信用代码第 18 位校验字符（模 31 加权算法）
 */
export function calculateCreditCodeCheckChar(first17: string): string {
  const clean = String(first17 ?? '')
    .trim()
    .toUpperCase()
  if (clean.length !== 17) {
    throw new Error(t('errCreditCodePrefix'))
  }
  let sum = 0
  for (let i = 0; i < 17; i++) {
    const ch = clean[i]!
    const idx = CREDIT_CODE_CHARSET.indexOf(ch)
    if (idx < 0) {
      throw new Error(t('errCreditCodeChar', { ch }))
    }
    sum += idx * CREDIT_CODE_WEIGHTS[i]!
  }
  const remainder = sum % 31
  const checkVal = (31 - remainder) % 31
  return CREDIT_CODE_CHARSET[checkVal]!
}

/**
 * 严格核验 18 位统一社会信用代码（GB 32100-2015）
 */
export function verifyCreditCode(code: string): boolean {
  const clean = String(code ?? '')
    .trim()
    .toUpperCase()
  if (!/^[0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10}$/.test(clean)) {
    return false
  }
  try {
    return calculateCreditCodeCheckChar(clean.slice(0, 17)) === clean[17]
  } catch {
    return false
  }
}

export function generateValidCreditCode(seed?: number): string {
  const rand = createPrng(seed)
  const area = AREA_CODES[Math.floor(rand() * AREA_CODES.length)]!
  let orgCode = ''
  for (let i = 0; i < 9; i++) {
    orgCode += CREDIT_CODE_CHARSET[Math.floor(rand() * CREDIT_CODE_CHARSET.length)]!
  }
  const first17 = `91${area.code}${orgCode}`
  const checkChar = calculateCreditCodeCheckChar(first17)
  return `${first17}${checkChar}`
}

/**
 * 计算 ISO/IEC 7812 Luhn 银行卡末位模 10 校验码
 */
export function calculateLuhnCheckDigit(partialCard: string): number {
  const clean = String(partialCard ?? '').trim()
  if (!/^\d+$/.test(clean)) {
    throw new Error(t('errCardPrefix'))
  }
  let sum = 0
  let isEven = true
  for (let i = clean.length - 1; i >= 0; i--) {
    let digit = Number(clean[i])
    if (isEven) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    isEven = !isEven
  }
  return (10 - (sum % 10)) % 10
}

/**
 * 验证银行卡号是否通过 Luhn 算法
 */
export function verifyBankCardLuhn(cardNo: string): boolean {
  const clean = String(cardNo ?? '').trim()
  if (!/^[1-9]\d{15,18}$/.test(clean)) return false
  const prefix = clean.slice(0, -1)
  const last = Number(clean.slice(-1))
  return calculateLuhnCheckDigit(prefix) === last
}

export function generateValidBankCard(seed?: number): {
  cardNo: string
  bankName: string
} {
  const rand = createPrng(seed)
  const spec = BANK_BINS[Math.floor(rand() * BANK_BINS.length)]!
  const bodyLen = spec.totalLen - spec.bin.length - 1
  let body = ''
  for (let i = 0; i < bodyLen; i++) {
    body += String(Math.floor(rand() * 10))
  }
  const prefix = `${spec.bin}${body}`
  const check = calculateLuhnCheckDigit(prefix)
  return {
    cardNo: `${prefix}${check}`,
    bankName: t(spec.bankKey)
  }
}

export function generateValidMobilePhone(seed?: number): string {
  const rand = createPrng(seed)
  const prefix = MOBILE_PREFIXES[Math.floor(rand() * MOBILE_PREFIXES.length)]!
  let tail = ''
  for (let i = 0; i < 8; i++) {
    tail += String(Math.floor(rand() * 10))
  }
  return `${prefix}${tail}`
}

export function generateMockSingleItems(seed?: number): MockSingleItem[] {
  const rand = createPrng(seed)
  const s1 = Math.floor(rand() * 1_000_000)
  const idInfo = generateValidIdCard({ seed: s1 })
  const creditCode = generateValidCreditCode(s1 + 17)
  const bankInfo = generateValidBankCard(s1 + 31)
  const phone = generateValidMobilePhone(s1 + 53)
  const surnames = t('surnames').split(',')
  const givenNamesM = t('givenNamesM').split(',')
  const givenNamesF = t('givenNamesF').split(',')
  const companyWords = t('companyWords').split(',')
  const surname = surnames[Math.floor(rand() * surnames.length)]!
  const given =
    idInfo.gender === CN_GENDER_MALE
      ? givenNamesM[Math.floor(rand() * givenNamesM.length)]!
      : givenNamesF[Math.floor(rand() * givenNamesF.length)]!
  const fullName = `${surname}${given}`
  const company = t('companyFull', { word: companyWords[Math.floor(rand() * companyWords.length)]! })

  const genderLabel = idInfo.gender === CN_GENDER_MALE ? t('genderMale') : t('genderFemale')

  return [
    {
      id: 'mock-id-card',
      fieldKey: 'idCard',
      label: t('idCardLabel'),
      value: idInfo.idCard,
      category: t('idCardCategory'),
      standard: 'GB 11643-1999',
      formatType: t('idCardFormat'),
      breakdownMarkdown: t('idCardBreakdown', {
        areaName: idInfo.areaName,
        areaCode: idInfo.idCard.slice(0, 6),
        birthDate: idInfo.birthDate,
        gender: genderLabel,
        checkDigit: idInfo.idCard.slice(17)
      }),
      algorithmNote: t('idCardNote'),
      hasCheckDigit: true
    },
    {
      id: 'mock-credit-code',
      fieldKey: 'creditCode',
      label: t('creditCodeLabel'),
      value: creditCode,
      category: t('creditCodeCategory'),
      standard: 'GB 32100-2015',
      formatType: t('creditCodeFormat'),
      breakdownMarkdown: t('creditCodeBreakdown', {
        areaCode: creditCode.slice(2, 8),
        orgCode: creditCode.slice(8, 17),
        checkChar: creditCode.slice(17)
      }),
      algorithmNote: t('creditCodeNote'),
      hasCheckDigit: true
    },
    {
      id: 'mock-bank-card',
      fieldKey: 'bankCard',
      label: t('bankCardLabel'),
      value: bankInfo.cardNo,
      category: t('bankCardCategory'),
      standard: 'ISO/IEC 7812',
      formatType: t('bankCardFormat', { len: bankInfo.cardNo.length }),
      breakdownMarkdown: t('bankCardBreakdown', {
        bankName: bankInfo.bankName,
        bin: bankInfo.cardNo.slice(0, 6),
        checkDigit: bankInfo.cardNo.slice(-1)
      }),
      algorithmNote: t('bankCardNote'),
      hasCheckDigit: true
    },
    {
      id: 'mock-mobile-phone',
      fieldKey: 'phone',
      label: t('mobileLabel'),
      value: phone,
      category: t('mobileCategory'),
      standard: t('mobileStandard'),
      formatType: t('mobileFormat'),
      breakdownMarkdown: t('mobileBreakdown', {
        prefix: phone.slice(0, 3),
        phone
      }),
      algorithmNote: t('mobileNote'),
      hasCheckDigit: false
    },
    {
      id: 'mock-person-company',
      fieldKey: 'nameAndCompany',
      label: t('personCompanyLabel'),
      value: `${fullName} · ${company}`,
      category: t('personCompanyCategory'),
      standard: t('personCompanyStandard'),
      formatType: t('personCompanyFormat'),
      breakdownMarkdown: t('personCompanyBreakdown', {
        fullName,
        gender: genderLabel,
        company
      }),
      algorithmNote: t('personCompanyNote'),
      hasCheckDigit: false,
      jsonValue: { name: fullName, companyName: company }
    }
  ]
}

export function generateMockBatchUsers(count = 10, seed?: number): MockUserRecord[] {
  const safeCount = Math.min(Math.max(1, Math.floor(count || 10)), 500)
  const rand = createPrng(seed)
  const records: MockUserRecord[] = []
  const now = new Date()

  for (let i = 0; i < safeCount; i++) {
    const itemSeed = Math.floor(rand() * 10_000_000) + i * 97
    const idInfo = generateValidIdCard({ seed: itemSeed })
    const creditCode = generateValidCreditCode(itemSeed + 11)
    const bankInfo = generateValidBankCard(itemSeed + 23)
    const phone = generateValidMobilePhone(itemSeed + 41)
    const surnames = t('surnames').split(',')
    const givenNamesM = t('givenNamesM').split(',')
    const givenNamesF = t('givenNamesF').split(',')
    const companyWords = t('companyWords').split(',')
    const surname = surnames[i % surnames.length]!
    const given =
      idInfo.gender === CN_GENDER_MALE
        ? givenNamesM[i % givenNamesM.length]!
        : givenNamesF[i % givenNamesF.length]!
    const [birthYear, birthMonth, birthDay] = idInfo.birthDate.split('-').map(Number)
    const birthdayPending = now.getMonth() + 1 < birthMonth! ||
      (now.getMonth() + 1 === birthMonth && now.getDate() < birthDay!)

    records.push({
      id: `USR-${padNum(i + 1, 4)}`,
      name: `${surname}${given}`,
      gender: idInfo.gender === CN_GENDER_MALE ? t('genderMale') : t('genderFemale'),
      age: now.getFullYear() - birthYear! - Number(birthdayPending),
      idCard: idInfo.idCard,
      phone,
      email: `user_${i + 1}_${phone.slice(-4)}@example.com`,
      companyName: t('batchCompanyFull', { word: companyWords[i % companyWords.length]! }),
      creditCode,
      bankCard: bankInfo.cardNo,
      address: t('batchAddressFull', { areaName: idInfo.areaName, floor: i + 1 }),
      createdAt: now.toISOString()
    })
  }

  return records
}
