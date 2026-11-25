import { t } from './i18n.js'
import type { FontPreview, InstalledFont } from './types.js'
import { resolveErrorMessage } from './error-i18n.js'
let sequence = 0
interface Reply { success?: boolean; data?: { success?: boolean; fonts?: InstalledFont[]; preview?: FontPreview; revealRequested?: boolean }; error?: { message?: string } }
interface Bridge { transport?: { methods?: Record<string, (request: unknown) => Promise<Reply>> } }
export class FontClient {
  async request(params: Record<string, unknown>, signal: AbortSignal) {
    const methods = (globalThis as unknown as { __ztoolsElectron?: Bridge }).__ztoolsElectron?.transport?.methods
    if (!methods?.font_manager || !methods.font_manager_cancel) throw new Error(t('upgradeClient'))
    signal.throwIfAborted()
    const id = `font_${Date.now()}_${++sequence}`
    const cancel = () => { void methods.font_manager_cancel!({ messageId: `cancel_${id}`, params: { operationId: id }, timeoutMs: 10000 }).catch(error => console.warn('Font cancel request failed', error)) }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      const result = await methods.font_manager({ messageId: id, params: { ...params, operationId: id }, timeoutMs: 30000 })
      signal.throwIfAborted()
      if (result?.success !== true || result.data?.success !== true) throw new Error(resolveErrorMessage(result?.error, t('invalidHostReply')))
      return result.data
    } finally { signal.removeEventListener('abort', cancel) }
  }
  async list(signal: AbortSignal) {
    const { fonts } = await this.request({ action: 'list' }, signal)
    if (!Array.isArray(fonts)) throw new Error(t('fontListFailed'))
    return fonts
  }
  async preview(id: string, text: string, signal: AbortSignal) {
    const { preview } = await this.request({ action: 'preview', id, text }, signal)
    if (!preview || preview.id !== id || !preview.png || !Array.isArray(preview.fallbacks)) throw new Error(t('fontPreviewFailed'))
    return preview
  }
  async reveal(id: string, signal: AbortSignal) {
    if ((await this.request({ action: 'reveal', id }, signal)).revealRequested !== true) throw new Error(t('revealUnconfirmed'))
  }
}
