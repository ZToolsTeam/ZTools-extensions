import type { ImageMetadata } from './types.js'

export const MAX_IMAGE_BYTES = 16 * 1024 * 1024
export function checkImageDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 8 * 1024 * 1024)
    throw new Error('图片尺寸超过上限：边长最多 8192 像素，总计最多 800 万像素')
}
/** 解码前限制像素数；实际格式和完整性仍由图像解码器确认。 */
export function inspectImageHeader(bytes: Uint8Array): void {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12 || bytes.length > MAX_IMAGE_BYTES) throw new Error('请选择 16 MiB 以内的 JPG、PNG 或 WebP 图片')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4))
  if (bytes.length >= 24 && bytes[0] === 137 && tag(1) === 'PNG\r' && tag(12) === 'IHDR') {
    checkImageDimensions(view.getUint32(16), view.getUint32(20)); return
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break
      while (offset < bytes.length && bytes[offset] === 255) offset++
      const marker = bytes[offset++]
      if (marker === 218 || marker === 217 || offset + 2 > bytes.length) break
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) break
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 8) {
        checkImageDimensions(view.getUint16(offset + 5), view.getUint16(offset + 3)); return
      }
      offset += length
    }
  }
  if (tag(0) === 'RIFF' && tag(8) === 'WEBP' && bytes.length >= 30) {
    const kind = tag(12)
    if (kind === 'VP8X') {
      if (bytes[20] & 2) throw new Error('请使用静态图片，暂不处理动态 WebP')
      const u24 = (i: number) => bytes[i] | bytes[i + 1] << 8 | bytes[i + 2] << 16
      checkImageDimensions(u24(24) + 1, u24(27) + 1); return
    }
    if (kind === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
      checkImageDimensions(view.getUint16(26, true) & 16383, view.getUint16(28, true) & 16383); return
    }
    if (kind === 'VP8L' && bytes[20] === 47) {
      const size = view.getUint32(21, true)
      checkImageDimensions((size & 16383) + 1, ((size >>> 14) & 16383) + 1); return
    }
  }
  throw new Error('图片文件头无效，无法确定真实尺寸')
}
export async function decodeImage(bytes: Uint8Array): Promise<ImageBitmap> {
  inspectImageHeader(bytes)
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') throw new Error('客户端缺少本地图像处理能力，请升级后重试')
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes).buffer]))
  try { checkImageDimensions(bitmap.width, bitmap.height) } catch (error) { bitmap.close(); throw error }
  return bitmap
}
export async function loadImage(bytes: Uint8Array, fileName: string, path?: string): Promise<ImageMetadata> {
  const bitmap = await decodeImage(bytes)
  try { return { fileName, path, width: bitmap.width, height: bitmap.height, rawBytes: bytes } }
  finally { bitmap.close() }
}
