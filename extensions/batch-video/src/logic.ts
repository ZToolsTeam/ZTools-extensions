/**
 * 批量视频转换：业务逻辑层
 *
 * - 扫描本机 视频 / 下载 / 桌面 目录下的视频文件（每个目录最多列出体积最大的 40 个）
 * - 三类任务：转换视频格式（MP4 / MKV / MOV / WebM）、转 GIF、提取音频（MP3 / M4A / WAV）
 * - 逐个文件调用宿主媒体处理接口：宿主用本机已安装的 ffmpeg，按输出文件扩展名使用 ffmpeg 默认参数编码，
 *   不接受画质、分辨率、码率等参数，单个文件最多运行 60 秒
 * - 每个文件都显式指定输出路径，并在输出前避开已存在的同名文件：宿主处理失败时会删除输出位置上的文件，
 *   输出路径绝不能指向用户已有的文件
 * - 只展示宿主返回的真实结果（输出路径、大小），不做体积估算
 */

import {
  callHostTransport,
  formatBytes,
  getRealSystemPath,
  invokeDllPluginCapability,
  nextMessageId,
  scanRealDirectoryTree
} from './native-ipc.js'

export { formatBytes } from './native-ipc.js'

export type VideoTaskId = 'convert-video' | 'to-gif' | 'extract-audio'

export interface OutputFormatOption {
  /** 输出扩展名（小写，不带点） */
  value: string
  label: string
}

export interface VideoTask {
  id: VideoTaskId
  title: string
  subtitle: string
  tag: string
  /** 宿主媒体接口的方法名 */
  method: string
  formats: OutputFormatOption[]
}

export interface NativeInvocationResult {
  ok: boolean
  pluginName: string
  method: string
  data?: unknown
  error?: string
  fromFallback?: boolean
}

export interface VideoProcessDone {
  status: 'done'
  outputPath: string
  outputBytes: number
}

export interface VideoProcessFailed {
  status: 'failed'
  error: string
}

export type VideoProcessOutcome = VideoProcessDone | VideoProcessFailed

export interface RealVideoFileItem {
  id: string
  name: string
  path: string
  /** 文件实际所在目录 */
  parentDir: string
  extension: string
  sizeBytes: number
  result?: VideoProcessOutcome
}

export interface VideoProcessSettings {
  taskId: VideoTaskId
  /** 输出扩展名，必须是该任务支持的格式 */
  format: string
}

export const DLL_PLUGIN_NAME = 'BatchVideoPlugin'
export const FORBIDDEN_TARGET_PATTERN = new RegExp('\\\\Windows\\\\System32|\\.\\.\\\\|\\.\\./', 'i')
export const FORBIDDEN_REASON = '视频处理路径不可指向系统受保护目录或包含路径穿越'
/** 宿主对单个文件运行 ffmpeg 的时限（秒），超时后宿主中止 ffmpeg 并删除未完成的输出 */
export const HOST_FFMPEG_LIMIT_SECONDS = 60
/** 等待宿主返回处理结果的时限：在宿主 ffmpeg 时限之外留出检测 ffmpeg、写盘与回传的时间 */
export const TRANSCODE_IPC_TIMEOUT_MS = 75_000
/** 输出文件名后缀：<原文件名>_ztools.<扩展名> */
export const OUTPUT_SUFFIX = '_ztools'
/** 每个扫描目录最多列出的视频数（按体积从大到小） */
export const SCAN_TOP_N_PER_DIR = 40
const MAX_PLAIN_NAME_ATTEMPTS = 20
const MAX_TAGGED_NAME_ATTEMPTS = 50

export const VIDEO_TASKS: VideoTask[] = [
  {
    id: 'convert-video',
    title: '转换视频格式',
    subtitle: '重新编码为所选格式，编码器、画质和分辨率由 ffmpeg 按格式默认决定',
    tag: '格式转换',
    method: 'BatchConvertFormat',
    formats: [
      { value: 'mp4', label: 'MP4' },
      { value: 'mkv', label: 'MKV' },
      { value: 'mov', label: 'MOV' },
      { value: 'webm', label: 'WebM' }
    ]
  },
  {
    id: 'to-gif',
    title: '转为 GIF 动图',
    subtitle: '按原分辨率和帧率转为 GIF（ffmpeg 默认设置），较长或高分辨率的视频生成的 GIF 体积很大',
    tag: '转 GIF',
    method: 'BatchConvertToGif',
    formats: [{ value: 'gif', label: 'GIF' }]
  },
  {
    id: 'extract-audio',
    title: '提取音频',
    subtitle: '去掉画面，只保留音轨并编码为所选格式（ffmpeg 默认设置）',
    tag: '提取音频',
    method: 'BatchExtractAudio',
    formats: [
      { value: 'mp3', label: 'MP3' },
      { value: 'm4a', label: 'M4A' },
      { value: 'wav', label: 'WAV（未压缩）' }
    ]
  }
]

export function getVideoTask(id: string): VideoTask {
  return VIDEO_TASKS.find(task => task.id === id) || VIDEO_TASKS[0]!
}

/** 任务支持该输出格式时返回规范化的扩展名，否则返回 null */
export function resolveOutputFormat(task: VideoTask, format: string): string | null {
  const value = String(format || '').trim().toLowerCase().replace(/^\./, '')
  return task.formats.some(f => f.value === value) ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function checkStringParam(key: string, val: string): string | null {
  if (val.length > 4096) return `PARAM_TOO_LONG: 参数 ${key} 超过最大长度限制`
  if (FORBIDDEN_TARGET_PATTERN.test(val)) return `SECURITY_INTERCEPTED: ${FORBIDDEN_REASON}`
  return null
}

export function validateInvocationPayload(method: string, params: unknown): { valid: boolean; error?: string } {
  if (typeof method !== 'string' || method.trim().length === 0) {
    return { valid: false, error: 'INVALID_METHOD: 调用方法名不能为空' }
  }
  if (method.length > 128 || !/^[A-Za-z0-9_]+$/.test(method.trim())) {
    return { valid: false, error: 'INVALID_METHOD_FORMAT: 方法名包含非法字符或超长' }
  }
  if (!isRecord(params)) {
    return { valid: false, error: 'INVALID_PARAMS: 参数必须为非空对象' }
  }

  for (const [key, val] of Object.entries(params)) {
    if (typeof val === 'string') {
      const problem = checkStringParam(key, val)
      if (problem) return { valid: false, error: problem }
    } else if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item !== 'string') continue
        const problem = checkStringParam(key, item)
        if (problem) return { valid: false, error: problem }
      }
    } else if (typeof val === 'number') {
      if (!Number.isFinite(val) || val < -1000 || val > 100_000_000) {
        return { valid: false, error: `PARAM_OUT_OF_RANGE: 数值参数 ${key} 越界或非有限数` }
      }
    }
  }

  return { valid: true }
}

type TransportMethod = (request: Record<string, unknown>) => Promise<unknown>

/**
 * 宿主通道默认 10 秒超时，而转码要等 ffmpeg 跑完（宿主上限 60 秒）：给 dllplugin_call 显式设置等待时限。
 * 当前环境没有宿主通道（未连接客户端）时返回 undefined，由调用方按宿主不可用报告失败。
 */
function createLongRunningBridge(): Record<string, unknown> | undefined {
  if (typeof window === 'undefined') return undefined
  const w = window as unknown as {
    __ztoolsElectron?: { transport?: { methods?: Record<string, unknown> } }
    ztools?: { transport?: { methods?: Record<string, unknown> } }
  }
  const methods = w.__ztoolsElectron?.transport?.methods || w.ztools?.transport?.methods
  const call = methods?.dllplugin_call
  if (typeof call !== 'function') return undefined
  return {
    __isRealHost: true,
    dllplugin_call: (params: Record<string, unknown>) =>
      (call as TransportMethod)({
        messageId: nextMessageId('dllplugin_call'),
        params,
        timeoutMs: TRANSCODE_IPC_TIMEOUT_MS
      })
  }
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
  const bridge = hostBridge ?? createLongRunningBridge()
  const res = await invokeDllPluginCapability(DLL_PLUGIN_NAME, method, params, bridge)
  return {
    ok: res.ok,
    pluginName: DLL_PLUGIN_NAME,
    method: method.trim(),
    data: res.data ?? undefined,
    error: res.error,
    fromFallback: res.fromFallback
  }
}

function splitPath(filePath: string): { dirWithSep: string; dir: string; fileName: string; base: string; ext: string } {
  const sepIdx = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'))
  const dirWithSep = sepIdx >= 0 ? filePath.slice(0, sepIdx + 1) : ''
  const dir = sepIdx > 0 ? filePath.slice(0, sepIdx) : dirWithSep
  const fileName = sepIdx >= 0 ? filePath.slice(sepIdx + 1) : filePath
  const dot = fileName.lastIndexOf('.')
  const base = dot > 0 ? fileName.slice(0, dot) : fileName
  const ext = dot > 0 ? fileName.slice(dot).toLowerCase() : ''
  return { dirWithSep, dir: /^[A-Za-z]:$/.test(dir) ? `${dir}\\` : dir, fileName, base, ext }
}

export function fileNameOf(filePath: string): string {
  return splitPath(filePath).fileName
}

/** 在源文件同目录生成 <原文件名><后缀>.<扩展名> */
export function buildOutputCandidate(sourcePath: string, ext: string, suffix: string): string {
  const { dirWithSep, base } = splitPath(sourcePath)
  return `${dirWithSep}${base}${suffix}.${ext}`
}

/** 批次时间标记（YYYYMMDDHHmmss），宿主无法确认同名文件是否存在时用于生成不重复的文件名 */
export function makeBatchTag(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

export type PathExistence = 'exists' | 'missing' | 'unknown'

function probeFoundFile(data: unknown): boolean {
  if (!isRecord(data) || !Array.isArray(data.items)) return false
  return data.items.some(item => isRecord(item) && typeof item.path === 'string' && item.path.length > 0)
}

/**
 * 查询目标路径上是否已有文件：
 * 1. filesystem_file_exists 明确答复存在 / 不存在时直接采用（该接口要求读取授权，输出位置通常没有授权，会返回失败）；
 * 2. 再用宿主媒体接口读取该路径的文件信息，能读到说明文件已存在；读不到不能断定不存在，返回 unknown。
 */
export async function checkPathExists(filePath: string, hostOverride?: unknown): Promise<PathExistence> {
  const res = await callHostTransport<unknown>('filesystem_file_exists', { path: filePath }, hostOverride)
  if (res.ok) {
    const data = res.data
    const exists =
      typeof data === 'boolean'
        ? data
        : isRecord(data) && typeof data.exists === 'boolean'
          ? data.exists
          : null
    if (exists === true) return 'exists'
    if (exists === false) return 'missing'
  }
  let probe: NativeInvocationResult
  try {
    probe = await invokeNativeCapability('Probe', { files: [filePath] }, hostOverride)
  } catch {
    // 路径没通过参数校验或宿主返回了损坏的数据：无法确认，交给调用方按「无法确认」处理
    return 'unknown'
  }
  return probe.ok && probeFoundFile(probe.data) ? 'exists' : 'unknown'
}

/**
 * 选择不会覆盖已有文件的输出路径：
 * 1. 依次尝试 <名>_ztools、<名>_ztools_2 …，宿主明确答复不存在才使用；答复已存在就换下一个；
 * 2. 宿主无法确认时，改用带批次时间标记的文件名（<名>_ztools_<时间>），仍先确认它不是已有文件；
 * 同一批次内已分配的路径与源文件路径都不会重复使用。实在找不到可用名称时抛错，该文件不处理。
 */
export async function chooseOutputPath(
  sourcePath: string,
  ext: string,
  reserved: Set<string>,
  batchTag: string,
  hostOverride?: unknown
): Promise<string> {
  const key = (p: string) => p.replace(/\//g, '\\').toLowerCase()
  const sourceKey = key(sourcePath)
  const usable = (candidate: string) => !reserved.has(key(candidate)) && key(candidate) !== sourceKey
  const take = (candidate: string) => {
    reserved.add(key(candidate))
    return candidate
  }

  for (let n = 1; n <= MAX_PLAIN_NAME_ATTEMPTS; n++) {
    const candidate = buildOutputCandidate(sourcePath, ext, n === 1 ? OUTPUT_SUFFIX : `${OUTPUT_SUFFIX}_${n}`)
    if (!usable(candidate)) continue
    const state = await checkPathExists(candidate, hostOverride)
    if (state === 'missing') return take(candidate)
    if (state === 'unknown') break
  }

  for (let n = 1; n <= MAX_TAGGED_NAME_ATTEMPTS; n++) {
    const suffix = n === 1 ? `${OUTPUT_SUFFIX}_${batchTag}` : `${OUTPUT_SUFFIX}_${batchTag}_${n}`
    const candidate = buildOutputCandidate(sourcePath, ext, suffix)
    if (!usable(candidate)) continue
    const state = await checkPathExists(candidate, hostOverride)
    if (state === 'exists') continue
    return take(candidate)
  }
  throw new Error('无法为输出文件生成不重复的文件名，已跳过该文件以免覆盖已有文件')
}

/** 把宿主错误整理成一句可读的提示：识别超时与缺少 ffmpeg，其余取错误输出的最后两行 */
export function summarizeHostError(raw: unknown): string {
  const text = String(raw ?? '')
    .replace(/^(?:DLL_ERROR|NATIVE_CALL_FAILED):\s*/, '')
    .trim()
  if (!text) return '宿主视频处理返回失败'
  if (/命令执行超时|调用超时|REQUEST_TIMEOUT|Call timeout/i.test(text)) {
    return `处理时间超过宿主限制（单个文件 ${HOST_FFMPEG_LIMIT_SECONDS} 秒）被中止，可复制 ffmpeg 命令在终端中运行`
  }
  if (/未检测到\s*ffmpeg/i.test(text)) {
    return '本机未检测到 ffmpeg：请先安装 ffmpeg，并确认在命令行中可以直接运行 ffmpeg'
  }
  if (/HOST_UNAVAILABLE|NO_WINDOW_ENV|METHOD_NOT_AVAILABLE/.test(text)) {
    return '未连接 ZTools 客户端，无法处理视频'
  }
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
  const tail = lines.slice(-2).join(' / ') || text
  return tail.length > 300 ? `${tail.slice(0, 300)}…` : tail
}

/** 把宿主单个文件的处理结果解析为界面结果；缺少输出信息时按失败处理，不当作成功 */
export function parseHostVideoResult(data: unknown): VideoProcessOutcome {
  const payload = isRecord(data) ? data : {}
  const errors = Array.isArray(payload.errors) ? payload.errors : []
  if (errors.length > 0) {
    const first = isRecord(errors[0]) ? errors[0] : {}
    return { status: 'failed', error: summarizeHostError(first.error || first.message || '宿主报告处理失败') }
  }
  const results = Array.isArray(payload.results) ? payload.results : []
  const r = results[0]
  if (!isRecord(r)) {
    return { status: 'failed', error: '宿主未返回处理结果，无法确认是否已生成输出文件' }
  }
  const outputPath = typeof r.outputPath === 'string' ? r.outputPath.trim() : ''
  const outputBytes = Number(r.outputBytes ?? r.sizeBytes)
  if (!outputPath || !Number.isFinite(outputBytes) || outputBytes <= 0) {
    return { status: 'failed', error: '宿主返回的结果缺少输出文件路径或大小' }
  }
  return { status: 'done', outputPath, outputBytes }
}

/** 处理一个文件：先选好不覆盖已有文件的输出路径，再以该路径调用宿主 */
export async function processVideoFile(
  file: Pick<RealVideoFileItem, 'path'>,
  settings: VideoProcessSettings,
  reserved: Set<string>,
  batchTag: string,
  hostOverride?: unknown
): Promise<VideoProcessOutcome> {
  const task = getVideoTask(settings.taskId)
  const ext = resolveOutputFormat(task, settings.format)
  if (!ext) {
    return { status: 'failed', error: `「${task.title}」不支持输出格式 ${settings.format || '（未选择）'}` }
  }
  try {
    const outputPath = await chooseOutputPath(file.path, ext, reserved, batchTag, hostOverride)
    const res = await invokeNativeCapability(
      task.method,
      { files: [file.path], outputPath, format: ext },
      hostOverride
    )
    if (!res.ok) {
      return { status: 'failed', error: summarizeHostError(res.error) }
    }
    return parseHostVideoResult(res.data)
  } catch (err) {
    return { status: 'failed', error: summarizeHostError(errorText(err)) }
  }
}

/** 逐个处理；每个文件完成后回调一次，单个失败不影响其余文件；shouldStop 返回 true 时不再开始下一个 */
export async function processVideoBatch(
  files: Array<Pick<RealVideoFileItem, 'id' | 'path'>>,
  settings: VideoProcessSettings,
  options: {
    hostOverride?: unknown
    batchTag?: string
    onItem?: (id: string, outcome: VideoProcessOutcome) => void
    shouldStop?: () => boolean
  } = {}
): Promise<Map<string, VideoProcessOutcome>> {
  const reserved = new Set<string>()
  const batchTag = options.batchTag || makeBatchTag()
  const outcomes = new Map<string, VideoProcessOutcome>()
  for (const file of files) {
    if (options.shouldStop?.()) break
    const outcome = await processVideoFile(file, settings, reserved, batchTag, options.hostOverride)
    outcomes.set(file.id, outcome)
    options.onItem?.(file.id, outcome)
  }
  return outcomes
}

export interface VideoBatchSummary {
  total: number
  done: number
  failed: number
  outputBytes: number
  firstError: string
}

export function summarizeOutcomes(outcomes: Iterable<VideoProcessOutcome>): VideoBatchSummary {
  const summary: VideoBatchSummary = { total: 0, done: 0, failed: 0, outputBytes: 0, firstError: '' }
  for (const outcome of outcomes) {
    summary.total += 1
    if (outcome.status === 'done') {
      summary.done += 1
      summary.outputBytes += outcome.outputBytes
    } else {
      summary.failed += 1
      if (!summary.firstError) summary.firstError = outcome.error
    }
  }
  return summary
}

/** 与宿主处理等效的 ffmpeg 命令；带 -n，目标文件已存在时 ffmpeg 直接退出，不会覆盖 */
export function buildFfmpegCommand(sourcePath: string, ext: string): string {
  return `ffmpeg -n -i "${sourcePath}" "${buildOutputCandidate(sourcePath, ext, OUTPUT_SUFFIX)}"`
}

export function describeOutcomeTag(result: VideoProcessOutcome | undefined): string {
  if (!result) return '未处理'
  if (result.status === 'done') return `已输出 ${formatBytes(result.outputBytes)}`
  return '失败'
}

export function describeOutcomeSubtitle(file: Pick<RealVideoFileItem, 'parentDir' | 'result'>): string {
  const result = file.result
  if (!result) return file.parentDir
  if (result.status === 'done') return `输出：${fileNameOf(result.outputPath)}`
  return `失败：${result.error}`
}

export const VIDEO_EXT_REGEX = /\.(?:mp4|mkv|mov|avi|flv|webm|wmv|ts|m4v|gif)$/i
/** 本插件生成的输出文件（*_ztools、*_ztools_2、*_ztools_<时间>、*_ztools_<时间>_2），扫描时不再列入队列 */
const DERIVED_OUTPUT_REGEX = /_ztools(?:_\d+){0,2}\.[a-z0-9]+$/i

export interface VideoWorkspaceSnapshot {
  scannedDirs: string[]
  files: RealVideoFileItem[]
}

export function makeVideoItem(id: string, filePath: string, sizeBytes: number): RealVideoFileItem {
  const { dir, fileName, ext } = splitPath(filePath)
  return {
    id,
    name: fileName,
    path: filePath,
    parentDir: dir,
    extension: ext,
    sizeBytes
  }
}

/**
 * 扫描本机 视频 / 下载 / 桌面 目录下的视频文件（每个目录最多取体积最大的 40 个），按体积从大到小排列。
 * 只收录扩展名是视频格式且大小大于 0 的文件，不用其他文件充数；本插件生成的输出文件不列入。
 */
export async function fetchRealVideoWorkspace(hostOverride?: unknown): Promise<VideoWorkspaceSnapshot> {
  const [videosDir, downloadsDir, desktopDir] = await Promise.all([
    getRealSystemPath('videos', hostOverride),
    getRealSystemPath('downloads', hostOverride),
    getRealSystemPath('desktop', hostOverride)
  ])

  const scannedDirs = [videosDir, downloadsDir, desktopDir].filter(Boolean)
  const files: RealVideoFileItem[] = []
  const seenPaths = new Set<string>()

  for (const dir of scannedDirs) {
    const videoScan = await scanRealDirectoryTree(dir, {
      maxFiles: 200,
      collectTopN: SCAN_TOP_N_PER_DIR,
      filterExt: VIDEO_EXT_REGEX,
      hostOverride
    })
    for (const f of videoScan.files) {
      if (f.isDir || f.sizeBytes <= 0) continue
      if (!VIDEO_EXT_REGEX.test(f.name) || DERIVED_OUTPUT_REGEX.test(f.name)) continue
      const normPath = f.path.replace(/\//g, '\\').toLowerCase()
      if (seenPaths.has(normPath)) continue
      seenPaths.add(normPath)
      files.push(makeVideoItem(`vid-${files.length}-${f.path}`, f.path, f.sizeBytes))
    }
  }

  files.sort((a, b) => b.sizeBytes - a.sizeBytes)
  return { scannedDirs, files }
}

export const scanLocalVideoQueue = fetchRealVideoWorkspace

/** 在资源管理器中显示文件（只定位，不会用默认程序打开文件）；宿主拒绝时返回 false */
export async function showFileInFolder(fullPath: string, hostOverride?: unknown): Promise<boolean> {
  if (!fullPath) return false
  const res = await callHostTransport('shell_show_item_in_folder', { fullPath }, hostOverride)
  return res.ok
}

/**
 * 定位处理结果：优先显示输出文件；输出文件没有访问授权时改为显示源文件（输出文件在同一目录）。
 * 返回实际显示的是哪一个，两者都失败时返回 failed。
 */
export async function revealVideoInFolder(
  file: Pick<RealVideoFileItem, 'path' | 'result'>,
  hostOverride?: unknown
): Promise<'output' | 'source' | 'failed'> {
  if (file.result?.status === 'done' && (await showFileInFolder(file.result.outputPath, hostOverride))) {
    return 'output'
  }
  if (await showFileInFolder(file.path, hostOverride)) return 'source'
  return 'failed'
}
