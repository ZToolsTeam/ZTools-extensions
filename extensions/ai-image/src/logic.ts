/**
 * AI 图片修复业务逻辑：扫描本机图片、校验参数、调用客户端图片处理接口并如实汇报每张图片的结果
 *
 * 当前客户端的图片处理接口只能按整数倍放大像素尺寸（插值放大，不补充细节、不提升清晰度）。
 * AI 超分辨率、去背景、人像修复需要客户端提供本地 AI 推理能力，在此之前这些功能标为不可用，
 * 选择后直接返回不可用原因，不调用客户端，也不生成任何文件。
 */

import {
  callHostTransport,
  formatBytes,
  getRealSystemPath,
  invokePluginService,
  isRealElectronHost,
  scanRealDirectoryTree,
  showRealItemInFolder
} from './native-ipc.js'

export { formatBytes }

export type AiImageScale = '2x' | '4x'
export type AiImageOutputFormat = 'png' | 'jpg'

export interface AiImageEnginePreset {
  id: string
  title: string
  subtitle: string
  tag: string
  /** 客户端是否真的提供该能力；为 false 时不会调用客户端 */
  available: boolean
  /** 传给客户端图片处理接口的处理方式，仅 available 为 true 时使用 */
  hostMode?: string
  /** 不可用原因，显示给用户 */
  unavailableReason?: string
}

export interface AiImageFileItem {
  id: string
  name: string
  path: string
  /** 图片所在目录 */
  parentDir: string
  extension: string
  sizeBytes: number
  /** 原图像素宽高；扫描时客户端不提供，未识别时为 0 */
  width: number
  height: number
}

export interface AiImageBatchConfig {
  engineId: string
  scaleFactor: AiImageScale
  outputFormat: AiImageOutputFormat
}

export interface AiImageProcessedItemResult {
  inputPath: string
  outputPath: string
  sizeBytes: number
  /** 客户端返回的输出像素宽高，未返回时为 0 */
  width: number
  height: number
}

export interface AiImageFailedItem {
  inputPath: string
  error: string
}

export interface AiImageBatchResult {
  /** 全部图片都处理成功时为 true */
  ok: boolean
  processedCount: number
  failedCount: number
  engineId: string
  outputFormat: string
  totalOutputBytes: number
  outputs: AiImageProcessedItemResult[]
  failures: AiImageFailedItem[]
  /** 整体失败原因，或第一张失败图片的原因 */
  error?: string
}

export interface AiImageQueueSnapshot {
  files: AiImageFileItem[]
  scannedDirs: string[]
  error?: string
}

/** 测试注入的宿主替身（与 native-ipc 的 hostOverride 参数同类型） */
export type AiImageHostOverride = Parameters<typeof callHostTransport>[2]

type HostRecord = Record<string, unknown>

function asRecord(value: unknown): HostRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as HostRecord) : null
}

function nonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export const FORBIDDEN_PATH_PATTERN = new RegExp('\\\\Windows\\\\System32|\\.\\.\\\\|\\.\\./', 'i')

export const AI_INFERENCE_UNAVAILABLE_REASON = '当前客户端没有提供本地 AI 推理能力，此功能暂不可用'

export const HOST_UNAVAILABLE_ERROR = 'HOST_UNAVAILABLE: 需要在 ZTools 客户端中运行'

export const AI_IMAGE_ENGINES: AiImageEnginePreset[] = [
  {
    id: 'basic-upscale',
    title: '普通放大（非 AI）',
    subtitle: '按倍数放大像素尺寸，不会补充细节或提升清晰度',
    tag: '普通放大',
    available: true,
    hostMode: 'upscale'
  },
  {
    id: 'ai-super-resolution',
    title: 'AI 超分辨率',
    subtitle: '用 AI 模型放大图片并补充细节',
    tag: 'AI 超分',
    available: false,
    unavailableReason: AI_INFERENCE_UNAVAILABLE_REASON
  },
  {
    id: 'ai-background-removal',
    title: 'AI 去背景',
    subtitle: '识别主体并把背景改为透明',
    tag: 'AI 去背景',
    available: false,
    unavailableReason: AI_INFERENCE_UNAVAILABLE_REASON
  },
  {
    id: 'ai-face-restoration',
    title: 'AI 人像修复',
    subtitle: '修复模糊、低清人像的五官细节',
    tag: 'AI 人像修复',
    available: false,
    unavailableReason: AI_INFERENCE_UNAVAILABLE_REASON
  }
]

export const AI_IMAGE_SCALES: AiImageScale[] = ['2x', '4x']
export const AI_IMAGE_OUTPUT_FORMATS: AiImageOutputFormat[] = ['png', 'jpg']

/** 客户端图片处理接口能读取的格式（不支持读取 WebP，所以不列入队列） */
const IMAGE_EXT_REGEX = /\.(?:png|jpg|jpeg|bmp)$/i

/** 同一张图片在同一时刻的输出文件名重名时，最多尝试的序号 */
const MAX_OUTPUT_NAME_ATTEMPTS = 20

/** 本次运行中已经分配过的输出路径（小写），同一秒内连续处理同一张图片也不会复用 */
const assignedOutputPaths = new Set<string>()

export function findAiImageEngine(engineId: string): AiImageEnginePreset | undefined {
  return AI_IMAGE_ENGINES.find(e => e.id === engineId)
}

function scaleToNumber(scale: AiImageScale): number {
  return scale === '4x' ? 4 : 2
}

/** 输出分辨率：原图分辨率未识别时返回「未识别」，不编造数值 */
export function estimateTargetResolution(width: number, height: number, scale: AiImageScale): string {
  if (!(width > 0) || !(height > 0)) return '未识别'
  const factor = scaleToNumber(scale)
  return `${Math.round(width * factor)}×${Math.round(height * factor)}`
}

export function validateAiImagePayload(config: Partial<AiImageBatchConfig> | null | undefined): {
  valid: boolean
  error?: string
} {
  if (!config || typeof config !== 'object') {
    return { valid: false, error: 'INVALID_CONFIG: 配置参数不能为空' }
  }
  if (!config.engineId || typeof config.engineId !== 'string') {
    return { valid: false, error: 'INVALID_ENGINE: 处理方式不能为空' }
  }
  const engine = findAiImageEngine(config.engineId)
  if (!engine) {
    return { valid: false, error: `UNKNOWN_ENGINE: 不支持的处理方式 ${config.engineId}` }
  }
  if (!engine.available) {
    return {
      valid: false,
      error: `ENGINE_UNAVAILABLE: ${engine.title}：${engine.unavailableReason || AI_INFERENCE_UNAVAILABLE_REASON}`
    }
  }
  if (!AI_IMAGE_SCALES.includes(config.scaleFactor as AiImageScale)) {
    return { valid: false, error: `INVALID_SCALE: 只支持 ${AI_IMAGE_SCALES.join(' / ')} 放大` }
  }
  if (!AI_IMAGE_OUTPUT_FORMATS.includes(config.outputFormat as AiImageOutputFormat)) {
    return { valid: false, error: `INVALID_FORMAT: 只支持输出 ${AI_IMAGE_OUTPUT_FORMATS.join(' / ')}` }
  }
  return { valid: true }
}

function hasHost(hostOverride?: unknown): boolean {
  return (hostOverride !== undefined && hostOverride !== null) || isRealElectronHost()
}

function splitPath(fullPath: string): { dir: string; sep: string; base: string } {
  const idx = Math.max(fullPath.lastIndexOf('\\'), fullPath.lastIndexOf('/'))
  if (idx < 0) return { dir: '', sep: '\\', base: fullPath }
  return { dir: fullPath.slice(0, idx), sep: fullPath[idx], base: fullPath.slice(idx + 1) }
}

function samePath(a: string, b: string): boolean {
  return a.replace(/\//g, '\\').toLowerCase() === b.replace(/\//g, '\\').toLowerCase()
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 输出文件名里的时间（本地时间，到秒），用于避开以前生成过的同名文件 */
export function formatOutputStamp(date: Date): string {
  return (
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}` +
    `-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`
  )
}

/** 输出路径：原图同目录，文件名 = 原名_倍率_时间[_序号].格式 */
export function buildOutputPath(
  inputPath: string,
  scale: AiImageScale,
  format: AiImageOutputFormat,
  stamp: string,
  attempt = 0
): string {
  const { dir, sep, base } = splitPath(inputPath)
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const seq = attempt > 0 ? `_${attempt + 1}` : ''
  return `${dir}${dir ? sep : ''}${stem}_${scale}_${stamp}${seq}.${format}`
}

/**
 * 查询文件是否已存在：true / false 为客户端的明确答复；查询失败或答复无法识别时返回 undefined。
 * 客户端可能不允许读取尚未生成的输出路径，此时依靠文件名里的时间避免与已有文件重名。
 */
async function probeFileExists(filePath: string, hostOverride?: AiImageHostOverride): Promise<boolean | undefined> {
  const res = await callHostTransport<unknown>('filesystem_file_exists', { path: filePath }, hostOverride)
  if (!res.ok) return undefined
  if (typeof res.data === 'boolean') return res.data
  const exists = asRecord(res.data)?.exists
  return typeof exists === 'boolean' ? exists : undefined
}

async function pickOutputPath(
  inputPath: string,
  config: AiImageBatchConfig,
  stamp: string,
  reserved: Set<string>,
  hostOverride?: AiImageHostOverride
): Promise<{ path?: string; error?: string }> {
  for (let attempt = 0; attempt < MAX_OUTPUT_NAME_ATTEMPTS; attempt++) {
    const candidate = buildOutputPath(inputPath, config.scaleFactor, config.outputFormat, stamp, attempt)
    const key = candidate.replace(/\//g, '\\').toLowerCase()
    if (samePath(candidate, inputPath) || reserved.has(key)) continue
    if ((await probeFileExists(candidate, hostOverride)) === true) continue
    reserved.add(key)
    return { path: candidate }
  }
  return { error: 'OUTPUT_NAME_UNAVAILABLE: 输出目录里已有同名文件，未生成输出以免覆盖' }
}

function toPositiveNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** 从客户端返回中读取输出文件；缺少路径或大小时视为未能确认生成，不用原图大小等数值代替 */
function readHostOutput(
  raw: unknown,
  inputPath: string
): { output?: AiImageProcessedItemResult; error?: string } {
  const data = asRecord(raw)
  if (!data) {
    return { error: 'OUTPUT_UNVERIFIED: 客户端没有返回处理结果' }
  }
  if (data.ok === false || data.success === false) {
    const firstErr = Array.isArray(data.errors) ? nonEmptyString(asRecord(data.errors[0])?.error) : ''
    return { error: nonEmptyString(data.error) || firstErr || '客户端图片处理失败' }
  }
  const item = (Array.isArray(data.results) ? asRecord(data.results[0]) : null) || data
  const outputPath = nonEmptyString(item.outputPath) || nonEmptyString(data.outputPath)
  const sizeBytes = toPositiveNumber(item.outputBytes ?? item.sizeBytes ?? data.outputBytes)
  if (!outputPath || sizeBytes <= 0) {
    return { error: 'OUTPUT_UNVERIFIED: 客户端没有返回输出文件的路径和大小，无法确认已生成' }
  }
  return {
    output: {
      inputPath,
      outputPath,
      sizeBytes,
      width: toPositiveNumber(item.width ?? data.width),
      height: toPositiveNumber(item.height ?? data.height)
    }
  }
}

export async function fetchAiImageQueue(hostOverride?: AiImageHostOverride): Promise<AiImageQueueSnapshot> {
  if (!hasHost(hostOverride)) {
    return { files: [], scannedDirs: [], error: HOST_UNAVAILABLE_ERROR }
  }
  const [picturesDir, desktopDir, downloadsDir] = await Promise.all([
    getRealSystemPath('pictures', hostOverride),
    getRealSystemPath('desktop', hostOverride),
    getRealSystemPath('downloads', hostOverride)
  ])

  const scannedDirs = [picturesDir, desktopDir, downloadsDir].filter(Boolean)
  if (scannedDirs.length === 0) {
    return { files: [], scannedDirs, error: 'SYSTEM_PATH_UNAVAILABLE: 无法获取图片、桌面、下载目录的位置' }
  }

  const files: AiImageFileItem[] = []
  const seenPaths = new Set<string>()

  for (const dir of scannedDirs) {
    const scanRes = await scanRealDirectoryTree(dir, {
      maxDepth: 2,
      maxFiles: 200,
      collectTopN: 40,
      filterExt: IMAGE_EXT_REGEX,
      hostOverride
    })
    for (const f of scanRes.files) {
      if (f.isDir || f.sizeBytes <= 0 || !IMAGE_EXT_REGEX.test(f.name)) continue
      const normPath = f.path.toLowerCase()
      if (seenPaths.has(normPath)) continue
      seenPaths.add(normPath)
      const dot = f.name.lastIndexOf('.')
      files.push({
        id: `ai-img-${f.path}`,
        name: f.name,
        path: f.path,
        parentDir: splitPath(f.path).dir || dir,
        extension: dot > 0 ? f.name.slice(dot).toLowerCase() : '',
        sizeBytes: f.sizeBytes,
        width: 0,
        height: 0
      })
    }
  }

  files.sort((a, b) => b.sizeBytes - a.sizeBytes)
  return { files, scannedDirs }
}

export async function executeAiImageBatch(
  files: AiImageFileItem[],
  config: AiImageBatchConfig,
  hostOverride?: AiImageHostOverride,
  now: Date = new Date()
): Promise<AiImageBatchResult> {
  const engineId = typeof config?.engineId === 'string' ? config.engineId : ''
  const outputFormat = typeof config?.outputFormat === 'string' ? config.outputFormat : ''
  const rejected = (error: string): AiImageBatchResult => ({
    ok: false,
    processedCount: 0,
    failedCount: 0,
    engineId,
    outputFormat,
    totalOutputBytes: 0,
    outputs: [],
    failures: [],
    error
  })

  if (!Array.isArray(files) || files.length === 0) {
    return rejected('EMPTY_QUEUE: 待处理图片队列不能为空')
  }
  const check = validateAiImagePayload(config)
  if (!check.valid) return rejected(check.error || 'INVALID_CONFIG')
  for (const f of files) {
    if (!f?.path || FORBIDDEN_PATH_PATTERN.test(f.path)) {
      return rejected('SECURITY_INTERCEPTED: 输入图片路径包含受保护系统目录或路径穿越')
    }
  }
  if (!hasHost(hostOverride)) return rejected(HOST_UNAVAILABLE_ERROR)

  const engine = findAiImageEngine(engineId)!
  const stamp = formatOutputStamp(now)
  const outputs: AiImageProcessedItemResult[] = []
  const failures: AiImageFailedItem[] = []

  for (const f of files) {
    if (!IMAGE_EXT_REGEX.test(f.path)) {
      failures.push({ inputPath: f.path, error: 'UNSUPPORTED_INPUT: 只支持 PNG、JPG、BMP 图片' })
      continue
    }
    const picked = await pickOutputPath(f.path, config, stamp, assignedOutputPaths, hostOverride)
    if (!picked.path) {
      failures.push({ inputPath: f.path, error: picked.error || 'OUTPUT_NAME_UNAVAILABLE' })
      continue
    }
    const pluginRes = await invokePluginService<unknown>(
      'AiImagePlugin',
      'processImage',
      {
        inputPath: f.path,
        outputPath: picked.path,
        mode: engine.hostMode,
        scale: scaleToNumber(config.scaleFactor),
        outputFormat: config.outputFormat
      },
      hostOverride
    )
    if (!pluginRes.ok) {
      failures.push({ inputPath: f.path, error: pluginRes.error || pluginRes.message || '客户端图片处理失败' })
      continue
    }
    const parsed = readHostOutput(pluginRes.data, f.path)
    if (parsed.output) {
      outputs.push(parsed.output)
    } else {
      failures.push({ inputPath: f.path, error: parsed.error || 'OUTPUT_UNVERIFIED' })
    }
  }

  return {
    ok: failures.length === 0 && outputs.length > 0,
    processedCount: outputs.length,
    failedCount: failures.length,
    engineId,
    outputFormat,
    totalOutputBytes: outputs.reduce((sum, o) => sum + o.sizeBytes, 0),
    outputs,
    failures,
    ...(failures.length > 0 ? { error: failures[0].error } : {})
  }
}

export async function openAiImageLocation(fullPath: string, hostOverride?: AiImageHostOverride): Promise<boolean> {
  if (!fullPath) return false
  return showRealItemInFolder(fullPath, hostOverride)
}
