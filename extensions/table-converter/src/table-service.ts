import type { DetectedSourceFormat, SourceFormat, TableConversionTarget, TableGrid, JsonValue } from './types.js'
import { boundedJoin, cellValue, jsonGrid, makeGrid, matrixGrid } from './table-model.js'
import { parseDelimitedRows, parseHtmlTable, parseMarkdownTable, markdownCell, escapeHtml } from './text-formats.js'
import { parseSqlInsert, gridToSql } from './sql-format.js'
export { parseDelimitedRows, gridToSql }

export function detectAndParse(rawText: string, hasHeader = true, source: SourceFormat = 'auto'): { format: DetectedSourceFormat; grid: TableGrid } {
  if (rawText.length > 2_000_000) throw new Error('单次输入最多 200 万字符，请拆分后转换。')
  const text = rawText.replace(/^\uFEFF/, ''), trimmed = text.trim()
  if (!text.length) return { format: 'empty', grid: makeGrid([], []) }
  let format: Exclude<DetectedSourceFormat, 'empty' | 'unrecognized'>
  if (source !== 'auto') format = source
  else if (/^[\[{]/.test(trimmed)) format = 'json'
  else if (/^INSERT\b/i.test(trimmed)) format = 'sql'
  else if (/^<(?:table\b|!--)/i.test(trimmed)) format = 'html'
  // GFM 分隔行：每格至少一个 -，可带 : 对齐标记（|-|-|、|:-:|--:|、--- | --- 均合法）
  else if (/^[ \t]*\|?(?:[ \t]*:?-+:?[ \t]*\|)+(?:[ \t]*:?-+:?[ \t]*)?$/m.test(text)) format = 'markdown'
  else {
    // 仅统计首条记录引号外的分隔符，避免把 CSV 单元格内的制表符识别成 TSV。
    let quoted = false, tabs = 0, commas = 0
    for (let i = 0; i < text.length; i++) {
      const char = text[i]
      if (char === '"') {
        if (quoted && text[i + 1] === '"') i++
        else quoted = !quoted
      } else if (!quoted) {
        if (char === '\r' || char === '\n') break
        if (char === '\t') tabs++
        if (char === ',') commas++
      }
    }
    // 自动识别时，单行且没有任何分隔符的普通文本不是表格，交给界面给出中性引导而不是“0 行 × 1 列”。
    if (trimmed && !tabs && !commas && !/[\r\n]/.test(trimmed)) return { format: 'unrecognized', grid: makeGrid([], []) }
    format = tabs > commas ? 'tsv' : 'csv'
  }
  const grid = format === 'json' ? jsonGrid(trimmed, hasHeader)
    : format === 'sql' ? parseSqlInsert(text)
    : matrixGrid(format === 'html' ? parseHtmlTable(trimmed) : format === 'markdown' ? parseMarkdownTable(trimmed)
      : parseDelimitedRows(text, format === 'tsv' ? '\t' : ','), hasHeader)
  return { format, grid }
}

export function gridToJson(grid: TableGrid): string {
  if (!grid.rows.length) return '[]'
  function* rows() {
    for (let r = 0; r < grid.rows.length; r++) {
      const item: Record<string, JsonValue | undefined> = Object.create(null)
      grid.headers.forEach((name, c) => { item[name] = cellValue(grid, r, c) })
      yield JSON.stringify(item, null, 2).replace(/^/gm, '  ')
    }
  }
  return boundedJoin(rows(), ',\n', '[\n', '\n]')
}

export function gridToMarkdown(grid: TableGrid): string {
  if (!grid.headers.length) return ''
  const rows = [grid.headers, ...grid.rows].map(row => row.map(markdownCell))
  const widths = grid.headers.map((_, c) => rows.reduce((size, row) => Math.max(size, Math.min(80, row[c]!.length)), grid.inferredTypes[c] === 'number' ? 4 : 3))
  const formatRow = (cells: string[]) => '| ' + cells.map((cell, i) => cell.padEnd(widths[i]!, ' ')).join(' | ') + ' |'
  const separator = widths.map((width, c) => grid.inferredTypes[c] === 'number' ? '-'.repeat(width - 1) + ':' : '-'.repeat(width))
  function* lines() {
    yield formatRow(rows[0]!); yield formatRow(separator)
    for (let i = 1; i < rows.length; i++) yield formatRow(rows[i]!)
  }
  return boundedJoin(lines(), '\n')
}

export function gridToHtml(grid: TableGrid): string {
  if (!grid.headers.length) return ''
  const header = grid.headers.map(name => `<th>${escapeHtml(name)}</th>`).join('')
  function* rows() {
    for (const row of grid.rows) yield `    <tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`
  }
  return boundedJoin(rows(), '\n', `<table>\n  <thead><tr>${header}</tr></thead>\n  <tbody>\n`, '\n  </tbody>\n</table>')
}

export function gridToCsv(grid: TableGrid): string {
  if (!grid.headers.length) return ''
  const encode = (text: string) => /[,"\r\n]/.test(text) || text === '' ? `"${text.replace(/"/g, '""')}"` : text
  function* rows() {
    yield grid.headers.map(encode).join(',')
    for (const row of grid.rows) yield row.map(encode).join(',')
  }
  return boundedJoin(rows(), '\r\n')
}

export function fencedPreview(content: string, language: string): string {
  const normalized = content.replace(/\r\n?/g, '\n')
  let size = 3
  for (const run of normalized.matchAll(/`+/g)) size = Math.max(size, run[0].length + 1)
  const fence = '`'.repeat(size)
  return `${fence}${language}\n${normalized}\n${fence}`
}

export function buildAllConversionTargets(grid: TableGrid, sqlTableName = 'my_table'): TableConversionTarget[] {
  const typeSummary = grid.headers.map((h, i) => `${h}: ${grid.inferredTypes[i]}`).join(' · ')
  const specs = [
    ['markdown', 'Markdown 对齐表格', '文字表格；嵌套值转为 JSON 文本', '文档', () => gridToMarkdown(grid)],
    ['json', 'JSON 结构化对象数组', '保留 JSON 原类型；文本列仅推断可安全转换的数字和布尔值', '结构数据', () => gridToJson(grid)],
    ['sql', `SQLite INSERT 语句（${sqlTableName}）`, 'SQLite 字面量语法；嵌套值转为 JSON 文本，缺失键映射 NULL', 'SQLite', () => {
      if (grid.headers.length && !grid.rows.length) throw new Error('没有数据行，无法生成 INSERT 语句。首行已作为表头时，请补充数据行或切换为“无表头”。')
      return gridToSql(grid, sqlTableName)
    }],
    ['html', 'HTML 表格源码', '文字表格；单元格内容转义后输出', '网页', () => gridToHtml(grid)],
    ['csv', 'CSV 表格', 'CRLF 分行；null 与缺失键输出为空单元格，嵌套值为 JSON 文本', '表格文本', () => gridToCsv(grid)]
  ] as const
  return specs.map<TableConversionTarget>(([id, title, subtitle, badge, convert]) => {
    const base = { id, title, subtitle, badge, language: id, typeSummary }
    try {
      const fullText = convert(), lines = fullText.split(/\r?\n/)
      const clipped = lines.length > 100 || fullText.length > 30_000
      const previewText = clipped ? lines.slice(0, 100).join('\n').slice(0, 30_000) + '\n（预览已截断，复制包含完整结果）' : fullText
      return { ...base, fullText, previewText }
    } catch (error) {
      return { ...base, fullText: '', previewText: '', error: error instanceof Error ? error.message : String(error) }
    }
  }).filter(target => target.fullText || target.error)
}
