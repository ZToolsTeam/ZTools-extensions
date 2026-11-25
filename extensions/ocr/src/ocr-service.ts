/**
 * 文字识别：调用客户端的本机文字识别（macOS 系统 Vision / Windows 内置 PP-OCRv5 模型，韩文用系统文字识别），不联网。
 * 不在客户端中运行时如实报错，不提供示例数据。
 */

import { Clipboard } from '@ztools/declarative-ui'
import { type FileImportRules, type FileImportTransport, adaptPreloadTransport } from './file-import.js'
import { t } from './i18n.js'
import { extractErrorCode, resolveErrorMessage } from './error-i18n.js'

export const getNotInClientMessage = (): string => t('notInClient')

/** 文件夹导入和拖入展开支持的图片扩展名与单次上限 */
export const OCR_IMPORT_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tiff'] as const
export const OCR_IMPORT_MAX_FILES = 100
export const OCR_IMPORT_SUPPORTED_TEXT = 'PNG / JPG / WebP / BMP / GIF / TIFF'
export const OCR_IMPORT_RULES: FileImportRules = {
  extensions: OCR_IMPORT_EXTENSIONS,
  maxFiles: OCR_IMPORT_MAX_FILES
}

export interface OcrLanguage {
  id: string
  title: string
  /** 传给客户端识别服务的语言代码 */
  engineCode: string
}

export function getOcrLanguages(): readonly OcrLanguage[] {
  return [
    { id: 'zh-hans', title: t('langZhHans'), engineCode: 'zh-Hans-CN' },
    { id: 'en', title: t('langEn'), engineCode: 'en-US' },
    { id: 'ja', title: t('langJa'), engineCode: 'ja-JP' },
    { id: 'ko', title: t('langKo'), engineCode: 'ko-KR' }
  ]
}

export function resolveLanguage(id: unknown): OcrLanguage {
  const langs = getOcrLanguages()
  return langs.find(language => language.id === id) ?? langs[0]
}

/** 支持识别的图片扩展名（与客户端识别组件一致） */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'heic', 'tif', 'tiff', 'bmp', 'gif', 'webp'] as const

export function isSupportedImagePath(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return (IMAGE_EXTENSIONS as readonly string[]).includes(ext)
}

/** 从宿主 plugin_files_dropped 事件载荷中提取支持识别的图片路径 */
export function extractDroppedImagePaths(envelopeOrPayload: unknown): string[] {
  if (!isRecord(envelopeOrPayload)) return []
  const payload = isRecord(envelopeOrPayload.payload) ? envelopeOrPayload.payload : envelopeOrPayload
  if (!Array.isArray(payload.files)) return []
  return payload.files
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(item => item.trim())
    .filter(isSupportedImagePath)
}

/** 一次识别的结果：成功带文字，失败带原因；用户取消框选时 canceled 为 true */
export type OcrOutcome =
  | { ok: true; text: string }
  | { ok: false; error: string; errorCode?: string; canceled?: boolean; empty?: boolean }

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
    if (typeof call !== 'function') throw new Error(t('errMethodUnsupported', { method }))
    messageSeq = (messageSeq + 1) % 1_000_000
    return call({ messageId: `ocr_${Date.now()}_${messageSeq}`, params, timeoutMs })
  }
}

/** 取出宿主响应里的业务数据；宿主报错时抛出其错误信息 */
export function unwrapHostResponse(raw: unknown): HostRecord {
  if (!isRecord(raw)) throw new Error(t('errInvalidHostResult'))
  if (raw.success === false) {
    const error = raw.error
    throw new Error(isRecord(error) ? String(error.message || error.code || t('errHostCallFailed')) : String(error || t('errHostCallFailed')))
  }
  const outer = isRecord(raw.data) ? raw.data : raw
  return isRecord(outer.data) ? outer.data : outer
}

/** 将现有 HostTransport 适配为 file-import.ts 使用的 FileImportTransport */
export function createFileImportTransport(transport?: HostTransport): FileImportTransport {
  return adaptPreloadTransport(transport, { notInClientMessage: t('notInClient') })
}

/** 识别服务返回 → 统一结果；识别出空白文字也算失败（没有识别到文字） */
export function toOutcome(result: HostRecord): OcrOutcome {
  const failed = result.ok === false || result.success === false
  const text = typeof result.text === 'string' ? result.text.trim() : ''
  if (!failed && text) return { ok: true, text }
  const errorCode = extractErrorCode(result)
  const codeField = errorCode ? { errorCode } : {}
  const codeMap = { CLIPBOARD_NO_IMAGE: t('errClipboardNoImage') }
  if (result.canceled === true) return { ok: false, canceled: true, ...codeField, error: String(resolveErrorMessage(result, t('errCanceled'), codeMap)) }
  if (!failed || result.empty === true) return { ok: false, empty: true, ...codeField, error: t('errNoTextRecognized') }
  return { ok: false, ...codeField, error: String(resolveErrorMessage(result, t('errRecognizeFailed'), codeMap)) }
}

/** 识别单张图片最多等 60 秒；框选要等用户操作，最多 3 分钟 */
const RECOGNIZE_TIMEOUT_MS = 60_000
const REGION_TIMEOUT_MS = 180_000

async function invokeOcr(transport: HostTransport, params: HostRecord, timeoutMs: number): Promise<OcrOutcome> {
  try {
    const raw = await transport('image_ocr', params, timeoutMs)
    return toOutcome(unwrapHostResponse(raw))
  } catch (error) {
    const errRec = error && typeof error === 'object' ? (error as { code?: unknown; details?: { hostCode?: unknown } }) : null
    const code = typeof errRec?.code === 'string' ? errRec.code : ''
    const hostCode = typeof errRec?.details?.hostCode === 'string' ? errRec.details.hostCode : ''
    const message = error instanceof Error ? error.message : String(error)
    const isUnsupportedOcr =
      code === 'METHOD_NOT_FOUND' ||
      code === 'METHOD_NOT_AVAILABLE' ||
      hostCode === 'METHOD_NOT_FOUND' ||
      message.includes('does not support image_ocr') ||
      // i18n-allow: legacy host fallback
      (!code && !hostCode && message.includes('不支持 image_ocr'))
    if (isUnsupportedOcr && params.action === 'recognizeImage' && typeof params.path === 'string') {
      try {
        const fallbackRaw = await transport(
          'screen_recognize_text',
          { imagePath: params.path, path: params.path, lang: params.lang },
          timeoutMs
        )
        return toOutcome(unwrapHostResponse(fallbackRaw))
      } catch (fallbackError) {
        return { ok: false, error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError) }
      }
    }
    return { ok: false, error: message }
  }
}

export function recognizeImageFile(transport: HostTransport, path: string, language: OcrLanguage): Promise<OcrOutcome> {
  return invokeOcr(transport, { action: 'recognizeImage', path, lang: language.engineCode }, RECOGNIZE_TIMEOUT_MS)
}

export async function recognizeClipboardImage(transport: HostTransport, language: OcrLanguage): Promise<OcrOutcome> {
  try {
    const clipFiles = (await Clipboard.readFiles())
      .map(item => item.trim())
      .filter(isSupportedImagePath)
    if (clipFiles.length > 0) {
      return recognizeImageFile(transport, clipFiles[0]!, language)
    }
  } catch {
    // 忽略读取剪贴板文件列表异常，继续尝试剪贴板位图识别
  }
  return invokeOcr(transport, { action: 'recognizeClipboard', lang: language.engineCode }, RECOGNIZE_TIMEOUT_MS)
}

/** 框选前客户端会收起 ZTools 窗口；restoreWindow 为 false 时识别后不再显示（无界面命令，方便直接粘贴） */
export function recognizeScreenRegion(transport: HostTransport, language: OcrLanguage, restoreWindow = true): Promise<OcrOutcome> {
  return invokeOcr(transport, { action: 'captureRegion', lang: language.engineCode, restoreWindow }, REGION_TIMEOUT_MS)
}

/** 选择图片：取消返回空数组；对话框打开失败抛错 */
export async function pickImageFiles(transport: HostTransport): Promise<string[]> {
  const data = unwrapHostResponse(await transport('window_show_open_dialog', {
    title: t('pickImageTitle'),
    properties: ['openFile', 'multiSelections'],
    filters: `${t('pickImageFilter')}|${IMAGE_EXTENSIONS.map(ext => `*.${ext}`).join(';')}`
  }, 300_000))
  if (data.canceled === true) return []
  if (typeof data.filePath === 'string' && data.filePath) return [data.filePath]
  if (Array.isArray(data.filePaths)) {
    const paths = data.filePaths
      .map(item => (typeof item === 'string' ? item : isRecord(item) && typeof item.path === 'string' ? item.path : ''))
      .filter(Boolean)
    if (paths.length > 0) return paths
  }
  throw new Error(t('errInvalidFilePick'))
}

/** 发送系统通知；失败不影响识别结果（文字已在剪贴板） */
export async function notify(transport: HostTransport, title: string, message: string): Promise<void> {
  try {
    unwrapHostResponse(await transport('system_notify', { title, message, modal: false }, 10_000))
  } catch {
    // 通知只是提示，发送失败时调用方仍会返回结果文字
  }
}

export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path
}

/** 列表副标题用：第一行非空文字，过长截断 */
export function firstLine(text: string, max = 60): string {
  const line = text.split(/\r?\n/).find(item => item.trim())?.trim() ?? ''
  return line.length > max ? `${line.slice(0, max)}…` : line
}

/** 文字数（不含空白），用于列表右侧 */
export function countCharacters(text: string): number {
  return text.replace(/\s/g, '').length
}

/** 识别文字放进 Markdown 代码块原样显示，避免换行被合并；文字里的反引号围栏加长 */
export function textAsMarkdown(text: string): string {
  const longestFence = Math.max(2, ...Array.from(text.matchAll(/`+/g), match => match[0].length))
  const fence = '`'.repeat(longestFence + 1)
  return `${fence}text\n${text}\n${fence}`
}
