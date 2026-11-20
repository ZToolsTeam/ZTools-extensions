import { callHostTransport } from './native-ipc.js'
import { t } from './i18n.js'
import type {
  CaffeineActionResult,
  CaffeineMode,
  CaffeinePreset,
  CaffeineStatus
} from './types.js'

const CAFFEINE_PRESET_DEFS = [
  { id: 'caffeine-0', minutes: 0, titleKey: 'preset0Title', subtitleKey: 'preset0Subtitle' },
  { id: 'caffeine-15', minutes: 15, titleKey: 'preset15Title', subtitleKey: 'preset15Subtitle' },
  { id: 'caffeine-30', minutes: 30, titleKey: 'preset30Title', subtitleKey: 'preset30Subtitle' },
  { id: 'caffeine-60', minutes: 60, titleKey: 'preset60Title', subtitleKey: 'preset60Subtitle' },
  { id: 'caffeine-120', minutes: 120, titleKey: 'preset120Title', subtitleKey: 'preset120Subtitle' },
  { id: 'caffeine-240', minutes: 240, titleKey: 'preset240Title', subtitleKey: 'preset240Subtitle' }
] as const

export function getCaffeinePresets(): ReadonlyArray<CaffeinePreset> {
  return CAFFEINE_PRESET_DEFS.map(def => ({
    id: def.id,
    minutes: def.minutes,
    title: t(def.titleKey),
    subtitle: t(def.subtitleKey)
  }))
}

export const CAFFEINE_PRESETS: ReadonlyArray<CaffeinePreset> = getCaffeinePresets()

export function formatRemainingDuration(
  active: boolean,
  durationMinutes: number,
  remainingMs: number | null
): string {
  if (!active) return t('inactiveText')
  if (durationMinutes === 0 || remainingMs === null) {
    return t('untilManualStop')
  }
  const totalSec = Math.max(0, Math.ceil(remainingMs / 1000))
  if (totalSec < 60) {
    return t('durationSec', { sec: totalSec })
  }
  const totalMin = Math.floor(totalSec / 60)
  const remSec = totalSec % 60
  if (totalMin < 60) {
    return remSec > 0 ? t('durationMinSec', { min: totalMin, sec: remSec }) : t('durationMin', { min: totalMin })
  }
  const hours = Math.floor(totalMin / 60)
  const mins = totalMin % 60
  return mins > 0 ? t('durationHourMin', { hours, mins }) : t('durationHour', { hours })
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
    remainingText: t('inactiveText'),
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
  if (!res.ok || !res.data) return { ok: false, error: res.error || t('errReadStatus') }
  const raw = res.data
  if (typeof raw.active !== 'boolean' || !['display', 'system'].includes(String(raw.mode)) ||
      !Number.isInteger(raw.durationMinutes) || !Number.isInteger(raw.sessionId) ||
      (raw.active && (typeof raw.startedAtMs !== 'number' || !Number.isFinite(raw.startedAtMs))) ||
      (raw.expiresAtMs !== null && (typeof raw.expiresAtMs !== 'number' || !Number.isFinite(raw.expiresAtMs)))) {
    return { ok: false, error: t('errInvalidHostStatus') }
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
    return { ok: false, errorCode: 'INVALID_DURATION', error: t('errInvalidDuration') }
  }
  if (mode !== 'display' && mode !== 'system') return { ok: false, errorCode: 'INVALID_MODE', error: t('errInvalidMode') }
  return callPowerSession('start', hostOverride, { durationMinutes, mode })
}

export function stopCaffeineSession(hostOverride?: unknown): Promise<CaffeineActionResult> {
  return callPowerSession('stop', hostOverride)
}

export function toggleCaffeineSession(mode: CaffeineMode = 'display', hostOverride?: unknown): Promise<CaffeineActionResult> {
  return callPowerSession('toggle', hostOverride, { mode })
}
