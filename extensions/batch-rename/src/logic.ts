/**
 * 批量文件重命名业务逻辑与真实文件系统契约层 (BatchRename Logic)
 * 支持从本机真实目录 (Downloads / Desktop / Documents) 读取真实文件列表、实时 Diff 预览并通过 filesystem_move_file 执行原子重命名
 */

import {
  callHostTransport,
  getRealFileSize,
  getRealSystemPath,
  listRealDirectoryContents,
  showRealItemInFolder
} from '../../shared/native-ipc'

export interface RenameRule {
  type: 'replace' | 'prefix' | 'suffix' | 'case' | 'number'
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
  fullPath?: string
  parentDir?: string
  sizeBytes?: number
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
export const FORBIDDEN_TARGET_PATTERN = new RegExp('\\\\Windows\\\\System32|\\.\\.\\\\|\\.\\./', 'i')
export const FORBIDDEN_REASON = '严禁对 Windows 系统核心目录执行批量重命名或包含路径穿越字符'

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

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const k = 1024
  const idx = Math.min(units.length - 1, Math.max(0, Math.floor(Math.log(bytes) / Math.log(k))))
  const val = bytes / Math.pow(k, idx)
  return `${val >= 100 || idx === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`
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
  hostBridge?: { dllplugin?: { call?: (plugin: string, fn: string, payload: unknown) => Promise<unknown> } }
): Promise<NativeInvocationResult> {
  const check = validateInvocationPayload(method, params)
  if (!check.valid) {
    throw new Error(check.error || '参数校验失败')
  }

  const runtimeHost = hostBridge ?? (typeof (globalThis as any).ztools !== 'undefined' ? (globalThis as any).ztools : undefined)
  const callFn = runtimeHost?.dllplugin?.call

  if (typeof callFn === 'function') {
    try {
      const raw = await callFn(DLL_PLUGIN_NAME, method.trim(), params)
      let parsed: unknown = raw
      if (typeof raw === 'string') {
        try {
          parsed = JSON.parse(raw)
        } catch {
          throw new Error('MALFORMED_DLL_RESPONSE: 原生组件返回了损坏的 JSON 数据')
        }
      }
      if (parsed && typeof parsed === 'object' && 'error' in (parsed as Record<string, unknown>)) {
        const errMsg = String((parsed as Record<string, unknown>).error || '原生组件返回未知错误')
        return {
          ok: false,
          pluginName: DLL_PLUGIN_NAME,
          method: method.trim(),
          error: `DLL_ERROR: ${errMsg}`
        }
      }
      return {
        ok: true,
        pluginName: DLL_PLUGIN_NAME,
        method: method.trim(),
        data: parsed,
        fromFallback: false
      }
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.startsWith('MALFORMED_DLL_RESPONSE:')) {
        throw err
      }
      return {
        ok: false,
        pluginName: DLL_PLUGIN_NAME,
        method: method.trim(),
        error: `NATIVE_CALL_FAILED: ${message}`
      }
    }
  }

  return {
    ok: true,
    pluginName: DLL_PLUGIN_NAME,
    method: method.trim(),
    data: { simulated: true, method: method.trim(), params },
    fromFallback: true
  }
}

/**
 * 分离主文件名与扩展名
 */
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

/**
 * 单个文件名应用规则
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
      } else if (rule.caseMode === 'lower') {
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
  }

  return `${newBaseName}${newExtension}`
}

/**
 * 批量应用重命名规则
 */
export function batchApplyRename(files: string[], rule: RenameRule): RenameResultItem[] {
  return files.map((file, index) => {
    const newName = applyRenameRule(file, rule, index)
    return {
      id: `file-${index}`,
      oldName: file,
      newName,
      changed: file !== newName
    }
  })
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
  sizeBytes: number
}

/**
 * 从本机真实目录 (downloads / desktop / documents) 加载待重命名文件列表
 */
export async function fetchRealBatchRenameFiles(
  sourceScope: 'downloads' | 'desktop' | 'documents' = 'downloads',
  hostOverride?: any
): Promise<{ directory: string; files: RealFileEntry[] }> {
  const dirPath = await getRealSystemPath(sourceScope, hostOverride)
  if (!dirPath) {
    return { directory: '', files: [] }
  }

  const rawPaths = await listRealDirectoryContents(dirPath, hostOverride)
  const slice = rawPaths.slice(0, 25)
  const sizes = await Promise.all(slice.map(p => getRealFileSize(p, hostOverride)))

  const files: RealFileEntry[] = []
  for (let i = 0; i < slice.length; i++) {
    const fullPath = slice[i]
    const sz = sizes[i] || 0
    // 仅纳入具有明确文件扩展名或大于 0 字节的常规文件
    const name = fullPath.split(/[\\/]/).pop() || ''
    if (!name || (!name.includes('.') && sz === 0)) continue
    files.push({
      name,
      fullPath,
      parentDir: dirPath,
      sizeBytes: sz
    })
  }

  return { directory: dirPath, files }
}

/**
 * 在真实文件系统上对单个或批量文件执行重命名 (filesystem_move_file)
 */
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
  const sep = sourcePath.includes('\\') ? '\\' : '/'
  const parts = sourcePath.split(/[\\/]/)
  parts.pop()
  const parentDir = parts.join(sep)
  const destinationPath = `${parentDir}${sep}${newFileName}`
  if (destinationPath === sourcePath) {
    return { ok: true, destinationPath }
  }

  const res = await callHostTransport('filesystem_move_file', { sourcePath, destinationPath }, hostOverride)
  return { ok: res.ok, destinationPath, error: res.error }
}

export async function openRenameFileLocation(fullPath: string, hostOverride?: any): Promise<boolean> {
  if (!fullPath) return false
  return showRealItemInFolder(fullPath, hostOverride)
}
