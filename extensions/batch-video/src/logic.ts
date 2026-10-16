/**
 * 批量视频转码与压缩工作台业务逻辑层 (BatchVideo Logic)
 * 真实扫描本机 Videos / Downloads / Desktop 目录下的视频媒体文件，对接 BatchVideoPlugin 与 FFmpeg 转码管线
 */

import {
  callHostTransport,
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

export interface RealVideoFileItem {
  id: string
  name: string
  path: string
  parentDir: string
  extension: string
  sizeBytes: number
  estimatedCompressedBytes: number
}

export const DLL_PLUGIN_NAME = 'BatchVideoPlugin'
export const FORBIDDEN_TARGET_PATTERN = new RegExp('\\\\Windows\\\\System32|\\.\\.\\\\|\\.\\./', 'i')
export const FORBIDDEN_REASON = '视频批处理输出路径不可指向系统受保护目录或包含路径穿越'

const PRESET_ITEMS: CapabilityActionItem[] = [
  {
    id: 'video-compress-crf23',
    title: 'H.264 智能体积瘦身压缩 (CRF 23)',
    subtitle: '视觉无损压缩，平均减少 50%~70% 视频文件体积',
    tag: '智能瘦身',
    method: 'BatchCompressVideo',
    params: { crf: 23, preset: 'medium', codec: 'libx264' }
  },
  {
    id: 'video-convert-mp4',
    title: '批量封装/转码为标准 MP4',
    subtitle: '将 MKV/MOV/AVI/FLV 统一转为全平台兼容 MP4',
    tag: '格式转换',
    method: 'BatchConvertFormat',
    params: { format: 'mp4', faststart: true }
  },
  {
    id: 'video-crop-9-16',
    title: '批量裁剪为竖屏短视频画幅 (9:16)',
    subtitle: '适配抖音/视频号/Reels 竖屏中心构图裁剪',
    tag: '画幅裁剪',
    method: 'BatchCropByRatio',
    params: { ratio: '9:16' }
  },
  {
    id: 'video-watermark',
    title: '批量叠加防盗版图片/文字水印',
    subtitle: '支持四角锚点定位与透明度批量合成',
    tag: '批量水印',
    method: 'BatchAddWatermark',
    params: { position: 'bottom-right', opacity: 0.85 }
  },
  {
    id: 'video-to-gif',
    title: '批量提取精华片段转高清 GIF',
    subtitle: '使用全局调色板生成低体积高帧率 GIF 动图',
    tag: '转 GIF',
    method: 'BatchConvertToGif',
    params: { fps: 15, width: 480 }
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

const VIDEO_EXT_REGEX = /\.(?:mp4|mkv|mov|avi|flv|webm|wmv|ts|m4v|gif)$/i

/**
 * 扫描本机 Videos / Downloads / Desktop 目录下的真实视频文件（若无视频则展示目录内可处理媒体样本）
 */
export async function fetchRealVideoWorkspace(hostOverride?: any): Promise<{
  scannedDirs: string[]
  files: RealVideoFileItem[]
  presets: CapabilityActionItem[]
}> {
  const [videosDir, downloadsDir, desktopDir] = await Promise.all([
    getRealSystemPath('videos', hostOverride),
    getRealSystemPath('downloads', hostOverride),
    getRealSystemPath('desktop', hostOverride)
  ])

  const scannedDirs = [videosDir, downloadsDir, desktopDir].filter(Boolean)
  const files: RealVideoFileItem[] = []

  for (const dir of scannedDirs) {
    const entries = await listRealDirectoryContents(dir, hostOverride)
    const videoMatches = entries.filter(p => VIDEO_EXT_REGEX.test(p))
    const candidates = videoMatches.length > 0 ? videoMatches.slice(0, 15) : entries.slice(0, 8)
    const sizes = await Promise.all(candidates.map(p => getRealFileSize(p, hostOverride)))

    for (let i = 0; i < candidates.length; i++) {
      const fullPath = candidates[i]
      const sz = sizes[i] || 0
      if (sz <= 0) continue
      const name = fullPath.split(/[\\/]/).pop() || fullPath
      const dot = name.lastIndexOf('.')
      const ext = dot > 0 ? name.slice(dot).toLowerCase() : '.mp4'
      files.push({
        id: `vid-${files.length}-${name}`,
        name,
        path: fullPath,
        parentDir: dir,
        extension: ext,
        sizeBytes: sz,
        estimatedCompressedBytes: Math.round(sz * 0.42)
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

export async function openVideoFileLocation(fullPath: string, hostOverride?: any): Promise<boolean> {
  if (!fullPath) return false
  return showRealItemInFolder(fullPath, hostOverride)
}
