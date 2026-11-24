import type { FileReference, OfficeDocSummary, OfficeResult } from './types.js'
import { t } from './i18n.js'
import { resolveErrorMessage } from './error-i18n.js'

interface HostBridge {
  transport?: {
    methods?: Record<string, (request: { messageId: string; params: Record<string, unknown>; timeoutMs?: number }) => Promise<unknown>>
  }
}
let sequence = 0
export function formatOfficeBytes(size: number): string {
  return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(2)} MB`
}
export function extractDroppedOfficeDoc(envelopeOrPayload: unknown): FileReference {
  const record = envelopeOrPayload && typeof envelopeOrPayload === 'object' ? (envelopeOrPayload as Record<string, unknown>) : {}
  const payload = record.payload && typeof record.payload === 'object' ? (record.payload as Record<string, unknown>) : record
  const files = Array.isArray(payload.files)
    ? payload.files.filter((f): f is string => typeof f === 'string' && f.trim().length > 0).map(f => f.trim())
    : []
  const matched = files.find(f => /\.(?:docx|pptx|xlsx)$/i.test(f))
  if (!matched) throw new Error(t('errDropOfficeDoc'))
  return { path: matched, displayName: matched.split(/[\\/]/).pop()! }
}
export class OfficeClient {
  constructor(private readonly hostOverride?: HostBridge) {}
  async call<T>(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const bridge = this.hostOverride ?? (globalThis as unknown as { __ztoolsElectron?: HostBridge }).__ztoolsElectron
    const invoke = bridge?.transport?.methods?.[method], cancel = bridge?.transport?.methods?.office_cancel
    if (!invoke || !cancel || !bridge?.transport?.methods?.office_document) throw new Error(t('errNoOfficeApi'))
    signal?.throwIfAborted()
    const messageId = `office_${++sequence}_${Date.now()}`
    let cancelFailure: unknown
    const abort = () => { if (method === 'office_document') void cancel({ messageId: `cancel_${++sequence}`, params: { operationId: params.operationId }, timeoutMs: 10000 }).catch(error => { cancelFailure = error }) }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      // 系统选择/保存窗口等待用户操作，沿用宿主对窗口请求的无限等待；限时会在窗口仍打开时报超时并丢掉之后的选择
      const userDialog = method === 'window_show_open_dialog' || method === 'window_show_save_dialog'
      const result = await invoke({ messageId, params, ...(userDialog ? {} : { timeoutMs: 120000 }) }) as { success?: boolean; data?: T; error?: { message?: string } }
      if (cancelFailure) throw new Error(t('errCancelUnconfirmed'))
      if (result?.success !== true || result.data === undefined) throw new Error(resolveErrorMessage(result?.error, t('errNoValidHostResult')))
      return result.data
    } finally { signal?.removeEventListener('abort', abort) }
  }
  async choose(mode: 'open' | 'save', defaultName?: string, signal?: AbortSignal): Promise<FileReference | null> {
    const extension = defaultName?.match(/\.(docx|pptx|xlsx|zip)$/i)?.[1]?.toLowerCase()
    const saveFilter = extension === 'zip' ? `${t('saveZipFilter')}|*.zip` : extension ? `${t('saveDocFilter', { ext: extension.toUpperCase() })}|*.${extension}` : undefined
    const data = await this.call<{ canceled: boolean; filePath?: string; filePaths?: { path: string }[] }>(mode === 'open' ? 'window_show_open_dialog' : 'window_show_save_dialog',
      mode === 'open' ? { title: t('openDialogTitle'), filters: `${t('openDialogFilter')}|*.docx;*.pptx;*.xlsx`, properties: ['openFile'] } : { title: t('saveDialogTitle'), defaultName: defaultName!, ...(saveFilter ? { filters: saveFilter } : {}) }, signal)
    if (data.canceled === true) return null
    const filePath = data.filePath ?? data.filePaths?.[0]?.path
    if (data.canceled !== false || typeof filePath !== 'string' || !filePath) throw new Error(t('errInvalidFilePick'))
    if (mode === 'save' && extension && !filePath.toLowerCase().endsWith('.' + extension)) throw new Error(extension === 'zip' ? t('errSaveExtensionZip', { ext: extension }) : t('errSaveExtensionCopy', { ext: extension }))
    return { path: filePath, displayName: filePath.split(/[\\/]/).pop()! }
  }

  async inspect(reference: FileReference, signal: AbortSignal): Promise<OfficeDocSummary> {
    const result = await this.call<{ success: boolean; summary: OfficeDocSummary }>('office_document', { action: 'inspect', path: reference.path, operationId: `job_${++sequence}` }, signal)
    const summary = result.summary
    if (!result.success || !summary || !/^[a-f0-9]{64}$/.test(summary.digest) || !Array.isArray(summary.images) || !Number.isSafeInteger(summary.size) || summary.size < 1) throw new Error(t('errInvalidInspect'))
    return summary
  }
  async process(reference: FileReference, summary: OfficeDocSummary, save: FileReference, action: 'slim' | 'extract', cleanMetadata: boolean, signal: AbortSignal): Promise<OfficeResult> {
    const result = await this.call<OfficeResult>('office_document', { action, path: reference.path, outputPath: save.path, digest: summary.digest, cleanMetadata, operationId: `job_${++sequence}` }, signal)
    if (result.success !== true || result.status !== 'committed' || !Number.isSafeInteger(result.size) || result.size <= 0 || typeof result.name !== 'string') throw new Error(t('errSaveUnconfirmed'))
    return result
  }
}
