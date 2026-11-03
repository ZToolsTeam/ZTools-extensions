import type { MacroResolveResult, SnippetCategory, SnippetFormInput, SnippetItem } from './types'

const MAX_CLIPBOARD_EMBED_LEN = 32768

export function getSnippetCategoryLabel(category: SnippetCategory): string {
  switch (category) {
    case 'invoice':
      return '发票与开票信息'
    case 'address':
      return '常用地址与联系人'
    case 'customer_service':
      return '客服与商务话术'
    case 'code':
      return '开发与代码片段'
    default:
      return '通用短语'
  }
}

export function formatMacroDateParts(now = new Date()): {
  date: string
  time: string
  datetime: string
} {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  const date = `${y}-${m}-${d}`
  const time = `${hh}:${mm}:${ss}`
  return {
    date,
    time,
    datetime: `${date} ${time}`
  }
}

export function resolveMacroTemplate(
  template: string,
  clipboardText = '',
  options?: { fixedDate?: string; fixedTime?: string; fixedDatetime?: string }
): MacroResolveResult {
  const raw = String(template || '')
  if (!raw) {
    return { text: '', cursorOffsetFromEnd: 0 }
  }

  const parts = formatMacroDateParts()
  const dateVal = options?.fixedDate ?? parts.date
  const timeVal = options?.fixedTime ?? parts.time
  const datetimeVal = options?.fixedDatetime ?? `${dateVal} ${timeVal}`
  const safeClip = String(clipboardText || '').slice(0, MAX_CLIPBOARD_EMBED_LEN)

  // 只扫描原模板；插入值是字面文本，不能再次解释其中的宏或 $ 替换语法。
  const values: Record<string, string> = { date: dateVal, time: timeVal, datetime: datetimeVal, clipboard: safeClip }
  let text = '', offset = 0, cursorIndex: number | undefined
  for (const match of raw.matchAll(/\{(date|time|datetime|clipboard|cursor)\}/g)) {
    text += raw.slice(offset, match.index)
    if (match[1] === 'cursor') cursorIndex ??= text.length
    else text += values[match[1]]
    offset = match.index + match[0].length
  }
  text += raw.slice(offset)
  return { text, cursorOffsetFromEnd: cursorIndex === undefined ? 0 : text.length - cursorIndex }
}

export function validateSnippetInput(input: SnippetFormInput): {
  valid: boolean
  error?: string
} {
  if (!input || !String(input.title || '').trim()) {
    return {
      valid: false,
      error: 'SNIPPET_INVALID_INPUT: 短语标题不能为空'
    }
  }
  if (!String(input.content || '').trim()) {
    return {
      valid: false,
      error: 'SNIPPET_INVALID_INPUT: 短语模板内容不能为空'
    }
  }
  return { valid: true }
}

export class SnippetStoreRepository {
  #items: SnippetItem[] = []

  constructor(initialItems: SnippetItem[] = []) {
    this.#items = [...initialItems]
  }

  list(): SnippetItem[] {
    return [...this.#items]
  }

  save(input: SnippetFormInput, nowMs = Date.now()): SnippetItem {
    const check = validateSnippetInput(input)
    if (!check.valid) {
      throw new Error(check.error)
    }

    // 内容按用户输入原样保存：代码片段首行缩进、结尾换行都是内容的一部分，只用 trim 判断是否为空
    const content = input.content
    const previewText = content.trim().replace(/\s+/g, ' ').slice(0, 72)
    const category = input.category || 'general'
    const existingIdx = input.id ? this.#items.findIndex((s) => s.id === input.id) : -1

    if (existingIdx >= 0) {
      const prev = this.#items[existingIdx]!
      const updated: SnippetItem = {
        ...prev,
        title: input.title.trim(),
        category,
        categoryLabel: getSnippetCategoryLabel(category),
        keyword: input.keyword?.trim() || undefined,
        content,
        previewText,
        updatedAt: nowMs
      }
      this.#items[existingIdx] = updated
      return updated
    }

    const created: SnippetItem = {
      id: input.id || `snip-${nowMs}-${this.#items.length + 1}`,
      title: input.title.trim(),
      category,
      categoryLabel: getSnippetCategoryLabel(category),
      keyword: input.keyword?.trim() || undefined,
      content,
      previewText,
      useCount: 0,
      updatedAt: nowMs
    }
    this.#items.unshift(created)
    return created
  }

  delete(id: string): boolean {
    const before = this.#items.length
    this.#items = this.#items.filter((i) => i.id !== id)
    return this.#items.length < before
  }
}
