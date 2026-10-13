export type ContentType = 'text' | 'url' | 'code' | 'json'

export interface ClipboardEntry {
  id: string
  text: string
  type: ContentType
  length: number
  createTime: number
  pinned: boolean
}

/**
 * 智能探测文本类型
 */
export function detectContentType(text: string): ContentType {
  const trimmed = text.trim()
  if (/^https?:\/\/[^\s]+$/i.test(trimmed)) {
    return 'url'
  }
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      JSON.parse(trimmed)
      return 'json'
    } catch {
      // 忽略
    }
  }
  if (
    trimmed.includes('function ') ||
    trimmed.includes('const ') ||
    trimmed.includes('import ') ||
    trimmed.includes('class ') ||
    trimmed.includes('def ') ||
    trimmed.includes('return ')
  ) {
    return 'code'
  }
  return 'text'
}

/**
 * 添加或更新剪贴板条目（去重并置顶到最新）
 */
export function addClipboardEntry(
  entries: ClipboardEntry[],
  text: string,
  pinned: boolean = false
): ClipboardEntry[] {
  const trimmed = text.trim()
  if (!trimmed) return entries

  // 检查是否已有完全相同内容
  const existing = entries.find(e => e.text === trimmed)
  const isPinned = existing ? existing.pinned : pinned

  const filtered = entries.filter(e => e.text !== trimmed)
  const newEntry: ClipboardEntry = {
    id: existing ? existing.id : `clip-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    text: trimmed,
    type: detectContentType(trimmed),
    length: trimmed.length,
    createTime: Date.now(),
    pinned: isPinned
  }

  return [newEntry, ...filtered]
}

/**
 * 切换置顶状态
 */
export function togglePinEntry(entries: ClipboardEntry[], id: string): ClipboardEntry[] {
  return entries.map(e => {
    if (e.id === id) {
      return { ...e, pinned: !e.pinned }
    }
    return e
  })
}

/**
 * 删除单条记录
 */
export function deleteEntry(entries: ClipboardEntry[], id: string): ClipboardEntry[] {
  return entries.filter(e => e.id !== id)
}

/**
 * 清除所有非置顶记录
 */
export function clearUnpinnedEntries(entries: ClipboardEntry[]): ClipboardEntry[] {
  return entries.filter(e => e.pinned)
}

/**
 * 样例初始数据
 */
export function getSampleClipboardEntries(): ClipboardEntry[] {
  const now = Date.now()
  return [
    {
      id: 'clip-pin-1',
      text: 'https://github.com/raycast/extensions',
      type: 'url',
      length: 37,
      createTime: now - 10000,
      pinned: true
    },
    {
      id: 'clip-2',
      text: 'npm --prefix packages/raycast-compat run test',
      type: 'code',
      length: 45,
      createTime: now - 60000,
      pinned: false
    },
    {
      id: 'clip-3',
      text: '{"status": 200, "message": "Success", "data": {"user": "admin"}}',
      type: 'json',
      length: 64,
      createTime: now - 300000,
      pinned: false
    },
    {
      id: 'clip-4',
      text: '沉浸式 Fluent / Mica 亚克力毛玻璃视觉设计风格',
      type: 'text',
      length: 27,
      createTime: now - 900000,
      pinned: false
    }
  ]
}
