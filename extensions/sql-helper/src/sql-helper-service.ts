import { t } from './i18n.js'
import type { FormattedSqlOutput, MyBatisParsedResult, SqlDialect } from './types.js'
import { tokenizeSql, checkInput, type SqlToken } from './sql-lexer.js'
export { parseDdlToEntities } from './ddl-service.js'

const CLAUSES = new Set(['FROM', 'WHERE', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'INTERSECT', 'EXCEPT', 'SET', 'VALUES', 'JOIN'])
const JOIN_MODIFIERS = new Set(['LEFT', 'RIGHT', 'INNER', 'CROSS', 'FULL', 'NATURAL', 'OUTER'])
const wordOf = (token: SqlToken | undefined) => token?.kind === 'word' ? token.text.toUpperCase() : ''

/**
 * 该词是否开始一个新子句：LEFT / INNER / FULL OUTER 等连接修饰词与 JOIN 作为整体换一次行，
 * LEFT(name, 3)、RIGHT(...) 这类同名函数与 CHARACTER SET 不换行。
 */
function startsClause(tokens: SqlToken[], i: number): boolean {
  const upper = wordOf(tokens[i]), previous = wordOf(tokens[i - 1])
  if (!upper) return false
  if (upper === 'JOIN') return !JOIN_MODIFIERS.has(previous)
  if (JOIN_MODIFIERS.has(upper)) {
    if (upper === 'OUTER' || JOIN_MODIFIERS.has(previous)) return false
    let j = i + 1
    while (JOIN_MODIFIERS.has(wordOf(tokens[j]))) j++
    return wordOf(tokens[j]) === 'JOIN'
  }
  if (upper === 'SET') return previous !== 'CHARACTER'
  if (upper === 'ORDER' || upper === 'GROUP') return wordOf(tokens[i + 1]) === 'BY'
  return CLAUSES.has(upper)
}
/** 仅调整 token 间已有空白，绝不替换字符串、注释、标识符或操作符。 */
export function formatAndMinifySql(rawSql: string, dialect: SqlDialect = 'mysql'): FormattedSqlOutput {
  const tokens = tokenizeSql(rawSql, dialect)
  if (!tokens.some(t => t.kind !== 'comment' && t.kind !== 'lineComment')) throw new Error(t('enterSqlStatement'))
  let beautified = '', minified = '', depth = 0
  for (const [i, token] of tokens.entries()) {
    const previous = tokens[i - 1], gap = previous ? rawSql.slice(previous.end, token.start) : ''
    // PostgreSQL 的相邻字符串仅在含换行的空白之间才自动拼接；行注释也必须保留换行。
    const needsNewline = previous?.kind === 'lineComment' || (dialect === 'postgresql' && /[\r\n]/.test(gap))
    const compactGap = needsNewline ? '\n' : gap ? ' ' : ''
    let prettyGap = compactGap
    if (gap && (startsClause(tokens, i) || previous?.text === ';')) prettyGap = '\n' + '  '.repeat(depth)
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
  if (!match) throw new Error(t('missingTypeTag'))
  const value = match[1]!, type = match[2]!.split('.').at(-1)!, lower = type.toLowerCase()
  let injectedSqlPart: string
  if (NUMERIC.has(lower)) {
    if (/^(long|integer|int|short|byte|biginteger)$/.test(lower) && !/^[+-]?\d+$/.test(value)) throw new Error(t('invalidIntParam', { type }))
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) throw new Error(t('invalidNumParam', { type }))
    injectedSqlPart = value
  } else if (lower === 'boolean' || lower === 'bool') {
    if (!/^(true|false)$/i.test(value)) throw new Error(t('invalidBoolParam'))
    injectedSqlPart = value.toUpperCase()
  } else if (TEXT.has(lower)) {
    const escaped = (dialect === 'mysql' ? value.replace(/\\/g, '\\\\') : value).replace(/'/g, "''")
    injectedSqlPart = `'${escaped}'`
  } else throw new Error(t('unsupportedParamType', { type }))
  return { value, type, injectedSqlPart }
}

/** MyBatis 文本日志没有转义协议，只生成核对参考，不宣称可无损还原绑定语义。 */
export function mergeMyBatisLog(rawLogText: string, dialect: SqlDialect = 'mysql'): MyBatisParsedResult {
  let params: MyBatisParsedResult['params'] = [], placeholderCount = 0, rawPreparing = '', hasCountMismatch = false
  try {
    checkInput(rawLogText)
    const records = rawLogText.replace(/\r\n/g, '\n').split('\n').filter(line => line.trim() !== '').map(line => line.match(/^(?:.*?==>\s*)?(Preparing|Parameters): ?(.*)$/i))
    if (records.some(record => !record) || records.length !== 2 || records[0]![1]!.toLowerCase() !== 'preparing' || records[1]![1]!.toLowerCase() !== 'parameters') throw new Error(t('mybatisTwoLinesRequired'))
    rawPreparing = records[0]![2]!
    const rawParameters = records[1]![2]!
    const tokens = tokenizeSql(rawPreparing, dialect)
    const placeholders = tokens.filter(t => t.kind === 'symbol' && t.text === '?')
    placeholderCount = placeholders.length
    if (placeholderCount > 500) throw new Error(t('tooManyParams500'))
    if (tokens.some(t => t.kind === 'word' && /^(Preparing|Parameters)$/i.test(t.text))) throw new Error(t('logMarkersInSql'))
    if (dialect === 'postgresql') {
      for (const p of placeholders) {
        const index = tokens.indexOf(p), prev = tokens[index - 1]
        if (prev && !['(', ',', '=', '<', '>', '!', '+', '-', '*', '/', '%'].includes(prev.text) && !(prev.kind === 'word' && /^(SELECT|VALUES|WHEN|THEN|ELSE|AND|OR|NOT|LIMIT|OFFSET|BY|RETURNING)$/i.test(prev.text))) throw new Error(t('pgQuestionMarkOperator'))
      }
    }
    const parts: string[] = []
    let start = 0
    for (let i = 0; i < rawParameters.length; i++) {
      if (rawParameters.startsWith(', ', i) && /(?:\([A-Za-z0-9_$.]{1,128}\)|(?:^|, )null)$/.test(rawParameters.slice(Math.max(start, i - 132), i))) { parts.push(rawParameters.slice(start, i)); start = i + 2; if (parts.length > 500) throw new Error(t('tooManyParams')) }
    }
    if (rawParameters !== '') parts.push(rawParameters.slice(start))
    hasCountMismatch = parts.length !== placeholderCount
    if (hasCountMismatch) throw new Error(t('paramCountMismatch', { placeholders: placeholderCount, parts: parts.length }))
    params = parts.map(part => parameter(part, dialect))
    let mergedSql = '', cursor = 0
    for (const [i, token] of placeholders.entries()) { mergedSql += rawPreparing.slice(cursor, token.start) + params[i]!.injectedSqlPart; cursor = token.end }
    mergedSql += rawPreparing.slice(cursor)
    const formatted = formatAndMinifySql(mergedSql, dialect)
    return { isSuccess: true, hasCountMismatch: false, rawPreparing, mergedSql, beautifiedMergedSql: formatted.beautified, placeholderCount, params, paramCountDisplay: t('paramMatchedSummary', { count: params.length }) }
  } catch (error) {
    return { isSuccess: false, hasCountMismatch, errorMessage: error instanceof Error ? error.message : String(error), rawPreparing, mergedSql: '', beautifiedMergedSql: '', paramCountDisplay: t('noResultGenerated'), placeholderCount, params }
  }
}
