/**
 * 文字识别：调用客户端的本机文字识别（macOS 系统 Vision / Windows 系统文字识别），不联网。
 * 不在客户端中运行时如实报错，不提供示例数据。
 */

export const NOT_IN_CLIENT_MESSAGE = '需要在 ZTools 客户端中使用'

export interface OcrLanguage {
  id: string
  title: string
  /** 传给客户端识别服务的语言代码 */
  engineCode: string
}

export const OCR_LANGUAGES: readonly OcrLanguage[] = [
  { id: 'zh-hans', title: '简体中文', engineCode: 'zh-Hans-CN' },
  { id: 'en', title: '英文', engineCode: 'en-US' },
  { id: 'ja', title: '日文', engineCode: 'ja-JP' },
  { id: 'ko', title: '韩文', engineCode: 'ko-KR' }
]

export function resolveLanguage(id: unknown): OcrLanguage {
  return OCR_LANGUAGES.find(language => language.id === id) ?? OCR_LANGUAGES[0]
}

/** 支持识别的图片扩展名（与客户端识别组件一致） */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'heic', 'tif', 'tiff', 'bmp', 'gif', 'webp'] as const

/** 一次识别的结果：成功带文字，失败带原因；用户取消框选时 canceled 为 true */
export type OcrOutcome =
  | { ok: true; text: string }
  | { ok: false; error: string; canceled?: boolean; empty?: boolean }

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
    if (typeof call !== 'function') throw new Error(`客户端不支持 ${method}`)
    messageSeq = (messageSeq + 1) % 1_000_000
    return call({ messageId: `ocr_${Date.now()}_${messageSeq}`, params, timeoutMs })
  }
}

/** 取出宿主响应里的业务数据；宿主报错时抛出其错误信息 */
export function unwrapHostResponse(raw: unknown): HostRecord {
  if (!isRecord(raw)) throw new Error('客户端返回了无效结果')
  if (raw.success === false) {
    const error = raw.error
    throw new Error(isRecord(error) ? String(error.message || error.code || '客户端调用失败') : String(error || '客户端调用失败'))
  }
  const outer = isRecord(raw.data) ? raw.data : raw
  return isRecord(outer.data) ? outer.data : outer
}

/** 识别服务返回 → 统一结果；识别出空白文字也算失败（没有识别到文字） */
export function toOutcome(result: HostRecord): OcrOutcome {
  const failed = result.ok === false || result.success === false
  const text = typeof result.text === 'string' ? result.text.trim() : ''
  if (!failed && text) return { ok: true, text }
  if (result.canceled === true) return { ok: false, canceled: true, error: String(result.error || '已取消') }
  if (!failed || result.empty === true) return { ok: false, empty: true, error: '没有识别到文字' }
  return { ok: false, error: String(result.error || '识别失败') }
}

/** 识别单张图片最多等 60 秒；框选要等用户操作，最多 3 分钟 */
const RECOGNIZE_TIMEOUT_MS = 60_000
const REGION_TIMEOUT_MS = 180_000

async function invokeOcr(transport: HostTransport, params: HostRecord, timeoutMs: number): Promise<OcrOutcome> {
  try {
    const raw = await transport('image_ocr', params, timeoutMs)
    return toOutcome(unwrapHostResponse(raw))
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function recognizeImageFile(transport: HostTransport, path: string, language: OcrLanguage): Promise<OcrOutcome> {
  return invokeOcr(transport, { action: 'recognizeImage', path, lang: language.engineCode }, RECOGNIZE_TIMEOUT_MS)
}

export function recognizeClipboardImage(transport: HostTransport, language: OcrLanguage): Promise<OcrOutcome> {
  return invokeOcr(transport, { action: 'recognizeClipboard', lang: language.engineCode }, RECOGNIZE_TIMEOUT_MS)
}

/** 框选前客户端会收起 ZTools 窗口；restoreWindow 为 false 时识别后不再显示（无界面命令，方便直接粘贴） */
export function recognizeScreenRegion(transport: HostTransport, language: OcrLanguage, restoreWindow = true): Promise<OcrOutcome> {
  return invokeOcr(transport, { action: 'captureRegion', lang: language.engineCode, restoreWindow }, REGION_TIMEOUT_MS)
}

/** 选择图片：取消返回空数组；对话框打开失败抛错 */
export async function pickImageFiles(transport: HostTransport): Promise<string[]> {
  const data = unwrapHostResponse(await transport('window_show_open_dialog', {
    title: '选择要识别文字的图片',
    properties: ['openFile', 'multiSelections'],
    filters: `图片|${IMAGE_EXTENSIONS.map(ext => `*.${ext}`).join(';')}`
  }, 300_000))
  if (data.canceled === true) return []
  if (typeof data.filePath === 'string' && data.filePath) return [data.filePath]
  if (Array.isArray(data.filePaths)) {
    const paths = data.filePaths
      .map(item => (typeof item === 'string' ? item : isRecord(item) && typeof item.path === 'string' ? item.path : ''))
      .filter(Boolean)
    if (paths.length > 0) return paths
  }
  throw new Error('文件选择结果无效')
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
