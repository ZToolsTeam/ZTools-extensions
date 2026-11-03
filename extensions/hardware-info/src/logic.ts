import { uniqueCapacityDrives, type RealDiskDriveInfo } from './volume-ipc.js'
import { hostUpgradeError, isHostMethodMissing } from './host-compat.js'
/**
 * 电脑硬件信息业务逻辑
 * 通过宿主通用系统接口读取 CPU 型号/线程/负载、物理内存、系统版本、磁盘容量、显示器与电源状态，
 * 并据此给出 4 个应用场景的规格档位（不打分）与 Markdown / JSON / TXT 配置报告。
 * 读取失败的字段一律记为 null 并在界面显示「读取失败」，不用默认值冒充真实数据。
 */

import { callHostTransport, formatBytes } from './native-ipc.js'

export { formatBytes } from './native-ipc.js'

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
  tier: '规格参考较高' | '规格参考一般' | '规格参考有限'
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
  drives: RealDiskDriveInfo[]
  /** 部分卷读取失败：drives 与容量合计只含读到的卷 */
  diskPartial: boolean
  /** null 表示显示器信息读取失败 */
  displayCount: number | null
  /** null 表示没有电池或电量未知（看 batteryState 区分） */
  batteryPercent: number | null
  /** 旧字段：接入交流电（以 powerSource 为准） */
  isCharging: boolean
  /** present 有电池；absent 系统明确报告没有电池；unknown 判断不了（旧版宿主把这几种都报成 255） */
  batteryState: BatteryState
  powerSource: PowerSource
  /** 电源状态读取失败（区别于「无电池」「电量未知」） */
  powerReadFailed: boolean
  /** 只有 CPU 负载与内存占用都读到时才计算 */
  loadHeadroomPercent: number | null
  /** 只有 CPU 线程数与内存总量都读到时才计算 */
  scenarios: ScenarioCompatibilityItem[]
  /** 读取失败的模块名称，例如「处理器信息」「内存占用」 */
  failures: string[]
  /** 失败原因明细，例如「电源状态：读取超时」，界面提示与报告里如实展示 */
  warnings: string[]
  entries: HardwareSpecEntry[]
}

export type BatteryState = 'present' | 'absent' | 'unknown'
export type PowerSource = 'ac' | 'battery' | 'unknown'

/** 快照涉及的全部读取模块（failures 中的取值；「部分磁盘卷」与「磁盘容量」互斥，不计入总数） */
export const TELEMETRY_MODULES = ['处理器信息', 'CPU 负载', '内存占用', '系统版本', '电源状态', '显示器', '磁盘容量'] as const
export const PARTIAL_DISK_FAILURE = '部分磁盘卷'

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

function usagePercent(value: unknown): number | null {
  const number = nonNegativeNumber(value)
  return number !== null && number <= 100 ? Math.round(number) : null
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * 磁盘容量的显示单位：macOS 的访达与「关于本机」按 1000 进制显示 GB，Windows 资源管理器按 1024 进制显示 GB。
 * 按各自系统的习惯显示，否则同一块 500 GB 的盘在 macOS 上会显示成 466 GB，与访达对不上。内存仍按 1024 进制。
 */
export function formatStorageBytes(bytes: number, decimalUnits: boolean): string {
  if (!decimalUnits) return formatBytes(bytes)
  const num = Number(bytes)
  if (!Number.isFinite(num) || num <= 0) return '0 B'
  if (num < 1000) return `${Math.round(num)} B`
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let val = num
  let idx = 0
  while (val >= 1000 && idx < units.length - 1) {
    val /= 1000
    idx += 1
  }
  return `${val >= 100 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`
}

/** 宿主在 macOS 上读不到产品版本时会返回 'unknown'，按未读到处理，不显示成「macOS unknown」 */
function osVersionString(value: unknown): string | null {
  const text = nonEmptyString(value)
  return text && text.toLowerCase() !== 'unknown' ? text : null
}

function bytesOrFailed(bytes: number | null): string {
  return bytes === null ? READ_FAILED : formatBytes(bytes)
}

function percentOrFailed(percent: number | null): string {
  return percent === null ? READ_FAILED : `${percent}%`
}

/**
 * 电源文案：只有宿主明确报告没有电池时才写「无电池」；电量 255 之类的未知值写「电量未知」，不改写成无电池或 100%。
 * batteryState / powerSource 不传时按旧版宿主语义推断（有合法电量才算有电池，isCharging 表示接入交流电）。
 */
export function formatPowerStatus(
  batteryPercent: number | null,
  isCharging: boolean,
  readFailed = false,
  batteryState: BatteryState = batteryPercent === null ? 'unknown' : 'present',
  powerSource: PowerSource = isCharging ? 'ac' : 'battery'
): string {
  if (readFailed) return `电源状态${READ_FAILED}`
  if (batteryState === 'unknown') return '电池状态未知'
  if (batteryState === 'absent') return powerSource === 'ac' ? '无电池（交流供电）' : '无电池'
  const sourceText = powerSource === 'ac' ? 'AC 交流供电' : powerSource === 'battery' ? '电池放电中' : '供电状态未知'
  return `${batteryPercent === null ? '电量未知' : `电量 ${batteryPercent}%`} (${sourceText})`
}

/** 宿主返回的电源状态 → 电池三态与供电来源；新版宿主给 batteryState / powerSource / readError，旧版只有 percent 与 isCharging */
export function interpretBatteryStatus(res: { ok: boolean; data?: unknown; error?: string }): {
  batteryPercent: number | null; isCharging: boolean; batteryState: BatteryState; powerSource: PowerSource; readError: string | null
} {
  const failed = (readError: string) => ({ batteryPercent: null, isCharging: false, batteryState: 'unknown' as const, powerSource: 'unknown' as const, readError })
  if (!res.ok) return failed(res.error || '接口调用失败')
  const data = res.data && typeof res.data === 'object' ? res.data as Record<string, unknown> : null
  if (!data) return failed('返回数据无效')
  if (typeof data.readError === 'string' && data.readError.trim()) return failed(data.readError.trim())
  const percent = usagePercent(data.percent)
  const exactPercent = typeof data.percent === 'number' && Number.isInteger(data.percent) ? percent : null
  const hostState = data.batteryState === 'present' || data.batteryState === 'absent' || data.batteryState === 'unknown' ? data.batteryState : null
  const hostSource = data.powerSource === 'ac' || data.powerSource === 'battery' || data.powerSource === 'unknown' ? data.powerSource : null
  const isCharging = data.isCharging === true
  const batteryState: BatteryState = hostState ?? (exactPercent === null ? 'unknown' : 'present')
  const powerSource: PowerSource = hostSource ?? (typeof data.isCharging === 'boolean' ? (isCharging ? 'ac' : 'battery') : 'unknown')
  return { batteryPercent: batteryState === 'present' ? exactPercent : null, isCharging, batteryState, powerSource, readError: null }
}

/**
 * 读取宿主枚举的挂载卷。与公共 probeRealDiskDrives 的区别：部分卷读取失败时保留读到的卷，
 * 失败原因逐条返回，不把整张列表当失败、也不吞掉原因。
 */
export async function readMountedVolumes(hostOverride?: unknown): Promise<{ drives: RealDiskDriveInfo[]; errors: string[]; failed: boolean }> {
  const res = await callHostTransport<Record<string, unknown>>('system_list_volumes', {}, hostOverride)
  if (!res.ok) return { drives: [], errors: [isHostMethodMissing(res.error) ? hostUpgradeError('读取磁盘卷列表').message : res.error || '挂载卷列表读取失败'], failed: true }
  const data = res.data && typeof res.data === 'object' ? res.data : null
  if (!data || !Array.isArray(data.volumes)) return { drives: [], errors: ['挂载卷列表格式无效'], failed: true }
  const errors = Array.isArray(data.errors) ? data.errors.filter((e): e is string => typeof e === 'string' && !!e.trim()) : []
  if (data.partial && errors.length === 0) errors.push('部分卷容量读取失败')
  const drives: RealDiskDriveInfo[] = []
  for (const value of data.volumes as unknown[]) {
    const v = value && typeof value === 'object' ? value as Record<string, unknown> : null
    const total = Number(v?.totalBytes), used = Number(v?.usedBytes), available = Number(v?.availableBytes)
    const valid = v && typeof v.path === 'string' && v.path && typeof v.totalBytes === 'number' && typeof v.usedBytes === 'number' && typeof v.availableBytes === 'number' &&
      Number.isFinite(total) && total > 0 && Number.isFinite(used) && used >= 0 && Number.isFinite(available) && available >= 0
    if (!valid) { errors.push(`${typeof v?.path === 'string' && v.path ? v.path : '未知卷'}：容量数据无效`); continue }
    const path = v.path as string
    drives.push({ drive: path.replace(/^([A-Za-z]:)[\\/]$/, '$1'), label: String(v.label || path), fileSystem: String(v.fileSystem || '未知'), capacityGroup: String(v.capacityGroup || path), totalBytes: total, usedBytes: used, availableBytes: available, usagePercent: Math.round(used / total * 100) })
  }
  if (drives.length === 0) return { drives, errors: errors.length > 0 ? errors : ['没有读取到已挂载卷'], failed: true }
  return { drives, errors, failed: false }
}

function isMacPlatform(snap: Pick<HardwareTelemetrySnapshot, 'platform' | 'osName'>): boolean {
  return snap.platform === 'macos' || snap.platform === 'darwin' || snap.osName === 'macOS'
}

/** 按快照所在系统的习惯格式化磁盘容量 */
function storageText(snap: Pick<HardwareTelemetrySnapshot, 'platform' | 'osName'>, bytes: number): string {
  return formatStorageBytes(bytes, isMacPlatform(snap))
}

/** 存储卷显示名：有卷名时「Macintosh HD (/)」，卷名与路径相同时只写路径 */
function driveDisplayName(d: RealDiskDriveInfo): string {
  const label = d.label && d.label !== d.drive && d.label !== `${d.drive}\\` ? d.label : ''
  return label ? `${label} (${d.drive})` : d.drive
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
  // 不在摘要里放“余量”：紧挨着 CPU 负载容易被误读成另一种负载，余量只在报告里给出
  parts.push(
    `CPU ${snap.logicalCpuCount === null ? `线程数${READ_FAILED}` : `${snap.logicalCpuCount} 线程`} (负载 ${percentOrFailed(snap.cpuUsagePercent)})`
  )
  parts.push(
    `内存 ${bytesOrFailed(snap.usedMemoryBytes)} / ${bytesOrFailed(snap.totalMemoryBytes)} (${percentOrFailed(snap.memoryUsagePercent)})`
  )
  parts.push(
    snap.driveCount > 0
      ? `存储 ${storageText(snap, snap.totalDiskBytes)} (${snap.driveCount} 个卷，可用 ${storageText(snap, snap.availableDiskBytes)}${snap.diskPartial ? '，部分卷读取失败' : ''})`
      : `磁盘容量${READ_FAILED}`
  )
  return parts.join(' · ')
}

/**
 * 仅按已读取的线程数、内存容量计算规格参考分，不代表实测性能或软件兼容性。
 */
export function evaluateHardwareScenarios(
  logicalCpuCountOrSnap: number | Partial<HardwareTelemetrySnapshot>,
  totalMemoryBytesArg?: number,
  /** null / undefined 表示磁盘容量未读到，不能填入默认容量。 */
  availableDiskBytesArg?: number | null,
  /** 磁盘容量按 1000 进制显示（macOS） */
  decimalStorageUnits = false
): ScenarioCompatibilityItem[] {
  const isSnap = typeof logicalCpuCountOrSnap === 'object' && logicalCpuCountOrSnap !== null
  const decimalUnits = isSnap
    ? isMacPlatform({ platform: logicalCpuCountOrSnap.platform ?? null, osName: logicalCpuCountOrSnap.osName ?? null })
    : decimalStorageUnits
  const logicalCpuCount = positiveNumber(isSnap ? logicalCpuCountOrSnap.logicalCpuCount : logicalCpuCountOrSnap)
  const totalMemoryBytes = positiveNumber(isSnap ? logicalCpuCountOrSnap.totalMemoryBytes : totalMemoryBytesArg)
  if (logicalCpuCount === null || !Number.isInteger(logicalCpuCount) || totalMemoryBytes === null) return []
  const availableDiskBytes = nonNegativeNumber(isSnap
    ? logicalCpuCountOrSnap.failures?.includes('磁盘容量') ? null : logicalCpuCountOrSnap.availableDiskBytes
    : availableDiskBytesArg)
  const diskKnown = availableDiskBytes !== null
  const ramGb = totalMemoryBytes / (1024 * 1024 * 1024)
  const freeDiskGb = availableDiskBytes === null ? null : availableDiskBytes / (1024 * 1024 * 1024)
  const cores = logicalCpuCount

  return [
    {
      id: 'sc-office-dev',
      scenario: '极客开发、多开容器与重度办公',
      tier: ramGb >= 24 && cores >= 12 ? '规格参考较高' : ramGb >= 14 ? '规格参考一般' : '规格参考有限',
      summary: `当前 ${cores} 逻辑线程、${formatBytes(totalMemoryBytes)} 物理内存；估算未包含编译耗时、容器资源配置与应用实际占用。`,
      bottleneckHint: '请结合实际项目编译与多开时的 CPU、内存占用判断需求'
    },
    {
      id: 'sc-4k-media',
      scenario: '4K 影音剪辑、渲染与创意设计',
      tier: ramGb >= 30 && cores >= 16 ? '规格参考较高' : ramGb >= 15 && cores >= 8 ? '规格参考一般' : '规格参考有限',
      summary: diskKnown
        ? `当前 ${cores} 逻辑线程，可用磁盘空间 ${formatStorageBytes(availableDiskBytes, decimalUnits)}；未测量转码速度、磁盘吞吐或硬件编解码能力。`
        : `当前 ${cores} 逻辑线程；磁盘容量${READ_FAILED}，未评估素材存储空间或转码速度。`,
      bottleneckHint: !diskKnown
        ? `磁盘容量${READ_FAILED}，无法评估素材存储空间`
        : freeDiskGb !== null && freeDiskGb < 50
        ? '剩余磁盘空间偏紧，请核对素材与缓存所需空间'
        : '请核对素材与缓存大小，并用实际项目验证编解码表现'
    },
    {
      id: 'sc-aaa-gaming',
      scenario: '主流电竞与 3A 次世代游戏大作',
      tier: ramGb >= 15 && cores >= 12 ? '规格参考一般' : '规格参考有限',
      summary: `当前 ${cores} 逻辑线程、${formatBytes(totalMemoryBytes)} 物理内存；未读取图形处理器或显存，未验证游戏的系统支持。`,
      bottleneckHint: '无法据此判断游戏兼容性、画质或帧率，请核对游戏官方要求'
    },
    {
      id: 'sc-local-llm',
      scenario: '本地离线 AI 大模型推理',
      tier: ramGb >= 30 ? '规格参考较高' : ramGb >= 15 ? '规格参考一般' : '规格参考有限',
      summary: `本机物理内存 ${formatBytes(totalMemoryBytes)}；模型大小、量化方式、上下文与计算后端均未验证。`,
      bottleneckHint: '无法据此保证模型能装入内存或推理速度，请按实际模型测量'
    }
  ]
}

export const SCENARIO_ESTIMATE_NOTE = '仅按线程数与内存容量作规则估算，磁盘余量只作空间提醒。未运行性能测试，未评估处理器代际、图形能力、软件兼容性或实际工作负载。'

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
  const headroom = snap.loadHeadroomPercent === null ? '未评估' : `${snap.loadHeadroomPercent}%`
  const displays = snap.displayCount === null ? `显示器信息${READ_FAILED}` : `${snap.displayCount} 台显示器`
  const power = formatPowerStatus(snap.batteryPercent, snap.isCharging, snap.powerReadFailed, snap.batteryState, snap.powerSource)
  const diskReadFailed = snap.failures.includes('磁盘容量') || snap.driveCount === 0
  const warnings = snap.warnings ?? []
  const disk = (bytes: number) => storageText(snap, bytes)

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
          readFailed: diskReadFailed,
          ...(snap.diskPartial ? { partial: true } : {}),
          driveCount: diskReadFailed ? null : snap.driveCount,
          totalBytes: diskReadFailed ? null : snap.totalDiskBytes,
          availableBytes: diskReadFailed ? null : snap.availableDiskBytes,
          drives: snap.drives
        },
        displays: snap.displayCount,
        power: {
          batteryPercent: snap.batteryPercent,
          isCharging: snap.isCharging,
          batteryState: snap.batteryState,
          powerSource: snap.powerSource,
          readFailed: snap.powerReadFailed
        },
        loadHeadroomPercent: snap.loadHeadroomPercent,
        assessment: { scenarios: 'spec-estimate', performanceMeasured: false,
          loadHeadroom: '100 - max(cpuUsagePercent, memoryUsagePercent)', note: SCENARIO_ESTIMATE_NOTE },
        scenarios: snap.scenarios,
        readFailures: snap.failures,
        readWarnings: warnings
      },
      null,
      2
    )
  }

  const failureLine = snap.failures.length > 0 ? `未能读取: ${snap.failures.join('、')}` : ''
  const reasonLine = warnings.length > 0 ? `失败原因: ${warnings.join('；')}` : ''
  const partialNote = snap.diskPartial ? '，不含读取失败的卷' : ''

  if (format === 'txt') {
    const driveLines = snap.drives.length > 0
      ? snap.drives
        .map(d => `  [${driveDisplayName(d)}] 总容量: ${disk(d.totalBytes)} | 已用: ${disk(d.usedBytes)} (${d.usagePercent}%) | 可用: ${disk(d.availableBytes)}`)
        .join('\n')
      : `  磁盘容量${READ_FAILED}`
    return [
      '====================================================',
      '           ZTools 本机硬件配置与负载报告        ',
      '====================================================',
      `生成时间: ${new Date().toLocaleString()}`,
      `空闲余量: ${headroom}（CPU 与内存当前未占用比例的较小值，不代表硬件健康）`,
      ...(failureLine ? [failureLine] : []),
      ...(reasonLine ? [reasonLine] : []),
      `处理器: ${cpuModel} (${threads}, 当前负载 ${cpuLoad})`,
      `物理内存: 总计 ${bytesOrFailed(snap.totalMemoryBytes)} | 已用 ${bytesOrFailed(snap.usedMemoryBytes)} (${percentOrFailed(snap.memoryUsagePercent)}) | 可用 ${bytesOrFailed(snap.availableMemoryBytes)}`,
      `操作系统: ${formatOsLine(snap)}`,
      `显示与供电: ${snap.displayCount === null ? displays : `${snap.displayCount} 台显示器在线`} | ${power}`,
      '----------------------------------------------------',
      `物理存储卷明细${snap.diskPartial ? '（部分卷读取失败，未列出）' : ''}:`,
      driveLines,
      '===================================================='
    ].join('\n')
  }

  const driveMd = snap.drives.length > 0
    ? snap.drives
      .map(d => `- **存储卷 ${driveDisplayName(d)}**: 总计 \`${disk(d.totalBytes)}\` · 已用 \`${disk(d.usedBytes)} (${d.usagePercent}%)\` · 剩余 \`${disk(d.availableBytes)}\``)
      .join('\n')
    : `- 磁盘容量${READ_FAILED}`
  const scenarioMd = snap.scenarios.length > 0
    ? snap.scenarios
      .map(s => `- **${s.scenario}**: \`${s.tier}\` — ${s.summary} ${s.bottleneckHint}`)
      .join('\n')
    : `- CPU 线程数或内存容量${READ_FAILED}，未评估`

  return `# ZTools 硬件配置与规格估算报告

- **报告生成时间**: \`${new Date().toLocaleString()}\`
- **空闲余量**: **${headroom}**（CPU 与内存当前未占用比例的较小值，不代表硬件健康）
${failureLine ? `- **${failureLine}**\n` : ''}${reasonLine ? `- ${reasonLine}\n` : ''}
---

### 1. 核心计算与内存规格
- **中央处理器**: \`${cpuModel}\` (\`${threads}\`, 瞬时负载 \`${cpuLoad}\`)
- **物理内存**: 总容量 \`${bytesOrFailed(snap.totalMemoryBytes)}\` (已用 \`${bytesOrFailed(snap.usedMemoryBytes)} / ${percentOrFailed(snap.memoryUsagePercent)}\`, 可用 \`${bytesOrFailed(snap.availableMemoryBytes)}\`)
- **操作系统与内核**: \`${formatOsLine(snap)}\`
- **显示器与电源**: \`${displays}\` · \`${power}\`

---

### 2. 已挂载卷容量（共享容器去重）${diskReadFailed ? `（${READ_FAILED}）` : ` (${snap.driveCount} 个挂载卷 · 共 ${disk(snap.totalDiskBytes)}${partialNote})`}
${driveMd}

---

### 3. 四类场景规格估算
${SCENARIO_ESTIMATE_NOTE}

${scenarioMd}
`
}

/** 两次 CPU 采样的间隔：宿主返回的是「距上一次任意调用」的平均负载，第一次读到的可能是几小时的平均值 */
export const CPU_SAMPLE_INTERVAL_MS = 400

type CpuUsageResponse = { ok: boolean; data?: { total: number; perCore: number[] }; error?: string }

/**
 * 读取当前 CPU 负载：先取一次作为起点（结果丢弃），间隔一小段时间再取一次，得到这段时间内的真实负载。
 * 宿主按两次调用之间的 CPU 时间差计算负载，只调一次会拿到距上次调用（可能是插件很久以前打开时）的平均值。
 */
async function sampleCpuUsage(hostOverride: unknown, intervalMs: number): Promise<CpuUsageResponse> {
  const first = await callHostTransport<{ total: number; perCore: number[] }>('system_get_cpu_usage', {}, hostOverride)
  if (!first.ok) return first
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, intervalMs)))
  return callHostTransport<{ total: number; perCore: number[] }>('system_get_cpu_usage', {}, hostOverride)
}

/**
 * 采集本机硬件配置与实时负载快照
 * 每个宿主接口独立判断成败：失败的字段为 null 并记入 failures，不用默认值兜底
 */
export async function fetchHardwareTelemetrySnapshot(
  hostOverride?: unknown,
  options: { cpuSampleIntervalMs?: number } = {}
): Promise<HardwareTelemetrySnapshot> {
  const [hwRes, sysRes, cpuRes, memRes, batRes, dispRes, volumes] = await Promise.all([
    callHostTransport<{
      cpuModel?: string
      cpuModels?: string[]
      logicalCpuCount?: number
      totalMemory?: number
      osVersion?: string
      platform?: string
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
    sampleCpuUsage(hostOverride, options.cpuSampleIntervalMs ?? CPU_SAMPLE_INTERVAL_MS),
    callHostTransport<{ total: number; used: number; available: number; percent: number }>(
      'system_get_memory_usage',
      {},
      hostOverride
    ),
    callHostTransport('system_get_battery_status', {}, hostOverride),
    callHostTransport<Array<{
      id: number
      label?: string
      bounds?: { x: number; y: number; width: number; height: number }
      workArea?: { x: number; y: number; width: number; height: number }
      scaleFactor?: number
      displayFrequency?: number | null
      colorDepth?: number | null
    }>>('screen_get_all_displays', {}, hostOverride),
    readMountedVolumes(hostOverride)
  ])

  const failures: string[] = []
  const warnings: string[] = []
  const noteError = (module: string, res: { ok: boolean; error?: string }) => { if (!res.ok && res.error) warnings.push(`${module}：${res.error}`) }
  const hw = hwRes.ok && hwRes.data && typeof hwRes.data === 'object' ? hwRes.data : null
  const sys = sysRes.ok && sysRes.data && typeof sysRes.data === 'object' ? sysRes.data : null

  // CPU 型号：公共 native-ipc 在宿主没给型号时会填占位值 'x86_64 Processor'，同样按未读到处理
  const rawCpuModel = nonEmptyString(hw?.cpuModel)
  const cpuModel = rawCpuModel && rawCpuModel !== PLACEHOLDER_CPU_MODEL ? rawCpuModel : null
  const logicalCpuCount = positiveNumber(hw?.logicalCpuCount)
  if (cpuModel === null || logicalCpuCount === null) { failures.push('处理器信息'); noteError('处理器信息', hwRes) }

  const cpuUsagePercent = cpuRes.ok ? usagePercent(cpuRes.data?.total) : null
  if (cpuUsagePercent === null) { failures.push('CPU 负载'); noteError('CPU 负载', cpuRes) }

  const mem = memRes.ok && memRes.data && typeof memRes.data === 'object' ? memRes.data : null
  const totalMemoryBytes = positiveNumber(mem?.total) ?? positiveNumber(hw?.totalMemory)
  const usedMemoryBytes = nonNegativeNumber(mem?.used)
  const availableMemoryBytes = nonNegativeNumber(mem?.available)
  const memoryUsagePercent = usagePercent(mem?.percent)
  if (usedMemoryBytes === null || availableMemoryBytes === null || memoryUsagePercent === null) { failures.push('内存占用'); noteError('内存占用', memRes) }

  const platform = nonEmptyString(sys?.platform) ?? nonEmptyString(hw?.platform)
  const osName = nonEmptyString(sys?.osName)
  const osVersion = osVersionString(sys?.osVersion) ?? osVersionString(hw?.osVersion)
  const kernelVersion = nonEmptyString(sys?.kernelRelease) ?? nonEmptyString(sys?.windowsRelease)
  const osBuild = positiveNumber(sys?.osBuild)
  const osArch = nonEmptyString(sys?.osArch)
  if (osName === null && osVersion === null) { failures.push('系统版本'); noteError('系统版本', sysRes) }

  const battery = interpretBatteryStatus(batRes)
  const powerReadFailed = battery.readError !== null
  const { batteryPercent, isCharging, batteryState, powerSource } = battery
  // 宿主的原因本身可能已带「电源状态」前缀（如「电源状态读取超时」），不重复写成「电源状态：电源状态读取超时」
  if (powerReadFailed) { failures.push('电源状态'); warnings.push(`电源状态：${String(battery.readError).replace(/^电源状态[：:]?\s*/, '') || READ_FAILED}`) }

  const displays = dispRes.ok && Array.isArray(dispRes.data) ? dispRes.data : []
  const displayReadFailed = !(dispRes.ok && Array.isArray(dispRes.data))
  if (displayReadFailed) { failures.push('显示器'); noteError('显示器', dispRes) }

  // 任何电脑至少有一个卷：一个都没读到就是读取失败；读到一部分时保留读到的卷并标注「部分磁盘卷」
  const drives = volumes.drives
  const diskPartial = !volumes.failed && volumes.errors.length > 0
  if (volumes.failed) failures.push('磁盘容量')
  else if (diskPartial) failures.push(PARTIAL_DISK_FAILURE)
  for (const error of volumes.errors) warnings.push(`磁盘容量：${error}`)
  const capacityDrives = uniqueCapacityDrives(drives)
  const totalDiskBytes = capacityDrives.reduce((s, d) => s + d.totalBytes, 0)
  const usedDiskBytes = capacityDrives.reduce((s, d) => s + d.usedBytes, 0)
  const availableDiskBytes = capacityDrives.reduce((s, d) => s + d.availableBytes, 0)

  const scenarios =
    logicalCpuCount !== null && totalMemoryBytes !== null
      ? evaluateHardwareScenarios(logicalCpuCount, totalMemoryBytes, drives.length > 0 ? availableDiskBytes : null, isMacPlatform({ platform, osName }))
      : []
  const loadHeadroomPercent =
    cpuUsagePercent !== null && memoryUsagePercent !== null
      ? 100 - Math.max(cpuUsagePercent, memoryUsagePercent)
      : null

  const osInfo = { platform, osName, osVersion, kernelVersion, osBuild, osArch }
  const archText = osArch ? osArch.toUpperCase() : '未知'
  const decimalStorage = isMacPlatform({ platform, osName })
  const disk = (bytes: number) => formatStorageBytes(bytes, decimalStorage)
  const threadsText = logicalCpuCount === null ? `线程数${READ_FAILED}` : `${logicalCpuCount} 逻辑线程`
  const versionParts = describeOsVersionParts(osInfo)
  const powerText = formatPowerStatus(batteryPercent, isCharging, powerReadFailed, batteryState, powerSource)

  const entries: HardwareSpecEntry[] = [
    {
      id: 'hw-cpu-spec',
      category: 'cpu',
      title: cpuModel ?? `处理器型号${READ_FAILED}`,
      subtitle: `${threadsText} · 运行架构 ${archText}`,
      value: `负载 ${percentOrFailed(cpuUsagePercent)}`,
      tag: logicalCpuCount === null ? '线程未知' : `${logicalCpuCount} 线程`,
      detailMarkdown: `# 中央处理器

**处理器型号**: \`${cpuModel ?? READ_FAILED}\`

---

### 核心规格与实时负载
- **逻辑处理器数量**: \`${logicalCpuCount === null ? READ_FAILED : `${logicalCpuCount} 线程`}\`
- **运行架构**: \`${archText}\`
- **当前瞬时总利用率**: \`${percentOrFailed(cpuUsagePercent)}\`

> 以上数据来自本机硬件与系统负载的实时采样。`
    },
    {
      id: 'hw-mem-spec',
      category: 'memory',
      title: totalMemoryBytes === null ? `物理内存容量${READ_FAILED}` : `物理内存总容量 ${formatBytes(totalMemoryBytes)}`,
      subtitle: `已用 ${bytesOrFailed(usedMemoryBytes)} · 可用余量 ${bytesOrFailed(availableMemoryBytes)}`,
      value: memoryUsagePercent === null ? `占用${READ_FAILED}` : `${memoryUsagePercent}% 已用`,
      tag: totalMemoryBytes === null ? '容量未知' : formatBytes(totalMemoryBytes),
      detailMarkdown: `# 物理内存

**安装总物理内存**: \`${bytesOrFailed(totalMemoryBytes)}\`${totalMemoryBytes === null ? '' : ` (${totalMemoryBytes.toLocaleString()} Bytes)`}

---

### 实时工作集分布
- **当前已用物理内存**: \`${bytesOrFailed(usedMemoryBytes)}\` (${percentOrFailed(memoryUsagePercent)})
- **当前空闲可用内存**: \`${bytesOrFailed(availableMemoryBytes)}\`
- **当前占用状态**: \`${memoryUsagePercent === null ? '未知' : memoryUsagePercent > 85 ? '占用较高' : '占用未超过 85%'}\``
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
- **运行架构**: \`${osArch ?? '未知'}\`
- **电源/电池状态**: \`${powerText}\``
    }
  ]

  for (const d of drives) {
    entries.push({
      id: `hw-drive-${d.drive}`,
      category: 'storage',
      title: `存储卷 ${driveDisplayName(d)}`,
      subtitle: `总容量 ${disk(d.totalBytes)} · 已用 ${disk(d.usedBytes)} · 剩余可用 ${disk(d.availableBytes)}`,
      value: `已用 ${d.usagePercent}%`,
      tag: disk(d.totalBytes),
      detailMarkdown: `# 存储卷 ${driveDisplayName(d)}

- **挂载位置**: \`${d.drive}\`
- **文件系统**: \`${d.fileSystem || '未知'}\`
- **总容量**: \`${disk(d.totalBytes)}\`
- **当前已用容量**: \`${disk(d.usedBytes)} (${d.usagePercent}%)\`
- **剩余可用容量**: \`${disk(d.availableBytes)}\`
- **空间状态**: \`${d.usagePercent > 85 ? '空间偏紧' : '占用未超过 85%'}\`${decimalStorage ? `

容量按 1 GB = 1000³ 字节显示，与访达一致。同一 APFS 容器内的卷共享容量，合计时只计一次。` : ''}`
    })
  }

  displays.forEach((disp, index) => {
    // 宿主拿不到的字段如实显示「未知」，不用 1920×1080 / 60Hz / 24-bit 之类的默认值冒充真实值
    const w = positiveNumber(disp.bounds?.width)
    const h = positiveNumber(disp.bounds?.height)
    const resolution = w && h ? `${w} × ${h}` : '未知'
    // 缩放比例读不到时写「未知」，不按 100% 冒充
    const scaleValue = positiveNumber(disp.scaleFactor)
    const scale = scaleValue === null ? '未知' : `${Math.round(scaleValue * 100)}%`
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
      subtitle: `缩放比例 ${scale} · 刷新率 ${hz} · 色深 ${depth}`,
      value: `${w && h ? `${w}×${h}` : '分辨率未知'}${hzValue ? ` @${Math.round(hzValue)}Hz` : ''}`,
      tag: scaleValue === null ? '缩放未知' : `缩放 ${scale}`,
      detailMarkdown: `# 显示器输出端点 #${index + 1}

- **设备标识**: \`${disp.label || `Display #${disp.id || index + 1}`}\`
- **逻辑分辨率**: \`${resolution}\`
- **工作区尺寸**: \`${workW && workH ? `${workW} × ${workH}` : '未知'}\`
- **系统缩放比例**: \`${scale}\`
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
      // 档位只由线程数与内存容量的阈值决定，不给精确分数（分数会和档位互相矛盾，也没有实测依据）
      value: '规格估算',
      tag: sc.tier,
      detailMarkdown: `# ${sc.scenario}

${SCENARIO_ESTIMATE_NOTE}

- **规格参考**: **${sc.tier}**
- **已知规格与限制**: ${sc.summary}
- **待核对项**: ${sc.bottleneckHint}`
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
    diskPartial,
    displayCount: displayReadFailed ? null : displays.length,
    batteryPercent,
    isCharging,
    batteryState,
    powerSource,
    powerReadFailed,
    loadHeadroomPercent,
    scenarios,
    failures,
    warnings,
    entries
  }
}
