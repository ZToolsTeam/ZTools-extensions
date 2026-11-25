/**
 * 右键菜单管理逻辑：读取宿主扫描到的右键菜单命令项（注册表 shell 子键），启用 / 禁用单项，切换 Windows 11 经典右键菜单。
 *
 * 约定：
 * - 读取、写入都只经宿主完成；宿主不可用、调用失败或返回格式无法识别时如实返回失败，不用示例数据或默认状态顶替。
 * - 宿主没有返回的信息（启用状态、位置）标为未识别，不填默认值。
 * - 宿主目前只扫描 shell 子键，不扫描外壳扩展（shellex\ContextMenuHandlers），界面需如实说明。
 */

import {
  invokePluginService,
  isRealElectronHost,
  invokeDllPluginCapability,
  type NativeInvocationResult as HostCallResult
} from './native-ipc.js'
import { t } from './i18n.js'
import { resolveErrorMessage } from './error-i18n.js'

export interface NativeInvocationResult {
  ok: boolean
  pluginName: string
  method: string
  data?: unknown
  error?: string
  fromFallback?: boolean
}

export type ContextMenuScope = 'file' | 'directory' | 'background'
export type ContextMenuFilterMode = 'all' | 'file' | 'directory' | 'background' | 'disabled'

export interface ContextMenuEntry {
  id: string
  title: string
  /** null：宿主没有给出、也无法从注册表路径判断菜单所在位置 */
  scope: ContextMenuScope | null
  scopeLabel: string
  registryKey: string
  command: string
  /** null：宿主没有返回启用状态，不能切换 */
  enabled: boolean | null
}

export interface ContextMenuSnapshot {
  ok: boolean
  /** 失败原因（ok 为 false 时） */
  error?: string
  entries: ContextMenuEntry[]
  /** 宿主没有返回 Win11 经典菜单状态时为 null（未识别） */
  win11ClassicEnabled: boolean | null
  enabledCount: number
  disabledCount: number
  unknownCount: number
  /** 扫描条数达到宿主单个位置上限的注册表位置，这些位置可能没有列全 */
  truncatedLocations: string[]
}

export const DLL_PLUGIN_NAME = 'ContextMenuPlugin'
export const FORBIDDEN_TARGET_PATTERN = new RegExp('^(?:HKLM\\\\SAM|HKLM\\\\SECURITY|DELETE_ROOT_CLASSES)$', 'i')
export function getForbiddenReason(): string {
  return t('forbidden.reason')
}

/** 宿主扫描时每个注册表位置最多返回的条数；达到该数量说明这个位置可能还有未列出的项 */
export const HOST_SCAN_LIMIT_PER_LOCATION = 40

export function getNoHostError(): string {
  return t('error.noHost')
}

export const SCOPE_LABELS: Record<ContextMenuScope, string> = {
  get file() {
    return t('scope.file')
  },
  get directory() {
    return t('scope.directory')
  },
  get background() {
    return t('scope.background')
  }
}

export function getUnknownScopeLabel(): string {
  return t('scope.unknown')
}

export function getScopeLabel(scope: ContextMenuScope | null): string {
  if (scope === 'file') return t('scope.file')
  if (scope === 'directory') return t('scope.directory')
  if (scope === 'background') return t('scope.background')
  return t('scope.unknown')
}

function hasHost(hostOverride?: unknown): boolean {
  return Boolean(hostOverride) || isRealElectronHost(hostOverride)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function nonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 宿主在结果里显式标明失败时取出失败原因，否则返回空串 */
function explicitFailure(data: unknown, fallback: string): string {
  const rec = asRecord(data)
  if (!rec) return ''
  if (rec.ok === false || rec.success === false) {
    return resolveErrorMessage(rec, fallback)
  }
  return ''
}

export function validateInvocationPayload(method: string, params: unknown): { valid: boolean; error?: string } {
  if (typeof method !== 'string' || !method.trim()) {
    return { valid: false, error: t('error.invalidMethod') }
  }
  if (params === null || params === undefined || typeof params !== 'object' || Array.isArray(params)) {
    return { valid: false, error: t('error.invalidParams') }
  }
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (typeof v === 'string' && FORBIDDEN_TARGET_PATTERN.test(v.trim())) {
      return { valid: false, error: t('error.securityIntercepted', { key: k, reason: t('forbidden.reason') }) }
    }
  }
  return { valid: true }
}

export async function invokeNativeCapability(
  method: string,
  params: Record<string, unknown>,
  hostBridge?: unknown
): Promise<NativeInvocationResult> {
  const check = validateInvocationPayload(method, params)
  if (!check.valid) {
    throw new Error(resolveErrorMessage(check, t('error.paramValidationFailed')))
  }
  return invokeDllPluginCapability(DLL_PLUGIN_NAME, method.trim(), params, hostBridge)
}

/** 按注册表路径判断菜单位置：Software\Classes 下 *\shell、Directory\shell、Directory\Background\shell */
export function scopeFromRegistryKey(registryKey: string): ContextMenuScope | null {
  const key = registryKey.toLowerCase()
  if (key.includes('\\directory\\background\\shell\\')) return 'background'
  if (key.includes('\\directory\\shell\\')) return 'directory'
  if (key.includes('\\*\\shell\\')) return 'file'
  return null
}

function resolveScope(raw: Record<string, unknown>, registryKey: string): ContextMenuScope | null {
  const declared = nonEmptyString(raw.scope).toLowerCase()
  if (declared === 'file' || declared === 'directory' || declared === 'background') return declared
  return scopeFromRegistryKey(registryKey)
}

function lastKeySegment(registryKey: string): string {
  const parts = registryKey.split('\\').filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1]! : ''
}

export function mapRawContextMenuEntry(raw: unknown, i: number): ContextMenuEntry {
  const rec = asRecord(raw) ?? {}
  const registryKey = nonEmptyString(rec.registryKey) || nonEmptyString(rec.regPath) || nonEmptyString(rec.keyPath)
  const scope = resolveScope(rec, registryKey)
  const title =
    nonEmptyString(rec.title) ||
    nonEmptyString(rec.name) ||
    nonEmptyString(rec.keyName) ||
    lastKeySegment(registryKey) ||
    t('entry.unknownName')
  return {
    id: nonEmptyString(rec.id) || registryKey || `ctx-entry-${i}`,
    title,
    scope,
    scopeLabel: getScopeLabel(scope),
    registryKey,
    command: nonEmptyString(rec.command),
    enabled: typeof rec.enabled === 'boolean' ? rec.enabled : null
  }
}

/** 找出条数达到宿主扫描上限的注册表位置（菜单项的上级键，如 HKEY_CURRENT_USER\Software\Classes\*\shell） */
export function findTruncatedLocations(entries: ContextMenuEntry[], limit = HOST_SCAN_LIMIT_PER_LOCATION): string[] {
  const counts = new Map<string, { label: string; count: number }>()
  for (const e of entries) {
    const idx = e.registryKey.lastIndexOf('\\')
    if (idx <= 0) continue
    const parent = e.registryKey.slice(0, idx)
    const key = parent.toLowerCase()
    const cur = counts.get(key)
    if (cur) cur.count++
    else counts.set(key, { label: parent, count: 1 })
  }
  return [...counts.values()].filter((c) => c.count >= limit).map((c) => c.label)
}

function failedSnapshot(error: string): ContextMenuSnapshot {
  return {
    ok: false,
    error,
    entries: [],
    win11ClassicEnabled: null,
    enabledCount: 0,
    disabledCount: 0,
    unknownCount: 0,
    truncatedLocations: []
  }
}

/**
 * 读取右键菜单项。宿主扫描失败（如 SCAN_FAILED / SCAN_TIMEOUT）、不可用或返回格式无法识别时返回 ok: false 与原因，
 * 不能当成“没有右键菜单项”。
 */
export async function fetchContextMenuEntries(hostOverride?: unknown): Promise<ContextMenuSnapshot> {
  if (!hasHost(hostOverride)) return failedSnapshot(t('error.noHost'))

  let res: HostCallResult<unknown>
  try {
    res = await invokePluginService<unknown>(DLL_PLUGIN_NAME, 'scanEntries', {}, hostOverride)
  } catch (err) {
    return failedSnapshot(`SCAN_FAILED: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!res.ok) {
    return failedSnapshot(resolveErrorMessage(res, t('error.scanFailed')))
  }

  const rawData = res.data
  const failure = explicitFailure(rawData, t('error.scanFailed'))
  if (failure) return failedSnapshot(failure)

  const rec = asRecord(rawData)
  const list = Array.isArray(rawData)
    ? rawData
    : Array.isArray(rec?.entries)
    ? (rec!.entries as unknown[])
    : Array.isArray(rec?.items)
    ? (rec!.items as unknown[])
    : null
  if (!list) return failedSnapshot(t('error.scanFormatUnknown'))

  const entries = list.map(mapRawContextMenuEntry)
  const enabledCount = entries.filter((e) => e.enabled === true).length
  const disabledCount = entries.filter((e) => e.enabled === false).length
  return {
    ok: true,
    entries,
    win11ClassicEnabled: typeof rec?.win11ClassicEnabled === 'boolean' ? rec.win11ClassicEnabled : null,
    enabledCount,
    disabledCount,
    unknownCount: entries.length - enabledCount - disabledCount,
    truncatedLocations: findTruncatedLocations(entries)
  }
}

/**
 * 切换 Windows 11 经典完整右键菜单。显式告诉宿主目标模式（宿主只认 classic / enabled 参数，缺省时会按当前状态反转），
 * 宿主返回的模式与请求不一致时按失败处理。写入后需要重启资源管理器或重新登录才生效。
 */
export async function switchWin11ClassicMenu(
  useClassic: boolean,
  hostOverride?: unknown
): Promise<{ ok: boolean; classicMode: boolean | null; message: string }> {
  if (typeof useClassic !== 'boolean') {
    return { ok: false, classicMode: null, message: t('error.mustSpecifyMode') }
  }
  if (!hasHost(hostOverride)) {
    return { ok: false, classicMode: null, message: t('error.noHost') }
  }

  let svcRes: HostCallResult<unknown>
  try {
    svcRes = await invokePluginService<unknown>(
      DLL_PLUGIN_NAME,
      'switchWin11Classic',
      { classic: useClassic, enabled: useClassic },
      hostOverride
    )
  } catch (err) {
    return { ok: false, classicMode: null, message: err instanceof Error ? err.message : String(err) }
  }
  const fallbackError = useClassic ? t('error.writeClassicFailed') : t('error.restoreWin11Failed')
  if (!svcRes.ok) {
    return { ok: false, classicMode: null, message: resolveErrorMessage(svcRes, fallbackError) }
  }
  const failure = explicitFailure(svcRes.data, fallbackError)
  if (failure) return { ok: false, classicMode: null, message: failure }

  const returnedMode = asRecord(svcRes.data)?.classic
  if (typeof returnedMode === 'boolean' && returnedMode !== useClassic) {
    return {
      ok: false,
      classicMode: null,
      message: t('error.modeMismatch')
    }
  }

  return {
    ok: true,
    classicMode: useClassic,
    message: useClassic ? t('msg.classicEnabled') : t('msg.classicDisabled')
  }
}

/**
 * 启用或禁用一个右键菜单项（宿主通过 LegacyDisable 值实现并读回确认）。
 * 宿主拒绝（如 ADMIN_REQUIRED、ITEM_NOT_FOUND、VERIFY_FAILED）或不可用时如实返回失败，enabled 保持原状态。
 */
export async function toggleContextMenuEntry(
  id: string,
  enabled: boolean,
  hostOverride?: unknown,
  regPath?: string,
  title?: string
): Promise<{ ok: boolean; enabled: boolean; message: string }> {
  const normalizedId = typeof id === 'string' ? id.trim() : ''
  if (typeof enabled !== 'boolean') {
    return { ok: false, enabled: false, message: t('error.mustSpecifyToggle') }
  }
  const previous = !enabled
  if (!normalizedId) {
    return { ok: false, enabled: previous, message: t('error.emptyEntryId') }
  }
  const resolvedRegKey = (typeof regPath === 'string' && regPath.trim() ? regPath : normalizedId).trim()
  if (FORBIDDEN_TARGET_PATTERN.test(resolvedRegKey)) {
    return { ok: false, enabled: previous, message: t('forbidden.reason') }
  }
  if (!hasHost(hostOverride)) {
    return { ok: false, enabled: previous, message: t('error.noHost') }
  }

  const fallbackError = t('error.toggleEntryFailed', { key: resolvedRegKey })
  let svcRes: HostCallResult<unknown>
  try {
    svcRes = await invokePluginService<unknown>(
      DLL_PLUGIN_NAME,
      'toggleEntry',
      { id: normalizedId, regPath: resolvedRegKey, registryKey: resolvedRegKey, enabled },
      hostOverride
    )
  } catch (err) {
    return { ok: false, enabled: previous, message: err instanceof Error ? err.message : String(err) }
  }
  if (!svcRes.ok) {
    return { ok: false, enabled: previous, message: resolveErrorMessage(svcRes, fallbackError) }
  }
  const failure = explicitFailure(svcRes.data, fallbackError)
  if (failure) return { ok: false, enabled: previous, message: failure }

  const returnedState = asRecord(svcRes.data)?.enabled
  if (typeof returnedState === 'boolean' && returnedState !== enabled) {
    return { ok: false, enabled: previous, message: t('error.stateMismatch') }
  }

  const name = (typeof title === 'string' && title.trim()) || resolvedRegKey
  return {
    ok: true,
    enabled,
    message: enabled ? t('msg.entryEnabled', { name }) : t('msg.entryDisabled', { name })
  }
}

export function win11ModeLabel(mode: boolean | null): string {
  return mode === null ? t('win11.unknown') : mode ? t('win11.classic') : t('win11.default')
}

/** 状态条文字：读取失败时说明不能判断，重新扫描失败时说明显示的是旧结果，不把失败写成“共 0 项” */
export function buildSummaryText(input: {
  entries: ContextMenuEntry[]
  scanError: string
  isLoading: boolean
  truncatedLocations: string[]
}): string {
  const { entries, scanError, isLoading, truncatedLocations } = input
  if (scanError && entries.length === 0) return t('summary.initialScanFailed', { error: scanError })
  if (scanError) return t('summary.rescanFailed', { error: scanError })
  if (isLoading && entries.length === 0) return t('summary.scanning')
  const enabledCount = entries.filter((e) => e.enabled === true).length
  const disabledCount = entries.filter((e) => e.enabled === false).length
  const unknownCount = entries.length - enabledCount - disabledCount
  return (
    t('summary.counts', { total: entries.length, enabled: enabledCount, disabled: disabledCount }) +
    (unknownCount > 0 ? t('summary.unknownCount', { count: unknownCount }) : '') +
    (truncatedLocations.length > 0 ? t('summary.truncated', { count: truncatedLocations.length }) : '')
  )
}

export function filterContextMenuEntries(
  entries: ContextMenuEntry[],
  query: string,
  filterMode: ContextMenuFilterMode | string = 'all'
): ContextMenuEntry[] {
  if (!Array.isArray(entries)) return []
  let list = entries
  if (filterMode === 'file' || filterMode === 'directory' || filterMode === 'background') {
    list = list.filter((e) => e.scope === filterMode)
  } else if (filterMode === 'disabled') {
    list = list.filter((e) => e.enabled === false)
  }

  const q = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (!q) return list
  return list.filter(
    (e) =>
      e.title.toLowerCase().includes(q) ||
      e.registryKey.toLowerCase().includes(q) ||
      e.command.toLowerCase().includes(q) ||
      e.scopeLabel.toLowerCase().includes(q)
  )
}
