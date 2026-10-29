import type { ConvertOptions, DocSummary } from './types.js'
interface Bridge { transport?: { methods?: Record<string, (request: unknown) => Promise<{ success?: boolean; data?: unknown; error?: { message?: string } }>> } }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
let serial = 0
const id = () => `markdown_${Date.now()}_${++serial}`
export function validMarkdown(text: string) {
  if (!text.trim() || new TextEncoder().encode(text).length > 256 * 1024) throw new Error('请输入 Markdown 文本，最多 256 KiB')
}
export function parseSummary(value: unknown): DocSummary {
  if (!object(value) || typeof value.title !== 'string' || !value.title || !Number.isSafeInteger(value.characters) || Number(value.characters) < 1 || !Number.isSafeInteger(value.blocks) || Number(value.blocks) < 1 || !Array.isArray(value.warnings) || value.warnings.some(v => typeof v !== 'string')) throw new Error('文档分析结果无效')
  return value as unknown as DocSummary
}
/** 是否含 Markdown 标题（ATX `# 标题` 或 Setext 下划线标题），代码块内的不算 */
export function hasHeading(markdown: string) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  let fence = ''
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], marker = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1]
    if (marker) { if (!fence) fence = marker[0]; else if (marker[0] === fence) fence = ''; continue }
    if (fence) continue
    if (/^ {0,3}#{1,6}[ \t]+\S/.test(line)) return true
    if (i > 0 && /^ {0,3}(=+|-+)[ \t]*$/.test(line) && lines[i - 1].trim() && !/^ {0,3}([-*+]|\d+[.)]|>|#)/.test(lines[i - 1])) return true
  }
  return false
}
/** 文档名：有标题用宿主解析出的首个标题；没有标题时宿主会拿第一行正文，改用来源名称（如“剪贴板内容”） */
export function documentTitle(markdown: string, hostTitle: string, fallback: string) {
  return hasHeading(markdown) ? hostTitle : fallback
}
/** 默认文件名：替换系统不允许的字符，去掉开头的点（macOS 会变成隐藏文件）和首尾空白 */
export function docxName(title: string) {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_').replace(/^[\s.]+/, '').trim().slice(0, 90).replace(/[\s.]+$/, '')
  return (base || 'Markdown 文档') + '.docx'
}
export class MarkdownClient {
  private operation: string | undefined
  async call(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const fn = (globalThis as unknown as { __ztoolsElectron?: Bridge }).__ztoolsElectron?.transport?.methods?.[method]
    if (!fn) throw new Error('请升级客户端后使用文档转换')
    const userDialog = method === 'window_show_open_dialog' || method === 'window_show_save_dialog'
    const response = await fn({ messageId: id(), params, ...(!userDialog ? { timeoutMs: 120000 } : {}) })
    if (response?.success !== true || !object(response.data) || response.data.success === false) throw new Error(response?.error?.message || '宿主未返回有效结果')
    return response.data
  }
  async document(action: string, params: Record<string, unknown>) {
    const operationId = id(); this.operation = operationId
    try { const result = await this.call('markdown_document', { action, operationId, ...params }); if (result.success !== true) throw new Error('文档操作未确认成功'); return result }
    finally { if (this.operation === operationId) this.operation = undefined }
  }
  async cancel() {
    if (!this.operation) return
    const result = await this.call('markdown_document', { action: 'cancel', operationId: this.operation })
    if (result.success !== true || typeof result.cancelRequested !== 'boolean') throw new Error('文档取消请求未确认')
  }
  async clipboard() {
    const result = await this.call('clipboard_read_text', {})
    if (typeof result.text !== 'string') throw new Error('剪贴板读取结果无效')
    validMarkdown(result.text); return result.text
  }
  async choose(mode: 'open' | 'save', title = 'Markdown 文档') {
    const result = await this.call(mode === 'open' ? 'window_show_open_dialog' : 'window_show_save_dialog', mode === 'open'
      ? { title: '选择 UTF-8 Markdown 文件', filters: 'Markdown 文本|*.md;*.markdown;*.txt', properties: ['openFile'] }
      : { title: '另存 Word 新副本', defaultName: docxName(title), filters: 'Word 文档|*.docx' })
    if (result.canceled === true) return null
    const file = result.filePath ?? (Array.isArray(result.filePaths) && object(result.filePaths[0]) ? result.filePaths[0].path : undefined)
    if (result.canceled !== false || typeof file !== 'string' || !file) throw new Error('文件选择结果无效')
    // 宿主只接受 .docx 输出；macOS 保存面板可删掉扩展名，这里先给出明确原因，不让用户看到笼统的参数错误
    if (mode === 'save' && !/\.docx$/i.test(file)) throw new Error('请以 .docx 扩展名保存 Word 文件')
    return file
  }
  async read(path: string) {
    const result = await this.document('read', { path })
    if (typeof result.markdown !== 'string') throw new Error('文件读取结果无效')
    validMarkdown(result.markdown); return result.markdown
  }
  async inspect(markdown: string, options: ConvertOptions) {
    validMarkdown(markdown); return parseSummary((await this.document('inspect', { markdown, options })).summary)
  }
  async copy(markdown: string, options: ConvertOptions) {
    validMarkdown(markdown); const result = await this.document('copy', { markdown, options })
    if (result.copied !== true) throw new Error('富文本复制未确认')
    return parseSummary(result.summary)
  }
  async export(markdown: string, options: ConvertOptions, outputPath: string) {
    validMarkdown(markdown); const result = await this.document('export', { markdown, options, outputPath })
    if (result.status !== 'committed' || !Number.isSafeInteger(result.size) || Number(result.size) < 1 || typeof result.name !== 'string' || !result.name) throw new Error('保存结果未确认，请检查目标文件')
    parseSummary(result.summary)
    return { name: result.name, size: Number(result.size) }
  }
}
