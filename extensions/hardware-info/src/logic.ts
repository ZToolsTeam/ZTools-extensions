import { getLocale } from '@ztools/declarative-ui'
import { uniqueCapacityDrives, type RealDiskDriveInfo } from './volume-ipc.js'
import { hostUpgradeError, isHostMethodMissing } from './host-compat.js'
import { t } from './i18n.js'
/**
 * 电脑硬件信息业务逻辑
 * 通过宿主通用系统接口读取 CPU 型号/线程/负载、物理内存、系统版本、磁盘容量、显示器与电源状态，
 * 并据此给出 4 个应用场景的规格档位（不打分）与 Markdown / JSON / TXT 配置报告。
 * 读取失败的字段一律记为 null 并在界面显示「读取失败」，不用默认值冒充真实数据。
 */

import { callHostTransport, formatBytes } from './native-ipc.js'
import { resolveErrorMessage } from './error-i18n.js'
import { TELEMETRY_MODULES, LEGACY_DISK_FAILURE_MARKERS } from './telemetry-modules.zh-data.js'

export { formatBytes } from './native-ipc.js'
export { TELEMETRY_MODULES }

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
  tier: string
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

/** 公共 native-ipc 在宿主没给 CPU 型号时填入的占位值，不是真实型号 */
const PLACEHOLDER_CPU_MODEL = 'x86_64 Processor'

/** 宿主返回的数值不可信：只有有限正数才算拿到了真实值 */
function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/** 有限非负数（允许 0，例如负载 0%、已用 0 B） */
function isDiskFailureMarker(entry: string): boolean {
  return LEGACY_DISK_FAILURE_MARKERS.includes(entry) || entry === t('modDisk')
}

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
  return bytes === null ? t('readFailed') : formatBytes(bytes)
}

function percentOrFailed(percent: number | null): string {
  return percent === null ? t('readFailed') : `${percent}%`
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
  if (readFailed) return t('powerReadFailed')
  if (batteryState === 'unknown') return t('batteryUnknown')
  if (batteryState === 'absent') return powerSource === 'ac' ? t('noBatteryAc') : t('noBattery')
  const sourceText = powerSource === 'ac' ? t('sourceAc') : powerSource === 'battery' ? t('sourceBattery') : t('sourceUnknown')
  const charge = batteryPercent === null ? t('chargeUnknown') : t('chargePercent', { percent: batteryPercent })
  return t('powerSummary', { charge, source: sourceText })
}

/** 宿主返回的电源状态 → 电池三态与供电来源；新版宿主给 batteryState / powerSource / readError，旧版只有 percent 与 isCharging */
export function interpretBatteryStatus(res: { ok: boolean; data?: unknown; error?: string }): {
  batteryPercent: number | null; isCharging: boolean; batteryState: BatteryState; powerSource: PowerSource; readError: string | null
} {
  const failed = (readError: string) => ({ batteryPercent: null, isCharging: false, batteryState: 'unknown' as const, powerSource: 'unknown' as const, readError })
  if (!res.ok) return failed(resolveErrorMessage(res, t('errRpcFailed')))
  const data = res.data && typeof res.data === 'object' ? res.data as Record<string, unknown> : null
  if (!data) return failed(t('errInvalidData'))
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
  if (!res.ok) return { drives: [], errors: [isHostMethodMissing(res.error) ? hostUpgradeError(t('featureReadVolumes')).message : resolveErrorMessage(res, t('errVolumesReadFailed'))], failed: true }
  const data = res.data && typeof res.data === 'object' ? res.data : null
  if (!data || !Array.isArray(data.volumes)) return { drives: [], errors: [t('errVolumesFormatInvalid')], failed: true }
  const errors = Array.isArray(data.errors) ? data.errors.filter((e): e is string => typeof e === 'string' && !!e.trim()) : []
  if (data.partial && errors.length === 0) errors.push(t('errPartialVolumesFailed'))
  const drives: RealDiskDriveInfo[] = []
  for (const value of data.volumes as unknown[]) {
    const v = value && typeof value === 'object' ? value as Record<string, unknown> : null
    const total = Number(v?.totalBytes), used = Number(v?.usedBytes), available = Number(v?.availableBytes)
    const valid = v && typeof v.path === 'string' && v.path && typeof v.totalBytes === 'number' && typeof v.usedBytes === 'number' && typeof v.availableBytes === 'number' &&
      Number.isFinite(total) && total > 0 && Number.isFinite(used) && used >= 0 && Number.isFinite(available) && available >= 0
    if (!valid) { errors.push(t('errVolumeCapacityInvalid', { path: typeof v?.path === 'string' && v.path ? v.path : t('unknownVolume') })); continue }
    const path = v.path as string
    drives.push({ drive: path.replace(/^([A-Za-z]:)[\\/]$/, '$1'), label: String(v.label || path), fileSystem: String(v.fileSystem || t('unknownLabel')), capacityGroup: String(v.capacityGroup || path), totalBytes: total, usedBytes: used, availableBytes: available, usagePercent: Math.round(used / total * 100) })
  }
  if (drives.length === 0) return { drives, errors: errors.length > 0 ? errors : [t('errNoMountedVolumes')], failed: true }
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
  if (snap.osVersion && snap.osVersion !== snap.kernelVersion) parts.push(t('osVersionPrefix', { version: snap.osVersion }))
  if (snap.kernelVersion) parts.push(`${isMacPlatform(snap) ? t('darwinKernelPrefix') : t('kernelVersionPrefix')} ${snap.kernelVersion}`)
  if (snap.osBuild !== null) parts.push(`Build ${snap.osBuild}`)
  return parts
}

/** 报告中的一行系统描述，例如「macOS 26.5.1 (Darwin 内核 25.5.0, arm64)」 */
export function formatOsLine(
  snap: Pick<HardwareTelemetrySnapshot, 'platform' | 'osName' | 'osVersion' | 'kernelVersion' | 'osBuild' | 'osArch'>
): string {
  if (!snap.osName && !snap.osVersion) return t('osReadFailed')
  const head = [snap.osName, snap.osVersion].filter(Boolean).join(' ')
  const extra: string[] = []
  if (snap.kernelVersion && snap.kernelVersion !== snap.osVersion) {
    extra.push(`${isMacPlatform(snap) ? t('darwinKernelPrefix') : t('kernelShortPrefix')} ${snap.kernelVersion}`)
  }
  if (snap.osBuild !== null) extra.push(`Build ${snap.osBuild}`)
  if (snap.osArch) extra.push(snap.osArch)
  return extra.length > 0 ? `${head} (${extra.join(', ')})` : head
}

/** 顶部单行状态摘要：读取失败的部分如实标注，全部失败时提示重试 */
export function buildSummaryText(snap: HardwareTelemetrySnapshot | null): string {
  if (!snap) return t('summaryLoading')
  const nothingRead =
    snap.cpuModel === null &&
    snap.logicalCpuCount === null &&
    snap.totalMemoryBytes === null &&
    snap.osName === null &&
    snap.driveCount === 0
  if (nothingRead) return t('summaryAllFailed')
  const parts: string[] = []
  parts.push(
    t('summaryCpuPart', {
      threads: snap.logicalCpuCount === null ? t('summaryThreadsFailed') : t('summaryThreadsShort', { count: snap.logicalCpuCount }),
      load: percentOrFailed(snap.cpuUsagePercent)
    })
  )
  parts.push(
    t('summaryMemPart', {
      used: bytesOrFailed(snap.usedMemoryBytes),
      total: bytesOrFailed(snap.totalMemoryBytes),
      percent: percentOrFailed(snap.memoryUsagePercent)
    })
  )
  parts.push(
    snap.driveCount > 0
      ? t('summaryDiskPart', {
          total: storageText(snap, snap.totalDiskBytes),
          count: snap.driveCount,
          avail: storageText(snap, snap.availableDiskBytes),
          partial: snap.diskPartial ? t('summaryPartialDiskNote') : ''
        })
      : t('summaryDiskFailed')
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
    ? logicalCpuCountOrSnap.failures?.some(isDiskFailureMarker) ? null : logicalCpuCountOrSnap.availableDiskBytes
    : availableDiskBytesArg)
  const diskKnown = availableDiskBytes !== null
  const ramGb = totalMemoryBytes / (1024 * 1024 * 1024)
  const freeDiskGb = availableDiskBytes === null ? null : availableDiskBytes / (1024 * 1024 * 1024)
  const cores = logicalCpuCount

  return [
    {
      id: 'sc-office-dev',
      scenario: t('scDevTitle'),
      tier: ramGb >= 24 && cores >= 12 ? t('tierHigh') : ramGb >= 14 ? t('tierMedium') : t('tierLow'),
      summary: t('scDevSummary', { cores, mem: formatBytes(totalMemoryBytes) }),
      bottleneckHint: t('scDevHint')
    },
    {
      id: 'sc-4k-media',
      scenario: t('scMediaTitle'),
      tier: ramGb >= 30 && cores >= 16 ? t('tierHigh') : ramGb >= 15 && cores >= 8 ? t('tierMedium') : t('tierLow'),
      summary: diskKnown
        ? t('scMediaSummaryDisk', { cores, disk: formatStorageBytes(availableDiskBytes, decimalUnits) })
        : t('scMediaSummaryNoDisk', { cores }),
      bottleneckHint: !diskKnown
        ? t('scMediaHintNoDisk')
        : freeDiskGb !== null && freeDiskGb < 50
        ? t('scMediaHintLowDisk')
        : t('scMediaHintOk')
    },
    {
      id: 'sc-aaa-gaming',
      scenario: t('scGameTitle'),
      tier: ramGb >= 15 && cores >= 12 ? t('tierMedium') : t('tierLow'),
      summary: t('scGameSummary', { cores, mem: formatBytes(totalMemoryBytes) }),
      bottleneckHint: t('scGameHint')
    },
    {
      id: 'sc-local-llm',
      scenario: t('scLlmTitle'),
      tier: ramGb >= 30 ? t('tierHigh') : ramGb >= 15 ? t('tierMedium') : t('tierLow'),
      summary: t('scLlmSummary', { mem: formatBytes(totalMemoryBytes) }),
      bottleneckHint: t('scLlmHint')
    }
  ]
}

export function exportHardwareReport(
  snap: HardwareTelemetrySnapshot,
  format: 'markdown' | 'json' | 'txt' = 'markdown'
): string {
  const cpuModel = snap.cpuModel ?? t('cpuModelFailed')
  const threads = snap.logicalCpuCount === null ? t('summaryThreadsFailed') : t('summaryThreadsCount', { count: snap.logicalCpuCount })
  const cpuLoad = percentOrFailed(snap.cpuUsagePercent)
  const headroom = snap.loadHeadroomPercent === null ? t('notEvaluated') : `${snap.loadHeadroomPercent}%`
  const displays = snap.displayCount === null ? t('displayInfoFailed') : t('displayCountText', { count: snap.displayCount })
  const power = formatPowerStatus(snap.batteryPercent, snap.isCharging, snap.powerReadFailed, snap.batteryState, snap.powerSource)
  const diskReadFailed = snap.failures.some(isDiskFailureMarker) || snap.driveCount === 0
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
          loadHeadroom: '100 - max(cpuUsagePercent, memoryUsagePercent)', note: t('scenarioEstimateNote') },
        scenarios: snap.scenarios,
        readFailures: snap.failures,
        readWarnings: warnings
      },
      null,
      2
    )
  }

  const failureLine = snap.failures.length > 0 ? t('reportFailureLine', { failures: snap.failures.join(t('listSeparator')) }) : ''
  const reasonLine = warnings.length > 0 ? t('reportReasonLine', { warnings: warnings.join(t('semiSeparator')) }) : ''
  const partialNote = snap.diskPartial ? t('reportPartialNote') : ''

  if (format === 'txt') {
    const driveLines = snap.drives.length > 0
      ? snap.drives
        .map(d => t('txtDriveLine', { name: driveDisplayName(d), total: disk(d.totalBytes), used: disk(d.usedBytes), percent: d.usagePercent, avail: disk(d.availableBytes) }))
        .join('\n')
      : t('txtDriveFailed')
    return [
      '====================================================',
      t('txtReportTitle'),
      '====================================================',
      t('txtGeneratedAt', { time: new Date().toLocaleString(getLocale()) }),
      t('txtHeadroom', { headroom }),
      ...(failureLine ? [failureLine] : []),
      ...(reasonLine ? [reasonLine] : []),
      t('txtCpu', { model: cpuModel, threads, load: cpuLoad }),
      t('txtMemory', { total: bytesOrFailed(snap.totalMemoryBytes), used: bytesOrFailed(snap.usedMemoryBytes), percent: percentOrFailed(snap.memoryUsagePercent), avail: bytesOrFailed(snap.availableMemoryBytes) }),
      t('txtOs', { os: formatOsLine(snap) }),
      t('txtDisplayPower', { displays: snap.displayCount === null ? displays : t('displayCountOnline', { count: snap.displayCount }), power }),
      '----------------------------------------------------',
      t('txtDrivesHeader', { partial: snap.diskPartial ? t('txtDrivesPartialSuffix') : '' }),
      driveLines,
      '===================================================='
    ].join('\n')
  }

  const driveMd = snap.drives.length > 0
    ? snap.drives
      .map(d => t('mdDriveLine', { name: driveDisplayName(d), total: disk(d.totalBytes), used: disk(d.usedBytes), percent: d.usagePercent, avail: disk(d.availableBytes) }))
      .join('\n')
    : t('mdDriveFailed')
  const scenarioMd = snap.scenarios.length > 0
    ? snap.scenarios
      .map(s => t('mdScenarioLine', { scenario: s.scenario, tier: s.tier, summary: s.summary, hint: s.bottleneckHint }))
      .join('\n')
    : t('mdScenarioFailed')

  return `${t('mdReportHeader')}

${t('mdGeneratedAt', { time: new Date().toLocaleString(getLocale()) })}
${t('mdHeadroom', { headroom })}
${failureLine ? `- **${failureLine}**\n` : ''}${reasonLine ? `- ${reasonLine}\n` : ''}
---

${t('mdSec1Header')}
${t('mdCpuLine', { model: cpuModel, threads, load: cpuLoad })}
${t('mdMemLine', { total: bytesOrFailed(snap.totalMemoryBytes), used: bytesOrFailed(snap.usedMemoryBytes), percent: percentOrFailed(snap.memoryUsagePercent), avail: bytesOrFailed(snap.availableMemoryBytes) })}
${t('mdOsLine', { os: formatOsLine(snap) })}
${t('mdDispPowerLine', { displays, power })}

---

${t('mdSec2Header', { suffix: diskReadFailed ? t('mdSec2FailedSuffix') : t('mdSec2CountSuffix', { count: snap.driveCount, total: disk(snap.totalDiskBytes), partial: partialNote }) })}
${driveMd}

---

${t('mdSec3Header')}
${t('scenarioEstimateNote')}

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
  if (cpuModel === null || logicalCpuCount === null) { failures.push(t('modCpuInfo')); noteError(t('modCpuInfo'), hwRes) }

  const cpuUsagePercent = cpuRes.ok ? usagePercent(cpuRes.data?.total) : null
  if (cpuUsagePercent === null) { failures.push(t('modCpuLoad')); noteError(t('modCpuLoad'), cpuRes) }

  const mem = memRes.ok && memRes.data && typeof memRes.data === 'object' ? memRes.data : null
  const totalMemoryBytes = positiveNumber(mem?.total) ?? positiveNumber(hw?.totalMemory)
  const usedMemoryBytes = nonNegativeNumber(mem?.used)
  const availableMemoryBytes = nonNegativeNumber(mem?.available)
  const memoryUsagePercent = usagePercent(mem?.percent)
  if (usedMemoryBytes === null || availableMemoryBytes === null || memoryUsagePercent === null) { failures.push(t('modMemory')); noteError(t('modMemory'), memRes) }

  const platform = nonEmptyString(sys?.platform) ?? nonEmptyString(hw?.platform)
  const osName = nonEmptyString(sys?.osName)
  const osVersion = osVersionString(sys?.osVersion) ?? osVersionString(hw?.osVersion)
  const kernelVersion = nonEmptyString(sys?.kernelRelease) ?? nonEmptyString(sys?.windowsRelease)
  const osBuild = positiveNumber(sys?.osBuild)
  const osArch = nonEmptyString(sys?.osArch)
  if (osName === null && osVersion === null) { failures.push(t('modOsVersion')); noteError(t('modOsVersion'), sysRes) }

  const battery = interpretBatteryStatus(batRes)
  const powerReadFailed = battery.readError !== null
  const { batteryPercent, isCharging, batteryState, powerSource } = battery
  if (powerReadFailed) { failures.push(t('modPower')); warnings.push(t('warningEntry', { module: t('modPower'), error: String(battery.readError).replace(/^(电源状态|Power Status)[：:]?\s*/i, '') || t('readFailed') })) }

  const displays = dispRes.ok && Array.isArray(dispRes.data) ? dispRes.data : []
  const displayReadFailed = !(dispRes.ok && Array.isArray(dispRes.data))
  if (displayReadFailed) { failures.push(t('modDisplay')); noteError(t('modDisplay'), dispRes) }

  // 任何电脑至少有一个卷：一个都没读到就是读取失败；读到一部分时保留读到的卷并标注「部分磁盘卷」
  const drives = volumes.drives
  const diskPartial = !volumes.failed && volumes.errors.length > 0
  if (volumes.failed) failures.push(t('modDisk'))
  else if (diskPartial) failures.push(t('modPartialDisk'))
  for (const error of volumes.errors) warnings.push(t('warningEntry', { module: t('modDisk'), error }))
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
  const archText = osArch ? osArch.toUpperCase() : t('unknownLabel')
  const decimalStorage = isMacPlatform({ platform, osName })
  const disk = (bytes: number) => formatStorageBytes(bytes, decimalStorage)
  const threadsText = logicalCpuCount === null ? t('summaryThreadsFailed') : t('summaryThreadsCount', { count: logicalCpuCount })
  const versionParts = describeOsVersionParts(osInfo)
  const powerText = formatPowerStatus(batteryPercent, isCharging, powerReadFailed, batteryState, powerSource)

  const entries: HardwareSpecEntry[] = [
    {
      id: 'hw-cpu-spec',
      category: 'cpu',
      title: cpuModel ?? t('cpuTitleFailed'),
      subtitle: t('cpuSubtitle', { threads: threadsText, arch: archText }),
      value: t('cpuValue', { load: percentOrFailed(cpuUsagePercent) }),
      tag: logicalCpuCount === null ? t('cpuTagUnknown') : t('summaryThreadsShort', { count: logicalCpuCount }),
      detailMarkdown: `${t('cpuMdHeader')}

${t('cpuMdModel', { model: cpuModel ?? t('readFailed') })}

---

${t('cpuMdSecHeader')}
${t('cpuMdCores', { value: logicalCpuCount === null ? t('readFailed') : t('summaryThreadsShort', { count: logicalCpuCount }) })}
${t('cpuMdArch', { arch: archText })}
${t('cpuMdUsage', { usage: percentOrFailed(cpuUsagePercent) })}

${t('cpuMdFooter')}`
    },
    {
      id: 'hw-mem-spec',
      category: 'memory',
      title: totalMemoryBytes === null ? t('memTitleFailed') : t('memTitleOk', { total: formatBytes(totalMemoryBytes) }),
      subtitle: t('memSubtitle', { used: bytesOrFailed(usedMemoryBytes), avail: bytesOrFailed(availableMemoryBytes) }),
      value: memoryUsagePercent === null ? t('memValueFailed') : t('memValueOk', { percent: memoryUsagePercent }),
      tag: totalMemoryBytes === null ? t('memTagUnknown') : formatBytes(totalMemoryBytes),
      detailMarkdown: `${t('memMdHeader')}

${t('memMdTotal', { total: bytesOrFailed(totalMemoryBytes) })}${totalMemoryBytes === null ? '' : ` (${totalMemoryBytes.toLocaleString(getLocale())} ${totalMemoryBytes === 1 ? 'Byte' : 'Bytes'})`}

---

${t('memMdSecHeader')}
${t('memMdUsed', { used: bytesOrFailed(usedMemoryBytes), percent: percentOrFailed(memoryUsagePercent) })}
${t('memMdAvail', { avail: bytesOrFailed(availableMemoryBytes) })}
${t('memMdStatus', { status: memoryUsagePercent === null ? t('unknownLabel') : memoryUsagePercent > 85 ? t('memStatusHigh') : t('memStatusNormal') })}`
    },
    {
      id: 'hw-os-spec',
      category: 'system',
      title: osName ? `${osName}${osArch ? ` (${osArch})` : ''}` : t('osTitleFailed'),
      subtitle: versionParts.length > 0 ? versionParts.join(' · ') : t('osReadFailed'),
      value: osBuild !== null ? `Build ${osBuild}` : kernelVersion && kernelVersion !== osVersion ? `${t('kernelShortPrefix')} ${kernelVersion}` : '',
      tag: osVersion ?? t('osTagUnknown'),
      detailMarkdown: `${t('osMdHeader')}

${t('osMdOs', { os: osName ?? t('readFailed') })}
${t('osMdVersion', { version: osVersion ?? t('readFailed') })}${kernelVersion && kernelVersion !== osVersion ? `
${t('osMdKernel', { label: isMacPlatform(osInfo) ? t('osMdKernelLabelMac') : t('osMdKernelLabelOther'), kernel: kernelVersion })}` : ''}${osBuild !== null ? `
${t('osMdBuild', { build: osBuild })}` : ''}
${t('osMdArch', { arch: osArch ?? t('unknownLabel') })}
${t('osMdPower', { power: powerText })}`
    }
  ]

  for (const d of drives) {
    entries.push({
      id: `hw-drive-${d.drive}`,
      category: 'storage',
      title: t('driveTitle', { name: driveDisplayName(d) }),
      subtitle: t('driveSubtitle', { total: disk(d.totalBytes), used: disk(d.usedBytes), avail: disk(d.availableBytes) }),
      value: t('driveValue', { percent: d.usagePercent }),
      tag: disk(d.totalBytes),
      detailMarkdown: `${t('driveMdHeader', { name: driveDisplayName(d) })}

${t('driveMdMount', { path: d.drive })}
${t('driveMdFs', { fs: d.fileSystem || t('unknownLabel') })}
${t('driveMdTotal', { total: disk(d.totalBytes) })}
${t('driveMdUsed', { used: disk(d.usedBytes), percent: d.usagePercent })}
${t('driveMdAvail', { avail: disk(d.availableBytes) })}
${t('driveMdStatus', { status: d.usagePercent > 85 ? t('driveStatusTight') : t('driveStatusNormal') })}${decimalStorage ? `

${t('driveMdMacNote')}` : ''}`
    })
  }

  displays.forEach((disp, index) => {
    const w = positiveNumber(disp.bounds?.width)
    const h = positiveNumber(disp.bounds?.height)
    const resolution = w && h ? `${w} × ${h}` : t('unknownLabel')
    const scaleValue = positiveNumber(disp.scaleFactor)
    const scale = scaleValue === null ? t('unknownLabel') : `${Math.round(scaleValue * 100)}%`
    const hzValue = positiveNumber(disp.displayFrequency)
    const hz = hzValue ? `${Math.round(hzValue)}Hz` : t('unknownLabel')
    const depthValue = positiveNumber(disp.colorDepth)
    const depth = depthValue ? `${depthValue}-bit` : t('unknownLabel')
    const workW = positiveNumber(disp.workArea?.width)
    const workH = positiveNumber(disp.workArea?.height)
    entries.push({
      id: `hw-disp-${disp.id || index}`,
      category: 'display',
      title: disp.label || t('dispTitleDefault', { index: index + 1, res: resolution }),
      subtitle: t('dispSubtitle', { scale, hz, depth }),
      value: `${w && h ? `${w}×${h}` : t('dispResUnknown')}${hzValue ? ` @${Math.round(hzValue)}Hz` : ''}`,
      tag: scaleValue === null ? t('dispTagUnknown') : t('dispTagOk', { scale }),
      detailMarkdown: `${t('dispMdHeader', { index: index + 1 })}

${t('dispMdId', { id: disp.label || `Display #${disp.id || index + 1}` })}
${t('dispMdRes', { res: resolution })}
${t('dispMdWork', { work: workW && workH ? `${workW} × ${workH}` : t('unknownLabel') })}
${t('dispMdScale', { scale })}
${t('dispMdHz', { hz: hzValue ? `${Math.round(hzValue)} Hz` : t('unknownLabel') })}
${t('dispMdDepth', { depth })}`
    })
  })

  for (const sc of scenarios) {
    entries.push({
      id: sc.id,
      category: 'benchmark',
      title: sc.scenario,
      subtitle: `${sc.summary}`,
      value: t('scValue'),
      tag: sc.tier,
      detailMarkdown: `# ${sc.scenario}

${t('scenarioEstimateNote')}

${t('scMdTier', { tier: sc.tier })}
${t('scMdKnown', { summary: sc.summary })}
${t('scMdCheck', { hint: sc.bottleneckHint })}`
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
