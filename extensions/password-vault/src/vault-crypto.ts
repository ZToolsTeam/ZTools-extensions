import type { EncryptedVaultEnvelope, VaultCategory, VaultEntry, VaultNewEntryInput } from './types.js'

/** 新密文使用的 PBKDF2-SHA256 迭代次数（OWASP 现行建议值），写入信封以便以后调整 */
export const PBKDF2_ITERATIONS = 600000
/** 第 1 版信封未记录迭代次数，固定为 10 万次 */
const LEGACY_PBKDF2_ITERATIONS = 100000
const MAX_PBKDF2_ITERATIONS = 5000000
/** 新建保险箱的主密码最短长度；已有保险箱沿用原规则（6 位），避免老用户无法解锁或保存 */
export const NEW_VAULT_MIN_PASSWORD_LENGTH = 8
const EXISTING_VAULT_MIN_PASSWORD_LENGTH = 6
const SALT_BYTES = 16
const IV_BYTES = 12

function getWebCrypto(): Crypto {
  const c = (globalThis as Record<string, unknown>).crypto as Crypto | undefined
  if (!c || !c.subtle) {
    throw new Error('VAULT_CRYPTO_UNAVAILABLE: WebCrypto API 不可用，拒绝以明文存储敏感凭据')
  }
  return c
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  try {
    if (typeof Buffer !== 'undefined') {
      const buf = Buffer.from(base64, 'base64')
      if (buf.length === 0 && base64.length > 0) {
        throw new Error('VAULT_DATA_CORRUPTED')
      }
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
    }
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  } catch {
    throw new Error('VAULT_DATA_CORRUPTED: 加密信封 Base64 编码已损坏')
  }
}

async function deriveAesGcmKey(
  masterPassword: string,
  salt: Uint8Array,
  iterations: number,
  usages: KeyUsage[]
): Promise<CryptoKey> {
  const cryptoObj = getWebCrypto()
  const encoder = new TextEncoder()
  const keyMaterial = await cryptoObj.subtle.importKey(
    'raw',
    encoder.encode(masterPassword),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  )

  return cryptoObj.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    usages
  )
}

export function validateMasterPassword(
  password: string,
  options: { isNewVault?: boolean } = {}
): { valid: boolean; error?: string } {
  const value = String(password || '')
  const minLength = options.isNewVault ? NEW_VAULT_MIN_PASSWORD_LENGTH : EXISTING_VAULT_MIN_PASSWORD_LENGTH
  if (value.length < minLength) {
    return { valid: false, error: `VAULT_WEAK_MASTER_PASSWORD: 主密码长度至少需要 ${minLength} 位字符` }
  }
  return { valid: true }
}

/** 按信封版本取 PBKDF2 迭代次数；第 2 版的次数必须是合理范围内的整数，否则视为损坏 */
function envelopeIterations(envelope: EncryptedVaultEnvelope): number {
  if (envelope.version === 1) return LEGACY_PBKDF2_ITERATIONS
  const iterations = envelope.kdfIterations
  if (!Number.isSafeInteger(iterations) || iterations! < LEGACY_PBKDF2_ITERATIONS || iterations! > MAX_PBKDF2_ITERATIONS) {
    throw new Error('VAULT_DATA_CORRUPTED: 加密信封的密钥派生参数非法')
  }
  return iterations!
}

export function validateNewEntryInput(input: VaultNewEntryInput): { valid: boolean; error?: string } {
  if (!input || !String(input.title || '').trim()) {
    return { valid: false, error: 'VAULT_INVALID_ENTRY: 凭据标题不能为空' }
  }
  if (!String(input.secretPlain || '').trim()) {
    return { valid: false, error: 'VAULT_INVALID_ENTRY: 密码或密钥内容不能为空' }
  }
  return { valid: true }
}

export function getVaultCategoryLabel(category: VaultCategory): string {
  switch (category) {
    case 'login':
      return '网站与应用账号'
    case 'apikey':
      return 'API Key 令牌'
    case 'server':
      return '服务器与数据库'
    case 'license':
      return '激活码与备忘'
    default:
      return '加密凭据'
  }
}

export function createVaultEntry(input: VaultNewEntryInput, nowMs = Date.now()): VaultEntry {
  const check = validateNewEntryInput(input)
  if (!check.valid) {
    throw new Error(check.error)
  }
  const dateObj = new Date(nowMs)
  const month = String(dateObj.getMonth() + 1).padStart(2, '0')
  const day = String(dateObj.getDate()).padStart(2, '0')
  const cryptoObj = getWebCrypto()
  const idBytes = new Uint8Array(8)
  cryptoObj.getRandomValues(idBytes)
  const hexId = Array.from(idBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return {
    id: `vault-${hexId}`,
    title: input.title.trim(),
    category: input.category,
    categoryLabel: getVaultCategoryLabel(input.category),
    username: (input.username || '').trim(),
    endpoint: (input.endpoint || '').trim(),
    secretPlain: input.secretPlain,
    note: (input.note || '').trim(),
    updatedAt: nowMs,
    updatedAtShort: `${month}-${day}`
  }
}

export async function encryptVaultEntries(
  masterPassword: string,
  entries: VaultEntry[]
): Promise<EncryptedVaultEnvelope> {
  const pwdCheck = validateMasterPassword(masterPassword)
  if (!pwdCheck.valid) {
    throw new Error(pwdCheck.error)
  }

  const cryptoObj = getWebCrypto()
  const salt = new Uint8Array(SALT_BYTES)
  const iv = new Uint8Array(IV_BYTES)
  cryptoObj.getRandomValues(salt)
  cryptoObj.getRandomValues(iv)

  const key = await deriveAesGcmKey(masterPassword, salt, PBKDF2_ITERATIONS, ['encrypt'])
  const payloadJson = JSON.stringify({
    magic: 'ZTOOLS_VAULT_V1',
    entries: Array.isArray(entries) ? entries : []
  })
  const encoded = new TextEncoder().encode(payloadJson)
  const cipherBuffer = await cryptoObj.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, tagLength: 128 },
    key,
    encoded
  )

  return {
    version: 2,
    kdfIterations: PBKDF2_ITERATIONS,
    saltBase64: bytesToBase64(salt),
    ivBase64: bytesToBase64(iv),
    cipherTextBase64: bytesToBase64(new Uint8Array(cipherBuffer))
  }
}

export async function decryptVaultEntries(
  masterPassword: string,
  envelope: EncryptedVaultEnvelope,
  options?: { knownOriginalCipherBase64?: string }
): Promise<VaultEntry[]> {
  if (!masterPassword || String(masterPassword).length === 0) {
    throw new Error('VAULT_INVALID_MASTER_PASSWORD: 主密码不能为空')
  }
  if (
    !envelope ||
    (envelope.version !== 1 && envelope.version !== 2) ||
    !envelope.saltBase64 ||
    !envelope.ivBase64 ||
    !envelope.cipherTextBase64
  ) {
    throw new Error('VAULT_DATA_CORRUPTED: 加密保险箱数据结构不完整或已损坏')
  }

  if (
    options?.knownOriginalCipherBase64 &&
    options.knownOriginalCipherBase64 !== envelope.cipherTextBase64
  ) {
    throw new Error('VAULT_DATA_CORRUPTED: 密文完整性校验失败，检测到篡改')
  }

  const salt = base64ToBytes(envelope.saltBase64)
  const iv = base64ToBytes(envelope.ivBase64)
  const cipherBytes = base64ToBytes(envelope.cipherTextBase64)

  if (salt.byteLength !== SALT_BYTES || iv.byteLength !== IV_BYTES || cipherBytes.byteLength < 16) {
    throw new Error('VAULT_DATA_CORRUPTED: 加密参数长度非法或密文已损坏')
  }

  const iterations = envelopeIterations(envelope)
  const cryptoObj = getWebCrypto()
  const key = await deriveAesGcmKey(masterPassword, salt, iterations, ['decrypt'])

  let plainBuffer: ArrayBuffer
  try {
    plainBuffer = await cryptoObj.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, tagLength: 128 },
      key,
      cipherBytes as BufferSource
    )
  } catch {
    throw new Error(
      'VAULT_INVALID_MASTER_PASSWORD | VAULT_DATA_CORRUPTED: 主密码错误或保险箱密文已被篡改，AES-GCM 认证标签校验失败'
    )
  }

  try {
    const decodedText = new TextDecoder().decode(plainBuffer)
    const parsed = JSON.parse(decodedText) as { magic?: string; entries?: VaultEntry[] }
    if (parsed.magic !== 'ZTOOLS_VAULT_V1' || !Array.isArray(parsed.entries)) {
      throw new Error('VAULT_DATA_CORRUPTED')
    }
    return parsed.entries
  } catch {
    throw new Error('VAULT_DATA_CORRUPTED: 解密后载荷结构非法')
  }
}

export function generateSecurePassword(length = 20, includeSymbols = true): string {
  const safeLen = Math.max(8, Math.min(64, Math.floor(Number(length) || 20)))
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnopqrstuvwxyz'
  const digits = '23456789'
  const symbols = '!@#$%^&*()-_=+[]{}'
  const charset = includeSymbols ? upper + lower + digits + symbols : upper + lower + digits

  const cryptoObj = getWebCrypto()
  const randomBytes = new Uint8Array(safeLen)
  cryptoObj.getRandomValues(randomBytes)

  const chars: string[] = []
  chars.push(upper[randomBytes[0] % upper.length])
  chars.push(lower[randomBytes[1] % lower.length])
  chars.push(digits[randomBytes[2] % digits.length])
  if (includeSymbols) {
    chars.push(symbols[randomBytes[3] % symbols.length])
  }

  for (let i = chars.length; i < safeLen; i++) {
    chars.push(charset[randomBytes[i] % charset.length])
  }

  // Fisher-Yates shuffle using crypto random bytes
  const shuffleBytes = new Uint8Array(chars.length)
  cryptoObj.getRandomValues(shuffleBytes)
  for (let i = chars.length - 1; i > 0; i--) {
    const j = shuffleBytes[i] % (i + 1)
    const tmp = chars[i]
    chars[i] = chars[j]
    chars[j] = tmp
  }

  return chars.join('')
}

/** 敏感复制由宿主计时，离开插件后仍清除，且不进入宿主剪贴板历史。 */
export async function copySecretWithAutoClear(secret: string): Promise<void> {
  const bridge = (globalThis as unknown as { __ztoolsElectron?: { transport?: { methods?: {
    clipboard_copy_text?: (request: unknown) => Promise<{ success?: boolean; data?: { success?: boolean; clearAfterMs?: number }; error?: { message?: string } }>
  } } } }).__ztoolsElectron
  const method = bridge?.transport?.methods?.clipboard_copy_text
  if (!method) throw new Error('当前客户端不支持安全复制，请升级客户端')
  const response = await method({ messageId: `vault_copy_${crypto.randomUUID()}`, params: { text: secret, sensitive: true }, timeoutMs: 5000 })
  if (!response?.success || response.data?.success !== true || response.data.clearAfterMs !== 30000) {
    throw new Error(response?.error?.message || '客户端未确认自动清除，不能保证本次安全复制')
  }
}
