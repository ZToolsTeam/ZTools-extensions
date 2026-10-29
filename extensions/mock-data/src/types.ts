export type MockDataTab = 'single' | 'batch'

export interface MockSingleItem {
  id: string
  fieldKey: string
  label: string
  value: string
  category: string
  standard: string
  formatType: string
  breakdownMarkdown: string
  algorithmNote: string
  /** 是否带有可计算的校验位；手机号、姓名等只保证格式 */
  hasCheckDigit: boolean
  /** 「复制键值对 JSON」的内容；缺省为 { [fieldKey]: value } */
  jsonValue?: Record<string, string>
}

export interface MockUserRecord {
  id: string
  name: string
  gender: '男' | '女'
  age: number
  idCard: string
  phone: string
  email: string
  companyName: string
  creditCode: string
  bankCard: string
  address: string
  createdAt: string
}
