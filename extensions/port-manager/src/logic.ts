export interface PortRecord {
  id: string
  protocol: 'TCP' | 'UDP'
  localAddress: string
  localPort: number
  remoteAddress: string
  state: string
  pid: number
  processName: string
}

/** 保护的关键系统 PID，禁止强制杀死 */
export const PROTECTED_PIDS = new Set<number>([0, 4])

/**
 * 判断是否为系统受保护的关键进程
 */
export function isProtectedPid(pid: number): boolean {
  return PROTECTED_PIDS.has(pid)
}

/**
 * 解析 Windows `netstat -ano` 命令输出
 */
export function parseNetstatOutput(output: string): PortRecord[] {
  if (!output || typeof output !== 'string') return []

  const lines = output.split(/\r?\n/)
  const records: PortRecord[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const parts = trimmed.split(/\s+/)
    // TCP 格式: TCP    127.0.0.1:8080         0.0.0.0:0              LISTENING       1234
    // UDP 格式: UDP    0.0.0.0:5353           *:*                                    5678
    const proto = parts[0]?.toUpperCase()
    if (proto === 'TCP' && parts.length >= 5) {
      const local = parts[1] || ''
      const remote = parts[2] || ''
      const state = parts[3] || ''
      const pid = parseInt(parts[4] || '0', 10)

      const lastColon = local.lastIndexOf(':')
      const localPort = lastColon !== -1 ? parseInt(local.slice(lastColon + 1), 10) : 0
      const localAddress = lastColon !== -1 ? local.slice(0, lastColon) : local

      if (!isNaN(localPort) && localPort > 0) {
        records.push({
          id: `tcp-${localAddress}-${localPort}-${pid}`,
          protocol: 'TCP',
          localAddress,
          localPort,
          remoteAddress: remote,
          state,
          pid: isNaN(pid) ? 0 : pid,
          processName: `PID ${pid}`
        })
      }
    } else if (proto === 'UDP' && parts.length >= 4) {
      const local = parts[1] || ''
      const remote = parts[2] || ''
      const pid = parseInt(parts[3] || '0', 10)

      const lastColon = local.lastIndexOf(':')
      const localPort = lastColon !== -1 ? parseInt(local.slice(lastColon + 1), 10) : 0
      const localAddress = lastColon !== -1 ? local.slice(0, lastColon) : local

      if (!isNaN(localPort) && localPort > 0) {
        records.push({
          id: `udp-${localAddress}-${localPort}-${pid}`,
          protocol: 'UDP',
          localAddress,
          localPort,
          remoteAddress: remote,
          state: 'LISTENING',
          pid: isNaN(pid) ? 0 : pid,
          processName: `PID ${pid}`
        })
      }
    }
  }

  return records
}

/** 宿主 process_list_ports 返回的单条套接字记录（Windows / macOS 字段一致，缺失字段为空） */
export interface HostPortEntry {
  protocol?: unknown
  localAddress?: unknown
  localPort?: unknown
  remoteAddress?: unknown
  state?: unknown
  pid?: unknown
  processName?: unknown
}

/** 监听状态在不同系统上的写法：Windows netstat 为 LISTENING，macOS lsof 为 LISTEN */
const LISTEN_STATES = new Set(['LISTEN', 'LISTENING'])

/**
 * 把宿主返回的套接字列表整理成「正在占用的本地端口」：
 * 只保留 TCP 监听与 UDP 已绑定的端口（已建立的外联连接不算端口占用），同一协议 + 地址 + 端口 + PID 只留一条。
 * 宿主返回的数据不可信，字段缺失或类型不对的条目直接丢弃。
 */
export function normalizeHostPorts(entries: unknown): PortRecord[] {
  if (!Array.isArray(entries)) return []
  const seen = new Set<string>()
  const records: PortRecord[] = []
  for (const raw of entries) {
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as HostPortEntry
    const protocol = String(entry.protocol || '').toUpperCase()
    if (protocol !== 'TCP' && protocol !== 'UDP') continue
    const state = String(entry.state || '').toUpperCase()
    if (protocol === 'TCP' && !LISTEN_STATES.has(state)) continue
    const localPort = Number(entry.localPort)
    if (!Number.isInteger(localPort) || localPort <= 0 || localPort > 65535) continue
    const pidValue = Number(entry.pid)
    const pid = Number.isInteger(pidValue) && pidValue >= 0 ? pidValue : 0
    const localAddress = String(entry.localAddress || '*')
    const key = `${protocol}-${localAddress}-${localPort}-${pid}`
    if (seen.has(key)) continue
    seen.add(key)
    const hostName = typeof entry.processName === 'string' ? entry.processName.trim() : ''
    records.push({
      id: key.toLowerCase(),
      protocol: protocol as PortRecord['protocol'],
      localAddress,
      localPort,
      remoteAddress: String(entry.remoteAddress || ''),
      state: protocol === 'TCP' ? 'LISTENING' : 'BOUND',
      pid,
      processName: hostName || `PID ${pid}`
    })
  }
  return records
}

/**
 * 常见知名端口应用匹配
 */
export function getCommonProcessName(port: number): string {
  switch (port) {
    case 80:
    case 8080:
      return 'HTTP / Web Service'
    case 443:
    case 8443:
      return 'HTTPS / Web Service'
    case 3000:
      return 'Node.js / React / Next.js'
    case 5173:
      return 'Vite Dev Server'
    case 8000:
      return 'Python / Django / FastApi'
    case 3306:
      return 'MySQL Database'
    case 5432:
      return 'PostgreSQL Database'
    case 6379:
      return 'Redis Cache'
    case 27017:
      return 'MongoDB Database'
    case 9222:
      return 'Chrome / Electron CDP'
    case 11434:
      return 'Ollama Local LLM'
    default:
      return ''
  }
}
