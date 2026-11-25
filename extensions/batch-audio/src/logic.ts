/**
 * 批量音频转换、响度标准化与音效工坊业务逻辑层 (BatchAudio 2.0 Logic)
 * 通过 Windows 原生插件提供 12 大核心音频批处理能力
 * 音频由用户通过选择文件、选择文件夹或拖入导入，对接 BatchAudioPlugin 与 FFmpeg 声学滤镜链
 */

import { getHostTransport } from '@ztools/declarative-ui'
import {
  callHostTransport,
  invokeDllPluginCapability,
  showRealItemInFolder
} from './native-ipc.js'
import {
  collectFolderFiles,
  friendlyFileError,
  isVolumeRoot,
  pickFolder
} from './file-import.js'
import type { FileImportOptions, FileImportResult, FileImportRules, FileImportTransport, ImportedFile } from './file-import.js'
import { t } from './i18n.js'
import { resolveErrorMessage } from './error-i18n.js'

export { formatBytes } from './native-ipc.js'

export interface CapabilityActionItem {
  id: string
  title: string
  subtitle: string
  tag: string
  method: string
  params: Record<string, unknown>
  ffmpegFilter?: string
}

export interface NativeInvocationResult {
  ok: boolean
  pluginName: string
  method: string
  data?: unknown
  error?: string
  fromFallback?: boolean
}

export interface RealAudioFileItem {
  id: string
  name: string
  path: string
  parentDir: string
  extension: string
  /** 字节数；宿主未授权读取或不可用时为 null（界面显示「大小未识别」） */
  sizeBytes: number | null
}

export const DLL_PLUGIN_NAME = 'BatchAudioPlugin'
export const FORBIDDEN_TARGET_PATTERN = /(?:^|[\\/])Windows[\\/]System32(?:[\\/]|$)|(?:^|[\\/])\.\.(?:[\\/]|$)/i
export function getForbiddenReason(): string {
  return t('forbiddenReason')
}
/** 合并模式（BatchMergeAudio）宿主上限：单次最多 100 个文件、总大小 2 GiB */
export const MERGE_MAX_FILES = 100
export const MERGE_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024
export function getMergeLimitError(): string {
  return t('mergeLimitError')
}

/**
 * 通过 Windows 原生插件提供 12 大核心音频处理模式
 */
export function getAudioWorkshopModes(): CapabilityActionItem[] {
  return [
    {
      id: 'audio-convert-mp3',
      title: t('mode01Title'),
      subtitle: t('mode01Sub'),
      tag: t('mode01Tag'),
      method: 'BatchConvertFormat',
      params: { format: 'mp3', bitrate: '320k', sampleRate: 44100 },
      ffmpegFilter: '-c:a libmp3lame -b:a 320k -ar 44100'
    },
    {
      id: 'audio-convert-flac',
      title: t('mode02Title'),
      subtitle: t('mode02Sub'),
      tag: t('mode02Tag'),
      method: 'BatchConvertFormat',
      params: { format: 'flac', compressionLevel: 8 },
      ffmpegFilter: '-c:a flac -compression_level 8'
    },
    {
      id: 'audio-loudnorm',
      title: t('mode03Title'),
      subtitle: t('mode03Sub'),
      tag: t('mode03Tag'),
      method: 'BatchLoudnorm',
      params: { targetI: -16, targetTp: -1.5, targetLra: 11 },
      ffmpegFilter: '-af "loudnorm=I=-16:TP=-1.5:LRA=11"'
    },
    {
      id: 'audio-gain',
      title: t('mode04Title'),
      subtitle: t('mode04Sub'),
      tag: t('mode04Tag'),
      method: 'BatchAdjustVolume',
      params: { gainDb: 3.5 },
      ffmpegFilter: '-af "volume=3.5dB"'
    },
    {
      id: 'audio-silence',
      title: t('mode05Title'),
      subtitle: t('mode05Sub'),
      tag: t('mode05Tag'),
      method: 'BatchTrimAudio',
      params: { stripSilence: true, thresholdDb: -50 },
      ffmpegFilter: '-af "silenceremove=start_periods=1:start_silence=0.3:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_silence=0.3:start_threshold=-50dB,areverse"'
    },
    {
      id: 'audio-trim-ends',
      title: t('mode06Title'),
      subtitle: t('mode06Sub'),
      tag: t('mode06Tag'),
      method: 'BatchTrimDuration',
      params: { skipStartSec: 2, skipEndSec: 2 },
      ffmpegFilter: '-ss 00:00:02 -c:a copy'
    },
    {
      id: 'audio-fade',
      title: t('mode07Title'),
      subtitle: t('mode07Sub'),
      tag: t('mode07Tag'),
      method: 'BatchFadeInOut',
      params: { fadeInSec: 3, fadeOutSec: 3 },
      ffmpegFilter: '-af "afade=t=in:st=0:d=3,afade=t=out:st=180:d=3"'
    },
    {
      id: 'audio-eq-vocal',
      title: t('mode08Title'),
      subtitle: t('mode08Sub'),
      tag: t('mode08Tag'),
      method: 'BatchEqualizer',
      params: { preset: 'vocal_clarity', lowCutHz: 90, boost3kHzDb: 4 },
      ffmpegFilter: '-af "highpass=f=90,equalizer=f=3000:width_type=q:w=1.2:g=4"'
    },
    {
      id: 'audio-compressor',
      title: t('mode09Title'),
      subtitle: t('mode09Sub'),
      tag: t('mode09Tag'),
      method: 'BatchCompressor',
      params: { thresholdDb: -18, ratio: 4, attackMs: 20, releaseMs: 250 },
      ffmpegFilter: '-af "acompressor=threshold=-18dB:ratio=4:attack=20:release=250"'
    },
    {
      id: 'audio-denoise',
      title: t('mode10Title'),
      subtitle: t('mode10Sub'),
      tag: t('mode10Tag'),
      method: 'BatchDenoise',
      params: { noiseReductionDb: 14, noiseFloorDb: -45 },
      ffmpegFilter: '-af "afftdn=nr=14:nf=-45"'
    },
    {
      id: 'audio-merge',
      title: t('mode11Title'),
      subtitle: t('mode11Sub'),
      tag: t('mode11Tag'),
      method: 'BatchMergeAudio',
      params: { normalizeBeforeMerge: true },
      ffmpegFilter: '-filter_complex "concat=n=2:v=0:a=1"'
    },
    {
      id: 'audio-id3',
      title: t('mode12Title'),
      subtitle: t('mode12Sub'),
      tag: t('mode12Tag'),
      method: 'BatchWriteMetadata',
      params: { artist: 'ZTools Audio Studio', year: '2026' },
      ffmpegFilter: '-metadata artist="ZTools Audio Studio" -metadata date="2026"'
    }
  ]
}

export function getCapabilityItems(): CapabilityActionItem[] {
  return getAudioWorkshopModes().map(item => ({
    ...item,
    params: { ...item.params }
  }))
}

export function filterCapabilityItems(items: CapabilityActionItem[], query: string): CapabilityActionItem[] {
  if (!Array.isArray(items)) return []
  const q = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (!q) return items
  return items.filter(item => {
    if (!item || typeof item.title !== 'string') return false
    return (
      item.title.toLowerCase().includes(q) ||
      item.subtitle.toLowerCase().includes(q) ||
      item.tag.toLowerCase().includes(q) ||
      item.method.toLowerCase().includes(q)
    )
  })
}

const AUDIO_METHODS = new Set([
  'BatchConvertFormat',
  'BatchLoudnorm',
  'BatchAdjustVolume',
  'BatchTrimAudio',
  'BatchTrimDuration',
  'BatchFadeInOut',
  'BatchEqualizer',
  'BatchCompressor',
  'BatchDenoise',
  'BatchMergeAudio',
  'BatchWriteMetadata'
])

function isAudioPath(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 4096 &&
    !value.includes('\0') && /^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+|\/)/.test(value) &&
    !/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(value)
}

/** 这里只接受音频处理契约；数值滤镜范围由实际执行它的宿主统一校验。 */
export function validateInvocationPayload(method: string, params: unknown): { valid: boolean; error?: string } {
  const reject = (error: string) => ({ valid: false, error })
  if (!AUDIO_METHODS.has(method)) return reject(t('errInvalidMethod'))
  if (!params || typeof params !== 'object' || Array.isArray(params)) return reject(t('errInvalidParams'))
  const record = params as Record<string, unknown>
  const inputs = record.files === undefined ? [record.inputPath] : record.files
  if (!Array.isArray(inputs) || !inputs.length) return reject(t('errInvalidFilesEmpty'))
  for (const input of inputs) {
    if (!isAudioPath(input)) return reject(t('errInvalidFilesPath'))
  }
  if (method === 'BatchMergeAudio' && inputs.length < 2) return reject(t('errMergeMinFiles'))
  if (method === 'BatchMergeAudio' && inputs.length > MERGE_MAX_FILES) return reject(`INVALID_FILES: ${t('mergeLimitError')}`)
  for (const key of ['outputDir', 'outputPath']) {
    if (record[key] === undefined) continue
    if (!isAudioPath(record[key])) return reject(t('errInvalidOutputPath', { key }))
    if (FORBIDDEN_TARGET_PATTERN.test(record[key])) return reject(`SECURITY_INTERCEPTED: ${t('forbiddenReason')}`)
  }
  if (record.outputPath !== undefined && inputs.length > 1 && method !== 'BatchMergeAudio') {
    return reject(t('errMultiOutputSingle'))
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
    throw new Error(resolveErrorMessage(check, t('errValidationFailed')))
  }
  const transport = hostBridge ? null : getHostTransport()
  if (transport) {
    try {
      const raw = await transport.call<Record<string, unknown>>('dllplugin_call', {
        plugin: DLL_PLUGIN_NAME, func: method, params
      }, { timeoutMs: 300_000 })
      const data = raw?.data && typeof raw.data === 'object' ? raw.data as Record<string, unknown> : raw
      const ok = data?.ok === true && data.success !== false
      return { ok, pluginName: DLL_PLUGIN_NAME, method, data, fromFallback: false,
        ...(ok ? {} : { error: String(resolveErrorMessage(data, t('errHostUnconfirmed'))) }) }
    } catch (err) {
      return { ok: false, pluginName: DLL_PLUGIN_NAME, method, error: err instanceof Error ? err.message : String(err) }
    }
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

export interface AudioBatchResult {
  completed: number
  failed: number
  outputs: string[]
  errors: string[]
}

/**
 * 合并模式执行前预检：单次最多 100 个文件、总计 2 GiB；
 * 未知大小（null）计入文件数量，不计入已知体积总量。
 */
export function checkMergeAudioLimits(
  files: ReadonlyArray<Pick<RealAudioFileItem, 'sizeBytes'>>
): string | null {
  if (files.length > MERGE_MAX_FILES) return t('mergeLimitError')
  let knownBytes = 0
  for (const file of files) {
    if (typeof file.sizeBytes === 'number' && Number.isFinite(file.sizeBytes) && file.sizeBytes >= 0) {
      knownBytes += file.sizeBytes
    }
  }
  if (knownBytes > MERGE_MAX_TOTAL_BYTES) return t('mergeLimitError')
  return null
}

/** 合并一次提交全部输入；独立任务逐个记录回执，支持跳过处理中移除的条目，部分失败不冒充全部完成。 */
export async function processAudioSelection(
  method: string,
  params: Record<string, unknown>,
  files: RealAudioFileItem[],
  hostOverride?: unknown,
  options: {
    shouldSkip?: (id: string) => boolean
    onStart?: (ids: string[]) => void
    onDone?: (ids: string[]) => void
  } = {}
): Promise<AudioBatchResult> {
  const result: AudioBatchResult = { completed: 0, failed: 0, outputs: [], errors: [] }
  const merge = method === 'BatchMergeAudio'
  if (!files.length || (merge && files.length < 2)) {
    return { ...result, failed: files.length || 1, errors: [t('errMinAudioForRun')] }
  }
  if (merge) {
    const limitError = checkMergeAudioLimits(files)
    if (limitError) {
      return { ...result, failed: files.length, errors: [limitError] }
    }
  }
  const groups = merge ? [files] : files.map(file => [file])
  for (const group of groups) {
    if (!merge && group.every(file => options.shouldSkip?.(file.id))) continue
    const groupIds = group.map(file => file.id)
    options.onStart?.(groupIds)
    try {
      const res = await invokeNativeCapability(method, { ...params, files: group.map(file => file.path) }, hostOverride)
      const data = res.data as { results?: Array<{ outputPath?: unknown; sizeBytes?: unknown }>; errors?: unknown[] } | undefined
      const output = data?.results?.[0]
      if (!res.ok || data?.errors?.length || !output || typeof output.outputPath !== 'string' || !output.outputPath.trim() || !(Number(output.sizeBytes) > 0)) {
        throw new Error(friendlyFileError(resolveErrorMessage(res, t('errNoValidOutput'))))
      }
      result.completed += group.length
      result.outputs.push(output.outputPath)
    } catch (err) {
      result.failed += group.length
      result.errors.push(
        t('errItemPrefix', {
          names: group.map(file => file.name).join(t('errItemJoinSep')),
          msg: friendlyFileError(err)
        })
      )
    } finally {
      options.onDone?.(groupIds)
    }
  }
  return result
}

export const AUDIO_IMPORT_EXTENSIONS = ['.mp3', '.flac', '.wav', '.aac', '.m4a', '.ogg', '.wma', '.opus', '.aiff'] as const
export const AUDIO_EXT_REGEX = /\.(?:mp3|flac|wav|aac|m4a|ogg|wma|opus|aiff)$/i
export const AUDIO_IMPORT_SUPPORTED_TEXT = 'MP3 / FLAC / WAV / AAC / M4A / OGG / WMA / OPUS / AIFF'

/** 音频导入规则：递归 5 层、最多 500 个文件、跳过系统保护目录 */
export const AUDIO_IMPORT_RULES: FileImportRules = {
  extensions: AUDIO_IMPORT_EXTENSIONS,
  forbiddenPath: FORBIDDEN_TARGET_PATTERN
}

/** 把宿主调用包装为共享导入模块所需的 transport */
export function createAudioImportTransport(hostOverride?: unknown): FileImportTransport {
  return (method, params) => callHostTransport<unknown>(method, params, hostOverride)
}

/** 选择文件夹并收集音频（选中整个磁盘根目录时先请用户确认） */
export async function pickAudioFolderWithConfirm(
  transport: FileImportTransport,
  confirmVolumeRoot: (folderPath: string) => Promise<boolean>,
  options: FileImportOptions = {}
): Promise<FileImportResult> {
  const picked = await pickFolder(transport, { title: t('pickFolderTitle') })
  if (options.signal?.aborted || picked.canceled) {
    return { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: true }
  }
  if (picked.error || !picked.folderPath) {
    return { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: false, error: resolveErrorMessage(picked, t('noFolderSelected')) }
  }
  if (isVolumeRoot(picked.folderPath)) {
    const confirmed = await confirmVolumeRoot(picked.folderPath)
    if (options.signal?.aborted || !confirmed) {
      return { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: true }
    }
  }
  return collectFolderFiles(transport, picked.folderPath, AUDIO_IMPORT_RULES, options)
}

function splitAudioPath(filePath: string): { dir: string; fileName: string; ext: string } {
  const sepIdx = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'))
  const dir = sepIdx >= 0 ? filePath.slice(0, sepIdx) : ''
  const fileName = sepIdx >= 0 ? filePath.slice(sepIdx + 1) : filePath
  const dot = fileName.lastIndexOf('.')
  const ext = dot > 0 ? fileName.slice(dot).toLowerCase() : '.mp3'
  return { dir, fileName, ext }
}

let audioItemSeq = 0

/** 从路径构造音频队列项 */
export function makeAudioItem(
  id: string,
  filePath: string,
  sizeBytes: number | null,
  parentDirOverride?: string
): RealAudioFileItem {
  const { dir, fileName, ext } = splitAudioPath(filePath)
  return {
    id,
    name: fileName,
    path: filePath,
    parentDir: parentDirOverride ?? dir,
    extension: ext,
    sizeBytes: typeof sizeBytes === 'number' && Number.isFinite(sizeBytes) && sizeBytes >= 0 ? sizeBytes : null
  }
}

/** 把共享导入结果转为音频队列项 */
export function toAudioItem(file: ImportedFile): RealAudioFileItem {
  audioItemSeq += 1
  return makeAudioItem(`aud-${audioItemSeq}-${file.path}`, file.path, file.sizeBytes, file.parentDir)
}

export async function openAudioFileLocation(fullPath: string, hostOverride?: unknown): Promise<boolean> {
  if (!fullPath) return false
  return showRealItemInFolder(fullPath, hostOverride)
}
