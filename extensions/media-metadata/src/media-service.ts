import type { CleaningMode, MediaMetadataSummary, SavedMedia } from './types.js'
let sequence = 0
interface Bridge { transport?: { methods?: Record<string, (request: unknown) => Promise<unknown>> } }
export function mediaSize(bytes: number) { return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB` }
/** 可清理照片类型对应的副本扩展名与保存窗口筛选；宿主同样只接受这些扩展名 */
export function photoFormat(type: string) {
  const extensions = type === 'JPEG' ? ['jpg', 'jpeg'] : type === 'PNG' ? ['png'] : type === 'HEIF' ? ['heif', 'heic'] : type === 'HEIC' ? ['heic', 'heif'] : undefined
  return extensions ? { extensions, filter: `${type} 图片|${extensions.map(extension => '*.' + extension).join(';')}` } : undefined
}
export class MediaClient {
  async request<T>(method: string, params: Record<string, unknown>, signal: AbortSignal): Promise<T> {
    const methods = (globalThis as unknown as { __ztoolsElectron?: Bridge }).__ztoolsElectron?.transport?.methods
    if (!methods?.media_metadata || !methods.media_metadata_cancel || !methods[method]) throw new Error('请升级客户端后使用照片隐私清理')
    signal.throwIfAborted()
    const id = `media_${Date.now()}_${++sequence}`
    const payload = method === 'media_metadata' ? { ...params, operationId: id } : params
    let cancellationError = false
    const cancel = () => { if (method === 'media_metadata') void methods.media_metadata_cancel!({ messageId: `cancel_${id}`, params: { operationId: id }, timeoutMs: 10000 }).catch(() => { cancellationError = true }) }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      // 系统选择/保存窗口等待用户操作，不加时限（宿主默认无限等待）；限时会在窗口仍打开时报超时并丢掉之后的选择
      const userDialog = method === 'window_show_open_dialog' || method === 'window_show_save_dialog'
      const reply = await methods[method]!({ messageId: id, params: payload, ...(userDialog ? {} : { timeoutMs: 120000 }) }) as { success?: boolean; data?: T; error?: { message?: string } }
      if (cancellationError) throw new Error('中止请求未确认，请检查副本保存结果')
      if (reply?.success !== true || reply.data === undefined) throw new Error(reply?.error?.message || '媒体处理未返回有效结果')
      return reply.data
    } finally { signal.removeEventListener('abort', cancel) }
  }
  async choose(signal: AbortSignal, saveName?: string, saveType?: string): Promise<string | null> {
    const saveFormat = saveType ? photoFormat(saveType) : undefined
    const data = await this.request<{ canceled: boolean; filePath?: string; filePaths?: { path: string }[] }>(saveName ? 'window_show_save_dialog' : 'window_show_open_dialog', saveName
      ? { title: '另存清理后的副本', defaultName: saveName, ...(saveFormat ? { filters: saveFormat.filter } : {}) }
      : { title: '选择照片或音视频', filters: '媒体文件|*.jpg;*.jpeg;*.png;*.heic;*.heif;*.mp4;*.mov;*.mp3;*.m4a;*.wav;*.flac', properties: ['openFile'] }, signal)
    if (data.canceled) return null
    const selected = data.filePath ?? data.filePaths?.[0]?.path
    if (data.canceled !== false || typeof selected !== 'string' || !selected) throw new Error('文件选择结果无效')
    if (saveFormat && !saveFormat.extensions.some(extension => selected.toLowerCase().endsWith('.' + extension))) throw new Error(`请使用与原照片一致的扩展名保存（.${saveFormat.extensions.join(' / .')}）`)
    return selected
  }
  async inspect(path: string, signal: AbortSignal) {
    const data = await this.request<{ success: boolean; summary: MediaMetadataSummary }>('media_metadata', { action: 'inspect', path }, signal)
    if (!data.success || !data.summary || !Array.isArray(data.summary.fields) || !/^[a-f0-9]{64}$/.test(data.summary.digest)) throw new Error('读取媒体参数失败')
    return data.summary
  }
  async clean(path: string, summary: MediaMetadataSummary, outputPath: string, mode: CleaningMode, signal: AbortSignal) {
    const result = await this.request<SavedMedia>('media_metadata', { action: 'clean', path, outputPath, digest: summary.digest, mode }, signal)
    if (result.success !== true || result.status !== 'committed' || !Number.isSafeInteger(result.size) || result.size <= 0 || typeof result.name !== 'string') throw new Error('没有确认副本保存成功')
    return result
  }
}
