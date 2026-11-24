import { t } from './i18n.js'
import type { CleaningMode, MediaMetadataSummary, SavedMedia } from './types.js'
import { resolveErrorMessage } from './error-i18n.js'
let sequence = 0
interface Bridge { transport?: { methods?: Record<string, (request: unknown) => Promise<unknown>> } }
export function mediaSize(bytes: number) { return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB` }
/** 可清理照片类型对应的副本扩展名与保存窗口筛选；宿主同样只接受这些扩展名 */
export function photoFormat(type: string) {
  const extensions = type === 'JPEG' ? ['jpg', 'jpeg'] : type === 'PNG' ? ['png'] : type === 'HEIF' ? ['heif', 'heic'] : type === 'HEIC' ? ['heic', 'heif'] : undefined
  return extensions ? { extensions, filter: t('filterImageFormat', { type, pattern: extensions.map(extension => '*.' + extension).join(';') }) } : undefined
}
export function extractDroppedMediaPath(envelopeOrPayload: unknown): string {
  const record = envelopeOrPayload && typeof envelopeOrPayload === 'object' ? (envelopeOrPayload as Record<string, unknown>) : {}
  const payload = record.payload && typeof record.payload === 'object' ? (record.payload as Record<string, unknown>) : record
  const files = Array.isArray(payload.files)
    ? payload.files.filter((f): f is string => typeof f === 'string' && f.trim().length > 0).map(f => f.trim())
    : []
  const matched = files.find(f => /\.(?:jpe?g|png|heic|heif|mp4|mov|mp3|m4a|wav|flac)$/i.test(f))
  if (!matched) throw new Error(t('errDropMedia'))
  return matched
}
export class MediaClient {
  async request<T>(method: string, params: Record<string, unknown>, signal: AbortSignal): Promise<T> {
    const methods = (globalThis as unknown as { __ztoolsElectron?: Bridge }).__ztoolsElectron?.transport?.methods
    if (!methods?.media_metadata || !methods.media_metadata_cancel || !methods[method]) throw new Error(t('errUpgradeClient'))
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
      if (cancellationError) throw new Error(t('errCancelNotConfirmed'))
      if (reply?.success !== true || reply.data === undefined) throw new Error(resolveErrorMessage(reply?.error, t('errInvalidMediaResult')))
      return reply.data
    } finally { signal.removeEventListener('abort', cancel) }
  }
  async choose(signal: AbortSignal, saveName?: string, saveType?: string): Promise<string | null> {
    const saveFormat = saveType ? photoFormat(saveType) : undefined
    const data = await this.request<{ canceled: boolean; filePath?: string; filePaths?: { path: string }[] }>(saveName ? 'window_show_save_dialog' : 'window_show_open_dialog', saveName
      ? { title: t('saveDialogTitle'), defaultName: saveName, ...(saveFormat ? { filters: saveFormat.filter } : {}) }
      : { title: t('openDialogTitle'), filters: t('openDialogFilters'), properties: ['openFile'] }, signal)
    if (data.canceled) return null
    const selected = data.filePath ?? data.filePaths?.[0]?.path
    if (data.canceled !== false || typeof selected !== 'string' || !selected) throw new Error(t('errInvalidFileChoice'))
    if (saveFormat && !saveFormat.extensions.some(extension => selected.toLowerCase().endsWith('.' + extension))) throw new Error(t('errRequireMatchingExt', { exts: saveFormat.extensions.join(' / .') }))
    return selected
  }
  async inspect(path: string, signal: AbortSignal) {
    const data = await this.request<{ success: boolean; summary: MediaMetadataSummary }>('media_metadata', { action: 'inspect', path }, signal)
    if (!data.success || !data.summary || !Array.isArray(data.summary.fields) || !/^[a-f0-9]{64}$/.test(data.summary.digest)) throw new Error(t('errInspectFailed'))
    return data.summary
  }
  async clean(path: string, summary: MediaMetadataSummary, outputPath: string, mode: CleaningMode, signal: AbortSignal) {
    const result = await this.request<SavedMedia>('media_metadata', { action: 'clean', path, outputPath, digest: summary.digest, mode }, signal)
    if (result.success !== true || result.status !== 'committed' || !Number.isSafeInteger(result.size) || result.size <= 0 || typeof result.name !== 'string') throw new Error(t('errSaveNotConfirmed'))
    return result
  }
}
