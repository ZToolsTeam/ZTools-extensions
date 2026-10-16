/**
 * 硬件信息与实时传感器监控业务逻辑层 (HardwareInfo Logic)
 * 真实采集 CPU 微架构、物理内存、全量磁盘分区、多显示器与电源电池状态
 */

import {
  callHostTransport,
  probeRealDiskDrives
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

export interface HardwareSpecEntry {
  id: string
  category: 'cpu' | 'memory' | 'storage' | 'display' | 'system'
  title: string
  subtitle: string
  value: string
  tag: string
  detailMarkdown: string
}

export interface HardwareTelemetrySnapshot {
  cpuModel: string
  logicalCpuCount: number
  cpuUsagePercent: number
  totalMemoryBytes: number
  usedMemoryBytes: number
  availableMemoryBytes: number
  memoryUsagePercent: number
  osName: string
  osVersion: string
  osBuild: number
  osArch: string
  driveCount: number
  displayCount: number
  batteryPercent: number
  isCharging: boolean
  entries: HardwareSpecEntry[]
}

export const DLL_PLUGIN_NAME = 'HardwareInfoPlugin'
export const FORBIDDEN_TARGET_PATTERN = new RegExp('^(?:OVERCLOCK_VOLTAGE_UNSAFE|RAW_MSR_WRITE)$', 'i')
export const FORBIDDEN_REASON = '禁止通过硬件检测插件执行非安全的底层 MSR 寄存器写操作或超压指令'

const PRESET_ITEMS: CapabilityActionItem[] = [
  {
    id: 'hw-overview',
    title: '整机核心硬件配置总览 (CPU / GPU / 主板 / 内存)',
    subtitle: '读取处理器微架构、主板 BIOS 版本、内存通道频率与显卡规格',
    tag: '配置总览',
    method: 'GetHardwareInfo',
    params: { section: 'all' }
  },
  {
    id: 'hw-temp-monitor',
    title: '核心传感器实时温度巡检 (CPU Package / GPU Core)',
    subtitle: '通过 Ring0 驱动读取 CPU 核心温度、显卡热点与风扇转速',
    tag: '温度监控',
    method: 'GetTemperature',
    params: { unit: 'celsius' }
  },
  {
    id: 'hw-cpu-load',
    title: '处理器各逻辑核心实时利用率采样',
    subtitle: '监控高频满载核心与后台线程调度占用百分比',
    tag: '负载采样',
    method: 'system_get_cpu_usage',
    params: { intervalMs: 1000 }
  },
  {
    id: 'hw-refresh-all',
    title: '强制重新枚举 SMBIOS 与磁盘 SMART 信息',
    subtitle: '刷新外接移动硬盘与新挂载硬件设备状态',
    tag: '刷新枚举',
    method: 'RefreshAll',
    params: {}
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
 * 采集本机真实硬件配置与传感器状态快照
 */
export async function fetchHardwareTelemetrySnapshot(hostOverride?: any): Promise<HardwareTelemetrySnapshot> {
  const [hwRes, sysRes, cpuRes, memRes, batRes, dispRes, drives] = await Promise.all([
    callHostTransport<{
      cpuModel: string
      logicalCpuCount: number
      totalMemory: number
      osVersion: string
    }>('system_get_hardware_summary', {}, hostOverride),
    callHostTransport<{
      osName: string
      osVersion: string
      osBuild: number
      osArch: string
      platform: string
      appVersion: string
    }>('get_system_info', {}, hostOverride),
    callHostTransport<{ total: number; perCore: number[] }>('system_get_cpu_usage', {}, hostOverride),
    callHostTransport<{ total: number; used: number; available: number; percent: number }>(
      'system_get_memory_usage',
      {},
      hostOverride
    ),
    callHostTransport<{ percent: number; isCharging: boolean; timeRemaining: number }>(
      'system_get_battery_status',
      {},
      hostOverride
    ),
    callHostTransport<Array<{
      id: number
      label?: string
      bounds?: { x: number; y: number; width: number; height: number }
      workArea?: { x: number; y: number; width: number; height: number }
      scaleFactor?: number
      displayFrequency?: number
      colorDepth?: number
    }>>('screen_get_all_displays', {}, hostOverride),
    probeRealDiskDrives(['C', 'D', 'E', 'F', 'G'], hostOverride)
  ])

  const cpuModel = hwRes.ok && hwRes.data?.cpuModel ? hwRes.data.cpuModel.trim() : 'x86_64 Processor'
  const logicalCpuCount = hwRes.ok && hwRes.data?.logicalCpuCount ? hwRes.data.logicalCpuCount : 0
  const cpuUsagePercent = cpuRes.ok && typeof cpuRes.data?.total === 'number' ? Math.round(cpuRes.data.total) : 0
  const totalMemoryBytes =
    memRes.ok && memRes.data?.total
      ? memRes.data.total
      : hwRes.ok && hwRes.data?.totalMemory
      ? hwRes.data.totalMemory
      : 0
  const usedMemoryBytes = memRes.ok && memRes.data?.used ? memRes.data.used : 0
  const availableMemoryBytes = memRes.ok && memRes.data?.available ? memRes.data.available : 0
  const memoryUsagePercent = memRes.ok && typeof memRes.data?.percent === 'number' ? memRes.data.percent : 0

  const osName = sysRes.ok && sysRes.data?.osName ? sysRes.data.osName : 'Windows'
  const osVersion = sysRes.ok && sysRes.data?.osVersion ? sysRes.data.osVersion : hwRes.data?.osVersion || ''
  const osBuild = sysRes.ok && sysRes.data?.osBuild ? sysRes.data.osBuild : 0
  const osArch = sysRes.ok && sysRes.data?.osArch ? sysRes.data.osArch : 'x64'

  const batteryPercent = batRes.ok && typeof batRes.data?.percent === 'number' ? batRes.data.percent : 100
  const isCharging = batRes.ok ? Boolean(batRes.data?.isCharging) : true
  const displays = dispRes.ok && Array.isArray(dispRes.data) ? dispRes.data : []

  const entries: HardwareSpecEntry[] = [
    {
      id: 'hw-cpu-spec',
      category: 'cpu',
      title: cpuModel,
      subtitle: `${logicalCpuCount} 逻辑线程 · 指令集架构 ${osArch.toUpperCase()}`,
      value: `负载 ${cpuUsagePercent}%`,
      tag: `${logicalCpuCount} 线程`,
      detailMarkdown: `# 🖥️ 中央处理器 (CPU)

**处理器型号**: \`${cpuModel}\`

---

### 📊 核心规格与实时遥测
- **逻辑处理器数量**: \`${logicalCpuCount} 线程\`
- **指令集架构**: \`${osArch.toUpperCase()}\`
- **当前瞬时总利用率**: \`${cpuUsagePercent}%\`

> [!TIP]
> 以上数据由本机 Win32 \`GetSystemInfo\` 与 \`GetSystemTimes\` 实时硬件采样生成。`
    },
    {
      id: 'hw-mem-spec',
      category: 'memory',
      title: `物理内存总容量 ${formatBytes(totalMemoryBytes)}`,
      subtitle: `已用 ${formatBytes(usedMemoryBytes)} · 可用余量 ${formatBytes(availableMemoryBytes)}`,
      value: `${memoryUsagePercent}% 已用`,
      tag: formatBytes(totalMemoryBytes),
      detailMarkdown: `# 🧠 物理内存子系统 (RAM)

**安装总物理内存**: \`${formatBytes(totalMemoryBytes)}\` (${totalMemoryBytes.toLocaleString()} Bytes)

---

### 📊 实时工作集分布
- **当前已用物理内存**: \`${formatBytes(usedMemoryBytes)}\` (${memoryUsagePercent}%)
- **当前空闲可用内存**: \`${formatBytes(availableMemoryBytes)}\`
- **内存健康度**: \`${memoryUsagePercent > 85 ? '高负载预警' : '充裕正常'}\``
    },
    {
      id: 'hw-os-spec',
      category: 'system',
      title: `${osName} (${osArch})`,
      subtitle: `内核版本 ${osVersion} · Build ${osBuild}`,
      value: `Build ${osBuild}`,
      tag: osVersion,
      detailMarkdown: `# 🪟 操作系统与供电状态

- **操作系统版本**: \`${osName}\`
- **内核版本号**: \`${osVersion} (Build ${osBuild})\`
- **系统位宽架构**: \`${osArch}\`
- **电源/电池状态**: \`${batteryPercent}% (${isCharging ? 'AC 交流电源供电中' : '电池放电中'})\``
    }
  ]

  for (const d of drives) {
    entries.push({
      id: `hw-drive-${d.drive}`,
      category: 'storage',
      title: `本地存储卷 (${d.drive})`,
      subtitle: `总容量 ${formatBytes(d.totalBytes)} · 剩余可用 ${formatBytes(d.availableBytes)}`,
      value: `已用 ${d.usagePercent}%`,
      tag: formatBytes(d.totalBytes),
      detailMarkdown: `# 💽 存储卷 ${d.drive}\\

- **总计物理容量**: \`${formatBytes(d.totalBytes)}\`
- **当前已用容量**: \`${formatBytes(d.usedBytes)} (${d.usagePercent}%)\`
- **剩余可用容量**: \`${formatBytes(d.availableBytes)}\``
    })
  }

  displays.forEach((disp, index) => {
    const w = disp.bounds?.width || 1920
    const h = disp.bounds?.height || 1080
    const scale = Math.round((disp.scaleFactor || 1) * 100)
    const hz = disp.displayFrequency || 60
    entries.push({
      id: `hw-disp-${disp.id || index}`,
      category: 'display',
      title: disp.label || `显示器 #${index + 1} (${w} × ${h})`,
      subtitle: `DPI 缩放 ${scale}% · 刷新率 ${hz}Hz · 色深 ${disp.colorDepth || 24}-bit`,
      value: `${w}×${h} @${hz}Hz`,
      tag: `${scale}% DPI`,
      detailMarkdown: `# 🖥️ 显示器输出端点 #${index + 1}

- **设备标识**: \`${disp.label || `Display #${disp.id || index + 1}`}\`
- **逻辑分辨率**: \`${w} × ${h}\`
- **工作区尺寸**: \`${disp.workArea?.width || w} × ${disp.workArea?.height || h}\`
- **系统 DPI 缩放**: \`${scale}%\`
- **垂直刷新率**: \`${hz} Hz\``
    })
  })

  return {
    cpuModel,
    logicalCpuCount,
    cpuUsagePercent,
    totalMemoryBytes,
    usedMemoryBytes,
    availableMemoryBytes,
    memoryUsagePercent,
    osName,
    osVersion,
    osBuild,
    osArch,
    driveCount: drives.length,
    displayCount: displays.length,
    batteryPercent,
    isCharging,
    entries
  }
}
