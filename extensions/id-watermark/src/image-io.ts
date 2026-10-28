import { callHostTransport } from './native-ipc.js'
import { loadImage, MAX_IMAGE_BYTES } from './image-codec.js'
import { renderWatermarkOnImage } from './watermark-service.js'
import type { ImageMetadata, WatermarkOptions } from './types.js'

async function request(method: string, params: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
  signal.throwIfAborted()
  const result = await callHostTransport<Record<string, unknown>>(method, params)
  signal.throwIfAborted()
  if (!result.ok || !result.data || typeof result.data !== 'object' || Array.isArray(result.data)) throw new Error(result.error || '宿主未返回有效结果')
  return result.data
}
function decodeBase64(content: unknown): Uint8Array {
  if (typeof content !== 'string') throw new Error('图片数据缺失')
  const encoded = content.replace(/^data:image\/(?:png|jpeg|jpg|webp);base64,/, '')
  if (!encoded || encoded.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('图片数据无效或超过 16 MiB')
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
  if (data.success !== true || data.size !== bytes.length) throw new Error('原图读取不完整')
  const result = await loadImage(bytes, path.split(/[\\/]/).pop() || '图片', path)
  signal.throwIfAborted(); return result
}
export async function pickImage(signal: AbortSignal): Promise<ImageMetadata | null> {
  const data = await request('window_show_open_dialog', { title: '选择原图', properties: ['openFile'], filters: '图片|*.jpg;*.jpeg;*.png;*.webp' }, signal)
  if (data.canceled === true) return null
  if (data.canceled !== false || typeof data.filePath !== 'string' || !data.filePath) throw new Error('文件选择结果无效')
  return readImagePath(data.filePath, signal)
}
export async function readClipboardImage(signal: AbortSignal): Promise<ImageMetadata> {
  const data = await request('clipboard_read_image', {}, signal)
  if (data.success !== true) throw new Error('剪贴板读取失败')
  if (data.useTempFile === true) {
    if (typeof data.tempFile !== 'string' || !data.tempFile) throw new Error('剪贴板图片文件缺失')
    const result = await readImagePath(data.tempFile, signal)
    return { ...result, fileName: '剪贴板图片.png' }
  }
  if (data.useTempFile !== false) throw new Error('剪贴板图片回执无效')
  if (!data.image) throw new Error('剪贴板中没有图片，请先复制图片')
  const result = await loadImage(decodeBase64(data.image), '剪贴板图片.png')
  signal.throwIfAborted(); return result
}
export async function outputImage(image: ImageMetadata, options: WatermarkOptions, copy: boolean, signal: AbortSignal): Promise<string | null> {
  let outputPath = ''
  if (!copy) {
    const data = await request('window_show_save_dialog', { title: '另存加水印的新副本', defaultName: image.fileName.replace(/\.[^.]+$/, '') + '_水印.png', filters: 'PNG 图片|*.png' }, signal)
    if (data.canceled === true) return null
    if (data.canceled !== false || typeof data.filePath !== 'string' || !/\.png$/i.test(data.filePath)) throw new Error('请使用 .png 扩展名保存新图片')
    outputPath = data.filePath
    if (outputPath === image.path) throw new Error('请另选新文件名，原图不会被覆盖')
  }
  const rendered = await renderWatermarkOnImage(image, options)
  signal.throwIfAborted()
  const bytes = new Uint8Array(await rendered.blob.arrayBuffer()), encoded = encodeBase64(bytes)
  signal.throwIfAborted()
  const data = await request(copy ? 'clipboard_copy_image' : 'filesystem_write_file', copy ? { image: encoded } : { path: outputPath, content: encoded, encoding: 'base64', overwrite: false }, signal)
  if (data.success !== true || (!copy && data.size !== bytes.length)) throw new Error('输出未确认，请检查目标后再试')
  return copy ? '已复制加水印图片' : `已保存新副本：${outputPath}`
}
