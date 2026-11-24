import { t } from './i18n.js'
import { resolveErrorMessage } from './error-i18n.js'

export interface MacProbe {
  host: string; port: number; name: string; group: 'domestic' | 'global' | 'custom' | 'gateway'; protocol: 'TCP' | 'ICMP'
  checkedAt?: string; samplesMs: number[]; latencyMs: number | null; jitterMs: number | null; error: string | null
}
export interface MacNetwork { interfaceName: string | null; localAddresses: string[]; gateway: string | null; warning: string | null }
export interface MacDiagnosis { nodes: MacProbe[]; network: MacNetwork; checkedAt: string }
export interface MacBandwidth {
  downloadMbps: number; uploadMbps: number; baseRttMs: number | null; responsivenessRpm: number | null
  downloadedBytes: number | null; uploadedBytes: number | null; interfaceName: string; durationMs: number; checkedAt: string
}
interface Bridge { transport?: { methods?: Record<string, (request: unknown) => Promise<{ success?: boolean; data?: unknown; error?: { message?: string } }>> } }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const optionalNumber = (v: unknown) => v === null || finite(v)
const optionalText = (v: unknown) => v === null || typeof v === 'string'
const checkedAt = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v))
let serial = 0
export const speedtestId = () => `speed_${Date.now()}_${++serial}`
export async function speedtestInvoke(method: string, params: Record<string, unknown>) {
  const call = (globalThis as unknown as { __ztoolsElectron?: Bridge }).__ztoolsElectron?.transport?.methods?.[method]
  if (!call) throw new Error(t('upgradeClient'))
  const response = await call({ messageId: speedtestId(), params, timeoutMs: 30000 })
  if (response?.success !== true || !object(response.data) || response.data.success !== true) throw new Error(resolveErrorMessage(response?.error, t('opNotConfirmed')))
  return response.data
}
export async function diagnoseNetwork(operationId: string, target?: string): Promise<MacDiagnosis> {
  const r = await speedtestInvoke('network_speedtest', { action: 'diagnose', operationId, ...(target ? { target } : {}) })
  if (r.action !== 'diagnose' || !checkedAt(r.checkedAt) || !object(r.network) || !optionalText(r.network.interfaceName) || !optionalText(r.network.gateway) || !optionalText(r.network.warning) || !Array.isArray(r.network.localAddresses) || r.network.localAddresses.some(v => typeof v !== 'string') || !Array.isArray(r.nodes) || !r.nodes.length || r.nodes.length > 6) throw new Error(t('diagnoseIncompletePayload'))
  for (const n of r.nodes) {
    if (!object(n) || typeof n.host !== 'string' || !n.host || typeof n.name !== 'string' || typeof n.group !== 'string' || !['domestic', 'global', 'custom', 'gateway'].includes(n.group) || typeof n.protocol !== 'string' || !['TCP', 'ICMP'].includes(n.protocol) || !Number.isInteger(n.port) || Number(n.port) < 0 || Number(n.port) > 65535 || !Array.isArray(n.samplesMs) || n.samplesMs.length > 3 || n.samplesMs.some(v => !finite(v)) || !optionalNumber(n.latencyMs) || !optionalNumber(n.jitterMs) || !optionalText(n.error)) throw new Error(t('invalidNodePayload'))
    const values = n.samplesMs as number[], mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
    const jitter = values.length > 1 ? values.slice(1).reduce((sum, value, i) => sum + Math.abs(value - values[i]!), 0) / (values.length - 1) : null
    if ((mean === null ? n.latencyMs !== null : typeof n.latencyMs !== 'number' || Math.abs(mean - n.latencyMs) > 0.0001) || (jitter === null ? n.jitterMs !== null : typeof n.jitterMs !== 'number' || Math.abs(jitter - n.jitterMs) > 0.0001) || (!n.error && values.length !== 3)) throw new Error(t('nodeSampleMismatch'))
  }
  return r as unknown as MacDiagnosis
}
export async function measureBandwidth(operationId: string): Promise<MacBandwidth> {
  const r = await speedtestInvoke('network_speedtest', { action: 'bandwidth', operationId })
  if (r.action !== 'bandwidth' || !finite(r.downloadMbps) || !r.downloadMbps || !finite(r.uploadMbps) || !r.uploadMbps || !optionalNumber(r.baseRttMs) || !optionalNumber(r.responsivenessRpm) || !optionalNumber(r.downloadedBytes) || !optionalNumber(r.uploadedBytes) || typeof r.interfaceName !== 'string' || !r.interfaceName || !finite(r.durationMs) || !r.durationMs || !checkedAt(r.checkedAt)) throw new Error(t('bandwidthIncompletePayload'))
  return r as unknown as MacBandwidth
}
export async function stopSpeedtest(operationId: string) {
  const r = await speedtestInvoke('network_speedtest', { action: 'cancel', operationId })
  if (typeof r.cancelled !== 'boolean') throw new Error(t('stopNotConfirmed'))
}
const numberText = (v: number | null, unit: string) => v === null ? t('notProvided') : `${v.toFixed(2)} ${unit}`
export function networkReport(bandwidth: MacBandwidth | null, diagnosis: MacDiagnosis | null) {
  const lines = [t('reportTitle')]
  if (bandwidth) lines.push(
    t('reportTime', { time: bandwidth.checkedAt }),
    t('reportTest', { secs: (bandwidth.durationMs / 1000).toFixed(1), iface: bandwidth.interfaceName }),
    t('reportSpeed', { down: numberText(bandwidth.downloadMbps, 'Mbps'), up: numberText(bandwidth.uploadMbps, 'Mbps') }),
    t('reportLatency', { latency: numberText(bandwidth.baseRttMs, 'ms'), rpm: numberText(bandwidth.responsivenessRpm, 'RPM') }),
    t('reportTraffic', { down: numberText(bandwidth.downloadedBytes === null ? null : bandwidth.downloadedBytes / 1e6, 'MB'), up: numberText(bandwidth.uploadedBytes === null ? null : bandwidth.uploadedBytes / 1e6, 'MB') })
  )
  if (diagnosis) {
    lines.push(
      t('reportRecentDiag', { time: diagnosis.checkedAt }),
      t('reportNetwork', { iface: diagnosis.network.interfaceName || t('notProvided'), local: diagnosis.network.localAddresses.join(' / ') || t('notProvided'), gateway: diagnosis.network.gateway || t('notProvided') })
    )
    if (diagnosis.network.warning) lines.push(diagnosis.network.warning)
    for (const n of diagnosis.nodes) lines.push(t('reportNodeLine', {
      name: n.name,
      target: `${n.host}${n.port ? ':' + n.port : ''}`,
      protocol: n.protocol,
      count: n.samplesMs.length,
      avg: numberText(n.latencyMs, 'ms'),
      jitter: numberText(n.jitterMs, 'ms'),
      err: n.error ? `；${n.error}` : '',
      time: n.checkedAt || diagnosis.checkedAt
    }))
  }
  lines.push(t('reportFootnote'))
  return lines.join('\n')
}
