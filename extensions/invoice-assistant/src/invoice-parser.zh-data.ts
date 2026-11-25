import type { InvoiceFieldKey, InvoiceRenameTemplate } from './logic.js'

/** 宿主 DLL 协议与本地分类使用的中文标准费用分类枚举（UI 展示统一经 translateCategory() 走 i18n） */
export const INVOICE_CATEGORIES = Object.freeze({
  DINING: '餐饮招待',
  TRANSIT: '交通出行',
  LODGING: '差旅住宿',
  OFFICE: '办公采购',
  OTHER: '其他费用'
} as const)

export type InvoiceCategoryType = (typeof INVOICE_CATEGORIES)[keyof typeof INVOICE_CATEGORIES]

/** 报销字段默认中文名称（UI 展示统一经 getInvoiceFieldLabel() 走 i18n） */
export const INVOICE_FIELD_LABELS: Record<InvoiceFieldKey, string> = {
  invoiceNo: '发票号码',
  issueDate: '开票日期',
  sellerName: '销售方',
  buyerName: '购买方',
  totalAmount: '价税合计',
  taxAmount: '税额'
}

/** 静态默认命名模板列表（UI 展示统一经 getInvoiceRenameTemplates() 走 i18n） */
export const INVOICE_RENAME_TEMPLATES: InvoiceRenameTemplate[] = [
  {
    id: 'tpl-standard',
    title: '模板 1: [分类]_[日期]_[销方]_[金额]元_[尾号]',
    patternDesc: '[餐饮招待]_2026-10-18_星巴克咖啡_68.00元_8921.pdf'
  },
  {
    id: 'tpl-date-first',
    title: '模板 2: [日期]_[分类]_[金额]元_[销方]',
    patternDesc: '2026-10-18_[餐饮招待]_68.00元_星巴克咖啡.pdf'
  },
  {
    id: 'tpl-amount-first',
    title: '模板 3: [分类]_[金额]元_[销方]_[尾号]',
    patternDesc: '[餐饮招待]_68.00元_星巴克咖啡_8921.pdf'
  },
  {
    id: 'tpl-tax-audit',
    title: '模板 4: [发票全号]_[日期]_[销方]_[金额]元',
    patternDesc: '24312000000048298921_2026-10-18_星巴克咖啡_68.00元.pdf'
  }
]

/** 静态默认分类分组列表（UI 展示统一经 getInvoiceCategoryGroups() 走 i18n） */
export const INVOICE_CATEGORY_GROUPS: Array<{ id: string; name: string }> = [
  { id: 'ALL', name: '全部电子发票' },
  { id: 'TRAVEL', name: '差旅 (交通出行 + 住宿)' },
  { id: INVOICE_CATEGORIES.TRANSIT, name: '交通出行 (滴滴/高铁/打车)' },
  { id: INVOICE_CATEGORIES.LODGING, name: '差旅住宿 (酒店/机票)' },
  { id: INVOICE_CATEGORIES.DINING, name: '餐饮招待 (餐饮/咖啡)' },
  { id: INVOICE_CATEGORIES.OFFICE, name: '办公采购与云服务' },
  { id: INVOICE_CATEGORIES.OTHER, name: '其他费用' }
]

export const EXPENSE_CATEGORY_CYCLE: InvoiceCategoryType[] = [
  INVOICE_CATEGORIES.DINING,
  INVOICE_CATEGORIES.TRANSIT,
  INVOICE_CATEGORIES.LODGING,
  INVOICE_CATEGORIES.OFFICE,
  INVOICE_CATEGORIES.OTHER
]

/** 宿主识别返回的中文分类别名与插件标准分类的对应关系 */
export const HOST_CATEGORY_ALIASES: Record<string, InvoiceCategoryType> = {
  差旅交通: INVOICE_CATEGORIES.TRANSIT,
  酒店住宿: INVOICE_CATEGORIES.LODGING,
  办公设备: INVOICE_CATEGORIES.OFFICE,
  技术与云服务: INVOICE_CATEGORIES.OFFICE
}

/** 宿主识别不到销售方 / 购买方时填入的中文占位文字，不能当作识别结果 */
export const PLACEHOLDER_PARTY_NAMES = new Set(['未知销售商户', '未知商户', '未知开票商户', '默认企业抬头'])

/** 中文增值税发票开票日期解析正则 */
export const ZH_ISSUE_DATE_REGEX = /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/

/** 个人 / 非企业购方抬头识别正则 */
export const ZH_PERSONAL_HEADER_REGEX = /个人|先生|女士|^[^一-龥]*$/

/** 本插件以前导出的中文汇总文件名，导入时跳过 */
export const EXPORTED_FILE_NAMES = /合并报销打印件|报销台账|报销发票明细汇总表|报销发票合并打印版/
