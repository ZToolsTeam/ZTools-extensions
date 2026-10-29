import type {
  JwtDecodedResult,
  JwtVerificationResult,
  UrlInspectResult,
  UrlQueryParamItem,
} from './types'

export function decodeBase64UrlToUtf8(segment: string): string {
  const trimmed = String(segment || '')
  if (!trimmed) {
    throw new Error('EMPTY_BASE64URL_SEGMENT: Base64URL 段不能为空')
  }
  if (!/^[A-Za-z0-9\-_]+$/.test(trimmed) || trimmed.length % 4 === 1) {
    throw new Error('INVALID_BASE64URL_CHARS: 包含非法 Base64URL 字符')
  }

  const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/')
  const padLen = (4 - (normalized.length % 4)) % 4
  const padded = normalized + '='.repeat(padLen)

  const bytes = typeof Buffer !== 'undefined' ? new Uint8Array(Buffer.from(padded, 'base64'))
    : Uint8Array.from(atob(padded), character => character.charCodeAt(0))
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  if (encodeUtf8ToBase64Url(decoded) !== trimmed) throw new Error('INVALID_BASE64URL_ENCODING: 非规范编码')
  return decoded
}

export function encodeUtf8ToBase64Url(input: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(String(input), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '')
  }
  const bytes = new TextEncoder().encode(String(input))
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function formatEpochSec(sec: unknown): string | undefined {
  if (typeof sec !== 'number' || !Number.isFinite(sec)) {
    return undefined
  }
  const date = new Date(sec * 1000)
  if (Number.isNaN(date.getTime())) {
    return undefined
  }
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function formatDurationSec(absSec: number): string {
  const days = Math.floor(absSec / 86400)
  const hours = Math.floor((absSec % 86400) / 3600)
  const minutes = Math.floor((absSec % 3600) / 60)
  const seconds = Math.floor(absSec % 60)
  const parts: string[] = []
  if (days > 0) parts.push(`${days}天`)
  if (hours > 0) parts.push(`${hours}小时`)
  if (minutes > 0) parts.push(`${minutes}分`)
  if (parts.length === 0 || seconds > 0) parts.push(`${seconds}秒`)
  return parts.slice(0, 3).join(' ')
}

export function decodeJwtToken(rawInput: string, nowMs: number = Date.now()): JwtDecodedResult {
  const cleaned = String(rawInput || '')
    .trim()
    .replace(/^Bearer\s+/i, '')
    .trim()

  if (!cleaned) {
    throw new Error('EMPTY_JWT_TOKEN: JWT Token 不能为空')
  }

  const segments = cleaned.split('.')
  if (segments.length !== 3) {
    throw new Error(
      `INVALID_JWT_STRUCTURE: 标准 JWT 必须包含 3 段 (Header.Payload.Signature)，当前为 ${segments.length} 段`,
    )
  }

  const [headerRaw, payloadRaw, signatureRaw] = segments
  let headerObj: Record<string, unknown>
  let payloadObj: Record<string, unknown>

  try {
    const headerJson = decodeBase64UrlToUtf8(headerRaw)
    const parsedHeader = JSON.parse(headerJson)
    if (!parsedHeader || typeof parsedHeader !== 'object' || Array.isArray(parsedHeader)) {
      throw new Error('Header 不是合法 JSON 对象')
    }
    headerObj = parsedHeader as Record<string, unknown>
  } catch (err) {
    throw new Error(
      `INVALID_JWT_HEADER: Header 段 Base64URL 或 JSON 解析失败 (${
        err instanceof Error ? err.message : String(err)
      })`,
    )
  }

  try {
    const payloadJson = decodeBase64UrlToUtf8(payloadRaw)
    const parsedPayload = JSON.parse(payloadJson)
    if (!parsedPayload || typeof parsedPayload !== 'object' || Array.isArray(parsedPayload)) {
      throw new Error('Payload 不是合法 JSON 对象')
    }
    payloadObj = parsedPayload as Record<string, unknown>
  } catch (err) {
    throw new Error(
      `INVALID_JWT_PAYLOAD: Payload 段 Base64URL 或 JSON 解析失败 (${
        err instanceof Error ? err.message : String(err)
      })`,
    )
  }

  const algorithm = typeof headerObj.alg === 'string' ? headerObj.alg : 'UNKNOWN'
  const issuedAtText = formatEpochSec(payloadObj.iat)
  const notBeforeText = formatEpochSec(payloadObj.nbf)
  const expiresAtText = formatEpochSec(payloadObj.exp)

  if (!Number.isFinite(nowMs)) throw new Error('INVALID_CURRENT_TIME: 当前时间无效')
  const nowSec = nowMs / 1000
  const invalidTime = ['exp', 'nbf', 'iat'].some(key => key in payloadObj && formatEpochSec(payloadObj[key]) === undefined)
    || (typeof payloadObj.nbf === 'number' && typeof payloadObj.exp === 'number' && payloadObj.nbf >= payloadObj.exp)
  const isExpired = typeof payloadObj.exp === 'number' && Number.isFinite(payloadObj.exp) && payloadObj.exp <= nowSec
  // RFC 7519 的 NumericDate 以秒为单位；超过 1e11（约公元 5138 年）基本是误填的毫秒时间戳，按秒计算会得出“尚未过期”的错误结论
  const millisecondLike = ['exp', 'nbf', 'iat'].filter(key => typeof payloadObj[key] === 'number' && Math.abs(payloadObj[key] as number) > 1e11)
  let timeStatus: JwtDecodedResult['timeStatus'] = '未声明到期'
  let expiryCountdownText = '未声明 exp，无法判断到期时间'
  if (millisecondLike.length) {
    timeStatus = '时间声明异常'; expiryCountdownText = `${millisecondLike.join('、')} 数值过大，疑似毫秒时间戳（JWT 规定以秒为单位）`
  } else if (invalidTime) {
    timeStatus = '时间声明异常'; expiryCountdownText = 'exp、nbf 或 iat 不是有效时间，或生效时间不早于到期时间'
  } else if (isExpired) {
    timeStatus = '已过期'; expiryCountdownText = `已过期 ${formatDurationSec(nowSec - Number(payloadObj.exp))}`
  } else if (typeof payloadObj.nbf === 'number' && payloadObj.nbf > nowSec) {
    timeStatus = '尚未生效'; expiryCountdownText = `距离 nbf 生效时间 ${formatDurationSec(payloadObj.nbf - nowSec)}`
  } else if (typeof payloadObj.exp === 'number') {
    timeStatus = '尚未过期'; expiryCountdownText = `距离 exp 到期时间 ${formatDurationSec(payloadObj.exp - nowSec)}`
  }

  return {
    rawToken: cleaned,
    headerRaw,
    payloadRaw,
    signatureRaw,
    header: headerObj,
    payload: payloadObj,
    algorithm,
    issuedAtText,
    notBeforeText,
    expiresAtText,
    isExpired,
    timeStatus,
    expiryCountdownText,
  }
}

async function computeHmacSha256Base64Url(signingInput: string, secret: string): Promise<string> {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    const enc = new TextEncoder()
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const sigBuf = await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(signingInput))
    const bytes = new Uint8Array(sigBuf)
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(bytes)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '')
    }
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  }

  throw new Error('CRYPTO_UNAVAILABLE: 当前环境不支持 WebCrypto SubtleCrypto HMAC-SHA256')
}

export async function verifyJwtHmacSha256(
  rawToken: string,
  secret: string,
): Promise<JwtVerificationResult> {
  const decoded = decodeJwtToken(rawToken)
  if (!secret) {
    throw new Error('EMPTY_JWT_SECRET: 验签密钥 Secret 不能为空')
  }
  if (decoded.algorithm !== 'HS256' || 'crit' in decoded.header || 'b64' in decoded.header) {
    return {
      verified: false,
      algorithm: decoded.algorithm,
      expectedSignature: '',
      actualSignature: decoded.signatureRaw,
      reason: '当前仅支持 alg 为 HS256 且不含 crit/b64 扩展的标准签名',
    }
  }

  const signingInput = `${decoded.headerRaw}.${decoded.payloadRaw}`
  const expectedSignature = await computeHmacSha256Base64Url(signingInput, secret)
  const verified = expectedSignature === decoded.signatureRaw

  return {
    verified,
    algorithm: decoded.algorithm,
    expectedSignature,
    actualSignature: decoded.signatureRaw,
    reason: verified ? 'HMAC-SHA256 签名一致；未校验签发方、接收方或授权范围' : '签名不匹配，密钥错误或载荷已被篡改',
  }
}

export async function signJwtHmacSha256(
  payload: Record<string, unknown>,
  secret: string,
  headerOverrides?: Record<string, unknown>,
): Promise<string> {
  if (!secret) {
    throw new Error('EMPTY_JWT_SECRET: 签发密钥 Secret 不能为空')
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('INVALID_JWT_PAYLOAD: Payload 必须是合法 JSON 对象')
  }
  if (headerOverrides !== undefined && (!headerOverrides || typeof headerOverrides !== 'object' || Array.isArray(headerOverrides))) {
    throw new Error('INVALID_JWT_HEADER: Header 必须是 JSON 对象')
  }
  if (headerOverrides && (('alg' in headerOverrides && headerOverrides.alg !== 'HS256') || 'crit' in headerOverrides || 'b64' in headerOverrides)) {
    throw new Error('UNSUPPORTED_JWT_HEADER: 仅支持 HS256，不能覆盖算法或使用 crit/b64 扩展')
  }

  const header = {
    alg: 'HS256',
    typ: 'JWT',
    ...(headerOverrides || {}),
  }
  const headerB64 = encodeUtf8ToBase64Url(JSON.stringify(header))
  const payloadB64 = encodeUtf8ToBase64Url(JSON.stringify(payload))
  const signingInput = `${headerB64}.${payloadB64}`
  const sigB64 = await computeHmacSha256Base64Url(signingInput, secret)
  return `${signingInput}.${sigB64}`
}

function safeDecodeURIComponent(val: string): string {
  try {
    return decodeURIComponent(val)
  } catch {
    return val
  }
}

export function parseAndInspectUrl(rawInput: string): UrlInspectResult {
  const trimmed = String(rawInput || '').trim()
  if (!trimmed) {
    throw new Error('EMPTY_URL_INPUT: URL 或 Query 字符串不能为空')
  }

  const authorityWithPort = /^[^/?#]+:\d+(?:[/?#]|$)/.test(trimmed)
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) && !authorityWithPort
  const queryOnly = !hasScheme && (trimmed.startsWith('?') || /^[^/?#]*[=&]/u.test(trimmed))
  const normalizedUrlStr = hasScheme
    ? trimmed
    : queryOnly
      ? `https://ztools.local/${trimmed.startsWith('?') ? trimmed : `?${trimmed}`}`
      : trimmed.startsWith('//') ? `https:${trimmed}` : `https://${trimmed}`

  let parsed: URL
  try {
    parsed = new URL(normalizedUrlStr)
  } catch (err) {
    throw new Error(
      `INVALID_URL_FORMAT: 无法解析 URL (${err instanceof Error ? err.message : String(err)})`,
    )
  }

  const queryParams: UrlQueryParamItem[] = []
  const decodedEntries = parsed.searchParams.entries()
  for (const pair of parsed.search.slice(1).split('&').filter(Boolean)) {
    const entry = decodedEntries.next().value
    if (!entry) continue
    const [key, decodedValue] = entry
    const equals = pair.indexOf('=')
    const isNestedUrl = /^https?:\/\//i.test(decodedValue)
    const isJsonLike =
      (decodedValue.startsWith('{') && decodedValue.endsWith('}')) ||
      (decodedValue.startsWith('[') && decodedValue.endsWith(']'))

    queryParams.push({
      key,
      rawKey: equals < 0 ? pair : pair.slice(0, equals),
      rawValue: equals < 0 ? '' : pair.slice(equals + 1),
      decodedValue,
      isNestedUrl,
      isJsonLike,
    })
  }

  return {
    rawInput: trimmed,
    protocol: queryOnly ? 'query-only' : parsed.protocol.replace(/:$/, ''),
    host: queryOnly ? '-' : parsed.host || '-',
    hostname: queryOnly ? '-' : parsed.hostname || '-',
    port: queryOnly ? '-' : parsed.port || (parsed.protocol === 'https:' ? '443' : parsed.protocol === 'http:' ? '80' : '-'),
    pathname: queryOnly ? '-' : parsed.pathname,
    hash: parsed.hash || '',
    encodedFullUrl: queryOnly ? parsed.search + parsed.hash : parsed.href,
    decodedFullUrl: safeDecodeURIComponent(trimmed),
    queryParams,
  }
}

/** 重复键保留全部值，特殊键名作为普通数据，不触发对象原型赋值。 */
export function queryParamsToJson(params: UrlQueryParamItem[]): string {
  const values: Record<string, string | string[]> = Object.create(null)
  for (const item of params) {
    const previous = values[item.key]
    if (previous === undefined) values[item.key] = item.decodedValue
    else if (Array.isArray(previous)) previous.push(item.decodedValue)
    else values[item.key] = [previous, item.decodedValue]
  }
  return JSON.stringify(values, null, 2)
}

/** 界面展示用：去掉错误信息开头的机器可读错误码（如 INVALID_JWT_HEADER:），保留中文原因 */
export function displayError(message: string): string {
  return String(message).replace(/^[A-Z][A-Z0-9_]*:\s*/, '')
}

/** 用户输入只作为代码块原文展示，不能闭合围栏后生成联网图片或链接。 */
export function fencedBlock(content: string, language = 'text'): string {
  const normalized = content.replace(/\r\n?/g, '\n')
  let length = 3
  for (const run of normalized.matchAll(/`+/g)) length = Math.max(length, run[0].length + 1)
  const fence = '`'.repeat(length)
  return `${fence}${language}\n${normalized}\n${fence}`
}
