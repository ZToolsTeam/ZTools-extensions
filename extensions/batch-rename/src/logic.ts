/**
 * 批量文件重命名工作台业务逻辑与真实文件系统契约层 (BatchRename 2.0 Logic)
 * 通过 Windows 原生插件提供批量重命名能力
 * 完整支持 10 大替换/追加/序号规则、4 种智能排序、重命名同名冲突检测、真实原子改名与一键撤销回滚 (Undo)
 */

import {
  callHostTransport,
  formatBytes,
  getRealSystemPath,
  invokeDllPluginCapability,
  isRealElectronHost,
  listDirectChildren
} from './native-ipc.js'
import { hostUpgradeError, isHostMethodMissing } from './host-compat.js'

export { formatBytes } from './native-ipc.js'

export type RenameRuleType =
  | 'replace'
  | 'prefix'
  | 'date_prefix'
  | 'suffix'
  | 'case'
  | 'number'
  | 'number_cn'
  | 'number_roman'
  | 'trim_head3'
  | 'clean_brackets'
  | 'snake_case'

export interface RenameRule {
  type: RenameRuleType
  find?: string
  replace?: string
  prefix?: string
  suffix?: string
  caseMode?: 'upper' | 'lower' | 'title'
  startNumber?: number
  padDigits?: number
}

export interface RenameResultItem {
  id: string
  oldName: string
  newName: string
  changed: boolean
  conflict?: boolean
  fullPath?: string
  parentDir?: string
  sizeBytes?: number
}

export interface RenameUndoEntry {
  oldPath: string
  newPath: string
  oldName: string
  newName: string
}

export interface CapabilityActionItem {
  id: string
  title: string
  subtitle: string
  tag: string
  method: string
  params: Record<string, unknown>
}

export interface NativeInvocationResult {
  ok: boolean
  pluginName: string
  method: string
  data?: unknown
  error?: string
  fromFallback?: boolean
}

export const DLL_PLUGIN_NAME = 'BatchRenamePlugin'
export const FORBIDDEN_TARGET_PATTERN =
  /(?:^|[\\/])(?:Windows|System32|SysWOW64|Program Files|Program Files \(x86\)|\.\.)(?:$|[\\/])|^\/(?:System|Library|usr|bin|sbin)(?:\/|$)|^\/Users\/[^/]+\/Library(?:\/|$)/i
export const FORBIDDEN_REASON = '严禁对系统核心目录（Windows 系统目录、macOS /System、/Library、/usr、~/Library）执行批量重命名或包含路径穿越字符'

export const RENAME_RULE_PRESETS: Array<{ id: RenameRuleType; label: string; desc: string }> = [
  { id: 'number', label: '阿拉伯序号 (_01, _02)', desc: '按补零数字序列自动追加后缀 (PRD 2.3.4)' },
  { id: 'number_cn', label: '中文序号 (_一, _二)', desc: '按中文数字序列追加后缀 (PRD 2.3.4)' },
  { id: 'number_roman', label: '罗马序号 (_I, _II)', desc: '按罗马数字序列追加后缀 (PRD 2.3.4)' },
  { id: 'prefix', label: '前缀注入 (Prefix_)', desc: '在文件名首部插入自定义前缀或工程标识 (PRD 2.3.1)' },
  { id: 'date_prefix', label: '日期归档前缀 (YYYYMMDD_)', desc: '自动注入当前日期归档头' },
  { id: 'suffix', label: '后缀追加 (_Suffix)', desc: '在扩展名前追加版本或状态后缀 (PRD 2.3.2)' },
  { id: 'trim_head3', label: '裁剪前3字符 (前N位删除)', desc: '移除文件名前 3 位冗余编号字符 (PRD 2.2.2)' },
  { id: 'clean_brackets', label: '清洗括号与冗余符号', desc: '清除 () [] 【】 及其内部广告/副本标记 (PRD 2.2.5)' },
  { id: 'snake_case', label: '下划线规范化 (snake_case)', desc: '将空格与连字符统一替换为下划线' },
  { id: 'case', label: '全小写规范 (lowercase)', desc: '文件名与扩展名统一转为全小写 (PRD 2.2.6)' }
]

const PRESET_ITEMS: CapabilityActionItem[] = [
  {
    id: 'rename-seq-number',
    title: '按两位序号递增批量重命名 (_01, _02...)',
    subtitle: '为目录内文件统一追加规范化数字序列后缀',
    tag: '序号重命名',
    method: 'BatchRenameByRule',
    params: { type: 'number', startNumber: 1, padDigits: 2 }
  },
  {
    id: 'rename-prefix-date',
    title: '批量注入归档前缀 ([ZTools]_)',
    subtitle: '为项目交付物或摄影素材统一添加工程前缀标识',
    tag: '前缀注入',
    method: 'BatchRenameByRule',
    params: { type: 'prefix', prefix: 'ZTools_' }
  },
  {
    id: 'rename-case-lower',
    title: '文件名与扩展名统一规范为全小写',
    subtitle: '消除跨平台大小写敏感引发的资源引用隐患',
    tag: '大小写规范',
    method: 'BatchRenameByRule',
    params: { type: 'case', caseMode: 'lower' }
  }
]

export function getCapabilityItems(): CapabilityActionItem[] {
  return PRESET_ITEMS.map(item => ({
    ...item,
    params: { ...item.params }
  }))
}

export function filterCapabilityItems(items: CapabilityActionItem[], query: string): CapabilityActionItem[] {
  if (!Array.isArray(items)) return []
  const q = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (!q) return items
  return items.filter(item => {
    if (!item || typeof item.title !== 'string') return false
    return (
      item.title.toLowerCase().includes(q) ||
      item.subtitle.toLowerCase().includes(q) ||
      item.tag.toLowerCase().includes(q) ||
      item.method.toLowerCase().includes(q)
    )
  })
}

export function validateInvocationPayload(method: string, params: unknown): { valid: boolean; error?: string } {
  if (typeof method !== 'string' || method.trim().length === 0) {
    return { valid: false, error: 'INVALID_METHOD: 调用方法名不能为空' }
  }
  if (method.length > 128 || !/^[A-Za-z0-9_]+$/.test(method.trim())) {
    return { valid: false, error: 'INVALID_METHOD_FORMAT: 方法名包含非法字符或超长' }
  }
  if (params === null || params === undefined || typeof params !== 'object' || Array.isArray(params)) {
    return { valid: false, error: 'INVALID_PARAMS: 参数必须为非空对象' }
  }

  const record = params as Record<string, unknown>
  for (const [key, val] of Object.entries(record)) {
    if (typeof val === 'string') {
      if (val.length > 4096) {
        return { valid: false, error: `PARAM_TOO_LONG: 参数 ${key} 超过最大长度限制` }
      }
      if (FORBIDDEN_TARGET_PATTERN.test(val)) {
        return { valid: false, error: `SECURITY_INTERCEPTED: ${FORBIDDEN_REASON}` }
      }
    } else if (typeof val === 'number') {
      if (!Number.isFinite(val) || val < -1000 || val > 100_000_000) {
        return { valid: false, error: `PARAM_OUT_OF_RANGE: 数值参数 ${key} 越界或非有限数` }
      }
    }
  }

  return { valid: true }
}

export async function invokeNativeCapability(
  method: string,
  params: Record<string, unknown>,
  hostBridge?: { dllplugin?: { call?: (plugin: string, fn: string, payload: unknown) => Promise<unknown> }; __isRealHost?: boolean }
): Promise<NativeInvocationResult> {
  const check = validateInvocationPayload(method, params)
  if (!check.valid) {
    throw new Error(check.error || '参数校验失败')
  }
  const res = await invokeDllPluginCapability(DLL_PLUGIN_NAME, method, params, hostBridge)
  return {
    ok: res.ok,
    pluginName: DLL_PLUGIN_NAME,
    method: method.trim(),
    data: res.data ?? undefined,
    error: res.error,
    fromFallback: res.fromFallback
  }
}

export function splitFileName(fullName: string): { baseName: string; extension: string } {
  const lastDot = fullName.lastIndexOf('.')
  if (lastDot > 0) {
    return {
      baseName: fullName.slice(0, lastDot),
      extension: fullName.slice(lastDot)
    }
  }
  return {
    baseName: fullName,
    extension: ''
  }
}

function toTitleCase(str: string): string {
  return str.replace(/[A-Za-z]+/g, word => {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  })
}

const CN_NUMS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十']
const ROMAN_NUMS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX']

/**
 * 单个文件名应用重命名规则 (1:1 对齐 PRD 2.2 & 2.3)
 */
export function applyRenameRule(fileName: string, rule: RenameRule, index: number): string {
  const { baseName, extension } = splitFileName(fileName)
  let newBaseName = baseName
  let newExtension = extension

  switch (rule.type) {
    case 'replace': {
      if (rule.find) {
        newBaseName = newBaseName.split(rule.find).join(rule.replace || '')
      }
      break
    }
    case 'prefix': {
      if (rule.prefix) {
        newBaseName = `${rule.prefix}${newBaseName}`
      }
      break
    }
    case 'date_prefix': {
      const d = new Date()
      const ds = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_`
      if (!newBaseName.startsWith(ds)) {
        newBaseName = `${ds}${newBaseName}`
      }
      break
    }
    case 'suffix': {
      if (rule.suffix) {
        newBaseName = `${newBaseName}${rule.suffix}`
      }
      break
    }
    case 'case': {
      if (rule.caseMode === 'upper') {
        newBaseName = newBaseName.toUpperCase()
        newExtension = newExtension.toUpperCase()
      } else if (rule.caseMode === 'lower' || !rule.caseMode) {
        newBaseName = newBaseName.toLowerCase()
        newExtension = newExtension.toLowerCase()
      } else if (rule.caseMode === 'title') {
        newBaseName = toTitleCase(newBaseName)
      }
      break
    }
    case 'number': {
      const start = rule.startNumber ?? 1
      const pad = rule.padDigits ?? 2
      const numStr = String(start + index).padStart(pad, '0')
      newBaseName = `${newBaseName}_${numStr}`
      break
    }
    case 'number_cn': {
      const cn = CN_NUMS[index] || String(index + 1)
      newBaseName = `${newBaseName}_${cn}`
      break
    }
    case 'number_roman': {
      const rom = ROMAN_NUMS[index] || String(index + 1)
      newBaseName = `${newBaseName}_${rom}`
      break
    }
    case 'trim_head3': {
      newBaseName = newBaseName.length > 3 ? newBaseName.slice(3) : newBaseName
      break
    }
    case 'clean_brackets': {
      const cleaned = newBaseName
        .replace(/\([^)]*\)|\[[^\]]*\]|【[^】]*】/g, '')
        .replace(/\s+/g, '_')
        .replace(/^_+|_+$/g, '')
      if (cleaned.length > 0) newBaseName = cleaned
      break
    }
    case 'snake_case': {
      newBaseName = newBaseName.replace(/[\s\-]+/g, '_').toLowerCase()
      newExtension = newExtension.toLowerCase()
      break
    }
  }

  return `${newBaseName}${newExtension}`
}

export function getSampleFiles(): string[] {
  return [
    'IMG_2026_01.JPG',
    'IMG_2026_02.JPG',
    'IMG_2026_03.JPG',
    'document_draft_v1.docx',
    'my-awesome-video-clip.mp4'
  ]
}

export interface RealFileEntry {
  name: string
  fullPath: string
  parentDir: string
  extension: string
  sizeBytes: number
  lastModifiedMs: number
}

export type SourceScope = 'downloads' | 'desktop' | 'documents' | 'pictures' | 'videos'

export interface DirectoryFilesResult {
  directory: string
  /** 可改名的直接子文件（已过滤隐藏/系统元数据文件，按名称自然排序） */
  files: RealFileEntry[]
  /** 目录内全部直接子项名称（含子目录、隐藏文件），用于同名冲突检测 */
  occupiedNames: string[]
  /** true = 通过已授权的 filesystem 接口读取（完整、可直接改名）；false = 未授权，只读预览 */
  authorized: boolean
  /** 客户端版本过低：目录读取结果里没有写入授权信息，无法安全改名 */
  hostOutdated?: boolean
  /** 未授权时宿主扫描只返回了部分直接子项 */
  partial: boolean
  /** 可改名文件总数（截断前） */
  totalFiles: number
  /** 超过 MAX_RENAME_FILES 被截断 */
  truncated: boolean
  error?: string
}

/** 单次最多列出并改名的文件数（超过时如实提示「仅显示前 N 个」） */
export const MAX_RENAME_FILES = 500

const PERMISSION_ERROR_PATTERN = /PERMISSION_DENIED|未由当前窗口授权|未授权/i

export function isPermissionError(error: unknown): boolean {
  return typeof error === 'string' && PERMISSION_ERROR_PATTERN.test(error)
}

/**
 * 隐藏文件与系统元数据文件不参与改名：以 . 开头的文件（.DS_Store、.localized、._xxx 等）、
 * macOS 自定义图标文件 Icon\r、Windows 的 desktop.ini / Thumbs.db
 */
export function isHiddenOrSystemFile(name: string): boolean {
  if (!name) return true
  if (name.startsWith('.')) return true
  if (name === 'Icon\r') return true
  const lower = name.toLowerCase()
  return lower === 'desktop.ini' || lower === 'thumbs.db'
}

const NAME_COLLATOR = typeof Intl !== 'undefined' ? new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' }) : null

/** 按文件名自然排序（seq_2 排在 seq_10 前面），序号按这个顺序分配 */
export function compareFileNames(a: string, b: string): number {
  if (NAME_COLLATOR) {
    const c = NAME_COLLATOR.compare(a, b)
    if (c !== 0) return c
  }
  return a < b ? -1 : a > b ? 1 : 0
}

function stripTrailingSep(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '')
  return trimmed || p.slice(0, 1)
}

function isWindowsPath(p: string): boolean {
  return /^[A-Za-z]:/.test(p) || p.startsWith('\\\\') || (p.includes('\\') && !p.includes('/'))
}

export function joinPath(dir: string, name: string): string {
  const sep = isWindowsPath(dir) ? '\\' : '/'
  return `${dir.replace(/[\\/]+$/, '')}${sep}${name}`
}

/** 判断 grantedDir 是否覆盖 targetDir（同一目录或其上级目录） */
export function isSameOrParentDir(grantedDir: string, targetDir: string): boolean {
  if (!grantedDir || !targetDir) return false
  const win = isWindowsPath(targetDir)
  const norm = (p: string) => {
    const s = stripTrailingSep(p.trim())
    return win ? s.replace(/\//g, '\\').toLowerCase() : s
  }
  const g = norm(grantedDir)
  const t = norm(targetDir)
  if (g === t) return true
  const sep = win ? '\\' : '/'
  return t.startsWith(g.endsWith(sep) ? g : `${g}${sep}`)
}

/** 系统文件管理器名称：Windows 为「资源管理器」，macOS 为「访达」 */
export function fileManagerName(samplePath: string): string {
  return isWindowsPath(samplePath || '') ? '资源管理器' : '访达'
}

interface RawDirEntry {
  name: string
  path: string
  isDirectory: boolean
  sizeBytes: number
  lastModifiedMs: number
}

/** 解析宿主 filesystem_get_directory_contents 的真实返回 { success, files: [{ name, size, isDirectory, lastModified }] } */
function parseDirectoryContents(dirPath: string, data: any): RawDirEntry[] | null {
  const rawList: unknown[] | null = Array.isArray(data) ? data : Array.isArray(data?.files) ? data.files : null
  if (!rawList) return null
  const out: RawDirEntry[] = []
  const seen = new Set<string>()
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue
    const raw = item as any
    const name = typeof raw.name === 'string' ? raw.name : ''
    // 只接受纯文件名：拒绝空名、. / ..、带路径分隔符（越界）的条目
    if (!name.trim() || name === '.' || name === '..' || /[\\/]/.test(name)) continue
    if (seen.has(name)) continue
    seen.add(name)
    const isDirectory = Boolean(raw.isDirectory ?? raw.isDir ?? raw.is_dir)
    const parsedMtime = Date.parse(String(raw.lastModified || ''))
    out.push({
      name,
      path: joinPath(dirPath, name),
      isDirectory,
      sizeBytes: isDirectory ? 0 : Math.max(0, Number(raw.size) || 0),
      lastModifiedMs: Number.isFinite(parsedMtime) ? parsedMtime : 0
    })
  }
  return out
}

function toFileEntries(dirPath: string, raw: RawDirEntry[]): { files: RealFileEntry[]; occupiedNames: string[] } {
  const occupiedNames: string[] = []
  const files: RealFileEntry[] = []
  for (const entry of raw) {
    if (!entry.name) continue
    occupiedNames.push(entry.name)
    if (entry.isDirectory) continue
    if (isHiddenOrSystemFile(entry.name)) continue
    if (FORBIDDEN_TARGET_PATTERN.test(entry.path)) continue
    const dot = entry.name.lastIndexOf('.')
    files.push({
      name: entry.name,
      fullPath: entry.path,
      parentDir: dirPath,
      extension: dot > 0 ? entry.name.slice(dot).toLowerCase() : '.file',
      sizeBytes: entry.sizeBytes,
      lastModifiedMs: entry.lastModifiedMs
    })
  }
  files.sort((a, b) => compareFileNames(a.name, b.name))
  return { files, occupiedNames }
}

/**
 * 读取目录的直接子文件：
 * 1. 已授权（选目录对话框授权过）时用 filesystem_get_directory_contents 读取完整的一级目录；
 * 2. 未授权时退回宿主 dir: 扫描（只保留直接子项），作为只读预览，执行改名前必须先授权；
 * 3. 目录不存在 / 为空 / 读取失败时如实返回空列表与错误，绝不用别处文件冒充。
 */
export async function fetchDirectoryFiles(dirPath: string, hostOverride?: any): Promise<DirectoryFilesResult> {
  const directory = (dirPath || '').trim()
  const empty = (error: string, authorized = false): DirectoryFilesResult => ({
    directory,
    files: [],
    occupiedNames: [],
    authorized,
    partial: false,
    totalFiles: 0,
    truncated: false,
    error
  })
  if (!directory) return empty('SYSTEM_PATH_UNAVAILABLE')
  if (FORBIDDEN_TARGET_PATTERN.test(directory)) return empty(FORBIDDEN_REASON)

  let raw: RawDirEntry[]
  let authorized = false
  let partial = false
  let hostOutdated = false
  const listing = await callHostTransport<any>('filesystem_get_directory_contents', { path: directory }, hostOverride)
  if (listing.ok) {
    const parsed = parseDirectoryContents(directory, listing.data)
    if (!parsed) return empty('INVALID_DIRECTORY_PAYLOAD', true)
    raw = parsed
    authorized = listing.data?.writeAuthorized === true
    hostOutdated = typeof listing.data?.writeAuthorized !== 'boolean'
  } else if (isPermissionError(listing.error)) {
    const scan = await listDirectChildren(directory, hostOverride)
    raw = scan.entries.map(e => ({
      name: e.name,
      path: e.path,
      isDirectory: Boolean(e.isDirectory),
      sizeBytes: e.sizeBytes || 0,
      lastModifiedMs: e.lastModifiedMs || 0
    }))
    partial = Boolean(scan.partial)
    if (raw.length === 0) return { ...empty(scan.error || 'DIRECTORY_EMPTY_OR_UNREADABLE'), partial }
  } else {
    return empty(listing.error || 'DIRECTORY_READ_FAILED')
  }

  const { files, occupiedNames } = toFileEntries(directory, raw)
  const result: DirectoryFilesResult = {
    directory,
    files: files.slice(0, MAX_RENAME_FILES),
    occupiedNames,
    authorized,
    partial,
    totalFiles: files.length,
    truncated: files.length > MAX_RENAME_FILES
  }
  if (hostOutdated) result.hostOutdated = true
  if (files.length === 0) result.error = 'DIRECTORY_EMPTY_OR_UNREADABLE'
  return result
}

/**
 * 从本机常用目录 (downloads / desktop / documents / pictures / videos) 加载待重命名文件列表
 */
export async function fetchRealBatchRenameFiles(
  sourceScope: SourceScope = 'downloads',
  hostOverride?: any
): Promise<DirectoryFilesResult> {
  const dirPath = await getRealSystemPath(sourceScope, hostOverride)
  if (!dirPath) {
    return { directory: '', files: [], occupiedNames: [], authorized: false, partial: false, totalFiles: 0, truncated: false, error: 'SYSTEM_PATH_UNAVAILABLE' }
  }
  return fetchDirectoryFiles(dirPath, hostOverride)
}

/**
 * 弹出系统选目录对话框，由宿主给当前窗口签发该目录的读写授权（宿主只认对话框/拖放签发的授权）
 */
export async function requestFolderAccess(
  defaultPath: string,
  title: string,
  hostOverride?: any
): Promise<{ folderPath?: string; canceled: boolean; error?: string }> {
  const params: Record<string, unknown> = { title }
  if (defaultPath) params.defaultPath = defaultPath
  const res = await callHostTransport<any>('window_show_select_folder_dialog', params, hostOverride)
  if (!res.ok) return { canceled: false, error: res.error || '无法打开选择文件夹对话框' }
  const data = res.data
  const folderPath =
    typeof data === 'string' ? data : typeof data?.folderPath === 'string' ? data.folderPath : Array.isArray(data?.filePaths) ? data.filePaths[0] : ''
  if (data?.canceled || !folderPath) return { canceled: true }
  return { folderPath, canceled: false }
}

export type RenameConflictReason = 'invalid-name' | 'exists' | 'duplicate'

export interface RenamePreviewItem extends RealFileEntry {
  newName: string
  changed: boolean
  conflict: boolean
  conflictReason?: RenameConflictReason
}

export function conflictReasonText(reason?: RenameConflictReason): string {
  switch (reason) {
    case 'invalid-name':
      return '新文件名非法'
    case 'exists':
      return '与已有文件同名'
    case 'duplicate':
      return '与其他新名重复'
    default:
      return ''
  }
}

function isInvalidFileName(name: string): boolean {
  return !name.trim() || name === '.' || name === '..' || /[\\/:\0]/.test(name) || name.length > 255
}

/**
 * 生成改名预览并检测冲突（与列表顺序无关，冲突总是标在「会改名」的那一方，大小写不敏感以适配 APFS / NTFS）：
 * - 新名与目录内任一其他条目（含子目录、隐藏文件、未显示的文件）的当前名相同 → exists
 * - 多个文件改成同一个新名 → 这些文件全部标 duplicate
 * - 新名为空或含路径分隔符 → invalid-name
 * 未改名的文件永远不标冲突。按此规则执行时不会有任何一步覆盖目录内已有条目。
 */
export function buildRenamePreview(files: RealFileEntry[], rule: RenameRule, occupiedNames: string[] = []): RenamePreviewItem[] {
  const occupied = new Map<string, number>()
  const addOccupied = (name: string) => {
    const k = name.toLowerCase()
    occupied.set(k, (occupied.get(k) || 0) + 1)
  }
  const occupiedSet = new Set(occupiedNames)
  for (const name of occupiedNames) addOccupied(name)
  for (const f of files) if (!occupiedSet.has(f.name)) addOccupied(f.name)

  const items: RenamePreviewItem[] = files.map((file, idx) => {
    const newName = applyRenameRule(file.name, rule, idx)
    return { ...file, newName, changed: newName !== file.name, conflict: false }
  })

  const newNameCount = new Map<string, number>()
  for (const item of items) {
    if (!item.changed) continue
    const k = item.newName.toLowerCase()
    newNameCount.set(k, (newNameCount.get(k) || 0) + 1)
  }

  for (const item of items) {
    if (!item.changed) continue
    const k = item.newName.toLowerCase()
    const selfHolds = k === item.name.toLowerCase() ? 1 : 0
    if (isInvalidFileName(item.newName)) {
      item.conflict = true
      item.conflictReason = 'invalid-name'
    } else if ((occupied.get(k) || 0) - selfHolds > 0) {
      item.conflict = true
      item.conflictReason = 'exists'
    } else if ((newNameCount.get(k) || 0) > 1) {
      item.conflict = true
      item.conflictReason = 'duplicate'
    }
  }
  return items
}

export function batchApplyRename(files: string[], rule: RenameRule): RenameResultItem[] {
  const entries: RealFileEntry[] = files.map(name => ({
    name,
    fullPath: name,
    parentDir: '',
    extension: '',
    sizeBytes: 0,
    lastModifiedMs: 0
  }))
  return buildRenamePreview(entries, rule).map((item, index) => ({
    id: `file-${index}`,
    oldName: item.name,
    newName: item.newName,
    changed: item.changed,
    conflict: item.conflict
  }))
}

function parentDirOfPath(p: string): { dir: string; sep: string } {
  const sep = p.includes('\\') && !p.includes('/') ? '\\' : '/'
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return { dir: idx > 0 ? p.slice(0, idx) : idx === 0 ? p.slice(0, 1) : '', sep }
}

/** 仅调用宿主的原子不覆盖接口；旧宿主失败时不能回退到普通 move。 */
async function safeMove(sourcePath: string, destPath: string, hostOverride?: unknown): Promise<{ ok: boolean; error?: string }> {
  const res = await callHostTransport('filesystem_move_file_no_replace', { sourcePath, destPath }, hostOverride)
  if (res.ok) return { ok: true }
  return { ok: false, error: isHostMethodMissing(res.error) ? hostUpgradeError('安全改名').message : res.error || '安全改名失败，请重试' }
}

export async function executeRealFileRename(
  sourcePath: string,
  newFileName: string,
  hostOverride?: any
): Promise<{ ok: boolean; destinationPath?: string; error?: string }> {
  if (!sourcePath || !newFileName) {
    return { ok: false, error: '源路径或新文件名不能为空' }
  }
  if (FORBIDDEN_TARGET_PATTERN.test(sourcePath) || FORBIDDEN_TARGET_PATTERN.test(newFileName)) {
    return { ok: false, error: FORBIDDEN_REASON }
  }
  if (isInvalidFileName(newFileName)) {
    return { ok: false, error: '新文件名非法（不能为空或包含路径分隔符）' }
  }
  const { dir, sep } = parentDirOfPath(sourcePath)
  const destinationPath = `${dir}${dir.endsWith(sep) ? '' : sep}${newFileName}`
  if (destinationPath === sourcePath) {
    return { ok: true, destinationPath }
  }
  const res = await safeMove(sourcePath, destinationPath, hostOverride)
  return { ok: res.ok, destinationPath, error: res.error }
}

/**
 * 批量撤销上一次重命名操作 (PRD 2.6 撤销回滚)：倒序还原，原路径已被占用时跳过
 */
export async function undoBatchRenameHistory(
  history: RenameUndoEntry[],
  hostOverride?: any
): Promise<{ ok: boolean; restoredCount: number; failed: Array<{ entry: RenameUndoEntry; error: string }> }> {
  let restoredCount = 0
  const failed: Array<{ entry: RenameUndoEntry; error: string }> = []
  for (const item of [...history].reverse()) {
    const res = await safeMove(item.newPath, item.oldPath, hostOverride)
    if (res.ok) restoredCount += 1
    else failed.push({ entry: item, error: res.error || '还原失败' })
  }
  return { ok: restoredCount > 0 && failed.length === 0, restoredCount, failed }
}

/**
 * 在系统文件管理器中选中文件（不回退为打开文件本身）
 */
export async function openRenameFileLocation(fullPath: string, hostOverride?: any): Promise<{ ok: boolean; error?: string }> {
  if (!fullPath) return { ok: false, error: '路径为空' }
  const res = await callHostTransport('shell_show_item_in_folder', { fullPath }, hostOverride)
  return { ok: res.ok, error: res.ok ? undefined : res.error || '定位失败' }
}
