import type { ContainerSummary, DockerLogs, DockerSnapshot } from './types.js'
interface Reply { success?: boolean; data?: unknown; error?: { message?: string } }
interface Bridge { transport?: { methods?: Record<string, (request: unknown) => Promise<Reply>> } }
let sequence = 0
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function validContainer(raw: unknown): raw is ContainerSummary {
  return record(raw) && typeof raw.id === 'string' && /^[0-9a-f]{64}$/.test(raw.id) && ['name', 'image', 'state', 'status', 'ports', 'createdAt'].every(k => typeof raw[k] === 'string') &&
    ['created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead'].includes(String(raw.state)) && (raw.cpu === null || typeof raw.cpu === 'string') && (raw.memory === null || typeof raw.memory === 'string')
}
async function invoke(params: Record<string, unknown>) {
  const call = (globalThis as unknown as { __ztoolsElectron?: Bridge }).__ztoolsElectron?.transport?.methods?.docker_manager
  if (!call) throw new Error('请升级客户端后使用容器管控')
  const result = await call({ messageId: `docker_${Date.now()}_${++sequence}`, params, timeoutMs: 240000 })
  if (result?.success !== true) throw new Error(result?.error?.message || 'Docker 请求失败')
  if (!record(result.data) || result.data.success !== true) throw new Error('客户端未确认 Docker 操作结果')
  return result.data
}
export async function listContainers(): Promise<DockerSnapshot> {
  const data = await invoke({ action: 'list' })
  if (typeof data.sessionId !== 'string' || !/^[0-9a-f-]{36}$/.test(data.sessionId) || typeof data.context !== 'string' || !Array.isArray(data.containers) || !data.containers.every(validContainer) || new Set(data.containers.map(c => c.id)).size !== data.containers.length || !(data.statsError === null || typeof data.statsError === 'string')) throw new Error('客户端返回的 Docker 列表不完整，请刷新')
  return data as unknown as DockerSnapshot
}
export async function controlContainer(sessionId: string, id: string, operation: 'start' | 'stop' | 'restart') {
  const data = await invoke({ action: 'control', sessionId, id, operation })
  if (data.id !== id || (operation === 'stop' ? !['created', 'exited', 'dead'].includes(String(data.state)) : data.state !== 'running')) throw new Error('容器操作后的状态未确认，请刷新')
}
export async function removeContainers(sessionId: string, ids: string[]) {
  const data = await invoke({ action: 'remove', sessionId, ids })
  if (!Array.isArray(data.removed) || !data.removed.every(id => typeof id === 'string' && ids.includes(id)) || !Array.isArray(data.failures) || !data.failures.every(f => record(f) && typeof f.id === 'string' && ids.includes(f.id) && typeof f.error === 'string')) throw new Error('清理结果未确认，请刷新检查实际容器状态')
  const accounted = [...data.removed, ...data.failures.map(f => f.id)]
  if (accounted.length !== ids.length || new Set(accounted).size !== ids.length) throw new Error('清理结果不完整，请刷新检查实际容器状态')
  return { removed: data.removed as string[], failures: data.failures as Array<{ id: string; error: string }> }
}
export function cleanContainerLogText(raw: string) {
  return raw.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
}
export async function getContainerTailLogs(sessionId: string, id: string): Promise<DockerLogs> {
  const data = await invoke({ action: 'logs', sessionId, id })
  if (data.id !== id || typeof data.stdout !== 'string' || typeof data.stderr !== 'string') throw new Error('客户端未返回完整的容器日志')
  return { stdout: cleanContainerLogText(data.stdout), stderr: cleanContainerLogText(data.stderr) }
}
export async function cancelDocker() { await invoke({ action: 'cancel' }) }
/** 只为明确的本机 TCP 网页端口提供入口，保留实际绑定地址，不把 UDP 或数据库端口当成网页。 */
export function containerWebUrl(ports: string): string | undefined {
  const webPorts = new Set([80, 443, 3000, 3001, 4000, 5000, 5173, 8000, 8080, 8081, 8888, 9000])
  for (const match of ports.matchAll(/(?:^|,\s*)(\[[0-9a-f:]+\]|[0-9.:]+):(\d+)->(\d+)\/tcp(?=,|$)/gi)) {
    const [, address, host, inner] = match, port = Number(host), target = Number(inner)
    if (port < 1 || port > 65535 || !webPorts.has(target)) continue
    const hostname = ['0.0.0.0', '::', '[::]'].includes(address!) ? 'localhost' : address
    return `${target === 443 ? 'https' : 'http'}://${hostname}:${port}`
  }
}

export function logMarkdown(logs?: DockerLogs): string {
  if (!logs) return '按“查看日志”读取最近 100 行。'
  const block = (raw: string) => {
    if (!raw) return '该输出流没有日志。'
    const text = raw.replace(/\r\n?/g, '\n')
    let ticks = 2, tildes = 2
    for (const match of text.matchAll(/`+|~+/g)) {
      if (match[0][0] === '`') ticks = Math.max(ticks, match[0].length)
      else tildes = Math.max(tildes, match[0].length)
    }
    const fence = (ticks <= tildes ? '`' : '~').repeat(Math.min(ticks, tildes) + 1)
    return `${fence}text\n${text}\n${fence}`
  }
  return `### 标准输出\n\n${block(logs.stdout)}\n\n### 标准错误输出\n\n${block(logs.stderr)}`
}
