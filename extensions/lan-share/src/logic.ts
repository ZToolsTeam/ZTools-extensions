type DynamicBridge = ReturnType<typeof JSON.parse>;
/**
 * 局域网传文件
 * 共享服务由客户端提供：启动后在本机所有网卡上监听 HTTP，同一局域网的设备打开本机地址即可下载共享列表里的文件。
 * 插件负责选择要共享的文件、启动 / 停止服务、暂停或移除单个文件，并生成访问地址的二维码。
 * 所有状态以客户端返回为准，失败如实报错。
 */

import { callHostTransport, invokePluginService, isRealElectronHost, formatBytes } from './native-ipc.js'
import { encodeQr } from './qr-encoder.js'

export { formatBytes }

export const DLL_PLUGIN_NAME = 'LanSharePlugin'
export const HOST_REQUIRED_MESSAGE = '需要在 ZTools 客户端中使用'

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
  if (!data || typeof data !== 'object') return failedStatus('客户端返回的共享状态无效')
  if (data.ok === false || data.success === false) return failedStatus(String(data.error || '读取共享状态失败'))
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
  if (!hostAvailable(hostOverride)) return failedStatus(HOST_REQUIRED_MESSAGE)
  const res = await invokePluginService<DynamicBridge>(DLL_PLUGIN_NAME, func, params, hostOverride)
  if (!res.ok) return failedStatus(res.error || '调用局域网共享服务失败')
  return parseLanShareStatus(res.data)
}

export function fetchLanShareStatus(hostOverride?: DynamicBridge): Promise<LanShareStatus> {
  return callLanShare('getLanShareStatus', {}, hostOverride)
}

export async function startLanShare(hostOverride?: DynamicBridge): Promise<LanActionResult> {
  const status = await callLanShare('startShareServer', {}, hostOverride)
  if (!status.ok) return { ok: false, message: status.error || '启动共享服务失败', status }
  if (!status.running) return { ok: false, message: '客户端没有启动共享服务', status }
  return { ok: true, message: '共享服务已启动', status }
}

export async function stopLanShare(hostOverride?: DynamicBridge): Promise<LanActionResult> {
  const status = await callLanShare('stopShareServer', {}, hostOverride)
  if (!status.ok) return { ok: false, message: status.error || '停止共享服务失败', status }
  if (status.running) return { ok: false, message: '客户端没有停止共享服务', status }
  return { ok: true, message: '共享服务已停止', status }
}

/**
 * 弹出系统文件选择框，返回用户选中的文件路径；取消时 canceled 为 true
 */
export async function pickFilesToShare(
  hostOverride?: DynamicBridge
): Promise<{ ok: boolean; canceled?: boolean; paths: string[]; error?: string }> {
  if (!hostAvailable(hostOverride)) return { ok: false, paths: [], error: HOST_REQUIRED_MESSAGE }
  const res = await callHostTransport<DynamicBridge>(
    'window_show_open_dialog',
    { title: '选择要共享的文件', properties: ['openFile', 'multiSelections'] },
    hostOverride
  )
  if (!res.ok) return { ok: false, paths: [], error: res.error || '打开文件选择框失败' }
  const data = res.data
  if (!data || typeof data !== 'object') return { ok: false, paths: [], error: '文件选择框没有返回结果' }
  if (data.canceled) return { ok: true, canceled: true, paths: [] }
  const paths: string[] = []
  if (typeof data.filePath === 'string' && data.filePath) paths.push(data.filePath)
  if (Array.isArray(data.filePaths)) {
    for (const p of data.filePaths) {
      const value = typeof p === 'string' ? p : p && typeof p.path === 'string' ? p.path : ''
      if (value) paths.push(value)
    }
  }
  if (paths.length === 0) return { ok: false, paths: [], error: '文件选择框没有返回文件路径' }
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
  if (list.length === 0) return { ok: false, message: '没有选择文件', addedCount: 0, skipped: [] }
  if (!hostAvailable(hostOverride)) return { ok: false, message: HOST_REQUIRED_MESSAGE, addedCount: 0, skipped: list }
  const res = await invokePluginService<DynamicBridge>(DLL_PLUGIN_NAME, 'addFiles', { paths: list }, hostOverride)
  if (!res.ok) return { ok: false, message: res.error || '加入共享列表失败', addedCount: 0, skipped: list }
  const status = parseLanShareStatus(res.data)
  if (!status.ok) return { ok: false, message: status.error || '加入共享列表失败', status, addedCount: 0, skipped: list }
  const added: DynamicBridge[] = Array.isArray(res.data?.added) ? res.data.added : []
  const addedPaths = added.map((a) => String(a?.path || ''))
  const skipped = list.filter((p) => !addedPaths.some((a) => samePath(a, p)))
  const addedCount = list.length - skipped.length
  if (addedCount === 0) {
    return { ok: false, message: '没有文件被加入：文件不存在或无法读取', status, addedCount, skipped }
  }
  const message = skipped.length > 0
    ? `已共享 ${addedCount} 个文件，${skipped.length} 个文件无法读取已跳过`
    : `已共享 ${addedCount} 个文件`
  return { ok: true, message, status, addedCount, skipped }
}

export async function setFileShared(id: string, shared: boolean, hostOverride?: DynamicBridge): Promise<LanActionResult> {
  if (typeof id !== 'string' || !id.trim()) return { ok: false, message: '共享项 ID 不能为空' }
  const status = await callLanShare('toggleFileShare', { id: id.trim(), shared }, hostOverride)
  if (!status.ok) return { ok: false, message: status.error || '切换共享状态失败', status }
  const file = status.files.find((f) => f.id === id.trim())
  if (!file || file.shared !== shared) return { ok: false, message: '客户端没有更新该文件的共享状态', status }
  return { ok: true, message: shared ? '已恢复共享该文件' : '已暂停共享该文件', status }
}

export async function removeSharedFile(id: string, hostOverride?: DynamicBridge): Promise<LanActionResult> {
  if (typeof id !== 'string' || !id.trim()) return { ok: false, message: '共享项 ID 不能为空' }
  const status = await callLanShare('removeSharedFile', { id: id.trim() }, hostOverride)
  if (!status.ok) return { ok: false, message: status.error || '移除失败', status }
  if (status.files.some((f) => f.id === id.trim())) return { ok: false, message: '客户端没有移除该文件', status }
  return { ok: true, message: '已从共享列表移除，文件本身没有删除', status }
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
