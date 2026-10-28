import type { DdlParsedColumn, DdlParsedResult, SqlDialect } from './types.js'
import { sqlIdentifier, tokenizeSql, type SqlToken } from './sql-lexer.js'

type TokenList = SqlToken[]
const upper = (t: SqlToken | undefined) => t?.kind === 'word' ? t.text.toUpperCase() : ''
function databaseName(token: SqlToken | undefined, dialect: SqlDialect): string {
  const name = sqlIdentifier(token)
  return dialect === 'postgresql' && token?.kind === 'word' ? name.replace(/[A-Z]/g, char => char.toLowerCase()) : name
}
function splitDefinitions(tokens: TokenList): TokenList[] {
  const result: TokenList[] = []; let depth = 0, start = 0
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    if (t.text === '(') depth++
    if (t.text === ')') depth--
    if (t.text === ',' && depth === 0) { result.push(tokens.slice(start, i)); start = i + 1 }
  }
  result.push(tokens.slice(start))
  if (result.some(part => !part.length)) throw new Error('列定义为空，或存在多余逗号')
  return result
}
function commentValue(token: SqlToken, dialect: SqlDialect): string {
  const quote = token.text[0]
  if (token.kind !== 'quoted' || (quote !== "'" && !(dialect === 'mysql' && quote === '"'))) throw new Error('COMMENT 后需要字符串')
  let value = token.text.slice(1, -1).split(quote + quote).join(quote)
  if (dialect === 'mysql') value = value.replace(/\\([\s\S])/g, (_, c: string) => ({ n: '\n', r: '\r', t: '\t', '0': '\0', b: '\b', Z: '\x1a' }[c] ?? c))
  return value
}
function readColumn(tokens: TokenList, dialect: SqlDialect): DdlParsedColumn {
  const name = databaseName(tokens[0], dialect)
  if (tokens[1]?.kind !== 'word') throw new Error(`字段 ${name} 缺少数据库类型`)
  let i = 2, dbType = upper(tokens[1])
  if (tokens[i]?.text === '(') {
    const begin = i++; let depth = 1
    while (i < tokens.length && depth) { if (tokens[i]!.text === '(') depth++; if (tokens[i]!.text === ')') depth--; i++ }
    if (depth || i === begin + 2) throw new Error(`字段 ${name} 类型参数不完整`)
    dbType += tokens.slice(begin, i).map(t => t.text).join('')
  }
  for (const phrase of [['DOUBLE', 'PRECISION'], ['CHARACTER', 'VARYING'], ['TIMESTAMP', 'WITH', 'TIME', 'ZONE'], ['TIMESTAMP', 'WITHOUT', 'TIME', 'ZONE'], ['TIME', 'WITH', 'TIME', 'ZONE'], ['TIME', 'WITHOUT', 'TIME', 'ZONE']]) {
    if (dbType === phrase[0] && phrase.slice(1).every((word, n) => upper(tokens[i + n]) === word)) { dbType = phrase.join(' '); i += phrase.length - 1; break }
  }
  if (tokens[i]?.text === '(') {
    const begin = i++; let depth = 1
    while (i < tokens.length && depth) { if (tokens[i]!.text === '(') depth++; if (tokens[i]!.text === ')') depth--; i++ }
    if (depth) throw new Error(`字段 ${name} 类型参数不完整`)
    dbType += tokens.slice(begin, i).map(t => t.text).join('')
  }
  if (dialect === 'postgresql' && ['WITH', 'WITHOUT'].includes(upper(tokens[i])) && upper(tokens[i + 1]) === 'TIME' && upper(tokens[i + 2]) === 'ZONE') { dbType += ' ' + tokens.slice(i, i + 3).map(upper).join(' '); i += 3 }
  while (tokens[i]?.text === '[' && tokens[i + 1]?.text === ']') { dbType += '[]'; i += 2 }
  let nullable = !((dialect === 'postgresql' && /^(SMALLSERIAL|SERIAL|BIGSERIAL)$/.test(dbType)) || (dialect === 'mysql' && dbType === 'SERIAL')), comment: string | undefined, unsigned = dialect === 'mysql' && dbType === 'SERIAL'
  const rest = tokens.slice(i)
  if (rest.length && !['NOT', 'NULL', 'DEFAULT', 'PRIMARY', 'UNIQUE', 'REFERENCES', 'CHECK', 'CONSTRAINT', 'COLLATE', 'COMMENT', 'AUTO_INCREMENT', 'AUTOINCREMENT', 'UNSIGNED', 'ZEROFILL', 'GENERATED', 'AS', 'CHARACTER'].includes(upper(rest[0]))) throw new Error(`字段 ${name} 存在无法识别的类型或属性：${rest[0]!.text}`)
  let level = 0
  for (let n = 0; n < rest.length; n++) {
    const token = rest[n]!
    if (token.text === '(') level++
    if (token.text === ')') level--
    if (level) continue
    const word = upper(token)
    if (word === 'NOT' && upper(rest[n + 1]) === 'NULL') nullable = false
    if (word === 'PRIMARY' && upper(rest[n + 1]) === 'KEY' && (dialect !== 'sqlite' || (dbType === 'INTEGER' && upper(rest[n + 2]) !== 'DESC'))) nullable = false
    if (word === 'UNSIGNED' || (dialect === 'mysql' && word === 'ZEROFILL')) unsigned = true
    if (word === 'COMMENT') {
      if (!rest[n + 1]) throw new Error(`字段 ${name} 缺少注释文本`)
      comment = commentValue(rest[++n]!, dialect)
    }
    if (word === 'DEFAULT' && !rest[n + 1]) throw new Error(`字段 ${name} 缺少默认值`)
  }
  return { name, dbType, nullable, comment, unsigned }
}
function extractColumns(text: string, dialect: SqlDialect): { tableName: string; columns: DdlParsedColumn[] } {
  const tokens = tokenizeSql(text, dialect).filter(t => t.kind !== 'comment' && t.kind !== 'lineComment')
  let i = 0
  const take = (word: string) => { if (upper(tokens[i++]) !== word) throw new Error(`需要 ${word} 建表语句`) }
  take('CREATE')
  if (['TEMP', 'TEMPORARY'].includes(upper(tokens[i]))) i++
  take('TABLE')
  if (upper(tokens[i]) === 'IF') { i++; take('NOT'); take('EXISTS') }
  let tableName = databaseName(tokens[i++], dialect)
  if (tokens[i]?.text === '.') { i++; tableName = databaseName(tokens[i++], dialect) }
  if (tokens[i++]?.text !== '(') throw new Error('需要 CREATE TABLE 的完整字段定义括号')
  const begin = i; let depth = 1
  while (i < tokens.length && depth) { if (tokens[i]!.text === '(') depth++; if (tokens[i]!.text === ')') depth--; i++ }
  if (depth) throw new Error('字段定义括号未闭合')
  const definitions = splitDefinitions(tokens.slice(begin, i - 1)), tail = tokens.slice(i)
  if (tail.some((t, n) => t.text === ';' && n !== tail.length - 1) || tail.some(t => ['CREATE', 'SELECT', 'INSERT', 'ALTER', 'DROP'].includes(upper(t)))) throw new Error('一次只处理一张表的 CREATE TABLE 语句')
  if (tail.length && tail[0]!.text !== ';' && !['ENGINE', 'DEFAULT', 'CHARSET', 'CHARACTER', 'COLLATE', 'COMMENT', 'AUTO_INCREMENT', 'WITHOUT', 'STRICT'].includes(upper(tail[0]))) throw new Error('无法识别表定义后的语句')
  const columns: DdlParsedColumn[] = [], primary: string[] = []
  for (const definition of definitions) {
    let d = definition
    if (upper(d[0]) === 'CONSTRAINT') { sqlIdentifier(d[1]); d = d.slice(2) }
    const keyword = upper(d[0])
    if (['PRIMARY', 'FOREIGN', 'UNIQUE', 'CHECK', 'KEY', 'INDEX', 'FULLTEXT', 'SPATIAL'].includes(keyword)) {
      if (!d.some(t => t.text === '(')) throw new Error('表级约束不完整')
      if (keyword === 'PRIMARY') {
        if (upper(d[1]) !== 'KEY' || d[2]?.text !== '(' || d.at(-1)?.text !== ')') throw new Error('主键约束无法识别')
        primary.push(...splitDefinitions(d.slice(3, -1)).map(part => { if (part.length !== 1) throw new Error('主键字段定义无法识别'); return databaseName(part[0], dialect) }))
      }
      continue
    }
    columns.push(readColumn(definition, dialect))
  }
  if (!columns.length || columns.length > 1000) throw new Error('需要 1 至 1000 个字段')
  if (new Set(columns.map(c => c.name)).size !== columns.length) throw new Error('存在重复字段名')
  for (const name of primary) {
    const col = columns.find(c => c.name === name)
    if (!col) throw new Error(`主键字段 ${name} 不存在`)
    if (dialect !== 'sqlite' || primary.length === 1 && col.dbType === 'INTEGER' || tail.some(t => ['WITHOUT', 'STRICT'].includes(upper(t)))) col.nullable = false
  }
  if (dialect === 'sqlite' && tail.some(t => ['WITHOUT', 'STRICT'].includes(upper(t)))) {
    for (const definition of definitions) {
      if (definition.some((t, n) => upper(t) === 'PRIMARY' && upper(definition[n + 1]) === 'KEY') && !['PRIMARY', 'CONSTRAINT'].includes(upper(definition[0]))) {
        const col = columns.find(c => c.name === databaseName(definition[0], dialect))
        if (col) col.nullable = false
      }
    }
  }
  return { tableName, columns }
}

function types(column: DdlParsedColumn, dialect: SqlDialect): { ts: string; go: string; java: string; known: boolean } {
  const type = column.dbType.toUpperCase(), base = type.split(/[ (]/)[0]!
  if (type.endsWith('[]')) return { ts: 'unknown', go: 'string', java: 'Object', known: false }
  if (/^(DECIMAL|NUMERIC|NUMBER|MONEY)$/.test(base)) return { ts: 'string', go: 'string', java: 'BigDecimal', known: true }
  if (/^(BIGINT|BIGSERIAL|INT8)$/.test(base) || (dialect === 'mysql' && base === 'SERIAL')) return { ts: 'string', go: column.unsigned ? 'uint64' : 'int64', java: column.unsigned ? 'BigInteger' : 'Long', known: true }
  if (/^(BOOL|BOOLEAN)$/.test(base) && dialect !== 'mysql') return { ts: 'boolean', go: 'bool', java: 'Boolean', known: true }
  if (/^(INT|INTEGER|SMALLINT|TINYINT|MEDIUMINT|SERIAL|SMALLSERIAL|INT2|INT4|BOOL|BOOLEAN)$/.test(base)) return { ts: dialect === 'sqlite' ? 'string' : 'number', go: column.unsigned ? 'uint64' : 'int64', java: column.unsigned || dialect === 'sqlite' ? 'Long' : 'Integer', known: true }
  if (/^(FLOAT|REAL|DOUBLE)$/.test(base)) return { ts: 'number', go: 'float64', java: 'Double', known: true }
  if (dialect === 'mysql' && base === 'TIME') return { ts: 'string', go: 'string', java: 'String', known: true }
  if (/^(TIMESTAMP|TIMESTAMPTZ|DATETIME|DATE|TIME|TIMETZ)$/.test(base)) return { ts: 'string', go: 'time.Time', java: base === 'DATE' ? 'LocalDate' : /TIME ZONE/.test(type) && !/WITHOUT/.test(type) || /^(TIMESTAMPTZ|TIMETZ)$/.test(base) ? (base.startsWith('TIMESTAMP') ? 'OffsetDateTime' : 'OffsetTime') : /^(TIME|TIMETZ)$/.test(base) ? 'LocalTime' : 'LocalDateTime', known: true }
  if (/^(JSON|JSONB)$/.test(base)) return { ts: 'unknown', go: 'json.RawMessage', java: 'Object', known: true }
  if (/^(BLOB|TINYBLOB|MEDIUMBLOB|LONGBLOB|BINARY|VARBINARY|BYTEA)$/.test(base)) return { ts: 'Uint8Array', go: '[]byte', java: 'byte[]', known: true }
  const known = /^(CHAR|CHARACTER|VARCHAR|NVARCHAR|NCHAR|TEXT|TINYTEXT|MEDIUMTEXT|LONGTEXT|CLOB|UUID|ENUM|SET)$/.test(base)
  return { ts: known ? 'string' : 'unknown', go: 'string', java: known ? 'String' : 'Object', known }
}
function identifier(name: string, pascal: boolean): string {
  const parts = name.replace(/[^A-Za-z0-9_]/g, '_').split('_').filter(Boolean)
  let value = parts.map((p, n) => n || pascal ? p[0]!.toUpperCase() + p.slice(1) : p[0]!.toLowerCase() + p.slice(1)).join('') || 'Field'
  if (/^\d/.test(value)) value = `Field${value}`
  return value
}
const JAVA_RESERVED = new Set('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var record yield sealed permits'.split(' '))
function safeComment(text: string): string { return text.replace(/[\r\n\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\\/g, '/').replace(/\*\//g, '* /') }
function generate(tableName: string, columns: DdlParsedColumn[], dialect: SqlDialect): Pick<DdlParsedResult, 'generatedCode' | 'warnings'> {
  const model = identifier(tableName.replace(/^(?:t_|tb_)/i, ''), true) + 'Model'
  const warnings = ['生成结果是字段模型骨架；请按数据库驱动核对日期、JSON、枚举和类型转换。精确小数使用字符串或 BigDecimal。']
  const ts = [`export interface ${model} {`], go: string[] = [], java: string[] = [], goImports = new Set<string>(), javaImports = new Set<string>()
  const goNames = new Set<string>(), javaNames = new Set<string>()
  for (const [n, col] of columns.entries()) {
    const mapped = types(col, dialect)
    if (!mapped.known) warnings.push(`字段 ${col.name} 的类型 ${col.dbType} 未内置映射，已使用通用类型，请手动确认。`)
    const comment = safeComment(`${col.name}: ${col.dbType}${col.comment ? ' — ' + col.comment : ''}`)
    ts.push(`  // ${comment}`, `  ${JSON.stringify(col.name)}: ${mapped.ts}${col.nullable && mapped.ts !== 'unknown' ? ' | null' : ''};`)
    let goName = identifier(col.name, true), javaName = identifier(col.name, false)
    if (goNames.has(goName)) goName += `Field${n + 1}`
    while (goNames.has(goName)) goName += '_'
    if (JAVA_RESERVED.has(javaName)) javaName += 'Field'
    if (javaNames.has(javaName)) javaName += `Field${n + 1}`
    while (javaNames.has(javaName)) javaName += '_'
    goNames.add(goName); javaNames.add(javaName)
    if (mapped.go.startsWith('time.')) goImports.add('time')
    if (mapped.go.startsWith('json.')) goImports.add('encoding/json')
    const validJsonName = [...col.name].every(char => /[\p{L}\p{Nd}]/u.test(char) || '!#$%&()*+-./:<=>?@[]^_{|}~ '.includes(char))
    if (!col.name || !validJsonName || col.name === '-' || /[;\\]/.test(col.name)) throw new Error(`字段 ${col.name} 无法安全表达为 Go JSON/GORM 标签，请为此字段提供不含逗号、分号、引号或反斜杠的别名`)
    const tags = `json:${JSON.stringify(col.name)} gorm:${JSON.stringify('column:' + col.name)}`
    go.push(`  // ${comment}`, `  ${goName} ${col.nullable ? '*' : ''}${mapped.go} ${JSON.stringify(tags)}`)
    if (['BigInteger', 'BigDecimal'].includes(mapped.java)) javaImports.add(`java.math.${mapped.java}`)
    if (/^(Local|Offset)/.test(mapped.java)) javaImports.add(`java.time.${mapped.java}`)
    java.push(`  // ${comment}`, `  public ${mapped.java} ${javaName};`)
  }
  ts.push('}')
  return { warnings, generatedCode: {
    typescript: ts.join('\n'),
    golang: ['package models', '', ...[...goImports].sort().map(p => `import ${JSON.stringify(p)}`), '', `type ${model} struct {`, ...go, '}'].join('\n'),
    java: [...[...javaImports].sort().map(p => `import ${p};`), '', `public class ${model} {`, ...java, '}'].join('\n'),
  } }
}
export function parseDdlToEntities(rawDdl: string, dialect: SqlDialect = 'mysql'): DdlParsedResult {
  try {
    const parsed = extractColumns(rawDdl, dialect)
    return { isValid: true, ...parsed, ...generate(parsed.tableName, parsed.columns, dialect) }
  } catch (error) {
    return { isValid: false, warningMessage: error instanceof Error ? error.message : String(error), tableName: '', columns: [], warnings: [], generatedCode: { typescript: '', golang: '', java: '' } }
  }
}
