import { callHostTransport } from './native-ipc.js'
import { hostUpgradeError, isHostMethodMissing } from './host-compat.js'

export interface RealDiskDriveInfo {
  label?: string
  fileSystem?: string
  capacityGroup?: string
  drive: string
  totalBytes: number
  usedBytes: number
  availableBytes: number
  usagePercent: number
}

/**
 * 读取宿主枚举的已挂载卷，不猜测盘符或挂载点。
 */
export async function probeRealDiskDrives(_letters: string[] = [], hostOverride?: unknown): Promise<RealDiskDriveInfo[]> {
  const res = await callHostTransport<Record<string, unknown>>('system_list_volumes', {}, hostOverride)
  if (!res.ok && isHostMethodMissing(res.error)) throw hostUpgradeError('读取磁盘卷列表')
  if (!res.ok || !Array.isArray(res.data?.volumes)) throw new Error(res.error || '无法读取挂载卷列表')
  if (res.data.partial) throw new Error(`挂载卷列表不完整：${Array.isArray(res.data.errors) ? res.data.errors.join('；') : '卷容量读取失败'}`)
  const drives = res.data.volumes.map((value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('挂载卷数据无效')
    const v = value as Record<string, unknown>
    const total = Number(v.totalBytes), used = Number(v.usedBytes), available = Number(v.availableBytes)
    if (typeof v.path !== 'string' || !v.path || !Number.isFinite(total) || total <= 0 || !Number.isFinite(used) || used < 0 || !Number.isFinite(available) || available < 0) throw new Error('挂载卷数据无效')
    return { drive: v.path.replace(/^([A-Za-z]:)[\\/]$/, '$1'), label: String(v.label || v.path), fileSystem: String(v.fileSystem || '未知'), capacityGroup: String(v.capacityGroup || v.path), totalBytes: total, usedBytes: used, availableBytes: available, usagePercent: Math.round(used / total * 100) }
  })
  if (!drives.length) throw new Error('没有读取到已挂载卷')
  return drives
}

/** APFS 同容器容量不叠加；每个容器取同批快照的保守值。 */
export function uniqueCapacityDrives(drives: RealDiskDriveInfo[]): RealDiskDriveInfo[] {
  const groups = new Map<string, RealDiskDriveInfo>()
  for (const drive of drives) {
    const key = drive.capacityGroup || drive.drive, previous = groups.get(key)
    groups.set(key, previous ? { ...previous, totalBytes: Math.max(previous.totalBytes, drive.totalBytes), usedBytes: Math.max(previous.usedBytes, drive.usedBytes), availableBytes: Math.min(previous.availableBytes, drive.availableBytes) } : drive)
  }
  return [...groups.values()]
}
