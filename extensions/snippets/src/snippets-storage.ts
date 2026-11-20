import { LocalStorage } from '@ztools/declarative-ui'
import type { SnippetItem } from './types.js'
import { t } from './i18n.js'

export const SNIPPETS_STORAGE_KEY = 'ztools.snippets.items.v1'

export function parseStoredSnippets(raw: unknown): SnippetItem[] {
  if (raw === undefined) return []
  if (typeof raw !== 'string') throw new Error(t('errInvalidStorageFormat'))
  const items = JSON.parse(raw) as SnippetItem[]
  if (!Array.isArray(items) || items.some(item => !item || typeof item.id !== 'string' || !item.id || typeof item.title !== 'string' || typeof item.content !== 'string') || new Set(items.map(item => item.id)).size !== items.length) {
    throw new Error(t('errInvalidStorageFormat'))
  }
  return items
}

/** 使用次数变化不算编辑冲突；内容被修改或删除后，旧表单不能覆盖或重建条目。 */
export function assertSnippetUnchanged(items: SnippetItem[], expected: SnippetItem): void {
  const current = items.find(item => item.id === expected.id)
  const fields = ['title', 'content', 'category', 'keyword', 'updatedAt'] as const
  if (!current || fields.some(field => current[field] !== expected[field])) {
    throw new Error(t('errConcurrentModified'))
  }
}

export async function updateSnippets(update: (items: SnippetItem[]) => SnippetItem[]): Promise<SnippetItem[]> {
  if (typeof LocalStorage.updateItem !== 'function') throw new Error(t('errAtomicStorageUnsupported'))
  // SDK 会通过宿主比较并交换，发生并发写入时重新读取；不退回非原子的读后覆盖。
  const stored = await LocalStorage.updateItem(SNIPPETS_STORAGE_KEY, raw => JSON.stringify(update(parseStoredSnippets(raw))))
  return parseStoredSnippets(stored)
}
