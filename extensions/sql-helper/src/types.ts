export type SqlDialect = 'mysql' | 'postgresql' | 'sqlite'

export type SqlHelperTab = 'formatter' | 'mybatis' | 'ddl'

export interface FormattedSqlOutput {
  beautified: string
  minified: string
  charCount: number
  lineCount: number
}

export interface MyBatisParsedResult {
  isSuccess: boolean
  hasCountMismatch: boolean
  errorMessage?: string
  rawPreparing: string
  mergedSql: string
  beautifiedMergedSql: string
  paramCountDisplay: string
  placeholderCount: number
  params: Array<{
    value: string
    type: string
    injectedSqlPart: string
  }>
}

export interface DdlParsedColumn {
  name: string
  dbType: string
  nullable: boolean
  comment?: string
  unsigned?: boolean
}

export interface DdlParsedResult {
  isValid: boolean
  warningMessage?: string
  tableName: string
  columns: DdlParsedColumn[]
  warnings: string[]
  generatedCode: {
    typescript: string
    golang: string
    java: string
  }
}
