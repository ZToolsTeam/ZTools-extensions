import type { StackItem } from './types.js'

export const STACK_STORAGE_KEY = 'paste-stack-state-v1'
export interface StackState { version: 1; items: StackItem[]; isListening: boolean; sent?: Array<{ item: StackItem; index: number }> }

/** 系统 readText 已是纯文本；清格式只重写文本格式，不能解析或改写文本内容。 */
export function cleanRichTextToPlain(text: string): string { return text }

export function parseStackState(raw: unknown): StackState {
  if (raw === undefined) return { version: 1, items: [], isListening: true }
  const state = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!state || state.version !== 1 || typeof state.isListening !== 'boolean' || !Array.isArray(state.items) || state.items.length > 500) throw new Error('粘贴栈存储格式无效，原数据保留')
  const sent = state.sent ?? []
  if (!Array.isArray(sent) || state.items.length + sent.length > 500 || sent.some(entry => !entry || !Number.isInteger(entry.index) || entry.index < 0 || entry.index > 499)) throw new Error('已发送记录无效，原数据保留')
  const ids = new Set<string>()
  for (const item of [...state.items, ...sent.map(entry => entry.item)]) {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.text !== 'string' || !item.text.length || typeof item.textPreview !== 'string' || !Number.isFinite(item.timestamp) || typeof item.timeAgo !== 'string' || item.charCount !== item.text.length || (item.sourceApp !== undefined && typeof item.sourceApp !== 'string')) throw new Error('粘贴栈条目无效，原数据保留')
    ids.add(item.id)
  }
  return state as StackState
}

export function stackItem(text: string): StackItem {
  return { id: `stk-${crypto.randomUUID()}`, text, textPreview: text.replace(/\s+/g, ' ').slice(0, 60) || '空白文本', charCount: text.length, timestamp: Date.now(), timeAgo: '刚刚', sourceApp: '系统剪贴板' }
}

/** 订阅宿主过滤后的变化，不轮询读取密码管理器等敏感剪贴板。 */
export async function subscribeStackClipboard(onText: (text: string) => void): Promise<() => Promise<void>> {
  type Envelope = { type?: string; payload?: { type?: string; hasData?: boolean; text?: string } }
  const events = (globalThis as unknown as { ztools?: { events?: {
    subscribeConfirmed(type: string, handler: (event: Envelope) => void): Promise<() => Promise<void>>
  } } }).ztools?.events
  if (!events?.subscribeConfirmed) throw new Error('当前客户端不支持安全剪贴板监听，请升级客户端')
  return events.subscribeConfirmed('clipboard_change', event => {
    if (event.type === 'clipboard_change' && event.payload?.type === 'text' && event.payload.hasData === true && typeof event.payload.text === 'string' && event.payload.text.length) onText(event.payload.text)
  })
}
