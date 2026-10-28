/**
 * 屏幕录制业务逻辑
 *
 * 录制由客户端调用本机 ffmpeg 完成，能力边界以客户端实现为准：
 * - 只能录制整个桌面（所有显示器）的画面，不能只录某个区域或某个窗口；
 * - 不录制声音（系统声音、麦克风都不支持）；
 * - 输出 MP4 或 GIF，可选帧率；本机没有 ffmpeg 时开始录制会如实失败。
 *
 * 录制文件保存在系统视频文件夹下的 ZTools_Recordings 目录，列表只展示这个目录里的录制文件。
 */

import { callHostTransport, formatBytes, getRealSystemPath, openRealPath, showRealItemInFolder } from './native-ipc.js'

export { formatBytes }

export type RecordFps = '30' | '15' | '60'
export type RecordFormat = 'mp4' | 'gif'

export const RECORD_FPS_OPTIONS: ReadonlyArray<{ value: RecordFps; label: string }> = [
  { value: '30', label: '30 FPS' },
  { value: '15', label: '15 FPS' },
  { value: '60', label: '60 FPS' }
]

export const RECORD_FORMAT_OPTIONS: ReadonlyArray<{ value: RecordFormat; label: string }> = [
  { value: 'mp4', label: 'MP4 视频' },
  { value: 'gif', label: 'GIF 动图' }
]

/** 录制能力的固定限制（由客户端录制实现决定），界面上如实展示 */
export const RECORD_LIMITATION_NOTE =
  '录制整个桌面（所有显示器）的画面，不录制声音。需要本机已安装 ffmpeg，并能在命令行中直接运行。'

/** 录制文件保存目录名（位于系统视频文件夹下） */
export const RECORDINGS_FOLDER_NAME = 'ZTools_Recordings'

/** 客户端录制接口名 */
const RECORD_HOST_PLUGIN = 'RecordPlugin'
/** 列表只展示本插件能产出的格式 */
const RECORDING_FILE_REGEX = /\.(?:mp4|gif)$/i
/** 一次目录扫描最多取回的条目数 */
const RECORDING_SCAN_LIMIT = 200

export interface RecordedVideoItem {
  id: string
  name: string
  path: string
  /** 小写扩展名，带点，如 ".mp4" */
  extension: string
  /** 宿主没有返回大小时为 null */
  sizeBytes: number | null
  /** 文件修改时间（毫秒）；宿主没有返回时为 null，不用当前时间代替 */
  modifiedMs: number | null
}

export interface RecordSessionInfo {
  id: string
  outputPath: string
  /** 开始时间（毫秒）；宿主没有返回时为 null */
  startedAtMs: number | null
}

export interface RecordSessionConfig {
  fps: RecordFps
  format: RecordFormat
  /** 保存目录；为空时由客户端使用默认目录 */
  saveDir?: string
}

export interface RecordActionResult {
  ok: boolean
  sessionId: string
  message: string
  saveDir: string
  outputPath?: string
  error?: string
}

export interface RecordStopResult {
  ok: boolean
  message: string
  outputPath?: string
  sizeBytes?: number
  durationMs?: number
  error?: string
}

export interface RecordStatusResult {
  ok: boolean
  recording: boolean
  sessions: RecordSessionInfo[]
  error?: string
}

export interface RecordingListResult {
  files: RecordedVideoItem[]
  /** 目录里的文件没有全部取回 */
  partial: boolean
  /** 保存目录还没有创建（还没录制过） */
  missing: boolean
  error?: string
}

export interface RecordWorkspaceSnapshot {
  /** 录制文件保存目录；获取不到系统视频文件夹时为空 */
  saveDir: string
  recordings: RecordedVideoItem[]
  partial: boolean
  missing: boolean
  listError?: string
  /** 宿主确认的录制状态；查询失败时为 null（状态未知） */
  isRecording: boolean | null
  sessions: RecordSessionInfo[]
  statusError?: string
}

/** 本次运行中插件发起的录制会话 id（停止时按 id 停止，不误停别的会话） */
let activeSessionId = ''
/** 开始 / 停止录制不能并发：连按两次会启动两个录制进程 */
let recordOpInFlight = false

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function isWindowsStylePath(p: string): boolean {
  return /^[A-Za-z]:/.test(p) || p.startsWith('\\\\') || (p.includes('\\') && !p.includes('/'))
}

function trimTrailingSeparators(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '')
  return trimmed || p
}

function joinPath(dir: string, name: string): string {
  const sep = isWindowsStylePath(dir) ? '\\' : '/'
  return `${trimTrailingSeparators(dir)}${sep}${name}`
}

function comparablePath(p: string): string {
  const stripped = trimTrailingSeparators(String(p || '').trim())
  return isWindowsStylePath(stripped) ? stripped.replace(/\//g, '\\').toLowerCase() : stripped
}

function parentDirOf(p: string): string {
  const stripped = trimTrailingSeparators(String(p || ''))
  const idx = Math.max(stripped.lastIndexOf('/'), stripped.lastIndexOf('\\'))
  return idx > 0 ? stripped.slice(0, idx) : ''
}

function baseNameOf(p: string): string {
  return String(p || '').split(/[\\/]/).pop() || ''
}

/** 宿主时间戳可能是秒或毫秒；缺失或非法时返回 null */
function toEpochMs(raw: unknown): number | null {
  let n: number
  if (typeof raw === 'number') {
    n = raw
  } else if (typeof raw === 'string' && raw.trim()) {
    const text = raw.trim()
    n = /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : Date.parse(text)
  } else {
    return null
  }
  if (!Number.isFinite(n) || n <= 0) return null
  return n > 1e11 ? Math.round(n) : Math.round(n * 1000)
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 本地时间 "YYYY-MM-DD HH:mm"；时间未知时返回 "时间未知" */
export function formatRecordTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '时间未知'
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** 录制文件保存目录：系统视频文件夹下的 ZTools_Recordings */
export function resolveRecordingsDir(videosDir: string): string {
  const dir = String(videosDir || '').trim()
  return dir ? joinPath(dir, RECORDINGS_FOLDER_NAME) : ''
}

type HostRecord = Record<string, unknown>
type HostCallResult = { ok: true; data: HostRecord } | { ok: false; error: string }

function asRecord(value: unknown): HostRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as HostRecord) : null
}

/**
 * 调用客户端录制接口。直接走 dllplugin_call 一次：失败时不再换通道重试，
 * 否则第二次调用会把第一次的真实失败原因（例如 ffmpeg 异常退出）覆盖成“当前没有正在进行的录制”。
 */
async function callRecordHost(func: string, params: Record<string, unknown>, hostOverride?: unknown): Promise<HostCallResult> {
  const res = await callHostTransport<unknown>('dllplugin_call', { plugin: RECORD_HOST_PLUGIN, func, params }, hostOverride)
  if (!res.ok) return { ok: false, error: res.error || `录制接口 ${func} 调用失败` }
  const data = asRecord(res.data)
  if (!data) {
    return { ok: false, error: `录制接口 ${func} 返回了无法识别的结果` }
  }
  const hasError = typeof data.error === 'string' && data.error.length > 0
  if (data.ok === false || data.success === false || (hasError && data.ok !== true && data.success !== true)) {
    return { ok: false, error: String(data.error || data.message || `录制接口 ${func} 返回失败`) }
  }
  return { ok: true, data }
}

function parseSessions(raw: unknown): RecordSessionInfo[] {
  if (!Array.isArray(raw)) return []
  const out: RecordSessionInfo[] = []
  for (const item of raw) {
    const s = asRecord(item)
    if (!s) continue
    const id = String(s.id ?? s.sessionId ?? '').trim()
    if (!id) continue
    out.push({
      id,
      outputPath: typeof s.outputPath === 'string' ? s.outputPath : '',
      startedAtMs: toEpochMs(s.startedAt)
    })
  }
  return out
}

/** 向客户端查询当前是否有录制在进行（插件重新打开后以此为准，不靠插件内存里的状态） */
export async function getRecordingStatus(hostOverride?: unknown): Promise<RecordStatusResult> {
  const res = await callRecordHost('status', {}, hostOverride)
  if (!res.ok) return { ok: false, recording: false, sessions: [], error: res.error }
  if (typeof res.data.recording !== 'boolean') {
    return { ok: false, recording: false, sessions: [], error: '客户端没有返回录制状态' }
  }
  const sessions = parseSessions(res.data.sessions)
  if (!res.data.recording) {
    activeSessionId = ''
  } else if (!sessions.some(s => s.id === activeSessionId)) {
    activeSessionId = sessions[0]?.id || ''
  }
  return { ok: true, recording: res.data.recording, sessions }
}

/**
 * 保存目录是否存在：只在系统视频文件夹能列出时判断，列不出返回 null（未知）。
 * 用来区分“还没录制过、目录尚未创建”和“读取目录失败”。
 */
async function recordingsDirExists(videosDir: string, hostOverride?: unknown): Promise<boolean | null> {
  if (!videosDir) return null
  const res = await callHostTransport<unknown>('filesystem_get_directory_contents', { path: videosDir }, hostOverride)
  if (!res.ok) return null
  const filesField = asRecord(res.data)?.files
  const list: unknown[] | null = Array.isArray(res.data) ? res.data : Array.isArray(filesField) ? filesField : null
  if (!list) return null
  const target = RECORDINGS_FOLDER_NAME.toLowerCase()
  return list.some(entry => {
    if (!entry || typeof entry !== 'object') return false
    const e = entry as Record<string, unknown>
    const isDir = Boolean(e.isDirectory ?? e.isDir ?? e.is_dir)
    return isDir && baseNameOf(String(e.name ?? '')).toLowerCase() === target
  })
}

/**
 * 列出保存目录里的录制文件（只取直接位于目录下的 MP4 / GIF）。
 * 读取失败如实返回错误；取回的条目不全时标记 partial。
 */
export async function listRecordingFiles(
  saveDir: string,
  videosDir = '',
  hostOverride?: unknown
): Promise<RecordingListResult> {
  const dir = String(saveDir || '').trim()
  if (!dir) return { files: [], partial: false, missing: false, error: '未能获取系统视频文件夹路径' }

  const exists = await recordingsDirExists(String(videosDir || '').trim(), hostOverride)
  if (exists === false) return { files: [], partial: false, missing: true }

  const res = await callHostTransport<unknown>('system_search_files', { query: `dir:${dir}`, limit: RECORDING_SCAN_LIMIT }, hostOverride)
  if (!res.ok) return { files: [], partial: false, missing: false, error: res.error || '读取保存目录失败' }
  const data = asRecord(res.data)
  const rawFiles = data?.files
  if (!data || !Array.isArray(rawFiles)) {
    return { files: [], partial: false, missing: false, error: '客户端返回的目录内容无法识别' }
  }

  const dirKey = comparablePath(dir)
  const seen = new Set<string>()
  const files: RecordedVideoItem[] = []
  for (const raw of rawFiles) {
    const f = asRecord(raw)
    if (!f) continue
    const filePath = typeof f.path === 'string' ? f.path.trim() : ''
    if (!filePath) continue
    if (f.is_dir === true || f.isDir === true || f.isDirectory === true) continue
    if (comparablePath(parentDirOf(filePath)) !== dirKey) continue
    const name = typeof f.name === 'string' && f.name ? f.name : baseNameOf(filePath)
    if (!RECORDING_FILE_REGEX.test(name)) continue
    const key = comparablePath(filePath)
    if (seen.has(key)) continue
    seen.add(key)
    const size = Number(f.size ?? f.sizeBytes)
    const dot = name.lastIndexOf('.')
    files.push({
      id: filePath,
      name,
      path: filePath,
      extension: dot > 0 ? name.slice(dot).toLowerCase() : '',
      sizeBytes: Number.isFinite(size) && size >= 0 ? size : null,
      modifiedMs: toEpochMs(f.mtime ?? f.mtimeMs)
    })
  }

  // 新录制的排在前面；没有时间的排在最后，再按文件名倒序（客户端默认文件名带时间戳）
  files.sort((a, b) => {
    if (a.modifiedMs !== null && b.modifiedMs !== null && a.modifiedMs !== b.modifiedMs) return b.modifiedMs - a.modifiedMs
    if (a.modifiedMs === null && b.modifiedMs !== null) return 1
    if (a.modifiedMs !== null && b.modifiedMs === null) return -1
    return b.name.localeCompare(a.name)
  })

  const totalMatches = Number(data.total_matches)
  const partial = data.truncated === true || (Number.isFinite(totalMatches) && totalMatches > rawFiles.length)
  return { files, partial, missing: false }
}

/** 读取保存目录、录制文件列表与客户端录制状态；各部分失败分别如实返回，不会抛错 */
export async function fetchRecordWorkspace(hostOverride?: unknown): Promise<RecordWorkspaceSnapshot> {
  let videosDir = ''
  try {
    videosDir = await getRealSystemPath('videos', hostOverride)
  } catch {
    videosDir = ''
  }
  const saveDir = resolveRecordingsDir(videosDir)

  const [listing, status] = await Promise.all([
    listRecordingFiles(saveDir, videosDir, hostOverride).catch(
      (err): RecordingListResult => ({ files: [], partial: false, missing: false, error: errorText(err) })
    ),
    getRecordingStatus(hostOverride).catch(
      (err): RecordStatusResult => ({ ok: false, recording: false, sessions: [], error: errorText(err) })
    )
  ])

  return {
    saveDir,
    recordings: listing.files,
    partial: listing.partial,
    missing: listing.missing,
    ...(listing.error ? { listError: listing.error } : {}),
    isRecording: status.ok ? status.recording : null,
    sessions: status.sessions,
    ...(status.ok ? {} : { statusError: status.error || '查询录制状态失败' })
  }
}

function failStart(message: string, error: string, saveDir = '', sessionId = ''): RecordActionResult {
  return { ok: false, sessionId, message, saveDir, error }
}

export async function startScreenRecording(config: RecordSessionConfig, hostOverride?: unknown): Promise<RecordActionResult> {
  const fps = config?.fps
  const format = config?.format
  if (!RECORD_FPS_OPTIONS.some(o => o.value === fps) || !RECORD_FORMAT_OPTIONS.some(o => o.value === format)) {
    return failStart('录制参数无效', 'INVALID_RECORD_CONFIG')
  }
  if (recordOpInFlight) return failStart('上一个录制操作还没有完成', 'RECORD_BUSY')
  recordOpInFlight = true
  const saveDir = String(config.saveDir || '').trim()
  try {
    // 已有录制在进行时不再启动第二个（客户端允许多个会话并存，停止时只会停掉其中一个）
    const status = await getRecordingStatus(hostOverride)
    if (!status.ok) {
      return failStart(`无法确认当前录制状态：${status.error}`, status.error || 'RECORD_STATUS_UNKNOWN', saveDir)
    }
    if (status.recording) {
      return failStart('已有录制正在进行，请先停止', 'RECORD_ALREADY_RUNNING', saveDir, status.sessions[0]?.id || '')
    }

    const params: Record<string, unknown> = {
      type: format === 'gif' ? 'gif' : 'video',
      format,
      fps: Number(fps)
    }
    if (saveDir) params.saveDir = saveDir
    const res = await callRecordHost('startRecording', params, hostOverride)
    if (!res.ok) return failStart(res.error, res.error, saveDir)

    const sessionId = typeof res.data.sessionId === 'string' ? res.data.sessionId : ''
    activeSessionId = sessionId
    const outputPath = typeof res.data.outputPath === 'string' && res.data.outputPath ? res.data.outputPath : undefined
    return {
      ok: true,
      sessionId,
      message: `已开始录制（${fps} FPS，${format.toUpperCase()}）`,
      saveDir: (outputPath && parentDirOf(outputPath)) || saveDir,
      ...(outputPath ? { outputPath } : {})
    }
  } catch (err) {
    const msg = errorText(err)
    return failStart(msg, msg, saveDir)
  } finally {
    recordOpInFlight = false
  }
}

export async function stopScreenRecording(hostOverride?: unknown): Promise<RecordStopResult> {
  if (recordOpInFlight) return { ok: false, message: '上一个录制操作还没有完成', error: 'RECORD_BUSY' }
  recordOpInFlight = true
  try {
    const params: Record<string, unknown> = activeSessionId ? { sessionId: activeSessionId } : {}
    const res = await callRecordHost('stopRecording', params, hostOverride)
    // 客户端收尾时无论成败都会结束这个会话，插件不再记着它
    activeSessionId = ''
    if (!res.ok) return { ok: false, message: res.error, error: res.error }
    const outputPath = typeof res.data.outputPath === 'string' && res.data.outputPath ? res.data.outputPath : undefined
    const size = Number(res.data.sizeBytes)
    const duration = Number(res.data.durationMs)
    return {
      ok: true,
      message: '录制已保存',
      ...(outputPath ? { outputPath } : {}),
      ...(Number.isFinite(size) && size >= 0 ? { sizeBytes: size } : {}),
      ...(Number.isFinite(duration) && duration >= 0 ? { durationMs: duration } : {})
    }
  } catch (err) {
    const msg = errorText(err)
    return { ok: false, message: msg, error: msg }
  } finally {
    recordOpInFlight = false
  }
}

export async function openRecordedVideo(fullPath: string, hostOverride?: unknown): Promise<boolean> {
  if (!fullPath) return false
  return openRealPath(fullPath, hostOverride)
}

export async function openRecordFileLocation(fullPath: string, hostOverride?: unknown): Promise<boolean> {
  if (!fullPath) return false
  return showRealItemInFolder(fullPath, hostOverride)
}
