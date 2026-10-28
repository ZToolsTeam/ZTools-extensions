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
export const FORBIDDEN_REASON = '禁止删除或篡改系统根级 HKCR / SAM 安全注册表分支'

/** 宿主扫描时每个注册表位置最多返回的条数；达到该数量说明这个位置可能还有未列出的项 */
export const HOST_SCAN_LIMIT_PER_LOCATION = 40

export const NO_HOST_ERROR = 'NO_HOST: 当前环境无法访问系统注册表，请在 Windows 版 ZTools 中使用'

export const SCOPE_LABELS: Record<ContextMenuScope, string> = {
  file: '所有文件',
  directory: '文件夹',
  background: '文件夹空白处'
}
export const UNKNOWN_SCOPE_LABEL = '位置未识别'

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
    return nonEmptyString(rec.error) || nonEmptyString(rec.message) || fallback
  }
  return ''
}

export function validateInvocationPayload(method: string, params: unknown): { valid: boolean; error?: string } {
  if (typeof method !== 'string' || !method.trim()) {
    return { valid: false, error: 'INVALID_METHOD: 调用方法名不能为空' }
  }
  if (params === null || params === undefined || typeof params !== 'object' || Array.isArray(params)) {
    return { valid: false, error: 'INVALID_PARAMS: 参数必须为非空对象' }
  }
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (typeof v === 'string' && FORBIDDEN_TARGET_PATTERN.test(v.trim())) {
      return { valid: false, error: `SECURITY_INTERCEPTED (${k}): ${FORBIDDEN_REASON}` }
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
    throw new Error(check.error || '参数校验失败')
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
    '名称未识别'
  return {
    id: nonEmptyString(rec.id) || registryKey || `ctx-entry-${i}`,
    title,
    scope,
    scopeLabel: scope ? SCOPE_LABELS[scope] : UNKNOWN_SCOPE_LABEL,
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
  if (!hasHost(hostOverride)) return failedSnapshot(NO_HOST_ERROR)

  let res: HostCallResult<unknown>
  try {
    res = await invokePluginService<unknown>(DLL_PLUGIN_NAME, 'scanEntries', {}, hostOverride)
  } catch (err) {
    return failedSnapshot(`SCAN_FAILED: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!res.ok) {
    return failedSnapshot(nonEmptyString(res.error) || nonEmptyString(res.message) || 'SCAN_FAILED: 读取右键菜单失败')
  }

  const rawData = res.data
  const failure = explicitFailure(rawData, 'SCAN_FAILED: 读取右键菜单失败')
  if (failure) return failedSnapshot(failure)

  const rec = asRecord(rawData)
  const list = Array.isArray(rawData)
    ? rawData
    : Array.isArray(rec?.entries)
    ? (rec!.entries as unknown[])
    : Array.isArray(rec?.items)
    ? (rec!.items as unknown[])
    : null
  if (!list) return failedSnapshot('SCAN_FAILED: 宿主返回的右键菜单扫描结果格式无法识别')

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
    return { ok: false, classicMode: null, message: 'INVALID_PARAMS: 必须指定要切换到的菜单模式' }
  }
  if (!hasHost(hostOverride)) {
    return { ok: false, classicMode: null, message: NO_HOST_ERROR }
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
  const fallbackError = useClassic ? '写入经典右键菜单设置失败' : '恢复 Windows 11 默认右键菜单失败'
  if (!svcRes.ok) {
    return { ok: false, classicMode: null, message: nonEmptyString(svcRes.error) || nonEmptyString(svcRes.message) || fallbackError }
  }
  const failure = explicitFailure(svcRes.data, fallbackError)
  if (failure) return { ok: false, classicMode: null, message: failure }

  const returnedMode = asRecord(svcRes.data)?.classic
  if (typeof returnedMode === 'boolean' && returnedMode !== useClassic) {
    return {
      ok: false,
      classicMode: null,
      message: 'STATE_MISMATCH: 宿主执行的菜单模式与请求不一致，请重新扫描后再试'
    }
  }

  return {
    ok: true,
    classicMode: useClassic,
    message: useClassic
      ? '已写入经典右键菜单设置，重启资源管理器或重新登录后生效'
      : '已移除经典右键菜单设置，重启资源管理器或重新登录后生效'
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
    return { ok: false, enabled: false, message: 'INVALID_PARAMS: 必须指定启用或禁用' }
  }
  const previous = !enabled
  if (!normalizedId) {
    return { ok: false, enabled: previous, message: '右键菜单项 ID 不能为空' }
  }
  const resolvedRegKey = (typeof regPath === 'string' && regPath.trim() ? regPath : normalizedId).trim()
  if (FORBIDDEN_TARGET_PATTERN.test(resolvedRegKey)) {
    return { ok: false, enabled: previous, message: FORBIDDEN_REASON }
  }
  if (!hasHost(hostOverride)) {
    return { ok: false, enabled: previous, message: NO_HOST_ERROR }
  }

  const fallbackError = `修改右键菜单项 [${resolvedRegKey}] 失败`
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
    return { ok: false, enabled: previous, message: nonEmptyString(svcRes.error) || nonEmptyString(svcRes.message) || fallbackError }
  }
  const failure = explicitFailure(svcRes.data, fallbackError)
  if (failure) return { ok: false, enabled: previous, message: failure }

  const returnedState = asRecord(svcRes.data)?.enabled
  if (typeof returnedState === 'boolean' && returnedState !== enabled) {
    return { ok: false, enabled: previous, message: 'STATE_MISMATCH: 宿主返回的启用状态与请求不一致，请重新扫描后再试' }
  }

  const name = (typeof title === 'string' && title.trim()) || resolvedRegKey
  return {
    ok: true,
    enabled,
    message: `${enabled ? '已启用' : '已禁用'}右键菜单项：${name}`
  }
}

export function win11ModeLabel(mode: boolean | null): string {
  return mode === null ? '未识别' : mode ? '经典完整' : '默认折叠'
}

/** 状态条文字：读取失败时说明不能判断，重新扫描失败时说明显示的是旧结果，不把失败写成“共 0 项” */
export function buildSummaryText(input: {
  entries: ContextMenuEntry[]
  scanError: string
  isLoading: boolean
  truncatedLocations: string[]
}): string {
  const { entries, scanError, isLoading, truncatedLocations } = input
  if (scanError && entries.length === 0) return `读取失败，不能判断有哪些右键菜单项：${scanError}`
  if (scanError) return `重新扫描失败，下方是上次的结果：${scanError}`
  if (isLoading && entries.length === 0) return '正在扫描右键菜单...'
  const enabledCount = entries.filter((e) => e.enabled === true).length
  const disabledCount = entries.filter((e) => e.enabled === false).length
  const unknownCount = entries.length - enabledCount - disabledCount
  return (
    `共 ${entries.length} 项 · 已启用 ${enabledCount} 项 · 已禁用 ${disabledCount} 项` +
    (unknownCount > 0 ? ` · 状态未识别 ${unknownCount} 项` : '') +
    (truncatedLocations.length > 0 ? ` · ${truncatedLocations.length} 个位置达到扫描上限，可能未列全` : '')
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
