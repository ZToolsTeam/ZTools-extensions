export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
export type InferredColumnType = 'number' | 'boolean' | 'string' | 'null' | 'json' | 'mixed'
export type DetectedSourceFormat = 'tsv' | 'csv' | 'json' | 'markdown' | 'html' | 'sql' | 'empty' | 'unrecognized'
export type SourceFormat = Exclude<DetectedSourceFormat, 'empty' | 'unrecognized'> | 'auto'

export interface TableGrid {
  headers: string[]
  rows: string[][]
  inferredTypes: InferredColumnType[]
  /** JSON / SQL 的原始类型；undefined 表示原对象缺少此键。 */
  values?: (JsonValue | undefined)[][]
  warnings?: string[]
}

export interface TableConversionTarget {
  id: 'markdown' | 'json' | 'sql' | 'html' | 'csv'
  title: string
  subtitle: string
  badge: string
  language: string
  fullText: string
  previewText: string
  typeSummary: string
  error?: string
}
