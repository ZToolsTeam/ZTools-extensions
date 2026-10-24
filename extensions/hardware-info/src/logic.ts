/**
 * 电脑硬件信息 (HardwareInfo 2.0 Logic)
 * 通过宿主通用系统接口读取 CPU 型号/线程/负载、物理内存、系统版本、磁盘容量、显示器与电源状态，
 * 并据此给出 4 个应用场景的估算评分与 Markdown / JSON / TXT 配置报告。
 * 读取失败的字段一律记为 null 并在界面显示「读取失败」，不用默认值冒充真实数据。
 */

import {
  callHostTransport,
  formatBytes,
  invokeDllPluginCapability,
  isRealElectronHost,
  probeRealDiskDrives,
  RealDriveUsageInfo
} from './native-ipc.js'

export { formatBytes } from './native-ipc.js'

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
  category: 'cpu' | 'memory' | 'storage' | 'display' | 'system' | 'benchmark'
  title: string
  subtitle: string
  value: string
  tag: string
  detailMarkdown: string
}

export interface ScenarioCompatibilityItem {
  id: string
  scenario: string
  tier: '极致流畅' | '主力胜任' | '基本满足' | '瓶颈受限'
  score: number
  summary: string
  bottleneckHint: string
}

export interface HardwareTelemetrySnapshot {
  /** 以下字段为 null 表示宿主读取失败或未提供，界面显示「读取失败」/「未知」 */
  cpuModel: string | null
  logicalCpuCount: number | null
  cpuUsagePercent: number | null
  totalMemoryBytes: number | null
  usedMemoryBytes: number | null
  availableMemoryBytes: number | null
  memoryUsagePercent: number | null
  osName: string | null
  /** 系统产品版本：macOS 为 26.5.1 这类版本号，Windows 为 NT 版本号 */
  osVersion: string | null
  /** 内核版本：macOS 为 Darwin 版本（kernelRelease），Windows 为 NT 版本号 */
  kernelVersion: string | null
  /** 系统 Build 号：只有宿主真实提供（目前仅 Windows）时才有值 */
  osBuild: number | null
  osArch: string | null
  platform: string | null
  driveCount: number
  totalDiskBytes: number
  usedDiskBytes: number
  availableDiskBytes: number
  drives: RealDriveUsageInfo[]
  /** null 表示显示器信息读取失败 */
  displayCount: number | null
  /** null 表示无电池或宿主无法读取电量 */
  batteryPercent: number | null
  isCharging: boolean
  /** 电源状态接口调用失败（区别于「无电池」） */
  powerReadFailed: boolean
  /** 只有 CPU 负载与内存占用都读到时才计算 */
  healthScore: number | null
  /** 只有 CPU 线程数与内存总量都读到时才计算 */
  scenarios: ScenarioCompatibilityItem[]
  /** 读取失败的模块名称，例如「处理器信息」「内存占用」 */
  failures: string[]
  entries: HardwareSpecEntry[]
}

export const DLL_PLUGIN_NAME = 'HardwareInfoPlugin'

/** 快照涉及的全部读取模块（failures 中的取值） */
export const TELEMETRY_MODULES = ['处理器信息', 'CPU 负载', '内存占用', '系统版本', '电源状态', '显示器', '磁盘容量'] as const

/** 读取失败时的统一文案 */
export const READ_FAILED = '读取失败'

/** 公共 native-ipc 在宿主没给 CPU 型号时填入的占位值，不是真实型号 */
const PLACEHOLDER_CPU_MODEL = 'x86_64 Processor'

/** 宿主返回的数值不可信：只有有限正数才算拿到了真实值 */
function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/** 有限非负数（允许 0，例如负载 0%、已用 0 B） */
function nonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function bytesOrFailed(bytes: number | null): string {
  return bytes === null ? READ_FAILED : formatBytes(bytes)
}

function percentOrFailed(percent: number | null): string {
  return percent === null ? READ_FAILED : `${percent}%`
}

/** 电源文案：无电池（percent 为 null）时不展示电量与放电状态；接口失败时如实提示读取失败 */
export function formatPowerStatus(batteryPercent: number | null, isCharging: boolean, readFailed = false): string {
  if (readFailed) return `电源状态${READ_FAILED}`
  if (batteryPercent === null) return '无电池（交流供电）'
  return `电量 ${batteryPercent}% (${isCharging ? 'AC 交流供电' : '电池放电中'})`
}

function isMacPlatform(snap: Pick<HardwareTelemetrySnapshot, 'platform' | 'osName'>): boolean {
  return snap.platform === 'macos' || snap.platform === 'darwin' || snap.osName === 'macOS'
}

/**
 * 系统版本各段：系统版本 / 内核版本 / Build，缺失的段直接省略（不显示 Build 0 之类的假值）。
 * Windows 上 osVersion 与内核版本相同（NT 版本号），只显示一次。
 */
export function describeOsVersionParts(
  snap: Pick<HardwareTelemetrySnapshot, 'platform' | 'osName' | 'osVersion' | 'kernelVersion' | 'osBuild'>
): string[] {
  const parts: string[] = []
  if (snap.osVersion && snap.osVersion !== snap.kernelVersion) parts.push(`系统版本 ${snap.osVersion}`)
  if (snap.kernelVersion) parts.push(`${isMacPlatform(snap) ? 'Darwin 内核' : '内核版本'} ${snap.kernelVersion}`)
  if (snap.osBuild !== null) parts.push(`Build ${snap.osBuild}`)
  return parts
}

/** 报告中的一行系统描述，例如「macOS 26.5.1 (Darwin 内核 25.5.0, arm64)」 */
export function formatOsLine(
  snap: Pick<HardwareTelemetrySnapshot, 'platform' | 'osName' | 'osVersion' | 'kernelVersion' | 'osBuild' | 'osArch'>
): string {
  if (!snap.osName && !snap.osVersion) return `系统版本${READ_FAILED}`
  const head = [snap.osName, snap.osVersion].filter(Boolean).join(' ')
  const extra: string[] = []
  if (snap.kernelVersion && snap.kernelVersion !== snap.osVersion) {
    extra.push(`${isMacPlatform(snap) ? 'Darwin 内核' : '内核'} ${snap.kernelVersion}`)
  }
  if (snap.osBuild !== null) extra.push(`Build ${snap.osBuild}`)
  if (snap.osArch) extra.push(snap.osArch)
  return extra.length > 0 ? `${head} (${extra.join(', ')})` : head
}

/** 顶部单行状态摘要：读取失败的部分如实标注，全部失败时提示重试 */
export function buildSummaryText(snap: HardwareTelemetrySnapshot | null): string {
  if (!snap) return '正在读取硬件信息...'
  const nothingRead =
    snap.cpuModel === null &&
    snap.logicalCpuCount === null &&
    snap.totalMemoryBytes === null &&
    snap.osName === null &&
    snap.driveCount === 0
  if (nothingRead) return '硬件信息读取失败，可点击「刷新」重试'
  const parts: string[] = []
  if (snap.healthScore !== null) parts.push(`整机健康度 ${snap.healthScore} 分`)
  parts.push(
    `CPU ${snap.logicalCpuCount === null ? `线程数${READ_FAILED}` : `${snap.logicalCpuCount} 线程`} (负载 ${percentOrFailed(snap.cpuUsagePercent)})`
  )
  parts.push(
    `内存 ${bytesOrFailed(snap.usedMemoryBytes)} / ${bytesOrFailed(snap.totalMemoryBytes)} (${percentOrFailed(snap.memoryUsagePercent)})`
  )
  parts.push(
    snap.driveCount > 0
      ? `存储 ${formatBytes(snap.totalDiskBytes)} (${snap.driveCount} 个分区，可用 ${formatBytes(snap.availableDiskBytes)})`
      : `磁盘容量${READ_FAILED}`
  )
  return parts.join(' · ')
}

export const FORBIDDEN_TARGET_PATTERN = new RegExp('^(?:OVERCLOCK_VOLTAGE_UNSAFE|RAW_MSR_WRITE)$', 'i')
export const FORBIDDEN_REASON = '禁止通过硬件检测插件执行非安全的底层 MSR 寄存器写操作或超压指令'

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
  hostBridge?: any
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

/**
 * 基于本机真实硬件规格计算 4 大应用场景兼容性评估
 */
export function evaluateHardwareScenarios(
  logicalCpuCountOrSnap: number | Partial<HardwareTelemetrySnapshot>,
  totalMemoryBytesArg?: number,
  /** 传 null 表示磁盘容量未读到：4K 剪辑场景不再引用存储余量（undefined 仍按旧默认值处理） */
  availableDiskBytesArg?: number | null
): ScenarioCompatibilityItem[] {
  const isSnap = typeof logicalCpuCountOrSnap === 'object' && logicalCpuCountOrSnap !== null
  const logicalCpuCount = isSnap
    ? Number(logicalCpuCountOrSnap.logicalCpuCount ?? 8)
    : Number(logicalCpuCountOrSnap || 8)
  const totalMemoryBytes = isSnap
    ? Number(logicalCpuCountOrSnap.totalMemoryBytes ?? 16 * 1024 * 1024 * 1024)
    : Number(totalMemoryBytesArg ?? 16 * 1024 * 1024 * 1024)
  const availableDiskBytes = isSnap
    ? Number(logicalCpuCountOrSnap.availableDiskBytes ?? 128 * 1024 * 1024 * 1024)
    : Number(availableDiskBytesArg ?? 128 * 1024 * 1024 * 1024)

  const diskKnown = isSnap || availableDiskBytesArg !== null
  const ramGb = totalMemoryBytes / (1024 * 1024 * 1024)
  const freeDiskGb = availableDiskBytes / (1024 * 1024 * 1024)
  const cores = logicalCpuCount || 8

  return [
    {
      id: 'sc-office-dev',
      scenario: '极客开发、多开容器与重度办公',
      tier: ramGb >= 24 && cores >= 12 ? '极致流畅' : ramGb >= 14 ? '主力胜任' : '基本满足',
      score: Math.min(99, Math.round(60 + Math.min(25, ramGb * 0.8) + Math.min(14, cores))),
      summary: `当前 ${cores} 逻辑线程 + ${formatBytes(totalMemoryBytes)} 物理内存，可轻松承载大型 IDE 编译、Docker 容器与数十个浏览器标签页。`,
      bottleneckHint: ramGb < 16 ? '建议升级至 32GB 内存以获得更充裕的多开空间' : '硬件余量充裕，无明显瓶颈'
    },
    {
      id: 'sc-4k-media',
      scenario: '4K 影音剪辑、渲染与创意设计',
      tier: ramGb >= 30 && cores >= 16 ? '极致流畅' : ramGb >= 15 && cores >= 8 ? '主力胜任' : '基本满足',
      score: Math.min(98, Math.round(55 + Math.min(25, ramGb * 0.75) + Math.min(18, cores * 1.1))),
      summary: diskKnown
        ? `多线程并行编码能力 (${cores} 线程) 配合 ${formatBytes(availableDiskBytes)} 可用高速存储池，适合多轨道 4K 视频转码与合成。`
        : `多线程并行编码能力 (${cores} 线程)，适合多轨道 4K 视频转码与合成（磁盘容量${READ_FAILED}，未评估素材存储空间）。`,
      bottleneckHint: !diskKnown
        ? `磁盘容量${READ_FAILED}，无法评估素材存储空间`
        : freeDiskGb < 50
        ? '剩余磁盘空间偏紧，建议清理素材缓存'
        : '存储与多核吞吐表现良好'
    },
    {
      id: 'sc-aaa-gaming',
      scenario: '主流电竞与 3A 次世代游戏大作',
      tier: ramGb >= 15 && cores >= 12 ? '主力胜任' : '基本满足',
      score: Math.min(96, Math.round(58 + Math.min(22, ramGb * 0.7) + Math.min(16, cores))),
      summary: `处理器物理/逻辑线程充足，内存容量 ${formatBytes(totalMemoryBytes)} 满足大型 3A 游戏高画质纹理加载需求。`,
      bottleneckHint: '建议在游戏前通过「系统加速」清理后台高占用驻留进程'
    },
    {
      id: 'sc-local-llm',
      scenario: '本地离线 AI 大模型推理 (Ollama / DeepSeek)',
      tier: ramGb >= 30 ? '极致流畅' : ramGb >= 15 ? '主力胜任' : '瓶颈受限',
      score: Math.min(95, Math.round(45 + Math.min(35, ramGb * 1.1) + Math.min(15, cores * 0.8))),
      summary:
        ramGb >= 28
          ? `本机拥有 ${formatBytes(totalMemoryBytes)} 大内存，可流畅运行 7B / 14B 甚至 32B Q4 量化本地大模型。`
          : `本机 ${formatBytes(totalMemoryBytes)} 内存适合运行 1.5B ~ 7B/8B Q4 量化离线大模型。`,
      bottleneckHint: ramGb < 16 ? '运行 14B+ 模型受限于物理内存容量' : '支持开启本地 Ollama 11434 零延迟直连'
    }
  ]
}

/**
 * 导出整机硬件资产报告 (支持 Markdown / JSON / TXT 三种格式)
 * 读取失败的字段：JSON 中为 null，文本报告中写「读取失败」
 */
export function exportHardwareReport(
  snap: HardwareTelemetrySnapshot,
  format: 'markdown' | 'json' | 'txt' = 'markdown'
): string {
  const cpuModel = snap.cpuModel ?? `型号${READ_FAILED}`
  const threads = snap.logicalCpuCount === null ? `线程数${READ_FAILED}` : `${snap.logicalCpuCount} 逻辑线程`
  const cpuLoad = percentOrFailed(snap.cpuUsagePercent)
  const health = snap.healthScore === null ? '未评估' : `${snap.healthScore}`
  const displays = snap.displayCount === null ? `显示器信息${READ_FAILED}` : `${snap.displayCount} 台显示器`
  const power = formatPowerStatus(snap.batteryPercent, snap.isCharging, snap.powerReadFailed)

  if (format === 'json') {
    return JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        cpu: {
          model: snap.cpuModel,
          logicalCores: snap.logicalCpuCount,
          currentUsagePercent: snap.cpuUsagePercent
        },
        memory: {
          totalBytes: snap.totalMemoryBytes,
          totalFormatted: snap.totalMemoryBytes === null ? null : formatBytes(snap.totalMemoryBytes),
          usedBytes: snap.usedMemoryBytes,
          availableBytes: snap.availableMemoryBytes,
          usagePercent: snap.memoryUsagePercent
        },
        os: {
          name: snap.osName,
          version: snap.osVersion,
          kernel: snap.kernelVersion,
          build: snap.osBuild,
          arch: snap.osArch
        },
        storage: {
          driveCount: snap.driveCount,
          totalBytes: snap.totalDiskBytes,
          availableBytes: snap.availableDiskBytes,
          drives: snap.drives
        },
        displays: snap.displayCount,
        power: {
          batteryPercent: snap.batteryPercent,
          isCharging: snap.isCharging,
          readFailed: snap.powerReadFailed
        },
        healthScore: snap.healthScore,
        scenarios: snap.scenarios,
        readFailures: snap.failures
      },
      null,
      2
    )
  }

  const failureLine = snap.failures.length > 0 ? `未能读取: ${snap.failures.join('、')}` : ''

  if (format === 'txt') {
    const driveLines = snap.drives.length > 0
      ? snap.drives
        .map(d => `  [${d.drive}] 总容量: ${formatBytes(d.totalBytes)} | 已用: ${formatBytes(d.usedBytes)} (${d.usagePercent}%) | 可用: ${formatBytes(d.availableBytes)}`)
        .join('\n')
      : `  磁盘容量${READ_FAILED}`
    return [
      '====================================================',
      '           ZTools 本机硬件配置与健康度检测报告        ',
      '====================================================',
      `生成时间: ${new Date().toLocaleString()}`,
      `综合健康评分: ${snap.healthScore === null ? '未评估' : `${health} / 100`}`,
      ...(failureLine ? [failureLine] : []),
      `处理器 (CPU): ${cpuModel} (${threads}, 当前负载 ${cpuLoad})`,
      `物理内存 (RAM): 总计 ${bytesOrFailed(snap.totalMemoryBytes)} | 已用 ${bytesOrFailed(snap.usedMemoryBytes)} (${percentOrFailed(snap.memoryUsagePercent)}) | 可用 ${bytesOrFailed(snap.availableMemoryBytes)}`,
      `操作系统 (OS): ${formatOsLine(snap)}`,
      `显示与供电: ${snap.displayCount === null ? displays : `${snap.displayCount} 台显示器在线`} | ${power}`,
      '----------------------------------------------------',
      '物理存储卷明细:',
      driveLines,
      '===================================================='
    ].join('\n')
  }

  const driveMd = snap.drives.length > 0
    ? snap.drives
      .map(d => `- **存储卷 (${d.drive})**: 总计 \`${formatBytes(d.totalBytes)}\` · 已用 \`${formatBytes(d.usedBytes)} (${d.usagePercent}%)\` · 剩余 \`${formatBytes(d.availableBytes)}\``)
      .join('\n')
    : `- 磁盘容量${READ_FAILED}`
  const scenarioMd = snap.scenarios.length > 0
    ? snap.scenarios
      .map(s => `- **${s.scenario}**: \`${s.tier} (${s.score}分)\` — ${s.summary}`)
      .join('\n')
    : `- CPU 线程数或内存容量${READ_FAILED}，未评估`

  return `# ZTools 整机硬件配置与性能评测报告

- **报告生成时间**: \`${new Date().toLocaleString()}\`
- **整机硬件综合健康度**: **${snap.healthScore === null ? '未评估' : `${health} 分`}**
${failureLine ? `- **${failureLine}**\n` : ''}
---

### 1. 核心计算与内存规格
- **中央处理器 (CPU)**: \`${cpuModel}\` (\`${threads}\`, 瞬时负载 \`${cpuLoad}\`)
- **物理内存 (RAM)**: 总容量 \`${bytesOrFailed(snap.totalMemoryBytes)}\` (已用 \`${bytesOrFailed(snap.usedMemoryBytes)} / ${percentOrFailed(snap.memoryUsagePercent)}\`, 可用 \`${bytesOrFailed(snap.availableMemoryBytes)}\`)
- **操作系统与内核**: \`${formatOsLine(snap)}\`
- **显示器与电源**: \`${displays}\` · \`${power}\`

---

### 2. 全盘物理存储池 (${snap.driveCount} 个挂载卷 · 共 ${formatBytes(snap.totalDiskBytes)})
${driveMd}

---

### 3. 四大生产力与 AI 场景实测兼容性
${scenarioMd}
`
}

/**
 * 采集本机硬件配置与实时负载快照
 * 每个宿主接口独立判断成败：失败的字段为 null 并记入 failures，不用默认值兜底
 */
export async function fetchHardwareTelemetrySnapshot(hostOverride?: any): Promise<HardwareTelemetrySnapshot> {
  const [hwRes, sysRes, cpuRes, memRes, batRes, dispRes, drives] = await Promise.all([
    callHostTransport<{
      cpuModel?: string
      cpuModels?: string[]
      logicalCpuCount?: number
      totalMemory?: number
      osVersion?: string
    }>('system_get_hardware_summary', {}, hostOverride),
    callHostTransport<{
      osName?: string
      osVersion?: string
      osBuild?: number
      kernelRelease?: string
      windowsRelease?: string
      osArch?: string
      platform?: string
      appVersion?: string
    }>('get_system_info', {}, hostOverride),
    callHostTransport<{ total: number; perCore: number[] }>('system_get_cpu_usage', {}, hostOverride),
    callHostTransport<{ total: number; used: number; available: number; percent: number }>(
      'system_get_memory_usage',
      {},
      hostOverride
    ),
    callHostTransport<{ percent: number | null; hasBattery?: boolean; isCharging: boolean; timeRemaining: number }>(
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
      displayFrequency?: number | null
      colorDepth?: number | null
    }>>('screen_get_all_displays', {}, hostOverride),
    probeRealDiskDrives(['C', 'D', 'E', 'F', 'G'], hostOverride)
  ])

  const failures: string[] = []
  const hw = hwRes.ok && hwRes.data && typeof hwRes.data === 'object' ? hwRes.data : null
  const sys = sysRes.ok && sysRes.data && typeof sysRes.data === 'object' ? sysRes.data : null

  // CPU 型号：公共 native-ipc 在宿主没给型号时会填占位值 'x86_64 Processor'，同样按未读到处理
  const rawCpuModel = nonEmptyString(hw?.cpuModel)
  const cpuModel = rawCpuModel && rawCpuModel !== PLACEHOLDER_CPU_MODEL ? rawCpuModel : null
  const logicalCpuCount = positiveNumber(hw?.logicalCpuCount)
  if (cpuModel === null || logicalCpuCount === null) failures.push('处理器信息')

  const rawCpuUsage = cpuRes.ok ? nonNegativeNumber(cpuRes.data?.total) : null
  const cpuUsagePercent = rawCpuUsage === null ? null : Math.round(Math.min(100, rawCpuUsage))
  if (cpuUsagePercent === null) failures.push('CPU 负载')

  const mem = memRes.ok && memRes.data && typeof memRes.data === 'object' ? memRes.data : null
  const totalMemoryBytes = positiveNumber(mem?.total) ?? positiveNumber(hw?.totalMemory)
  const usedMemoryBytes = nonNegativeNumber(mem?.used)
  const availableMemoryBytes = nonNegativeNumber(mem?.available)
  const rawMemPercent = nonNegativeNumber(mem?.percent)
  const memoryUsagePercent = rawMemPercent === null ? null : Math.round(Math.min(100, rawMemPercent))
  if (usedMemoryBytes === null || availableMemoryBytes === null || memoryUsagePercent === null) failures.push('内存占用')

  const platform = nonEmptyString(sys?.platform)
  const osName = nonEmptyString(sys?.osName)
  const osVersion = nonEmptyString(sys?.osVersion) ?? nonEmptyString(hw?.osVersion)
  const kernelVersion = nonEmptyString(sys?.kernelRelease) ?? nonEmptyString(sys?.windowsRelease)
  const osBuild = positiveNumber(sys?.osBuild)
  const osArch = nonEmptyString(sys?.osArch)
  if (osName === null && osVersion === null) failures.push('系统版本')

  const powerReadFailed = !batRes.ok
  const batteryPercent = !powerReadFailed && typeof batRes.data?.percent === 'number' ? batRes.data.percent : null
  const isCharging = !powerReadFailed ? Boolean(batRes.data?.isCharging) : false
  if (powerReadFailed) failures.push('电源状态')

  const displays = dispRes.ok && Array.isArray(dispRes.data) ? dispRes.data : []
  const displayReadFailed = !(dispRes.ok && Array.isArray(dispRes.data))
  if (displayReadFailed) failures.push('显示器')

  // 任何电脑至少有一个卷：一个都没读到就是读取失败
  if (drives.length === 0) failures.push('磁盘容量')
  const totalDiskBytes = drives.reduce((s, d) => s + d.totalBytes, 0)
  const usedDiskBytes = drives.reduce((s, d) => s + d.usedBytes, 0)
  const availableDiskBytes = drives.reduce((s, d) => s + d.availableBytes, 0)

  const scenarios =
    logicalCpuCount !== null && totalMemoryBytes !== null
      ? evaluateHardwareScenarios(logicalCpuCount, totalMemoryBytes, drives.length > 0 ? availableDiskBytes : null)
      : []
  const healthScore =
    cpuUsagePercent !== null && memoryUsagePercent !== null
      ? Math.max(
        65,
        Math.min(
          99,
          Math.round(
            100 -
              (memoryUsagePercent > 85 ? 12 : memoryUsagePercent > 70 ? 5 : 0) -
              (cpuUsagePercent > 85 ? 10 : 0)
          )
        )
      )
      : null

  const osInfo = { platform, osName, osVersion, kernelVersion, osBuild, osArch }
  const archText = osArch ? osArch.toUpperCase() : '未知'
  const threadsText = logicalCpuCount === null ? `线程数${READ_FAILED}` : `${logicalCpuCount} 逻辑线程`
  const versionParts = describeOsVersionParts(osInfo)
  const powerText = formatPowerStatus(batteryPercent, isCharging, powerReadFailed)

  const entries: HardwareSpecEntry[] = [
    {
      id: 'hw-cpu-spec',
      category: 'cpu',
      title: cpuModel ?? `处理器型号${READ_FAILED}`,
      subtitle: `${threadsText} · 指令集架构 ${archText}`,
      value: `负载 ${percentOrFailed(cpuUsagePercent)}`,
      tag: logicalCpuCount === null ? '线程未知' : `${logicalCpuCount} 线程`,
      detailMarkdown: `# 中央处理器 (CPU)

**处理器型号**: \`${cpuModel ?? READ_FAILED}\`

---

### 核心规格与实时遥测 (HardwareInfo.h)
- **逻辑处理器数量**: \`${logicalCpuCount === null ? READ_FAILED : `${logicalCpuCount} 线程`}\`
- **指令集架构**: \`${archText}\`
- **当前瞬时总利用率**: \`${percentOrFailed(cpuUsagePercent)}\`

> [!TIP]
> 以上数据由本机 Win32 \`GetSystemInfo\` 与 \`GetSystemTimes\` 实时硬件采样生成。`
    },
    {
      id: 'hw-mem-spec',
      category: 'memory',
      title: totalMemoryBytes === null ? `物理内存容量${READ_FAILED}` : `物理内存总容量 ${formatBytes(totalMemoryBytes)}`,
      subtitle: `已用 ${bytesOrFailed(usedMemoryBytes)} · 可用余量 ${bytesOrFailed(availableMemoryBytes)}`,
      value: memoryUsagePercent === null ? `占用${READ_FAILED}` : `${memoryUsagePercent}% 已用`,
      tag: totalMemoryBytes === null ? '容量未知' : formatBytes(totalMemoryBytes),
      detailMarkdown: `# 物理内存子系统 (RAM)

**安装总物理内存**: \`${bytesOrFailed(totalMemoryBytes)}\`${totalMemoryBytes === null ? '' : ` (${totalMemoryBytes.toLocaleString()} Bytes)`}

---

### 实时工作集分布
- **当前已用物理内存**: \`${bytesOrFailed(usedMemoryBytes)}\` (${percentOrFailed(memoryUsagePercent)})
- **当前空闲可用内存**: \`${bytesOrFailed(availableMemoryBytes)}\`
- **内存健康度**: \`${memoryUsagePercent === null ? '未知' : memoryUsagePercent > 85 ? '高负载预警' : '充裕正常'}\``
    },
    {
      id: 'hw-os-spec',
      category: 'system',
      title: osName ? `${osName}${osArch ? ` (${osArch})` : ''}` : `操作系统${READ_FAILED}`,
      subtitle: versionParts.length > 0 ? versionParts.join(' · ') : `系统版本${READ_FAILED}`,
      value: osBuild !== null ? `Build ${osBuild}` : kernelVersion && kernelVersion !== osVersion ? `内核 ${kernelVersion}` : '',
      tag: osVersion ?? '版本未知',
      detailMarkdown: `# 操作系统与供电状态

- **操作系统**: \`${osName ?? READ_FAILED}\`
- **系统版本**: \`${osVersion ?? READ_FAILED}\`${kernelVersion && kernelVersion !== osVersion ? `
- **${isMacPlatform(osInfo) ? 'Darwin 内核版本' : '内核版本'}**: \`${kernelVersion}\`` : ''}${osBuild !== null ? `
- **系统 Build**: \`${osBuild}\`` : ''}
- **系统位宽架构**: \`${osArch ?? '未知'}\`
- **电源/电池状态**: \`${powerText}\``
    }
  ]

  for (const d of drives) {
    entries.push({
      id: `hw-drive-${d.drive}`,
      category: 'storage',
      title: `本地物理存储卷 (${d.drive})`,
      subtitle: `总容量 ${formatBytes(d.totalBytes)} · 已用 ${formatBytes(d.usedBytes)} · 剩余可用 ${formatBytes(d.availableBytes)}`,
      value: `已用 ${d.usagePercent}%`,
      tag: formatBytes(d.totalBytes),
      detailMarkdown: `# 存储卷 ${d.drive}

- **总计物理容量**: \`${formatBytes(d.totalBytes)}\`
- **当前已用容量**: \`${formatBytes(d.usedBytes)} (${d.usagePercent}%)\`
- **剩余可用容量**: \`${formatBytes(d.availableBytes)}\`
- **空间状态**: \`${d.usagePercent > 85 ? '空间偏紧' : '健康充裕'}\``
    })
  }

  displays.forEach((disp, index) => {
    // 宿主拿不到的字段如实显示「未知」，不用 1920×1080 / 60Hz / 24-bit 之类的默认值冒充真实值
    const w = positiveNumber(disp.bounds?.width)
    const h = positiveNumber(disp.bounds?.height)
    const resolution = w && h ? `${w} × ${h}` : '未知'
    const scale = Math.round((positiveNumber(disp.scaleFactor) || 1) * 100)
    const hzValue = positiveNumber(disp.displayFrequency)
    const hz = hzValue ? `${Math.round(hzValue)}Hz` : '未知'
    const depthValue = positiveNumber(disp.colorDepth)
    const depth = depthValue ? `${depthValue}-bit` : '未知'
    const workW = positiveNumber(disp.workArea?.width)
    const workH = positiveNumber(disp.workArea?.height)
    entries.push({
      id: `hw-disp-${disp.id || index}`,
      category: 'display',
      title: disp.label || `显示器 #${index + 1} (${resolution})`,
      subtitle: `DPI 缩放 ${scale}% · 刷新率 ${hz} · 色深 ${depth}`,
      value: `${w && h ? `${w}×${h}` : '分辨率未知'}${hzValue ? ` @${Math.round(hzValue)}Hz` : ''}`,
      tag: `${scale}% DPI`,
      detailMarkdown: `# 显示器输出端点 #${index + 1}

- **设备标识**: \`${disp.label || `Display #${disp.id || index + 1}`}\`
- **逻辑分辨率**: \`${resolution}\`
- **工作区尺寸**: \`${workW && workH ? `${workW} × ${workH}` : '未知'}\`
- **系统 DPI 缩放**: \`${scale}%\`
- **垂直刷新率**: \`${hzValue ? `${Math.round(hzValue)} Hz` : '未知'}\`
- **色深**: \`${depth}\``
    })
  })

  for (const sc of scenarios) {
    entries.push({
      id: sc.id,
      category: 'benchmark',
      title: sc.scenario,
      subtitle: `${sc.summary}`,
      value: `${sc.score} 分`,
      tag: sc.tier,
      detailMarkdown: `# ${sc.scenario}

- **兼容性评级**: **${sc.tier}** (\`${sc.score} / 100\`)
- **硬件表现分析**: ${sc.summary}
- **升级与优化建议**: ${sc.bottleneckHint}`
    })
  }

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
    kernelVersion,
    osBuild,
    osArch,
    platform,
    driveCount: drives.length,
    totalDiskBytes,
    usedDiskBytes,
    availableDiskBytes,
    drives,
    displayCount: displayReadFailed ? null : displays.length,
    batteryPercent,
    isCharging,
    powerReadFailed,
    healthScore,
    scenarios,
    failures,
    entries
  }
}
