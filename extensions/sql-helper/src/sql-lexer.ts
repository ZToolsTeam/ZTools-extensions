import type { SqlDialect } from './types.js'

export interface SqlToken { kind: 'word' | 'quoted' | 'comment' | 'lineComment' | 'symbol'; text: string; start: number; end: number }
export function checkInput(input: string): void {
  if (new TextEncoder().encode(input).length > 256 * 1024) throw new Error('输入超过 256 KiB，请分段处理')
  if (/\u0000/.test(input)) throw new Error('输入包含 NUL 字符')
}

/** 只划分词法边界，不执行 SQL；方言决定引号、注释与转义规则。 */
export function tokenizeSql(input: string, dialect: SqlDialect = 'mysql'): SqlToken[] {
  checkInput(input)
  const tokens: SqlToken[] = []
  let i = 0, depth = 0
  while (i < input.length) {
    if (/[ \t\r\n\f]/.test(input[i]!)) { i++; continue }
    const start = i, ch = input[i]!
    let kind: SqlToken['kind'] = 'symbol'
    if ((input.startsWith('--', i) && (dialect !== 'mysql' || !input[i + 2] || input.charCodeAt(i + 2) <= 32 || input.charCodeAt(i + 2) === 127)) || (dialect === 'mysql' && ch === '#')) {
      kind = 'lineComment'
      while (i < input.length && !/[\r\n]/.test(input[i]!)) i++
    } else if (input.startsWith('/*', i)) {
      kind = 'comment'; i += 2
      let nesting = 1
      while (i < input.length && nesting) {
        if (dialect === 'postgresql' && input.startsWith('/*', i)) { nesting++; i += 2 }
        else if (input.startsWith('*/', i)) { nesting--; i += 2 }
        else i++
      }
      if (nesting) throw new Error('块注释未闭合')
    } else if (ch === "'" || ch === '"' || (ch === '`' && dialect !== 'postgresql') || (ch === '[' && dialect === 'sqlite')) {
      kind = 'quoted'
      const endQuote = ch === '[' ? ']' : ch
      const previous = tokens.at(-1)
      const backslash = (dialect === 'mysql' && ch !== '`') || (dialect === 'postgresql' && ch === "'" && previous?.end === start && /^e$/i.test(previous.text))
      i++; let closed = false
      while (i < input.length) {
        if (backslash && input[i] === '\\') { i += 2; continue }
        if (input[i] === endQuote) {
          if (ch !== '[' && input[i + 1] === endQuote) { i += 2; continue }
          i++; closed = true; break
        }
        i++
      }
      if (!closed) throw new Error('字符串或引用标识符未闭合')
    } else if (dialect === 'postgresql' && ch === '$' && input.slice(i).match(/^\$(?:[A-Za-z_][\w]*)?\$/)) {
      kind = 'quoted'
      const delimiter = input.slice(i).match(/^\$(?:[A-Za-z_][\w]*)?\$/)![0]
      const end = input.indexOf(delimiter, i + delimiter.length)
      if (end < 0) throw new Error('Dollar 引号字符串未闭合')
      i = end + delimiter.length
    } else if (/[\p{L}\p{N}_$]/u.test(ch)) {
      kind = 'word'; i++
      while (i < input.length && /[\p{L}\p{N}_$]/u.test(input[i]!)) i++
    } else {
      i++
      if (ch === '(' && ++depth > 64) throw new Error('括号嵌套超过 64 层')
      if (ch === ')' && --depth < 0) throw new Error('存在多余的右括号')
    }
    tokens.push({ kind, text: input.slice(start, i), start, end: i })
    if (tokens.length > 50000) throw new Error('SQL 过长，请分段处理')
  }
  if (depth) throw new Error('括号未闭合')
  return tokens
}

export function sqlIdentifier(token: SqlToken | undefined): string {
  if (!token) throw new Error('缺少标识符')
  if (token.kind === 'word' && !/^\d/.test(token.text)) return token.text
  if (token.kind === 'quoted' && /^[`"[]/.test(token.text)) {
    const delimiter = token.text[0] === '[' ? ']' : token.text[0]!
    return token.text.slice(1, -1).split(delimiter + delimiter).join(delimiter)
  }
  throw new Error(`无法识别标识符：${token.text}`)
}
