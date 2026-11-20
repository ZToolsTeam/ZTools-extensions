/**
 * PDF 工具箱业务逻辑层
 *
 * - 用户通过「选择文件」「选择文件夹」或拖入导入 PDF（不在启动时扫描任何本机目录）
 * - 调用客户端的 PDF 处理接口，把 PDF 中可读取的文字导出为 TXT / HTML
 * - 输出文件写在 PDF 所在目录，写之前先确认同名文件不存在，已存在时自动加序号，绝不覆盖
 *
 * 格式互转、合并、拆分、压缩、加解密在当前客户端没有可靠实现：工具定义保留（supported: false），
 * 界面不展示，调用时直接拒绝，不会请求客户端，避免输出内容错乱的文件却报成功。
 */

import {
  callHostTransport,
  formatBytes,
  invokeDllPluginCapability,
  openRealPath,
  showRealItemInFolder
} from './native-ipc.js'
import {
  friendlyFileError,
  type FileImportRules,
  type FileImportTransport,
  type ImportedFile
} from './file-import.js'
import { t } from './i18n.js'

export { formatBytes } from './native-ipc.js'

export type PdfToolCategory = 'pdf_to_other' | 'other_to_pdf' | 'pdf_ops'
export type PdfInputType = 'pdf' | 'word' | 'excel' | 'ppt' | 'image'

export interface CapabilityActionItem {
  id: string
  title: string
  subtitle: string
  tag: string
  method: string
  category?: PdfToolCategory
  /** 工具接受的输入文件类型 */
  inputType: PdfInputType
  /** 输出文件扩展名（含点） */
  outputExt: string
  /** 当前客户端能否如实完成该工具 */
  supported: boolean
  /** 不可用的原因（supported 为 false 时必填） */
  unsupportedReason?: string
  /** 导出文字类工具：需要检查客户端返回的文字是否为乱码 */
  extractsText?: boolean
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
  /** 文件实际所在目录 */
  parentDir: string
  extension: string
  docType: 'pdf' | 'word' | 'excel' | 'ppt' | 'image' | 'other'
  /** 字节数；宿主没有返回时为 null（界面显示“大小未识别”） */
  sizeBytes: number | null
}

/** 客户端内置 PDF 处理接口的插件名（客户端按插件 id 路由） */
export const HOST_PLUGIN_NAME = 'pdf'
export const FORBIDDEN_TARGET_PATTERN = new RegExp('\\\\Windows\\\\System32|\\.\\.\\\\|\\.\\./', 'i')
export const FORBIDDEN_REASON = 'PDF 转换输出路径禁止包含目录穿越或覆盖系统核心目录'

const REASON_OFFICE = '客户端没有 PDF 与 Office 格式互转组件'
const REASON_RENDER = '客户端没有 PDF 渲染组件，无法把页面转成图片'
const REASON_IMAGE = '插件还不能调用客户端的图片转 PDF 接口'
const REASON_REBUILD = '客户端现有的 PDF 重建方式会把字体、图片等数据当成页面内容写入，输出文件内容错乱，已停用'

/** 界面上统一说明的暂不可用功能 */
export const UNAVAILABLE_FEATURES_NOTE = '格式互转、合并、拆分、压缩、加解密（客户端缺少 PDF 解析与渲染组件）'
/** 文字导出的能力边界 */
export const TEXT_EXTRACTION_LIMIT_NOTE =
  '只能读取未压缩的简单文字，结果可能不完整；扫描件、压缩或特殊字体编码的 PDF 会提示无法提取'

export function getPdfToolboxModes(): CapabilityActionItem[] {
  const reasonOffice = t('reasonOffice')
  const reasonRender = t('reasonRender')
  const reasonImage = t('reasonImage')
  const reasonRebuild = t('reasonRebuild')
  return [
    {
      id: 'pdf-to-txt',
      title: t('toolPdfToTxtTitle'),
      subtitle: t('toolPdfToTxtSub'),
      tag: t('toolPdfToTxtTag'),
      category: 'pdf_to_other',
      method: 'PdfToTxt',
      inputType: 'pdf',
      outputExt: '.txt',
      supported: true,
      extractsText: true,
      params: {}
    },
    {
      id: 'pdf-to-html',
      title: t('toolPdfToHtmlTitle'),
      subtitle: t('toolPdfToHtmlSub'),
      tag: t('toolPdfToHtmlTag'),
      category: 'pdf_to_other',
      method: 'PdfToHtml',
      inputType: 'pdf',
      outputExt: '.html',
      supported: true,
      extractsText: true,
      params: {}
    },
    {
      id: 'pdf-to-word',
      title: t('toolPdfToWordTitle'),
      subtitle: reasonOffice,
      tag: t('toolPdfToWordTag'),
      category: 'pdf_to_other',
      method: 'PdfToWord',
      inputType: 'pdf',
      outputExt: '.docx',
      supported: false,
      unsupportedReason: reasonOffice,
      params: {}
    },
    {
      id: 'pdf-to-excel',
      title: t('toolPdfToExcelTitle'),
      subtitle: reasonOffice,
      tag: t('toolPdfToExcelTag'),
      category: 'pdf_to_other',
      method: 'PdfToExcel',
      inputType: 'pdf',
      outputExt: '.xlsx',
      supported: false,
      unsupportedReason: reasonOffice,
      params: {}
    },
    {
      id: 'pdf-to-ppt',
      title: t('toolPdfToPptTitle'),
      subtitle: reasonOffice,
      tag: t('toolPdfToPptTag'),
      category: 'pdf_to_other',
      method: 'PdfToPpt',
      inputType: 'pdf',
      outputExt: '.pptx',
      supported: false,
      unsupportedReason: reasonOffice,
      params: {}
    },
    {
      id: 'pdf-to-image',
      title: t('toolPdfToImageTitle'),
      subtitle: reasonRender,
      tag: t('toolPdfToImageTag'),
      category: 'pdf_to_other',
      method: 'PdfToImage',
      inputType: 'pdf',
      outputExt: '.png',
      supported: false,
      unsupportedReason: reasonRender,
      params: {}
    },
    {
      id: 'word-to-pdf',
      title: t('toolWordToPdfTitle'),
      subtitle: reasonOffice,
      tag: t('toolWordToPdfTag'),
      category: 'other_to_pdf',
      method: 'WordToPdf',
      inputType: 'word',
      outputExt: '.pdf',
      supported: false,
      unsupportedReason: reasonOffice,
      params: {}
    },
    {
      id: 'excel-to-pdf',
      title: t('toolExcelToPdfTitle'),
      subtitle: reasonOffice,
      tag: t('toolExcelToPdfTag'),
      category: 'other_to_pdf',
      method: 'ExcelToPdf',
      inputType: 'excel',
      outputExt: '.pdf',
      supported: false,
      unsupportedReason: reasonOffice,
      params: {}
    },
    {
      id: 'image-to-pdf',
      title: t('toolImageToPdfTitle'),
      subtitle: reasonImage,
      tag: t('toolImageToPdfTag'),
      category: 'other_to_pdf',
      method: 'ImageToPdf',
      inputType: 'image',
      outputExt: '.pdf',
      supported: false,
      unsupportedReason: reasonImage,
      params: {}
    },
    {
      id: 'pdf-merge',
      title: t('toolPdfMergeTitle'),
      subtitle: reasonRebuild,
      tag: t('toolPdfMergeTag'),
      category: 'pdf_ops',
      method: 'MergePdf',
      inputType: 'pdf',
      outputExt: '.pdf',
      supported: false,
      unsupportedReason: reasonRebuild,
      params: {}
    },
    {
      id: 'pdf-split',
      title: t('toolPdfSplitTitle'),
      subtitle: reasonRebuild,
      tag: t('toolPdfSplitTag'),
      category: 'pdf_ops',
      method: 'SplitPdf',
      inputType: 'pdf',
      outputExt: '.pdf',
      supported: false,
      unsupportedReason: reasonRebuild,
      params: {}
    },
    {
      id: 'pdf-compress',
      title: t('toolPdfCompressTitle'),
      subtitle: reasonRebuild,
      tag: t('toolPdfCompressTag'),
      category: 'pdf_ops',
      method: 'CompressPdf',
      inputType: 'pdf',
      outputExt: '.pdf',
      supported: false,
      unsupportedReason: reasonRebuild,
      params: {}
    }
  ]
}

export const PDF_TOOLBOX_MODES: CapabilityActionItem[] = getPdfToolboxModes()

export function getCapabilityItems(): CapabilityActionItem[] {
  return getPdfToolboxModes().map(item => ({
    ...item,
    params: { ...item.params }
  }))
}

/** 当前客户端能如实完成的工具（界面只展示这些） */
export function getAvailableTools(): CapabilityActionItem[] {
  return getCapabilityItems().filter(item => item.supported)
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

export function validateInvocationPayload(method: string, params: unknown): { valid: boolean; error?: string } {
  if (typeof method !== 'string' || method.trim().length === 0) {
    return { valid: false, error: t('errInvalidMethod') }
  }
  if (method.length > 128 || !/^[A-Za-z0-9_]+$/.test(method.trim())) {
    return { valid: false, error: t('errInvalidMethodFormat') }
  }
  if (params === null || params === undefined || typeof params !== 'object' || Array.isArray(params)) {
    return { valid: false, error: t('errInvalidParams') }
  }

  const record = params as Record<string, unknown>
  for (const [key, val] of Object.entries(record)) {
    if (typeof val === 'string') {
      if (val.length > 4096) {
        return { valid: false, error: t('errParamTooLong', { key }) }
      }
      if (FORBIDDEN_TARGET_PATTERN.test(val)) {
        return { valid: false, error: `SECURITY_INTERCEPTED: ${t('forbiddenReason')}` }
      }
    } else if (typeof val === 'number') {
      if (!Number.isFinite(val) || val < -1000 || val > 100_000_000) {
        return { valid: false, error: t('errParamOutOfRange', { key }) }
      }
    }
  }

  return { valid: true }
}

/**
 * 调用客户端 PDF 接口。只放行 supported 的工具：不可用的工具直接返回失败，不请求客户端。
 * 参数不合法时抛错。
 */
export async function invokeNativeCapability(
  method: string,
  params: Record<string, unknown>,
  hostBridge?: unknown
): Promise<NativeInvocationResult> {
  const check = validateInvocationPayload(method, params)
  if (!check.valid) {
    throw new Error(check.error || t('errParamValidationFailed'))
  }

  const trimmedMethod = method.trim()
  const tool = getPdfToolboxModes().find(item => item.method === trimmedMethod)
  if (!tool) {
    return {
      ok: false,
      pluginName: HOST_PLUGIN_NAME,
      method: trimmedMethod,
      error: t('errUnsupportedMethod', { method: trimmedMethod }),
      fromFallback: false
    }
  }
  if (!tool.supported) {
    return {
      ok: false,
      pluginName: HOST_PLUGIN_NAME,
      method: trimmedMethod,
      error: t('errUnsupportedTool', { tag: tool.tag, reason: tool.unsupportedReason || t('errMissingHostComponent') }),
      fromFallback: false
    }
  }

  const res = await invokeDllPluginCapability(HOST_PLUGIN_NAME, trimmedMethod, params, hostBridge)
  return {
    ok: res.ok,
    pluginName: HOST_PLUGIN_NAME,
    method: trimmedMethod,
    data: res.data ?? undefined,
    error: res.error,
    fromFallback: res.fromFallback
  }
}

function classifyDocType(ext: string): RealPdfDocItem['docType'] {
  if (ext === '.pdf') return 'pdf'
  if (ext === '.docx' || ext === '.doc') return 'word'
  if (ext === '.xlsx' || ext === '.xls') return 'excel'
  if (ext === '.pptx' || ext === '.ppt') return 'ppt'
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp') return 'image'
  return 'other'
}

const INPUT_TYPE_EXTENSIONS: Record<PdfInputType, string[]> = {
  pdf: ['.pdf'],
  word: ['.docx', '.doc'],
  excel: ['.xlsx', '.xls'],
  ppt: ['.pptx', '.ppt'],
  image: ['.png', '.jpg', '.jpeg']
}

/** 只放行当前已开放的工具真正能处理的输入格式（目前只有文字导出，即 PDF） */
function buildImportExtensions(): string[] {
  const exts = new Set<string>()
  for (const tool of PDF_TOOLBOX_MODES) {
    if (!tool.supported) continue
    for (const ext of INPUT_TYPE_EXTENSIONS[tool.inputType]) exts.add(ext)
  }
  return [...exts]
}

/** 导入允许的扩展名（小写带点） */
export const INPUT_PDF_EXTENSIONS: readonly string[] = buildImportExtensions()

/** 导入规则：递归 5 层、最多 500 个文件；系统核心目录与目录穿越路径一律跳过 */
export const PDF_IMPORT_RULES: FileImportRules = {
  extensions: INPUT_PDF_EXTENSIONS,
  forbiddenPath: FORBIDDEN_TARGET_PATTERN
}

/** 界面上说明支持的格式 */
export const PDF_IMPORT_SUPPORTED_TEXT = INPUT_PDF_EXTENSIONS.map(ext => ext.slice(1).toUpperCase()).join(' / ')

/** 把宿主调用包装成 file-import 需要的形式 */
export function createPdfImportTransport(hostOverride?: unknown): FileImportTransport {
  return (method, params) => callHostTransport<unknown>(method, params, hostOverride)
}

/** 把导入结果转成列表条目 */
export function toPdfDocItem(file: ImportedFile): RealPdfDocItem {
  const ext = file.extension.toLowerCase()
  return {
    id: `pdf:${file.path.toLowerCase()}`,
    name: file.name,
    path: file.path,
    parentDir: file.parentDir,
    extension: ext,
    docType: classifyDocType(ext),
    sizeBytes: file.sizeBytes
  }
}

interface SplitPath {
  /** 含末尾分隔符的目录部分 */
  dirWithSep: string
  dir: string
  stem: string
  ext: string
}

export function splitFilePath(fullPath: string): SplitPath | null {
  if (typeof fullPath !== 'string') return null
  const trimmed = fullPath.trim()
  const lastSep = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
  if (lastSep < 0 || lastSep === trimmed.length - 1) return null
  const name = trimmed.slice(lastSep + 1)
  const dot = name.lastIndexOf('.')
  const dirWithSep = trimmed.slice(0, lastSep + 1)
  return {
    dirWithSep,
    // 根目录（/ 或 C:\）保留分隔符，其余去掉末尾分隔符
    dir: lastSep === 0 || /^[A-Za-z]:[\\/]$/.test(dirWithSep) ? dirWithSep : trimmed.slice(0, lastSep),
    stem: dot > 0 ? name.slice(0, dot) : name,
    ext: dot > 0 ? name.slice(dot) : ''
  }
}

/** 同名文件已存在时最多尝试的序号 */
export const MAX_OUTPUT_NAME_ATTEMPTS = 50

export function buildOutputCandidate(inputPath: string, outputExt: string, index: number): string | null {
  const parts = splitFilePath(inputPath)
  if (!parts) return null
  const suffix = index > 0 ? ` (${index})` : ''
  return `${parts.dirWithSep}${parts.stem}${suffix}${outputExt}`
}

/** 查询文件是否已存在；查询失败时如实返回错误，调用方不能当作“不存在” */
export async function checkFileExists(
  fullPath: string,
  hostOverride?: unknown
): Promise<{ ok: true; exists: boolean } | { ok: false; error: string }> {
  const res = await callHostTransport<unknown>('filesystem_file_exists', { path: fullPath }, hostOverride)
  if (!res.ok) {
    return { ok: false, error: friendlyFileError(res.error || t('errCheckExistsFailed')) }
  }
  const data = res.data
  if (typeof data === 'boolean') return { ok: true, exists: data }
  const exists = data && typeof data === 'object' ? (data as { exists?: unknown }).exists : undefined
  if (typeof exists === 'boolean') {
    return { ok: true, exists }
  }
  return { ok: false, error: t('errMalformedExists') }
}

/**
 * 找一个不会覆盖已有文件的输出路径：先用「原名.扩展名」，已存在则依次尝试「原名 (1).扩展名」……
 * 任何一次查询失败都停止，宁可不导出也不冒覆盖的风险。
 */
export async function resolveAvailableOutputPath(
  inputPath: string,
  outputExt: string,
  hostOverride?: unknown
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  for (let i = 0; i < MAX_OUTPUT_NAME_ATTEMPTS; i++) {
    const candidate = buildOutputCandidate(inputPath, outputExt, i)
    if (!candidate) {
      return { ok: false, error: t('errInvalidInputPath', { path: inputPath }) }
    }
    const exists = await checkFileExists(candidate, hostOverride)
    if (!exists.ok) {
      return {
        ok: false,
        error: t('errOutputCheckFailed', { path: candidate, error: exists.error })
      }
    }
    if (!exists.exists) return { ok: true, path: candidate }
  }
  const parts = splitFilePath(inputPath)
  return {
    ok: false,
    error: t('errOutputNameExhausted', { dir: parts?.dir ?? '', max: MAX_OUTPUT_NAME_ATTEMPTS, ext: outputExt })
  }
}

/** 控制字符占比超过该值时认为客户端返回的文字是乱码（字体编码无法解析） */
export const GARBLED_CONTROL_RATIO = 0.2
/** 控制字符与 Unicode 替换字符（解码失败的标志） */
const GARBLED_CHAR_PATTERN = new RegExp(`[\\u0000-\\u001f\\u007f-\\u009f${String.fromCharCode(0xfffd)}]`, 'g')

export function assessExtractedText(text: unknown): { chars: number; garbled: boolean } {
  const s = typeof text === 'string' ? text : ''
  const visible = s.replace(/[ \t\r\n]/g, '')
  if (visible.length === 0) return { chars: 0, garbled: false }
  const control = (visible.match(GARBLED_CHAR_PATTERN) || []).length
  return { chars: visible.length, garbled: control / visible.length > GARBLED_CONTROL_RATIO }
}

export interface PdfTaskOutcome {
  file: RealPdfDocItem
  ok: boolean
  outputPath?: string
  /** 导出的可见字符数（客户端返回了文字时才有） */
  chars?: number
  error?: string
}

export interface PdfBatchResult {
  toolId: string
  toolTag: string
  /** 整批被拒绝的原因（工具不可用等），此时没有处理任何文件 */
  error?: string
  succeeded: PdfTaskOutcome[]
  failed: PdfTaskOutcome[]
  /** 类型不符、未处理的文件 */
  skipped: RealPdfDocItem[]
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function runOneFile(
  tool: CapabilityActionItem,
  file: RealPdfDocItem,
  hostOverride?: unknown
): Promise<PdfTaskOutcome> {
  const target = await resolveAvailableOutputPath(file.path, tool.outputExt, hostOverride)
  if (!target.ok) return { file, ok: false, error: target.error }

  let res: NativeInvocationResult
  try {
    res = await invokeNativeCapability(
      tool.method,
      { ...tool.params, inputPath: file.path, outputPath: target.path },
      hostOverride
    )
  } catch (err) {
    return { file, ok: false, error: friendlyFileError(err) }
  }
  if (!res.ok) {
    return { file, ok: false, error: friendlyFileError(res.error || t('errPdfProcessNoReason')) }
  }

  const data = (res.data && typeof res.data === 'object' ? res.data : {}) as Record<string, unknown>
  const outputPath = typeof data.outputPath === 'string' ? data.outputPath.trim() : ''
  if (!outputPath) {
    return {
      file,
      ok: false,
      error: t('errHostNoOutput')
    }
  }

  if (tool.extractsText && typeof data.text === 'string') {
    const quality = assessExtractedText(data.text)
    if (quality.chars === 0) {
      return { file, ok: false, outputPath, error: t('errNoReadableText', { path: outputPath }) }
    }
    if (quality.garbled) {
      return {
        file,
        ok: false,
        outputPath,
        error: t('errGarbledText', { path: outputPath })
      }
    }
    return { file, ok: true, outputPath, chars: quality.chars }
  }
  return { file, ok: true, outputPath }
}

/**
 * 对一组文件依次执行工具（串行，前一个写完再处理下一个，序号判重才准确）。
 * 不可用的工具整批拒绝；类型不符的文件跳过并如实列出。
 */
export async function runPdfTool(
  toolId: string,
  files: RealPdfDocItem[],
  hostOverride?: unknown
): Promise<PdfBatchResult> {
  const tool = getPdfToolboxModes().find(item => item.id === toolId)
  const result: PdfBatchResult = {
    toolId,
    toolTag: tool?.tag ?? toolId,
    succeeded: [],
    failed: [],
    skipped: []
  }
  if (!tool) {
    result.error = t('errUnknownTool', { toolId })
    return result
  }
  if (!tool.supported) {
    result.error = t('errToolUnavailable', { tag: tool.tag, reason: tool.unsupportedReason || t('errMissingHostComponent') })
    return result
  }

  for (const file of Array.isArray(files) ? files : []) {
    if (!file || file.docType !== tool.inputType) {
      if (file) result.skipped.push(file)
      continue
    }
    const outcome = await runOneFile(tool, file, hostOverride)
    if (outcome.ok) result.succeeded.push(outcome)
    else result.failed.push(outcome)
  }
  return result
}

export interface BatchSummary {
  ok: boolean
  title: string
  message: string
}

/** 把批处理结果整理成一条提示：只要有失败就按失败提示，并给出第一条失败原因 */
export function describeBatchResult(result: PdfBatchResult): BatchSummary {
  if (result.error) {
    return { ok: false, title: t('batchNotExecuted', { tag: result.toolTag }), message: result.error }
  }
  const okCount = result.succeeded.length
  const failCount = result.failed.length
  const skipNote = result.skipped.length > 0 ? t('batchSkippedNote', { count: result.skipped.length }) : ''
  const firstFail = result.failed[0]
  const failText = firstFail ? t('batchFailItem', { name: firstFail.file.name, error: firstFail.error || t('wordFail') }) : ''

  if (okCount === 0 && failCount === 0) {
    return {
      ok: false,
      title: t('batchNoFilesTitle'),
      message: result.skipped.length > 0 ? t('batchAllSkippedMsg', { count: result.skipped.length }) : t('batchSelectPdfFirst')
    }
  }
  if (failCount === 0) {
    const only = result.succeeded[0]
    return {
      ok: true,
      title: t('batchExportedTitle', { count: okCount }),
      message: `${okCount === 1 && only?.outputPath ? only.outputPath : t('batchExportedDirMsg')}${skipNote}`
    }
  }
  if (okCount === 0) {
    return { ok: false, title: t('batchFailedTitle', { count: failCount }), message: `${failText}${skipNote}` }
  }
  return {
    ok: false,
    title: t('batchPartialTitle', { ok: okCount, fail: failCount }),
    message: `${failText}${skipNote}`
  }
}

export async function openPdfFileLocation(fullPath: string, hostOverride?: unknown): Promise<boolean> {
  if (!fullPath) return false
  return showRealItemInFolder(fullPath, hostOverride)
}

export async function openPdfDocument(fullPath: string, hostOverride?: unknown): Promise<boolean> {
  if (!fullPath) return false
  return openRealPath(fullPath, hostOverride)
}
