export type SupportedEncoding = 'utf-8' | 'unicode' | 'hex' | 'base64' | 'url-encoded'

export interface ConversionResult {
  id: string
  name: string
  encoded: string
  description: string
}

/**
 * 转为 Unicode 转义序列 (\u4e2d\u6587)
 */
export function toUnicodeEscape(str: string): string {
  return str
    .split('')
    .map(char => {
      const code = char.charCodeAt(0)
      if (code > 127) {
        return '\\u' + code.toString(16).padStart(4, '0')
      }
      return char
    })
    .join('')
}

/**
 * 将 Unicode 转义序列还原为正常文本
 */
export function fromUnicodeEscape(str: string): string {
  return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => {
    return String.fromCharCode(parseInt(hex, 16))
  })
}

/**
 * 字符串转 UTF-8 Hex 字节串
 */
export function toUtf8Hex(str: string): string {
  if (typeof TextEncoder !== 'undefined') {
    const bytes = new TextEncoder().encode(str)
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0').toUpperCase())
      .join(' ')
  }
  return ''
}

/**
 * 字符串转 Base64
 */
export function toBase64(str: string): string {
  try {
    if (typeof btoa !== 'undefined') {
      const utf8Bytes = encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => {
        return String.fromCharCode(parseInt(p1, 16))
      })
      return btoa(utf8Bytes)
    }
  } catch {
    // 忽略
  }
  return ''
}

/**
 * 计算多编码结果对比
 */
export function convertTextToAllEncodings(input: string): ConversionResult[] {
  if (!input) return []

  const unicode = toUnicodeEscape(input)
  const hex = toUtf8Hex(input)
  const b64 = toBase64(input)
  const urlEncoded = encodeURIComponent(input)

  return [
    {
      id: 'unicode-escape',
      name: 'Unicode 转义序列 (\\uXXXX)',
      encoded: unicode,
      description: '常用于 JSON/Java/JS 跨平台字符防乱码'
    },
    {
      id: 'utf8-hex',
      name: 'UTF-8 十六进制字节码 (Hex)',
      encoded: hex,
      description: '底层字节流表示 (带空格分隔)'
    },
    {
      id: 'base64',
      name: 'Base64 编码',
      encoded: b64,
      description: '网络与安全传输标准'
    },
    {
      id: 'url-encode',
      name: 'URL 编码 (Percent-Encoding)',
      encoded: urlEncoded,
      description: '网页 URL 与查询参数安全编码'
    }
  ]
}
