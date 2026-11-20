import { callHostTransport } from './native-ipc.js'
import { loadImage, MAX_IMAGE_BYTES } from './image-codec.js'
import { renderWatermarkOnImage } from './watermark-service.js'
import { t } from './i18n.js'
import type { ImageMetadata, WatermarkOptions } from './types.js'

async function request(method: string, params: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
  signal.throwIfAborted()
  const result = await callHostTransport<Record<string, unknown>>(method, params)
  signal.throwIfAborted()
  if (!result.ok || !result.data || typeof result.data !== 'object' || Array.isArray(result.data)) throw new Error(result.error || t('errHostNoResult'))
  return result.data
}
function decodeBase64(content: unknown): Uint8Array {
  if (typeof content !== 'string') throw new Error(t('errImageDataMissing'))
  const encoded = content.replace(/^data:image\/(?:png|jpeg|jpg|webp);base64,/, '')
  if (!encoded || encoded.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error(t('errImageDataInvalid'))
  return Uint8Array.from(atob(encoded), c => c.charCodeAt(0))
}
function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
  return btoa(binary)
}
async function readImagePath(path: string, signal: AbortSignal): Promise<ImageMetadata> {
  const data = await request('filesystem_read_file', { path, encoding: 'base64' }, signal)
  const bytes = decodeBase64(data.content)
  if (data.success !== true || data.size !== bytes.length) throw new Error(t('errImageReadIncomplete'))
  const result = await loadImage(bytes, path.split(/[\\/]/).pop() || t('defaultImageName'), path)
  signal.throwIfAborted(); return result
}
export async function pickImage(signal: AbortSignal): Promise<ImageMetadata | null> {
  const data = await request('window_show_open_dialog', { title: t('dialogOpenTitle'), properties: ['openFile'], filters: t('dialogOpenFilter') }, signal)
  if (data.canceled === true) return null
  if (data.canceled !== false || typeof data.filePath !== 'string' || !data.filePath) throw new Error(t('errInvalidFilePick'))
  return readImagePath(data.filePath, signal)
}
export async function readDroppedImage(envelopeOrPayload: unknown, signal: AbortSignal): Promise<ImageMetadata> {
  const record = envelopeOrPayload && typeof envelopeOrPayload === 'object' ? (envelopeOrPayload as Record<string, unknown>) : {}
  const payload = record.payload && typeof record.payload === 'object' ? (record.payload as Record<string, unknown>) : record
  const files = Array.isArray(payload.files)
    ? payload.files.filter((f): f is string => typeof f === 'string' && f.trim().length > 0).map(f => f.trim())
    : []
  const matched = files.find(f => /\.(?:jpe?g|png|webp|bmp)$/i.test(f))
  if (!matched) throw new Error(t('errDropFormat'))
  return readImagePath(matched, signal)
}
export async function readClipboardImage(signal: AbortSignal): Promise<ImageMetadata> {
  const data = await request('clipboard_read_image', {}, signal)
  if (data.success !== true) throw new Error(t('errClipboardReadFailed'))
  if (data.useTempFile === true) {
    if (typeof data.tempFile !== 'string' || !data.tempFile) throw new Error(t('errClipboardTempMissing'))
    const result = await readImagePath(data.tempFile, signal)
    return { ...result, fileName: t('clipboardImageFileName') }
  }
  if (data.useTempFile !== false) throw new Error(t('errClipboardReceiptInvalid'))
  if (!data.image) throw new Error(t('errClipboardNoImage'))
  const result = await loadImage(decodeBase64(data.image), t('clipboardImageFileName'))
  signal.throwIfAborted(); return result
}
/** macOS / Windows 默认文件系统不区分大小写，且 macOS 可能返回 NFD 文件名：按宽松规则比较，宁可误拦也不覆盖原图。 */
function samePathText(left: string, right: string): boolean {
  const normalize = (value: string) => value.normalize('NFC').replace(/\\/g, '/').toLowerCase()
  return normalize(left) === normalize(right)
}
// 用户在系统另存为对话框中选择已有文件时，系统已请其确认替换；因此按覆盖写入（宿主原子替换），否则会出现确认替换后仍保存失败。
export async function outputImage(image: ImageMetadata, options: WatermarkOptions, copy: boolean, signal: AbortSignal): Promise<string | null> {
  let outputPath = ''
  if (!copy) {
    const data = await request('window_show_save_dialog', { title: t('dialogSaveTitle'), defaultName: image.fileName.replace(/\.[^.]+$/, '') + t('saveDefaultSuffix'), filters: t('dialogSaveFilter') }, signal)
    if (data.canceled === true) return null
    if (data.canceled !== false || typeof data.filePath !== 'string' || !/\.png$/i.test(data.filePath)) throw new Error(t('errSaveExtPng'))
    outputPath = data.filePath
    if (image.path && samePathText(outputPath, image.path)) throw new Error(t('errSaveSamePath'))
  }
  const rendered = await renderWatermarkOnImage(image, options)
  signal.throwIfAborted()
  const bytes = new Uint8Array(await rendered.blob.arrayBuffer()), encoded = encodeBase64(bytes)
  signal.throwIfAborted()
  const data = await request(copy ? 'clipboard_copy_image' : 'filesystem_write_file', copy ? { image: encoded } : { path: outputPath, content: encoded, encoding: 'base64', overwrite: true }, signal)
  if (data.success !== true || (!copy && data.size !== bytes.length)) throw new Error(t('errOutputUnconfirmed'))
  return copy ? t('statusCopiedWatermark') : t('statusSavedCopy', { path: outputPath })
}
