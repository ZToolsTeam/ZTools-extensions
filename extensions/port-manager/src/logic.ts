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
          processName: getCommonProcessName(localPort) || `PID ${pid}`
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
          processName: getCommonProcessName(localPort) || `PID ${pid}`
        })
      }
    }
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
