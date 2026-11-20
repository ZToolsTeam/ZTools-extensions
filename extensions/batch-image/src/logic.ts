/**
 * 批量图片压缩与格式转换：业务逻辑层
 *
 * - 图片由用户选择文件、选择文件夹、拖入或从剪贴板添加，插件不会自动扫描本机目录
 * - 6 个处理方案，参数映射到宿主图片处理接口真实支持的取值（画质 q70 / q85 / q95，缩放 source / max1920 / max1280）
 * - 逐张调用宿主处理，每张图都显式指定输出路径：输出前避开已存在的同名文件，绝不覆盖原图
 * - 只展示宿主返回的真实结果（输出路径、体积、尺寸），读不到的信息标为未识别，不做估算
 */

import {
  callHostTransport,
  formatBytes,
  invokeDllPluginCapability,
  showRealItemInFolder,
  trashRealItem
} from './native-ipc.js'
import { friendlyFileError } from './file-import.js'
import type { FileImportRules, FileImportTransport, ImportedFile } from './file-import.js'
import { t } from './i18n.js'

export { formatBytes } from './native-ipc.js'

export type OutputFormat = 'keep' | 'jpg' | 'png'
export type QualityTier = 'q70' | 'q85' | 'q95'
export type ResizePreset = 'source' | 'max1920' | 'max1280'

export interface ImageWorkshopPreset {
  id: string
  title: string
  subtitle: string
  tag: string
  method: string
  defaultFormat: OutputFormat
  defaultQuality: QualityTier
  defaultResize: ResizePreset
  grayscale: boolean
  /** 输出体积上限（字节）：宿主不会按体积反复压缩，处理后把超过上限的图片如实标出 */
  sizeLimitBytes?: number
}

export interface ImageProcessDone {
  status: 'done'
  outputPath: string
  /** 原图大小；宿主未返回且插件也读不到时为 null */
  originalBytes: number | null
  outputBytes: number
  /** 输出尺寸；宿主读不到（ffmpeg 兜底编码）时为 0，界面显示「尺寸未识别」 */
  width: number
  height: number
  /** 输出不小于原图（保持格式且重新编码更大时，宿主会输出原图内容的副本） */
  notSmaller: boolean
  /** 本次处理设定的体积上限；输出超过它时为该上限，否则为 null */
  overLimitBytes: number | null
}

export interface ImageProcessFailed {
  status: 'failed'
  error: string
}

export type ImageProcessOutcome = ImageProcessDone | ImageProcessFailed

export interface RealImageFileItem {
  id: string
  name: string
  path: string
  parentDir: string
  extension: string
  /** 原图大小；读不到（例如从剪贴板添加且宿主未授权读取）时为 null */
  sizeBytes: number | null
  result?: ImageProcessOutcome
}

export interface NativeInvocationResult {
  ok: boolean
  pluginName: string
  method: string
  data?: unknown
  error?: string
  fromFallback?: boolean
}

export interface ImageProcessSettings {
  method: string
  outputFormat: OutputFormat
  qualityTier: QualityTier
  resizePreset: ResizePreset
  grayscale: boolean
  sizeLimitBytes?: number
}

export const DLL_PLUGIN_NAME = 'BatchImagePlugin'
export const FORBIDDEN_TARGET_PATTERN = new RegExp('\\\\Windows\\\\System32|\\.\\.\\\\|\\.\\./', 'i')
export const FORBIDDEN_REASON = t('forbiddenReason')
export const IMAGE_SIZE_LIMIT_300KB = 300 * 1024
/** 输出文件名后缀：<原文件名>_opt.<扩展名> */
export const OUTPUT_SUFFIX = '_opt'
const MAX_NAME_ATTEMPTS = 20

export function getQualityOptions(): Array<{ label: string; value: QualityTier }> {
  return [
    { label: t('qualityMedium'), value: 'q85' },
    { label: t('qualityLow'), value: 'q70' },
    { label: t('qualityHigh'), value: 'q95' }
  ]
}

export function getResizeOptions(): Array<{ label: string; value: ResizePreset }> {
  return [
    { label: t('resizeSource'), value: 'source' },
    { label: t('resizeMax1920'), value: 'max1920' },
    { label: t('resizeMax1280'), value: 'max1280' }
  ]
}

export function getFormatOptions(): Array<{ label: string; value: OutputFormat }> {
  return [
    { label: t('formatKeep'), value: 'keep' },
    { label: 'JPG', value: 'jpg' },
    { label: 'PNG', value: 'png' }
  ]
}

export function getImageWorkshopPresets(): ImageWorkshopPreset[] {
  return [
    {
      id: 'preset-smart-lossless',
      title: t('presetLosslessTitle'),
      subtitle: t('presetLosslessSub'),
      tag: t('presetLosslessTag'),
      method: 'BatchCompressImage',
      defaultFormat: 'keep',
      defaultQuality: 'q85',
      defaultResize: 'source',
      grayscale: false
    },
    {
      id: 'preset-extreme-300k',
      title: t('presetGovTitle'),
      subtitle: t('presetGovSub'),
      tag: t('presetGovTag'),
      method: 'BatchCompressImage',
      defaultFormat: 'jpg',
      defaultQuality: 'q70',
      defaultResize: 'max1280',
      grayscale: false,
      sizeLimitBytes: IMAGE_SIZE_LIMIT_300KB
    },
    {
      id: 'preset-to-jpg',
      title: t('presetJpgTitle'),
      subtitle: t('presetJpgSub'),
      tag: t('presetJpgTag'),
      method: 'BatchConvertFormat',
      defaultFormat: 'jpg',
      defaultQuality: 'q85',
      defaultResize: 'source',
      grayscale: false
    },
    {
      id: 'preset-to-png',
      title: t('presetPngTitle'),
      subtitle: t('presetPngSub'),
      tag: t('presetPngTag'),
      method: 'BatchConvertFormat',
      defaultFormat: 'png',
      defaultQuality: 'q95',
      defaultResize: 'source',
      grayscale: false
    },
    {
      id: 'preset-scale-1920',
      title: t('preset1920Title'),
      subtitle: t('preset1920Sub'),
      tag: t('preset1920Tag'),
      method: 'BatchResizeResolution',
      defaultFormat: 'keep',
      defaultQuality: 'q85',
      defaultResize: 'max1920',
      grayscale: false
    },
    {
      id: 'preset-doc-grayscale',
      title: t('presetGrayTitle'),
      subtitle: t('presetGraySub'),
      tag: t('presetGrayTag'),
      method: 'BatchGrayscaleDoc',
      defaultFormat: 'keep',
      defaultQuality: 'q85',
      defaultResize: 'source',
      grayscale: true
    }
  ]
}

export const QUALITY_OPTIONS: Array<{ label: string; value: QualityTier }> = getQualityOptions()
export const RESIZE_OPTIONS: Array<{ label: string; value: ResizePreset }> = getResizeOptions()
export const FORMAT_OPTIONS: Array<{ label: string; value: OutputFormat }> = getFormatOptions()
export const IMAGE_WORKSHOP_PRESETS: ImageWorkshopPreset[] = getImageWorkshopPresets()

export function getCapabilityItems(): ImageWorkshopPreset[] {
  return getImageWorkshopPresets().map((item) => ({ ...item }))
}

export function filterCapabilityItems(items: ImageWorkshopPreset[], query: string): ImageWorkshopPreset[] {
  if (!Array.isArray(items)) return []
  const q = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (!q) return items
  return items.filter((item) => {
    if (!item || typeof item.title !== 'string') return false
    return (
      item.title.toLowerCase().includes(q) ||
      item.subtitle.toLowerCase().includes(q) ||
      item.tag.toLowerCase().includes(q) ||
      item.method.toLowerCase().includes(q)
    )
  })
}

export function validateInvocationPayload(
  method: string,
  params: unknown
): { valid: boolean; error?: string } {
  if (typeof method !== 'string' || method.trim().length === 0) {
    return { valid: false, error: t('errInvalidMethodEmpty') }
  }
  if (method.length > 128 || !/^[A-Za-z0-9_]+$/.test(method.trim())) {
    return { valid: false, error: t('errInvalidMethodFormat') }
  }
  if (params === null || params === undefined || typeof params !== 'object' || Array.isArray(params)) {
    return { valid: false, error: t('errInvalidParamsObject') }
  }

  const record = params as Record<string, unknown>
  for (const [key, val] of Object.entries(record)) {
    if (typeof val === 'string') {
      if (val.length > 4096) {
        return { valid: false, error: t('errParamTooLong', { key }) }
      }
      if (FORBIDDEN_TARGET_PATTERN.test(val)) {
        return { valid: false, error: t('errSecurityIntercepted', { reason: t('forbiddenReason') }) }
      }
    } else if (typeof val === 'number') {
      if (!Number.isFinite(val) || val < 0 || val > 100_000_000) {
        return { valid: false, error: t('errParamOutOfRange', { key }) }
      }
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
    throw new Error(check.error || t('errValidationFailed'))
  }
  const res = await invokeDllPluginCapability(DLL_PLUGIN_NAME, method, params, hostBridge)
  return {
    ok: res.ok,
    pluginName: DLL_PLUGIN_NAME,
    method: method.trim(),
    data: res.data ?? undefined,
    error: res.error,
    fromFallback: res.fromFallback
  }
}

export const IMAGE_EXT_REGEX = /\.(?:png|jpg|jpeg|webp|bmp|gif|tiff|avif)$/i
/** 可导入的图片扩展名（与 IMAGE_EXT_REGEX 一致） */
export const IMAGE_IMPORT_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tiff', '.avif'] as const
/** 本插件生成的输出文件（*_opt、*_opt_2、*_opt_<时间>），导入文件夹时不再重复列入 */
export const DERIVED_OUTPUT_REGEX = /_opt(?:_\d+){0,2}\.(?:png|jpg|jpeg|webp|bmp|gif|tiff|avif)$/i

/** 是否为本插件生成的输出文件 */
export function isDerivedOutputName(name: string): boolean {
  return DERIVED_OUTPUT_REGEX.test(String(name || ''))
}

/** 界面说明支持的图片格式 */
export const IMAGE_IMPORT_SUPPORTED_TEXT = 'PNG / JPG / WebP / BMP / GIF / TIFF / AVIF'

/** 图片导入规则：仅接受支持的图片格式，排除本插件输出文件及系统受保护路径 */
export const IMAGE_IMPORT_RULES: FileImportRules = {
  extensions: IMAGE_IMPORT_EXTENSIONS,
  excludeFile: (name) => isDerivedOutputName(name),
  forbiddenPath: FORBIDDEN_TARGET_PATTERN
}

/** 将宿主调用适配为共享导入模块所需的 transport */
export function createImageImportTransport(hostOverride?: unknown): FileImportTransport {
  return (method, params) => callHostTransport<unknown>(method, params, hostOverride)
}

function splitPath(filePath: string): { dir: string; fileName: string; base: string; ext: string } {
  const sepIdx = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'))
  const dir = sepIdx >= 0 ? filePath.slice(0, sepIdx) : ''
  const fileName = sepIdx >= 0 ? filePath.slice(sepIdx + 1) : filePath
  const dot = fileName.lastIndexOf('.')
  const base = dot > 0 ? fileName.slice(0, dot) : fileName
  const ext = dot > 0 ? fileName.slice(dot).toLowerCase() : ''
  return { dir, fileName, base, ext }
}

/** 输出扩展名：保持原格式时取原图扩展名（小写），否则取目标格式；识别不到扩展名返回 null */
export function resolveTargetExtension(sourcePath: string, format: OutputFormat): string | null {
  if (format === 'jpg') return '.jpg'
  if (format === 'png') return '.png'
  const { ext } = splitPath(sourcePath)
  return ext || null
}

/** 在原图同目录生成 <原文件名><后缀><扩展名> */
export function buildOutputCandidate(sourcePath: string, targetExt: string, suffix: string): string {
  const sepIdx = Math.max(sourcePath.lastIndexOf('\\'), sourcePath.lastIndexOf('/'))
  const dirWithSep = sepIdx >= 0 ? sourcePath.slice(0, sepIdx + 1) : ''
  const { base } = splitPath(sourcePath)
  return `${dirWithSep}${base}${suffix}${targetExt}`
}

/** 批次时间标记（YYYYMMDDHHmmss），用于无法确认同名文件时生成不重复的输出文件名 */
export function makeBatchTag(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/** 查询文件是否存在：true / false 为宿主明确答复，null 表示无法确认（未授权、接口不可用、返回格式异常） */
async function probeFileExists(filePath: string, hostOverride?: unknown): Promise<boolean | null> {
  const res = await callHostTransport<unknown>('filesystem_file_exists', { path: filePath }, hostOverride)
  if (!res.ok) return null
  const data = res.data as unknown
  if (typeof data === 'boolean') return data
  if (data && typeof data === 'object' && typeof (data as { exists?: unknown }).exists === 'boolean') {
    return (data as { exists: boolean }).exists
  }
  return null
}

/**
 * 选择不会覆盖已有文件的输出路径：
 * 1. 依次尝试 <名>_opt、<名>_opt_2 …，宿主明确答复不存在才使用；
 * 2. 宿主无法确认是否存在时，改用带批次时间标记的文件名（<名>_opt_<时间>），不使用可能已存在的普通名称；
 * 同一批次内已分配的路径与原图路径都不会重复使用。
 */
export async function chooseOutputPath(
  sourcePath: string,
  targetExt: string,
  reserved: Set<string>,
  batchTag: string,
  hostOverride?: unknown
): Promise<string> {
  const key = (p: string) => p.toLowerCase()
  const sourceKey = key(sourcePath)
  const take = (candidate: string) => {
    reserved.add(key(candidate))
    return candidate
  }
  for (let n = 1; n <= MAX_NAME_ATTEMPTS; n++) {
    const candidate = buildOutputCandidate(sourcePath, targetExt, n === 1 ? OUTPUT_SUFFIX : `${OUTPUT_SUFFIX}_${n}`)
    if (reserved.has(key(candidate)) || key(candidate) === sourceKey) continue
    const exists = await probeFileExists(candidate, hostOverride)
    if (exists === false) return take(candidate)
    if (exists === null) break
  }
  for (let n = 1; n <= 1000; n++) {
    const suffix = n === 1 ? `${OUTPUT_SUFFIX}_${batchTag}` : `${OUTPUT_SUFFIX}_${batchTag}_${n}`
    const candidate = buildOutputCandidate(sourcePath, targetExt, suffix)
    if (!reserved.has(key(candidate)) && key(candidate) !== sourceKey) return take(candidate)
  }
  throw new Error(t('errCannotGenUniqueName'))
}

/** 把宿主单张图片的处理结果解析为界面结果；缺少输出信息时按失败处理，不当作成功 */
export function parseHostImageResult(
  data: unknown,
  fallbackOriginalBytes: number | null,
  sizeLimitBytes?: number
): ImageProcessOutcome {
  const payload = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const errors = Array.isArray(payload.errors) ? (payload.errors as Array<Record<string, unknown>>) : []
  if (errors.length > 0) {
    const first = errors[0]
    return { status: 'failed', error: String(first?.error || first?.message || t('errHostFailed')) }
  }
  const results = Array.isArray(payload.results) ? (payload.results as Array<Record<string, unknown>>) : []
  const r = results[0]
  if (!r || typeof r !== 'object') {
    return { status: 'failed', error: t('errHostNoResult') }
  }
  const outputPath = typeof r.outputPath === 'string' ? r.outputPath.trim() : ''
  const outputBytes = Number(r.outputBytes ?? r.sizeBytes)
  if (!outputPath || !Number.isFinite(outputBytes) || outputBytes <= 0) {
    return { status: 'failed', error: t('errHostMissingOutput') }
  }
  const rawOriginal = Number(r.originalBytes)
  const originalBytes = Number.isFinite(rawOriginal) && rawOriginal > 0 ? rawOriginal : fallbackOriginalBytes
  const width = Number(r.width)
  const height = Number(r.height)
  const limit = typeof sizeLimitBytes === 'number' && sizeLimitBytes > 0 ? sizeLimitBytes : null
  return {
    status: 'done',
    outputPath,
    originalBytes,
    outputBytes,
    width: Number.isFinite(width) && width > 0 ? width : 0,
    height: Number.isFinite(height) && height > 0 ? height : 0,
    notSmaller: originalBytes !== null && outputBytes >= originalBytes,
    overLimitBytes: limit !== null && outputBytes > limit ? limit : null
  }
}

/** 处理一张图片：先选好不覆盖已有文件的输出路径，再以该路径调用宿主 */
export async function processImageFile(
  file: Pick<RealImageFileItem, 'path' | 'sizeBytes'>,
  settings: ImageProcessSettings,
  reserved: Set<string>,
  batchTag: string,
  hostOverride?: unknown
): Promise<ImageProcessOutcome> {
  const targetExt = resolveTargetExtension(file.path, settings.outputFormat)
  if (!targetExt) {
    return { status: 'failed', error: t('errUnknownExt') }
  }
  try {
    const outputPath = await chooseOutputPath(file.path, targetExt, reserved, batchTag, hostOverride)
    const res = await invokeNativeCapability(
      settings.method,
      {
        files: [file.path],
        outputPath,
        outputFormat: settings.outputFormat,
        qualityTier: settings.qualityTier,
        resizePreset: settings.resizePreset,
        grayscale: settings.grayscale
      },
      hostOverride
    )
    if (!res.ok) {
      return { status: 'failed', error: friendlyFileError(res.error || t('errHostReturnFailed')) }
    }
    return parseHostImageResult(res.data, file.sizeBytes, settings.sizeLimitBytes)
  } catch (err) {
    return { status: 'failed', error: friendlyFileError(err) }
  }
}

/**
 * 逐张处理；每张完成后回调一次，单张失败不影响其余图片。
 * shouldSkip 返回 true 的图片（如处理中被移出列表）不再调用宿主，也不产生结果。
 */
export async function processImageBatch(
  files: Array<Pick<RealImageFileItem, 'id' | 'path' | 'sizeBytes'>>,
  settings: ImageProcessSettings,
  options: {
    hostOverride?: unknown
    batchTag?: string
    onItem?: (id: string, outcome: ImageProcessOutcome) => void
    onStart?: (id: string) => void
    shouldSkip?: (id: string) => boolean
  } = {}
): Promise<Map<string, ImageProcessOutcome>> {
  const reserved = new Set<string>()
  const batchTag = options.batchTag || makeBatchTag()
  const outcomes = new Map<string, ImageProcessOutcome>()
  for (const file of files) {
    if (options.shouldSkip?.(file.id)) continue
    options.onStart?.(file.id)
    const outcome = await processImageFile(file, settings, reserved, batchTag, options.hostOverride)
    outcomes.set(file.id, outcome)
    options.onItem?.(file.id, outcome)
  }
  return outcomes
}

export interface ImageBatchSummary {
  total: number
  done: number
  failed: number
  notSmaller: number
  overLimit: number
  outputBytes: number
  /** 已知原图大小的成功项的原图总大小（节省比例的分母） */
  comparableOriginalBytes: number
  savedBytes: number
  savePercent: number
  firstError: string
}

export function summarizeOutcomes(outcomes: Iterable<ImageProcessOutcome>): ImageBatchSummary {
  const summary: ImageBatchSummary = {
    total: 0,
    done: 0,
    failed: 0,
    notSmaller: 0,
    overLimit: 0,
    outputBytes: 0,
    comparableOriginalBytes: 0,
    savedBytes: 0,
    savePercent: 0,
    firstError: ''
  }
  for (const o of outcomes) {
    summary.total += 1
    if (o.status === 'failed') {
      summary.failed += 1
      if (!summary.firstError) summary.firstError = o.error
      continue
    }
    summary.done += 1
    summary.outputBytes += o.outputBytes
    if (o.notSmaller) summary.notSmaller += 1
    if (o.overLimitBytes !== null) summary.overLimit += 1
    if (o.originalBytes !== null) {
      summary.comparableOriginalBytes += o.originalBytes
      summary.savedBytes += Math.max(0, o.originalBytes - o.outputBytes)
    }
  }
  summary.savePercent =
    summary.comparableOriginalBytes > 0 ? Math.round((summary.savedBytes / summary.comparableOriginalBytes) * 100) : 0
  return summary
}

/**
 * 从剪贴板文本解析图片路径：每行一个，去掉两端引号；只接受绝对路径与支持的图片扩展名
 */
export function parseClipboardImagePaths(text: string, limit = 200): string[] {
  if (typeof text !== 'string' || !text.trim()) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const cleaned = line.trim().replace(/^["']+|["']+$/g, '').trim()
    if (!cleaned) continue
    const isAbsolute = /^[A-Za-z]:[\\/]/.test(cleaned) || cleaned.startsWith('\\\\') || cleaned.startsWith('/')
    if (!isAbsolute || !IMAGE_EXT_REGEX.test(cleaned)) continue
    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(cleaned)
    if (out.length >= limit) break
  }
  return out
}

/** 读取文件大小；宿主未授权或接口不可用时返回 null（界面显示「大小未识别」），不填默认值 */
export async function readImageFileSize(filePath: string, hostOverride?: unknown): Promise<number | null> {
  const res = await callHostTransport<unknown>('filesystem_get_file_size', { path: filePath }, hostOverride)
  if (!res.ok) return null
  const data = res.data as unknown
  const size =
    typeof data === 'number'
      ? data
      : data && typeof data === 'object'
        ? Number((data as { size?: unknown }).size)
        : NaN
  return Number.isFinite(size) && size >= 0 ? size : null
}

/** 从文件选择框或路径列表中提取合法的图片绝对路径 */
export function extractSelectedImagePaths(raw: unknown, limit = 200): string[] {
  if (!raw || typeof raw !== 'object') return []
  const record = raw as Record<string, unknown>
  if (record.canceled === true) return []
  const lines: string[] = []
  if (typeof record.filePath === 'string') {
    lines.push(record.filePath)
  }
  if (Array.isArray(record.filePaths)) {
    for (const item of record.filePaths) {
      if (typeof item === 'string') {
        lines.push(item)
      } else if (item && typeof item === 'object' && typeof (item as { path?: unknown }).path === 'string') {
        lines.push((item as { path: string }).path)
      }
    }
  }
  return parseClipboardImagePaths(lines.join('\n'), limit)
}

/** 从宿主 plugin_files_dropped 事件载荷中提取合法的图片绝对路径 */
export function extractDroppedImagePaths(envelopeOrPayload: unknown, limit = 200): string[] {
  if (!envelopeOrPayload || typeof envelopeOrPayload !== 'object') return []
  const obj = envelopeOrPayload as Record<string, unknown>
  const innerPayload =
    obj.payload && typeof obj.payload === 'object' ? (obj.payload as Record<string, unknown>) : obj
  const rawFiles = Array.isArray(innerPayload.files)
    ? innerPayload.files
    : Array.isArray(obj.files)
      ? obj.files
      : []
  return extractSelectedImagePaths({ canceled: false, filePaths: rawFiles }, limit)
}

/** 从系统剪贴板读取直接复制的图片文件列表（clipboard_read_files） */
export async function readClipboardImageFilePaths(hostOverride?: unknown): Promise<string[]> {
  const res = await callHostTransport<unknown>('clipboard_read_files', {}, hostOverride)
  if (!res.ok || !res.data) return []
  const data = res.data as Record<string, unknown> | unknown[]
  const list = Array.isArray(data)
    ? data
    : Array.isArray((data as { files?: unknown }).files)
      ? ((data as { files: unknown[] }).files)
      : []
  return extractSelectedImagePaths({ canceled: false, filePaths: list })
}

let imageItemSeq = 0

/** 由路径构造队列项；大小由调用方传入（读不到时为 null） */
export function makeImageItem(id: string, filePath: string, sizeBytes: number | null, parentDirOverride?: string): RealImageFileItem {
  const { dir, fileName, ext } = splitPath(filePath)
  return {
    id,
    name: fileName,
    path: filePath,
    parentDir: parentDirOverride ?? dir,
    extension: ext,
    sizeBytes
  }
}

/** 把共享导入模块返回的文件转为图片队列项，使用单调递增编号防止移除后重加发生 id 冲突 */
export function toImageItem(file: ImportedFile): RealImageFileItem {
  imageItemSeq += 1
  return makeImageItem(`img-${imageItemSeq}-${file.path}`, file.path, file.sizeBytes, file.parentDir)
}

export async function openImageFileLocation(filePath: string, hostOverride?: unknown): Promise<boolean> {
  return showRealItemInFolder(filePath, hostOverride)
}

export async function trashImageFileItem(
  filePath: string,
  hostOverride?: unknown
): Promise<{ ok: boolean; error?: string }> {
  if (!filePath || FORBIDDEN_TARGET_PATTERN.test(filePath)) {
    return { ok: false, error: t('forbiddenReason') }
  }
  return trashRealItem(filePath, hostOverride)
}

/** 结果状态的短标签（列表行右侧） */
export function describeOutcomeTag(result: ImageProcessOutcome | undefined): string {
  if (!result) return t('tagPending')
  if (result.status === 'failed') return t('tagFailed')
  if (result.overLimitBytes !== null) return t('tagOverLimit', { size: formatBytes(result.overLimitBytes) })
  if (result.notSmaller) return t('tagNotSmaller', { size: formatBytes(result.outputBytes) })
  const pct =
    result.originalBytes !== null && result.originalBytes > 0
      ? ` (-${Math.round(((result.originalBytes - result.outputBytes) / result.originalBytes) * 100)}%)`
      : ''
  return t('tagOutput', { size: formatBytes(result.outputBytes), pct })
}

/** 结果说明（列表行副标题） */
export function describeOutcomeDetail(result: ImageProcessOutcome | undefined, parentDir: string): string {
  if (!result) return parentDir
  if (result.status === 'failed') return t('detailFailed', { error: result.error })
  const outName = splitPath(result.outputPath).fileName
  const dims = result.width > 0 && result.height > 0 ? `${result.width}×${result.height}` : t('dimsUnknown')
  return t('detailOutput', { name: outName, dims })
}
