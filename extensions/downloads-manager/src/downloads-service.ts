import {
  callHostTransport, formatBytes
} from './native-ipc.js'
import { readDownloadPreferences, updateDownloadPreferences } from './downloads-preferences.js'
import type {
  CleanResult,
  DownloadEntry,
  DownloadFileCategory,
  DownloadsDashboardSummary,
  DownloadSourceChannel,
  DownloadSourceDescriptor
} from './types.js'

const INSTALLER_EXTS = new Set([
  '.exe', '.msi', '.dmg', '.pkg', '.deb', '.rpm', '.appimage', '.apk', '.msix'
])
const ARCHIVE_EXTS = new Set([
  '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.tgz', '.zst', '.iso'
])
const DOCUMENT_EXTS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.csv', '.txt', '.md', '.rtf', '.epub', '.ofd'
])
const IMAGE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.heic', '.psd', '.tif', '.tiff'
])
const MEDIA_EXTS = new Set([
  '.mp4', '.mkv', '.mov', '.avi', '.webm', '.flv', '.wmv', '.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg'
])
const CODE_EXTS = new Set([
  '.json', '.yaml', '.yml', '.xml', '.sql', '.ts', '.tsx', '.js', '.mjs', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.cs', '.sh', '.ps1', '.bat', '.log'
])

const TEMP_DOWNLOAD_SUFFIXES = [
  '.crdownload',
  '.part',
  '.partial',
  '.opdownload',
  '.download',
  '.td',
  '.xltd',
  '.baiduyun.p.downloading',
  '.aria2',
  '.tmp'
]

export function isDownloadTemporaryOrHiddenFile(fileName: string): boolean {
  const lower = String(fileName || '').trim().toLowerCase()
  // 以 . 开头的是 macOS / Linux 隐藏文件（如下载目录里的 .localized、._ 资源分叉文件）；Icon\r 是访达自定义图标文件
  if (!lower || lower === 'desktop.ini' || lower === 'thumbs.db' || lower.startsWith('.') || fileName === 'Icon\r') {
    return true
  }
  return TEMP_DOWNLOAD_SUFFIXES.some((suffix) => lower.endsWith(suffix))
}

export function classifyDownloadFile(fileName: string): Exclude<DownloadFileCategory, 'all'> {
  const dot = fileName.lastIndexOf('.')
  const ext = dot >= 0 ? fileName.slice(dot).toLowerCase() : ''
  if (INSTALLER_EXTS.has(ext)) return 'installer'
  if (ARCHIVE_EXTS.has(ext)) return 'archive'
  if (DOCUMENT_EXTS.has(ext)) return 'document'
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (MEDIA_EXTS.has(ext)) return 'media'
  if (CODE_EXTS.has(ext)) return 'code'
  return 'other'
}

export function getDownloadCategoryLabel(category: DownloadFileCategory): string {
  switch (category) {
    case 'all': return '全部类型'
    case 'installer': return '安装包'
    case 'archive': return '压缩归档'
    case 'document': return '办公文档'
    case 'image': return '图片设计'
    case 'media': return '音视频'
    case 'code': return '代码与数据'
    case 'other': return '其他文件'
  }
}

export function getDownloadChannelLabel(channel: DownloadSourceChannel): string {
  switch (channel) {
    case 'all': return '全渠道汇总'
    case 'im': return '办公 IM 接收'
    case 'netdisk': return '网盘与下载器'
    case 'browser': return '浏览器与系统下载'
    case 'custom': return '自定义目录'
  }
}

function isWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')
}

function normalizePathKey(value: string): string {
  if (isWindowsPath(value)) return value.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
  return value.replace(/\/+$/, '') || '/'
}

function isInsideDirectory(directory: string, file: string): boolean {
  if (file.includes('\0') || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(file)) return false
  const root = normalizePathKey(directory), candidate = normalizePathKey(file)
  const separator = isWindowsPath(directory) ? '\\' : '/'
  return candidate.startsWith(root === '/' ? '/' : root + separator) && candidate !== root
}

/**
 * macOS 的“包”是目录，在访达里显示成单个文件（应用、Safari 未下载完的 .download、照片图库等）。
 * 宿主 dir: 扫描会递归进入这些目录，把包内部文件当成普通文件返回；这些不是下载文件，
 * 单独回收会损坏应用或图库，所以位于包内部的结果一律不列出。
 */
const MAC_PACKAGE_EXTS = new Set([
  'app', 'bundle', 'framework', 'plugin', 'kext', 'appex', 'xpc', 'prefpane', 'qlgenerator', 'mdimporter', 'saver',
  'download', 'pkg', 'mpkg', 'photoslibrary', 'musiclibrary', 'tvlibrary', 'photolibrary', 'fcpbundle', 'imovielibrary',
  'logicx', 'band', 'xcarchive', 'xcodeproj', 'xcworkspace', 'playground', 'rtfd', 'pages', 'numbers', 'key',
  'scptd', 'workflow', 'lproj', 'nib', 'storyboardc', 'dsym', 'sparsebundle', 'vmwarevm', 'pvm', 'utm', 'docset'
])

/** 文件是否位于 macOS 包（.app、.download 等目录）内部；只看扫描根以下的上级目录名 */
export function isInsideMacPackage(directory: string, file: string): boolean {
  if (isWindowsPath(directory)) return false
  const root = normalizePathKey(directory)
  const relative = normalizePathKey(file).slice(root === '/' ? 1 : root.length + 1)
  return relative.split('/').slice(0, -1).some(segment => {
    const dot = segment.lastIndexOf('.')
    return dot > 0 && MAC_PACKAGE_EXTS.has(segment.slice(dot + 1).toLowerCase())
  })
}

function isAbsoluteFilePath(p: string): boolean {
  const trimmed = String(p || '').trim()
  return /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('\\\\')
}

export function validateCustomDownloadDirPath(rawPath: string): { ok: boolean; normalizedPath?: string; error?: string } {
  const trimmed = String(rawPath || '').trim()
  if (!trimmed) {
    return { ok: false, error: '目录路径不能为空' }
  }
  if (trimmed.includes('\0')) {
    return { ok: false, error: '目录路径包含无效字符' }
  }
  if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(trimmed) || !isAbsoluteFilePath(trimmed)) {
    return { ok: false, error: '只能添加完整的绝对目录路径，不能包含 .. 等上级目录跳转' }
  }
  const isPosix = trimmed.startsWith('/')
  const normalized = isPosix
    ? trimmed.replace(/\/+/g, '/').replace(/\/$/, '') || '/'
    : /^[A-Za-z]:[\\/]$/.test(trimmed) ? trimmed[0]! + ':\\' : trimmed.replace(/\//g, '\\').replace(/\\+$/, '')
  return { ok: true, normalizedPath: normalized }
}

/**
 * 读取客户端平台。办公 IM（微信 / QQ / 企业微信 / 钉钉 / 飞书）接收目录的自动发现只按 Windows 目录布局实现；
 * macOS 上这些应用把文件存在各自的沙盒容器里，读取需系统额外授权且布局随版本变化，因此不宣称支持。
 * 读取失败返回 undefined，界面按“未确认是 Windows”处理，不展示 IM 来源承诺。
 */
export async function getClientPlatform(hostOverride?: unknown): Promise<'windows' | 'macos' | 'linux' | undefined> {
  const response = await callHostTransport<{ platform?: unknown }>('system_get_platform', {}, hostOverride)
  const platform = response.ok ? response.data?.platform : undefined
  return platform === 'windows' || platform === 'macos' || platform === 'linux' ? platform : undefined
}

export async function getCustomDownloadDirectories(): Promise<string[]> {
  return (await readDownloadPreferences()).directories
}

export async function addCustomDownloadDirectory(rawDirPath: string, hostOverride?: unknown, shouldContinue?: () => boolean): Promise<{ ok: boolean; path?: string; error?: string }> {
  const check = validateCustomDownloadDirPath(rawDirPath)
  if (!check.ok || !check.normalizedPath) return { ok: false, error: check.error }
  try {
    const response = await callHostTransport<{ ok?: boolean; path?: string; error?: string }>('downloads_manager', { action: 'validate', dirPath: check.normalizedPath }, hostOverride)
    if (!response.ok || response.data?.ok === false || !response.data?.path) throw new Error(response.error || response.data?.error || '目录校验失败')
    if (shouldContinue?.() === false) throw new Error('操作已取消，未保存目录')
    const validated = validateCustomDownloadDirPath(response.data.path)
    if (!validated.ok || !validated.normalizedPath) throw new Error('宿主返回了无效目录路径')
    const target = validated.normalizedPath
    await updateDownloadPreferences(current => {
      if (shouldContinue?.() === false) throw new Error('操作已取消，未保存目录')
      return { ...current, directories: current.directories.some(path => normalizePathKey(path) === normalizePathKey(target)) ? current.directories : [...current.directories, target] }
    })
    return { ok: true, path: target }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function selectDownloadDirectory(hostOverride?: unknown): Promise<string | null> {
  const response = await callHostTransport<{ canceled?: boolean; folderPath?: string }>('window_show_select_folder_dialog', { title: '选择下载目录' }, hostOverride)
  if (!response.ok) throw new Error(response.error || '无法打开目录选择窗口')
  if (response.data?.canceled === true) return null
  if (response.data?.canceled !== false || typeof response.data.folderPath !== 'string' || !validateCustomDownloadDirPath(response.data.folderPath).ok) throw new Error('目录选择未得到有效回执')
  return response.data.folderPath
}

export async function removeCustomDownloadDirectory(rawDirPath: string): Promise<void> {
  await updateDownloadPreferences(current => ({ ...current, directories: current.directories.filter(path => normalizePathKey(path) !== normalizePathKey(rawDirPath)) }))
}

export async function clearCustomDownloadDirectories(): Promise<void> {
  await updateDownloadPreferences(current => ({ ...current, directories: [] }))
}

export async function discoverAllDownloadSources(customDirs?: string[], hostOverride?: unknown): Promise<DownloadSourceDescriptor[]> {
  const directories = customDirs ?? await getCustomDownloadDirectories()
  const valid = directories.map(path => {
    const checked = validateCustomDownloadDirPath(path)
    if (!checked.ok || !checked.normalizedPath) throw new Error(checked.error || '自定义目录无效')
    return checked.normalizedPath
  })
  const response = await callHostTransport<{ ok?: boolean; sources?: DownloadSourceDescriptor[] }>('downloads_manager', { action: 'discover', customDirs: valid }, hostOverride)
  if (!response.ok || response.data?.ok === false || !Array.isArray(response.data?.sources)) throw new Error(response.error || '无法读取下载目录来源，请重试')
  const sources = new Map<string, DownloadSourceDescriptor>()
  for (const source of response.data.sources) {
    if (!source || typeof source.path !== 'string' || !validateCustomDownloadDirPath(source.path).ok || !['browser', 'im', 'netdisk', 'custom'].includes(source.channel)) throw new Error('宿主返回了无效的下载目录来源')
    const key = normalizePathKey(source.path)
    if (!sources.has(key)) sources.set(key, { ...source, exists: true })
  }
  // 用户配置的目录即使暂时不存在也要显示读取失败，不能静默隐藏。
  for (const directory of valid) {
    const key = normalizePathKey(directory)
    if (!sources.has(key)) sources.set(key, { id: `custom-${key}`, label: '自定义目录', channel: 'custom', appName: '自定义', path: directory })
  }
  return [...sources.values()].sort((a, b) => b.path.length - a.path.length)
}

function buildDownloadEntry(
  raw: {
    name: string
    path: string
    size: number
    mtimeMs: number
  },
  source: DownloadSourceDescriptor,
  nowMs: number,
  pinned: Set<string>
): DownloadEntry | null {
  const fileName = String(raw.name || raw.path.split(isWindowsPath(raw.path) ? /[\\/]/ : /\//).pop() || '')
  if (!fileName || isDownloadTemporaryOrHiddenFile(fileName)) {
    return null
  }
  const sizeBytes = Number(raw.size)
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) throw new Error('文件大小无效')

  const dotIdx = fileName.lastIndexOf('.')
  const ext = dotIdx >= 0 ? fileName.slice(dotIdx).toLowerCase() : ''
  const mtimeMs = Number.isFinite(raw.mtimeMs) && raw.mtimeMs > 0 ? raw.mtimeMs : 0
  const ageDays = mtimeMs ? Math.max(0, Math.floor((nowMs - mtimeMs) / 86_400_000)) : null
  const id = `dl-${normalizePathKey(raw.path)}`
  const dt = new Date(mtimeMs)
  const modifiedAt = !mtimeMs ? '修改时间未知' : `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`

  return {
    id,
    name: fileName,
    path: raw.path,
    dirPath: source.path,
    ext,
    category: classifyDownloadFile(fileName),
    sizeBytes,
    sizeFormatted: formatBytes(sizeBytes),
    modifiedAt,
    mtimeMs,
    ageDays,
    isPinned: pinned.has(id),
    channel: source.channel,
    sourceId: source.id,
    sourceLabel: source.label,
    appName: source.appName
  }
}

/** 每个来源向宿主请求的结果数（宿主 system_search_files 的 limit 上限为 200），再从中按修改时间取最近的若干个显示 */
const HOST_SCAN_LIMIT = 200

interface SearchFile { name?: string; path?: string; size?: number; sizeBytes?: number; mtime?: number; mtimeMs?: number; is_dir?: boolean; isDir?: boolean; isDirectory?: boolean }
interface SearchResult { files?: SearchFile[]; total_matches?: number; truncated?: boolean; approximate?: boolean; success?: boolean }

export async function scanDownloadsDirectory(customDirOrOptions?: string | { customDirs?: string[]; maxFilesPerSource?: number; shouldContinue?: () => boolean }, hostOverride?: unknown): Promise<DownloadsDashboardSummary> {
  const preferences = await readDownloadPreferences(), pinned = new Set(preferences.pins)
  const explicit = typeof customDirOrOptions === 'string' ? validateCustomDownloadDirPath(customDirOrOptions) : null
  if (explicit && (!explicit.ok || !explicit.normalizedPath)) throw new Error(explicit.error || '下载目录无效')
  const sources: DownloadSourceDescriptor[] = explicit ? [{ id: 'explicit-dir', label: '指定下载目录', channel: 'browser', appName: '系统下载', path: explicit.normalizedPath! }]
    : await discoverAllDownloadSources((typeof customDirOrOptions === 'object' ? customDirOrOptions.customDirs : undefined) ?? preferences.directories, hostOverride)
  const requested = typeof customDirOrOptions === 'object' ? customDirOrOptions.maxFilesPerSource ?? 100 : 100
  if (!Number.isInteger(requested) || requested < 1 || requested > HOST_SCAN_LIMIT) throw new Error(`每个来源的显示上限必须为 1～${HOST_SCAN_LIMIT}`)
  const entries: DownloadEntry[] = [], seen = new Set<string>(), scanIssues: DownloadsDashboardSummary['scanIssues'] = []
  let partial = false
  for (const source of sources) {
    if (typeof customDirOrOptions === 'object' && customDirOrOptions.shouldContinue?.() === false) throw new Error('SCAN_CANCELLED')
    // 宿主 dir: 扫描会递归子目录并按体积从大到小返回；向宿主多要一些结果，再按修改时间取最近的 requested 个，
    // 让“今天 / 近 7 天”的小文件不被大文件挤掉。结果仍不完整时如实标注“仅部分结果”。
    const response = await callHostTransport<SearchResult>('system_search_files', { query: `dir:${source.path}`, limit: HOST_SCAN_LIMIT }, hostOverride)
    if (!response.ok || response.data?.success === false || !Array.isArray(response.data?.files)) {
      scanIssues.push({ path: source.path, message: response.error || '目录扫描返回无效数据' }); continue
    }
    const data = response.data
    if (data.truncated || data.approximate || (data.total_matches ?? 0) > data.files!.length || (data.files!.length >= HOST_SCAN_LIMIT && data.total_matches === undefined)) partial = true
    const sourceEntries: DownloadEntry[] = []
    for (const file of data.files!) {
      if (file.is_dir || file.isDir || file.isDirectory) continue
      if (typeof file.path !== 'string' || !isInsideDirectory(source.path, file.path)) {
        scanIssues.push({ path: source.path, message: '已忽略不属于该目录的无效结果' }); continue
      }
      if (isInsideMacPackage(source.path, file.path)) continue
      const key = normalizePathKey(file.path)
      if (seen.has(key)) continue
      try {
        const rawTime = file.mtimeMs ?? file.mtime ?? 0
        const entry = buildDownloadEntry({ name: file.name ?? '', path: file.path, size: file.sizeBytes ?? file.size ?? Number.NaN, mtimeMs: file.mtimeMs !== undefined ? file.mtimeMs : rawTime > 1e11 ? rawTime : rawTime * 1000 }, source, Date.now(), pinned)
        if (entry) { seen.add(key); sourceEntries.push(entry) }
      } catch (error) { scanIssues.push({ path: file.path, message: error instanceof Error ? error.message : String(error) }) }
    }
    sourceEntries.sort((a, b) => b.mtimeMs - a.mtimeMs || b.sizeBytes - a.sizeBytes)
    if (sourceEntries.length > requested) partial = true
    entries.push(...sourceEntries.slice(0, requested))
  }
  return computeDashboardSummary(explicit?.normalizedPath || sources[0]?.path || '', entries, sources, { partial: partial || scanIssues.length > 0, scanIssues })
}

export function computeDashboardSummary(
  downloadDir: string,
  entries: DownloadEntry[],
  sources: DownloadSourceDescriptor[] = [],
  diagnostics: { partial?: boolean; scanIssues?: DownloadsDashboardSummary['scanIssues'] } = {}
): DownloadsDashboardSummary {
  const sorted = [...entries].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
    return b.mtimeMs - a.mtimeMs || b.sizeBytes - a.sizeBytes
  })

  let totalSizeBytes = 0
  let installerCount = 0
  let installerSizeBytes = 0
  let largeFileCount = 0
  let oldFileCount = 0
  let oldFileSizeBytes = 0

  for (const e of sorted) {
    totalSizeBytes += e.sizeBytes
    if (e.category === 'installer') {
      installerCount++
      installerSizeBytes += e.sizeBytes
    }
    if (e.sizeBytes >= 100 * 1024 * 1024) {
      largeFileCount++
    }
    if (e.ageDays !== null && e.ageDays >= 30 && !e.isPinned) {
      oldFileCount++
      oldFileSizeBytes += e.sizeBytes
    }
  }

  return {
    downloadDir,
    sources,
    partial: diagnostics.partial ?? false,
    scanIssues: diagnostics.scanIssues ?? [],
    totalCount: sorted.length,
    totalSizeBytes,
    totalSizeFormatted: formatBytes(totalSizeBytes),
    installerCount,
    installerSizeBytes,
    installerSizeFormatted: formatBytes(installerSizeBytes),
    largeFileCount,
    oldFileCount,
    oldFileSizeBytes,
    oldFileSizeFormatted: formatBytes(oldFileSizeBytes),
    entries: sorted
  }
}

export function filterDownloadEntries(
  entries: DownloadEntry[],
  options: {
    filterValue?: string
    channel?: DownloadSourceChannel
    category?: DownloadFileCategory
    query?: string
    onlyLarge?: boolean
    sortBy?: 'mtime' | 'size'
  }
): DownloadEntry[] {
  const rawFilter = String(options.filterValue || 'all').trim()
  let targetChannel: DownloadSourceChannel = options.channel ?? 'all'
  let targetCategory: DownloadFileCategory = options.category ?? 'all'

  if (rawFilter.startsWith('type:')) {
    targetCategory = rawFilter.slice(5) as DownloadFileCategory
  } else if (['all', 'im', 'netdisk', 'browser', 'custom'].includes(rawFilter)) {
    targetChannel = rawFilter as DownloadSourceChannel
  } else if (['installer', 'archive', 'document', 'image', 'media', 'code', 'other'].includes(rawFilter)) {
    targetCategory = rawFilter as DownloadFileCategory
  }

  const q = (options.query || '').trim().toLowerCase()
  const filtered = entries.filter((item) => {
    if (targetChannel !== 'all' && item.channel !== targetChannel) {
      return false
    }
    if (targetCategory !== 'all' && item.category !== targetCategory) {
      return false
    }
    if (options.onlyLarge && item.sizeBytes < 100 * 1024 * 1024) {
      return false
    }
    if (q) {
      const matchName = item.name.toLowerCase().includes(q)
      const matchExt = item.ext.toLowerCase().includes(q)
      const matchSource = item.sourceLabel.toLowerCase().includes(q) || item.appName.toLowerCase().includes(q)
      return matchName || matchExt || matchSource
    }
    return true
  })

  const sortBy = options.sortBy ?? (targetCategory === 'installer' ? 'size' : 'mtime')
  return filtered.sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
    if (sortBy === 'size') {
      return b.sizeBytes - a.sizeBytes || b.mtimeMs - a.mtimeMs
    }
    return b.mtimeMs - a.mtimeMs || b.sizeBytes - a.sizeBytes
  })
}

export async function togglePinEntry(entries: DownloadEntry[], id: string): Promise<DownloadEntry[]> {
  if (!entries.some(item => item.id === id)) throw new Error('未找到要保护的下载项')
  const preferences = await updateDownloadPreferences(current => ({ ...current, pins: current.pins.includes(id) ? current.pins.filter(pin => pin !== id) : [...current.pins, id] }))
  const pinned = new Set(preferences.pins)
  return entries.map(item => ({ ...item, isPinned: pinned.has(item.id) }))
}

async function trashPaths(paths: string[], hostOverride?: unknown, shouldContinue?: () => boolean): Promise<{ trashedPaths: string[]; failedPaths: string[]; error?: string; cancelled: boolean }> {
  const trashedPaths: string[] = [], failedPaths: string[] = []
  const seen = new Set<string>()
  let error: string | undefined
  let cancelled = false
  for (const fullPath of paths) {
    if (shouldContinue?.() === false) { cancelled = true; break }
    const key = normalizePathKey(fullPath)
    if (seen.has(key)) continue
    seen.add(key)
    const response = await callHostTransport<{ success?: boolean }>('shell_trash_item', { fullPath }, hostOverride)
    if (response.ok && response.data?.success === true) trashedPaths.push(fullPath)
    else {
      failedPaths.push(fullPath)
      error = response.error || '未收到明确的回收成功回执，请刷新核对；没有自动重试。'
    }
  }
  return { trashedPaths, failedPaths, error, cancelled }
}

async function executeBatchTrashClean(
  entries: DownloadEntry[],
  toClean: DownloadEntry[],
  hostOverride?: unknown,
  shouldContinue?: () => boolean
): Promise<CleanResult> {
  if (toClean.length === 0) {
    return {
      cleanedCount: 0,
      freedBytes: 0,
      freedFormatted: '0 B',
      remainingEntries: entries
    }
  }
  const trashRes = await trashPaths(
    toClean.map((item) => item.path),
    hostOverride,
    shouldContinue
  )
  const succeeded = new Set(trashRes.trashedPaths.map(normalizePathKey))
  const deletedEntries = toClean.filter((item) => succeeded.has(normalizePathKey(item.path)))
  const deletedIds = new Set(deletedEntries.map((item) => item.id))
  const freedBytes = deletedEntries.reduce((sum, item) => sum + item.sizeBytes, 0)
  const remainingEntries = entries.filter((item) => !deletedIds.has(item.id))

  return {
    cancelled: trashRes.cancelled,
    cleanedCount: deletedEntries.length,
    freedBytes,
    freedFormatted: formatBytes(freedBytes),
    remainingEntries,
    ...(trashRes.failedPaths && trashRes.failedPaths.length > 0 ? { failedPaths: trashRes.failedPaths } : {}),
    ...(trashRes.error ? { error: trashRes.error } : {})
  }
}

export async function cleanRedundantInstallers(
  entries: DownloadEntry[],
  hostOverride?: unknown,
  shouldContinue?: () => boolean
): Promise<CleanResult> {
  const pinned = new Set((await readDownloadPreferences()).pins)
  const toClean = entries.filter((item) => item.category === 'installer' && !item.isPinned && !pinned.has(item.id))
  return executeBatchTrashClean(entries, toClean, hostOverride, shouldContinue)
}

export async function cleanExpiredDownloads(
  entries: DownloadEntry[],
  daysThreshold = 30,
  minSizeBytes = 0,
  hostOverride?: unknown,
  shouldContinue?: () => boolean
): Promise<CleanResult> {
  const pinned = new Set((await readDownloadPreferences()).pins)
  const toClean = entries.filter(
    (item) => item.ageDays !== null && item.ageDays >= daysThreshold && item.sizeBytes >= minSizeBytes && !item.isPinned && !pinned.has(item.id)
  )
  return executeBatchTrashClean(entries, toClean, hostOverride, shouldContinue)
}

export async function trashDownloadItem(
  entries: DownloadEntry[],
  targetIdOrPath: string,
  hostOverride?: unknown
): Promise<{ ok: boolean; remainingEntries: DownloadEntry[]; freedBytes: number; error?: string }> {
  const target = entries.find((item) => item.id === targetIdOrPath || item.path === targetIdOrPath)
  if (!target) {
    return { ok: false, remainingEntries: entries, freedBytes: 0, error: '未找到这个下载项，请刷新列表' }
  }
  const trashRes = await trashPaths([target.path], hostOverride)
  if (!trashRes.trashedPaths.includes(target.path)) {
    return {
      ok: false,
      remainingEntries: entries,
      freedBytes: 0,
      error: trashRes.error || '文件可能正在被占用或已不存在，请刷新列表后重试'
    }
  }
  return {
    ok: true,
    remainingEntries: entries.filter((item) => item.id !== target.id),
    freedBytes: target.sizeBytes
  }
}

async function fileAction(method: string, params: Record<string, string>, hostOverride?: unknown): Promise<{ ok: boolean; error?: string }> {
  if (!Object.values(params).every(value => value && !value.includes('\0'))) return { ok: false, error: '文件路径无效' }
  const response = await callHostTransport<{ success?: boolean }>(method, params, hostOverride)
  return response.ok && response.data?.success === true ? { ok: true } : { ok: false, error: response.error || '未收到成功回执，请核对后重试。' }
}

export async function copyDownloadFileEntity(filePath: string, hostOverride?: unknown): Promise<{ ok: boolean; error?: string }> {
  return fileAction('clipboard_copy_file', { filePath }, hostOverride)
}

export async function copyDownloadFilePath(filePath: string, hostOverride?: unknown): Promise<boolean> {
  return (await fileAction('clipboard_copy_text', { text: filePath }, hostOverride)).ok
}

export async function openDownloadItem(filePath: string, hostOverride?: unknown): Promise<boolean> {
  return (await fileAction('shell_open_path', { fullPath: filePath }, hostOverride)).ok
}

export async function revealDownloadItem(filePath: string, hostOverride?: unknown): Promise<boolean> {
  return (await fileAction('shell_show_item_in_folder', { fullPath: filePath }, hostOverride)).ok
}
