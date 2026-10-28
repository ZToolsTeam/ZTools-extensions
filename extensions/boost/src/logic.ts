/**
 * 开机启动项业务逻辑：列出高内存进程、“启动”文件夹里的项目与临时文件，
 * 经确认后结束进程或把文件移入回收站。不读取注册表、计划任务或系统服务。
 */

import { confirmAlert, terminateProcess as hostTerminateProcess } from '@ztools/declarative-ui'
import {
  callHostTransport,
  formatBytes,
  getRealFileSize,
  getRealSystemPath,
  isRealElectronHost,
  readRealDirectory,
  showRealItemInFolder,
  trashRealItem
} from './native-ipc.js'

export { formatBytes } from './native-ipc.js'

type DynamicBridge = ReturnType<typeof JSON.parse>

export const NOT_IN_CLIENT_MESSAGE = '需要在 ZTools 客户端中使用'

export type StartupScope = '用户启动文件夹' | '公共启动文件夹' | '常驻进程（按名称判断）'

export interface BoostCandidateItem {
  id: string
  type: 'process' | 'startup_item' | 'temp_cache'
  pid?: number
  name: string
  path: string
  memoryOrSizeBytes: number
  isProtected: boolean
  /** 不能处理的原因（受保护进程、公共启动文件夹等） */
  lockedReason?: string
  startupScope?: StartupScope
  /** 进程内存占用高（进程超过 300 MB，常驻进程超过 150 MB） */
  isHighMemory: boolean
  recommendation: string
}

export interface BoostSnapshot {
  totalMemoryBytes: number
  usedMemoryBytes: number
  memoryUsagePercent: number
  startupItemCount: number
  candidates: BoostCandidateItem[]
  /** 部分数据读取失败的原因；不在客户端里时只有一条 NOT_IN_CLIENT_MESSAGE */
  errors: string[]
}

export const FORBIDDEN_TARGET_PATTERN = new RegExp(
  '^(?:Windows Defender|SecurityHealth|lsass|csrss|svchost|wininit|System|explorer|dwm|ZTools|electron)(?:\\.exe)?$',
  'i'
)
export const FORBIDDEN_REASON = '系统核心进程或 ZTools 自身进程受保护，不能结束'
const COMMON_STARTUP_REASON = '公共启动文件夹里的项目对所有用户生效，插件不能移除，请在系统设置中管理'

const HIGH_MEMORY_PROCESS_BYTES = 300 * 1024 * 1024
const HIGH_MEMORY_RESIDENT_BYTES = 150 * 1024 * 1024
const AUTOSTART_PATTERNS = /onedrive|edgeupdate|googleupdate|steam|wechat|qq|dingtalk|feishu|todesk|sunlogin|nvidia|radeon|razer|logi|clash|tailscale|docker|wps|baidu|thunder|everything/i

interface RawProcess {
  pid: number
  name: string
  path: string
  memoryBytes: number
  isSystem: boolean
}

function emptySnapshot(errors: string[]): BoostSnapshot {
  return { totalMemoryBytes: 0, usedMemoryBytes: 0, memoryUsagePercent: 0, startupItemCount: 0, candidates: [], errors }
}

function extractRows(payload: unknown): DynamicBridge[] | null {
  const value = payload as DynamicBridge
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.processes)) return value.processes
  if (Array.isArray(value?.data)) return value.data
  return null
}

function toRawProcess(p: DynamicBridge): RawProcess | null {
  const pid = Number(p?.pid)
  if (!Number.isInteger(pid) || pid < 0) return null
  const memory = Number(p?.workingSetBytes ?? p?.memoryUsage ?? 0)
  return {
    pid,
    name: typeof p?.name === 'string' && p.name.trim() ? p.name.trim() : `PID-${pid}`,
    path: p?.fieldAvailability?.path === false || typeof p?.path !== 'string' ? '' : p.path.trim(),
    memoryBytes: Number.isFinite(memory) && memory > 0 ? memory : 0,
    isSystem: p?.isSystem === true
  }
}

/** 先读带路径与系统进程标记的完整快照，读不到再用只有进程名和内存的基础列表 */
async function loadProcesses(hostOverride?: DynamicBridge): Promise<{ list: RawProcess[]; error?: string }> {
  const snapshot = await callHostTransport<DynamicBridge>(
    'dllplugin_call',
    { plugin: 'ProcessMonitorPlugin', func: 'GetProcessList', params: {} },
    hostOverride
  )
  const snapshotRows = snapshot.ok && !snapshot.data?.error ? extractRows(snapshot.data) : null
  if (snapshotRows && snapshotRows.length > 0) {
    return { list: snapshotRows.map(toRawProcess).filter((p): p is RawProcess => p !== null) }
  }
  const basic = await callHostTransport<DynamicBridge>('process_list', {}, hostOverride)
  const basicRows = basic.ok ? extractRows(basic.data) : null
  if (basicRows && basicRows.length > 0) {
    return { list: basicRows.map(toRawProcess).filter((p): p is RawProcess => p !== null) }
  }
  return { list: [], error: `读取进程列表失败：${basic.ok ? '列表为空' : basic.error || '未知错误'}` }
}

function processProtection(p: RawProcess): string | undefined {
  const baseName = p.name.replace(/\.exe$/i, '')
  if (
    p.pid <= 4 ||
    p.isSystem ||
    FORBIDDEN_TARGET_PATTERN.test(p.name) ||
    FORBIDDEN_TARGET_PATTERN.test(baseName) ||
    /^c:\\windows\\/i.test(p.path)
  ) {
    return FORBIDDEN_REASON
  }
  return undefined
}

/**
 * 扫描“启动”文件夹里的项目，以及名称属于常见自启软件的正在运行的进程
 */
async function scanStartupItems(
  allProcs: RawProcess[],
  errors: string[],
  hostOverride?: DynamicBridge
): Promise<BoostCandidateItem[]> {
  const items: BoostCandidateItem[] = []
  // 读不到当前用户的 AppData 时不猜测路径，避免读到其他用户的启动文件夹
  const appData = await getRealSystemPath('appData', hostOverride)
  if (!appData) errors.push('读取当前用户的“启动”文件夹位置失败')
  const userStartup = appData ? `${appData}\\Microsoft\\Windows\\Start Menu\\Programs\\Startup` : ''
  const commonStartup = 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\StartUp'
  const folders: Array<{ dir: string; scope: StartupScope }> = [
    { dir: userStartup, scope: '用户启动文件夹' },
    { dir: commonStartup, scope: '公共启动文件夹' }
  ]

  for (const f of folders) {
    if (!f.dir) continue
    const entries = await readRealDirectory(f.dir, hostOverride)
    for (const entry of entries) {
      if (entry.isDirectory || entry.name.toLowerCase() === 'desktop.ini') continue
      const isCommon = f.scope === '公共启动文件夹'
      items.push({
        id: `boost-startup-file-${f.scope}-${entry.name}`,
        type: 'startup_item',
        name: `[开机启动] ${entry.name.replace(/\.(?:lnk|url|bat|cmd)$/i, '')}`,
        path: entry.path || `${f.dir}\\${entry.name}`,
        memoryOrSizeBytes: entry.sizeBytes > 0 ? entry.sizeBytes : 0,
        isProtected: isCommon,
        ...(isCommon ? { lockedReason: COMMON_STARTUP_REASON } : {}),
        startupScope: f.scope,
        isHighMemory: false,
        recommendation: isCommon
          ? `位于${f.scope}，${COMMON_STARTUP_REASON}`
          : `位于${f.scope}，登录 Windows 时自动打开；移入回收站后不再随开机打开，可从回收站还原`
      })
    }
  }

  const seenNames = new Set<string>()
  for (const p of allProcs) {
    const lower = p.name.toLowerCase()
    if (seenNames.has(lower)) continue
    if (AUTOSTART_PATTERNS.test(p.name) || AUTOSTART_PATTERNS.test(p.path)) {
      seenNames.add(lower)
      const protection = processProtection(p)
      items.push({
        id: `boost-startup-proc-${p.pid}`,
        type: 'startup_item',
        pid: p.pid,
        name: `[自启常驻] ${p.name}`,
        path: p.path,
        memoryOrSizeBytes: p.memoryBytes,
        isProtected: Boolean(protection),
        ...(protection ? { lockedReason: protection } : {}),
        startupScope: '常驻进程（按名称判断）',
        isHighMemory: p.memoryBytes > HIGH_MEMORY_RESIDENT_BYTES,
        recommendation: `名称属于常见自启软件，当前占用 ${formatBytes(p.memoryBytes)}；结束进程只影响本次运行，不会取消它的开机启动`
      })
    }
  }

  return items
}

/**
 * 读取内存占用、高内存进程、开机启动项与临时文件；部分读取失败时在 errors 里如实说明
 */
export async function fetchBoostSnapshot(hostOverride?: DynamicBridge): Promise<BoostSnapshot> {
  if (!hostOverride && !isRealElectronHost()) {
    return emptySnapshot([NOT_IN_CLIENT_MESSAGE])
  }

  const errors: string[] = []
  const [memRes, procs, tempDir] = await Promise.all([
    callHostTransport<DynamicBridge>('system_get_memory_usage', {}, hostOverride),
    loadProcesses(hostOverride),
    getRealSystemPath('temp', hostOverride)
  ])
  if (procs.error) errors.push(procs.error)

  const total = memRes.ok ? Number(memRes.data?.total) : NaN
  const used = memRes.ok ? Number(memRes.data?.used) : NaN
  const memoryKnown = Number.isFinite(total) && total > 0 && Number.isFinite(used) && used >= 0
  if (!memoryKnown) errors.push(`读取内存占用失败：${memRes.ok ? '客户端返回的数据无效' : memRes.error || '未知错误'}`)
  const totalMemoryBytes = memoryKnown ? total : 0
  const usedMemoryBytes = memoryKnown ? used : 0
  const memoryUsagePercent = memoryKnown ? Math.round((used / total) * 1000) / 10 : 0

  const candidates: BoostCandidateItem[] = []
  const sorted = procs.list.slice().sort((a, b) => b.memoryBytes - a.memoryBytes).slice(0, 30)
  for (const p of sorted) {
    const protection = processProtection(p)
    const isHighMemory = p.memoryBytes > HIGH_MEMORY_PROCESS_BYTES
    candidates.push({
      id: `boost-proc-${p.pid}`,
      type: 'process',
      pid: p.pid,
      name: p.name,
      path: p.path,
      memoryOrSizeBytes: p.memoryBytes,
      isProtected: Boolean(protection),
      ...(protection ? { lockedReason: protection } : {}),
      isHighMemory,
      recommendation: protection
        ? '系统核心或 ZTools 自身进程，受保护'
        : '结束进程会释放它占用的内存，进程里未保存的内容会丢失'
    })
  }

  const startupItems = await scanStartupItems(procs.list, errors, hostOverride)
  candidates.push(...startupItems)

  if (tempDir) {
    const tempEntries = await readRealDirectory(tempDir, hostOverride)
    const slice = tempEntries.filter(e => !e.isDirectory).slice(0, 15)
    for (let i = 0; i < slice.length; i++) {
      const entry = slice[i]
      const sz = entry.sizeBytes > 0 ? entry.sizeBytes : await getRealFileSize(entry.path, hostOverride)
      if (sz <= 0) continue
      const fName = entry.name || entry.path.split(/[\\/]/).pop() || entry.path
      candidates.push({
        id: `boost-temp-${i}-${fName}`,
        type: 'temp_cache',
        name: `[临时文件] ${fName}`,
        path: entry.path,
        memoryOrSizeBytes: sz,
        isProtected: false,
        isHighMemory: false,
        recommendation: '临时文件夹里的文件，可能仍在被程序使用；移入回收站后可还原'
      })
    }
  } else {
    errors.push('读取临时文件夹位置失败')
  }

  return {
    totalMemoryBytes,
    usedMemoryBytes,
    memoryUsagePercent,
    startupItemCount: startupItems.length,
    candidates,
    errors
  }
}

function describeTerminateFailure(code: string, rawMessage: string): string {
  switch (code) {
    case 'PROCESS_PROTECTED':
      return rawMessage || '该进程受保护，不能结束'
    case 'PROCESS_ACCESS_DENIED':
      return '没有权限结束该进程：它可能属于系统或其他用户，需要以管理员身份运行 ZTools'
    case 'PROCESS_IDENTITY_MISMATCH':
      return '该 PID 已不是列表里的进程（可能已退出并被复用），为避免误结束未执行，请重新扫描'
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
  return { ok: false, error: '客户端没有确认进程已结束，请重新扫描查看' }
}

/**
 * 强制结束进程：拦截受保护进程，经客户端结束并确认进程确实退出，失败时如实返回原因
 */
export async function terminateBoostProcess(
  pid: number,
  name: string,
  hostOverride?: DynamicBridge
): Promise<{ ok: boolean; error?: string; alreadyExited?: boolean }> {
  const processName = name.replace(/^\[自启常驻\]\s*/i, '')
  const baseName = processName.replace(/\.exe$/i, '')
  if (!Number.isInteger(pid) || pid <= 4 || FORBIDDEN_TARGET_PATTERN.test(processName) || FORBIDDEN_TARGET_PATTERN.test(baseName)) {
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

export interface BoostExecutionResult {
  succeeded: BoostCandidateItem[]
  failed: Array<{ item: BoostCandidateItem; error: string }>
  /** 成功处理的项目合计占用（进程内存或文件大小） */
  handledBytes: number
}

/** 只保留可以处理的勾选项：去掉受保护项，同一进程只处理一次 */
export function selectActionableItems(candidates: BoostCandidateItem[], checkedIds: string[]): BoostCandidateItem[] {
  const checked = new Set(checkedIds)
  const seenPids = new Set<number>()
  const result: BoostCandidateItem[] = []
  for (const item of candidates) {
    if (!checked.has(item.id) || item.isProtected) continue
    if (item.pid !== undefined) {
      if (seenPids.has(item.pid)) continue
      seenPids.add(item.pid)
    }
    result.push(item)
  }
  return result
}

/** 按项目类型说明将要发生什么，用于执行前的确认框 */
export function describeBoostPlan(items: BoostCandidateItem[]): string {
  const processCount = items.filter(i => i.pid !== undefined).length
  const startupFileCount = items.filter(i => i.type === 'startup_item' && i.pid === undefined).length
  const tempCount = items.filter(i => i.type === 'temp_cache').length
  const parts: string[] = []
  if (processCount > 0) parts.push(`强制结束 ${processCount} 个进程（进程里未保存的内容会丢失）`)
  if (startupFileCount > 0) parts.push(`把 ${startupFileCount} 个“启动”文件夹里的项目移入回收站（之后不再随开机打开）`)
  if (tempCount > 0) parts.push(`把 ${tempCount} 个临时文件移入回收站`)
  return `将${parts.join('；')}。没有勾选的项目不会处理。`
}

/**
 * 逐项处理已勾选的项目：进程强制结束，文件移入回收站。只处理传入的项目，失败的项目逐条记录原因。
 */
export async function executeBoostItems(items: BoostCandidateItem[], hostOverride?: DynamicBridge): Promise<BoostExecutionResult> {
  const result: BoostExecutionResult = { succeeded: [], failed: [], handledBytes: 0 }
  for (const item of items) {
    if (item.isProtected) {
      result.failed.push({ item, error: item.lockedReason || FORBIDDEN_REASON })
      continue
    }
    const res =
      item.pid !== undefined
        ? await terminateBoostProcess(item.pid, item.name, hostOverride)
        : await trashRealItem(item.path, hostOverride)
    if (res.ok) {
      result.succeeded.push(item)
      result.handledBytes += item.memoryOrSizeBytes
    } else {
      const notInClient = res.error === 'NO_WINDOW_ENV' || String(res.error || '').startsWith('METHOD_NOT_AVAILABLE')
      result.failed.push({ item, error: notInClient ? NOT_IN_CLIENT_MESSAGE : res.error || '处理失败' })
    }
  }
  return result
}

/**
 * 弹出确认框，说明会结束哪些进程、移走哪些文件；用户确认后才处理。没有可处理的勾选项或用户取消时返回 null。
 */
export async function confirmAndExecuteBoost(
  candidates: BoostCandidateItem[],
  checkedIds: string[],
  hostOverride?: DynamicBridge
): Promise<BoostExecutionResult | null> {
  const items = selectActionableItems(candidates, checkedIds)
  if (items.length === 0) return null
  const confirmed = await confirmAlert({
    title: `处理已勾选的 ${items.length} 个项目？`,
    message: describeBoostPlan(items),
    primaryAction: { title: '确认处理', style: 'destructive' }
  })
  if (!confirmed) return null
  return executeBoostItems(items, hostOverride)
}

export async function openBoostItemLocation(path: string, hostOverride?: DynamicBridge): Promise<boolean> {
  if (!path) return false
  if (!hostOverride && !isRealElectronHost()) return false
  return showRealItemInFolder(path, hostOverride)
}
