export interface MemoItem {
  id: string
  title: string
  content: string
  tag: string
  createTime: number
  updateTime: number
}

/**
 * 创建新便签
 */
export function createMemo(
  items: MemoItem[],
  title: string,
  content: string,
  tag: string = ''
): MemoItem[] {
  const cleanTitle = title.trim() || '无标题便签'
  const cleanContent = content.trim()
  const now = Date.now()

  const newItem: MemoItem = {
    id: `memo-${now}-${Math.floor(Math.random() * 1000)}`,
    title: cleanTitle,
    content: cleanContent,
    tag: tag.trim(),
    createTime: now,
    updateTime: now
  }

  return [newItem, ...items]
}

/**
 * 更新现有便签
 */
export function updateMemo(
  items: MemoItem[],
  id: string,
  updates: Partial<Pick<MemoItem, 'title' | 'content' | 'tag'>>
): MemoItem[] {
  return items.map(item => {
    if (item.id === id) {
      return {
        ...item,
        ...updates,
        updateTime: Date.now()
      }
    }
    return item
  })
}

/**
 * 删除便签
 */
export function deleteMemo(items: MemoItem[], id: string): MemoItem[] {
  return items.filter(item => item.id !== id)
}

/**
 * 按标题、正文、标签检索；最近更新的排在前面
 */
export function filterMemos(items: MemoItem[], query: string): MemoItem[] {
  const q = (query || '').trim().toLowerCase()
  const list = q
    ? items.filter(m => m.title.toLowerCase().includes(q) || m.content.toLowerCase().includes(q) || m.tag.toLowerCase().includes(q))
    : items
  return [...list].sort((a, b) => b.updateTime - a.updateTime)
}

export const MEMOS_STORAGE_KEY = 'memo.items.v1'

/** 旧版本直接写在浏览器 localStorage 里的键 */
export const LEGACY_LOCALSTORAGE_KEY = 'ztools_memo_items'

/** 旧版本自带的 3 条示例便签，迁移时不带过来 */
const LEGACY_SAMPLE_IDS = new Set(['memo-1', 'memo-2', 'memo-3'])

/**
 * 校验从存储读回的便签：结构不对的条目直接丢弃
 */
export function sanitizeStoredMemos(raw: unknown): MemoItem[] {
  if (!Array.isArray(raw)) return []
  const out: MemoItem[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const m = item as Record<string, unknown>
    if (typeof m.id !== 'string' || seen.has(m.id)) continue
    if (typeof m.title !== 'string' || typeof m.content !== 'string') continue
    seen.add(m.id)
    const createTime = typeof m.createTime === 'number' ? m.createTime : 0
    out.push({
      id: m.id,
      title: m.title,
      content: m.content,
      tag: typeof m.tag === 'string' ? m.tag : '',
      createTime,
      updateTime: typeof m.updateTime === 'number' ? m.updateTime : createTime
    })
  }
  return out
}

/**
 * 读取旧版存在浏览器 localStorage 的便签（过滤掉示例数据）；读不到或已损坏时返回空数组
 */
export function readLegacyMemos(storage: { getItem(key: string): string | null } | undefined = (globalThis as any).localStorage): MemoItem[] {
  try {
    const raw = storage?.getItem(LEGACY_LOCALSTORAGE_KEY)
    if (!raw) return []
    return sanitizeStoredMemos(JSON.parse(raw)).filter(m => !LEGACY_SAMPLE_IDS.has(m.id))
  } catch {
    return []
  }
}
