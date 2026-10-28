type DynamicBridge = ReturnType<typeof JSON.parse>

/**
 * 网络连接查看：汇总本机各进程的 TCP / UDP 连接与监听端口，可结束正在联网的进程
 * 连接来自客户端的 process_list_ports，进程路径来自客户端的进程快照
 */

import { terminateProcess as hostTerminateProcess } from '@ztools/declarative-ui'
import {
  callHostTransport,
  isRealElectronHost,
  showRealItemInFolder
} from './native-ipc.js'

export { formatBytes } from './native-ipc.js'

export const NOT_IN_CLIENT_MESSAGE = '需要在 ZTools 客户端中使用'

export type RemoteIpScope = 'public' | 'lan' | 'loopback' | 'listening'

export interface PortEndpointItem {
  protocol: string
  localAddress: string
  localPort: number
  remoteAddress: string
  remotePort: number
  state: string
  pid: number
  processName: string
  remoteScope?: RemoteIpScope
}

export interface ProcessNetworkGroup {
  pid: number
  processName: string
  processPath: string
  tcpCount: number
  udpCount: number
  establishedCount: number
  listeningCount: number
  publicCount: number
  lanCount: number
  loopbackCount: number
  endpoints: PortEndpointItem[]
  isProtected: boolean
}

export interface FlowGuardSnapshot {
  groups: ProcessNetworkGroup[]
  totalEndpoints: number
  totalEstablished: number
  totalListening: number
  totalUdp: number
  totalPublic: number
  totalLan: number
  totalLoopback: number
  /** 读取连接失败或不在客户端里时的原因；有值时 groups 为空 */
  error?: string
}

export const FORBIDDEN_TARGET_PATTERN = new RegExp('^(?:System|svchost\\.exe|lsass\\.exe|dns\\.exe|csrss\\.exe|services\\.exe)$', 'i')
export const FORBIDDEN_REASON = '系统核心网络服务进程受保护，不能结束'

/**
 * 识别远端地址所属网络域（公网外联 / 局域网 / 本机回环 / 监听）
 */
export function classifyRemoteIpScope(remoteAddress: string, state: string, protocol: string): RemoteIpScope {
  const addr = String(remoteAddress || '').trim().toLowerCase()
  const st = String(state || '').trim().toUpperCase()
  if (
    st === 'LISTENING' ||
    st === 'LISTEN' ||
    !addr ||
    addr === '*' ||
    addr === '0.0.0.0' ||
    addr === '::' ||
    addr === '[::]'
  ) {
    return 'listening'
  }
  if (
    addr === '127.0.0.1' ||
    addr.startsWith('127.') ||
    addr === '::1' ||
    addr === '[::1]' ||
    addr === 'localhost'
  ) {
    return 'loopback'
  }
  if (
    addr.startsWith('10.') ||
    addr.startsWith('192.168.') ||
    addr.startsWith('169.254.') ||
    addr.startsWith('fe80:') ||
    addr.startsWith('[fe80:') ||
    addr.startsWith('fc00:') ||
    addr.startsWith('fd00:') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(addr)
  ) {
    return 'lan'
  }
  if (protocol.toUpperCase() === 'UDP' && (addr === '*:*' || addr === '0.0.0.0')) {
    return 'listening'
  }
  return 'public'
}

function emptySnapshot(error: string): FlowGuardSnapshot {
  return {
    groups: [],
    totalEndpoints: 0,
    totalEstablished: 0,
    totalListening: 0,
    totalUdp: 0,
    totalPublic: 0,
    totalLan: 0,
    totalLoopback: 0,
    error
  }
}

function extractRows(payload: unknown): DynamicBridge[] {
  const value = payload as DynamicBridge
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.processes)) return value.processes
  if (Array.isArray(value?.data)) return value.data
  return []
}

/**
 * 读取进程名与程序路径：先读带路径的完整快照，读不到再用基础列表。
 * 进程信息只用于补充名称和路径，读取失败不影响连接列表。
 */
async function loadProcessInfo(hostOverride?: DynamicBridge): Promise<Map<number, { name: string; path: string }>> {
  const map = new Map<number, { name: string; path: string }>()
  const snapshot = await callHostTransport<DynamicBridge>(
    'dllplugin_call',
    { plugin: 'ProcessMonitorPlugin', func: 'GetProcessList', params: {} },
    hostOverride
  )
  let rows = snapshot.ok && !snapshot.data?.error ? extractRows(snapshot.data) : []
  if (rows.length === 0) {
    const basic = await callHostTransport<DynamicBridge>('process_list', {}, hostOverride)
    rows = basic.ok ? extractRows(basic.data) : []
  }
  for (const p of rows) {
    const pid = Number(p?.pid)
    if (!Number.isInteger(pid)) continue
    map.set(pid, {
      name: typeof p?.name === 'string' ? p.name : '',
      path: p?.fieldAvailability?.path === false || typeof p?.path !== 'string' ? '' : p.path
    })
  }
  return map
}

/**
 * 读取本机的连接与端口列表并按进程汇总；读取失败时如实返回错误
 */
export async function fetchFlowGuardSnapshot(hostOverride?: DynamicBridge): Promise<FlowGuardSnapshot> {
  if (!hostOverride && !isRealElectronHost()) {
    return emptySnapshot(NOT_IN_CLIENT_MESSAGE)
  }

  const [portsRes, procMap] = await Promise.all([
    callHostTransport<PortEndpointItem[]>('process_list_ports', {}, hostOverride),
    loadProcessInfo(hostOverride)
  ])

  if (!portsRes.ok || !Array.isArray(portsRes.data)) {
    return emptySnapshot(`读取连接列表失败：${portsRes.ok ? '客户端返回的数据无效' : portsRes.error || '未知错误'}`)
  }

  const rawPorts = portsRes.data
  const groupMap = new Map<number, ProcessNetworkGroup>()

  let totalEstablished = 0
  let totalListening = 0
  let totalUdp = 0
  let totalPublic = 0
  let totalLan = 0
  let totalLoopback = 0

  for (const ep of rawPorts) {
    const pid = Number(ep.pid || 0)
    const procInfo = procMap.get(pid)
    const rawName = String(ep.processName || procInfo?.name || (pid === 4 ? 'System' : `PID-${pid}`))
    const processName =
      rawName.toLowerCase().endsWith('.exe') || rawName === 'System' || rawName.startsWith('PID-') ? rawName : `${rawName}.exe`
    const proto = String(ep.protocol || 'TCP').toUpperCase()
    const state = String(ep.state || '').toUpperCase()
    const remoteAddress = String(ep.remoteAddress || '*')
    const remoteScope = classifyRemoteIpScope(remoteAddress, state, proto)

    if (proto === 'UDP') totalUdp += 1
    if (state === 'ESTABLISHED') totalEstablished += 1
    if (state === 'LISTENING' || state === 'LISTEN') totalListening += 1
    if (remoteScope === 'public') totalPublic += 1
    else if (remoteScope === 'lan') totalLan += 1
    else if (remoteScope === 'loopback') totalLoopback += 1

    let group = groupMap.get(pid)
    if (!group) {
      group = {
        pid,
        processName,
        processPath: procInfo?.path || '',
        tcpCount: 0,
        udpCount: 0,
        establishedCount: 0,
        listeningCount: 0,
        publicCount: 0,
        lanCount: 0,
        loopbackCount: 0,
        endpoints: [],
        isProtected: pid <= 4 || FORBIDDEN_TARGET_PATTERN.test(processName) || FORBIDDEN_TARGET_PATTERN.test(rawName)
      }
      groupMap.set(pid, group)
    }

    if (proto === 'UDP') {
      group.udpCount += 1
    } else {
      group.tcpCount += 1
    }
    if (state === 'ESTABLISHED') group.establishedCount += 1
    if (state === 'LISTENING' || state === 'LISTEN') group.listeningCount += 1
    if (remoteScope === 'public') group.publicCount += 1
    else if (remoteScope === 'lan') group.lanCount += 1
    else if (remoteScope === 'loopback') group.loopbackCount += 1

    group.endpoints.push({
      protocol: proto,
      localAddress: String(ep.localAddress || '0.0.0.0'),
      localPort: Number(ep.localPort || 0),
      remoteAddress,
      remotePort: Number(ep.remotePort || 0),
      state: state || (proto === 'UDP' ? 'BOUND' : 'ACTIVE'),
      pid,
      processName,
      remoteScope
    })
  }

  const groups = Array.from(groupMap.values()).sort((a, b) => {
    if (b.publicCount !== a.publicCount) return b.publicCount - a.publicCount
    if (b.establishedCount !== a.establishedCount) return b.establishedCount - a.establishedCount
    return b.endpoints.length - a.endpoints.length
  })

  return {
    groups,
    totalEndpoints: rawPorts.length,
    totalEstablished,
    totalListening,
    totalUdp,
    totalPublic,
    totalLan,
    totalLoopback
  }
}

function describeTerminateFailure(code: string, rawMessage: string): string {
  switch (code) {
    case 'PROCESS_PROTECTED':
      return rawMessage || '该进程受保护，不能结束'
    case 'PROCESS_ACCESS_DENIED':
      return '没有权限结束该进程：它可能属于系统或其他用户，需要以管理员身份运行 ZTools'
    case 'PROCESS_IDENTITY_MISMATCH':
      return '该 PID 已不是列表里的进程（可能已退出并被复用），为避免误结束未执行，请刷新后重试'
    case 'PROCESS_TERMINATE_TIMEOUT':
      return '进程没有在限定时间内退出'
    case 'PLUGIN_PERMISSION_REQUIRED':
      return '插件没有获得结束进程的权限，请更新插件'
    case 'PLUGIN_IDENTITY_REQUIRED':
      return '无法确认插件身份，请关闭后重新打开插件再试'
    default:
      return rawMessage || '结束进程失败'
  }
}

/** 旧版客户端没有结束任意进程的接口时使用：只有客户端明确返回 terminated: true 才算成功 */
async function legacyTerminate(pid: number, hostOverride?: DynamicBridge): Promise<{ ok: boolean; error?: string }> {
  const res = await callHostTransport<DynamicBridge>(
    'dllplugin_call',
    { plugin: 'ProcessMonitorPlugin', func: 'TerminateProcessByPID', params: { pid, mode: 'force' } },
    hostOverride
  )
  if (!res.ok) {
    const notInClient = res.error === 'NO_WINDOW_ENV' || String(res.error || '').startsWith('METHOD_NOT_AVAILABLE')
    return { ok: false, error: notInClient ? NOT_IN_CLIENT_MESSAGE : res.error || '调用客户端失败' }
  }
  if (res.data?.error) return { ok: false, error: String(res.data.error) }
  if (res.data?.terminated === true) return { ok: true }
  return { ok: false, error: '客户端没有确认进程已结束，请刷新列表查看' }
}

/**
 * 强制结束整个联网进程（不是只断开某一条连接）。系统核心进程直接拒绝；
 * 经客户端结束并确认进程确实退出，失败时如实返回原因。
 */
export async function terminateNetworkProcess(
  pid: number,
  processName: string,
  hostOverride?: DynamicBridge
): Promise<{ ok: boolean; error?: string; alreadyExited?: boolean }> {
  const cleanName = String(processName || '').replace(/\.exe$/i, '')
  if (
    !Number.isInteger(pid) ||
    pid <= 4 ||
    FORBIDDEN_TARGET_PATTERN.test(processName) ||
    FORBIDDEN_TARGET_PATTERN.test(`${cleanName}.exe`)
  ) {
    return { ok: false, error: FORBIDDEN_REASON }
  }

  if (typeof hostTerminateProcess === 'function') {
    // 列表里没拿到进程名时（显示为 PID-<pid>）不做名称校验，避免误拒
    const expectedName = processName && !processName.startsWith('PID-') ? processName : undefined
    try {
      await hostTerminateProcess(pid, { mode: 'force', ...(expectedName ? { expectedName } : {}) })
      return { ok: true }
    } catch (err) {
      const code = typeof (err as { code?: unknown } | null)?.code === 'string' ? String((err as { code: string }).code) : ''
      if (code === 'PROCESS_NOT_FOUND') return { ok: true, alreadyExited: true }
      if (code !== 'HOST_FEATURE_UNAVAILABLE') {
        return { ok: false, error: describeTerminateFailure(code, err instanceof Error ? err.message : String(err)) }
      }
    }
  }
  return legacyTerminate(pid, hostOverride)
}

export async function openNetworkProcessLocation(
  processPath: string,
  hostOverride?: DynamicBridge
): Promise<boolean> {
  if (!processPath) return false
  if (!hostOverride && !isRealElectronHost()) return false
  return showRealItemInFolder(processPath, hostOverride)
}
