import type {
  JwtDecodedResult,
  JwtVerificationResult,
  UrlInspectResult,
  UrlQueryParamItem,
} from './types'
import { t } from './i18n.js'

export function decodeBase64UrlToUtf8(segment: string): string {
  const trimmed = String(segment || '')
  if (!trimmed) {
    throw new Error(t('errEmptyB64Seg'))
  }
  if (!/^[A-Za-z0-9\-_]+$/.test(trimmed) || trimmed.length % 4 === 1) {
    throw new Error(t('errInvalidB64Chars'))
  }

  const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/')
  const padLen = (4 - (normalized.length % 4)) % 4
  const padded = normalized + '='.repeat(padLen)

  const bytes = typeof Buffer !== 'undefined' ? new Uint8Array(Buffer.from(padded, 'base64'))
    : Uint8Array.from(atob(padded), character => character.charCodeAt(0))
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  if (encodeUtf8ToBase64Url(decoded) !== trimmed) throw new Error(t('errNonCanonicalB64'))
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
  if (days > 0) parts.push(t('durDays', { n: days }))
  if (hours > 0) parts.push(t('durHours', { n: hours }))
  if (minutes > 0) parts.push(t('durMinutes', { n: minutes }))
  if (parts.length === 0 || seconds > 0) parts.push(t('durSeconds', { n: seconds }))
  return parts.slice(0, 3).join(' ')
}

export function decodeJwtToken(rawInput: string, nowMs: number = Date.now()): JwtDecodedResult {
  const cleaned = String(rawInput || '')
    .trim()
    .replace(/^Bearer\s+/i, '')
    .trim()

  if (!cleaned) {
    throw new Error(t('errEmptyJwt'))
  }

  const segments = cleaned.split('.')
  if (segments.length !== 3) {
    throw new Error(
      t('errInvalidJwtStruct', { count: segments.length }),
    )
  }

  const [headerRaw, payloadRaw, signatureRaw] = segments
  let headerObj: Record<string, unknown>
  let payloadObj: Record<string, unknown>

  try {
    const headerJson = decodeBase64UrlToUtf8(headerRaw)
    const parsedHeader = JSON.parse(headerJson)
    if (!parsedHeader || typeof parsedHeader !== 'object' || Array.isArray(parsedHeader)) {
      throw new Error(t('errHeaderNotObj'))
    }
    headerObj = parsedHeader as Record<string, unknown>
  } catch (err) {
    throw new Error(
      t('errInvalidJwtHeader', {
        error: err instanceof Error ? err.message : String(err),
      }),
    )
  }

  try {
    const payloadJson = decodeBase64UrlToUtf8(payloadRaw)
    const parsedPayload = JSON.parse(payloadJson)
    if (!parsedPayload || typeof parsedPayload !== 'object' || Array.isArray(parsedPayload)) {
      throw new Error(t('errPayloadNotObj'))
    }
    payloadObj = parsedPayload as Record<string, unknown>
  } catch (err) {
    throw new Error(
      t('errInvalidJwtPayload', {
        error: err instanceof Error ? err.message : String(err),
      }),
    )
  }

  const algorithm = typeof headerObj.alg === 'string' ? headerObj.alg : 'UNKNOWN'
  const issuedAtText = formatEpochSec(payloadObj.iat)
  const notBeforeText = formatEpochSec(payloadObj.nbf)
  const expiresAtText = formatEpochSec(payloadObj.exp)

  if (!Number.isFinite(nowMs)) throw new Error(t('errInvalidNow'))
  const nowSec = nowMs / 1000
  const invalidTime = ['exp', 'nbf', 'iat'].some(key => key in payloadObj && formatEpochSec(payloadObj[key]) === undefined)
    || (typeof payloadObj.nbf === 'number' && typeof payloadObj.exp === 'number' && payloadObj.nbf >= payloadObj.exp)
  const isExpired = typeof payloadObj.exp === 'number' && Number.isFinite(payloadObj.exp) && payloadObj.exp <= nowSec
  // RFC 7519 的 NumericDate 以秒为单位；超过 1e11（约公元 5138 年）基本是误填的毫秒时间戳，按秒计算会得出“尚未过期”的错误结论
  const millisecondLike = ['exp', 'nbf', 'iat'].filter(key => typeof payloadObj[key] === 'number' && Math.abs(payloadObj[key] as number) > 1e11)
  let timeStatus: JwtDecodedResult['timeStatus'] = t('tsUndeclared')
  let timeStatusWarning = false
  let expiryCountdownText = t('cdUndeclared')
  if (millisecondLike.length) {
    timeStatus = t('tsInvalid'); timeStatusWarning = true; expiryCountdownText = t('cdMillisecondLike', { keys: millisecondLike.join(t('listSep')) })
  } else if (invalidTime) {
    timeStatus = t('tsInvalid'); timeStatusWarning = true; expiryCountdownText = t('cdInvalidTime')
  } else if (isExpired) {
    timeStatus = t('tsExpired'); timeStatusWarning = true; expiryCountdownText = t('cdExpired', { duration: formatDurationSec(nowSec - Number(payloadObj.exp)) })
  } else if (typeof payloadObj.nbf === 'number' && payloadObj.nbf > nowSec) {
    timeStatus = t('tsNotYetValid'); timeStatusWarning = true; expiryCountdownText = t('cdNotBefore', { duration: formatDurationSec(payloadObj.nbf - nowSec) })
  } else if (typeof payloadObj.exp === 'number') {
    timeStatus = t('tsValid'); expiryCountdownText = t('cdExpiresIn', { duration: formatDurationSec(payloadObj.exp - nowSec) })
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
    timeStatusWarning,
    expiryCountdownText,
  }
}

type SupportedHmacAlg = 'HS256' | 'HS384' | 'HS512'
const HMAC_HASH_BY_ALG: Record<SupportedHmacAlg, 'SHA-256' | 'SHA-384' | 'SHA-512'> = {
  HS256: 'SHA-256',
  HS384: 'SHA-384',
  HS512: 'SHA-512',
}

async function computeHmacBase64Url(
  signingInput: string,
  secret: string,
  hash: 'SHA-256' | 'SHA-384' | 'SHA-512',
): Promise<string> {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    const enc = new TextEncoder()
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash },
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

  throw new Error(t('errCryptoUnavailable'))
}

async function computeHmacSha256Base64Url(signingInput: string, secret: string): Promise<string> {
  return computeHmacBase64Url(signingInput, secret, 'SHA-256')
}

export async function verifyJwtHmac(
  rawToken: string,
  secret: string,
): Promise<JwtVerificationResult> {
  const decoded = decodeJwtToken(rawToken)
  if (!secret) {
    throw new Error(t('errEmptyVerifySecret'))
  }
  const hash = Object.prototype.hasOwnProperty.call(HMAC_HASH_BY_ALG, decoded.algorithm)
    ? HMAC_HASH_BY_ALG[decoded.algorithm as SupportedHmacAlg]
    : undefined
  if (!hash || 'crit' in decoded.header || 'b64' in decoded.header) {
    return {
      verified: false,
      algorithm: decoded.algorithm,
      expectedSignature: '',
      actualSignature: decoded.signatureRaw,
      reason: t('verifyUnsupportedHmacAlg'),
    }
  }

  const signingInput = `${decoded.headerRaw}.${decoded.payloadRaw}`
  const expectedSignature = await computeHmacBase64Url(signingInput, secret, hash)
  const verified = expectedSignature === decoded.signatureRaw

  return {
    verified,
    algorithm: decoded.algorithm,
    expectedSignature,
    actualSignature: decoded.signatureRaw,
    reason: verified ? t('verifyHmacMatch', { alg: decoded.algorithm }) : t('verifyMismatch'),
  }
}

export async function verifyJwtHmacSha256(
  rawToken: string,
  secret: string,
): Promise<JwtVerificationResult> {
  const decoded = decodeJwtToken(rawToken)
  if (!secret) {
    throw new Error(t('errEmptyVerifySecret'))
  }
  if (decoded.algorithm !== 'HS256' || 'crit' in decoded.header || 'b64' in decoded.header) {
    return {
      verified: false,
      algorithm: decoded.algorithm,
      expectedSignature: '',
      actualSignature: decoded.signatureRaw,
      reason: t('verifyUnsupportedAlg'),
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
    reason: verified ? t('verifyMatch') : t('verifyMismatch'),
  }
}

export async function signJwtHmacSha256(
  payload: Record<string, unknown>,
  secret: string,
  headerOverrides?: Record<string, unknown>,
): Promise<string> {
  if (!secret) {
    throw new Error(t('errEmptySignSecret'))
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(t('errSignPayloadNotObj'))
  }
  if (headerOverrides !== undefined && (!headerOverrides || typeof headerOverrides !== 'object' || Array.isArray(headerOverrides))) {
    throw new Error(t('errSignHeaderNotObj'))
  }
  if (headerOverrides && (('alg' in headerOverrides && headerOverrides.alg !== 'HS256') || 'crit' in headerOverrides || 'b64' in headerOverrides)) {
    throw new Error(t('errUnsupportedHeaderExt'))
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
    throw new Error(t('errEmptyUrlInput'))
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
      t('errInvalidUrlFormat', { error: err instanceof Error ? err.message : String(err) }),
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

/**
 * 基于已解析的 URL 结构与编辑后的 Query 参数列表重组完整 URL（保留重复键与锚点 Hash）
 */
export function rebuildUrlWithQueryParams(
  inspect: UrlInspectResult,
  params: ReadonlyArray<{ key: string; value: string }>,
): string {
  const sp = new URLSearchParams()
  for (const p of params) {
    sp.append(p.key, p.value)
  }
  const queryStr = sp.toString()
  if (inspect.protocol === 'query-only') {
    const prefix = queryStr ? `?${queryStr}` : ''
    return `${prefix}${inspect.hash || ''}`
  }
  const parsed = new URL(inspect.encodedFullUrl)
  parsed.search = queryStr ? `?${queryStr}` : ''
  return parsed.href
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
