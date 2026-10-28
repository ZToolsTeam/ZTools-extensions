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
  if (!call) throw new Error('请升级客户端后使用 Mac 网络测速')
  const response = await call({ messageId: speedtestId(), params, timeoutMs: 30000 })
  if (response?.success !== true || !object(response.data) || response.data.success !== true) throw new Error(response?.error?.message || '测速操作未确认成功')
  return response.data
}
export async function diagnoseNetwork(operationId: string, target?: string): Promise<MacDiagnosis> {
  const r = await speedtestInvoke('network_speedtest', { action: 'diagnose', operationId, ...(target ? { target } : {}) })
  if (r.action !== 'diagnose' || !checkedAt(r.checkedAt) || !object(r.network) || !optionalText(r.network.interfaceName) || !optionalText(r.network.gateway) || !optionalText(r.network.warning) || !Array.isArray(r.network.localAddresses) || r.network.localAddresses.some(v => typeof v !== 'string') || !Array.isArray(r.nodes) || !r.nodes.length || r.nodes.length > 6) throw new Error('网络诊断回执不完整')
  for (const n of r.nodes) {
    if (!object(n) || typeof n.host !== 'string' || !n.host || typeof n.name !== 'string' || typeof n.group !== 'string' || !['domestic', 'global', 'custom', 'gateway'].includes(n.group) || typeof n.protocol !== 'string' || !['TCP', 'ICMP'].includes(n.protocol) || !Number.isInteger(n.port) || Number(n.port) < 0 || Number(n.port) > 65535 || !Array.isArray(n.samplesMs) || n.samplesMs.length > 3 || n.samplesMs.some(v => !finite(v)) || !optionalNumber(n.latencyMs) || !optionalNumber(n.jitterMs) || !optionalText(n.error)) throw new Error('网络节点回执无效')
    const values = n.samplesMs as number[], mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
    const jitter = values.length > 1 ? values.slice(1).reduce((sum, value, i) => sum + Math.abs(value - values[i]!), 0) / (values.length - 1) : null
    if ((mean === null ? n.latencyMs !== null : typeof n.latencyMs !== 'number' || Math.abs(mean - n.latencyMs) > 0.0001) || (jitter === null ? n.jitterMs !== null : typeof n.jitterMs !== 'number' || Math.abs(jitter - n.jitterMs) > 0.0001) || (!n.error && values.length !== 3)) throw new Error('节点结果与实测样本不一致')
  }
  return r as unknown as MacDiagnosis
}
export async function measureBandwidth(operationId: string): Promise<MacBandwidth> {
  const r = await speedtestInvoke('network_speedtest', { action: 'bandwidth', operationId })
  if (r.action !== 'bandwidth' || !finite(r.downloadMbps) || !r.downloadMbps || !finite(r.uploadMbps) || !r.uploadMbps || !optionalNumber(r.baseRttMs) || !optionalNumber(r.responsivenessRpm) || !optionalNumber(r.downloadedBytes) || !optionalNumber(r.uploadedBytes) || typeof r.interfaceName !== 'string' || !r.interfaceName || !finite(r.durationMs) || !r.durationMs || !checkedAt(r.checkedAt)) throw new Error('测速未返回完整的真实数据')
  return r as unknown as MacBandwidth
}
export async function stopSpeedtest(operationId: string) {
  const r = await speedtestInvoke('network_speedtest', { action: 'cancel', operationId })
  if (typeof r.cancelled !== 'boolean') throw new Error('未确认测速已停止')
}
const numberText = (v: number | null, unit: string) => v === null ? '未提供' : `${v.toFixed(2)} ${unit}`
export function networkReport(bandwidth: MacBandwidth | null, diagnosis: MacDiagnosis | null) {
  const lines = ['ZTools 网络测速报告']
  if (bandwidth) lines.push(`测速时间：${bandwidth.checkedAt}`, `测试：Apple networkQuality，15 秒样本，实际用时 ${(bandwidth.durationMs / 1000).toFixed(1)} 秒，网卡 ${bandwidth.interfaceName}`, `下载 ${numberText(bandwidth.downloadMbps, 'Mbps')}；上传 ${numberText(bandwidth.uploadMbps, 'Mbps')}`, `空闲延迟 ${numberText(bandwidth.baseRttMs, 'ms')}；负载响应 ${numberText(bandwidth.responsivenessRpm, 'RPM')}`, `下载流量 ${numberText(bandwidth.downloadedBytes === null ? null : bandwidth.downloadedBytes / 1e6, 'MB')}；上传流量 ${numberText(bandwidth.uploadedBytes === null ? null : bandwidth.uploadedBytes / 1e6, 'MB')}`)
  if (diagnosis) {
    lines.push(`最近节点检测：${diagnosis.checkedAt}`, `默认网卡 ${diagnosis.network.interfaceName || '未提供'}；本机 ${diagnosis.network.localAddresses.join(' / ') || '未提供'}；网关 ${diagnosis.network.gateway || '未提供'}`)
    if (diagnosis.network.warning) lines.push(diagnosis.network.warning)
    for (const n of diagnosis.nodes) lines.push(`${n.name} (${n.host}${n.port ? ':' + n.port : ''}) ${n.protocol}：${n.samplesMs.length}/3 响应，平均 ${numberText(n.latencyMs, 'ms')}，抖动 ${numberText(n.jitterMs, 'ms')}${n.error ? '；' + n.error : ''}；检测时间 ${n.checkedAt || diagnosis.checkedAt}`)
  }
  lines.push('节点检测仅验证连接，不代表网站业务可用；测速受当前网络、VPN 和测试服务影响。')
  return lines.join('\n')
}
