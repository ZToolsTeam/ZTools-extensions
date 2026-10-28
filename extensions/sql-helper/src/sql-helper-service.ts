import type { FormattedSqlOutput, MyBatisParsedResult, SqlDialect } from './types.js'
import { tokenizeSql, checkInput } from './sql-lexer.js'
export { parseDdlToEntities } from './ddl-service.js'

const CLAUSES = new Set(['FROM', 'WHERE', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'INTERSECT', 'EXCEPT', 'SET', 'VALUES', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'CROSS', 'FULL'])
/** 仅调整 token 间已有空白，绝不替换字符串、注释、标识符或操作符。 */
export function formatAndMinifySql(rawSql: string, dialect: SqlDialect = 'mysql'): FormattedSqlOutput {
  const tokens = tokenizeSql(rawSql, dialect)
  if (!tokens.some(t => t.kind !== 'comment' && t.kind !== 'lineComment')) throw new Error('请输入 SQL 语句')
  let beautified = '', minified = '', depth = 0
  for (const [i, token] of tokens.entries()) {
    const previous = tokens[i - 1], gap = previous ? rawSql.slice(previous.end, token.start) : ''
    // PostgreSQL 的相邻字符串仅在含换行的空白之间才自动拼接；行注释也必须保留换行。
    const needsNewline = previous?.kind === 'lineComment' || (dialect === 'postgresql' && /[\r\n]/.test(gap))
    const compactGap = needsNewline ? '\n' : gap ? ' ' : ''
    let prettyGap = compactGap
    const upper = token.kind === 'word' ? token.text.toUpperCase() : ''
    if (gap && (CLAUSES.has(upper) || (['ORDER', 'GROUP'].includes(upper) && tokens[i + 1]?.text.toUpperCase() === 'BY') || previous?.text === ';')) prettyGap = '\n' + '  '.repeat(depth)
    if (token.text === ')') depth--
    beautified += prettyGap + token.text
    minified += compactGap + token.text
    if (token.text === '(') depth++
  }
  return { beautified, minified, charCount: beautified.length, lineCount: beautified.split('\n').length }
}

const NUMERIC = new Set(['long', 'integer', 'int', 'short', 'byte', 'double', 'float', 'bigdecimal', 'biginteger', 'number'])
const TEXT = new Set(['string', 'character', 'char', 'uuid', 'date', 'time', 'timestamp', 'localdate', 'localtime', 'localdatetime', 'offsetdatetime', 'offsettime', 'instant'])
function parameter(part: string, dialect: SqlDialect): MyBatisParsedResult['params'][number] {
  if (part === 'null') return { value: 'null', type: 'Null', injectedSqlPart: 'NULL' }
  const match = part.match(/^([\s\S]*)\(([A-Za-z0-9_$.]+)\)$/)
  if (!match) throw new Error('参数缺少 (类型) 标记，或日志包含无法还原的换行')
  const value = match[1]!, type = match[2]!.split('.').at(-1)!, lower = type.toLowerCase()
  let injectedSqlPart: string
  if (NUMERIC.has(lower)) {
    if (/^(long|integer|int|short|byte|biginteger)$/.test(lower) && !/^[+-]?\d+$/.test(value)) throw new Error(`无效的 ${type} 整数`)
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) throw new Error(`无效的 ${type} 数值`)
    injectedSqlPart = value
  } else if (lower === 'boolean' || lower === 'bool') {
    if (!/^(true|false)$/i.test(value)) throw new Error('布尔参数只能是 true 或 false')
    injectedSqlPart = value.toUpperCase()
  } else if (TEXT.has(lower)) {
    const escaped = (dialect === 'mysql' ? value.replace(/\\/g, '\\\\') : value).replace(/'/g, "''")
    injectedSqlPart = `'${escaped}'`
  } else throw new Error(`不支持还原 ${type} 参数，请使用原始绑定参数`)
  return { value, type, injectedSqlPart }
}

/** MyBatis 文本日志没有转义协议，只生成核对参考，不宣称可无损还原绑定语义。 */
export function mergeMyBatisLog(rawLogText: string, dialect: SqlDialect = 'mysql'): MyBatisParsedResult {
  let params: MyBatisParsedResult['params'] = [], placeholderCount = 0, rawPreparing = '', hasCountMismatch = false
  try {
    checkInput(rawLogText)
    const records = rawLogText.replace(/\r\n/g, '\n').split('\n').filter(line => line.trim() !== '').map(line => line.match(/^(?:.*?==>\s*)?(Preparing|Parameters): ?(.*)$/i))
    if (records.some(record => !record) || records.length !== 2 || records[0]![1]!.toLowerCase() !== 'preparing' || records[1]![1]!.toLowerCase() !== 'parameters') throw new Error('请只载入同一次调用的一行 Preparing 和一行 Parameters，保留两行间的换行')
    rawPreparing = records[0]![2]!
    const rawParameters = records[1]![2]!
    const tokens = tokenizeSql(rawPreparing, dialect)
    const placeholders = tokens.filter(t => t.kind === 'symbol' && t.text === '?')
    placeholderCount = placeholders.length
    if (placeholderCount > 500) throw new Error('参数超过 500 项，请分段处理')
    if (tokens.some(t => t.kind === 'word' && /^(Preparing|Parameters)$/i.test(t.text))) throw new Error('日志标记混入 SQL，请保留完整的两行日志')
    if (dialect === 'postgresql') {
      for (const p of placeholders) {
        const index = tokens.indexOf(p), prev = tokens[index - 1]
        if (prev && !['(', ',', '=', '<', '>', '!', '+', '-', '*', '/', '%'].includes(prev.text) && !(prev.kind === 'word' && /^(SELECT|VALUES|WHEN|THEN|ELSE|AND|OR|NOT|LIMIT|OFFSET|BY|RETURNING)$/i.test(prev.text))) throw new Error('问号可能是 PostgreSQL 操作符，无法可靠识别绑定位置')
      }
    }
    const parts: string[] = []
    let start = 0
    for (let i = 0; i < rawParameters.length; i++) {
      if (rawParameters.startsWith(', ', i) && /(?:\([A-Za-z0-9_$.]{1,128}\)|(?:^|, )null)$/.test(rawParameters.slice(Math.max(start, i - 132), i))) { parts.push(rawParameters.slice(start, i)); start = i + 2; if (parts.length > 500) throw new Error('参数超过 500 项') }
    }
    if (rawParameters !== '') parts.push(rawParameters.slice(start))
    hasCountMismatch = parts.length !== placeholderCount
    if (hasCountMismatch) throw new Error(`参数数量不匹配或值含歧义：SQL 有 ${placeholderCount} 个占位符，日志有 ${parts.length} 项`)
    params = parts.map(part => parameter(part, dialect))
    let mergedSql = '', cursor = 0
    for (const [i, token] of placeholders.entries()) { mergedSql += rawPreparing.slice(cursor, token.start) + params[i]!.injectedSqlPart; cursor = token.end }
    mergedSql += rawPreparing.slice(cursor)
    const formatted = formatAndMinifySql(mergedSql, dialect)
    return { isSuccess: true, hasCountMismatch: false, rawPreparing, mergedSql, beautifiedMergedSql: formatted.beautified, placeholderCount, params, paramCountDisplay: `已匹配 ${params.length} 个参数；仅供核对，请勿直接执行未知 SQL` }
  } catch (error) {
    return { isSuccess: false, hasCountMismatch, errorMessage: error instanceof Error ? error.message : String(error), rawPreparing, mergedSql: '', beautifiedMergedSql: '', paramCountDisplay: '未生成结果', placeholderCount, params }
  }
}
