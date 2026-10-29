import { callHostTransport } from './native-ipc.js'
import type {
  CaffeineActionResult,
  CaffeineMode,
  CaffeinePreset,
  CaffeineStatus
} from './types.js'

export const CAFFEINE_PRESETS: ReadonlyArray<CaffeinePreset> = [
  {
    id: 'caffeine-0',
    minutes: 0,
    title: '无限期防休眠（直到手动关闭）',
    subtitle: '按所选模式持续保持唤醒'
  },
  {
    id: 'caffeine-15',
    minutes: 15,
    title: '防休眠 15 分钟',
    subtitle: '适合短时文件传输、会议投屏演示或临时离开座位'
  },
  {
    id: 'caffeine-30',
    minutes: 30,
    title: '防休眠 30 分钟',
    subtitle: '适合阅读长文、线上分享或常规构建打包'
  },
  {
    id: 'caffeine-60',
    minutes: 60,
    title: '防休眠 1 小时',
    subtitle: '适合编译大型工程、下载大体积镜像或导出视频'
  },
  {
    id: 'caffeine-120',
    minutes: 120,
    title: '防休眠 2 小时',
    subtitle: '适合长时间模型推理、数据库迁移或备份任务'
  },
  {
    id: 'caffeine-240',
    minutes: 240,
    title: '防休眠 4 小时',
    subtitle: '适合半天无人值守批处理任务，到期后自动恢复系统休眠策略'
  }
]

export function formatRemainingDuration(
  active: boolean,
  durationMinutes: number,
  remainingMs: number | null
): string {
  if (!active) return '未开启'
  if (durationMinutes === 0 || remainingMs === null) {
    return '直到手动关闭'
  }
  const totalSec = Math.max(0, Math.ceil(remainingMs / 1000))
  if (totalSec < 60) {
    return `${totalSec} 秒`
  }
  const totalMin = Math.floor(totalSec / 60)
  const remSec = totalSec % 60
  if (totalMin < 60) {
    return remSec > 0 ? `${totalMin} 分 ${remSec} 秒` : `${totalMin} 分钟`
  }
  const hours = Math.floor(totalMin / 60)
  const mins = totalMin % 60
  return mins > 0 ? `${hours} 小时 ${mins} 分钟` : `${hours} 小时`
}

export function normalizeCaffeineStatus(raw: Record<string, unknown>): CaffeineStatus {
  const active = Boolean(raw.active)
  const rawMode = String(raw.mode ?? 'display').trim().toLowerCase()
  const mode: CaffeineMode = rawMode === 'system' ? 'system' : 'display'
  const durationMinutes = Number.isFinite(Number(raw.durationMinutes))
    ? Math.max(0, Number(raw.durationMinutes))
    : 0
  const startedAtMs =
    typeof raw.startedAtMs === 'number' && Number.isFinite(raw.startedAtMs)
      ? raw.startedAtMs
      : null
  const expiresAtMs =
    typeof raw.expiresAtMs === 'number' && Number.isFinite(raw.expiresAtMs)
      ? raw.expiresAtMs
      : null
  const remainingMs =
    active && expiresAtMs !== null
      ? Math.max(0, typeof raw.remainingMs === 'number' ? raw.remainingMs : expiresAtMs - Date.now())
      : null

  return {
    active,
    mode,
    durationMinutes,
    startedAtMs,
    expiresAtMs,
    remainingMs,
    remainingText: formatRemainingDuration(active, durationMinutes, remainingMs),
    sessionId: Number(raw.sessionId ?? 0)
  }
}

export function getDefaultInactiveStatus(mode: CaffeineMode = 'display'): CaffeineStatus {
  return {
    active: false,
    mode,
    durationMinutes: 0,
    startedAtMs: null,
    expiresAtMs: null,
    remainingMs: null,
    remainingText: '未开启',
    sessionId: 0
  }
}

async function callPowerSession(
  action: 'status' | 'start' | 'stop' | 'toggle',
  hostOverride?: unknown,
  options: { durationMinutes?: number; mode?: CaffeineMode } = {}
): Promise<CaffeineActionResult> {
  const res = await callHostTransport<Record<string, unknown>>(
    'system_power_session', { action, ...options }, hostOverride
  )
  if (!res.ok || !res.data) return { ok: false, error: res.error || '无法读取系统防休眠状态' }
  const raw = res.data
  if (typeof raw.active !== 'boolean' || !['display', 'system'].includes(String(raw.mode)) ||
      !Number.isInteger(raw.durationMinutes) || !Number.isInteger(raw.sessionId) ||
      (raw.active && (typeof raw.startedAtMs !== 'number' || !Number.isFinite(raw.startedAtMs))) ||
      (raw.expiresAtMs !== null && (typeof raw.expiresAtMs !== 'number' || !Number.isFinite(raw.expiresAtMs)))) {
    return { ok: false, error: '宿主返回的防休眠状态无效，请升级客户端后重试' }
  }
  return { ok: true, status: normalizeCaffeineStatus(raw) }
}

export function getCaffeineStatus(hostOverride?: unknown): Promise<CaffeineActionResult> {
  return callPowerSession('status', hostOverride)
}

export async function startCaffeineSession(
  durationMinutes: number,
  mode: CaffeineMode = 'display',
  hostOverride?: unknown
): Promise<CaffeineActionResult> {
  if (!Number.isInteger(durationMinutes) || durationMinutes < 0 || durationMinutes > 10080) {
    return { ok: false, errorCode: 'INVALID_DURATION', error: '防休眠时长必须为 0~10080 的整数分钟，0 表示无限期' }
  }
  if (mode !== 'display' && mode !== 'system') return { ok: false, errorCode: 'INVALID_MODE', error: '防休眠模式无效' }
  return callPowerSession('start', hostOverride, { durationMinutes, mode })
}

export function stopCaffeineSession(hostOverride?: unknown): Promise<CaffeineActionResult> {
  return callPowerSession('stop', hostOverride)
}

export function toggleCaffeineSession(mode: CaffeineMode = 'display', hostOverride?: unknown): Promise<CaffeineActionResult> {
  return callPowerSession('toggle', hostOverride, { mode })
}
