import type { CertificateSummary, SslCertHealthReport } from './types.js'
import { normalizeDomainInput } from './domain.js'
import { t } from './i18n.js'
import { resolveErrorMessage } from './error-i18n.js'
export { normalizeDomainInput, markdownLiteral } from './domain.js'
export { resolveDomainDoh } from './doh-service.js'
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, max = 8192): v is string => typeof v === 'string' && v.length <= max
function validSummary(v: unknown): v is CertificateSummary {
  return record(v) && ['subjectCN', 'issuerName', 'serialNumber', 'validFrom', 'validTo'].every(key => text(v[key])) &&
    typeof v.fingerprint256 === 'string' && /^(?:[a-f0-9]{2}:){31}[a-f0-9]{2}$/i.test(v.fingerprint256) &&
    Number.isFinite(Date.parse(String(v.validFrom))) && Number.isFinite(Date.parse(String(v.validTo))) && Date.parse(String(v.validTo)) > Date.parse(String(v.validFrom))
}
export function evaluateSslCertInfo(value: unknown, nowMs = Date.now()): SslCertHealthReport {
  if (!record(value) || !validSummary(value) || !text(value.domain, 253) || !Number.isInteger(value.port) || Number(value.port) < 1 || Number(value.port) > 65535 || !text(value.protocol, 128) || !value.protocol || !text(value.subjectAltName, 32768) ||
    typeof value.authorized !== 'boolean' || typeof value.hostnameMatches !== 'boolean' || !text(value.authorizationError) || typeof value.chainTruncated !== 'boolean' ||
    !Array.isArray(value.chain) || !value.chain.length || value.chain.length > 8 || !value.chain.every(validSummary) || value.chain[0].fingerprint256 !== value.fingerprint256 ||
    (value.authorized && (!value.hostnameMatches || value.authorizationError)) || (!value.authorized && !value.authorizationError) || !Number.isFinite(nowMs)) throw new Error(t('errCertIncomplete'))
  const from = Date.parse(value.validFrom), to = Date.parse(value.validTo), isExpired = to <= nowMs, daysRemaining = Math.ceil((to - nowMs) / 86400000), isNotYetValid = from > nowMs
  return { ...value, domain: normalizeDomainInput(value.domain), port: Number(value.port), validFromIso: new Date(from).toISOString(), validToIso: new Date(to).toISOString(), daysRemaining, isExpired, isNotYetValid,
    isExpiringSoon: !isExpired && daysRemaining <= 14, isHealthy: value.authorized && value.hostnameMatches && !isExpired && !isNotYetValid } as SslCertHealthReport
}
interface Bridge { transport?: { methods?: { tls_inspect?: (request: unknown) => Promise<{ success?: boolean; data?: unknown; error?: { message?: string } }> } } }
let sequence = 0
async function tlsCall(params: Record<string, unknown>) {
  const method = (globalThis as unknown as { __ztoolsElectron?: Bridge }).__ztoolsElectron?.transport?.methods?.tls_inspect
  if (!method) throw new Error(t('errTlsInterfaceMissing'))
  const result = await method({ messageId: `tls_${Date.now()}_${++sequence}`, params, timeoutMs: 20000 })
  if (result?.success !== true || !record(result.data) || result.data.success !== true) throw new Error(resolveErrorMessage(result?.error, t('errTlsUnconfirmed')))
  return result.data
}
export async function inspectDomainSslCert(rawDomain: string, options: { signal?: AbortSignal; port?: number; timeoutMs?: number } = {}): Promise<SslCertHealthReport> {
  const domain = normalizeDomainInput(rawDomain), port = options.port ?? 443, timeoutMs = options.timeoutMs ?? 6000
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 15000) throw new Error(t('errTlsInvalidPortOrTimeout'))
  options.signal?.throwIfAborted()
  const operationId = globalThis.crypto.randomUUID()
  const cancel = () => { void tlsCall({ action: 'cancel', operationId }).catch(error => console.warn('TLS probe cancel unconfirmed', error)) }
  options.signal?.addEventListener('abort', cancel, { once: true })
  try {
    const response = await tlsCall({ action: 'inspect', operationId, domain, port, timeoutMs })
    options.signal?.throwIfAborted()
    const cert = evaluateSslCertInfo(response.cert)
    if (cert.domain !== domain || cert.port !== port) throw new Error(t('errTlsTargetMismatch'))
    return cert
  } finally { options.signal?.removeEventListener('abort', cancel) }
}
