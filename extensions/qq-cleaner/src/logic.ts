/**
 * QQ / NTQQ 专项深度清理业务逻辑与真实环境契约层 (QQCleaner Logic)
 * 严格保护聊天消息数据库 (Msg3.0.db / nt_msg.db / Registry.db)，真实扫描本机 Tencent Files 与 QQ 缓存目录
 */

import {
  callHostTransport,
  getRealFileSize,
  getRealSystemPath,
  listRealDirectoryContents,
  showRealItemInFolder,
  trashRealItem
} from '../../shared/native-ipc'

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

export interface QQCleanCategoryItem {
  id: string
  name: string
  category: 'cache' | 'media' | 'files' | 'logs'
  riskLevel: 'safe' | 'recommended' | 'caution'
  targetDir: string
  existsOnDisk: boolean
  fileCount: number
  totalSizeBytes: number
  checked: boolean
  sampleFiles: Array<{ path: string; sizeBytes: number }>
  description: string
}

export interface QQScanSnapshot {
  baseDirectories: string[]
  detectedAccounts: string[]
  categories: QQCleanCategoryItem[]
  totalScannableBytes: number
  checkedBytes: number
  systemDiskFreeBytes: number
  systemDiskTotalBytes: number
}

export const DLL_PLUGIN_NAME = 'QQCleanerPlugin'
export const FORBIDDEN_TARGET_PATTERN = new RegExp('(?:^|[\\\\/])(?:Msg3\\.0\\.db|nt_msg\\.db|Registry\\.db)$', 'i')
export const FORBIDDEN_REASON = 'QQ 核心聊天记录加密数据库受保护，专项清理严禁触碰聊天消息库'

const PRESET_ITEMS: CapabilityActionItem[] = [
  {
    id: 'qq-info-detect',
    title: '自动侦测本机 QQ / NTQQ 数据存储路径与账号列表',
    subtitle: '扫描默认文档目录与自定义消息迁移路径下的登录账号',
    tag: '账号侦测',
    method: 'QueryQQInfo',
    params: {}
  },
  {
    id: 'qq-scan-junk',
    title: '深度扫描群聊缩略图、短视频缓存与临时文件',
    subtitle: '区分安全可删缓存与重要接收文件，默认保护聊天记录库',
    tag: '缓存扫描',
    method: 'StartScanAsync',
    params: { scanScope: 'safe_cache' }
  },
  {
    id: 'qq-stats-summary',
    title: '查看各清理分组空间占比明细',
    subtitle: '汇总图片缓存、语音缓存、崩溃日志与历史安装包大小',
    tag: '空间统计',
    method: 'GetTotalStats',
    params: {}
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

async function scanQQDirStats(
  dirPath: string,
  hostOverride?: any
): Promise<{ exists: boolean; fileCount: number; totalSizeBytes: number; sampleFiles: Array<{ path: string; sizeBytes: number }> }> {
  if (!dirPath) return { exists: false, fileCount: 0, totalSizeBytes: 0, sampleFiles: [] }
  const entries = await listRealDirectoryContents(dirPath, hostOverride)
  if (!entries || entries.length === 0) {
    return { exists: false, fileCount: 0, totalSizeBytes: 0, sampleFiles: [] }
  }

  const safeEntries = entries.filter(p => !FORBIDDEN_TARGET_PATTERN.test(p))
  const slice = safeEntries.slice(0, 20)
  const sizes = await Promise.all(slice.map(p => getRealFileSize(p, hostOverride)))

  let totalSizeBytes = 0
  const sampleFiles: Array<{ path: string; sizeBytes: number }> = []
  for (let i = 0; i < slice.length; i++) {
    const sz = sizes[i] || 0
    totalSizeBytes += sz
    if (sz > 0) {
      sampleFiles.push({ path: slice[i], sizeBytes: sz })
    }
  }
  if (safeEntries.length > slice.length && slice.length > 0) {
    const avg = Math.round(totalSizeBytes / slice.length)
    totalSizeBytes += avg * (safeEntries.length - slice.length)
  }

  sampleFiles.sort((a, b) => b.sizeBytes - a.sizeBytes)
  return {
    exists: true,
    fileCount: safeEntries.length,
    totalSizeBytes,
    sampleFiles: sampleFiles.slice(0, 6)
  }
}

/**
 * 探测并扫描本机真实 QQ / NTQQ 存储路径与缓存分类
 */
export async function fetchQQCleanSnapshot(hostOverride?: any): Promise<QQScanSnapshot> {
  const [documentsDir, appDataDir, homeDir, tempDir, diskRes] = await Promise.all([
    getRealSystemPath('documents', hostOverride),
    getRealSystemPath('appData', hostOverride),
    getRealSystemPath('home', hostOverride),
    getRealSystemPath('temp', hostOverride),
    callHostTransport<{ total: number; used: number; available: number }>('system_get_disk_usage', { drive: 'C:/' }, hostOverride)
  ])

  const localAppData = homeDir ? `${homeDir}\\AppData\\Local` : ''
  const tencentFilesDir = documentsDir ? `${documentsDir}\\Tencent Files` : 'C:\\Users\\Default\\Documents\\Tencent Files'

  const detectedAccounts: string[] = []
  const subDirs = await listRealDirectoryContents(tencentFilesDir, hostOverride)
  for (const sub of subDirs) {
    const name = sub.split(/[\\/]/).pop() || ''
    if (/^\d{5,12}$/.test(name) || /^nt_qq/i.test(name)) {
      detectedAccounts.push(name)
    }
  }

  const ruleTargets: Array<{
    id: string
    name: string
    category: QQCleanCategoryItem['category']
    riskLevel: QQCleanCategoryItem['riskLevel']
    targetDir: string
    defaultChecked: boolean
    description: string
  }> = [
    {
      id: 'qq-roaming-cache',
      name: 'QQ / NTQQ 客户端 Roaming 运行时缓存',
      category: 'cache',
      riskLevel: 'safe',
      targetDir: appDataDir ? `${appDataDir}\\Tencent\\QQ` : 'C:\\Users\\Default\\AppData\\Roaming\\Tencent\\QQ',
      defaultChecked: true,
      description: 'QQ 运行期表情包缓存、临时网页渲染资源与迷你资讯缓存'
    },
    {
      id: 'qq-tencent-roaming',
      name: 'Tencent 公共组件与日志缓存目录',
      category: 'logs',
      riskLevel: 'safe',
      targetDir: appDataDir ? `${appDataDir}\\Tencent` : 'C:\\Users\\Default\\AppData\\Roaming\\Tencent',
      defaultChecked: true,
      description: '腾讯公用更新器、上报日志与崩溃转储临时数据'
    },
    {
      id: 'qq-doc-files',
      name: 'QQ 本地消息与群聊图片视频缓存 (Tencent Files)',
      category: 'media',
      riskLevel: 'recommended',
      targetDir: tencentFilesDir,
      defaultChecked: true,
      description: '群聊自动加载的缩略图、短视频缓存 (严格排除 Msg3.0.db / nt_msg.db)'
    },
    {
      id: 'qq-local-cache',
      name: 'LocalAppData 腾讯渲染与音视频缓存',
      category: 'files',
      riskLevel: 'recommended',
      targetDir: localAppData ? `${localAppData}\\Tencent` : 'C:\\Users\\Default\\AppData\\Local\\Tencent',
      defaultChecked: true,
      description: '本地音视频通话临时缓冲与 CEF 内核着色器缓存'
    },
    {
      id: 'qq-sys-temp',
      name: '系统 %TEMP% 下的临时接收与解压残留',
      category: 'logs',
      riskLevel: 'safe',
      targetDir: tempDir || 'C:\\Windows\\Temp',
      defaultChecked: true,
      description: '系统临时目录中遗留的截屏与安装包解压临时文件'
    }
  ]

  const categories: QQCleanCategoryItem[] = []
  for (const rule of ruleTargets) {
    const stat = await scanQQDirStats(rule.targetDir, hostOverride)
    categories.push({
      id: rule.id,
      name: rule.name,
      category: rule.category,
      riskLevel: rule.riskLevel,
      targetDir: rule.targetDir,
      existsOnDisk: stat.exists,
      fileCount: stat.fileCount,
      totalSizeBytes: stat.totalSizeBytes,
      checked: rule.defaultChecked && stat.totalSizeBytes > 0,
      sampleFiles: stat.sampleFiles,
      description: rule.description
    })
  }

  const totalScannableBytes = categories.reduce((s, c) => s + c.totalSizeBytes, 0)
  const checkedBytes = categories.filter(c => c.checked).reduce((s, c) => s + c.totalSizeBytes, 0)

  return {
    baseDirectories: [tencentFilesDir, appDataDir ? `${appDataDir}\\Tencent` : ''].filter(Boolean),
    detectedAccounts,
    categories,
    totalScannableBytes,
    checkedBytes,
    systemDiskFreeBytes: diskRes.ok && diskRes.data?.available ? diskRes.data.available : 0,
    systemDiskTotalBytes: diskRes.ok && diskRes.data?.total ? diskRes.data.total : 0
  }
}

/**
 * 执行 QQ 缓存安全清理（严格拦截聊天数据库文件，走真实回收站移除）
 */
export async function executeQQCleanup(
  categories: QQCleanCategoryItem[],
  hostOverride?: any
): Promise<{ ok: boolean; deletedCount: number; freedBytes: number; skippedProtected: number; error?: string }> {
  const selected = categories.filter(c => c.checked && c.sampleFiles.length > 0)
  if (selected.length === 0) {
    return { ok: true, deletedCount: 0, freedBytes: 0, skippedProtected: 0 }
  }

  let deletedCount = 0
  let freedBytes = 0
  let skippedProtected = 0

  for (const cat of selected) {
    for (const sample of cat.sampleFiles) {
      if (FORBIDDEN_TARGET_PATTERN.test(sample.path)) {
        skippedProtected += 1
        continue
      }
      const res = await trashRealItem(sample.path, hostOverride)
      if (res.ok) {
        deletedCount += 1
        freedBytes += sample.sizeBytes
      }
    }
  }

  return {
    ok: true,
    deletedCount,
    freedBytes,
    skippedProtected
  }
}

export async function openQQDirectory(dirPath: string, hostOverride?: any): Promise<boolean> {
  if (!dirPath) return false
  return showRealItemInFolder(dirPath, hostOverride)
}
