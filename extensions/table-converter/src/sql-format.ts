import { boundedJoin, cellValue, displayValue, makeGrid, parseJsonPreservingData } from './table-model.js'
import type { JsonValue, TableGrid } from './types.js'
import { t } from './i18n.js'

const identifierKey = (name: string) => name.replace(/[A-Z]/g, letter => letter.toLowerCase())

/** SQLite 字面量 INSERT 子集：只解析文本，从不执行 SQL。 */
export function parseSqlInsert(text: string): TableGrid {
  let position = 0
  const rest = () => text.slice(position)
  const skip = () => { position += rest().match(/^[ \t\r\n\f]*/)![0].length }
  const expect = (pattern: RegExp, message: string): string => {
    skip(); const match = rest().match(pattern)
    if (!match) throw new Error(t('errSqlSyntax', { msg: message }))
    position += match[0].length
    return match[0]
  }
  const punctuation = (char: string): boolean => { skip(); if (text[position] !== char) return false; position++; return true }
  const quoted = (quote: string): string => {
    position++; let value = ''
    while (position < text.length) {
      const char = text[position++]!
      if (char === quote) {
        if (text[position] === quote) { value += quote; position++ } else return value
      } else value += char
    }
    throw new Error(t('errSqlUnclosedQuote'))
  }
  const identifier = (): string => {
    skip(); const char = text[position]
    if (char === '"' || char === '`') return quoted(char)
    return expect(/^[a-z_][\w$]*/i, t('errSqlMissingTableOrCol'))
  }
  const literal = (): JsonValue => {
    skip()
    if (text[position] === "'") return quoted("'")
    const raw = expect(/^(?:NULL\b|TRUE\b|FALSE\b|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/i, t('errSqlUnsupportedExpr'))
    if (/^null$/i.test(raw)) return null
    if (/^(true|false)$/i.test(raw)) return raw.toLowerCase() === 'true'
    return parseJsonPreservingData(raw)
  }
  expect(/^INSERT[ \t\r\n\f]+INTO\b/i, t('errSqlMissingInsertInto'))
  identifier(); if (punctuation('.')) identifier()
  expect(/^\(/, t('errSqlMissingColumns'))
  const headers = [identifier()]
  while (punctuation(',')) headers.push(identifier())
  if (new Set(headers.map(identifierKey)).size !== headers.length) throw new Error(t('errSqlDuplicateCol'))
  expect(/^\)/, t('errSqlUnclosedCols')); expect(/^VALUES\b/i, t('errSqlMissingValues'))
  const values: JsonValue[][] = []
  do {
    expect(/^\(/, t('errSqlMissingRow'))
    const row = [literal()]
    while (punctuation(',')) row.push(literal())
    expect(/^\)/, t('errSqlUnclosedRow'))
    values.push(row)
  } while (punctuation(','))
  punctuation(';'); skip()
  if (position !== text.length) throw new Error(t('errSqlSingleStmtOnly'))
  const result = makeGrid(headers, values.map(row => row.map(displayValue)), values)
  return { ...result, headers, warnings: [] }
}

export function gridToSql(grid: TableGrid, tableName = 'my_table'): string {
  if (!grid.headers.length || !grid.rows.length) return ''
  if (new Set(grid.headers.map(identifierKey)).size !== grid.headers.length) throw new Error(t('errSqlCaseInsensitiveCol'))
  const quoteIdentifier = (name: string) => `"${name.replace(/"/g, '""')}"`
  if (!tableName || /\0/.test(tableName) || grid.headers.some(name => name.includes('\0'))) throw new Error(t('errSqlEmptyOrNulName'))
  function* tuples() {
    for (let r = 0; r < grid.rows.length; r++) {
      const row = grid.rows[r]!
    const cells = grid.headers.map((_, c) => {
      const value = cellValue(grid, r, c)
      if (value === null || value === undefined) return 'NULL'
      if (typeof value === 'number') return String(value)
      if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
      const text = typeof value === 'object' ? JSON.stringify(value) : row[c]!
      if (text.includes('\0')) throw new Error(t('errSqlNulText'))
      return `'${text.replace(/'/g, "''")}'`
    })
      yield `  (${cells.join(', ')})`
    }
  }
  return boundedJoin(tuples(), ',\n', `INSERT INTO ${quoteIdentifier(tableName)} (${grid.headers.map(quoteIdentifier).join(', ')})\nVALUES\n`, ';')
}
