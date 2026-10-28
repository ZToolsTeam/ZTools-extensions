import type { InferredColumnType, JsonValue, TableGrid } from './types.js'

export function safeTextNumber(text: string): boolean {
  const value = Number(text)
  return /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) && Number.isFinite(value)
    && (!Number.isInteger(value) || Number.isSafeInteger(value)) && String(value) === text
}

function decimalSignature(text: string): string {
  const [mantissa, exponent = '0'] = text.toLowerCase().split('e')
  const [integer, fraction = ''] = mantissa!.split('.')
  let digits = (integer! + fraction).replace(/^-/, '').replace(/^0+/, '')
  if (!digits) return '0'
  let scale = Number(exponent) - fraction.length
  while (digits.endsWith('0')) { digits = digits.slice(0, -1); scale++ }
  return `${text.startsWith('-') ? '-' : ''}${digits}e${scale}`
}

/** 先由原生解析器校验语法，再检查会被 JSON.parse 静默丢失的信息。 */
export function parseJsonPreservingData(text: string): JsonValue {
  const parsed = JSON.parse(text) as JsonValue
  const keys: Set<string>[] = []
  for (const token of text.matchAll(/"(?:\\[\s\S]|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}]/g)) {
    const raw = token[0]
    if (raw === '{') keys.push(new Set())
    else if (raw === '}') keys.pop()
    else if (raw.startsWith('"')) {
      if (/^\s*:/.test(text.slice(token.index! + raw.length))) {
        const name = JSON.parse(raw) as string, current = keys[keys.length - 1]!
        if (current.has(name)) throw new Error('JSON 存在重复键，请先改为不同名称，避免覆盖数据。')
        current.add(name)
      }
    } else {
      const number = Number(raw)
      if (!Number.isFinite(number) || (Number.isInteger(number) && !Number.isSafeInteger(number))
        || Object.is(number, -0) || decimalSignature(raw) !== decimalSignature(String(number))) {
        throw new Error('JSON 数字超出可安全转换的精度，请将长数字或精确小数加双引号作为字符串。')
      }
    }
  }
  return parsed
}

export function displayValue(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return ''
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

function uniqueHeaders(input: string[]): { headers: string[]; warnings: string[] } {
  const reserved = new Set(input), used = new Set<string>()
  const headers = input.map((raw, index) => {
    const base = raw || `col_${index + 1}`
    let name = base, suffix = 2
    while (used.has(name) || (!raw && reserved.has(name))) name = `${base}_${suffix++}`
    if (used.has(base)) {
      while (reserved.has(name) || used.has(name)) name = `${base}_${suffix++}`
    }
    used.add(name)
    return name
  })
  return { headers, warnings: headers.some((h, i) => h !== input[i]) ? ['空表头或重名表头已自动命名；所有列均保留。'] : [] }
}

export function assertGridSize(columns: number, rows: number): void {
  if (columns > 1000 || rows > 50_000 || columns * rows > 200_000) throw new Error('单次最多 1000 列、5 万行、20 万个单元格，请拆分后转换。')
}

export function makeGrid(headers: string[], rows: string[][], values?: (JsonValue | undefined)[][]): TableGrid {
  assertGridSize(headers.length, rows.length)
  for (const row of rows) if (row.length !== headers.length) throw new Error('各行列数不一致，请检查分隔符、引号或缺少的单元格。')
  const inferredTypes = headers.map((_, i): InferredColumnType => {
    if (values) {
      const kinds = new Set(values.map(row => row[i] === null ? 'null' : typeof row[i] === 'object' ? 'json' : typeof row[i]).filter(t => t !== 'undefined'))
      return kinds.size === 1 ? [...kinds][0] as InferredColumnType : 'mixed'
    }
    const column = rows.map(row => row[i]!)
    if (column.length && column.every(safeTextNumber)) return 'number'
    if (column.length && column.every(v => /^(true|false)$/.test(v))) return 'boolean'
    return 'string'
  })
  return { ...uniqueHeaders(headers), rows, inferredTypes, ...(values ? { values } : {}) }
}

export function matrixGrid(matrix: string[][], hasHeader: boolean): TableGrid {
  if (!matrix.length) return makeGrid([], [])
  const headers = hasHeader ? matrix[0]! : matrix[0]!.map((_, i) => `col_${i + 1}`)
  return makeGrid(headers, hasHeader ? matrix.slice(1) : matrix)
}

export function jsonGrid(text: string, hasHeader: boolean): TableGrid {
  const input = parseJsonPreservingData(text)
  if (!Array.isArray(input)) throw new Error('JSON 输入必须是对象数组或二维数组。')
  if (!input.length) return makeGrid([], [])
  if (input.every(Array.isArray)) {
    const matrix = input as JsonValue[][]
    const headers = hasHeader ? matrix[0]!.map(displayValue) : matrix[0]!.map((_, i) => `col_${i + 1}`)
    assertGridSize(headers.length, matrix.length)
    const values = hasHeader ? matrix.slice(1) : matrix
    return makeGrid(headers, values.map(row => row.map(displayValue)), values)
  }
  if (!input.every(row => row !== null && typeof row === 'object' && !Array.isArray(row))) throw new Error('JSON 每行必须都是对象，或每行都是数组，不能混合。')
  const objects = input as Record<string, JsonValue>[]
  const headers = [...new Set(objects.flatMap(Object.keys))]
  assertGridSize(headers.length, objects.length)
  const values = objects.map(row => headers.map(key => Object.hasOwn(row, key) ? row[key] : undefined))
  // 对象的键本身是有效列名，空键无需改名。
  const result = makeGrid(headers, values.map(row => row.map(displayValue)), values)
  return { ...result, headers, warnings: [] }
}

export function cellValue(grid: TableGrid, r: number, c: number): JsonValue | undefined {
  if (grid.values) return grid.values[r]?.[c]
  const raw = grid.rows[r]?.[c] ?? ''
  if (grid.inferredTypes[c] === 'number') return Number(raw)
  if (grid.inferredTypes[c] === 'boolean') return raw === 'true'
  return raw
}

/** 逐行累计预算，避免长表头或转义导致输出在检查前膨胀。 */
export function boundedJoin(parts: Iterable<string>, separator: string, prefix = '', suffix = ''): string {
  const encoder = new TextEncoder(), result: string[] = []
  let bytes = encoder.encode(prefix + suffix).length
  if (bytes > 8 * 1024 * 1024) throw new Error('输出超过剪贴板 8 MiB 上限，请拆分输入后转换。')
  const separatorBytes = encoder.encode(separator).length
  for (const part of parts) {
    bytes += encoder.encode(part).length + (result.length ? separatorBytes : 0)
    if (bytes > 8 * 1024 * 1024) throw new Error('输出超过剪贴板 8 MiB 上限，请拆分输入后转换。')
    result.push(part)
  }
  return prefix + result.join(separator) + suffix
}
