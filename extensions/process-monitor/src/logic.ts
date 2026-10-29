import { terminateProcess as hostTerminateProcess, isZToolsHostError } from '@ztools/declarative-ui'
import {
  callHostTransport,
  formatBytes,
  invokeDllPluginCapability,
  isRealElectronHost
} from './native-ipc.js'

export { formatBytes } from './native-ipc.js'

export interface CapabilityActionItem {
  id: string
  title: string
  subtitle: string
  tag: string
  method: string
  params: Record<string, unknown>
}

export interface NativeInvocationResult {
  ok: boolean
  pluginName: string
  method: string
  data?: unknown
  error?: string
  fromFallback?: boolean
}

export type ProcessSortKey = 'cpu' | 'memory' | 'name' | 'pid'
export type ProcessTerminateMode = 'force' | 'tree' | 'graceful'

export interface ProcessItem {
  pid: number
  name: string
  parentPid: number
  threadCount?: number
  handleCount?: number
  path: string
  workingSetBytes: number
  memoryBytes: number
  privateBytes: number
  cpuPercent: number
  startTime?: number
  isSystem: boolean
  description?: string
  companyName?: string
  commandLine?: string
}

export interface SystemInfoData {
  cpuUsagePercent: number
  cpuCoreCount: number
  totalMemoryBytes: number
  usedMemoryBytes: number
  availableMemoryBytes: number
  totalMemory: number
  availableMemory: number
  memoryUsagePercent: number
  processCount: number
  threadCount: number
}

export interface ProcessServiceInfo {
  name: string
  serviceName: string
  displayName: string
  status: string | number
  startType: string
  description: string
}

export interface ProcessDetailInfo {
  pid: number
  name: string
  path: string
  commandLine: string
  companyName: string
  fileDescription: string
  fileVersion: string
  productName: string
  signerName: string
  startTime: string
  handleCount: number | null
  peakMemoryBytes: number | null
  memoryBytes: number
  privateBytes: number | null
  threadCount: number | null
  parentPid: number | null
}

export interface ResourceFocusSummary {
  topCpu: ProcessItem | null
  topMemory: ProcessItem | null
}

export const DLL_PLUGIN_NAME = 'ProcessMonitorPlugin'

/** 不在 ZTools 客户端里运行（拿不到宿主通道）时的提示；此时不显示任何示例进程 */
export const NOT_IN_CLIENT_MESSAGE = '需要在 ZTools 客户端中使用'

// Windows 内核与会话管理进程：结束后会蓝屏或会话崩溃
export const WINDOWS_CRITICAL_PROCESS_NAMES = [
  'System',
  'Idle',
  'Registry',
  'MemCompression',
  'csrss.exe',
  'smss.exe',
  'wininit.exe',
  'services.exe',
  'lsass.exe',
  'winlogon.exe',
  'fontdrvhost.exe',
  'dwm.exe'
]

// macOS 内核、launchd 与登录会话 / 安全 / 日志等核心守护进程：结束后会内核崩溃、注销当前用户或系统失去响应
export const MACOS_CRITICAL_PROCESS_NAMES = [
  'kernel_task',
  'launchd',
  'WindowServer',
  'loginwindow',
  'logd',
  'opendirectoryd',
  'securityd',
  'coreservicesd',
  'configd',
  'notifyd',
  'diskarbitrationd',
  'fseventsd',
  'watchdogd'
]

// 两个平台的进程名互不重叠，合并成一份名单，插件在两端都按同一规则拦截
export const CRITICAL_PROCESS_NAMES = [...WINDOWS_CRITICAL_PROCESS_NAMES, ...MACOS_CRITICAL_PROCESS_NAMES]

// 系统界面进程：结束后程序坞 / 桌面 / 菜单栏会短暂消失并由系统自动重启，允许结束但必须高危确认
export const HIGH_RISK_PROCESS_NAMES = ['Dock', 'Finder', 'SystemUIServer', 'ControlCenter', 'NotificationCenter']

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export const FORBIDDEN_TARGET_PATTERN = new RegExp(
  `^(?:0|4|${CRITICAL_PROCESS_NAMES.map(escapeRegExp).join('|')})$`,
  'i'
)
export const FORBIDDEN_REASON = '系统内核与会话管理关键进程受保护：结束后会导致系统崩溃或当前用户被注销，已拦截'

function includesName(list: string[], name: string): boolean {
  const lower = String(name || '').toLowerCase()
  return lower !== '' && list.some((c) => c.toLowerCase() === lower)
}

export type TerminationRisk = 'forbidden' | 'high-risk' | 'normal'

/**
 * 结束进程前的风险分级：forbidden 直接拒绝（不弹确认、不调用宿主），high-risk 需高危确认，normal 普通确认
 */
export function getTerminationRisk(pid: number, name: string): TerminationRisk {
  if (pid === 0 || pid === 1 || pid === 4) return 'forbidden'
  if (includesName(CRITICAL_PROCESS_NAMES, name)) return 'forbidden'
  if (includesName(HIGH_RISK_PROCESS_NAMES, name)) return 'high-risk'
  return 'normal'
}

// macOS 系统组件所在目录；/System 下的 Applications（计算器、Safari 所在的 Cryptex 等）是用户应用，不算系统进程
const MACOS_SYSTEM_PATH_PATTERN = /^\/(?:System|usr\/libexec|usr\/sbin|sbin|Library\/Apple)\//
const MACOS_SYSTEM_APPS_PATTERN = /^\/System\/(?:[^/]+\/)*Applications\//

export function isMacSystemPath(pathStr: string): boolean {
  return MACOS_SYSTEM_PATH_PATTERN.test(pathStr) && !MACOS_SYSTEM_APPS_PATTERN.test(pathStr)
}

const PRESET_ITEMS: CapabilityActionItem[] = [
  {
    id: 'proc-list-all',
    title: '获取全量活动进程快照 (按内存与 CPU 排序)',
    subtitle: '展示进程 PID、工作集内存、命令行参数与数字签名状态',
    tag: '进程快照',
    method: 'GetProcessList',
    params: {
      includeCommandLine: true
    }
  },
  {
    id: 'proc-sys-info',
    title: '查看系统全局 CPU / 物理内存 / 句柄负载摘要',
    subtitle: '监控系统提交内存峰值、线程总数与内核分页池占用',
    tag: '系统负载',
    method: 'GetSystemInfo',
    params: {}
  },
  {
    id: 'proc-services',
    title: '穿透查询宿主进程 (svchost) 承载的底层服务',
    subtitle: '定位高占用 svchost.exe 实例背后关联的具体 Windows 服务名',
    tag: '服务穿透',
    method: 'GetServicesByPID',
    params: {
      pid: 1044
    }
  },
  {
    id: 'proc-terminate',
    title: '强制终止无响应/挂死的应用进程',
    subtitle: '调用 Win32 TerminateProcess 立即回收卡死应用资源',
    tag: '强制结束',
    method: 'TerminateProcessByPID',
    params: {
      pid: 28888
    }
  }
]

export function getCapabilityItems(): CapabilityActionItem[] {
  return PRESET_ITEMS.map((item) => ({
    ...item,
    params: { ...item.params }
  }))
}

export function filterCapabilityItems(items: CapabilityActionItem[], query: string): CapabilityActionItem[] {
  if (!Array.isArray(items)) return []
  const q = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (!q) return items
  return items.filter((item) => {
    if (!item || typeof item.title !== 'string') return false
    return (
      item.title.toLowerCase().includes(q) ||
      item.subtitle.toLowerCase().includes(q) ||
      item.tag.toLowerCase().includes(q) ||
      item.method.toLowerCase().includes(q)
    )
  })
}

export function validateInvocationPayload(method: string, params: unknown): { valid: boolean; error?: string } {
  if (typeof method !== 'string' || method.trim().length === 0) {
    return { valid: false, error: 'INVALID_METHOD: 调用方法名不能为空' }
  }
  if (method.length > 128 || !/^[A-Za-z0-9_]+$/.test(method.trim())) {
    return { valid: false, error: 'INVALID_METHOD_FORMAT: 方法名包含非法字符或超长' }
  }
  if (params === null || params === undefined || typeof params !== 'object' || Array.isArray(params)) {
    return { valid: false, error: 'INVALID_PARAMS: 参数必须为非空对象' }
  }

  const record = params as Record<string, unknown>
  for (const [key, val] of Object.entries(record)) {
    if (typeof val === 'string') {
      if (val.length > 4096) {
        return { valid: false, error: `PARAM_TOO_LONG: 参数 ${key} 超过最大长度限制` }
      }
      if (FORBIDDEN_TARGET_PATTERN.test(val)) {
        return { valid: false, error: `SECURITY_INTERCEPTED: ${FORBIDDEN_REASON}` }
      }
    } else if (typeof val === 'number') {
      if (!Number.isFinite(val) || val < -1000 || val > 100_000_000) {
        return { valid: false, error: `PARAM_OUT_OF_RANGE: 数值参数 ${key} 越界或非有限数` }
      }
    }
  }

  return { valid: true }
}

export async function invokeNativeCapability(
  method: string,
  params: Record<string, unknown>,
  hostBridge?: unknown
): Promise<NativeInvocationResult> {
  const check = validateInvocationPayload(method, params)
  if (!check.valid) {
    throw new Error(check.error || '参数校验失败')
  }
  const res = await invokeDllPluginCapability(DLL_PLUGIN_NAME, method, params, hostBridge)
  return {
    ok: res.ok,
    pluginName: DLL_PLUGIN_NAME,
    method: method.trim(),
    data: res.data ?? undefined,
    error: res.error,
    fromFallback: res.fromFallback
  }
}

/** 宿主返回的原始对象按字段读取；null / undefined 视为空对象（与可选链读取结果一致） */
type RawRecord = Record<string, unknown>

function asRecord(value: unknown): RawRecord {
  return (value ?? {}) as RawRecord
}

export function normalizeProcessItem(input: unknown): ProcessItem {
  const raw = asRecord(input)
  const pid = Number(raw.pid ?? 0)
  const name = String(raw.name || `PID-${pid}`)
  const pathStr = String(raw.path || '')
  const workingSetBytes = Math.max(
    0,
    Number(raw.workingSetBytes ?? raw.memoryBytes ?? raw.memoryUsage ?? 0)
  )
  const privateBytes = Math.max(
    0,
    Number(raw.privateBytes ?? workingSetBytes)
  )
  const cpuPercent = Math.max(
    0,
    Number(raw.cpuPercent ?? raw.cpuUsage ?? 0)
  )
  const isWindowsSys =
    pid === 0 ||
    pid === 4 ||
    includesName(WINDOWS_CRITICAL_PROCESS_NAMES, name) ||
    /^c:\\windows\\(?:system32|syswow64|servicing)/i.test(pathStr) ||
    /^(?:svchost|dwm|conhost|fontdrvhost|sihost|taskhostw|RuntimeBroker|SearchIndexer|WmiPrvSE|spoolsv|audiodg|dllhost|dashost|smartscreen|SecurityHealthService|MsMpEng)\.exe$/i.test(
      name
    )
  const isMacSys = includesName(MACOS_CRITICAL_PROCESS_NAMES, name) || isMacSystemPath(pathStr)
  // 宿主给了 isSystem 时以它为准，但 macOS 宿主兜底只按 pid <= 4 标记（launchd 之外的守护进程都是 false），
  // 所以 macOS 系统目录下的进程仍按路径判为系统进程；Windows 宿主的判定（会话 0、排除记事本等交互工具）不再被插件规则覆盖
  const hostIsSystem = raw.isSystem
  const isSys = typeof hostIsSystem === 'boolean' ? hostIsSystem || isMacSys : isWindowsSys || isMacSys

  // 宿主没给线程数（macOS 的 process_list 不返回）时保持 undefined，界面不显示，不能用 1 冒充
  const rawThreads = Number(raw.threadCount)
  const threadCount = Number.isFinite(rawThreads) && rawThreads > 0 ? Math.round(rawThreads) : undefined
  const parentPid = Math.max(0, Number(raw.parentPid ?? 0))
  const handleCount = Math.max(0, Number(raw.handleCount ?? 0))

  return {
    pid,
    name,
    parentPid,
    threadCount,
    handleCount,
    path: pathStr,
    workingSetBytes,
    memoryBytes: workingSetBytes,
    privateBytes,
    cpuPercent,
    isSystem: isSys,
    description: String(raw.description || name),
    // 宿主没给的发布者、命令行保持为空，不按路径或进程名猜测
    companyName: String(raw.companyName || ''),
    commandLine: String(raw.commandLine || '')
  }
}

export async function fetchProcesses(host?: unknown): Promise<ProcessItem[]> {
  // 1. 优先通过 ProcessMonitorPlugin (GetProcessList) 获取完整字段快照（含真实 CPU%、路径、线程数、PPID、命令行）
  try {
    const res = await invokeNativeCapability('GetProcessList', { includeCommandLine: true }, host)
    if (res.ok && !res.fromFallback && res.data && typeof res.data === 'object') {
      const rawList = Array.isArray(res.data)
        ? res.data
        : Array.isArray((res.data as RawRecord).processes)
        ? ((res.data as RawRecord).processes as unknown[])
        : []
      if (rawList.length > 0) {
        return rawList.map((item: unknown) => normalizeProcessItem(item))
      }
    }
  } catch (err) {
    console.warn('[process-monitor] GetProcessList fallback:', err)
  }

  // 2. 兼容通过 Preload Transport 调用 process_list 获取进程列表
  if (host || isRealElectronHost(host)) {
    const ipcRes = await callHostTransport<unknown[]>('process_list', {}, host)
    if (ipcRes.ok && Array.isArray(ipcRes.data)) {
      return ipcRes.data.map((p) => normalizeProcessItem(p))
    }
  }

  if (host || isRealElectronHost()) throw new Error('无法读取进程列表')
  throw new Error(NOT_IN_CLIENT_MESSAGE)
}

export async function fetchSystemInfo(host?: unknown): Promise<SystemInfoData> {
  // 1. 优先通过 ProcessMonitorPlugin (GetSystemInfo) 获取完整系统负载摘要
  try {
    const res = await invokeNativeCapability('GetSystemInfo', {}, host)
    if (res.ok && !res.fromFallback && res.data && typeof res.data === 'object') {
      const d = asRecord('info' in res.data ? (res.data as RawRecord).info : res.data)
      const total = Number(d.totalMemoryBytes ?? d.totalMemory ?? 0)
      if (total > 0) {
        const avail = Number(d.availableMemoryBytes ?? d.availableMemory ?? 0)
        const used = Number(d.usedMemoryBytes ?? Math.max(0, total - avail))
        const memPct = Number(d.memoryUsagePercent ?? Math.round((used / total) * 100))
        return {
          cpuUsagePercent: Number(d.cpuUsagePercent ?? 0),
          cpuCoreCount: Number(d.cpuCoreCount ?? 0),
          totalMemoryBytes: total,
          usedMemoryBytes: used,
          availableMemoryBytes: avail,
          totalMemory: total,
          availableMemory: avail,
          memoryUsagePercent: memPct,
          processCount: Number(d.processCount ?? 0),
          threadCount: Number(d.threadCount ?? 0)
        }
      }
    }
  } catch (err) {
    console.warn('[process-monitor] GetSystemInfo fallback:', err)
  }

  // 2. 兼容通过 system_get_memory_usage / system_get_hardware_summary / system_get_cpu_usage 获取
  if (host || isRealElectronHost(host)) {
    const [memRes, hwRes, cpuRes] = await Promise.all([
      callHostTransport<{ total: number; used: number; available: number; percent: number }>(
        'system_get_memory_usage',
        {},
        host
      ),
      callHostTransport<{ logicalCpuCount: number; totalMemory: number }>(
        'system_get_hardware_summary',
        {},
        host
      ),
      callHostTransport<{ total: number }>('system_get_cpu_usage', {}, host)
    ])
    if (memRes.ok && memRes.data && typeof memRes.data.total === 'number' && memRes.data.total > 0) {
      const total = memRes.data.total
      const avail = memRes.data.available
      const used = memRes.data.used ?? Math.max(0, total - avail)
      return {
        cpuUsagePercent: cpuRes.ok && typeof cpuRes.data?.total === 'number' ? cpuRes.data.total : 0,
        cpuCoreCount: hwRes.ok && hwRes.data?.logicalCpuCount ? hwRes.data.logicalCpuCount : 0,
        totalMemoryBytes: total,
        usedMemoryBytes: used,
        availableMemoryBytes: avail,
        totalMemory: total,
        availableMemory: avail,
        memoryUsagePercent: memRes.data.percent,
        processCount: 0,
        threadCount: 0
      }
    }
  }

  if (host || isRealElectronHost()) throw new Error('无法读取系统负载，请检查宿主能力后重试')
  throw new Error(NOT_IN_CLIENT_MESSAGE)
}

/**
 * macOS 宿主兜底的进程详情没有真实命令行（ps 只给可执行文件路径），会把路径填进 commandLine；
 * 与路径完全相同的命令行无法证明是真实启动参数，按“未提供”处理，不能把路径当命令行复制
 */
function realCommandLine(value: unknown, pathStr: string): string {
  const text = String(value || '').trim()
  return text && text !== pathStr.trim() ? text : ''
}

/** macOS 宿主兜底把进程名填进产品名称 / 文件描述；与进程名相同的值不是读到的版本信息，留空 */
function notDerivedFromName(value: unknown, name: string): string {
  const text = String(value || '').trim()
  return text && text.toLowerCase() !== name.trim().toLowerCase() ? text : ''
}

export async function fetchProcessDetail(pid: number, host?: unknown): Promise<ProcessDetailInfo | null> {
  if (!Number.isInteger(pid) || pid <= 0) return null

  try {
    const res = await invokeNativeCapability('GetProcessDetail', { pid }, host)
    if (res.ok && !res.fromFallback && res.data && typeof res.data === 'object') {
      const rawValue: unknown = 'detail' in res.data ? (res.data as RawRecord).detail : res.data
      const raw = rawValue ? asRecord(rawValue) : null
      if (raw && !raw.error) {
        const mem = Number(raw.memoryBytes ?? raw.peakMemoryBytes ?? 0)
        const name = String(raw.name || `PID-${pid}`)
        const pathStr = String(raw.path || '')
        return {
          pid: Number(raw.pid ?? pid),
          name,
          path: pathStr,
          commandLine: realCommandLine(raw.commandLine, pathStr),
          companyName: String(raw.companyName || ''),
          fileDescription: notDerivedFromName(raw.fileDescription, name),
          fileVersion: String(raw.fileVersion || ''),
          productName: notDerivedFromName(raw.productName, name),
          signerName: String(raw.signerName || ''),
          startTime: String(raw.startTime || ''),
          handleCount: (raw.handleCount == null ? null : Number(raw.handleCount)),
          peakMemoryBytes: (raw.peakMemoryBytes == null ? null : Number(raw.peakMemoryBytes)),
          memoryBytes: mem,
          privateBytes: (raw.privateBytes == null ? null : Number(raw.privateBytes)),
          threadCount: (raw.threadCount == null ? null : Number(raw.threadCount)),
          parentPid: (raw.parentPid == null ? null : Number(raw.parentPid))
        }
      }
    }
  } catch (err) {
    console.warn('[process-monitor] fetchProcessDetail error:', err)
  }

  if (host || isRealElectronHost(host)) {
    const infoRes = await callHostTransport<{
      pid: number
      name: string
      path: string
      cpuUsage: number
      memoryUsage: number
      privateBytes?: number
      peakMemoryBytes?: number
      handleCount?: number
      threadCount?: number
      parentPid?: number
    }>('process_info', { pid }, host)
    if (infoRes.ok && infoRes.data) {
      const mem = Number(infoRes.data.memoryUsage || 0)
      return {
        pid,
        name: infoRes.data.name || `PID-${pid}`,
        path: infoRes.data.path || '',
        // process_info 不返回启动命令行，留空，不能拿路径或进程名冒充
        commandLine: '',
        // process_info 只有基础字段：签名、发布者、版本拿不到就留空，界面据此提示“未提供”，不按路径猜测
        companyName: '',
        fileDescription: '',
        fileVersion: '',
        productName: '',
        signerName: '',
        startTime: '',
        memoryBytes: mem,
        privateBytes: (infoRes.data.privateBytes == null ? null : Number(infoRes.data.privateBytes)),
        peakMemoryBytes: (infoRes.data.peakMemoryBytes == null ? null : Number(infoRes.data.peakMemoryBytes)),
        handleCount: (infoRes.data.handleCount == null ? null : Number(infoRes.data.handleCount)),
        threadCount: (infoRes.data.threadCount == null ? null : Number(infoRes.data.threadCount)),
        parentPid: (infoRes.data.parentPid == null ? null : Number(infoRes.data.parentPid))
      }
    }
  }

  return null
}

export async function fetchServicesByPID(pid: number, host?: unknown): Promise<ProcessServiceInfo[]> {
  if (!Number.isInteger(pid) || pid <= 0) return []

  try {
    const res = await invokeNativeCapability('GetServicesByPID', { pid }, host)
    if (res.ok && !res.fromFallback && res.data && typeof res.data === 'object') {
      const rawList = Array.isArray(res.data)
        ? res.data
        : Array.isArray((res.data as RawRecord).services)
        ? ((res.data as RawRecord).services as unknown[])
        : []
      return rawList.map((item: unknown) => {
        const s = asRecord(item)
        return {
          name: String(s.serviceName || s.name || ''),
          serviceName: String(s.serviceName || s.name || ''),
          displayName: String(s.displayName || s.serviceName || s.name || ''),
          // 宿主没给状态与启动类型时留空，不填「运行中」「自动」
          status: (s.status ?? '') as string | number,
          startType: String(s.startType || ''),
          description: String(s.description || '')
        }
      })
    }
  } catch (err) {
    console.warn('[process-monitor] fetchServicesByPID fallback:', err)
  }

  return []
}

export interface TerminateOutcome {
  ok: boolean
  error?: string
  mode?: ProcessTerminateMode
  /** 宿主错误码（如 PROCESS_PROTECTED、PROCESS_TERMINATE_TIMEOUT） */
  code?: string
  /** 平缓关闭超时：可由用户再次确认后强制结束（宿主不会自动升级） */
  canForce?: boolean
  /** 结束前进程已经退出 */
  alreadyExited?: boolean
}

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
      if (details?.reason === 'graceful-rejected') return { code, message: '程序拒绝正常关闭（例如控制台程序或正在等待保存）' }
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
      return { code, message: raw || '终止进程失败' }
  }
}

/**
 * 结束进程：force = 强制结束，tree = 强制结束并连同子孙进程，graceful = 请求正常退出。
 *
 * 走宿主 process_terminate_pid（plugin.json 声明 "process" 权限）：保护名单、pid 复用校验（expectedName）、
 * 复查进程确实退出都在宿主完成；graceful 超时返回 canForce，由界面再次确认，不自动升级。
 * 宿主过旧（HOST_FEATURE_UNAVAILABLE）或测试注入了 host 时，回落到旧的 DLL / process_kill 路径。
 */
export async function terminateProcess(
  pid: number,
  name: string,
  modeOrHost?: ProcessTerminateMode | unknown,
  maybeHost?: unknown
): Promise<TerminateOutcome> {
  const mode: ProcessTerminateMode =
    modeOrHost === 'force' || modeOrHost === 'tree' || modeOrHost === 'graceful'
      ? modeOrHost
      : 'force'
  const host =
    modeOrHost === 'force' || modeOrHost === 'tree' || modeOrHost === 'graceful'
      ? maybeHost
      : modeOrHost

  if (!Number.isInteger(pid) || pid < 0) {
    return { ok: false, error: 'INVALID_PID: 进程 PID 无效' }
  }

  if (getTerminationRisk(pid, name) === 'forbidden' || FORBIDDEN_TARGET_PATTERN.test(String(name || ''))) {
    return { ok: false, error: FORBIDDEN_REASON }
  }

  if (!host) {
    // 列表里没拿到进程名时（显示为 PID-<pid>）不做名称校验，避免误拒
    const expectedName = name && name !== `PID-${pid}` ? name : undefined
    try {
      await hostTerminateProcess(pid, {
        mode: mode === 'graceful' ? 'graceful' : 'force',
        tree: mode === 'tree',
        ...(expectedName ? { expectedName } : {})
      })
      return { ok: true, mode }
    } catch (err) {
      const info = describeTerminateError(err)
      if (info.code === 'PROCESS_NOT_FOUND') return { ok: true, mode, alreadyExited: true }
      if (info.code !== 'HOST_FEATURE_UNAVAILABLE') {
        return {
          ok: false,
          mode,
          code: info.code,
          error: info.message,
          canForce: mode === 'graceful' && info.code === 'PROCESS_TERMINATE_TIMEOUT'
        }
      }
    }
  }
  return legacyTerminateProcess(pid, name, mode, host)
}

/** 旧宿主兼容：Windows DLL TerminateProcessByPID，失败再试 process_kill（只能结束本窗口启动的子进程） */
async function legacyTerminateProcess(pid: number, name: string, mode: ProcessTerminateMode, host?: unknown): Promise<TerminateOutcome> {
  const upgradeHint = '当前 ZTools 版本不支持结束其他程序的进程，请升级 ZTools'
  try {
    const res = await invokeNativeCapability(
      'TerminateProcessByPID',
      {
        pid,
        name,
        mode,
        force: mode !== 'graceful',
        tree: mode === 'tree'
      },
      host
    )
    if (!res.fromFallback) {
      if (res.ok) {
        return { ok: true, mode }
      }
      const killRes = await callHostTransport('process_kill', { pid, force: mode !== 'graceful' }, host)
      if (killRes.ok) {
        return { ok: true, mode }
      }
      return { ok: false, mode, error: res.error || '终止进程失败' }
    }
  } catch (err: unknown) {
    return { ok: false, mode, error: err instanceof Error ? err.message : String(err) }
  }

  if (host || isRealElectronHost(host)) {
    const killRes = await callHostTransport('process_kill', { pid, force: mode !== 'graceful' }, host)
    if (killRes.ok) {
      return { ok: true, mode }
    }
    return { ok: false, mode, error: killRes.error || upgradeHint }
  }

  // 没有宿主（浏览器预览）：如实报告无法结束，不假装成功
  return { ok: false, mode, error: upgradeHint }
}

export async function openFileLocation(filePath: string, host?: unknown): Promise<boolean> {
  if (!filePath || typeof filePath !== 'string' || !filePath.trim()) return false
  if (host || isRealElectronHost(host)) {
    // 只在文件管理器中显示，不回落到 shell_open_path：对可执行文件“打开”就是运行它
    const shown = await callHostTransport('shell_show_item_in_folder', { fullPath: filePath }, host)
    if (shown.ok) return true
  }
  try {
    const res = await invokeNativeCapability('OpenFileLocation', { path: filePath }, host)
    return res.ok
  } catch (err) {
    console.warn('[process-monitor] openFileLocation error:', err)
    return false
  }
}

export function getResourceFocus(list: ProcessItem[]): ResourceFocusSummary {
  if (!Array.isArray(list) || list.length === 0) {
    return { topCpu: null, topMemory: null }
  }
  let topCpu: ProcessItem | null = null
  let topMemory: ProcessItem | null = null
  for (const item of list) {
    if (!item) continue
    if (!topCpu || item.cpuPercent > topCpu.cpuPercent) {
      topCpu = item
    }
    const mem = item.workingSetBytes ?? item.memoryBytes ?? 0
    const topMemVal = topMemory ? (topMemory.workingSetBytes ?? topMemory.memoryBytes ?? 0) : -1
    if (!topMemory || mem > topMemVal) {
      topMemory = item
    }
  }
  return { topCpu, topMemory }
}

export function filterProcesses(
  list: ProcessItem[],
  query: string,
  tab: string = 'all',
  sortBy: ProcessSortKey = 'cpu'
): ProcessItem[] {
  if (!Array.isArray(list)) return []
  let filtered = list

  if (tab === 'user') {
    filtered = filtered.filter((p) => !p.isSystem)
  } else if (tab === 'system') {
    filtered = filtered.filter((p) => p.isSystem)
  }

  const q = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (q) {
    filtered = filtered.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        String(p.pid).includes(q) ||
        (p.path && p.path.toLowerCase().includes(q)) ||
        (p.description && p.description.toLowerCase().includes(q)) ||
        (p.companyName && p.companyName.toLowerCase().includes(q))
    )
  }

  return filtered.slice().sort((a, b) => {
    const memA = a.workingSetBytes ?? a.memoryBytes ?? 0
    const memB = b.workingSetBytes ?? b.memoryBytes ?? 0
    if (sortBy === 'memory') {
      if (memB !== memA) return memB - memA
      return b.cpuPercent - a.cpuPercent
    }
    if (sortBy === 'name') {
      const cmp = a.name.localeCompare(b.name)
      return cmp !== 0 ? cmp : a.pid - b.pid
    }
    if (sortBy === 'pid') {
      return a.pid - b.pid
    }
    // 默认: cpu 优先，次选内存降序
    if (Math.abs(b.cpuPercent - a.cpuPercent) >= 0.1) {
      return b.cpuPercent - a.cpuPercent
    }
    return memB - memA
  })
}

function getFallbackCoreCount(): number {
  try {
    const n = Number((globalThis as { navigator?: { hardwareConcurrency?: unknown } }).navigator?.hardwareConcurrency)
    return Number.isFinite(n) && n > 0 ? n : 1
  } catch {
    return 1
  }
}

/**
 * 状态条的整机 CPU 占用：优先用宿主按全部核心计算的 cpuUsagePercent；
 * 拿不到时才用各进程占用之和除以逻辑核数（ps 的 pcpu 以单核为 100%，直接相加会远超整机占用）
 */
export function resolveCpuLoadPercent(
  systemInfo: Pick<SystemInfoData, 'cpuUsagePercent' | 'cpuCoreCount'> | null | undefined,
  processes: Array<Pick<ProcessItem, 'cpuPercent'>>
): number {
  const clamp = (v: number) => Math.min(100, Math.max(0, Math.round(v)))
  const sysCpu = Number(systemInfo?.cpuUsagePercent)
  if (Number.isFinite(sysCpu) && sysCpu > 0) return clamp(sysCpu)
  const sum = (Array.isArray(processes) ? processes : []).reduce((acc, p) => {
    const v = Number(p?.cpuPercent)
    return acc + (Number.isFinite(v) && v > 0 ? v : 0)
  }, 0)
  if (sum <= 0) return 0
  const cores = Number(systemInfo?.cpuCoreCount)
  return clamp(sum / (Number.isFinite(cores) && cores > 0 ? cores : getFallbackCoreCount()))
}

export interface ProcessProfileField {
  title: string
  text: string
}

/**
 * 「数字签名与托管服务」画像：只收录宿主真实给出的签名 / 发布者 / 版本 / 服务字段，空字段不展示；
 * 返回空数组表示当前系统没有提供这些信息（例如 macOS 上没有 Windows 签名与服务数据）
 */
export function describeProcessProfile(
  proc: Pick<ProcessItem, 'name'>,
  detail: ProcessDetailInfo | null | undefined,
  services: ProcessServiceInfo[] | null | undefined
): ProcessProfileField[] {
  const fields: ProcessProfileField[] = []
  const add = (title: string, value: unknown) => {
    const text = typeof value === 'string' ? value.trim() : ''
    if (text) fields.push({ title, text })
  }
  if (detail) {
    add('数字签名', detail.signerName)
    add('发布者', detail.companyName)
    add('产品名称', detail.productName)
    if (detail.fileDescription && detail.fileDescription.trim() !== proc.name) {
      add('文件描述', detail.fileDescription)
    }
    add('文件版本', detail.fileVersion)
  }
  for (const svc of Array.isArray(services) ? services : []) {
    const id = String(svc?.serviceName || svc?.name || '').trim()
    if (!id) continue
    const display = String(svc?.displayName || '').trim()
    const status = String(svc?.status ?? '').trim()
    add(`托管服务 ${id}`, [display && display !== id ? display : '', status].filter(Boolean).join(' · ') || id)
  }
  return fields
}

export interface ProcessPort { pid: number; localPort: number; protocol: string; localAddress: string; processName: string; state: string }

/** 端口快照：visibility 为 visible-processes 时只列出了当前用户可见进程的套接字（macOS lsof 兜底） */
export interface ProcessPortSnapshot { rows: ProcessPort[]; partial: boolean }

/** 占用（监听）本地端口的套接字状态：TCP 监听（macOS LISTEN、Windows LISTENING）与 UDP 绑定 */
const OCCUPYING_STATES = new Set(['LISTEN', 'LISTENING', 'BOUND'])

/** 宿主没给状态（旧宿主）时无法判断，按占用处理，避免漏掉 */
export function isOccupyingPort(row: Pick<ProcessPort, 'state'>): boolean {
  const state = String(row?.state || '').toUpperCase()
  return !state || OCCUPYING_STATES.has(state)
}

/** 读取宿主原始响应，保留与端口数组同层的 visibility（通用解包只取 data 数组，会丢掉它） */
async function callPortsTransportRaw(host?: unknown): Promise<unknown> {
  const h = host as Record<string, unknown> | undefined
  if (h && typeof h.process_list_ports === 'function') return (h.process_list_ports as (p: unknown) => unknown)({})
  if (typeof window === 'undefined') throw new Error('无法读取端口占用')
  const w = window as unknown as { __ztoolsElectron?: { transport?: { methods?: Record<string, unknown> } }; ztools?: { transport?: { methods?: Record<string, unknown> } } }
  const fn = (w.__ztoolsElectron?.transport?.methods || w.ztools?.transport?.methods)?.process_list_ports
  if (typeof fn !== 'function') throw new Error('当前 ZTools 版本不支持端口查询，请升级 ZTools')
  return (fn as (req: unknown) => unknown)({ messageId: `process_list_ports_${Date.now()}`, params: {} })
}

function transportErrorText(value: unknown): string {
  if (value && typeof value === 'object') {
    const e = value as Record<string, unknown>
    return String(e.message || e.code || '无法读取端口占用')
  }
  return String(value || '无法读取端口占用')
}

export async function fetchProcessPortSnapshot(host?: unknown): Promise<ProcessPortSnapshot> {
  let layer: unknown = await callPortsTransportRaw(host)
  let rows: unknown[] | undefined
  let partial = false
  // 逐层解包：preload 信封 → 宿主结果 { success, data: [...], source, visibility }；也兼容直接给数组
  for (let depth = 0; depth < 4 && rows === undefined; depth++) {
    if (Array.isArray(layer)) { rows = layer; break }
    if (!layer || typeof layer !== 'object') break
    const record = layer as Record<string, unknown>
    if (record.success === false) throw new Error(transportErrorText(record.error))
    if (record.visibility === 'visible-processes') partial = true
    if (Array.isArray(record.data)) rows = record.data
    else layer = record.data
  }
  if (!rows) throw new Error('无法读取端口占用')
  return {
    partial,
    rows: rows.flatMap((value: unknown) => {
      if (!value || typeof value !== 'object') return []
      const row = value as Record<string, unknown>
      if (typeof row.pid !== 'number' || !Number.isInteger(row.pid) || row.pid <= 0 || typeof row.localPort !== 'number' || !Number.isInteger(row.localPort) || row.localPort <= 0 || row.localPort > 65535) return []
      return [{ pid: row.pid, localPort: row.localPort, protocol: String(row.protocol || ''), localAddress: String(row.localAddress || ''), processName: String(row.processName || ''), state: String(row.state || '') }]
    })
  }
}

export async function fetchProcessPorts(host?: unknown): Promise<ProcessPort[]> {
  return (await fetchProcessPortSnapshot(host)).rows
}

/** 查询具体端口时匹配该本地端口的全部套接字；未输入端口时只列出监听 / 绑定端口的进程（不含连接外部用的临时端口） */
export function matchPortRows(ports: ProcessPort[], query: string): ProcessPort[] {
  const value = query.trim().replace(/^port:/i, '').trim()
  if (value && !/^\d{1,5}$/.test(value)) return []
  return ports.filter((p) => (value ? p.localPort === Number(value) : isOccupyingPort(p)))
}

export function filterProcessesByPort(processes: ProcessItem[], ports: ProcessPort[], query: string): ProcessItem[] {
  const pids = new Set(matchPortRows(ports, query).map((p) => p.pid))
  return processes.filter((p) => pids.has(p.pid))
}
