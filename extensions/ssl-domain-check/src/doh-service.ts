import type { DnsRecordEntry, DnsRecordType } from './types.js'
import { normalizeDomainInput } from './domain.js'
const codes: Record<DnsRecordType, number> = { A: 1, AAAA: 28, CNAME: 5, MX: 15, TXT: 16 }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('DNS 服务没有返回内容')
  const reader = response.body.getReader(), parts: Uint8Array[] = []; let size = 0
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break
      size += next.value.length; if (size > 256 * 1024) throw new Error('DNS 响应超过大小限制')
      parts.push(next.value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size); let offset = 0
  for (const part of parts) { bytes.set(part, offset); offset += part.length }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch { throw new Error('DNS 服务返回了无效内容') }
}
export async function resolveDomainDoh(rawDomain: string, types: DnsRecordType[] = ['A', 'AAAA', 'CNAME', 'MX', 'TXT'], options: { signal?: AbortSignal; fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<DnsRecordEntry[]> {
  const domain = normalizeDomainInput(rawDomain), timeoutMs = options.timeoutMs ?? 8000
  if (!Array.isArray(types) || types.length < 1 || types.length > 5 || new Set(types).size !== types.length || types.some(type => !Object.hasOwn(codes, type)) || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 15000) throw new Error('DNS 查询参数无效')
  options.signal?.throwIfAborted()
  const controller = new AbortController(), abort = () => controller.abort(), timer = setTimeout(abort, timeoutMs)
  options.signal?.addEventListener('abort', abort, { once: true })
  try {
    const results: DnsRecordEntry[] = [], fetchFn = options.fetchImpl ?? globalThis.fetch
    for (const type of types) {
      controller.signal.throwIfAborted()
      const response = await fetchFn(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${type}`, { headers: { accept: 'application/dns-json' }, credentials: 'omit', redirect: 'error', signal: controller.signal })
      if (!response.ok) throw new Error(`DNS 查询失败：HTTP ${response.status}`)
      const payload = await boundedJson(response)
      if (!object(payload) || !Number.isInteger(payload.Status)) throw new Error('DNS 响应缺少状态码')
      if (payload.Status === 3) throw new Error('域名不存在（NXDOMAIN）')
      if (payload.Status !== 0) throw new Error(`DNS 服务返回错误 ${payload.Status}`)
      if (payload.TC === true) throw new Error('DNS 响应被截断，结果不完整，请稍后重试')
      if (payload.Answer === undefined) continue
      if (!Array.isArray(payload.Answer) || payload.Answer.length > 128) throw new Error('DNS 记录数量无效或超过限制')
      for (const answer of payload.Answer) {
        if (!object(answer) || typeof answer.name !== 'string' || answer.name.length > 253 || typeof answer.data !== 'string' || answer.data.length > 8192 || !Number.isInteger(answer.type) || !Number.isInteger(answer.TTL) || Number(answer.TTL) < 0 || Number(answer.TTL) > 4294967295) throw new Error('DNS 记录字段不完整')
        if (answer.type === codes[type]) results.push({ name: answer.name.replace(/\.$/, ''), type, ttl: Number(answer.TTL), data: answer.data })
      }
    }
    controller.signal.throwIfAborted(); return results
  } catch (error) {
    if (controller.signal.aborted) throw new Error(options.signal?.aborted ? 'DNS 查询已取消' : 'DNS 查询超时')
    throw error
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); controller.abort() }
}
