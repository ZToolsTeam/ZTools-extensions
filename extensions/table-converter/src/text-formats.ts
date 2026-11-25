import { t } from './i18n.js'

export function parseDelimitedRows(text: string, delimiter: string): string[][] {
  if (!text.length) return []
  if (delimiter !== ',' && delimiter !== '\t') throw new Error(t('errDelimiterOnly'))
  const rows: string[][] = []
  let row: string[] = [], cell = '', state: 'start' | 'plain' | 'quoted' | 'closed' = 'start'
  let recordStarted = false
  const endCell = () => { row.push(cell); cell = ''; state = 'start' }
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (state === 'quoted') {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ } else state = 'closed'
      } else cell += char
    } else if (char === delimiter) { endCell(); recordStarted = true }
    else if (char === '\n' || char === '\r') {
      endCell(); rows.push(row); row = []; recordStarted = false
      if (char === '\r' && text[i + 1] === '\n') i++
    } else if (char === '"' && state === 'start') { state = 'quoted'; recordStarted = true }
    else {
      if (state === 'closed' || char === '"') throw new Error(t('errQuotedPosition'))
      cell += char; state = 'plain'; recordStarted = true
    }
  }
  if (state === 'quoted') throw new Error(t('errUnclosedQuote'))
  if (recordStarted) { endCell(); rows.push(row) }
  return rows
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z][\da-z]*);/gi, (_, entity: string) => {
    if (!entity.startsWith('#')) {
      if (!Object.hasOwn(named, entity)) throw new Error(t('errUnsupportedHtmlEntity'))
      return named[entity]!
    }
    const hex = entity[1]?.toLowerCase() === 'x', code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10)
    if (!code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw new Error(t('errInvalidHtmlEntity'))
    return String.fromCodePoint(code)
  })
}

/** 只接收一个结构完整的文字表格；无法无损展开的结构明确拒绝。 */
export function parseHtmlTable(text: string): string[][] {
  const rows: string[][] = [], stack: string[] = []
  let row: string[] | null = null, cell: string | null = null, tables = 0
  const wrappers = new Set(['thead', 'tbody', 'tfoot'])
  const inline = new Set(['b', 'strong', 'i', 'em', 'span', 'code', 'a', 'small', 'u', 's'])
  let consumed = 0
  for (const token of text.matchAll(/<!--[\s\S]*?-->|<(?:[^<>"']|"[^"]*"|'[^']*')*>|[^<]+/g)) {
    if (token.index !== consumed) throw new Error(t('errHtmlIncompleteTag'))
    const part = token[0]; consumed += part.length
    if (part.startsWith('<!--')) continue
    if (!part.startsWith('<')) {
      if (cell !== null) cell += decodeEntities(part)
      else if (part.trim()) throw new Error(t('errHtmlOutsideText'))
      continue
    }
    const tag = part.match(/^<(\/)?([a-z][a-z0-9]*)\b([\s\S]*)>$/i)
    if (!tag) throw new Error(t('errHtmlUnrecognizedTag'))
    const closing = !!tag[1], name = tag[2]!.toLowerCase(), attributes = tag[3]!
    if (/\b(?:rowspan|colspan)\s*=/i.test(attributes)) throw new Error(t('errHtmlMergedCells'))
    if (name === 'br' && !closing && cell !== null) { cell += '\n'; continue }
    if (closing) {
      if (stack.pop() !== name) throw new Error(t('errHtmlUnmatchedTag'))
      if (name === 'td' || name === 'th') { row!.push(cell!); cell = null }
      else if (name === 'tr') { rows.push(row!); row = null }
      continue
    }
    const parent = stack.at(-1)
    if (name === 'table') {
      if (parent || ++tables !== 1) throw new Error(t('errHtmlNestedTable'))
    } else if (wrappers.has(name)) {
      if (parent !== 'table') throw new Error(t('errHtmlInvalidGroup'))
    } else if (name === 'tr') {
      if (parent !== 'table' && !wrappers.has(parent ?? '')) throw new Error(t('errHtmlInvalidRow'))
      row = []
    } else if (name === 'td' || name === 'th') {
      if (parent !== 'tr') throw new Error(t('errHtmlInvalidCell'))
      cell = ''
    } else if (!inline.has(name) || cell === null) throw new Error(t('errHtmlUnsupportedTag'))
    stack.push(name)
  }
  if (consumed !== text.length || stack.length || tables !== 1) throw new Error(t('errHtmlIncompleteTable'))
  return rows
}

function markdownCells(line: string): string[] {
  const stripped = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '')
  const cells: string[] = []
  let cell = ''
  for (let i = 0; i < stripped.length; i++) {
    if (stripped[i] === '\\' && /[\\|]/.test(stripped[i + 1] ?? '')) cell += stripped[++i]
    else if (stripped[i] === '|') { cells.push(cell.trim()); cell = '' }
    else cell += stripped[i]
  }
  cells.push(cell.trim())
  return cells
}

export function parseMarkdownTable(text: string): string[][] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) throw new Error(t('errMdMissingSeparator'))
  const separator = markdownCells(lines[1]!)
  if (!separator.every(cell => /^:?-+:?$/.test(cell))) throw new Error(t('errMdInvalidSeparator'))
  const rows = lines.filter((_, i) => i !== 1).map(line => markdownCells(line).map(cell => decodeEntities(cell.replace(/<br\s*\/?\s*>/gi, '\n'))))
  if (separator.length !== rows[0]!.length) throw new Error(t('errMdColMismatch'))
  return rows
}

/** 可能被 GFM 扩展自动识别为链接 / 邮箱的写法（http://、www.、a@b.c、mailto: 等） */
const AUTOLINK_LIKE = /[a-z][a-z\d+.-]*:|www\.|@/i

export function markdownCell(text: string): string {
  // 格式语法字符总是转义；. : @ ( ) 只在单元格像网址或邮箱时转义，3.14、12:30 这类普通数据保持可读
  const pattern = AUTOLINK_LIKE.test(text) ? /[\\|`*_~\[\]():.@]/g : /[\\|`*_~\[\]]/g
  return escapeHtml(text).replace(pattern, char => `&#${char.codePointAt(0)};`)
    .replace(/\r/g, '&#13;').replace(/\n/g, '<br>')
    .replace(/^\s+|\s+$/g, spaces => Array.from(spaces, char => `&#${char.codePointAt(0)};`).join(''))
}
