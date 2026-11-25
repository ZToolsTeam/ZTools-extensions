/**
 * 电子发票识别与报销归集业务逻辑
 *
 * 核心能力：
 * 1. 通过选择文件、选择文件夹或拖入导入 PDF、OFD、XML 及图片格式电子发票，按每批最多 50 个交给宿主识别发票号码、开票日期、销售方、购买方、价税合计与税额
 * 2. 识别不到的字段保持为空并标为「未识别」，补全前不能勾选导出，也不参与按字段生成文件名
 * 3. 发票号查重与个人抬头提示
 * 4. 按模板复制出规范命名的发票副本（不改动原文件），生成 UTF-8 BOM 报销明细 CSV 与可直接粘贴到表格的 TSV 文本
 */
import { getLocale } from '@ztools/declarative-ui'

import {
  callHostTransport,
  invokeDllPluginCapability,
  showRealItemInFolder,
  trashRealItem
} from './native-ipc.js'
import {
  friendlyFileError,
  pathKey,
  type FileImportRules,
  type FileImportTransport
} from './file-import.js'
import { t } from './i18n.js'
import { resolveErrorMessage } from './error-i18n.js'
import {
  INVOICE_CATEGORIES,
  INVOICE_FIELD_LABELS,
  INVOICE_RENAME_TEMPLATES,
  INVOICE_CATEGORY_GROUPS,
  EXPENSE_CATEGORY_CYCLE,
  HOST_CATEGORY_ALIASES,
  PLACEHOLDER_PARTY_NAMES,
  ZH_ISSUE_DATE_REGEX,
  ZH_PERSONAL_HEADER_REGEX,
  EXPORTED_FILE_NAMES,
  type InvoiceCategoryType
} from './invoice-parser.zh-data.js'

export { formatBytes } from './native-ipc.js'
export {
  INVOICE_FIELD_LABELS,
  INVOICE_RENAME_TEMPLATES,
  INVOICE_CATEGORY_GROUPS,
  EXPENSE_CATEGORY_CYCLE,
  HOST_CATEGORY_ALIASES,
  EXPORTED_FILE_NAMES,
  type InvoiceCategoryType
}

export function translateCategory(cat: InvoiceCategoryType | string): string {
  switch (cat) {
    case INVOICE_CATEGORIES.DINING: return t('catDining')
    case INVOICE_CATEGORIES.TRANSIT: return t('catTransit')
    case INVOICE_CATEGORIES.LODGING: return t('catLodging')
    case INVOICE_CATEGORIES.OFFICE: return t('catOffice')
    case INVOICE_CATEGORIES.OTHER: return t('catOther')
    default: return cat
  }
}

export function getInvoiceFieldLabel(key: InvoiceFieldKey): string {
  switch (key) {
    case 'invoiceNo': return t('fieldInvoiceNo')
    case 'issueDate': return t('fieldIssueDate')
    case 'sellerName': return t('fieldSellerName')
    case 'buyerName': return t('fieldBuyerName')
    case 'totalAmount': return t('fieldTotalAmount')
    case 'taxAmount': return t('fieldTaxAmount')
  }
}

export function getUnrecognizedText(): string {
  return t('unrecognized')
}

export function getForbiddenReason(): string {
  return t('forbiddenReason')
}

export function getInvoiceRenameTemplates(): InvoiceRenameTemplate[] {
  return [
    { id: 'tpl-standard', title: t('tpl1Title'), patternDesc: t('tpl1Desc') },
    { id: 'tpl-date-first', title: t('tpl2Title'), patternDesc: t('tpl2Desc') },
    { id: 'tpl-amount-first', title: t('tpl3Title'), patternDesc: t('tpl3Desc') },
    { id: 'tpl-tax-audit', title: t('tpl4Title'), patternDesc: t('tpl4Desc') }
  ]
}

export function getInvoiceCategoryGroups(): Array<{ id: string; name: string }> {
  return [
    { id: 'ALL', name: t('grpAll') },
    { id: 'TRAVEL', name: t('grpTravel') },
    { id: INVOICE_CATEGORIES.TRANSIT, name: t('grpTransit') },
    { id: INVOICE_CATEGORIES.LODGING, name: t('grpLodging') },
    { id: INVOICE_CATEGORIES.DINING, name: t('grpDining') },
    { id: INVOICE_CATEGORIES.OFFICE, name: t('grpOffice') },
    { id: INVOICE_CATEGORIES.OTHER, name: t('grpOther') }
  ]
}

/** 报销明细里每张发票都必须有的字段 */
export type InvoiceFieldKey = 'invoiceNo' | 'issueDate' | 'sellerName' | 'buyerName' | 'totalAmount' | 'taxAmount'

export const INVOICE_FIELD_ORDER: InvoiceFieldKey[] = [
  'invoiceNo',
  'issueDate',
  'sellerName',
  'buyerName',
  'totalAmount',
  'taxAmount'
]

export interface InvoiceRecordItem {
  id: string
  path: string
  fileName: string
  extension: string
  sizeBytes: number
  /** 空字符串表示未识别 */
  invoiceNo: string
  /** YYYY-MM-DD；空字符串表示未识别 */
  issueDate: string
  /**
   * 开票日期与今天相同：宿主识别不到日期时会填入当天日期，插件无法区分，
   * 因此要求用户核对确认后才能导出（手动保存过发票信息后置为 false）
   */
  issueDateNeedsReview?: boolean
  /** 空字符串表示未识别 */
  sellerName: string
  /** 空字符串表示未识别 */
  buyerName: string
  buyerTaxId: string
  /** null 表示未识别 */
  totalAmount: number | null
  /** null 表示未识别 */
  taxAmount: number | null
  /** 价税合计减税额；任一未识别时为 null */
  netAmount: number | null
  category: InvoiceCategoryType
  isDuplicate: boolean
  isHeaderAbnormal: boolean
}

export interface InvoiceRenameTemplate {
  id: string
  title: string
  patternDesc: string
}

export interface NativeInvocationResult {
  ok: boolean
  pluginName: string
  method: string
  data?: unknown
  error?: string
  fromFallback?: boolean
}

export interface InvoiceParseError {
  file: string
  error: string
}

export const DLL_PLUGIN_NAME = 'InvoiceAssistantPlugin'
export const FORBIDDEN_TARGET_PATTERN = new RegExp('\\\\Windows\\\\System32|\\.\\.\\\\|\\.\\./', 'i')

/** 导出目录的上级目录名（位于第一张发票所在目录下），扫描时跳过其中的副本 */
export const EXPORT_ROOT_DIR_NAME = 'ZTools_Reimbursement_Export'

export function normalizeInvoiceCategory(raw: unknown): InvoiceCategoryType {
  const text = String(raw ?? '').trim()
  if ((EXPENSE_CATEGORY_CYCLE as string[]).includes(text)) return text as InvoiceCategoryType
  return HOST_CATEGORY_ALIASES[text] ?? INVOICE_CATEGORIES.OTHER
}

/** 发票号码：传统发票 8 位、数电发票 20 位数字；全 0 是宿主读到 PDF 内部偏移量等无关数字 */
export function normalizeInvoiceNo(raw: unknown): string {
  const text = String(raw ?? '').replace(/\s+/g, '')
  if (!/^(?:\d{8}|\d{20})$/.test(text)) return ''
  if (/^0+$/.test(text)) return ''
  return text
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function formatLocalDateKey(now: Date): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

/** 开票日期规范为 YYYY-MM-DD；不是真实日期、早于 2000 年或晚于今天时返回空字符串 */
export function normalizeIssueDate(raw: unknown, now: Date = new Date()): string {
  const text = String(raw ?? '').trim()
  const m = text.match(ZH_ISSUE_DATE_REGEX)
  if (!m) return ''
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (year < 2000 || month < 1 || month > 12 || day < 1 || day > 31) return ''
  const probe = new Date(year, month - 1, day)
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) return ''
  const key = `${year}-${pad2(month)}-${pad2(day)}`
  if (key > formatLocalDateKey(now)) return ''
  return key
}

/** 日期与今天（本地或 UTC）相同：可能是宿主识别不到日期时填入的当天日期 */
export function isPossibleFallbackDate(date: string, now: Date = new Date()): boolean {
  if (!date) return false
  return date === formatLocalDateKey(now) || date === now.toISOString().slice(0, 10)
}

/** 金额：非负有限数，保留两位小数；allowZero 为 false 时 0 也视为未识别 */
export function normalizeAmount(raw: unknown, allowZero: boolean): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'string' && raw.trim() === '') return null
  const num = typeof raw === 'number' ? raw : Number(String(raw).replace(/[¥￥,，\s]/g, ''))
  if (!Number.isFinite(num) || num < 0) return null
  if (!allowZero && num === 0) return null
  return Math.round(num * 100) / 100
}

function normalizePartyName(raw: unknown): string {
  const text = String(raw ?? '').trim()
  if (!text || PLACEHOLDER_PARTY_NAMES.has(text)) return ''
  return text
}

function computeNetAmount(total: number | null, tax: number | null): number | null {
  if (total === null || tax === null || tax > total) return null
  return Math.round((total - tax) * 100) / 100
}

function extOfFileName(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(dot).toLowerCase() : ''
}

/**
 * 把宿主返回的一条识别结果整理成插件数据；识别不到的字段一律留空，不填默认值。
 * 缺少文件路径的结果无法导出或定位，返回 null。
 */
export function normalizeParsedInvoice(
  raw: Record<string, unknown>,
  idx: number,
  now: Date = new Date()
): InvoiceRecordItem | null {
  const filePath = String(raw.path ?? '').trim()
  if (!filePath) return null
  const fileName = String(raw.fileName ?? '').trim() || filePath.split(/[\\/]/).pop() || filePath
  const issueDate = normalizeIssueDate(raw.issueDate, now)
  const totalAmount = normalizeAmount(raw.totalAmount, false)
  // 宿主识别不到税额时填 0；价税合计都没识别到时，这个 0 不可信
  let taxAmount = normalizeAmount(raw.taxAmount, true)
  if (taxAmount !== null && totalAmount !== null && taxAmount > totalAmount) taxAmount = null
  if (totalAmount === null && taxAmount === 0) taxAmount = null
  const sizeBytes = Number(raw.sizeBytes)

  return {
    id: String(raw.id ?? `inv-${idx}-${filePath}`),
    path: filePath,
    fileName,
    extension: extOfFileName(fileName),
    sizeBytes: Number.isFinite(sizeBytes) && sizeBytes >= 0 ? sizeBytes : 0,
    invoiceNo: normalizeInvoiceNo(raw.invoiceNo),
    issueDate,
    issueDateNeedsReview: isPossibleFallbackDate(issueDate, now),
    sellerName: normalizePartyName(raw.sellerName),
    buyerName: normalizePartyName(raw.buyerName),
    buyerTaxId: String(raw.buyerTaxId ?? '').trim(),
    totalAmount,
    taxAmount,
    netAmount: computeNetAmount(totalAmount, taxAmount),
    category: normalizeInvoiceCategory(raw.category),
    isDuplicate: false,
    isHeaderAbnormal: false
  }
}

export interface InvoiceFieldIssues {
  /** 未识别的字段 */
  missing: InvoiceFieldKey[]
  /** 有值但需要用户核对的字段 */
  needsReview: InvoiceFieldKey[]
}

export function getInvoiceFieldIssues(item: InvoiceRecordItem): InvoiceFieldIssues {
  const missing: InvoiceFieldKey[] = []
  if (!item.invoiceNo) missing.push('invoiceNo')
  if (!item.issueDate) missing.push('issueDate')
  if (!item.sellerName) missing.push('sellerName')
  if (!item.buyerName) missing.push('buyerName')
  if (item.totalAmount === null || !Number.isFinite(item.totalAmount)) missing.push('totalAmount')
  if (item.taxAmount === null || !Number.isFinite(item.taxAmount)) missing.push('taxAmount')
  const needsReview: InvoiceFieldKey[] = item.issueDate && item.issueDateNeedsReview ? ['issueDate'] : []
  return { missing, needsReview }
}

export function isInvoiceComplete(item: InvoiceRecordItem): boolean {
  const issues = getInvoiceFieldIssues(item)
  return issues.missing.length === 0 && issues.needsReview.length === 0
}

/** 例如「未识别：价税合计、税额；开票日期待核对」；字段完整时返回空字符串 */
export function describeInvoiceIssues(item: InvoiceRecordItem): string {
  const { missing, needsReview } = getInvoiceFieldIssues(item)
  const parts: string[] = []
  if (missing.length > 0) parts.push(t('issueMissingPrefix', { fields: missing.map((f) => getInvoiceFieldLabel(f)).join(t('listSep')) }))
  if (needsReview.length > 0) parts.push(t('issueNeedsReviewSuffix', { fields: needsReview.map((f) => getInvoiceFieldLabel(f)).join(t('listSep')) }))
  return parts.join(t('semiSep'))
}

/** 可以勾选导出：字段完整且不是重复发票 */
export function isInvoiceSelectable(item: InvoiceRecordItem): boolean {
  return isInvoiceComplete(item) && !item.isDuplicate
}

/** 默认勾选：可导出且抬头正常 */
export function defaultCheckedInvoiceIds(items: InvoiceRecordItem[]): string[] {
  return items.filter((i) => isInvoiceSelectable(i) && !i.isHeaderAbnormal).map((i) => i.id)
}

export function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return t('unrecognized')
  const num = Number(amount)
  if (!Number.isFinite(num)) return t('unrecognized')
  return `¥${num.toLocaleString(getLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * 按模板生成归档文件名；发票有未识别或待核对的字段时返回 null（不能用占位值拼文件名）
 */
export function buildTargetInvoiceFileName(item: InvoiceRecordItem, templateId: string): string | null {
  if (!isInvoiceComplete(item)) return null
  const ext = item.extension || extOfFileName(item.fileName)
  const safeSeller = item.sellerName.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 24)
  const tailNo = item.invoiceNo.slice(-4)
  const amt = (item.totalAmount as number).toFixed(2)
  const date = item.issueDate
  const cat = translateCategory(item.category || INVOICE_CATEGORIES.OTHER)
  const formattedAmt = t('formatAmount', { amount: amt })

  if (templateId === 'tpl-date-first') {
    return `${date}_[${cat}]_${formattedAmt}_${safeSeller}${ext}`
  }
  if (templateId === 'tpl-amount-first') {
    return `[${cat}]_${formattedAmt}_${safeSeller}_${tailNo}${ext}`
  }
  if (templateId === 'tpl-tax-audit') {
    return `${item.invoiceNo}_${date}_${safeSeller}_${formattedAmt}${ext}`
  }
  return `[${cat}]_${date}_${safeSeller}_${formattedAmt}_${tailNo}${ext}`
}

/**
 * 为一批发票生成互不重名的归档文件名（不区分大小写，重名的依次加 _2、_3），
 * 避免复制副本时后一份覆盖前一份。字段不完整的发票不分配文件名。
 */
export function buildUniqueTargetNames(items: InvoiceRecordItem[], templateId: string): Map<string, string> {
  const used = new Set<string>()
  const out = new Map<string, string>()
  for (const item of items) {
    const base = buildTargetInvoiceFileName(item, templateId)
    if (!base) continue
    const dot = base.lastIndexOf('.')
    const stem = dot > 0 ? base.slice(0, dot) : base
    const ext = dot > 0 ? base.slice(dot) : ''
    let name = base
    let n = 2
    while (used.has(name.toLowerCase())) {
      name = `${stem}_${n}${ext}`
      n++
    }
    used.add(name.toLowerCase())
    out.set(item.id, name)
  }
  return out
}

function displayText(value: string): string {
  return value || t('unrecognized')
}

function displayAmount(value: number | null): string {
  return value === null || !Number.isFinite(value) ? t('unrecognized') : value.toFixed(2)
}

function displayDate(item: InvoiceRecordItem): string {
  if (!item.issueDate) return t('unrecognized')
  return item.issueDateNeedsReview ? t('needsReviewTag', { date: item.issueDate }) : item.issueDate
}

/**
 * 生成可直接粘贴到 Excel / 飞书表格的 TSV（制表符分隔）报销明细文本；
 * 未识别的字段写「未识别」，字段不完整的发票不生成归档文件名
 */
export function buildInvoiceTsvTable(items: InvoiceRecordItem[], templateId = 'tpl-standard'): string {
  const header = [
    t('tsvColIndex'),
    t('tsvColInvoiceNo'),
    t('tsvColIssueDate'),
    t('tsvColCategory'),
    t('tsvColSeller'),
    t('tsvColBuyer'),
    t('tsvColTotal'),
    t('tsvColTax'),
    t('tsvColNet'),
    t('tsvColFileName')
  ].join('\t')

  const names = buildUniqueTargetNames(items, templateId)
  const clean = (value: string) => value.replace(/[\t\r\n]+/g, ' ')
  const rows = items.map((item, idx) =>
    [
      idx + 1,
      clean(displayText(item.invoiceNo)),
      displayDate(item),
      translateCategory(item.category),
      clean(displayText(item.sellerName)),
      clean(displayText(item.buyerName)),
      displayAmount(item.totalAmount),
      displayAmount(item.taxAmount),
      displayAmount(item.netAmount),
      names.get(item.id) ?? ''
    ].join('\t')
  )

  return [header, ...rows].join('\n')
}

/** 单张发票的文字摘要（复制用），未识别的字段写「未识别」 */
export function buildInvoiceSummaryText(item: InvoiceRecordItem): string {
  return [
    t('summaryLineNo', { val: displayText(item.invoiceNo) }),
    t('summaryLineDate', { val: displayDate(item) }),
    t('summaryLineSeller', { val: displayText(item.sellerName) }),
    t('summaryLineBuyer', { val: displayText(item.buyerName) }),
    t('summaryLineAmount', { total: displayAmount(item.totalAmount), tax: displayAmount(item.taxAmount) })
  ].join('\n')
}

/**
 * 执行发票号查重与购方抬头异常预检（按当前字段重新计算，修改发票信息后可再次调用）
 */
export function detectInvoiceAnomalies(
  items: InvoiceRecordItem[],
  expectedBuyerKeyword = ''
): InvoiceRecordItem[] {
  const seenNo = new Set<string>()
  const kw = expectedBuyerKeyword.trim()
  return items.map((item) => {
    const normNo = String(item.invoiceNo || '').trim()
    const isDuplicate = normNo.length > 0 && seenNo.has(normNo)
    if (normNo.length > 0) seenNo.add(normNo)
    const buyer = String(item.buyerName || '').trim()
    // 购买方未识别时归入「未识别字段」，这里只判断已识别的抬头
    const isPersonalHeader = buyer.length > 0 && ZH_PERSONAL_HEADER_REGEX.test(buyer)
    const isMismatch = kw && buyer.length > 0 ? !buyer.includes(kw) && !String(item.buyerTaxId || '').includes(kw) : false
    return {
      ...item,
      isDuplicate,
      isHeaderAbnormal: Boolean(isPersonalHeader || isMismatch)
    }
  })
}

export type InvoiceFilterKey = string

/** 列表筛选与左侧导航计数共用的匹配规则 */
export function matchesInvoiceFilter(item: InvoiceRecordItem, key: InvoiceFilterKey): boolean {
  switch (key) {
    case 'ALL':
      return true
    case 'DUPLICATE':
      return item.isDuplicate
    case 'ABNORMAL':
      return item.isHeaderAbnormal
    case 'INCOMPLETE':
      return !isInvoiceComplete(item)
    case 'TRAVEL':
      return item.category === INVOICE_CATEGORIES.TRANSIT || item.category === INVOICE_CATEGORIES.LODGING
    default:
      return item.category === key
  }
}

export interface InvoiceEditInput {
  invoiceNo: string
  issueDate: string
  sellerName: string
  buyerName: string
  totalAmount: string
  taxAmount: string
}

export interface InvoiceEditValues {
  invoiceNo: string
  issueDate: string
  sellerName: string
  buyerName: string
  totalAmount: number
  taxAmount: number
  netAmount: number
}

export type InvoiceEditValidation =
  | { ok: true; values: InvoiceEditValues }
  | { ok: false; errors: Partial<Record<InvoiceFieldKey, string>> }

const AMOUNT_TEXT_PATTERN = /^\d+(?:\.\d{1,2})?$/

function parseAmountText(text: string): number | null {
  const cleaned = String(text ?? '').replace(/[¥￥,，\s]/g, '')
  if (!AMOUNT_TEXT_PATTERN.test(cleaned)) return null
  return Math.round(Number(cleaned) * 100) / 100
}

/** 校验用户补全 / 修改的发票字段 */
export function validateInvoiceEdits(input: InvoiceEditInput, now: Date = new Date()): InvoiceEditValidation {
  const errors: Partial<Record<InvoiceFieldKey, string>> = {}

  const invoiceNo = normalizeInvoiceNo(input.invoiceNo)
  if (!invoiceNo) errors.invoiceNo = t('errEditInvoiceNo')

  const issueDate = normalizeIssueDate(input.issueDate, now)
  if (!issueDate) errors.issueDate = t('errEditIssueDate')

  const sellerName = String(input.sellerName ?? '').trim()
  if (!sellerName) errors.sellerName = t('errEditSellerEmpty')
  else if (sellerName.length > 100) errors.sellerName = t('errEditSellerLong')

  const buyerName = String(input.buyerName ?? '').trim()
  if (!buyerName) errors.buyerName = t('errEditBuyerEmpty')
  else if (buyerName.length > 100) errors.buyerName = t('errEditBuyerLong')

  const totalAmount = parseAmountText(input.totalAmount)
  if (totalAmount === null || totalAmount <= 0) errors.totalAmount = t('errEditTotalInvalid')
  else if (totalAmount > 100_000_000) errors.totalAmount = t('errEditTotalRange')

  const taxAmount = parseAmountText(input.taxAmount)
  if (taxAmount === null) errors.taxAmount = t('errEditTaxInvalid')
  else if (totalAmount !== null && taxAmount > totalAmount) errors.taxAmount = t('errEditTaxExceeds')

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return {
    ok: true,
    values: {
      invoiceNo,
      issueDate,
      sellerName,
      buyerName,
      totalAmount: totalAmount as number,
      taxAmount: taxAmount as number,
      netAmount: Math.round(((totalAmount as number) - (taxAmount as number)) * 100) / 100
    }
  }
}

/** 把用户确认过的字段写回发票（日期视为已核对），并重新计算查重与抬头检查 */
export function applyInvoiceEdits(
  items: InvoiceRecordItem[],
  id: string,
  values: InvoiceEditValues,
  expectedBuyer = ''
): InvoiceRecordItem[] {
  const next = items.map((item) =>
    item.id === id ? { ...item, ...values, issueDateNeedsReview: false } : item
  )
  return detectInvoiceAnomalies(next, expectedBuyer)
}

export function validateInvocationPayload(
  method: string,
  params: unknown
): { valid: boolean; error?: string } {
  if (typeof method !== 'string' || method.trim().length === 0) {
    return { valid: false, error: t('errMethodEmpty') }
  }
  if (method.length > 128 || !/^[A-Za-z0-9_]+$/.test(method.trim())) {
    return { valid: false, error: t('errMethodFormat') }
  }
  if (params === null || params === undefined || typeof params !== 'object' || Array.isArray(params)) {
    return { valid: false, error: t('errParamsObject') }
  }

  const record = params as Record<string, unknown>
  for (const [key, val] of Object.entries(record)) {
    if (typeof val === 'string') {
      if (val.length > 4096) {
        return { valid: false, error: t('errParamTooLong', { key }) }
      }
      if ((key === 'outputDir' || key === 'targetDir') && FORBIDDEN_TARGET_PATTERN.test(val)) {
        return { valid: false, error: t('errSecurityIntercepted', { reason: getForbiddenReason() }) }
      }
    }
  }
  return { valid: true }
}

export async function invokeNativeCapability(
  method: string,
  params: Record<string, unknown>,
  hostBridge?: unknown
): Promise<NativeInvocationResult> {
  const check = validateInvocationPayload(method, params)
  if (!check.valid) {
    throw new Error(resolveErrorMessage(check, t('errParamValidation')))
  }
  const res = await invokeDllPluginCapability(DLL_PLUGIN_NAME, method, params, hostBridge)
  return {
    ok: res.ok,
    pluginName: DLL_PLUGIN_NAME,
    method: method.trim(),
    data: res.data ?? undefined,
    error: res.error,
    fromFallback: res.fromFallback
  }
}

export const INVOICE_IMPORT_EXTENSIONS = ['.pdf', '.ofd', '.xml', '.jpg', '.jpeg', '.png'] as const
export const INVOICE_IMPORT_SUPPORTED_TEXT = 'PDF / OFD / XML / JPG / PNG'
export const INVOICE_PARSE_BATCH_SIZE = 50

const INVOICE_FILE_REGEX = /\.(?:pdf|ofd|xml|jpg|jpeg|png)$/i

export function isInsideExportDirectory(filePath: string): boolean {
  return filePath
    .split(/[\\/]/)
    .some((segment) => segment.toLowerCase() === EXPORT_ROOT_DIR_NAME.toLowerCase())
}

/** 导入规则：支持 6 种电子发票格式，跳过历史导出产物与导出目录，拦截系统受保护路径 */
export const INVOICE_IMPORT_RULES: FileImportRules = {
  extensions: INVOICE_IMPORT_EXTENSIONS,
  forbiddenPath: FORBIDDEN_TARGET_PATTERN,
  excludeDirNames: [EXPORT_ROOT_DIR_NAME],
  excludeFile: (name, filePath) => EXPORTED_FILE_NAMES.test(name) || isInsideExportDirectory(filePath)
}

export function createInvoiceImportTransport(hostOverride?: unknown): FileImportTransport {
  return (method, params) => callHostTransport<unknown>(method, params, hostOverride)
}

export function isInvoiceFilePath(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 4096 || /[\0\r\n"]/.test(trimmed)) return false
  if (FORBIDDEN_TARGET_PATTERN.test(trimmed)) return false
  const name = trimmed.split(/[\\/]/).pop() || ''
  if (EXPORTED_FILE_NAMES.test(name) || isInsideExportDirectory(trimmed)) return false
  return INVOICE_FILE_REGEX.test(trimmed)
}

function dedupeInvoicePaths(rawPaths: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of rawPaths) {
    if (!isInvoiceFilePath(raw)) continue
    const trimmed = raw.trim()
    const key = pathKey(trimmed)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

export interface ParseInvoiceFilesOptions {
  signal?: AbortSignal
  onProgress?: (progress: { done: number; total: number }) => void
  batchSize?: number
}

/**
 * 调用宿主分批解析指定的电子发票文件：每批最多 50 个，单批失败不阻断其他批次并如实记录失败。
 */
export async function parseInvoiceFiles(
  filePaths: string[],
  expectedBuyer = '',
  hostOverride?: unknown,
  now: Date = new Date(),
  options: ParseInvoiceFilesOptions = {}
): Promise<{
  ok: boolean
  invoices: InvoiceRecordItem[]
  parseErrors: InvoiceParseError[]
  batchErrors: string[]
  canceled?: boolean
  error?: string
}> {
  const validPaths = dedupeInvoicePaths(Array.isArray(filePaths) ? filePaths : [])
  if (validPaths.length === 0) return { ok: true, invoices: [], parseErrors: [], batchErrors: [] }

  const rawBatchSize = options.batchSize
  const batchSize =
    typeof rawBatchSize === 'number' && Number.isInteger(rawBatchSize) && rawBatchSize > 0
      ? Math.min(rawBatchSize, INVOICE_PARSE_BATCH_SIZE)
      : INVOICE_PARSE_BATCH_SIZE

  const recognized: InvoiceRecordItem[] = []
  const parseErrors: InvoiceParseError[] = []
  const batchErrors: string[] = []
  let succeededBatches = 0
  let done = 0

  for (let offset = 0; offset < validPaths.length; offset += batchSize) {
    if (options.signal?.aborted) {
      return { ok: false, invoices: [], parseErrors: [], batchErrors: [], canceled: true }
    }
    const chunk = validPaths.slice(offset, offset + batchSize)
    const params = expectedBuyer ? { files: chunk, expectedBuyer } : { files: chunk }
    let res: NativeInvocationResult
    try {
      res = await invokeNativeCapability('ParseInvoices', params, hostOverride)
    } catch (err) {
      const errMsg = friendlyFileError(err)
      batchErrors.push(errMsg)
      for (const file of chunk) {
        parseErrors.push({ file, error: errMsg })
      }
      done += chunk.length
      options.onProgress?.({ done, total: validPaths.length })
      continue
    }

    if (options.signal?.aborted) {
      return { ok: false, invoices: [], parseErrors: [], batchErrors: [], canceled: true }
    }

    if (!res.ok || !res.data || typeof res.data !== 'object') {
      const errMsg = friendlyFileError(resolveErrorMessage(res, t('errHostNoInvoiceResult')))
      batchErrors.push(errMsg)
      for (const file of chunk) {
        parseErrors.push({ file, error: errMsg })
      }
      done += chunk.length
      options.onProgress?.({ done, total: validPaths.length })
      continue
    }

    succeededBatches += 1
    const data = res.data as { invoices?: unknown; errors?: unknown }
    parseErrors.push(...readParseErrors(data.errors))
    const rawEntries = Array.isArray(data.invoices) ? (data.invoices as Array<Record<string, unknown>>) : []
    for (let i = 0; i < rawEntries.length; i++) {
      const raw = rawEntries[i]
      const normalized = normalizeParsedInvoice(raw && typeof raw === 'object' ? raw : {}, recognized.length + i, now)
      if (normalized) recognized.push(normalized)
      else parseErrors.push({ file: String(raw?.fileName ?? t('nthResultFallback', { n: recognized.length + i + 1 })), error: t('errResultMissingPath') })
    }
    done += chunk.length
    options.onProgress?.({ done, total: validPaths.length })
  }

  if (succeededBatches === 0) {
    return {
      ok: false,
      invoices: [],
      parseErrors,
      batchErrors,
      error: batchErrors[0] || t('errParseInvoicesFailed')
    }
  }

  return {
    ok: true,
    invoices: detectInvoiceAnomalies(recognized, expectedBuyer),
    parseErrors,
    batchErrors,
    ...(batchErrors.length > 0 ? { error: batchErrors[0] } : {})
  }
}

function readParseErrors(raw: unknown): InvoiceParseError[] {
  if (!Array.isArray(raw)) return []
  return raw.map((entry) => {
    const rec = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    return {
      file: String(rec.file ?? rec.path ?? ''),
      error: friendlyFileError(resolveErrorMessage(rec, t('errUnknown')))
    }
  })
}

/**
 * 本次导出的输出目录：第一张发票所在目录下的 ZTools_Reimbursement_Export\报销归档_<时间>。
 * 每次导出用新目录，宿主写副本与 CSV 时不会覆盖上次导出的文件。
 */
export function buildExportOutputDir(firstInvoicePath: string, now: Date = new Date()): string {
  const p = String(firstInvoicePath || '').trim()
  const idx = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  if (idx <= 0) throw new Error(t('errCannotResolveDir', { path: p || t('emptyPathLabel') }))
  const sep = p[idx] as string
  const dir = p.slice(0, idx)
  const stamp =
    `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}_` +
    `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}_` +
    String(now.getMilliseconds()).padStart(3, '0')
  return `${dir}${sep}${EXPORT_ROOT_DIR_NAME}${sep}${t('exportDirPrefix')}_${stamp}`
}

export type InvoiceExportMode = 'bundle' | 'csv'

export interface InvoiceExportResult {
  ok: boolean
  outputDir: string
  /** 已复制的规范命名副本数 */
  copiedCount: number
  csvPath: string
  error?: string
}

/**
 * 导出报销材料：
 * - bundle：复制规范命名副本（BatchRenameInvoices）+ 生成报销明细 CSV（ExportInvoicesCsv）
 * - csv：只生成报销明细 CSV
 * 只接受字段完整、非重复的发票；按宿主返回的文件列表与路径确认结果，确认不了就报失败。
 */
export async function exportInvoices(
  mode: InvoiceExportMode,
  items: InvoiceRecordItem[],
  templateId: string,
  hostOverride?: unknown,
  now: Date = new Date()
): Promise<InvoiceExportResult> {
  const fail = (error: string, extra: Partial<InvoiceExportResult> = {}): InvoiceExportResult => ({
    ok: false,
    outputDir: '',
    copiedCount: 0,
    csvPath: '',
    error,
    ...extra
  })

  if (items.length === 0) return fail(t('errExportEmpty'))
  const incomplete = items.filter((i) => !isInvoiceComplete(i))
  if (incomplete.length > 0) {
    return fail(t('errExportIncomplete', { count: incomplete.length, file: incomplete[0]!.fileName }))
  }
  const duplicates = items.filter((i) => i.isDuplicate)
  if (duplicates.length > 0) {
    return fail(t('errExportDuplicate', { count: duplicates.length, file: duplicates[0]!.fileName }))
  }

  let outputDir: string
  try {
    outputDir = buildExportOutputDir(items[0]!.path, now)
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err))
  }

  const names = buildUniqueTargetNames(items, templateId)
  const params = {
    invoices: items.map((inv) => ({ ...inv, targetFileName: names.get(inv.id) as string })),
    files: items.map((inv) => inv.path),
    templateId,
    outputDir
  }

  let copiedCount = 0
  if (mode === 'bundle') {
    const copyRes = await invokeNativeCapability('BatchRenameInvoices', params, hostOverride)
    if (!copyRes.ok) {
      return fail(t('errCopyBundleFailed', { error: friendlyFileError(resolveErrorMessage(copyRes, t('errHostNoReason'))), dir: outputDir }), { outputDir })
    }
    const data = (copyRes.data ?? {}) as Record<string, unknown>
    const renamed = Array.isArray(data.renamedFiles) ? data.renamedFiles : null
    if (!renamed) {
      return fail(t('errHostNoCopiedFiles'), { outputDir })
    }
    copiedCount = renamed.length
    if (copiedCount !== items.length) {
      return fail(t('errPartialCopied', { copied: copiedCount, total: items.length }), { outputDir, copiedCount })
    }
  }

  const csvRes = await invokeNativeCapability('ExportInvoicesCsv', params, hostOverride)
  const copiedNote = copiedCount > 0 ? t('copiedNotePrefix', { count: copiedCount }) : ''
  if (!csvRes.ok) {
    return fail(t('errExportCsvFailed', { note: copiedNote, error: friendlyFileError(resolveErrorMessage(csvRes, t('errHostNoReason'))) }), { outputDir, copiedCount })
  }
  const csvData = (csvRes.data ?? {}) as Record<string, unknown>
  const csvPath = typeof csvData.csvOutputPath === 'string' ? csvData.csvOutputPath.trim() : ''
  if (!csvPath) {
    return fail(t('errHostNoCsvPath', { note: copiedNote }), { outputDir, copiedCount })
  }
  const hostOutDir = typeof csvData.outputDir === 'string' && csvData.outputDir.trim() ? csvData.outputDir.trim() : outputDir
  return { ok: true, outputDir: hostOutDir, copiedCount, csvPath }
}

export async function openInvoiceLocation(filePath: string, hostOverride?: unknown): Promise<boolean> {
  return showRealItemInFolder(filePath, hostOverride)
}

export async function trashInvoiceFile(
  filePath: string,
  hostOverride?: unknown
): Promise<{ ok: boolean; error?: string }> {
  if (!filePath || FORBIDDEN_TARGET_PATTERN.test(filePath)) {
    return { ok: false, error: getForbiddenReason() }
  }
  const res = await trashRealItem(filePath, hostOverride)
  return res.ok ? res : { ok: false, error: friendlyFileError(resolveErrorMessage(res, t('errTrashFailed'))) }
}
