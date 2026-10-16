/**
 * PDF 多功能转换与合并工作台业务逻辑层 (Pdf Logic)
 * 真实扫描本机 Documents / Downloads / Desktop 目录下的 PDF 与办公文档，对接 PdfPlugin 与 image_to_pdf 宿主能力
 */

import {
  callHostTransport,
  getRealFileSize,
  getRealSystemPath,
  listRealDirectoryContents,
  openRealPath,
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

export interface RealPdfDocItem {
  id: string
  name: string
  path: string
  parentDir: string
  extension: string
  sizeBytes: number
  estimatedPages: number
}

export const DLL_PLUGIN_NAME = 'PdfPlugin'
export const FORBIDDEN_TARGET_PATTERN = new RegExp('\\\\Windows\\\\System32|\\.\\.\\\\|\\.\\./', 'i')
export const FORBIDDEN_REASON = 'PDF 转换输出路径禁止包含目录穿越或覆盖系统核心目录'

const PRESET_ITEMS: CapabilityActionItem[] = [
  {
    id: 'pdf-to-word',
    title: 'PDF 转可编辑 Word 文档 (.docx)',
    subtitle: '精准保留原始段落排版、字体样式、内嵌图片与表格结构',
    tag: '转 Word',
    method: 'PdfToWord',
    params: { preserveLayout: true }
  },
  {
    id: 'pdf-to-excel',
    title: 'PDF 财务/数据表提取转 Excel (.xlsx)',
    subtitle: '自动识别跨页表格边框并生成标准工作表',
    tag: '转 Excel',
    method: 'PdfToExcel',
    params: { mergeSheets: false }
  },
  {
    id: 'pdf-to-image',
    title: 'PDF 逐页导出为 300DPI 高清 PNG 图片',
    subtitle: '适合制作演示文稿素材或移动端长图阅读',
    tag: '转高清图',
    method: 'PdfToImage',
    params: { dpi: 300, format: 'png' }
  },
  {
    id: 'word-to-pdf',
    title: 'Office Word/Excel/PPT 批量转标准 PDF',
    subtitle: '嵌入字体子集，确保跨设备打印与审阅版式零偏差',
    tag: '转 PDF',
    method: 'WordToPdf',
    params: { standard: 'PDF/A-1b' }
  },
  {
    id: 'pdf-merge',
    title: '多份 PDF 文档无损合并与书签保留',
    subtitle: '按指定顺序合并多个 PDF 文件并自动生成目录树',
    tag: '文档合并',
    method: 'MergePdf',
    params: { keepBookmarks: true }
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

const PDF_DOC_EXT_REGEX = /\.(?:pdf|docx|doc|xlsx|xls|pptx|ppt|md|txt|png|jpg|jpeg)$/i

export async function fetchRealPdfWorkspace(hostOverride?: any): Promise<{
  scannedDirs: string[]
  files: RealPdfDocItem[]
  presets: CapabilityActionItem[]
}> {
  const [documentsDir, downloadsDir, desktopDir] = await Promise.all([
    getRealSystemPath('documents', hostOverride),
    getRealSystemPath('downloads', hostOverride),
    getRealSystemPath('desktop', hostOverride)
  ])

  const scannedDirs = [documentsDir, downloadsDir, desktopDir].filter(Boolean)
  const files: RealPdfDocItem[] = []

  for (const dir of scannedDirs) {
    const entries = await listRealDirectoryContents(dir, hostOverride)
    const docMatches = entries.filter(p => PDF_DOC_EXT_REGEX.test(p))
    const candidates = docMatches.length > 0 ? docMatches.slice(0, 15) : entries.slice(0, 8)
    const sizes = await Promise.all(candidates.map(p => getRealFileSize(p, hostOverride)))

    for (let i = 0; i < candidates.length; i++) {
      const fullPath = candidates[i]
      const sz = sizes[i] || 0
      if (sz <= 0) continue
      const name = fullPath.split(/[\\/]/).pop() || fullPath
      const dot = name.lastIndexOf('.')
      const ext = dot > 0 ? name.slice(dot).toLowerCase() : '.pdf'
      files.push({
        id: `pdf-${files.length}-${name}`,
        name,
        path: fullPath,
        parentDir: dir,
        extension: ext,
        sizeBytes: sz,
        estimatedPages: Math.max(1, Math.round(sz / (64 * 1024)))
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

export async function openPdfFileLocation(fullPath: string, hostOverride?: any): Promise<boolean> {
  if (!fullPath) return false
  return showRealItemInFolder(fullPath, hostOverride)
}

export async function openPdfDocument(fullPath: string, hostOverride?: any): Promise<boolean> {
  if (!fullPath) return false
  return openRealPath(fullPath, hostOverride)
}
