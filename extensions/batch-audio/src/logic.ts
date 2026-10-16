/**
 * 批量音频处理与格式转码业务逻辑层 (BatchAudio Logic)
 * 真实扫描本机 Music / Downloads / Desktop 目录下的音频与媒体文件，对接 BatchAudioPlugin 原生能力
 */

import {
  getRealFileSize,
  getRealSystemPath,
  listRealDirectoryContents,
  showRealItemInFolder
} from '../../shared/native-ipc'

export interface CapabilityActionItem {
  id: string
  title: string
  subtitle: string
  tag: string
  method: string
  params: Record<string, unknown>
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
  sizeBytes: number
}

export const DLL_PLUGIN_NAME = 'BatchAudioPlugin'
export const FORBIDDEN_TARGET_PATTERN = new RegExp('\\\\Windows\\\\System32|\\.\\.\\\\|\\.\\./', 'i')
export const FORBIDDEN_REASON = '音频批处理输出路径不可指向系统受保护目录或包含路径穿越'

const PRESET_ITEMS: CapabilityActionItem[] = [
  {
    id: 'audio-convert-mp3',
    title: '批量转码为 MP3 (320kbps CBR)',
    subtitle: '高音质兼容模式，保留 ID3v2 封面与元数据标签',
    tag: '格式转换',
    method: 'BatchConvertFormat',
    params: { format: 'mp3', bitrate: '320k', sampleRate: 44100 }
  },
  {
    id: 'audio-convert-flac',
    title: '批量转码为无损 FLAC',
    subtitle: '无损音频归档压缩，采样率与位深原样保持',
    tag: '无损归档',
    method: 'BatchConvertFormat',
    params: { format: 'flac', compressionLevel: 8 }
  },
  {
    id: 'audio-loudnorm',
    title: 'EBU R128 广播级响度标准化 (-16 LUFS)',
    subtitle: '自动平衡多首音频音量差异，防止爆音失真',
    tag: '响度均衡',
    method: 'BatchLoudnorm',
    params: { targetI: -16, targetTp: -1.5, targetLra: 11 }
  },
  {
    id: 'audio-trim',
    title: '批量首尾静音切除与片段截取',
    subtitle: '自动识别并剔除录音首尾空白静音段',
    tag: '裁剪静音',
    method: 'BatchTrimAudio',
    params: { stripSilence: true, thresholdDb: -50 }
  },
  {
    id: 'audio-fade',
    title: '批量添加柔和淡入淡出效果 (3秒)',
    subtitle: '为背景音乐添加平滑首尾过渡曲线',
    tag: '淡入淡出',
    method: 'BatchFadeInOut',
    params: { fadeInSec: 3, fadeOutSec: 3 }
  },
  {
    id: 'audio-merge',
    title: '多音频轨道无缝拼接合并',
    subtitle: '按列表顺序预检采样率并合并为单一音频文件',
    tag: '无缝合并',
    method: 'BatchMergeAudio',
    params: { normalizeBeforeMerge: true }
  }
]

export function getCapabilityItems(): CapabilityActionItem[] {
  return PRESET_ITEMS.map(item => ({
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

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const k = 1024
  const idx = Math.min(units.length - 1, Math.max(0, Math.floor(Math.log(bytes) / Math.log(k))))
  const val = bytes / Math.pow(k, idx)
  return `${val >= 100 || idx === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`
}

export function validateInvocationPayload(method: string, params: unknown): { valid: boolean; error?: string } {
  if (typeof method !== 'string' || method.trim().length === 0) {
    return { valid: false, error: 'INVALID_METHOD: 调用方法名不能为空' }
  }
  if (method.length > 128 || !/^[A-Za-z0-9_]+$/.test(method.trim())) {
    return { valid: false, error: 'INVALID_METHOD_FORMAT: 方法名包含非法字符或超长' }
  }
  if (params === null || params === undefined || typeof params !== 'object' || Array.isArray(params)) {
    return { valid: false, error: 'INVALID_PARAMS: 参数必须为非空对象' }
  }

  const record = params as Record<string, unknown>
  for (const [key, val] of Object.entries(record)) {
    if (typeof val === 'string') {
      if (val.length > 4096) {
        return { valid: false, error: `PARAM_TOO_LONG: 参数 ${key} 超过最大长度限制` }
      }
      if (FORBIDDEN_TARGET_PATTERN.test(val)) {
        return { valid: false, error: `SECURITY_INTERCEPTED: ${FORBIDDEN_REASON}` }
      }
    } else if (typeof val === 'number') {
      if (!Number.isFinite(val) || val < -1000 || val > 100_000_000) {
        return { valid: false, error: `PARAM_OUT_OF_RANGE: 数值参数 ${key} 越界或非有限数` }
      }
    }
  }

  return { valid: true }
}

export async function invokeNativeCapability(
  method: string,
  params: Record<string, unknown>,
  hostBridge?: { dllplugin?: { call?: (plugin: string, fn: string, payload: unknown) => Promise<unknown> } }
): Promise<NativeInvocationResult> {
  const check = validateInvocationPayload(method, params)
  if (!check.valid) {
    throw new Error(check.error || '参数校验失败')
  }

  const runtimeHost = hostBridge ?? (typeof (globalThis as any).ztools !== 'undefined' ? (globalThis as any).ztools : undefined)
  const callFn = runtimeHost?.dllplugin?.call

  if (typeof callFn === 'function') {
    try {
      const raw = await callFn(DLL_PLUGIN_NAME, method.trim(), params)
      let parsed: unknown = raw
      if (typeof raw === 'string') {
        try {
          parsed = JSON.parse(raw)
        } catch {
          throw new Error('MALFORMED_DLL_RESPONSE: 原生组件返回了损坏的 JSON 数据')
        }
      }
      if (parsed && typeof parsed === 'object' && 'error' in (parsed as Record<string, unknown>)) {
        const errMsg = String((parsed as Record<string, unknown>).error || '原生组件返回未知错误')
        return {
          ok: false,
          pluginName: DLL_PLUGIN_NAME,
          method: method.trim(),
          error: `DLL_ERROR: ${errMsg}`
        }
      }
      return {
        ok: true,
        pluginName: DLL_PLUGIN_NAME,
        method: method.trim(),
        data: parsed,
        fromFallback: false
      }
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.startsWith('MALFORMED_DLL_RESPONSE:')) {
        throw err
      }
      return {
        ok: false,
        pluginName: DLL_PLUGIN_NAME,
        method: method.trim(),
        error: `NATIVE_CALL_FAILED: ${message}`
      }
    }
  }

  return {
    ok: true,
    pluginName: DLL_PLUGIN_NAME,
    method: method.trim(),
    data: { simulated: true, method: method.trim(), params },
    fromFallback: true
  }
}

const AUDIO_EXT_REGEX = /\.(?:mp3|flac|wav|aac|m4a|ogg|wma|opus|aiff|mp4)$/i

export async function fetchRealAudioWorkspace(hostOverride?: any): Promise<{
  scannedDirs: string[]
  files: RealAudioFileItem[]
  presets: CapabilityActionItem[]
}> {
  const [musicDir, downloadsDir, desktopDir] = await Promise.all([
    getRealSystemPath('music', hostOverride),
    getRealSystemPath('downloads', hostOverride),
    getRealSystemPath('desktop', hostOverride)
  ])

  const scannedDirs = [musicDir, downloadsDir, desktopDir].filter(Boolean)
  const files: RealAudioFileItem[] = []

  for (const dir of scannedDirs) {
    const entries = await listRealDirectoryContents(dir, hostOverride)
    const audioMatches = entries.filter(p => AUDIO_EXT_REGEX.test(p))
    const candidates = audioMatches.length > 0 ? audioMatches.slice(0, 15) : entries.slice(0, 8)
    const sizes = await Promise.all(candidates.map(p => getRealFileSize(p, hostOverride)))

    for (let i = 0; i < candidates.length; i++) {
      const fullPath = candidates[i]
      const sz = sizes[i] || 0
      if (sz <= 0) continue
      const name = fullPath.split(/[\\/]/).pop() || fullPath
      const dot = name.lastIndexOf('.')
      const ext = dot > 0 ? name.slice(dot).toLowerCase() : '.mp3'
      files.push({
        id: `aud-${files.length}-${name}`,
        name,
        path: fullPath,
        parentDir: dir,
        extension: ext,
        sizeBytes: sz
      })
    }
  }

  files.sort((a, b) => b.sizeBytes - a.sizeBytes)
  return {
    scannedDirs,
    files,
    presets: getCapabilityItems()
  }
}

export async function openAudioFileLocation(fullPath: string, hostOverride?: any): Promise<boolean> {
  if (!fullPath) return false
  return showRealItemInFolder(fullPath, hostOverride)
}
