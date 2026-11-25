/**
 * 批量文件重命名工作台业务逻辑与真实文件系统契约层 (BatchRename 2.0 Logic)
 * 支持 10 大替换/追加/序号规则、自然排序、按目录独立同名冲突检测、真实原子改名与一键撤销回滚 (Undo)
 */

import { getLocale } from '@ztools/declarative-ui'
import {
  callHostTransport,
  invokeDllPluginCapability
} from './native-ipc.js'
import { hostUpgradeError, isHostMethodMissing } from './host-compat.js'
import { pathKey, type ImportedFile } from './file-import.js'
import { t } from './i18n.js'
import { extractErrorCode, extractHostCode, resolveErrorMessage } from './error-i18n.js'

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
  sizeBytes?: number | null
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
  /(?:^|[\\/])\.\.(?:$|[\\/])|^(?:\\\\[?.]\\)?[A-Za-z]:[\\/](?:Windows|Program Files|Program Files \(x86\)|ProgramData)(?:$|[\\/])|^\/(?:System|Library|usr|bin|sbin)(?:\/|$)|^\/Users\/[^/]+\/Library(?:\/|$)/i
export function getForbiddenReason(): string {
  return t('forbiddenReason')
}

export const RENAME_RULE_IDS: readonly RenameRuleType[] = [
  'number',
  'number_cn',
  'number_roman',
  'prefix',
  'date_prefix',
  'suffix',
  'trim_head3',
  'clean_brackets',
  'snake_case',
  'case'
]

export function getRenameRulePresets(): Array<{ id: RenameRuleType; label: string; desc: string }> {
  return [
    { id: 'number', label: t('ruleNumberLabel'), desc: t('ruleNumberDesc') },
    { id: 'number_cn', label: t('ruleNumberCnLabel'), desc: t('ruleNumberCnDesc') },
    { id: 'number_roman', label: t('ruleNumberRomanLabel'), desc: t('ruleNumberRomanDesc') },
    { id: 'prefix', label: t('rulePrefixLabel'), desc: t('rulePrefixDesc') },
    { id: 'date_prefix', label: t('ruleDatePrefixLabel'), desc: t('ruleDatePrefixDesc') },
    { id: 'suffix', label: t('ruleSuffixLabel'), desc: t('ruleSuffixDesc') },
    { id: 'trim_head3', label: t('ruleTrimHead3Label'), desc: t('ruleTrimHead3Desc') },
    { id: 'clean_brackets', label: t('ruleCleanBracketsLabel'), desc: t('ruleCleanBracketsDesc') },
    { id: 'snake_case', label: t('ruleSnakeCaseLabel'), desc: t('ruleSnakeCaseDesc') },
    { id: 'case', label: t('ruleCaseLabel'), desc: t('ruleCaseDesc') }
  ]
}

function getPresetItems(): CapabilityActionItem[] {
  return [
    {
      id: 'rename-seq-number',
      title: t('presetSeqTitle'),
      subtitle: t('presetSeqSub'),
      tag: t('presetSeqTag'),
      method: 'BatchRenameByRule',
      params: { type: 'number', startNumber: 1, padDigits: 2 }
    },
    {
      id: 'rename-prefix-date',
      title: t('presetPrefixTitle'),
      subtitle: t('presetPrefixSub'),
      tag: t('presetPrefixTag'),
      method: 'BatchRenameByRule',
      params: { type: 'prefix', prefix: 'ZTools_' }
    },
    {
      id: 'rename-case-lower',
      title: t('presetCaseTitle'),
      subtitle: t('presetCaseSub'),
      tag: t('presetCaseTag'),
      method: 'BatchRenameByRule',
      params: { type: 'case', caseMode: 'lower' }
    }
  ]
}

export function getCapabilityItems(): CapabilityActionItem[] {
  return getPresetItems().map(item => ({
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
    return { valid: false, error: t('errInvalidMethodEmpty') }
  }
  if (method.length > 128 || !/^[A-Za-z0-9_]+$/.test(method.trim())) {
    return { valid: false, error: t('errInvalidMethodFormat') }
  }
  if (params === null || params === undefined || typeof params !== 'object' || Array.isArray(params)) {
    return { valid: false, error: t('errInvalidParamsObject') }
  }

  const record = params as Record<string, unknown>
  for (const [key, val] of Object.entries(record)) {
    if (typeof val === 'string') {
      if (val.length > 4096) {
        return { valid: false, error: t('errParamTooLong', { key }) }
      }
      if (FORBIDDEN_TARGET_PATTERN.test(val)) {
        return { valid: false, error: t('errSecurityIntercepted', { reason: t('forbiddenReason') }) }
      }
    } else if (typeof val === 'number') {
      if (!Number.isFinite(val) || val < -1000 || val > 100_000_000) {
        return { valid: false, error: t('errParamOutOfRange', { key }) }
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
    throw new Error(resolveErrorMessage(check, t('errValidationFailed')))
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

import { CN_NUMS } from './cn-numerals.zh-data.js'
const ROMAN_NUMS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX']

/**
 * 单个文件名应用重命名规则
 */
export function applyRenameRule(fileName: string, rule: RenameRule, index: number): string {
  const { baseName, extension } = splitFileName(fileName)
  let newBaseName = baseName
  let newExtension = extension

  switch (rule.type) {
    case 'replace': {
      if (rule.find) {
        // macOS 上从压缩包、旧 HFS+ 磁盘来的文件名常是分解形式（NFD，如日文浊音、带声调字母），
        // 用户输入的是组合形式（NFC）；原样匹配不到时按 NFC 再匹配一次，避免“明明有这个词却不替换”
        const find = rule.find
        const replacement = rule.replace || ''
        if (newBaseName.includes(find)) {
          newBaseName = newBaseName.split(find).join(replacement)
        } else {
          const nfcBase = newBaseName.normalize('NFC')
          const nfcFind = find.normalize('NFC')
          if (nfcBase.includes(nfcFind)) newBaseName = nfcBase.split(nfcFind).join(replacement)
        }
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

export interface RealFileEntry {
  name: string
  fullPath: string
  parentDir: string
  extension: string
  sizeBytes: number | null
  lastModifiedMs: number
}

export interface DirectoryStateInfo {
  directory: string
  /** true = 宿主通过 writeAuthorized === true 明确赋予写权限 */
  writeAuthorized: boolean
  /** 目录内全部直接子项名称（含子目录、隐藏文件），用于同名冲突检测 */
  occupiedNames: string[]
  /** 目录内现存直接子文件名（用于弹出窗口或重命名后校验文件存在性） */
  existingFileNames: string[]
  /** 客户端版本过低：目录读取结果里没有 writeAuthorized 字段，无法安全改名 */
  hostOutdated?: boolean
  error?: string
}

/** 单次导入最多支持的文件数（超过时如实截断并提示） */
export const MAX_RENAME_FILES = 500

const PERMISSION_ERROR_CODES = new Set(['PERMISSION_DENIED', 'EACCES', 'EPERM'])
const PERMISSION_ERROR_PATTERN = /\b(?:PERMISSION_DENIED|EACCES|EPERM)\b|permission denied|access denied|not permitted/i
const LEGACY_ZH_PERMISSION_PATTERN = /未由当前窗口授权|未授权|权限不足|拒绝访问/

export function isPermissionError(error: unknown): boolean {
  const code = extractErrorCode(error).toUpperCase()
  const hostCode = extractHostCode(error).toUpperCase()
  if (PERMISSION_ERROR_CODES.has(code) || PERMISSION_ERROR_CODES.has(hostCode)) return true
  const raw = typeof error === 'string' ? error : error instanceof Error ? error.message : ''
  if (!raw) return false
  if (PERMISSION_ERROR_PATTERN.test(raw)) return true
  // i18n-allow: legacy host fallback
  return LEGACY_ZH_PERMISSION_PATTERN.test(raw)
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

const NAME_COLLATORS = new Map<string, Intl.Collator>()
function getNameCollator(): Intl.Collator | null {
  if (typeof Intl === 'undefined') return null
  const locale = getLocale()
  let collator = NAME_COLLATORS.get(locale)
  if (!collator) {
    collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' })
    NAME_COLLATORS.set(locale, collator)
  }
  return collator
}

/** 按文件名自然排序（seq_2 排在 seq_10 前面） */
export function compareFileNames(a: string, b: string): number {
  const collator = getNameCollator()
  if (collator) {
    const c = collator.compare(a, b)
    if (c !== 0) return c
  }
  return a < b ? -1 : a > b ? 1 : 0
}

function isWindowsPath(p: string): boolean {
  return /^[A-Za-z]:/.test(p) || p.startsWith('\\\\') || (p.includes('\\') && !p.includes('/'))
}

export function joinPath(dir: string, name: string): string {
  const sep = isWindowsPath(dir) ? '\\' : '/'
  return `${dir.replace(/[\\/]+$/, '')}${sep}${name}`
}

/** 系统文件管理器名称：Windows 为「资源管理器」，macOS 为「访达」 */
export function fileManagerName(samplePath: string): string {
  return isWindowsPath(samplePath || '') ? t('fmExplorer') : t('fmFinder')
}

type HostRecord = Record<string, unknown>

function hostField(data: unknown, key: string): unknown {
  return data == null ? undefined : (data as HostRecord)[key]
}

interface ParsedDirEntry {
  name: string
  isDirectory: boolean
}

/** 解析宿主 filesystem_get_directory_contents 返回的条目（只接受纯文件名或位于该目录下的直接子项） */
function parseDirectoryEntries(dirPath: string, data: unknown): ParsedDirEntry[] | null {
  const listedFiles = hostField(data, 'files')
  const rawList: unknown[] | null = Array.isArray(data) ? data : Array.isArray(listedFiles) ? listedFiles : null
  if (!rawList) return null
  const out: ParsedDirEntry[] = []
  const seen = new Set<string>()
  const dirKey = pathKey(dirPath)
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue
    const raw = item as HostRecord
    const rawName = typeof raw.name === 'string' ? raw.name.trim() : ''
    if (!rawName || rawName === '.' || rawName === '..') continue
    const fullPath = /[\\/]/.test(rawName) ? rawName : joinPath(dirPath, rawName)
    const { dir: entryParent } = parentDirOfPath(fullPath)
    if (pathKey(entryParent) !== dirKey) continue
    const base = fullPath.split(/[\\/]/).pop() || rawName
    if (seen.has(base)) continue
    seen.add(base)
    const isDirectory = Boolean(raw.isDirectory ?? raw.isDir ?? raw.is_dir)
    out.push({ name: base, isDirectory })
  }
  return out
}

/** 从 filesystem_get_directory_contents 的原始响应中解析写授权状态、目录占用名与直接子文件列表 */
export function parseDirectoryState(directory: string, data: unknown): DirectoryStateInfo | null {
  const parsed = parseDirectoryEntries(directory, data)
  if (!parsed) return null
  const writeAuthorized = hostField(data, 'writeAuthorized')
  const authorized = writeAuthorized === true
  const hostOutdated = typeof writeAuthorized !== 'boolean'
  return {
    directory,
    writeAuthorized: authorized,
    occupiedNames: parsed.map(e => e.name),
    existingFileNames: parsed.filter(e => !e.isDirectory).map(e => e.name),
    ...(hostOutdated ? { hostOutdated: true } : {})
  }
}

/**
 * 主动探测目录当前在宿主中的读取/写授权状态及直接子项占用名（按需调用，禁止在启动时自动扫描）
 */
export async function inspectDirectoryState(dirPath: string, hostOverride?: unknown): Promise<DirectoryStateInfo> {
  const directory = (dirPath || '').trim()
  if (!directory) {
    return { directory: '', writeAuthorized: false, occupiedNames: [], existingFileNames: [], error: 'EMPTY_DIRECTORY_PATH' }
  }
  if (FORBIDDEN_TARGET_PATTERN.test(directory)) {
    return { directory, writeAuthorized: false, occupiedNames: [], existingFileNames: [], error: t('forbiddenReason') }
  }
  const listing = await callHostTransport<unknown>('filesystem_get_directory_contents', { path: directory }, hostOverride)
  if (!listing.ok) {
    return {
      directory,
      writeAuthorized: false,
      occupiedNames: [],
      existingFileNames: [],
      error: listing.error || 'DIRECTORY_READ_FAILED'
    }
  }
  const state = parseDirectoryState(directory, listing.data)
  if (!state) {
    return {
      directory,
      writeAuthorized: false,
      occupiedNames: [],
      existingFileNames: [],
      error: 'INVALID_DIRECTORY_PAYLOAD'
    }
  }
  return state
}

/** 将 file-import 采集的文件条目转换为内部预览条目 */
export function importedFileToEntry(file: ImportedFile): RealFileEntry {
  return {
    name: file.name,
    fullPath: file.path,
    parentDir: file.parentDir,
    extension: file.extension,
    sizeBytes: file.sizeBytes,
    lastModifiedMs: file.lastModifiedMs ?? 0
  }
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
      return t('conflictInvalidName')
    case 'exists':
      return t('conflictExists')
    case 'duplicate':
      return t('conflictDuplicate')
    default:
      return ''
  }
}

const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

/** 新文件名是否非法；Windows 另外禁止 <>"|?* 与控制字符、结尾的点或空格以及 CON、NUL 等保留名 */
function isInvalidFileName(name: string, windows = false): boolean {
  if (!name.trim() || name === '.' || name === '..' || /[\\/:\0]/.test(name) || name.length > 255) return true
  return windows && ((/[<>"|?*]/.test(name) || [...name].some(ch => ch.charCodeAt(0) < 32)) || /[. ]$/.test(name) || WINDOWS_RESERVED_NAME.test(name))
}

/** 同名比较键：APFS 与 NTFS 默认不区分大小写，APFS 还不区分 Unicode 组合 / 分解形式 */
const nameKey = (name: string) => name.normalize('NFC').toLowerCase()

/**
 * 按目录独立检测改名冲突（不同目录下的同名文件互不影响）：
 * - 新名为空或含非法字符 → invalid-name
 * - 新名与同目录内任一其他现存条目（含子目录、隐藏文件、未导入的文件）的当前名相同 → exists
 * - 同目录内多个文件改成同一个新名 → 这些文件全部标 duplicate
 * 未改名的文件永远不标冲突。
 */
function markDirectoryConflicts(groupItems: RenamePreviewItem[], occupiedNames: readonly string[]): void {
  const occupied = new Map<string, number>()
  const addOccupied = (name: string) => {
    const k = nameKey(name)
    occupied.set(k, (occupied.get(k) || 0) + 1)
  }
  const occupiedKeySet = new Set<string>()
  for (const name of occupiedNames) {
    occupiedKeySet.add(nameKey(name))
    addOccupied(name)
  }
  for (const f of groupItems) {
    const k = nameKey(f.name)
    if (!occupiedKeySet.has(k)) {
      occupiedKeySet.add(k)
      addOccupied(f.name)
    }
  }

  const newNameCount = new Map<string, number>()
  for (const item of groupItems) {
    if (!item.changed) continue
    const k = nameKey(item.newName)
    newNameCount.set(k, (newNameCount.get(k) || 0) + 1)
  }

  for (const item of groupItems) {
    if (!item.changed) continue
    const k = nameKey(item.newName)
    const selfHolds = k === nameKey(item.name) ? 1 : 0
    if (isInvalidFileName(item.newName, isWindowsPath(item.fullPath || item.parentDir))) {
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
}

/**
 * 生成改名预览并按所在目录 (`parentDir`) 独立检测冲突。
 * occupiedByDir 可传按 pathKey(parentDir) 索引的 Map，或兼容单目录的 string[]。
 */
export function buildRenamePreview(
  files: RealFileEntry[],
  rule: RenameRule,
  occupiedByDir: ReadonlyArray<string> | ReadonlyMap<string, ReadonlyArray<string>> = []
): RenamePreviewItem[] {
  const items: RenamePreviewItem[] = files.map((file, idx) => {
    const newName = applyRenameRule(file.name, rule, idx)
    return { ...file, newName, changed: newName !== file.name, conflict: false }
  })

  if (items.length === 0) return items

  const groups = new Map<string, RenamePreviewItem[]>()
  for (const item of items) {
    const dirKey = pathKey(item.parentDir)
    const bucket = groups.get(dirKey)
    if (bucket) bucket.push(item)
    else groups.set(dirKey, [item])
  }

  const isMap = occupiedByDir instanceof Map
  for (const [dirKey, groupItems] of groups) {
    const dirOccupied = isMap ? (occupiedByDir.get(dirKey) ?? []) : (occupiedByDir as ReadonlyArray<string>)
    markDirectoryConflicts(groupItems, dirOccupied)
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
  if (idx < 0) return { dir: '', sep }
  if (idx === 0) return { dir: p.slice(0, 1), sep }
  const dir = p.slice(0, idx)
  return { dir: /^[A-Za-z]:$/.test(dir) ? `${dir}\\` : dir, sep }
}

/** 仅调用宿主的原子不覆盖接口；旧宿主失败时不能回退到普通 move。 */
async function safeMove(sourcePath: string, destPath: string, hostOverride?: unknown): Promise<{ ok: boolean; error?: string }> {
  const res = await callHostTransport('filesystem_move_file_no_replace', { sourcePath, destPath }, hostOverride)
  if (res.ok) return { ok: true }
  return { ok: false, error: isHostMethodMissing(res.error) ? hostUpgradeError(t('safeRenameFeature')).message : resolveErrorMessage(res, t('safeRenameFailed')) }
}

export async function executeRealFileRename(
  sourcePath: string,
  newFileName: string,
  hostOverride?: unknown
): Promise<{ ok: boolean; destinationPath?: string; error?: string }> {
  if (!sourcePath || !newFileName) {
    return { ok: false, error: t('errEmptySourceOrDest') }
  }
  if (FORBIDDEN_TARGET_PATTERN.test(sourcePath) || FORBIDDEN_TARGET_PATTERN.test(newFileName)) {
    return { ok: false, error: t('forbiddenReason') }
  }
  if (isInvalidFileName(newFileName, isWindowsPath(sourcePath))) {
    return { ok: false, error: t('errInvalidNewFileName') }
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
 * 批量撤销上一次重命名操作：倒序还原，原路径已被占用时跳过
 */
export async function undoBatchRenameHistory(
  history: RenameUndoEntry[],
  hostOverride?: unknown
): Promise<{ ok: boolean; restoredCount: number; failed: Array<{ entry: RenameUndoEntry; error: string }> }> {
  let restoredCount = 0
  const failed: Array<{ entry: RenameUndoEntry; error: string }> = []
  for (const item of [...history].reverse()) {
    const res = await safeMove(item.newPath, item.oldPath, hostOverride)
    if (res.ok) restoredCount += 1
    else failed.push({ entry: item, error: resolveErrorMessage(res, t('errRestoreFailed')) })
  }
  return { ok: restoredCount > 0 && failed.length === 0, restoredCount, failed }
}

/**
 * 在系统文件管理器中选中文件（不回退为打开文件本身）
 */
export async function openRenameFileLocation(fullPath: string, hostOverride?: unknown): Promise<{ ok: boolean; error?: string }> {
  if (!fullPath) return { ok: false, error: t('errPathEmpty') }
  const res = await callHostTransport('shell_show_item_in_folder', { fullPath }, hostOverride)
  return { ok: res.ok, error: res.ok ? undefined : resolveErrorMessage(res, t('errRevealFailed')) }
}
