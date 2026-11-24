type DynamicBridge = ReturnType<typeof JSON.parse>;
/**
 * 局域网传文件
 * 共享服务由客户端提供：启动后在本机所有网卡上监听 HTTP，同一局域网的设备打开本机地址即可下载共享列表里的文件。
 * 插件负责选择要共享的文件、启动 / 停止服务、暂停或移除单个文件，并生成访问地址的二维码。
 * 所有状态以客户端返回为准，失败如实报错。
 */

import { callHostTransport, invokePluginService, isRealElectronHost, formatBytes } from './native-ipc.js'
import { encodeQr } from './qr-encoder.js'
import { pathKey, type FileImportRules, type FileImportTransport } from './file-import.js'
import { t } from './i18n.js'
import { resolveErrorMessage } from './error-i18n.js'

export { formatBytes }

export const DLL_PLUGIN_NAME = 'LanSharePlugin'
export const getHostRequiredMessage = (): string => t('hostRequired')
export const LAN_SHARE_MAX_FILES = 500
export const LAN_SHARE_BATCH_SIZE = 100
export const FORBIDDEN_SHARE_PATTERN =
  /(^|[\\/])(Windows|System32|SysWOW64|Program Files|Program Files \(x86\)|Boot|Recovery)($|[\\/])/i
export const LAN_SHARE_IMPORT_RULES: FileImportRules = {
  maxFiles: LAN_SHARE_MAX_FILES,
  forbiddenPath: FORBIDDEN_SHARE_PATTERN
}

export function createLanShareImportTransport(hostOverride?: DynamicBridge): FileImportTransport {
  return (method, params) => callHostTransport(method, params, hostOverride)
}

export interface LanInterface {
  name: string
  address: string
}

export interface SharedFileItem {
  id: string
  name: string
  path: string
  sizeBytes: number
  shared: boolean
  isDirectory: boolean
  /** 服务运行、文件处于共享状态且不是文件夹时才有下载地址 */
  downloadUrl: string
}

export interface LanShareStatus {
  ok: boolean
  error?: string
  running: boolean
  lanIp: string
  port: number
  /** 服务运行时的访问地址；未运行时为空 */
  portalUrl: string
  /** 本机非回环 IPv4 地址；为空表示没有可用的局域网地址 */
  interfaces: LanInterface[]
  files: SharedFileItem[]
}

export interface LanActionResult {
  ok: boolean
  message: string
  status?: LanShareStatus
}

function hostAvailable(hostOverride?: DynamicBridge): boolean {
  return Boolean(hostOverride) || isRealElectronHost(hostOverride)
}

function failedStatus(error: string): LanShareStatus {
  return { ok: false, error, running: false, lanIp: '', port: 0, portalUrl: '', interfaces: [], files: [] }
}

export function buildDownloadUrl(portalUrl: string, id: string, name: string): string {
  return `${portalUrl}/download/${encodeURIComponent(id)}/${encodeURIComponent(name)}`
}

/**
 * 把客户端返回的共享状态整理成界面数据；字段缺失时留空，不填默认值
 */
export function parseLanShareStatus(data: DynamicBridge): LanShareStatus {
  if (!data || typeof data !== 'object') return failedStatus(t('errInvalidStatus'))
  if (data.ok === false || data.success === false) return failedStatus(String(resolveErrorMessage(data, t('errReadStatusFailed'))))
  const running = data.running === true
  const lanIp = String(data.lanIp || data.primaryIp || '')
  const port = Number(data.port)
  const portalUrl = running && lanIp && Number.isInteger(port) && port > 0 ? `http://${lanIp}:${port}` : ''
  const interfaces: LanInterface[] = Array.isArray(data.interfaces)
    ? data.interfaces
        .filter((i: DynamicBridge) => i && i.internal !== true && typeof i.address === 'string' && i.address)
        .map((i: DynamicBridge) => ({ name: String(i.name || ''), address: String(i.address) }))
    : []
  const rawFiles = Array.isArray(data.files) ? data.files : Array.isArray(data.sharedFiles) ? data.sharedFiles : []
  const files: SharedFileItem[] = []
  for (const f of rawFiles) {
    if (!f || typeof f !== 'object' || typeof f.id !== 'string' || !f.id) continue
    const filePath = String(f.path || '')
    const name = String(f.name || filePath.split(/[\\/]/).pop() || f.id)
    const shared = f.shared !== false
    const isDirectory = f.isDirectory === true
    const size = Number(f.sizeBytes ?? f.size)
    files.push({
      id: f.id,
      name,
      path: filePath,
      sizeBytes: Number.isFinite(size) && size > 0 ? size : 0,
      shared,
      isDirectory,
      downloadUrl: portalUrl && shared && !isDirectory ? buildDownloadUrl(portalUrl, f.id, name) : ''
    })
  }
  return { ok: true, running, lanIp, port: Number.isInteger(port) ? port : 0, portalUrl, interfaces, files }
}

async function callLanShare(
  func: string,
  params: Record<string, unknown>,
  hostOverride?: DynamicBridge
): Promise<LanShareStatus> {
  if (!hostAvailable(hostOverride)) return failedStatus(t('hostRequired'))
  const res = await invokePluginService<DynamicBridge>(DLL_PLUGIN_NAME, func, params, hostOverride)
  if (!res.ok) return failedStatus(resolveErrorMessage(res, t('errCallServiceFailed')))
  return parseLanShareStatus(res.data)
}

export function fetchLanShareStatus(hostOverride?: DynamicBridge): Promise<LanShareStatus> {
  return callLanShare('getLanShareStatus', {}, hostOverride)
}

export async function startLanShare(hostOverride?: DynamicBridge): Promise<LanActionResult> {
  const status = await callLanShare('startShareServer', {}, hostOverride)
  if (!status.ok) return { ok: false, message: resolveErrorMessage(status, t('errStartFailed')), status }
  if (!status.running) return { ok: false, message: t('errStartUnconfirmed'), status }
  return { ok: true, message: t('msgStarted'), status }
}

export async function stopLanShare(hostOverride?: DynamicBridge): Promise<LanActionResult> {
  const status = await callLanShare('stopShareServer', {}, hostOverride)
  if (!status.ok) return { ok: false, message: resolveErrorMessage(status, t('errStopFailed')), status }
  if (status.running) return { ok: false, message: t('errStopUnconfirmed'), status }
  return { ok: true, message: t('msgStopped'), status }
}

/**
 * 弹出系统文件选择框，返回用户选中的文件路径；取消时 canceled 为 true
 */
export async function pickFilesToShare(
  hostOverride?: DynamicBridge
): Promise<{ ok: boolean; canceled?: boolean; paths: string[]; error?: string }> {
  if (!hostAvailable(hostOverride)) return { ok: false, paths: [], error: t('hostRequired') }
  const res = await callHostTransport<DynamicBridge>(
    'window_show_open_dialog',
    { title: t('pickFilesTitle'), properties: ['openFile', 'multiSelections'] },
    hostOverride
  )
  if (!res.ok) return { ok: false, paths: [], error: resolveErrorMessage(res, t('errOpenPickerFailed')) }
  const data = res.data
  if (!data || typeof data !== 'object') return { ok: false, paths: [], error: t('errPickerNoResult') }
  if (data.canceled) return { ok: true, canceled: true, paths: [] }
  const paths: string[] = []
  if (typeof data.filePath === 'string' && data.filePath) paths.push(data.filePath)
  if (Array.isArray(data.filePaths)) {
    for (const p of data.filePaths) {
      const value = typeof p === 'string' ? p : p && typeof p.path === 'string' ? p.path : ''
      if (value) paths.push(value)
    }
  }
  if (paths.length === 0) return { ok: false, paths: [], error: t('errPickerNoPaths') }
  return { ok: true, paths }
}

const samePath = (a: string, b: string) => a.replace(/\//g, '\\').toLowerCase() === b.replace(/\//g, '\\').toLowerCase()

/**
 * 把文件加入共享列表。客户端会在服务未运行时顺带启动服务；读不到的文件被跳过，跳过的如实列出。
 */
export async function addFilesToShare(
  paths: string[],
  hostOverride?: DynamicBridge
): Promise<LanActionResult & { addedCount: number; skipped: string[] }> {
  const list = Array.isArray(paths) ? paths.map((p) => String(p || '').trim()).filter(Boolean) : []
  if (list.length === 0) return { ok: false, message: t('errNoFilesSelected'), addedCount: 0, skipped: [] }
  if (!hostAvailable(hostOverride)) return { ok: false, message: t('hostRequired'), addedCount: 0, skipped: list }
  const res = await invokePluginService<DynamicBridge>(DLL_PLUGIN_NAME, 'addFiles', { paths: list }, hostOverride)
  if (!res.ok) return { ok: false, message: resolveErrorMessage(res, t('errAddShareFailed')), addedCount: 0, skipped: list }
  const status = parseLanShareStatus(res.data)
  if (!status.ok) return { ok: false, message: resolveErrorMessage(status, t('errAddShareFailed')), status, addedCount: 0, skipped: list }
  const added: DynamicBridge[] = Array.isArray(res.data?.added) ? res.data.added : []
  const addedPaths = added.map((a) => String(a?.path || ''))
  const skipped = list.filter((p) => !addedPaths.some((a) => samePath(a, p)))
  const addedCount = list.length - skipped.length
  if (addedCount === 0) {
    return { ok: false, message: t('errNoFilesAdded'), status, addedCount, skipped }
  }
  const message = skipped.length > 0
    ? t('msgSharedPartial', { added: addedCount, skipped: skipped.length })
    : t('msgSharedAll', { added: addedCount })
  return { ok: true, message, status, addedCount, skipped }
}

export interface LanShareBatchResult {
  ok: boolean
  addedCount: number
  skipped: string[]
  failedBatches: number
  errorMessage?: string
  duplicateNameCount: number
  status?: LanShareStatus
}

export interface ClearSharedFilesResult {
  ok: boolean
  message: string
  detail?: string
  removedCount: number
  failedCount: number
  failed: Array<{ id: string; name: string; reason: string }>
  status?: LanShareStatus
}

/**
 * 统计共享列表中与其他文件重名的文件数量（按路径去重后，不区分大小写比较文件名）
 */
export function countDuplicateFileNames(files: ReadonlyArray<{ name: string; path: string }>): number {
  const unique = new Map<string, string>()
  files.forEach((file, index) => {
    const key = file.path ? pathKey(file.path) : `__idx_${index}`
    const name = String(file.name || file.path.split(/[\\/]/).pop() || '').trim().toLowerCase()
    if (name && !unique.has(key)) unique.set(key, name)
  })
  const counts = new Map<string, number>()
  for (const name of unique.values()) {
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  let duplicateTotal = 0
  for (const count of counts.values()) {
    if (count >= 2) duplicateTotal += count
  }
  return duplicateTotal
}

/**
 * 分批把文件加入共享列表（每批最多 100 个），汇总成功/跳过/批次失败与同名文件数
 */
export async function addFilesToShareBatched(
  paths: string[],
  hostOverride?: DynamicBridge
): Promise<LanShareBatchResult> {
  const seen = new Set<string>()
  const uniquePaths: string[] = []
  for (const raw of Array.isArray(paths) ? paths : []) {
    const trimmed = String(raw || '').trim()
    if (!trimmed) continue
    const key = pathKey(trimmed)
    if (seen.has(key)) continue
    seen.add(key)
    uniquePaths.push(trimmed)
  }
  if (uniquePaths.length === 0) {
    return { ok: false, addedCount: 0, skipped: [], failedBatches: 0, errorMessage: t('errNoFilesSelected'), duplicateNameCount: 0 }
  }

  let addedCount = 0
  const skipped: string[] = []
  let failedBatches = 0
  let lastError: string | undefined
  let lastStatus: LanShareStatus | undefined

  for (let i = 0; i < uniquePaths.length; i += LAN_SHARE_BATCH_SIZE) {
    const chunk = uniquePaths.slice(i, i + LAN_SHARE_BATCH_SIZE)
    const res = await addFilesToShare(chunk, hostOverride)
    if (res.status?.ok) lastStatus = res.status
    addedCount += res.addedCount
    skipped.push(...res.skipped)
    if (!res.ok && !res.status?.ok) {
      failedBatches += 1
      lastError = res.message
    } else if (!res.ok && !lastError) {
      lastError = res.message
    }
  }

  const candidateFiles: Array<{ name: string; path: string }> = lastStatus?.files?.length
    ? lastStatus.files
    : uniquePaths
        .filter((p) => !skipped.some((s) => samePath(s, p)))
        .map((p) => ({ name: p.split(/[\\/]/).pop() || p, path: p }))
  const duplicateNameCount = countDuplicateFileNames(candidateFiles)

  return {
    ok: addedCount > 0,
    addedCount,
    skipped,
    failedBatches,
    errorMessage: lastError,
    duplicateNameCount,
    status: lastStatus
  }
}

export async function setFileShared(id: string, shared: boolean, hostOverride?: DynamicBridge): Promise<LanActionResult> {
  if (typeof id !== 'string' || !id.trim()) return { ok: false, message: t('errEmptyShareId') }
  const status = await callLanShare('toggleFileShare', { id: id.trim(), shared }, hostOverride)
  if (!status.ok) return { ok: false, message: resolveErrorMessage(status, t('errToggleFailed')), status }
  const file = status.files.find((f) => f.id === id.trim())
  if (!file || file.shared !== shared) return { ok: false, message: t('errToggleUnconfirmed'), status }
  return { ok: true, message: shared ? t('msgResumedShare') : t('msgPausedShare'), status }
}

export async function removeSharedFile(id: string, hostOverride?: DynamicBridge): Promise<LanActionResult> {
  if (typeof id !== 'string' || !id.trim()) return { ok: false, message: t('errEmptyShareId') }
  const status = await callLanShare('removeSharedFile', { id: id.trim() }, hostOverride)
  if (!status.ok) return { ok: false, message: resolveErrorMessage(status, t('errRemoveFailed')), status }
  if (status.files.some((f) => f.id === id.trim())) return { ok: false, message: t('errRemoveUnconfirmed'), status }
  return { ok: true, message: t('msgRemovedFile'), status }
}

/**
 * 循环调用 removeSharedFile 清空共享列表（只移出共享，不删除文件），如实汇总部分失败
 */
export async function clearAllSharedFiles(
  files: readonly SharedFileItem[],
  hostOverride?: DynamicBridge
): Promise<ClearSharedFilesResult> {
  const list = Array.isArray(files) ? files : []
  if (list.length === 0) {
    return { ok: false, message: t('errAlreadyEmpty'), removedCount: 0, failedCount: 0, failed: [] }
  }
  if (!hostAvailable(hostOverride)) {
    return {
      ok: false,
      message: t('hostRequired'),
      removedCount: 0,
      failedCount: list.length,
      failed: list.map((f) => ({ id: f.id, name: f.name, reason: t('hostRequired') }))
    }
  }

  let removedCount = 0
  const failed: Array<{ id: string; name: string; reason: string }> = []
  let lastStatus: LanShareStatus | undefined

  for (const file of list) {
    const res = await removeSharedFile(file.id, hostOverride)
    if (res.status?.ok) lastStatus = res.status
    if (res.ok) {
      removedCount += 1
    } else {
      failed.push({ id: file.id, name: file.name, reason: resolveErrorMessage(res.message, t('errRemoveFailed')) })
    }
  }

  if (failed.length === 0) {
    return {
      ok: true,
      message: t('msgClearedAll', { count: removedCount }),
      removedCount,
      failedCount: 0,
      failed,
      status: lastStatus
    }
  }

  const first = failed[0]
  return {
    ok: false,
    message: t('msgClearedPartial', { removed: removedCount, failed: failed.length }),
    detail: first ? `${first.name}：${first.reason}` : undefined,
    removedCount,
    failedCount: failed.length,
    failed,
    status: lastStatus
  }
}

/**
 * 生成访问地址的二维码（SVG Data URI）；内容超出二维码容量时返回空字符串
 */
export function generateQrCodeSvgDataUri(text: string): string {
  if (!text) return ''
  let qr
  try {
    qr = encodeQr(text, 'M')
  } catch {
    return ''
  }
  const dim = qr.size + 8
  let path = ''
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.modules[y][x]) path += `M${x + 4},${y + 4}h1v1h-1z`
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${dim * 6}" height="${dim * 6}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path d="${path}" fill="black"/></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

export function filterSharedFiles(files: SharedFileItem[], query: string): SharedFileItem[] {
  if (!Array.isArray(files)) return []
  const q = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (!q) return files
  return files.filter((f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
}

export function extractDroppedSharePaths(envelopeOrPayload: unknown): string[] {
  const raw = envelopeOrPayload && typeof envelopeOrPayload === 'object'
    ? (envelopeOrPayload as { payload?: { files?: unknown }; files?: unknown })
    : {}
  const list = Array.isArray(raw.payload?.files) ? raw.payload!.files : Array.isArray(raw.files) ? raw.files : []
  return list
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
}
