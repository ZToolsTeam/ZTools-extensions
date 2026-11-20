type DynamicBridge = ReturnType<typeof JSON.parse>;
/**
 * 垃圾清理：扫描规则与清理逻辑
 * - 在客户端里扫描本机的临时文件、浏览器缓存、开发工具缓存、崩溃转储等目录，每类取最大的 25 个文件作为可清理样本
 * - 只把用户勾选的样本文件移入回收站，失败如实返回；不会按分类整体删除目录
 */

import {
  callHostTransport,
  formatBytes,
  getRealEnvPaths,
  getRealSystemPath,
  invokeDllPluginCapability,
  createDirectoryScanner,
  trashRealItem
} from './native-ipc.js'
import { t } from './i18n.js'

export { formatBytes } from './native-ipc.js'

export interface CleanSampleFile {
  path: string
  sizeBytes: number
  lastModifiedMs?: number
}

export interface CleanClassMeta {
  classId: number
  name: string
  shortName: string
  color: string
  category: 'system' | 'browser' | 'app'
}

export function getCleanClasses(): CleanClassMeta[] {
  return [
    { classId: 1, name: t('classSysTemp'), shortName: t('classSysTempShort'), color: '#64748b', category: 'system' },
    { classId: 2, name: t('classBrowser'), shortName: t('classBrowser'), color: '#64748b', category: 'browser' },
    { classId: 3, name: t('classDev'), shortName: t('classDevShort'), color: '#64748b', category: 'app' },
    { classId: 4, name: t('classSysSpecial'), shortName: t('classSysSpecial'), color: '#64748b', category: 'system' },
    { classId: 5, name: t('classSocialOffice'), shortName: t('classSocialOfficeShort'), color: '#64748b', category: 'app' },
    { classId: 6, name: t('classLargeFiles'), shortName: t('classLargeFiles'), color: '#64748b', category: 'app' }
  ]
}

export const CLEAN_CLASSES: CleanClassMeta[] = getCleanClasses()

export interface CleanGroupItem {
  id: string
  classId: number
  groupId: number
  className: string
  name: string
  category: 'system' | 'browser' | 'app'
  description: string
  riskLevel: 'safe' | 'recommended' | 'caution'
  pathHint: string
  fileCount: number
  totalSizeBytes: number
  checked: boolean
  defaultChecked: boolean
  isProtected?: boolean
  /** 本规则扫描的目录（用于在资源管理器中定位） */
  dirs?: string[]
  sampleFiles: CleanSampleFile[]
}

export interface CleanSummaryData {
  totalSizeBytes: number
  totalFileCount: number
  /** C 盘可用空间；读取失败时为 0，界面不显示 */
  diskFreeSizeBytes: number
  diskTotalSizeBytes: number
}

export interface CleanExecutionResult {
  /** 所有勾选的文件都已移入回收站 */
  ok: boolean
  deletedCount: number
  deletedSizeBytes: number
  failedCount: number
  failedFiles: string[]
  failed: Array<{ path: string; error: string }>
  skippedProtected: number
  error?: string
}

/** 每个清理规则最多取多少个最大的文件作为可清理样本 */
export const SAMPLE_FILES_PER_GROUP = 25

export interface NativeInvocationResult {
  ok: boolean
  pluginName: string
  method: string
  data?: unknown
  error?: string
  fromFallback?: boolean
  freedBytes?: number
}

export const DLL_PLUGIN_NAME = 'CleanerPlugin'

// 安全防线：严禁将系统核心保护目录、注册表配置库、应用安装目录或用户个人文档目录加入垃圾清理范围
export const FORBIDDEN_TARGET_PATTERN =
  /(?:^|[\\/])(?:System32|SysWOW64|Program Files|Program Files \(x86\)|\.\.)(?:$|[\\/])|^C:\\Windows(?:[\\/](?!Temp(?:$|[\\/])|SoftwareDistribution[\\/]Download(?:$|[\\/])|Minidump(?:$|[\\/])|Prefetch(?:$|[\\/])|Logs(?:$|[\\/])).*)?$|^C:\\Users\\[^\\]+\\Documents\\?$/i
export const FORBIDDEN_REASON = t('forbiddenReason')

/** 汇总各规则扫描到的文件总数与总体积（包含没有作为样本列出的文件） */
export function computeCleanSummary(
  groups: CleanGroupItem[],
  disk: { diskFreeBytes: number; diskTotalBytes: number } = { diskFreeBytes: 0, diskTotalBytes: 0 }
): CleanSummaryData {
  let totalSizeBytes = 0
  let totalFileCount = 0
  for (const g of groups) {
    totalSizeBytes += g.totalSizeBytes
    totalFileCount += g.fileCount
  }
  return {
    totalSizeBytes,
    totalFileCount,
    diskFreeSizeBytes: disk.diskFreeBytes,
    diskTotalSizeBytes: disk.diskTotalBytes
  }
}

export function validateCleanPayload(method: string, params: unknown): { valid: boolean; error?: string } {
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
    } else if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'string' && FORBIDDEN_TARGET_PATTERN.test(item)) {
          return { valid: false, error: t('errSecurityIntercepted', { reason: t('forbiddenReason') }) }
        }
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
  const check = validateCleanPayload(method, params)
  if (!check.valid) {
    throw new Error(check.error || t('errValidationFailed'))
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

async function scanRealCleanRuleTree(
  dirPaths: string[],
  filterExt?: RegExp,
  hostOverride?: DynamicBridge,
  scanner = createDirectoryScanner(hostOverride)
): Promise<{ fileCount: number; totalSizeBytes: number; sampleFiles: CleanSampleFile[] }> {
  let fileCount = 0
  let totalSizeBytes = 0
  const allSamples: CleanSampleFile[] = []

  for (const dir of dirPaths) {
    if (!dir) continue
    const res = await scanner.scan(dir, {
      maxFiles: 200,
      collectTopN: 20,
      filterExt,
      hostOverride
    })
    fileCount += res.fileCount
    totalSizeBytes += res.totalBytes
    for (const f of res.files) {
      // 只把普通文件作为样本：目录读取兜底时结果里可能混有子目录，不能把整个子目录移入回收站
      if (f.isDir || !(f.sizeBytes > 0)) continue
      allSamples.push({
        path: f.path,
        sizeBytes: f.sizeBytes,
        lastModifiedMs: f.lastModifiedMs
      })
    }
  }

  allSamples.sort((a, b) => b.sizeBytes - a.sizeBytes)
  return {
    fileCount,
    totalSizeBytes,
    sampleFiles: allSamples.slice(0, SAMPLE_FILES_PER_GROUP)
  }
}

/** 读取 C 盘总容量与可用空间；读取失败时返回 0，不用估算值代替 */
export async function fetchSystemDiskInfo(hostOverride?: DynamicBridge): Promise<{
  diskFreeBytes: number
  diskTotalBytes: number
}> {
  const cRes = await callHostTransport<{
    total: number
    used: number
    available: number
    percent: number
  }>('system_get_disk_usage', { drive: 'C:/' }, hostOverride)
  if (cRes.ok && cRes.data && typeof cRes.data.total === 'number' && cRes.data.total > 0) {
    return {
      diskTotalBytes: cRes.data.total,
      diskFreeBytes: typeof cRes.data.available === 'number' ? cRes.data.available : 0
    }
  }
  return { diskFreeBytes: 0, diskTotalBytes: 0 }
}

/**
 * 按内置规则扫描本机目录，返回各清理规则的真实文件数、体积与样本文件。
 * 读取不到用户目录时直接报错，不会退回到默认用户目录或示例数据
 */
export async function fetchCleanRulesAndScan(hostOverride?: DynamicBridge): Promise<{
  groups: CleanGroupItem[]
  summary: CleanSummaryData
  error?: string
}> {
  const scanner = createDirectoryScanner(hostOverride)
  const homeDir = await getRealSystemPath('home', hostOverride)
  if (!homeDir) {
    throw new Error(t('errNoHomeDir'))
  }
  const [diskInfo, env, commonFolders, realDownloads] = await Promise.all([
    fetchSystemDiskInfo(hostOverride),
    getRealEnvPaths(hostOverride),
    callHostTransport<{ folders?: Array<{ id: string; path: string; exists: boolean }> }>('system_list_common_folders', {}, hostOverride),
    getRealSystemPath('downloads', hostOverride)
  ])
  const tempDir = commonFolders.data?.folders?.find(folder => folder.id === 'temp' && folder.exists)?.path
  if (!commonFolders.ok || !tempDir) {
    throw new Error(commonFolders.error || t('errNoTempDir'))
  }
  const downloadsDir = realDownloads || env.downloads
  const localAppData = env.localAppData || `${homeDir}\\AppData\\Local`
  const roamingAppData = env.appData || `${homeDir}\\AppData\\Roaming`

  const ruleDefs: Array<{
    id: string
    classId: number
    groupId: number
    className: string
    name: string
    category: 'system' | 'browser' | 'app'
    description: string
    riskLevel: 'safe' | 'recommended' | 'caution'
    dirs: string[]
    filterExt?: RegExp
    defaultChecked: boolean
  }> = [
    {
      id: 'group-sys-temp',
      classId: 1,
      groupId: 101,
      className: t('classSysTemp'),
      name: t('grpSysTempName'),
      category: 'system',
      description: t('grpSysTempDesc'),
      riskLevel: 'safe',
      // C:\Windows\Temp 属于系统目录，客户端不允许插件把其中的文件移入回收站，因此不扫描
      dirs: tempDir ? [tempDir] : [],
      defaultChecked: true
    },
    {
      id: 'group-thumb-cache',
      classId: 1,
      groupId: 102,
      className: t('classSysTemp'),
      name: t('grpThumbName'),
      category: 'system',
      description: t('grpThumbDesc'),
      riskLevel: 'safe',
      dirs: [`${localAppData}\\Microsoft\\Windows\\Explorer`],
      filterExt: /thumbcache|iconcache/i,
      defaultChecked: true
    },
    {
      id: 'group-browser-edge',
      classId: 2,
      groupId: 201,
      className: t('classBrowser'),
      name: t('grpEdgeName'),
      category: 'browser',
      description: t('grpEdgeDesc'),
      riskLevel: 'safe',
      dirs: [
        `${localAppData}\\Microsoft\\Edge\\User Data\\Default\\Cache`,
        `${localAppData}\\Microsoft\\Edge\\User Data\\Default\\Code Cache`,
        `${localAppData}\\Microsoft\\Edge\\User Data\\Default\\GPUCache`,
        `${localAppData}\\Microsoft\\Edge\\User Data\\ShaderCache`
      ],
      defaultChecked: true
    },
    {
      id: 'group-browser-chrome',
      classId: 2,
      groupId: 202,
      className: t('classBrowser'),
      name: t('grpChromeName'),
      category: 'browser',
      description: t('grpChromeDesc'),
      riskLevel: 'safe',
      dirs: [
        `${localAppData}\\Google\\Chrome\\User Data\\Default\\Cache`,
        `${localAppData}\\Google\\Chrome\\User Data\\Default\\Code Cache`,
        `${localAppData}\\Google\\Chrome\\User Data\\Default\\GPUCache`,
        `${localAppData}\\Google\\Chrome\\User Data\\ShaderCache`
      ],
      defaultChecked: true
    },
    {
      id: 'group-dev-npm',
      classId: 3,
      groupId: 301,
      className: t('classDev'),
      name: t('grpNpmPipName'),
      category: 'app',
      description: t('grpNpmPipDesc'),
      riskLevel: 'recommended',
      dirs: [`${localAppData}\\npm-cache`, `${localAppData}\\pip\\cache`],
      defaultChecked: false
    },
    {
      id: 'group-dev-vscode',
      classId: 3,
      groupId: 302,
      className: t('classDev'),
      name: t('grpVscodeName'),
      category: 'app',
      description: t('grpVscodeDesc'),
      riskLevel: 'safe',
      dirs: [`${roamingAppData}\\Code\\CachedData`, `${roamingAppData}\\Code\\logs`, `${roamingAppData}\\Code\\GPUCache`],
      defaultChecked: true
    },
    {
      id: 'group-crash-dumps',
      classId: 4,
      groupId: 401,
      className: t('classSysSpecial'),
      name: t('grpCrashName'),
      category: 'system',
      description: t('grpCrashDesc'),
      riskLevel: 'safe',
      dirs: [
        `${localAppData}\\CrashDumps`,
        `${localAppData}\\Microsoft\\Windows\\WER\\ReportArchive`,
        `${localAppData}\\Microsoft\\Windows\\WER\\ReportQueue`
      ],
      defaultChecked: true
    },
    {
      id: 'group-office-cache',
      classId: 5,
      groupId: 501,
      className: t('classSocialOffice'),
      name: t('grpOfficeName'),
      category: 'app',
      description: t('grpOfficeDesc'),
      riskLevel: 'safe',
      dirs: [`${localAppData}\\D3DSCache`, `${localAppData}\\SquirrelTemp`],
      defaultChecked: true
    },
    {
      id: 'group-wps-backup',
      classId: 5,
      groupId: 502,
      className: t('classSocialOffice'),
      name: t('grpWpsName'),
      category: 'app',
      description: t('grpWpsDesc'),
      riskLevel: 'caution',
      dirs: [`${localAppData}\\Kingsoft\\WPS Office\\backup`],
      defaultChecked: false
    },
    {
      id: 'group-downloads-installers',
      classId: 6,
      groupId: 601,
      className: t('classLargeFiles'),
      name: t('grpDownloadsName'),
      category: 'app',
      description: t('grpDownloadsDesc'),
      riskLevel: 'caution',
      dirs: downloadsDir ? [downloadsDir] : [],
      filterExt: /\.(?:exe|msi|msix|zip|7z|rar|iso)$/i,
      defaultChecked: false
    }
  ]

  const scannedResults = await Promise.all(
    ruleDefs.map(async def => {
      const scanned = await scanRealCleanRuleTree(def.dirs, def.filterExt, hostOverride, scanner)
      if (scanned.totalSizeBytes <= 0 && scanned.fileCount <= 0 && def.classId > 4) return null
      const group: CleanGroupItem = {
        id: def.id,
        classId: def.classId,
        groupId: def.groupId,
        className: def.className,
        name: def.name,
        category: def.category,
        description: def.description,
        riskLevel: def.riskLevel,
        pathHint: def.dirs.join('; ') || t('dirNotFound'),
        dirs: def.dirs,
        fileCount: scanned.fileCount,
        totalSizeBytes: scanned.totalSizeBytes,
        checked: def.defaultChecked && scanned.sampleFiles.length > 0,
        defaultChecked: def.defaultChecked,
        sampleFiles: scanned.sampleFiles
      }
      return group
    })
  )
  const groups = scannedResults.filter((g): g is CleanGroupItem => g !== null)
  return { groups, summary: computeCleanSummary(groups, diskInfo), error: scanner.error }
}

/**
 * 把用户勾选的文件逐个移入回收站。只处理传入的路径，不按规则整体删除目录；
 * 命中系统保护规则的路径直接跳过；任何一个文件失败都会如实计入，ok 只在全部成功时为 true
 */
export async function executeCleanFiles(
  filePaths: string[],
  knownFiles: CleanSampleFile[] = [],
  hostOverride?: DynamicBridge
): Promise<CleanExecutionResult> {
  const sizeOf = new Map<string, number>()
  for (const f of knownFiles) sizeOf.set(f.path, f.sizeBytes)
  const unique = Array.from(
    new Set((Array.isArray(filePaths) ? filePaths : []).filter(p => typeof p === 'string' && p.trim().length > 0))
  )
  const result: CleanExecutionResult = {
    ok: false,
    deletedCount: 0,
    deletedSizeBytes: 0,
    failedCount: 0,
    failedFiles: [],
    failed: [],
    skippedProtected: 0
  }
  if (unique.length === 0) {
    return { ...result, error: t('errNoCheckedFiles') }
  }

  for (const filePath of unique) {
    if (FORBIDDEN_TARGET_PATTERN.test(filePath)) {
      result.skippedProtected += 1
      result.failed.push({ path: filePath, error: t('forbiddenReason') })
      continue
    }
    const delRes = await trashRealItem(filePath, hostOverride)
    if (delRes.ok) {
      result.deletedCount += 1
      result.deletedSizeBytes += sizeOf.get(filePath) || 0
    } else {
      result.failed.push({ path: filePath, error: delRes.error || t('errMoveToTrashFailed') })
    }
  }

  result.failedFiles = result.failed.map(f => f.path)
  result.failedCount = result.failed.length
  result.ok = result.failedCount === 0
  if (!result.ok) {
    result.error = t('errFilesNotTrashed', { count: result.failedCount, first: result.failed[0].error })
  }
  return result
}

/** 清理结果的提示文字：只有全部成功才算成功，部分失败与全部失败都如实说明 */
export function summarizeCleanResult(res: CleanExecutionResult): { success: boolean; title: string; message: string } {
  if (res.ok) {
    return {
      success: true,
      title: t('cleanOkTitle', { count: res.deletedCount }),
      message: t('cleanOkMsg', { size: formatBytes(res.deletedSizeBytes) })
    }
  }
  if (res.deletedCount > 0) {
    return {
      success: false,
      title: t('cleanPartialTitle', { count: res.failedCount }),
      message: t('cleanPartialMsg', {
        ok: res.deletedCount,
        size: formatBytes(res.deletedSizeBytes),
        reason: res.failed[0]?.error || t('errUnknown')
      })
    }
  }
  return { success: false, title: t('cleanFailedTitle'), message: res.error || t('cleanFailedDefaultMsg') }
}

/** 扫描后的默认勾选：默认勾选规则里的样本文件（WPS 备份、包管理器缓存、“下载”里的文件默认不勾选） */
export function pickDefaultCheckedSamplePaths(groups: CleanGroupItem[]): string[] {
  const out: string[] = []
  for (const g of groups) {
    if (!g.checked || g.isProtected) continue
    for (const f of g.sampleFiles) out.push(f.path)
  }
  return out
}

/** 清空系统回收站（永久删除，不能撤销）；以客户端返回的结果为准，失败如实返回原因 */
export async function emptyRecycleBin(
  hostOverride?: DynamicBridge
): Promise<{ ok: boolean; removedCount?: number; message?: string; error?: string }> {
  const res = await invokeNativeCapability('EmptyRecycleBin', {}, hostOverride)
  if (!res.ok) {
    return { ok: false, error: res.error || t('emptyBinFailedDefault') }
  }
  const d = res.data && typeof res.data === 'object' ? (res.data as Record<string, unknown>) : {}
  return {
    ok: true,
    ...(typeof d.removedCount === 'number' ? { removedCount: d.removedCount } : {}),
    ...(typeof d.message === 'string' && d.message ? { message: d.message } : {})
  }
}

export function filterCleanGroups(
  groups: CleanGroupItem[],
  query: string,
  category: 'all' | 'system' | 'browser' | 'app',
  classIdFilter = 0,
  riskFilter = 'all'
): CleanGroupItem[] {
  if (!Array.isArray(groups)) return []
  const q = typeof query === 'string' ? query.trim().toLowerCase() : ''

  return groups.filter(item => {
    if (!item) return false
    if (category !== 'all' && item.category !== category) return false
    if (classIdFilter > 0 && item.classId !== classIdFilter) return false
    if (riskFilter !== 'all' && item.riskLevel !== riskFilter) return false
    if (!q) return true
    return (
      item.name.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.className.toLowerCase().includes(q) ||
      item.pathHint.toLowerCase().includes(q)
    )
  })
}
