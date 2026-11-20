import { t } from './i18n.js'
import {
  callHostTransport,
  invokePluginService,
  openRealPath,
  readRealClipboardText,
  showRealItemInFolder,
  trashRealItem,
  writeRealClipboardText
} from './native-ipc.js'
import type {
  FileUnlockExecutionResult,
  FileUnlockInspectionResult,
  HandleKind,
  LockingProcessItem,
  RemovableDriveItem,
  ServiceTypeLabel,
  UnlockProcessFilter
} from './types.js'

export const FILE_UNLOCK_PLUGIN_NAME = 'FileUnlockPlugin'

export const CRITICAL_KERNEL_PROCESS_NAMES = new Set([
  'system',
  'idle',
  'registry',
  'smss',
  'smss.exe',
  'csrss',
  'csrss.exe',
  'wininit',
  'wininit.exe',
  'services',
  'services.exe',
  'lsass',
  'lsass.exe',
  'svchost',
  'svchost.exe',
  'winlogon',
  'winlogon.exe',
  'dwm',
  'dwm.exe',
  'fontdrvhost',
  'fontdrvhost.exe',
  'memory compression',
  'spoolsv',
  'spoolsv.exe',
  'launchd',
  'kernel_task',
  'windowserver',
  'loginwindow'
])

export function normalizeProcessBaseName(name: string): string {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.exe$/i, '')
}

export function isKernelProtectedProcess(pid: number, name: string): boolean {
  if (Number.isFinite(pid) && pid > 0 && pid <= 4) {
    return true
  }
  const lower = String(name ?? '').trim().toLowerCase()
  if (!lower) return false
  const base = normalizeProcessBaseName(lower)
  return CRITICAL_KERNEL_PROCESS_NAMES.has(lower) || CRITICAL_KERNEL_PROCESS_NAMES.has(base)
}

export function resolveServiceTypeLabel(
  pid: number,
  name: string,
  rawLabel?: string
): ServiceTypeLabel {
  if (isKernelProtectedProcess(pid, name)) {
    return t('svcKernel')
  }
  const base = normalizeProcessBaseName(name)
  if (base === 'explorer') {
    return t('svcExplorer')
  }
  const normalized = String(rawLabel ?? '').trim()
  if (normalized === '后台服务' || normalized.toLowerCase().includes('service') || normalized === '3') {
    return t('svcService')
  }
  return t('svcProcess')
}

export function sanitizeInputPath(rawInput: string): string {
  return String(rawInput ?? '')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .trim()
}

export function looksLikeFilePath(rawInput: string): boolean {
  const cleaned = sanitizeInputPath(rawInput)
  if (!cleaned || cleaned.includes('\n') || cleaned.includes('\r')) return false
  return /^[a-zA-Z]:[\\/]/.test(cleaned) || /^\\\\[^\\]+\\[^\\]+/.test(cleaned) || cleaned.startsWith('/')
}

export function validateTargetPath(rawInput: string): {
  valid: boolean
  normalizedPath: string
  errorCode?: string
  error?: string
} {
  const cleaned = sanitizeInputPath(rawInput)
  if (!cleaned) {
    return {
      valid: false,
      normalizedPath: '',
      errorCode: 'INVALID_PATH',
      error: t('errInvalidPathEmpty')
    }
  }
  if (cleaned.includes('\0')) {
    return {
      valid: false,
      normalizedPath: cleaned,
      errorCode: 'INVALID_PATH',
      error: t('errInvalidPathNull')
    }
  }
  if (/(^|[\\/])\.\.([\\/]|$)/.test(cleaned)) {
    return {
      valid: false,
      normalizedPath: cleaned,
      errorCode: 'INVALID_PATH',
      error: t('errInvalidPathTraversal')
    }
  }
  if (!looksLikeFilePath(cleaned)) {
    return {
      valid: false,
      normalizedPath: cleaned,
      errorCode: 'INVALID_PATH',
      error: t('errInvalidPathFormat')
    }
  }
  return {
    valid: true,
    normalizedPath: cleaned
  }
}

export function normalizeLockingProcess(
  raw: Record<string, unknown>,
  fallbackTargetPath: string
): LockingProcessItem {
  const pid = Number(raw.pid ?? 0)
  const name = String(raw.name ?? `PID-${pid}`).trim()
  const executablePath = String(raw.executablePath ?? name).trim()
  const lockedPath = String(raw.lockedPath ?? fallbackTargetPath).trim()
  const isProtected = Boolean(raw.isProtected) || isKernelProtectedProcess(pid, name)
  const serviceTypeLabel = resolveServiceTypeLabel(
    pid,
    name,
    typeof raw.serviceTypeLabel === 'string' ? raw.serviceTypeLabel : undefined
  )
  const rawHandle = String(raw.handleType ?? 'file').toLowerCase()
  const handleType: HandleKind =
    rawHandle === 'directory' || rawHandle === 'dll' || rawHandle === 'unknown'
      ? (rawHandle as HandleKind)
      : 'file'

  return {
    id: String(raw.id ?? `${pid}-${lockedPath}`),
    pid,
    name,
    executablePath,
    lockedPath,
    handleType,
    serviceTypeLabel,
    isProtected,
    user: String(raw.user ?? 'User')
  }
}

export async function detectClipboardCandidatePath(hostOverride?: unknown): Promise<string> {
  try {
    const clip = await readRealClipboardText(hostOverride)
    const validation = validateTargetPath(clip)
    return validation.valid ? validation.normalizedPath : ''
  } catch {
    return ''
  }
}

export async function listRemovableDrives(hostOverride?: unknown): Promise<RemovableDriveItem[]> {
  return (await loadRemovableDrives(hostOverride)).drives
}

/** 读取外接磁盘：失败或列表不完整时带上原因，由界面提示，不能静默显示为“没有外接磁盘” */
export async function loadRemovableDrives(hostOverride?: unknown): Promise<{ drives: RemovableDriveItem[]; error?: string; warning?: string }> {
  const res = await invokePluginService<{ ok?: boolean; drives?: Array<Record<string, unknown>>; error?: string; warning?: string }>(
    FILE_UNLOCK_PLUGIN_NAME,
    'listRemovableDrives',
    {},
    hostOverride
  )
  if (!res.ok || !res.data || res.data.ok === false || !Array.isArray(res.data.drives)) {
    return { drives: [], error: String(res.data?.error ?? res.error ?? res.message ?? t('errLoadDrivesFailed')) }
  }
  const warning = typeof res.data.warning === 'string' && res.data.warning ? res.data.warning : undefined
  return { drives: normalizeDrives(res.data.drives), ...(warning ? { warning } : {}) }
}

function normalizeDrives(list: Array<Record<string, unknown>>): RemovableDriveItem[] {
  return list
    .map((d) => ({
      mount: String(d.mount ?? ''),
      label: String(d.label ?? t('removableDriveDefaultLabel')),
      totalBytes: Number(d.totalBytes ?? 0),
      freeBytes: Number(d.freeBytes ?? 0),
      totalText: String(d.totalText ?? '0 B'),
      freeText: String(d.freeText ?? '0 B')
    }))
    .filter((d) => Boolean(d.mount))
}

function extractErrorCode(errorMsg?: string, rawCode?: unknown): string {
  if (typeof rawCode === 'string' && rawCode.trim()) {
    return rawCode.trim()
  }
  const msg = String(errorMsg ?? '').trim()
  const m = msg.match(/^([A-Z0-9_]+):/)
  return m?.[1] ?? 'UNLOCK_FAILED'
}

export async function inspectTargetLocks(
  rawTargetPath: string,
  hostOverride?: unknown,
  extraParams: Record<string, unknown> = {}
): Promise<FileUnlockInspectionResult> {
  const validation = validateTargetPath(rawTargetPath)
  if (!validation.valid) {
    return {
      ok: false,
      targetPath: validation.normalizedPath,
      isDirectory: false,
      isUnlocked: false,
      processes: [],
      errorCode: validation.errorCode ?? 'INVALID_PATH',
      error: validation.error ?? t('errInvalidPathShort')
    }
  }

  const res = await invokePluginService<Record<string, unknown>>(
    FILE_UNLOCK_PLUGIN_NAME,
    'inspectLocks',
    {
      targetPath: validation.normalizedPath,
      ...extraParams
    },
    hostOverride
  )

  if (!res.ok || !res.data || res.data.ok === false) {
    const errText = String(res.data?.error ?? res.error ?? res.message ?? t('errInspectLocksFailed'))
    const errCode = extractErrorCode(errText, res.data?.errorCode)
    return {
      ok: false,
      targetPath: validation.normalizedPath,
      isDirectory: false,
      isUnlocked: false,
      processes: [],
      errorCode: errCode,
      error: errText
    }
  }

  const rawList = Array.isArray(res.data.processes)
    ? res.data.processes
    : Array.isArray(res.data.lockingProcesses)
      ? res.data.lockingProcesses
      : []

  const resolvedTarget = String(res.data.targetPath ?? validation.normalizedPath)
  const processes = rawList
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => normalizeLockingProcess(item, resolvedTarget))

  const partial = res.data.partial === true
  return {
    ok: true,
    targetPath: resolvedTarget,
    isDirectory: Boolean(res.data.isDirectory),
    isUnlocked: processes.length === 0 && !partial,
    processes,
    ...(partial ? { partial } : {})
  }
}

export async function unlockSingleProcess(
  proc: LockingProcessItem,
  targetPath: string,
  options: {
    trashAfterUnlock?: boolean
    renameTo?: string
    extraParams?: Record<string, unknown>
  } = {},
  hostOverride?: unknown
): Promise<FileUnlockExecutionResult> {
  if (!proc || !Number.isInteger(proc.pid) || proc.pid <= 0) {
    return {
      ok: false,
      unlockedCount: 0,
      skippedProtectedCount: 0,
      errorCode: 'INVALID_PID',
      error: t('errInvalidPid')
    }
  }

  if (proc.isProtected || isKernelProtectedProcess(proc.pid, proc.name)) {
    return {
      ok: false,
      pid: proc.pid,
      expectedName: proc.name,
      unlockedCount: 0,
      skippedProtectedCount: 1,
      errorCode: 'PROCESS_PROTECTED',
      error: t('errProcessProtectedSingle', { name: proc.name, pid: proc.pid })
    }
  }

  const res = await invokePluginService<Record<string, unknown>>(
    FILE_UNLOCK_PLUGIN_NAME,
    'unlockPath',
    {
      pid: proc.pid,
      expectedName: proc.name,
      targetPath: sanitizeInputPath(targetPath || proc.lockedPath),
      trashAfterUnlock: Boolean(options.trashAfterUnlock),
      ...(options.renameTo ? { renameTo: options.renameTo } : {}),
      ...(options.extraParams ?? {})
    },
    hostOverride
  )

  if (!res.ok || !res.data || res.data.ok === false) {
    const errText = String(res.data?.error ?? res.error ?? res.message ?? t('errUnlockPathFailed'))
    const errCode = extractErrorCode(errText, res.data?.errorCode)
    return {
      ok: false,
      pid: proc.pid,
      expectedName: proc.name,
      unlockedCount: 0,
      skippedProtectedCount: errCode === 'PROCESS_PROTECTED' ? 1 : 0,
      errorCode: errCode,
      error: errText
    }
  }

  return {
    ok: true,
    pid: proc.pid,
    expectedName: proc.name,
    unlockedCount: 1,
    skippedProtectedCount: 0,
    explorerRestarted: Boolean(res.data.explorerRestarted),
    trashed: Boolean(res.data.trashed),
    ...(typeof res.data.renamedPath === 'string' ? { renamedPath: res.data.renamedPath } : {})
  }
}

export async function unlockAllProcesses(
  processes: LockingProcessItem[],
  targetPath: string,
  options: {
    trashAfterUnlock?: boolean
    renameTo?: string
    extraParams?: Record<string, unknown>
  } = {},
  hostOverride?: unknown
): Promise<FileUnlockExecutionResult> {
  const validation = validateTargetPath(targetPath)
  if (!validation.valid) {
    return {
      ok: false,
      unlockedCount: 0,
      skippedProtectedCount: 0,
      errorCode: validation.errorCode ?? 'INVALID_PATH',
      error: validation.error ?? t('errTargetPathInvalid')
    }
  }

  const killable = processes.filter((p) => !p.isProtected && !isKernelProtectedProcess(p.pid, p.name))
  const protectedCount = processes.length - killable.length

  if (processes.length > 0 && killable.length === 0) {
    return {
      ok: false,
      unlockedCount: 0,
      skippedProtectedCount: protectedCount,
      errorCode: 'PROCESS_PROTECTED',
      error: t('errProcessProtectedAll')
    }
  }

  if (killable.length === 0 && options.trashAfterUnlock) {
    const trashRes = await trashRealItem(validation.normalizedPath, hostOverride)
    if (!trashRes.ok) {
      return {
        ok: false,
        unlockedCount: 0,
        skippedProtectedCount: 0,
        errorCode: 'TRASH_FAILED',
        error: trashRes.error ?? t('errTrashFailed')
      }
    }
    return {
      ok: true,
      unlockedCount: 0,
      skippedProtectedCount: 0,
      trashed: true
    }
  }

  let unlockedCount = 0
  let explorerRestarted = false
  let trashed = false
  let renamedPath: string | undefined

  for (let i = 0; i < killable.length; i++) {
    const proc = killable[i]!
    const isLast = i === killable.length - 1
    const singleRes = await unlockSingleProcess(
      proc,
      validation.normalizedPath,
      {
        trashAfterUnlock: Boolean(isLast && options.trashAfterUnlock && protectedCount === 0),
        renameTo: isLast && protectedCount === 0 ? options.renameTo : undefined,
        extraParams: options.extraParams
      },
      hostOverride
    )
    if (!singleRes.ok) {
      return {
        ...singleRes,
        unlockedCount,
        skippedProtectedCount: protectedCount + singleRes.skippedProtectedCount
      }
    }
    unlockedCount += 1
    if (singleRes.explorerRestarted) explorerRestarted = true
    if (singleRes.trashed) trashed = true
    if (singleRes.renamedPath) renamedPath = singleRes.renamedPath
  }

  return {
    ok: true,
    unlockedCount,
    skippedProtectedCount: protectedCount,
    explorerRestarted,
    trashed,
    ...(renamedPath ? { renamedPath } : {})
  }
}

export async function unlockAndTrashTarget(
  processes: LockingProcessItem[],
  targetPath: string,
  hostOverride?: unknown,
  extraParams: Record<string, unknown> = {}
): Promise<FileUnlockExecutionResult> {
  return unlockAllProcesses(
    processes,
    targetPath,
    {
      trashAfterUnlock: true,
      extraParams
    },
    hostOverride
  )
}

export function filterLockingProcesses(
  processes: LockingProcessItem[],
  filter: UnlockProcessFilter,
  query: string
): LockingProcessItem[] {
  const q = sanitizeInputPath(query).toLowerCase()
  const isPathQuery = looksLikeFilePath(query)

  return processes.filter((proc) => {
    if (filter === 'killable' && proc.isProtected) return false
    if (filter === 'protected' && !proc.isProtected) return false
    if (!q || isPathQuery) return true
    return (
      proc.name.toLowerCase().includes(q) ||
      String(proc.pid).includes(q) ||
      proc.executablePath.toLowerCase().includes(q) ||
      proc.serviceTypeLabel.toLowerCase().includes(q)
    )
  })
}

export async function revealLockedTargetInFolder(
  targetPath: string,
  hostOverride?: unknown
): Promise<boolean> {
  return showRealItemInFolder(sanitizeInputPath(targetPath), hostOverride)
}

export async function revealProcessExecutableInFolder(
  executablePath: string,
  hostOverride?: unknown
): Promise<boolean> {
  return showRealItemInFolder(sanitizeInputPath(executablePath), hostOverride)
}

export async function openUnlockedTarget(
  targetPath: string,
  hostOverride?: unknown
): Promise<boolean> {
  return openRealPath(sanitizeInputPath(targetPath), hostOverride)
}

export async function copyProcessInfoToClipboard(
  text: string,
  hostOverride?: unknown
): Promise<boolean> {
  return writeRealClipboardText(text, hostOverride)
}

export function extractDroppedUnlockPath(envelopeOrPayload: unknown): string {
  const raw = envelopeOrPayload && typeof envelopeOrPayload === 'object'
    ? (envelopeOrPayload as { payload?: { files?: unknown }; files?: unknown })
    : {}
  const list = Array.isArray(raw.payload?.files) ? raw.payload!.files : Array.isArray(raw.files) ? raw.files : []
  for (const item of list) {
    if (typeof item === 'string') {
      const cleaned = sanitizeInputPath(item)
      if (cleaned) return cleaned
    }
  }
  return ''
}

export async function selectUnlockTarget(
  directory: boolean,
  hostOverride?: unknown
): Promise<{ canceled: boolean; path: string; error?: string }> {
  const res = await callHostTransport<Record<string, unknown>>(
    'window_show_open_dialog',
    {
      title: directory ? t('dialogSelectDir') : t('dialogSelectFile'),
      properties: [directory ? 'openDirectory' : 'openFile']
    },
    hostOverride
  )
  if (!res.ok) {
    return { canceled: false, path: '', error: res.error || t('errOpenSelectFailed') }
  }
  const data = (res.data && typeof res.data === 'object' ? res.data : {}) as Record<string, unknown>
  if (data.canceled === true) {
    return { canceled: true, path: '' }
  }
  const rawList = Array.isArray(data.filePaths) ? data.filePaths : []
  const firstFromList =
    typeof rawList[0] === 'string'
      ? rawList[0]
      : rawList[0] && typeof rawList[0] === 'object' && typeof (rawList[0] as { path?: unknown }).path === 'string'
        ? String((rawList[0] as { path: string }).path)
        : ''
  const rawPath =
    typeof data.filePath === 'string' && data.filePath.trim()
      ? data.filePath
      : typeof data.folderPath === 'string' && data.folderPath.trim()
        ? data.folderPath
        : firstFromList
  const cleaned = sanitizeInputPath(rawPath)
  if (!cleaned) {
    return { canceled: false, path: '', error: t('errSelectNoPath') }
  }
  return { canceled: false, path: cleaned }
}
