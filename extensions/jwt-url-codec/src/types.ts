export type CodecMode = 'jwt' | 'url'

export interface JwtDecodedResult {
  rawToken: string
  headerRaw: string
  payloadRaw: string
  signatureRaw: string
  header: Record<string, unknown>
  payload: Record<string, unknown>
  algorithm: string
  issuedAtText?: string
  notBeforeText?: string
  expiresAtText?: string
  isExpired: boolean
  timeStatus: '未声明到期' | '时间声明异常' | '已过期' | '尚未生效' | '尚未过期'
  expiryCountdownText: string
}

export interface JwtVerificationResult {
  verified: boolean
  algorithm: string
  expectedSignature: string
  actualSignature: string
  reason?: string
}

export interface UrlQueryParamItem {
  key: string
  rawKey: string
  rawValue: string
  decodedValue: string
  isNestedUrl: boolean
  isJsonLike: boolean
}

export interface UrlInspectResult {
  rawInput: string
  protocol: string
  host: string
  hostname: string
  port: string
  pathname: string
  hash: string
  encodedFullUrl: string
  decodedFullUrl: string
  queryParams: UrlQueryParamItem[]
}
