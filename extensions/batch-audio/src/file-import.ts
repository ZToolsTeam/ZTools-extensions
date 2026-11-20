/**
 * 文件 / 文件夹导入（选择文件、选择文件夹、拖入或粘贴文件夹并展开其中的文件）。
 *
 * 设计约束：
 * - 不依赖其他共享文件（有的插件没有 native-ipc.ts 或 host-compat.ts），宿主调用由插件注入；
 * - 选择文件夹只用 window_show_select_folder_dialog：宿主为该目录签发递归读写授权，
 *   window_show_open_dialog(openDirectory) 只签发只读授权，需要写入的插件（如批量重命名）会失败；
 * - 遍历已授权目录用 filesystem_get_directory_contents 逐层读取，不依赖文件索引，结果完整；
 * - 不跟随符号链接与联接点（宿主列目录时不把它们当作文件夹），避免跳出授权范围；
 * - 拖入 / 粘贴时不把扩展名交给宿主过滤：旧版客户端会把名称带点的文件夹当成后缀不匹配而拦下，
 *   统一在这里按同一套规则过滤，新旧客户端行为一致；
 * - 所有失败如实返回，不伪造成功。
 */

/** 宿主调用：与各插件已有的 callHostTransport 结果结构一致（data 已解开宿主外层包装） */
export type FileImportTransport = (
  method: string,
  params: Record<string, unknown>
) => Promise<{ ok: boolean; data?: unknown; error?: string }>

export interface FileImportRules {
  /** 允许的扩展名（'.png' 或 'png'，不区分大小写）；不传或为空表示不限 */
  extensions?: readonly string[]
  /** 遍历深度：1 表示只取所选文件夹里的直接子文件；默认 5 */
  maxDepth?: number
  /** 单次导入的文件数上限；默认 500 */
  maxFiles?: number
  /** 单次导入最多读取的目录数；默认 300 */
  maxVisitedDirs?: number
  /** 跳过大小为 0 的文件；默认 true（大小未知时不跳过） */
  skipEmptyFiles?: boolean
  /** 插件自己的排除规则（如本插件生成的输出文件），返回 true 表示跳过 */
  excludeFile?: (name: string, filePath: string) => boolean
  /** 额外跳过的文件夹名（不区分大小写），与默认列表合并 */
  excludeDirNames?: readonly string[]
  /** 受保护路径：命中的文件与文件夹一律跳过；命中所选的根文件夹时直接报错 */
  forbiddenPath?: RegExp
}

export interface ImportedFile {
  path: string
  name: string
  parentDir: string
  /** 小写、带点；没有扩展名时为空字符串 */
  extension: string
  /** 字节数；宿主没有返回时为 null（界面显示“大小未识别”，不填默认值） */
  sizeBytes: number | null
  lastModifiedMs: number | null
}

export interface FileImportResult {
  files: ImportedFile[]
  /** 不符合规则而被忽略的文件数 */
  ignored: number
  /** 达到文件数或目录数上限，只导入了一部分 */
  truncated: boolean
  /** 读取失败的子文件夹（不影响其余文件导入） */
  failedDirs: Array<{ path: string; error: string }>
  canceled: boolean
  /** 整体失败的原因（对话框打不开、所选文件夹读不了等） */
  error?: string
}

export interface FileImportOptions {
  signal?: AbortSignal
  /** 每读完一个目录回调一次，用于显示进度 */
  onProgress?: (progress: { visitedDirs: number; matchedFiles: number }) => void
}

export const DEFAULT_MAX_DEPTH = 5
export const DEFAULT_MAX_FILES = 500
export const DEFAULT_MAX_VISITED_DIRS = 300
/** 宿主一次 filesystem_get_file_size 并发查询的路数 */
const SIZE_QUERY_CONCURRENCY = 8

/** 默认跳过的文件夹：版本库、依赖目录与系统回收站等 */
const DEFAULT_EXCLUDED_DIR_NAMES = [
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '__pycache__',
  '$recycle.bin',
  'system volume information'
]
/** 系统元数据文件 */
const SYSTEM_FILE_NAMES = new Set(['desktop.ini', 'thumbs.db', '.ds_store', 'icon\r'])

function emptyResult(extra: Partial<FileImportResult> = {}): FileImportResult {
  return { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: false, ...extra }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function isWindowsPath(p: string): boolean {
  return /^[A-Za-z]:/.test(p) || p.startsWith('\\\\') || (p.includes('\\') && !p.includes('/'))
}

/** 路径比较键：Windows 路径不区分大小写并统一分隔符，其余平台保持原样 */
export function pathKey(p: string): string {
  const trimmed = String(p || '').trim().replace(/[\\/]+$/, '')
  return isWindowsPath(trimmed) ? trimmed.replace(/\//g, '\\').toLowerCase() : trimmed
}

function baseName(p: string): string {
  return String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || ''
}

function parentOf(p: string): string {
  const stripped = String(p || '').replace(/[\\/]+$/, '')
  const idx = Math.max(stripped.lastIndexOf('/'), stripped.lastIndexOf('\\'))
  if (idx < 0) return ''
  if (idx === 0) return stripped.slice(0, 1)
  const parent = stripped.slice(0, idx)
  return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent
}

function joinChild(dir: string, name: string): string {
  const sep = isWindowsPath(dir) ? '\\' : '/'
  const base = dir.replace(/[\\/]+$/, '')
  return `${base}${sep}${name}`
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

/** 扩展名统一为小写带点；非法写法丢弃 */
export function normalizeExtensions(extensions: readonly string[] | undefined): string[] {
  if (!Array.isArray(extensions)) return []
  const out = new Set<string>()
  for (const raw of extensions) {
    const value = String(raw || '').trim().toLowerCase().replace(/^\*?\./, '')
    if (/^[a-z0-9][a-z0-9+_-]{0,31}$/.test(value)) out.add(`.${value}`)
  }
  return [...out]
}

/** 所选路径是否为整个磁盘（盘符根目录或 /），调用方可据此先请用户确认 */
export function isVolumeRoot(p: string): boolean {
  const trimmed = String(p || '').trim()
  return /^[A-Za-z]:[\\/]?$/.test(trimmed) || trimmed === '/'
}

/** 把宿主常见错误翻译成用户看得懂的提示 */
export function friendlyFileError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? '')
  if (/capability\s*数量超过上限/i.test(text)) {
    return '本窗口已选择的文件过多，请改用「选择文件夹」导入，或稍后再试'
  }
  if (/路径未由当前窗口授权|文件授权窗口已关闭/.test(text)) {
    return '文件授权已过期或未授权，请重新选择文件或文件夹'
  }
  if (/目录条目超过\s*10000/.test(text)) {
    return '文件夹内条目超过 10000 个，请选择更具体的子文件夹'
  }
  if (/METHOD_NOT_FOUND|METHOD_NOT_AVAILABLE|未知方法|is not a function/.test(text)) {
    return '当前 ZTools 版本过低，请升级到最新版本后再试'
  }
  return text || '文件操作失败'
}

interface ResolvedRules {
  extensions: string[]
  maxDepth: number
  maxFiles: number
  maxVisitedDirs: number
  skipEmptyFiles: boolean
  excludeFile?: (name: string, filePath: string) => boolean
  excludedDirNames: Set<string>
  forbiddenPath?: RegExp
}

function positiveInt(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

function resolveRules(rules: FileImportRules = {}): ResolvedRules {
  return {
    extensions: normalizeExtensions(rules.extensions),
    maxDepth: positiveInt(rules.maxDepth, DEFAULT_MAX_DEPTH),
    maxFiles: positiveInt(rules.maxFiles, DEFAULT_MAX_FILES),
    maxVisitedDirs: positiveInt(rules.maxVisitedDirs, DEFAULT_MAX_VISITED_DIRS),
    skipEmptyFiles: rules.skipEmptyFiles !== false,
    excludeFile: rules.excludeFile,
    excludedDirNames: new Set(
      [...DEFAULT_EXCLUDED_DIR_NAMES, ...(rules.excludeDirNames ?? [])].map((n) => String(n).toLowerCase())
    ),
    forbiddenPath: rules.forbiddenPath
  }
}

function testPattern(pattern: RegExp | undefined, value: string): boolean {
  if (!pattern) return false
  pattern.lastIndex = 0
  return pattern.test(value)
}

/** 文件是否符合导入规则（不含大小判断） */
function acceptsFile(name: string, filePath: string, rules: ResolvedRules): boolean {
  const lower = name.toLowerCase()
  if (!name || name.startsWith('.') || name.startsWith('~$') || SYSTEM_FILE_NAMES.has(lower)) return false
  if (rules.extensions.length > 0 && !rules.extensions.includes(extensionOf(name))) return false
  if (testPattern(rules.forbiddenPath, filePath)) return false
  if (rules.excludeFile?.(name, filePath)) return false
  return true
}

function makeImportedFile(filePath: string, sizeBytes: number | null, lastModifiedMs: number | null): ImportedFile {
  const name = baseName(filePath)
  return { path: filePath, name, parentDir: parentOf(filePath), extension: extensionOf(name), sizeBytes, lastModifiedMs }
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, 'zh-CN', { numeric: true, sensitivity: 'base' })
}

interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
  sizeBytes: number | null
  lastModifiedMs: number | null
}

/** 解析 filesystem_get_directory_contents 返回；格式不对返回 null（如实报错，不当作空目录） */
function parseDirectoryListing(dir: string, data: unknown): DirEntry[] | null {
  const record = asRecord(data)
  const rawList: unknown[] | null = Array.isArray(data) ? data : Array.isArray(record?.files) ? (record!.files as unknown[]) : null
  if (!rawList) return null
  const out: DirEntry[] = []
  const dirKey = pathKey(dir)
  for (const item of rawList) {
    const raw = asRecord(item)
    if (!raw || typeof raw.name !== 'string') continue
    const rawName = raw.name.trim()
    if (!rawName || rawName === '.' || rawName === '..') continue
    // 宿主返回文件名；兼容返回完整路径的实现，但只接受确实位于该目录下的条目
    const fullPath = /[\\/]/.test(rawName) ? rawName : joinChild(dir, rawName)
    if (pathKey(parentOf(fullPath)) !== dirKey) continue
    const isDirectory = raw.isDirectory === true || raw.isDir === true
    const size = Number(raw.size)
    const modified = Date.parse(String(raw.lastModified ?? ''))
    out.push({
      name: baseName(fullPath),
      path: fullPath,
      isDirectory,
      sizeBytes: !isDirectory && Number.isFinite(size) && size >= 0 ? size : null,
      lastModifiedMs: Number.isFinite(modified) ? modified : null
    })
  }
  return out
}

function abortedResult(): FileImportResult {
  return emptyResult({ canceled: true })
}

/**
 * 遍历已授权的文件夹，按规则收集文件：按层级由浅到深、同层按名称排序；
 * 达到上限即停止并标记 truncated；子文件夹读取失败只记录，所选的根文件夹读取失败则整体报错。
 */
export async function collectFolderFiles(
  transport: FileImportTransport,
  folderPath: string,
  rules: FileImportRules = {},
  options: FileImportOptions = {}
): Promise<FileImportResult> {
  const root = String(folderPath || '').trim()
  if (!root) return emptyResult({ error: '没有选择文件夹' })
  const resolved = resolveRules(rules)
  if (testPattern(resolved.forbiddenPath, root)) return emptyResult({ error: '该文件夹属于受保护的系统目录，不能导入' })

  const result = emptyResult()
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 1 }]
  let visitedDirs = 0
  while (queue.length > 0) {
    if (options.signal?.aborted) return abortedResult()
    if (visitedDirs >= resolved.maxVisitedDirs) {
      result.truncated = true
      break
    }
    const { dir, depth } = queue.shift()!
    visitedDirs += 1
    const res = await transport('filesystem_get_directory_contents', { path: dir })
    if (options.signal?.aborted) return abortedResult()
    const entries = res.ok ? parseDirectoryListing(dir, res.data) : null
    if (!entries) {
      const error = friendlyFileError(res.ok ? '宿主返回的目录内容格式无效' : res.error || '读取文件夹失败')
      if (dir === root) return emptyResult({ error })
      result.failedDirs.push({ path: dir, error })
      continue
    }
    entries.sort((a, b) => naturalCompare(a.name, b.name))
    for (const entry of entries) {
      if (entry.isDirectory) {
        const lower = entry.name.toLowerCase()
        if (depth < resolved.maxDepth && !entry.name.startsWith('.') && !resolved.excludedDirNames.has(lower) && !testPattern(resolved.forbiddenPath, entry.path)) {
          queue.push({ dir: entry.path, depth: depth + 1 })
        }
        continue
      }
      if (!acceptsFile(entry.name, entry.path, resolved) || (resolved.skipEmptyFiles && entry.sizeBytes === 0)) {
        result.ignored += 1
        continue
      }
      if (result.files.length >= resolved.maxFiles) {
        result.truncated = true
        break
      }
      result.files.push(makeImportedFile(entry.path, entry.sizeBytes, entry.lastModifiedMs))
    }
    options.onProgress?.({ visitedDirs, matchedFiles: result.files.length })
    if (result.truncated) break
  }
  return result
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await task(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** 读取文件大小；宿主未授权或接口不可用时返回 null，不填默认值 */
export async function readFileSize(transport: FileImportTransport, filePath: string): Promise<number | null> {
  const res = await transport('filesystem_get_file_size', { path: filePath })
  if (!res.ok) return null
  const record = asRecord(res.data)
  const size = typeof res.data === 'number' ? res.data : Number(record?.size)
  return Number.isFinite(size) && size >= 0 ? size : null
}

function extractDialogPaths(data: unknown): string[] {
  const record = asRecord(data)
  if (!record) return []
  const out: string[] = []
  if (typeof record.filePath === 'string' && record.filePath.trim()) out.push(record.filePath.trim())
  if (Array.isArray(record.filePaths)) {
    for (const item of record.filePaths) {
      const value = typeof item === 'string' ? item : typeof asRecord(item)?.path === 'string' ? String(asRecord(item)!.path) : ''
      if (value.trim()) out.push(value.trim())
    }
  }
  return out
}

/** 按规则过滤一组文件路径并查询大小（用于对话框选中的文件与拖入的单个文件） */
async function acceptFilePaths(
  transport: FileImportTransport,
  paths: string[],
  resolved: ResolvedRules,
  result: FileImportResult
): Promise<void> {
  const candidates: string[] = []
  for (const filePath of paths) {
    if (!acceptsFile(baseName(filePath), filePath, resolved)) {
      result.ignored += 1
      continue
    }
    if (result.files.length + candidates.length >= resolved.maxFiles) {
      result.truncated = true
      break
    }
    candidates.push(filePath)
  }
  const sizes = await mapWithConcurrency(candidates, SIZE_QUERY_CONCURRENCY, (p) => readFileSize(transport, p))
  candidates.forEach((filePath, index) => {
    const size = sizes[index] ?? null
    if (resolved.skipEmptyFiles && size === 0) {
      result.ignored += 1
      return
    }
    result.files.push(makeImportedFile(filePath, size, null))
  })
}

export interface PickFilesOptions {
  title: string
  /** 对话框里文件类型的名称，如「图片文件」 */
  filterName?: string
  /** 是否允许多选；默认 true */
  multiple?: boolean
}

/**
 * 弹出系统文件选择框（多选），按规则过滤并读取大小。
 * 对话框的类型过滤按宿主要求写成「名称|ext1;ext2」字符串。
 */
export async function pickFiles(
  transport: FileImportTransport,
  rules: FileImportRules = {},
  options: PickFilesOptions
): Promise<FileImportResult> {
  const resolved = resolveRules(rules)
  const params: Record<string, unknown> = {
    title: options.title,
    properties: options.multiple === false ? ['openFile'] : ['openFile', 'multiSelections']
  }
  if (resolved.extensions.length > 0) {
    params.filters = `${options.filterName || '支持的文件'}|${resolved.extensions.map((e) => e.slice(1)).join(';')}`
  }
  const res = await transport('window_show_open_dialog', params)
  if (!res.ok) return emptyResult({ error: friendlyFileError(res.error || '无法打开文件选择框') })
  if (asRecord(res.data)?.canceled === true) return emptyResult({ canceled: true })
  const paths = extractDialogPaths(res.data)
  if (paths.length === 0) return emptyResult({ error: '文件选择框没有返回文件路径' })
  const result = emptyResult()
  await acceptFilePaths(transport, paths, resolved, result)
  return result
}

/** 弹出选择文件夹对话框；宿主为所选文件夹签发递归读写授权 */
export async function pickFolder(
  transport: FileImportTransport,
  options: { title: string; defaultPath?: string }
): Promise<{ canceled: boolean; folderPath?: string; error?: string }> {
  const params: Record<string, unknown> = { title: options.title }
  if (options.defaultPath) params.defaultPath = options.defaultPath
  const res = await transport('window_show_select_folder_dialog', params)
  if (!res.ok) return { canceled: false, error: friendlyFileError(res.error || '无法打开选择文件夹对话框') }
  const record = asRecord(res.data)
  if (record?.canceled === true) return { canceled: true }
  const folderPath = typeof record?.folderPath === 'string' ? record.folderPath.trim() : ''
  if (!folderPath) return { canceled: false, error: '选择文件夹对话框没有返回路径' }
  return { canceled: false, folderPath }
}

/** 选择文件夹并收集其中符合规则的文件 */
export async function pickFolderFiles(
  transport: FileImportTransport,
  rules: FileImportRules = {},
  options: FileImportOptions & { title: string; defaultPath?: string }
): Promise<FileImportResult & { folderPath?: string }> {
  const picked = await pickFolder(transport, { title: options.title, defaultPath: options.defaultPath })
  if (picked.canceled) return emptyResult({ canceled: true })
  if (picked.error || !picked.folderPath) return emptyResult({ error: picked.error || '没有选择文件夹' })
  const collected = await collectFolderFiles(transport, picked.folderPath, rules, options)
  return { ...collected, folderPath: picked.folderPath }
}

async function probeIsDirectory(transport: FileImportTransport, p: string): Promise<boolean> {
  const res = await transport('filesystem_directory_exists', { path: p })
  if (!res.ok) return false
  const record = asRecord(res.data)
  return res.data === true || record?.exists === true
}

/**
 * 展开拖入 / 粘贴的路径：文件夹按规则收集其中的文件，单个文件按同一规则过滤，结果去重。
 * knownDirectories 为宿主确认的文件夹列表；不提供时（旧版客户端）逐个向宿主查询是否为文件夹。
 */
export async function expandInputPaths(
  transport: FileImportTransport,
  paths: readonly string[],
  rules: FileImportRules = {},
  options: FileImportOptions & { knownDirectories?: readonly string[] } = {}
): Promise<FileImportResult> {
  const resolved = resolveRules(rules)
  const list = Array.isArray(paths) ? paths.map((p) => String(p || '').trim()).filter(Boolean) : []
  const known = options.knownDirectories ? new Set(options.knownDirectories.map(pathKey)) : null
  const result = emptyResult()
  const plainFiles: string[] = []
  for (const p of list) {
    if (options.signal?.aborted) return abortedResult()
    const isDir = known ? known.has(pathKey(p)) : await probeIsDirectory(transport, p)
    if (!isDir) {
      plainFiles.push(p)
      continue
    }
    if (result.files.length >= resolved.maxFiles) {
      result.truncated = true
      continue
    }
    const collected = await collectFolderFiles(
      transport,
      p,
      { ...rules, maxFiles: resolved.maxFiles - result.files.length },
      options
    )
    if (collected.canceled) return abortedResult()
    if (collected.error) {
      result.failedDirs.push({ path: p, error: collected.error })
      continue
    }
    result.files.push(...collected.files)
    result.ignored += collected.ignored
    result.truncated = result.truncated || collected.truncated
    result.failedDirs.push(...collected.failedDirs)
  }
  await acceptFilePaths(transport, plainFiles, resolved, result)
  if (options.signal?.aborted) return abortedResult()
  const seen = new Set<string>()
  result.files = result.files.filter((f) => {
    const key = pathKey(f.path)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return result
}

export interface NormalizedFileInput {
  paths: string[]
  /** 宿主确认的文件夹；旧版客户端不提供时为 undefined */
  directories?: string[]
  source: 'drop' | 'paste' | 'launch'
  targetFieldId?: string
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item : typeof asRecord(item)?.path === 'string' ? String(asRecord(item)!.path) : ''))
    .map((item) => item.trim())
    .filter(Boolean)
}

/** 统一解析 onFileInput 载荷、宿主 plugin_files_dropped 事件信封或裸路径数组 */
export function normalizeFileInput(raw: unknown): NormalizedFileInput {
  if (Array.isArray(raw)) return { paths: stringList(raw), source: 'drop' }
  const record = asRecord(raw) ?? {}
  const inner = asRecord(record.payload) ?? record
  const paths = stringList(Array.isArray(inner.files) ? inner.files : inner.paths)
  const source = inner.source === 'paste' || inner.source === 'launch' ? inner.source : 'drop'
  return {
    paths,
    ...(Array.isArray(inner.directories) ? { directories: stringList(inner.directories) } : {}),
    source,
    ...(typeof inner.targetFieldId === 'string' && inner.targetFieldId ? { targetFieldId: inner.targetFieldId } : {})
  }
}

export interface ImportInputConfig {
  /** 是否接收剪贴板截图（落地为临时 PNG）；默认 false */
  allowClipboardImage?: boolean
  dropTitle?: string
  dropSubtitle?: string
  onTextPaste?: (text: string) => boolean | void | Promise<boolean | void>
}

/**
 * 生成可直接展开到 List / Form / Detail 的拖入与粘贴属性：接收文件夹，不把扩展名交给宿主过滤。
 * onInput 内部负责调用 expandInputPaths 并处理失败；这里只做载荷解析。
 */
export function createImportInputProps(
  onInput: (input: NormalizedFileInput) => void | Promise<void>,
  config: ImportInputConfig = {}
): {
  fileInput: { allowDirectories: true } & ImportInputConfig
  onFileInput: (raw: unknown) => void | Promise<void>
} {
  return {
    fileInput: { ...config, allowDirectories: true },
    onFileInput: (raw: unknown) => {
      const input = normalizeFileInput(raw)
      if (input.paths.length === 0) return
      return onInput(input)
    }
  }
}

/** 按路径去重追加：返回合并后的列表、新增项与已存在的数量（不改动已有条目） */
export function mergeByPath<T>(
  existing: readonly T[],
  incoming: readonly T[],
  pathOf: (item: T) => string
): { merged: T[]; added: T[]; duplicates: number } {
  const seen = new Set(existing.map((item) => pathKey(pathOf(item))))
  const added: T[] = []
  let duplicates = 0
  for (const item of incoming) {
    const key = pathKey(pathOf(item))
    if (seen.has(key)) {
      duplicates += 1
      continue
    }
    seen.add(key)
    added.push(item)
  }
  return { merged: [...existing, ...added], added, duplicates }
}

export interface PreloadRawResponse {
  success?: boolean
  data?: unknown
  error?: unknown
  ok?: boolean
}

export type PreloadTransportCaller = (
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number
) => Promise<unknown>

/**
 * 将「直接透传 IPC 原始对象」的宿主调用器适配为 FileImportTransport。
 * 供未使用 native-ipc.ts 的插件共用，处理外层/内层包装解包与缺少接口错误转换。
 */
export function adaptPreloadTransport(
  caller: PreloadTransportCaller | undefined,
  options: {
    notInClientMessage: string
    dialogTimeoutMs?: number
    fileTimeoutMs?: number
  }
): FileImportTransport {
  const dialogTimeout = options.dialogTimeoutMs ?? 300_000
  const fileTimeout = options.fileTimeoutMs ?? 30_000
  const extractErr = (error: unknown): string => {
    const rec = asRecord(error)
    if (rec) return String(rec.message || rec.code || '客户端调用失败')
    return typeof error === 'string' && error.trim() ? error.trim() : '客户端调用失败'
  }
  return async (method, params) => {
    if (!caller) return { ok: false, error: options.notInClientMessage }
    const timeoutMs = method.startsWith('window_show_') ? dialogTimeout : fileTimeout
    try {
      const raw = await caller(method, params, timeoutMs)
      const rec = asRecord(raw)
      if (!rec) return { ok: false, error: '客户端返回了无效结果' }
      if (rec.success === false) return { ok: false, error: extractErr(rec.error) }
      const outer = 'data' in rec ? rec.data : rec
      const outerRec = asRecord(outer)
      if (!outerRec) return { ok: true, data: outer }
      if (outerRec.success === false) return { ok: false, error: extractErr(outerRec.error) }
      const inner = asRecord(outerRec.data) ?? outerRec
      if (inner.success === false || inner.ok === false) return { ok: false, error: extractErr(inner.error) }
      return { ok: true, data: inner }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message.startsWith('客户端不支持 ') ? `METHOD_NOT_AVAILABLE: ${method}` : message }
    }
  }
}

/**
 * 弹出选择文件夹对话框并在选中整个盘符时调用 confirmVolume 确认，确认后再收集目录内符合规则的文件。
 */
export async function pickFolderWithConfirm(
  transport: FileImportTransport,
  rules: FileImportRules,
  options: FileImportOptions & {
    title: string
    defaultPath?: string
    confirmVolume: (folderPath: string) => Promise<boolean>
  }
): Promise<FileImportResult & { folderPath?: string }> {
  const picked = await pickFolder(transport, { title: options.title, defaultPath: options.defaultPath })
  if (options.signal?.aborted || picked.canceled) return emptyResult({ canceled: true })
  if (picked.error || !picked.folderPath) return emptyResult({ error: picked.error || '没有选择文件夹' })
  if (isVolumeRoot(picked.folderPath)) {
    const confirmed = await options.confirmVolume(picked.folderPath)
    if (!confirmed || options.signal?.aborted) return emptyResult({ canceled: true })
  }
  const collected = await collectFolderFiles(transport, picked.folderPath, rules, options)
  return { ...collected, folderPath: picked.folderPath }
}

export interface ControlledImportHooks {
  seqRef: { current: number }
  abortRef: { current: AbortController | null }
  importingRef: { current: boolean }
  unmountedRef: { current: boolean }
  onStateChange: (importing: boolean, progress?: { visitedDirs: number; matchedFiles: number }) => void
  onError: (message: string) => void | Promise<void>
}

/**
 * 受控并发导入执行器：统一处理 AbortController 抢占取消、批次序号校验、进度汇报与卸载安全。
 * 若运行中被清空或卸载，返回 null，调用方直接丢弃结果。
 */
export async function runControlledImport(
  hooks: ControlledImportHooks,
  task: (signal: AbortSignal, onProgress: (p: { visitedDirs: number; matchedFiles: number }) => void) => Promise<FileImportResult>
): Promise<{ result: FileImportResult; seq: number } | null> {
  hooks.abortRef.current?.abort()
  const controller = new AbortController()
  hooks.abortRef.current = controller
  const seq = ++hooks.seqRef.current
  hooks.importingRef.current = true
  hooks.onStateChange(true, undefined)
  try {
    const result = await task(controller.signal, (p) => {
      if (seq === hooks.seqRef.current && !hooks.unmountedRef.current) hooks.onStateChange(true, p)
    })
    if (seq !== hooks.seqRef.current || hooks.unmountedRef.current) return null
    return { result, seq }
  } catch (error) {
    if (seq === hooks.seqRef.current && !hooks.unmountedRef.current) {
      await hooks.onError(friendlyFileError(error))
    }
    return null
  } finally {
    if (seq === hooks.seqRef.current) {
      hooks.abortRef.current = null
      hooks.importingRef.current = false
      if (!hooks.unmountedRef.current) hooks.onStateChange(false, undefined)
    }
  }
}

export interface ImportSummary {
  ok: boolean
  title: string
  message?: string
}

/**
 * 生成导入结果提示；canceled 时返回 null（用户取消不提示）。
 * added / duplicates 由调用方合并后传入；supportedText 用于“没有可导入文件”时说明支持的格式。
 */
export function summarizeImport(
  result: FileImportResult,
  counts: { added: number; duplicates?: number },
  supportedText?: string
): ImportSummary | null {
  if (result.canceled) return null
  if (result.error) return { ok: false, title: '导入失败', message: result.error }
  const duplicates = counts.duplicates ?? 0
  const notes: string[] = []
  if (duplicates > 0) notes.push(`${duplicates} 个已在列表中`)
  if (result.ignored > 0) notes.push(`忽略 ${result.ignored} 个不支持的文件`)
  if (result.truncated) notes.push('文件较多，只导入了一部分')
  if (result.failedDirs.length > 0) notes.push(`${result.failedDirs.length} 个子文件夹无法读取`)
  if (counts.added > 0) return { ok: true, title: `已添加 ${counts.added} 个文件`, message: notes.join('；') || undefined }
  if (duplicates > 0 && result.files.length > 0) return { ok: false, title: '这些文件已在列表中', message: notes.join('；') || undefined }
  return {
    ok: false,
    title: '没有找到可导入的文件',
    message: [supportedText ? `支持 ${supportedText}` : '', ...notes].filter(Boolean).join('；') || undefined
  }
}
