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
  scanRealDirectoryTree,
  trashRealItem
} from './native-ipc.js'

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

export const CLEAN_CLASSES: CleanClassMeta[] = [
  { classId: 1, name: '系统临时缓存', shortName: '系统临时', color: '#64748b', category: 'system' },
  { classId: 2, name: '浏览器缓存', shortName: '浏览器缓存', color: '#64748b', category: 'browser' },
  { classId: 3, name: '开发工具缓存', shortName: '开发缓存', color: '#64748b', category: 'app' },
  { classId: 4, name: '系统特殊项', shortName: '系统特殊项', color: '#64748b', category: 'system' },
  { classId: 5, name: '社交办公垃圾', shortName: '社交办公', color: '#64748b', category: 'app' },
  { classId: 6, name: '大文件残留', shortName: '大文件残留', color: '#64748b', category: 'app' }
]

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
export const FORBIDDEN_REASON = '严禁将 Windows 系统核心配置库或用户个人文档目录加入垃圾清理范围'

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
    } else if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'string' && FORBIDDEN_TARGET_PATTERN.test(item)) {
          return { valid: false, error: `SECURITY_INTERCEPTED: ${FORBIDDEN_REASON}` }
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

async function scanRealCleanRuleTree(
  dirPaths: string[],
  filterExt?: RegExp,
  hostOverride?: DynamicBridge
): Promise<{ fileCount: number; totalSizeBytes: number; sampleFiles: CleanSampleFile[] }> {
  let fileCount = 0
  let totalSizeBytes = 0
  const allSamples: CleanSampleFile[] = []

  for (const dir of dirPaths) {
    if (!dir) continue
    const res = await scanRealDirectoryTree(dir, {
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
}> {
  const homeDir = await getRealSystemPath('home', hostOverride)
  if (!homeDir) {
    throw new Error('无法读取当前用户目录，未执行扫描')
  }
  const [diskInfo, env, realTemp, realDownloads] = await Promise.all([
    fetchSystemDiskInfo(hostOverride),
    getRealEnvPaths(hostOverride),
    getRealSystemPath('temp', hostOverride),
    getRealSystemPath('downloads', hostOverride)
  ])
  const tempDir = realTemp || env.temp
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
      className: '系统临时缓存',
      name: '用户临时文件夹 (%TEMP%)',
      category: 'system',
      description: '应用运行与安装包解压遗留的临时文件',
      riskLevel: 'safe',
      // C:\Windows\Temp 属于系统目录，客户端不允许插件把其中的文件移入回收站，因此不扫描
      dirs: tempDir ? [tempDir] : [],
      defaultChecked: true
    },
    {
      id: 'group-thumb-cache',
      classId: 1,
      groupId: 102,
      className: '系统临时缓存',
      name: '资源管理器缩略图与图标缓存',
      category: 'system',
      description: '资源管理器生成的图片、视频缩略图缓存 (thumbcache_*.db、iconcache_*.db)',
      riskLevel: 'safe',
      dirs: [`${localAppData}\\Microsoft\\Windows\\Explorer`],
      filterExt: /thumbcache|iconcache/i,
      defaultChecked: true
    },
    {
      id: 'group-browser-edge',
      classId: 2,
      groupId: 201,
      className: '浏览器缓存',
      name: 'Microsoft Edge 网页与 GPU 缓存',
      category: 'browser',
      description: 'Edge 磁盘缓存、Code Cache、GPUCache 与 ShaderCache（不含 Cookie 与已保存的密码）',
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
      className: '浏览器缓存',
      name: 'Google Chrome 网页与 GPU 缓存',
      category: 'browser',
      description: 'Chrome 磁盘缓存、Code Cache、GPUCache 与 ShaderCache（不含 Cookie 与已保存的密码）',
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
      className: '开发工具缓存',
      name: 'npm / pip 包管理器缓存',
      category: 'app',
      description: 'npm-cache 与 pip 下载缓存，删除后再次安装依赖时需要重新下载',
      riskLevel: 'recommended',
      dirs: [`${localAppData}\\npm-cache`, `${localAppData}\\pip\\cache`],
      defaultChecked: false
    },
    {
      id: 'group-dev-vscode',
      classId: 3,
      groupId: 302,
      className: '开发工具缓存',
      name: 'VS Code 缓存与日志',
      category: 'app',
      description: 'VS Code 的 CachedData、GPUCache 与运行日志',
      riskLevel: 'safe',
      dirs: [`${roamingAppData}\\Code\\CachedData`, `${roamingAppData}\\Code\\logs`, `${roamingAppData}\\Code\\GPUCache`],
      defaultChecked: true
    },
    {
      id: 'group-crash-dumps',
      classId: 4,
      groupId: 401,
      className: '系统特殊项',
      name: '应用崩溃转储与错误报告',
      category: 'system',
      description: '应用异常退出生成的 .dmp 转储 (CrashDumps) 与 Windows 错误报告 (WER)',
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
      className: '社交办公垃圾',
      name: '桌面客户端公共缓存 (D3DSCache / SquirrelTemp)',
      category: 'app',
      description: 'Direct3D 着色器缓存与桌面客户端自动更新留下的临时安装包',
      riskLevel: 'safe',
      dirs: [`${localAppData}\\D3DSCache`, `${localAppData}\\SquirrelTemp`],
      defaultChecked: true
    },
    {
      id: 'group-wps-backup',
      classId: 5,
      groupId: 502,
      className: '社交办公垃圾',
      name: 'WPS Office 备份文件夹',
      category: 'app',
      description: 'WPS 自动保存的文档备份，可能是你需要的文档副本，确认不再需要后再勾选',
      riskLevel: 'caution',
      dirs: [`${localAppData}\\Kingsoft\\WPS Office\\backup`],
      defaultChecked: false
    },
    {
      id: 'group-downloads-installers',
      classId: 6,
      groupId: 601,
      className: '大文件残留',
      name: '“下载”文件夹里的安装包与压缩包',
      category: 'app',
      description: '“下载”文件夹中的 exe、msi、msix、zip、7z、rar、iso 文件，确认不再需要后再勾选',
      riskLevel: 'caution',
      dirs: downloadsDir ? [downloadsDir] : [],
      filterExt: /\.(?:exe|msi|msix|zip|7z|rar|iso)$/i,
      defaultChecked: false
    }
  ]

  const scannedResults = await Promise.all(
    ruleDefs.map(async def => {
      const scanned = await scanRealCleanRuleTree(def.dirs, def.filterExt, hostOverride)
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
        pathHint: def.dirs.join('; ') || '未找到对应目录',
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
  return { groups, summary: computeCleanSummary(groups, diskInfo) }
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
    return { ...result, error: '没有勾选任何文件' }
  }

  for (const filePath of unique) {
    if (FORBIDDEN_TARGET_PATTERN.test(filePath)) {
      result.skippedProtected += 1
      result.failed.push({ path: filePath, error: FORBIDDEN_REASON })
      continue
    }
    const delRes = await trashRealItem(filePath, hostOverride)
    if (delRes.ok) {
      result.deletedCount += 1
      result.deletedSizeBytes += sizeOf.get(filePath) || 0
    } else {
      result.failed.push({ path: filePath, error: delRes.error || '移入回收站失败' })
    }
  }

  result.failedFiles = result.failed.map(f => f.path)
  result.failedCount = result.failed.length
  result.ok = result.failedCount === 0
  if (!result.ok) {
    result.error = `${result.failedCount} 个文件未能移入回收站：${result.failed[0].error}`
  }
  return result
}

/** 清理结果的提示文字：只有全部成功才算成功，部分失败与全部失败都如实说明 */
export function summarizeCleanResult(res: CleanExecutionResult): { success: boolean; title: string; message: string } {
  if (res.ok) {
    return {
      success: true,
      title: `已移入回收站 ${res.deletedCount} 个文件`,
      message: `共 ${formatBytes(res.deletedSizeBytes)}，清空回收站后才会释放磁盘空间`
    }
  }
  if (res.deletedCount > 0) {
    return {
      success: false,
      title: `${res.failedCount} 个文件未能移入回收站`,
      message: `已移入回收站 ${res.deletedCount} 个文件（${formatBytes(res.deletedSizeBytes)}）；失败原因：${res.failed[0]?.error || '未知'}`
    }
  }
  return { success: false, title: '清理失败', message: res.error || '文件未能移入回收站' }
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
    return { ok: false, error: res.error || '清空回收站失败' }
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
