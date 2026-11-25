/**
 * 公式识别：调用客户端的本机公式识别（Pix2Text-MFR 模型，macOS 与 Windows 相同），图片不上传。
 * 模型第一次使用时由客户端下载（只下载模型文件），之后离线识别。不在客户端中运行时如实报错，不提供示例数据。
 */

import { Clipboard } from '@ztools/declarative-ui'
import { t } from './i18n.js'
import { type FileImportRules, type FileImportTransport, adaptPreloadTransport } from './file-import.js'
import { extractErrorCode, resolveErrorMessage } from './error-i18n.js'

export function getNotInClientMessage(): string { return t('notInClientMessage') }
export function getModelMissingMessage(): string { return t('modelMissingMessage') }

/** 文件夹导入和拖入展开支持的图片扩展名与单次上限 */
export const FORMULA_IMPORT_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp'] as const
export const FORMULA_IMPORT_MAX_FILES = 100
export const FORMULA_IMPORT_SUPPORTED_TEXT = 'PNG / JPG / WebP / BMP'
export const FORMULA_IMPORT_RULES: FileImportRules = {
  extensions: FORMULA_IMPORT_EXTENSIONS,
  maxFiles: FORMULA_IMPORT_MAX_FILES
}

/** 支持识别的图片扩展名（与客户端识别组件一致） */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'heic', 'tif', 'tiff', 'bmp', 'gif', 'webp'] as const

export function isSupportedFormulaImagePath(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return (IMAGE_EXTENSIONS as readonly string[]).includes(ext)
}

/** 从宿主 plugin_files_dropped 事件载荷中提取支持识别的图片路径 */
export function extractDroppedFormulaImages(envelopeOrPayload: unknown): string[] {
  if (!isRecord(envelopeOrPayload)) return []
  const payload = isRecord(envelopeOrPayload.payload) ? envelopeOrPayload.payload : envelopeOrPayload
  if (!Array.isArray(payload.files)) return []
  return payload.files
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(item => item.trim())
    .filter(isSupportedFormulaImagePath)
}

/** 复制格式：行内公式、独立公式、纯 LaTeX */
export interface CopyFormat {
  id: 'inline' | 'display' | 'latex'
  title: string
  /** 动作面板里的名称 */
  actionTitle: string
  wrap(latex: string): string
}

export function getCopyFormats(): readonly CopyFormat[] {
  return [
    { id: 'inline', title: t('fmtInlineTitle'), actionTitle: t('fmtInlineAction'), wrap: latex => `$${latex}$` },
    { id: 'display', title: t('fmtDisplayTitle'), actionTitle: t('fmtDisplayAction'), wrap: latex => `$$${latex}$$` },
    { id: 'latex', title: t('fmtLatexTitle'), actionTitle: t('fmtLatexAction'), wrap: latex => latex }
  ]
}

export function resolveCopyFormat(id: unknown): CopyFormat {
  const formats = getCopyFormats()
  return formats.find(format => format.id === id) ?? formats[0]!
}

export type ModelStatus =
  | { state: 'missing'; totalBytes: number }
  | { state: 'downloading'; receivedBytes: number; totalBytes: number }
  | { state: 'ready'; totalBytes: number }
  | { state: 'failed'; error: string; totalBytes: number }

/** 一次识别的结果：成功带 LaTeX，失败带原因；用户取消框选时 canceled 为 true，模型没下载时 modelMissing 为 true */
export type FormulaOutcome =
  | { ok: true; latex: string; lowConfidence: boolean; previewDataUrl?: string }
  | { ok: false; error: string; errorCode?: string; canceled?: boolean; empty?: boolean; modelMissing?: boolean }

/** 客户端传输层：method + params + 超时，返回宿主原始响应 */
export type HostTransport = (method: string, params: Record<string, unknown>, timeoutMs: number) => Promise<unknown>

type HostRecord = Record<string, unknown>

function isRecord(value: unknown): value is HostRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

let messageSeq = 0

/** 插件运行在客户端界面里，经 preload 暴露的传输通道调用宿主；不在客户端时返回 undefined */
export function getClientTransport(): HostTransport | undefined {
  const methods = (globalThis as { window?: { __ztoolsElectron?: { transport?: { methods?: Record<string, unknown> } } } })
    .window?.__ztoolsElectron?.transport?.methods
  if (!methods) return undefined
  return async (method, params, timeoutMs) => {
    const call = methods[method]
    if (typeof call !== 'function') throw new Error(method === 'formula_ocr' ? t('unsupportedFormulaOcr') : t('unsupportedMethod', { method }))
    messageSeq = (messageSeq + 1) % 1_000_000
    return call({ messageId: `formula_${Date.now()}_${messageSeq}`, params, timeoutMs })
  }
}

/** 取出宿主响应里的业务数据；宿主报错时抛出其错误信息 */
export function unwrapHostResponse(raw: unknown): HostRecord {
  if (!isRecord(raw)) throw new Error(t('errInvalidHostResult'))
  if (raw.success === false && !('ok' in raw)) {
    const error = raw.error
    throw new Error(isRecord(error) ? String(error.message || error.code || t('errHostCallFailed')) : String(error || t('errHostCallFailed')))
  }
  const outer = isRecord(raw.data) ? raw.data : raw
  return isRecord(outer.data) ? outer.data : outer
}

/** 将现有 HostTransport 适配为 file-import.ts 使用的 FileImportTransport */
export function createFileImportTransport(transport?: HostTransport): FileImportTransport {
  return adaptPreloadTransport(transport, { notInClientMessage: getNotInClientMessage() })
}

/** 识别服务返回 → 统一结果；空 LaTeX 也算失败（没有识别到公式） */
export function toOutcome(result: HostRecord): FormulaOutcome {
  const failed = result.ok === false || result.success === false
  const latex = typeof result.latex === 'string' ? result.latex.trim() : ''
  if (!failed && latex) return { ok: true, latex, lowConfidence: result.lowConfidence === true,
    ...(validPreview(result.previewDataUrl) ? { previewDataUrl: result.previewDataUrl as string } : {}) }
  const errorCode = extractErrorCode(result)
  const codeField = errorCode ? { errorCode } : {}
  const codeMap = { CLIPBOARD_NO_IMAGE: t('errNoClipboardImage') }
  if (result.canceled === true) return { ok: false, canceled: true, ...codeField, error: String(resolveErrorMessage(result, t('errCancelled'), codeMap)) }
  if (result.modelMissing === true) return { ok: false, modelMissing: true, ...codeField, error: getModelMissingMessage() }
  if (!failed || result.empty === true) return { ok: false, empty: true, ...codeField, error: t('errNoFormulaDetected') }
  return { ok: false, ...codeField, error: String(resolveErrorMessage(result, t('errRecognitionFailed'), codeMap)) }
}

/** 识别单张图片最多等 90 秒（长公式在慢电脑上逐词元解码较久）；框选要等用户操作，最多 3 分钟 */
const RECOGNIZE_TIMEOUT_MS = 90_000
const REGION_TIMEOUT_MS = 180_000

async function invokeFormula(transport: HostTransport, params: HostRecord, timeoutMs: number): Promise<FormulaOutcome> {
  try {
    return toOutcome(unwrapHostResponse(await transport('formula_ocr', params, timeoutMs)))
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function recognizeImageFile(transport: HostTransport, path: string, includePreview = false): Promise<FormulaOutcome> {
  return invokeFormula(transport, { action: 'recognizeImage', path, ...(includePreview ? { includePreview } : {}) }, RECOGNIZE_TIMEOUT_MS)
}

export async function recognizeClipboardImage(transport: HostTransport, includePreview = false): Promise<FormulaOutcome> {
  try {
    const clipFiles = (await Clipboard.readFiles())
      .map(item => item.trim())
      .filter(isSupportedFormulaImagePath)
    if (clipFiles.length > 0) {
      return recognizeImageFile(transport, clipFiles[0]!, includePreview)
    }
  } catch {
    // 忽略读取剪贴板文件列表异常，继续尝试剪贴板位图识别
  }
  return invokeFormula(transport, { action: 'recognizeClipboard', ...(includePreview ? { includePreview } : {}) }, RECOGNIZE_TIMEOUT_MS)
}

/** 框选前客户端会收起 ZTools 窗口；restoreWindow 为 false 时识别后不再显示（无界面命令，方便直接粘贴） */
export function recognizeScreenRegion(transport: HostTransport, restoreWindow = true, includePreview = false): Promise<FormulaOutcome> {
  return invokeFormula(transport, { action: 'captureRegion', restoreWindow, ...(includePreview ? { includePreview } : {}) }, REGION_TIMEOUT_MS)
}

function toModelStatus(data: HostRecord): ModelStatus {
  const totalBytes = typeof data.totalBytes === 'number' ? data.totalBytes : 0
  if (data.state === 'ready') return { state: 'ready', totalBytes }
  if (data.state === 'downloading') {
    return { state: 'downloading', totalBytes, receivedBytes: typeof data.receivedBytes === 'number' ? data.receivedBytes : 0 }
  }
  if (data.state === 'failed') return { state: 'failed', totalBytes, error: String(resolveErrorMessage(data, t('errDownloadFailed'))) }
  if (data.state === 'missing') return { state: 'missing', totalBytes }
  throw new Error(t('errInvalidModelState'))
}

async function modelCall(transport: HostTransport, action: 'modelStatus' | 'downloadModel' | 'cancelDownload'): Promise<ModelStatus> {
  const data = unwrapHostResponse(await transport('formula_ocr', { action }, 30_000))
  if (data.ok === false) throw new Error(String(resolveErrorMessage(data, t('errFormulaUnavailable'))))
  return toModelStatus(data)
}

export const getModelStatus = (transport: HostTransport) => modelCall(transport, 'modelStatus')
export const downloadModel = (transport: HostTransport) => modelCall(transport, 'downloadModel')
export const cancelModelDownload = (transport: HostTransport) => modelCall(transport, 'cancelDownload')

/** 选择图片：取消返回空数组；对话框打开失败抛错 */
export async function pickImageFiles(transport: HostTransport): Promise<string[]> {
  const data = unwrapHostResponse(await transport('window_show_open_dialog', {
    title: t('dialogPickImagesTitle'),
    properties: ['openFile', 'multiSelections'],
    filters: t('dialogPickImagesFilter', { exts: IMAGE_EXTENSIONS.map(ext => `*.${ext}`).join(';') })
  }, 300_000))
  if (data.canceled === true) return []
  if (typeof data.filePath === 'string' && data.filePath) return [data.filePath]
  if (Array.isArray(data.filePaths)) {
    const paths = data.filePaths
      .map(item => (typeof item === 'string' ? item : isRecord(item) && typeof item.path === 'string' ? item.path : ''))
      .filter(Boolean)
    if (paths.length > 0) return paths
  }
  throw new Error(t('errInvalidPickResult'))
}

/** 发送系统通知；失败不影响识别结果（公式已在剪贴板） */
export async function notify(transport: HostTransport, title: string, message: string): Promise<void> {
  try {
    unwrapHostResponse(await transport('system_notify', { title, message, modal: false }, 10_000))
  } catch {
    // 通知只是提示，发送失败时调用方仍会返回结果
  }
}

export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path
}

export function truncate(text: string, max = 60): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max)}…` : line
}

export function formatMegabytes(bytes: number): string {
  return `${Math.max(0, bytes / 1024 / 1024).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`
}

/** 放进 Markdown 围栏的内容：内容里的反引号围栏加长 */
function fenced(language: string, text: string): string {
  const longest = Math.max(2, ...Array.from(text.matchAll(/`+/g), match => match[0].length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}${language}\n${text}\n${fence}`
}

/** 原图只接受有大小上限的 PNG 数据，不能把远程地址或 Markdown 当作图片地址插入。 */
function validPreview(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 525_000 && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
}

export function formulaPreviewMarkdown(latex: string, previewDataUrl?: string): string {
  return [
    ...(validPreview(previewDataUrl) ? [t('mdOriginalImageHeading'), '', `![${t('mdOriginalImageAlt')}](${previewDataUrl})`, ''] : []),
    t('mdPreviewHeading'), '', fenced('math', latex)
  ].join('\n')
}

/** 排版成功不代表识别正确，高分同样提醒核对；原图预览不落盘。 */
export function formulaMarkdown(latex: string, lowConfidence: boolean, previewDataUrl?: string): string {
  return [
    ...(lowConfidence ? [t('mdLowConfWarning'), ''] : [t('mdCheckHint'), '']),
    ...(!validPreview(previewDataUrl) ? [t('mdNoOriginalPreviewHint'), ''] : []),
    formulaPreviewMarkdown(latex, previewDataUrl),
    '',
    fenced('latex', latex)
  ].join('\n')
}
