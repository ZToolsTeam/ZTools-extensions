import { callHostTransport } from './native-ipc.js'

/** 目录扫描失败必须传播；空的成功结果与能力/权限失败分开。 */
export async function scanRealDirectoryTree(directory: string, limit: number, hostOverride?: unknown) {
  const result = await callHostTransport<Record<string, unknown>>('system_search_files', { query: `dir:${directory}`, limit }, hostOverride)
  const data = result.data
  if (!result.ok || !data || !Array.isArray(data.files)) throw new Error(`${directory}: ${result.error || '目录扫描结果无效'}`)
  if (data.degraded || data.partial) throw new Error(`${directory}: 目录扫描未完整返回，请检查访问权限后重试`)
  return {
    files: data.files.map((value: unknown) => {
      if (!value || typeof value !== 'object') throw new Error(`${directory}: 文件记录无效`)
      const file = value as Record<string, unknown>
      return {
      path: String(file.path || ''), name: String(file.name || ''),
      isDir: Boolean(file.is_dir ?? file.isDir ?? file.isDirectory),
      size: Number(file.size ?? file.sizeBytes ?? 0), mtime: Number(file.mtime ?? 0)
      }
    }),
    subdirs: (Array.isArray(data.subdirs) ? data.subdirs : []).map((value: unknown) => {
      if (!value || typeof value !== 'object') throw new Error(`${directory}: 子目录记录无效`)
      const dir = value as Record<string, unknown>
      return {
      path: String(dir.path || ''), name: String(dir.name || ''),
      fileCount: Number(dir.file_count ?? dir.fileCount ?? 0),
      totalBytes: Number(dir.total_bytes ?? dir.totalBytes ?? 0), approximate: dir.approximate === true
      }
    }),
    truncated: data.truncated === true,
    visitedEntries: typeof data.visited_entries === 'number' && Number.isFinite(data.visited_entries) ? data.visited_entries : undefined
  }
}
