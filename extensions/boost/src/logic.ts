/**
 * 系统极速加速与内存负载优化业务逻辑层 (Boost Logic)
 * 真实采集物理内存工作集、CPU 负载、高占用后台进程与 %TEMP% 缓存，提供安全回收与进程终止
 */

import {
  callHostTransport,
  getRealFileSize,
  getRealSystemPath,
  listRealDirectoryContents,
  showRealItemInFolder,
  trashRealItem
} from '../../shared/native-ipc'

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

export interface BoostCandidateItem {
  id: string
  type: 'process' | 'temp_cache'
  pid?: number
  name: string
  path: string
  memoryOrSizeBytes: number
  cpuPercent: number
  isProtected: boolean
  recommendation: string
}

export interface BoostSnapshot {
  totalMemoryBytes: number
  usedMemoryBytes: number
  availableMemoryBytes: number
  memoryUsagePercent: number
  cpuUsagePercent: number
  reclaimableEstimateBytes: number
  candidates: BoostCandidateItem[]
}

export const DLL_PLUGIN_NAME = 'BoostPlugin'
export const FORBIDDEN_TARGET_PATTERN = new RegExp(
  '^(?:Windows Defender|SecurityHealth|lsass|csrss|svchost|wininit|System|explorer|dwm|ZTools|electron)(?:\\.exe)?$',
  'i'
)
export const FORBIDDEN_REASON = '系统安全与核心引导启动项受保护，严禁禁用'

const PRESET_ITEMS: CapabilityActionItem[] = [
  {
    id: 'boost-registry-run',
    title: 'HKCU/HKLM 注册表自启动应用优化',
    subtitle: '扫描并禁用随系统登录自动拉起的第三方后台驻留程序',
    tag: '高耗时项',
    method: 'DisableItem',
    params: { category: 'registry', itemId: 'third-party-updater' }
  },
  {
    id: 'boost-scheduled-task',
    title: '计划任务自动更新器清理',
    subtitle: '禁用第三方软件定时唤醒与后台静默更新任务',
    tag: '计划任务',
    method: 'DisableItem',
    params: { category: 'scheduled_task', itemId: 'auto-update-task' }
  },
  {
    id: 'boost-services',
    title: '非核心第三方后台服务延迟/禁用',
    subtitle: '识别冗余云盘同步、打印辅助与遥测服务',
    tag: '后台服务',
    method: 'DisableItem',
    params: { category: 'service', itemId: 'telemetry-helper' }
  },
  {
    id: 'boost-startup-folder',
    title: '开始菜单 Startup 启动目录巡检',
    subtitle: '管理用户与公共启动目录下的快捷方式',
    tag: '启动目录',
    method: 'StartScanAsync',
    params: { scope: 'all' }
  }
]

export function getCapabilityItems(): CapabilityActionItem[] {
  return PRESET_ITEMS.map(item => ({
    ...item,
    params: { ...item.params }
  }))
}

export function filterCapabilityItems(items: CapabilityActionItem[], query: string): CapabilityActionItem[] {
  if (!Array.isArray(items)) return []
  const q = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (!q) return items
  return items.filter(item => {
    if (!item || typeof item.title !== 'string') return false
    return (
      item.title.toLowerCase().includes(q) ||
      item.subtitle.toLowerCase().includes(q) ||
      item.tag.toLowerCase().includes(q) ||
      item.method.toLowerCase().includes(q)
    )
  })
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const k = 1024
  const idx = Math.min(units.length - 1, Math.max(0, Math.floor(Math.log(bytes) / Math.log(k))))
  const val = bytes / Math.pow(k, idx)
  return `${val >= 100 || idx === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`
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
  hostBridge?: { dllplugin?: { call?: (plugin: string, fn: string, payload: unknown) => Promise<unknown> } }
): Promise<NativeInvocationResult> {
  const check = validateInvocationPayload(method, params)
  if (!check.valid) {
    throw new Error(check.error || '参数校验失败')
  }

  const runtimeHost = hostBridge ?? (typeof (globalThis as any).ztools !== 'undefined' ? (globalThis as any).ztools : undefined)
  const callFn = runtimeHost?.dllplugin?.call

  if (typeof callFn === 'function') {
    try {
      const raw = await callFn(DLL_PLUGIN_NAME, method.trim(), params)
      let parsed: unknown = raw
      if (typeof raw === 'string') {
        try {
          parsed = JSON.parse(raw)
        } catch {
          throw new Error('MALFORMED_DLL_RESPONSE: 原生组件返回了损坏的 JSON 数据')
        }
      }
      if (parsed && typeof parsed === 'object' && 'error' in (parsed as Record<string, unknown>)) {
        const errMsg = String((parsed as Record<string, unknown>).error || '原生组件返回未知错误')
        return {
          ok: false,
          pluginName: DLL_PLUGIN_NAME,
          method: method.trim(),
          error: `DLL_ERROR: ${errMsg}`
        }
      }
      return {
        ok: true,
        pluginName: DLL_PLUGIN_NAME,
        method: method.trim(),
        data: parsed,
        fromFallback: false
      }
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.startsWith('MALFORMED_DLL_RESPONSE:')) {
        throw err
      }
      return {
        ok: false,
        pluginName: DLL_PLUGIN_NAME,
        method: method.trim(),
        error: `NATIVE_CALL_FAILED: ${message}`
      }
    }
  }

  return {
    ok: true,
    pluginName: DLL_PLUGIN_NAME,
    method: method.trim(),
    data: { simulated: true, method: method.trim(), params },
    fromFallback: true
  }
}

/**
 * 采集本机真实内存工作集、CPU 负载与可优化高占用候选列表
 */
export async function fetchBoostSnapshot(hostOverride?: any): Promise<BoostSnapshot> {
  const [memRes, cpuRes, procsRes, tempDir] = await Promise.all([
    callHostTransport<{ total: number; used: number; available: number; percent: number }>(
      'system_get_memory_usage',
      {},
      hostOverride
    ),
    callHostTransport<{ total: number }>('system_get_cpu_usage', {}, hostOverride),
    callHostTransport<Array<{ pid: number; name: string; path: string; cpuUsage: number; memoryUsage: number }>>(
      'process_list',
      {},
      hostOverride
    ),
    getRealSystemPath('temp', hostOverride)
  ])

  const totalMemoryBytes = memRes.ok && memRes.data?.total ? memRes.data.total : 0
  const usedMemoryBytes = memRes.ok && memRes.data?.used ? memRes.data.used : 0
  const availableMemoryBytes = memRes.ok && memRes.data?.available ? memRes.data.available : 0
  const memoryUsagePercent = memRes.ok && typeof memRes.data?.percent === 'number' ? memRes.data.percent : 0
  const cpuUsagePercent = cpuRes.ok && typeof cpuRes.data?.total === 'number' ? Math.round(cpuRes.data.total) : 0

  const candidates: BoostCandidateItem[] = []
  let reclaimableEstimateBytes = 0

  if (procsRes.ok && Array.isArray(procsRes.data)) {
    const sorted = procsRes.data
      .slice()
      .sort((a, b) => (b.memoryUsage || 0) - (a.memoryUsage || 0))
      .slice(0, 30)

    for (const p of sorted) {
      const name = String(p.name || 'Unknown')
      const baseName = name.replace(/\.exe$/i, '')
      const isProtected =
        p.pid <= 4 ||
        FORBIDDEN_TARGET_PATTERN.test(name) ||
        FORBIDDEN_TARGET_PATTERN.test(baseName) ||
        /^c:\\windows\\system32/i.test(p.path || '')
      const mem = Number(p.memoryUsage || 0)
      if (!isProtected) {
        reclaimableEstimateBytes += Math.round(mem * 0.35)
      }
      candidates.push({
        id: `boost-proc-${p.pid}`,
        type: 'process',
        pid: Number(p.pid),
        name,
        path: String(p.path || ''),
        memoryOrSizeBytes: mem,
        cpuPercent: typeof p.cpuUsage === 'number' ? p.cpuUsage : 0,
        isProtected,
        recommendation: isProtected
          ? '系统核心/宿主驻留进程 (受保护自动跳过)'
          : mem > 300 * 1024 * 1024
          ? '高内存占用应用，闲置时可释放工作集或关闭'
          : '常规后台驻留进程，可按需回收工作集'
      })
    }
  }

  if (tempDir) {
    const tempEntries = await listRealDirectoryContents(tempDir, hostOverride)
    const slice = tempEntries.slice(0, 12)
    const sizes = await Promise.all(slice.map(f => getRealFileSize(f, hostOverride)))
    for (let i = 0; i < slice.length; i++) {
      const sz = sizes[i] || 0
      if (sz <= 0) continue
      const fPath = slice[i]
      const fName = fPath.split(/[\\/]/).pop() || fPath
      reclaimableEstimateBytes += sz
      candidates.push({
        id: `boost-temp-${i}-${fName}`,
        type: 'temp_cache',
        name: `[临时缓存] ${fName}`,
        path: fPath,
        memoryOrSizeBytes: sz,
        cpuPercent: 0,
        isProtected: false,
        recommendation: '系统 %TEMP% 临时残留文件，可安全移入回收站释放I/O负载'
      })
    }
  }

  return {
    totalMemoryBytes,
    usedMemoryBytes,
    availableMemoryBytes,
    memoryUsagePercent,
    cpuUsagePercent,
    reclaimableEstimateBytes,
    candidates
  }
}

/**
 * 终止指定高占用非保护进程
 */
export async function terminateBoostProcess(
  pid: number,
  name: string,
  hostOverride?: any
): Promise<{ ok: boolean; error?: string }> {
  const baseName = name.replace(/\.exe$/i, '')
  if (pid <= 4 || FORBIDDEN_TARGET_PATTERN.test(name) || FORBIDDEN_TARGET_PATTERN.test(baseName)) {
    return { ok: false, error: FORBIDDEN_REASON }
  }
  const res = await callHostTransport('process_kill', { pid, force: true }, hostOverride)
  return { ok: res.ok, error: res.error }
}

/**
 * 一键清理系统 %TEMP% 热点残留并整理内存负载
 */
export async function executeQuickBoostCleanup(
  candidates: BoostCandidateItem[],
  hostOverride?: any
): Promise<{ ok: boolean; cleanedCount: number; freedBytes: number }> {
  const tempItems = candidates.filter(c => c.type === 'temp_cache' && !c.isProtected)
  let cleanedCount = 0
  let freedBytes = 0

  for (const item of tempItems) {
    const res = await trashRealItem(item.path, hostOverride)
    if (res.ok) {
      cleanedCount += 1
      freedBytes += item.memoryOrSizeBytes
    }
  }

  return { ok: true, cleanedCount, freedBytes }
}

export async function openBoostItemLocation(path: string, hostOverride?: any): Promise<boolean> {
  if (!path) return false
  return showRealItemInFolder(path, hostOverride)
}
