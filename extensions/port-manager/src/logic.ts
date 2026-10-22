import {
  terminateProcess as hostTerminateProcess,
  isZToolsHostError,
  type TerminateProcessOptions,
  type TerminateProcessResult
} from '@ztools/declarative-ui'

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

/**
 * 保护的关键系统 PID，禁止结束：
 * 0 = 内核 / System Idle，1 = macOS launchd（所有用户进程的根），4 = Windows System
 */
export const PROTECTED_PIDS = new Set<number>([0, 1, 4])

/**
 * 判断是否为系统受保护的关键进程（非正整数 PID 一律视为不可结束）
 */
export function isProtectedPid(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 1) return true
  return PROTECTED_PIDS.has(pid)
}

/** ZTools 宿主自身的进程名（macOS 为 ZTools / ZTools Helper…，Windows 为 ZTools.exe） */
const HOST_PROCESS_NAME = /^ztools\b/i

/**
 * 返回不允许结束该进程的原因；可以结束时返回 null。
 * 结束宿主自身会让插件和主窗口一起退出，结束系统关键进程会导致系统异常，都直接拒绝。
 */
export function getTerminateBlockReason(record: Pick<PortRecord, 'pid' | 'processName'>): string | null {
  if (isProtectedPid(record.pid)) return `PID ${record.pid} 是系统关键进程，不能结束`
  if (HOST_PROCESS_NAME.test(String(record.processName || '').trim())) {
    return `${record.processName} 是 ZTools 自身的进程，结束后 ZTools 会退出`
  }
  return null
}

/** 宿主结束进程函数（与 SDK terminateProcess 同签名，便于测试注入） */
export type TerminateFn = (pid: number, options: TerminateProcessOptions) => Promise<TerminateProcessResult>

export type TerminateResult =
  | { ok: true; forced: boolean; alreadyExited: boolean }
  | { ok: false; code: string; error: string; canForce: boolean }

const PROTECTED_REASON_TEXT: Record<string, string> = {
  system: '这是系统关键进程，宿主已拦截',
  'host-self': '这是 ZTools 自身的进程，结束后 ZTools 会退出',
  'host-ancestor': '这是启动 ZTools 的上级进程，结束后 ZTools 会一起退出',
  'host-child': '这是 ZTools 的内部进程（渲染、GPU 或后台服务），不能结束'
}

/** 把宿主结束进程的错误码换成用户能看懂的原因；未知错误按宿主原文提示 */
export function describeTerminateError(err: unknown): { code: string; message: string } {
  const code = isZToolsHostError(err) ? err.code : 'PROCESS_ERROR'
  const details = isZToolsHostError(err) ? err.details : undefined
  const raw = err instanceof Error ? err.message : String(err)
  switch (code) {
    case 'PROCESS_PROTECTED':
      return { code, message: PROTECTED_REASON_TEXT[String(details?.reason)] || '该进程受保护，不能结束' }
    case 'PROCESS_NOT_FOUND':
      return { code, message: '进程已经退出' }
    case 'PROCESS_ACCESS_DENIED':
      return { code, message: '没有权限结束该进程：它可能属于系统或其他用户，需要管理员权限' }
    case 'PROCESS_IDENTITY_MISMATCH':
      return { code, message: '该 PID 已不是列表里的进程（可能已退出并被复用），为避免误杀未执行，请刷新后重试' }
    case 'PROCESS_TERMINATE_TIMEOUT': {
      const still = Array.isArray(details?.stillRunning) ? (details!.stillRunning as unknown[]).filter((p) => Number.isInteger(p)) : []
      return { code, message: `进程没有在限定时间内退出${still.length ? `（仍在运行：PID ${still.join(', ')}）` : ''}` }
    }
    case 'PLUGIN_PERMISSION_REQUIRED':
      return { code, message: '插件没有声明结束进程权限，请更新插件' }
    case 'PLUGIN_IDENTITY_REQUIRED':
      return { code, message: '无法确认插件身份，请关闭后重新打开插件再试' }
    case 'HOST_FEATURE_UNAVAILABLE':
      return { code, message: '当前 ZTools 版本不支持结束其他程序的进程，请升级 ZTools' }
    default:
      return { code, message: raw || '结束进程失败' }
  }
}

/**
 * 结束占用端口的进程（宿主 process_terminate_pid：保护名单、复查进程确实退出都在宿主完成）。
 * graceful 请求进程正常退出，给它保存数据、释放端口的机会；超时不会自动升级为强制结束，
 * 由界面再次询问用户（canForce）。进程在结束前已经退出按成功处理（alreadyExited）。
 *
 * 不传 expectedName：端口列表里的进程名来自 netstat（macOS 会截断，Windows 为空），与进程快照里的名称对不上会误拒。
 */
export async function terminatePid(
  pid: number,
  mode: 'graceful' | 'force',
  terminate: TerminateFn = hostTerminateProcess
): Promise<TerminateResult> {
  try {
    await terminate(pid, { mode })
    return { ok: true, forced: mode === 'force', alreadyExited: false }
  } catch (err) {
    const info = describeTerminateError(err)
    if (info.code === 'PROCESS_NOT_FOUND') return { ok: true, forced: false, alreadyExited: true }
    return {
      ok: false,
      code: info.code,
      error: info.message,
      canForce: mode === 'graceful' && info.code === 'PROCESS_TERMINATE_TIMEOUT'
    }
  }
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
      processName: hostName || getCommonProcessName(localPort) || `PID ${pid}`
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
