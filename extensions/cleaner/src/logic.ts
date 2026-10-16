/**
 * 系统垃圾深度清理业务逻辑与 Native 契约层 (Cleaner Logic)
 * 对接 Win32 CleanerPlugin 原生导出能力，提供规则扫描、分类过滤、安全防护与离线 Mock
 */

export interface CleanSampleFile {
  path: string
  sizeBytes: number
}

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
  sampleFiles: CleanSampleFile[]
}

export interface CleanSummaryData {
  totalSizeBytes: number
  checkedSizeBytes: number
  totalFileCount: number
  checkedFileCount: number
  diskFreeSizeBytes: number
  diskTotalSizeBytes: number
  recycleBinSizeBytes: number
}

export interface CleanExecutionResult {
  ok: boolean
  deletedCount: number
  deletedSizeBytes: number
  failedCount: number
  failedFiles: string[]
  fromFallback?: boolean
  error?: string
}

export interface NativeInvocationResult {
  ok: boolean
  pluginName: string
  method: string
  data?: unknown
  error?: string
  fromFallback?: boolean
}

export const DLL_PLUGIN_NAME = "CleanerPlugin"

// 安全防线：严禁将系统注册表配置库或用户个人核心数据目录加入垃圾清理范围
export const FORBIDDEN_TARGET_PATTERN = new RegExp(
  "^(?:C:\\\\Windows\\\\System32\\\\config|C:\\\\Windows\\\\System32\\\\drivers\\\\etc|C:\\\\Users\\\\[^\\\\]+\\\\Documents)$",
  'i'
)
export const FORBIDDEN_REASON = "严禁将 Windows 系统核心配置库或用户个人文档目录加入垃圾清理范围"

/**
 * 格式化字节为易读字符串 (B / KB / MB / GB)
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const k = 1024
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const idx = Math.min(i, units.length - 1)
  const val = bytes / Math.pow(k, idx)
  return `${val.toFixed(val >= 100 || idx === 0 ? 0 : 1)} ${units[idx]}`
}

/**
 * 离线/测试高保真系统垃圾项目 Mock 数据集
 */
const MOCK_CLEAN_GROUPS: CleanGroupItem[] = [
  {
    id: "group-sys-temp",
    classId: 1,
    groupId: 5,
    className: "系统文件",
    name: "Windows 临时文件 (%TEMP%)",
    category: "system",
    description: "安装包解压残留、系统与应用程序运行过程中丢弃的临时文件",
    riskLevel: "safe",
    pathHint: "C:\\Users\\<User>\\AppData\\Local\\Temp, C:\\Windows\\Temp",
    fileCount: 6420,
    totalSizeBytes: 1880 * 1024 * 1024, // 1.88 GB
    checked: true,
    defaultChecked: true,
    sampleFiles: [
      { path: "C:\\Users\\Admin\\AppData\\Local\\Temp\\msedge_installer_tmp.exe", sizeBytes: 154 * 1024 * 1024 },
      { path: "C:\\Users\\Admin\\AppData\\Local\\Temp\\vscode-update-user-x64.zip", sizeBytes: 98 * 1024 * 1024 },
      { path: "C:\\Windows\\Temp\\CAB_4812_extracted.tmp", sizeBytes: 45 * 1024 * 1024 },
      { path: "C:\\Users\\Admin\\AppData\\Local\\Temp\\electron-pack-cache.tmp", sizeBytes: 32 * 1024 * 1024 }
    ]
  },
  {
    id: "group-win-update",
    classId: 1,
    groupId: 6,
    className: "系统补丁",
    name: "Windows Update 历史更新下载缓存",
    category: "system",
    description: "已安装 Windows 补丁留下的安装包分发残留 (SoftwareDistribution\\Download)",
    riskLevel: "recommended",
    pathHint: "C:\\Windows\\SoftwareDistribution\\Download",
    fileCount: 812,
    totalSizeBytes: 2450 * 1024 * 1024, // 2.45 GB
    checked: true,
    defaultChecked: true,
    sampleFiles: [
      { path: "C:\\Windows\\SoftwareDistribution\\Download\\KB5037771_cumulative_patch.msu", sizeBytes: 680 * 1024 * 1024 },
      { path: "C:\\Windows\\SoftwareDistribution\\Download\\windows11.0-kb5036893-x64.cab", sizeBytes: 520 * 1024 * 1024 },
      { path: "C:\\Windows\\SoftwareDistribution\\Download\\shared-patch-delta.bin", sizeBytes: 210 * 1024 * 1024 }
    ]
  },
  {
    id: "group-browser-cache",
    classId: 2,
    groupId: 100,
    className: "浏览器缓存",
    name: "主流浏览器磁盘网页媒体缓存",
    category: "browser",
    description: "Edge、Chrome、Firefox 的网页静态图片与视频预读缓存 (保留 Cookie 与密码)",
    riskLevel: "safe",
    pathHint: "C:\\Users\\<User>\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Cache",
    fileCount: 12580,
    totalSizeBytes: 860 * 1024 * 1024, // 860 MB
    checked: true,
    defaultChecked: true,
    sampleFiles: [
      { path: "C:\\Users\\Admin\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Cache\\data_3", sizeBytes: 128 * 1024 * 1024 },
      { path: "C:\\Users\\Admin\\AppData\\Local\\Microsoft\\Edge\\User Data\\Default\\Cache\\f_000412", sizeBytes: 42 * 1024 * 1024 },
      { path: "C:\\Users\\Admin\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Media Cache\\index", sizeBytes: 24 * 1024 * 1024 }
    ]
  },
  {
    id: "group-crash-dumps",
    classId: 1,
    groupId: 3,
    className: "日志文件",
    name: "系统蓝屏转储与应用程序崩溃报告 (WER)",
    category: "system",
    description: "历史蓝屏 MiniDump、WER 应用程序崩溃转储日志与 Watson 故障分析快照",
    riskLevel: "safe",
    pathHint: "C:\\Windows\\Minidump, C:\\ProgramData\\Microsoft\\Windows\\WER",
    fileCount: 42,
    totalSizeBytes: 420 * 1024 * 1024, // 420 MB
    checked: true,
    defaultChecked: true,
    sampleFiles: [
      { path: "C:\\Windows\\Minidump\\031226-14520-01.dmp", sizeBytes: 180 * 1024 * 1024 },
      { path: "C:\\ProgramData\\Microsoft\\Windows\\WER\\ReportArchive\\AppCrash_dwm.exe.dmp", sizeBytes: 110 * 1024 * 1024 }
    ]
  },
  {
    id: "group-recycle-bin",
    classId: 1,
    groupId: 27,
    className: "回收站",
    name: "清空系统回收站残留 ($Recycle.Bin)",
    category: "system",
    description: "全部分区回收站中已删除但仍占用物理磁盘的文件数据",
    riskLevel: "recommended",
    pathHint: "C:\\$Recycle.Bin, D:\\$Recycle.Bin",
    fileCount: 236,
    totalSizeBytes: 1150 * 1024 * 1024, // 1.15 GB
    checked: true,
    defaultChecked: false,
    sampleFiles: [
      { path: "C:\\$Recycle.Bin\\S-1-5-21-39\\$R184712.mp4", sizeBytes: 480 * 1024 * 1024 },
      { path: "C:\\$Recycle.Bin\\S-1-5-21-39\\$R920141.iso", sizeBytes: 320 * 1024 * 1024 }
    ]
  },
  {
    id: "group-thumb-cache",
    classId: 1,
    groupId: 2,
    className: "系统缓存",
    name: "资源管理器缩略图与图标缓存 (ThumbCache)",
    category: "system",
    description: "Windows 资源管理器生成的大量图片缩略图索引库与旧版图标缓存",
    riskLevel: "safe",
    pathHint: "C:\\Users\\<User>\\AppData\\Local\\Microsoft\\Windows\\Explorer",
    fileCount: 18,
    totalSizeBytes: 195 * 1024 * 1024, // 195 MB
    checked: true,
    defaultChecked: true,
    sampleFiles: [
      { path: "C:\\Users\\Admin\\AppData\\Local\\Microsoft\\Windows\\Explorer\\thumbcache_1920.db", sizeBytes: 95 * 1024 * 1024 },
      { path: "C:\\Users\\Admin\\AppData\\Local\\Microsoft\\Windows\\Explorer\\thumbcache_1280.db", sizeBytes: 60 * 1024 * 1024 }
    ]
  },
  {
    id: "group-dev-cache",
    classId: 3,
    groupId: 101,
    className: "开发工具",
    name: "开发环境构建缓存 (npm/cargo/gradle 缓存碎片)",
    category: "app",
    description: "本地开发工具的通用编译临时产物、包管理器下载缓存与构建临时文件",
    riskLevel: "recommended",
    pathHint: "C:\\Users\\<User>\\AppData\\Local\\npm-cache, C:\\Users\\<User>\\.cargo\\registry",
    fileCount: 3820,
    totalSizeBytes: 1650 * 1024 * 1024, // 1.65 GB
    checked: false,
    defaultChecked: false,
    sampleFiles: [
      { path: "C:\\Users\\Admin\\AppData\\Local\\npm-cache\\_cacache\\content-v2\\sha512\\3b", sizeBytes: 240 * 1024 * 1024 },
      { path: "C:\\Users\\Admin\\.cargo\\registry\\cache\\index.crates.io-6f17d22bba15001f", sizeBytes: 180 * 1024 * 1024 }
    ]
  },
  {
    id: "group-wps-cache",
    classId: 3,
    groupId: 28,
    className: "办公软件",
    name: "WPS Office / 办公套件历史编辑缓存",
    category: "app",
    description: "WPS 与 Office 本地自动恢复备份、废弃模板与已失效临时文档副本",
    riskLevel: "safe",
    pathHint: "C:\\Users\\<User>\\AppData\\Local\\Kingsoft\\WPS Office\\backup",
    fileCount: 145,
    totalSizeBytes: 310 * 1024 * 1024, // 310 MB
    checked: true,
    defaultChecked: true,
    sampleFiles: [
      { path: "C:\\Users\\Admin\\AppData\\Local\\Kingsoft\\WPS Office\\backup\\auto_recovered_backup_01.tmp", sizeBytes: 85 * 1024 * 1024 }
    ]
  },
  {
    id: "group-chat-temp",
    classId: 3,
    groupId: 30,
    className: "通讯软件",
    name: "微信与社交软件接收文件临时预览缓存",
    category: "app",
    description: "群聊自动下载的临时表情包与视频缩略图预览 (严格保留核心文字聊天记录)",
    riskLevel: "caution",
    pathHint: "C:\\Users\\<User>\\Documents\\WeChat Files\\<wxid>\\FileStorage\\Temp",
    fileCount: 480,
    totalSizeBytes: 980 * 1024 * 1024, // 980 MB
    checked: false,
    defaultChecked: false,
    sampleFiles: [
      { path: "C:\\Users\\Admin\\Documents\\WeChat Files\\wxid_123\\FileStorage\\Temp\\preview_stream_991.mp4", sizeBytes: 120 * 1024 * 1024 }
    ]
  }
]

export function getMockCleanGroups(): CleanGroupItem[] {
  return MOCK_CLEAN_GROUPS.map(item => ({
    ...item,
    sampleFiles: item.sampleFiles.map(s => ({ ...s }))
  }))
}

export function getMockCleanSummary(groups: CleanGroupItem[] = MOCK_CLEAN_GROUPS): CleanSummaryData {
  let totalSizeBytes = 0
  let checkedSizeBytes = 0
  let totalFileCount = 0
  let checkedFileCount = 0

  for (const g of groups) {
    totalSizeBytes += g.totalSizeBytes
    totalFileCount += g.fileCount
    if (g.checked) {
      checkedSizeBytes += g.totalSizeBytes
      checkedFileCount += g.fileCount
    }
  }

  return {
    totalSizeBytes,
    checkedSizeBytes,
    totalFileCount,
    checkedFileCount,
    diskFreeSizeBytes: 68 * 1024 * 1024 * 1024, // 68 GB
    diskTotalSizeBytes: 256 * 1024 * 1024 * 1024, // 256 GB
    recycleBinSizeBytes: 1150 * 1024 * 1024 // 1.15 GB
  }
}

/**
 * 严格校验调用参数与安全边界
 */
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

/**
 * 调用底层 Native DLL 插件并处理异常降级
 */
export async function invokeNativeCapability(
  method: string,
  params: Record<string, unknown>,
  hostBridge?: { dllplugin?: { call?: (plugin: string, fn: string, payload: unknown) => Promise<unknown> } }
): Promise<NativeInvocationResult> {
  const check = validateCleanPayload(method, params)
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

import {
  callHostTransport,
  getRealFileSize,
  getRealSystemPath,
  isRealElectronHost,
  listRealDirectoryContents,
  trashRealItem
} from '../../shared/native-ipc'

/**
 * 扫描真实目录并返回文件数量、总字节数与样本文件
 */
async function scanRealDirectoryRule(
  dirPaths: string[],
  filterExt?: RegExp,
  hostOverride?: any
): Promise<{ fileCount: number; totalSizeBytes: number; sampleFiles: CleanSampleFile[] }> {
  let fileCount = 0
  let totalSizeBytes = 0
  const sampleFiles: CleanSampleFile[] = []

  for (const dir of dirPaths) {
    if (!dir) continue
    const entries = await listRealDirectoryContents(dir, hostOverride)
    if (!entries || entries.length === 0) continue

    const matched = filterExt ? entries.filter(e => filterExt.test(e)) : entries
    fileCount += matched.length

    // 采样前 25 个文件读取真实体积并推算目录总占用
    const sampleSlice = matched.slice(0, 25)
    const sizes = await Promise.all(sampleSlice.map(p => getRealFileSize(p, hostOverride)))
    let sliceBytes = 0
    for (let i = 0; i < sampleSlice.length; i++) {
      const sz = sizes[i] || 0
      sliceBytes += sz
      if (sz > 0 && sampleFiles.length < 6) {
        sampleFiles.push({ path: sampleSlice[i], sizeBytes: sz })
      }
    }
    if (matched.length > sampleSlice.length && sampleSlice.length > 0) {
      const avg = Math.round(sliceBytes / sampleSlice.length)
      totalSizeBytes += sliceBytes + avg * (matched.length - sampleSlice.length)
    } else {
      totalSizeBytes += sliceBytes
    }
  }

  sampleFiles.sort((a, b) => b.sizeBytes - a.sizeBytes)
  return { fileCount, totalSizeBytes, sampleFiles }
}

/**
 * 获取系统盘 (C:) 与回收站信息
 */
export async function fetchSystemDiskInfo(hostOverride?: any): Promise<{
  diskFreeBytes: number
  diskTotalBytes: number
  recycleBinBytes: number
}> {
  let diskFreeBytes = 0
  let diskTotalBytes = 0
  let recycleBinBytes = 0

  if (!hostOverride || isRealElectronHost(hostOverride)) {
    const cRes = await callHostTransport<{
      total: number
      used: number
      available: number
      percent: number
    }>('system_get_disk_usage', { drive: 'C:/' }, hostOverride)
    if (cRes.ok && cRes.data && typeof cRes.data.total === 'number' && cRes.data.total > 0) {
      diskTotalBytes = cRes.data.total
      diskFreeBytes = cRes.data.available
    }
  }

  if (diskTotalBytes === 0) {
    try {
      const diskRes = await invokeNativeCapability('GetDiskSpace', { drive: 'C:\\' }, hostOverride)
      if (diskRes.ok && diskRes.data && typeof diskRes.data === 'object') {
        const d = diskRes.data as Record<string, unknown>
        if (typeof d.freeSpace === 'number') diskFreeBytes = d.freeSpace
        if (typeof d.totalSpace === 'number') diskTotalBytes = d.totalSpace
      }
    } catch {}
  }

  try {
    const recRes = await invokeNativeCapability('GetRecycleBinInfo', {}, hostOverride)
    if (recRes.ok && recRes.data && typeof recRes.data === 'object') {
      const r = recRes.data as Record<string, unknown>
      if (typeof r.size === 'number') recycleBinBytes = r.size
    }
  } catch {}

  if (!isRealElectronHost(hostOverride) && diskTotalBytes === 0) {
    diskFreeBytes = 68 * 1024 * 1024 * 1024
    diskTotalBytes = 256 * 1024 * 1024 * 1024
    recycleBinBytes = 1150 * 1024 * 1024
  }

  return { diskFreeBytes, diskTotalBytes, recycleBinBytes }
}

/**
 * 执行系统扫描并拉取全量清理项
 */
export async function fetchCleanRulesAndScan(hostOverride?: any): Promise<{
  groups: CleanGroupItem[]
  summary: CleanSummaryData
}> {
  const diskInfo = await fetchSystemDiskInfo(hostOverride)

  // 1. 优先在真实 Electron 宿主中执行本机真实目录垃圾扫描
  if (!hostOverride || isRealElectronHost(hostOverride)) {
    const [tempDir, homeDir, downloadsDir] = await Promise.all([
      getRealSystemPath('temp', hostOverride),
      getRealSystemPath('home', hostOverride),
      getRealSystemPath('downloads', hostOverride)
    ])

    if (tempDir || homeDir) {
      const localAppData = homeDir ? `${homeDir}\\AppData\\Local` : ''
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
          groupId: 5,
          className: '系统临时文件',
          name: 'Windows 用户与系统临时目录 (%TEMP%)',
          category: 'system',
          description: '应用运行与安装包解压遗留的临时缓存文件',
          riskLevel: 'safe',
          dirs: [tempDir, 'C:\\Windows\\Temp'].filter(Boolean),
          defaultChecked: true
        },
        {
          id: 'group-thumb-cache',
          classId: 1,
          groupId: 2,
          className: '系统缓存',
          name: '资源管理器缩略图与图标缓存 (Explorer)',
          category: 'system',
          description: 'Windows Explorer 缩略图数据库 (thumbcache_*.db)',
          riskLevel: 'safe',
          dirs: localAppData ? [`${localAppData}\\Microsoft\\Windows\\Explorer`] : [],
          filterExt: /thumbcache|iconcache/i,
          defaultChecked: true
        },
        {
          id: 'group-crash-dumps',
          classId: 1,
          groupId: 3,
          className: '崩溃转储与日志',
          name: '应用崩溃转储 (CrashDumps) 与诊断日志',
          category: 'system',
          description: '本地应用崩溃产生的 dmp 转储快照与诊断报告',
          riskLevel: 'safe',
          dirs: localAppData ? [`${localAppData}\\CrashDumps`, `${localAppData}\\Temp`] : [],
          filterExt: /\.(?:dmp|log|tmp|etl)$/i,
          defaultChecked: true
        },
        {
          id: 'group-browser-edge',
          classId: 2,
          groupId: 100,
          className: '浏览器缓存',
          name: 'Microsoft Edge / Chrome 网页静态缓存',
          category: 'browser',
          description: '浏览器磁盘缓存与 GPU 着色器缓存 (保留登录态与密码)',
          riskLevel: 'safe',
          dirs: localAppData
            ? [
                `${localAppData}\\Microsoft\\Edge\\User Data\\Default\\Cache\\Cache_Data`,
                `${localAppData}\\Google\\Chrome\\User Data\\Default\\Cache\\Cache_Data`,
                `${localAppData}\\Microsoft\\Edge\\User Data\\ShaderCache`
              ]
            : [],
          defaultChecked: true
        },
        {
          id: 'group-dev-cache',
          classId: 3,
          groupId: 101,
          className: '开发与包管理缓存',
          name: 'Node/NPM 与构建工具本地缓存碎片',
          category: 'app',
          description: '本地 npm-cache、pip 与构建工具缓存目录',
          riskLevel: 'recommended',
          dirs: localAppData ? [`${localAppData}\\npm-cache\\_cacache\\tmp`, `${localAppData}\\npm-cache\\_logs`] : [],
          defaultChecked: false
        },
        {
          id: 'group-downloads-installers',
          classId: 3,
          groupId: 102,
          className: '下载目录安装包',
          name: '下载文件夹历史安装包 (.exe / .msi / .zip)',
          category: 'app',
          description: '下载目录中已安装完毕遗留的大型安装包与压缩包',
          riskLevel: 'caution',
          dirs: downloadsDir ? [downloadsDir] : [],
          filterExt: /\.(?:exe|msi|msix|zip|7z|rar|iso)$/i,
          defaultChecked: false
        }
      ]

      const scannedGroups: CleanGroupItem[] = []
      for (const def of ruleDefs) {
        const scanned = await scanRealDirectoryRule(def.dirs, def.filterExt, hostOverride)
        scannedGroups.push({
          id: def.id,
          classId: def.classId,
          groupId: def.groupId,
          className: def.className,
          name: def.name,
          category: def.category,
          description: `${def.description}（实测 ${scanned.fileCount} 项，共 ${formatBytes(scanned.totalSizeBytes)}）`,
          riskLevel: def.riskLevel,
          pathHint: def.dirs.join('; ') || '未检测到对应目录',
          fileCount: scanned.fileCount,
          totalSizeBytes: scanned.totalSizeBytes,
          checked: def.defaultChecked && scanned.totalSizeBytes > 0,
          defaultChecked: def.defaultChecked,
          sampleFiles: scanned.sampleFiles
        })
      }

      const summary = getMockCleanSummary(scannedGroups)
      summary.diskFreeSizeBytes = diskInfo.diskFreeBytes
      summary.diskTotalSizeBytes = diskInfo.diskTotalBytes
      summary.recycleBinSizeBytes = diskInfo.recycleBinBytes
      return { groups: scannedGroups, summary }
    }
  }

  try {
    const scanRes = await invokeNativeCapability('GetScanSummary', {}, hostOverride)
    if (scanRes.ok && scanRes.data && typeof scanRes.data === 'object') {
      const data = scanRes.data as Record<string, unknown>
      if (Array.isArray(data.groups) && data.groups.length > 0) {
        const groups: CleanGroupItem[] = data.groups.map((g: any, index: number) => {
          const totalSize = Number(g.totalSize || g.checkedSize || 0)
          const fileCount = Number(g.fileCount || g.checkedCount || 0)
          const classId = Number(g.classId || 1)
          const groupId = Number(g.groupId || index + 1)
          const name = String(g.groupName || g.className || `清理项目 ${index + 1}`)
          const isBrowser = /浏览器|chrome|edge|firefox/i.test(name)
          const isApp = /wps|微信|qq|开发|应用/i.test(name)
          const category: 'system' | 'browser' | 'app' = isBrowser ? 'browser' : isApp ? 'app' : 'system'
          const riskLevel: 'safe' | 'recommended' | 'caution' =
            /微信|qq|凭据/i.test(name) ? 'caution' : /补丁|回收站|开发/i.test(name) ? 'recommended' : 'safe'

          return {
            id: `clean-${classId}-${groupId}`,
            classId,
            groupId,
            className: String(g.className || '常规垃圾'),
            name,
            category,
            description: `扫描发现 ${fileCount} 个无用缓存文件，可释放 ${formatBytes(totalSize)}`,
            riskLevel,
            pathHint: `C:\\Windows\\...\\${name}`,
            fileCount,
            totalSizeBytes: totalSize,
            checked: g.defaultChecked !== false,
            defaultChecked: g.defaultChecked !== false,
            sampleFiles: []
          }
        })

        const summary = getMockCleanSummary(groups)
        summary.diskFreeSizeBytes = diskInfo.diskFreeBytes
        summary.diskTotalSizeBytes = diskInfo.diskTotalBytes
        summary.recycleBinSizeBytes = diskInfo.recycleBinBytes
        return { groups, summary }
      }
    }
  } catch {}

  if (isRealElectronHost(hostOverride)) {
    return {
      groups: [],
      summary: {
        totalSizeBytes: 0,
        checkedSizeBytes: 0,
        totalFileCount: 0,
        checkedFileCount: 0,
        diskFreeSizeBytes: diskInfo.diskFreeBytes,
        diskTotalSizeBytes: diskInfo.diskTotalBytes,
        recycleBinSizeBytes: diskInfo.recycleBinBytes
      }
    }
  }

  const mockGroups = getMockCleanGroups()
  const summary = getMockCleanSummary(mockGroups)
  summary.diskFreeSizeBytes = diskInfo.diskFreeBytes
  summary.diskTotalSizeBytes = diskInfo.diskTotalBytes
  summary.recycleBinSizeBytes = diskInfo.recycleBinBytes
  return { groups: mockGroups, summary }
}

/**
 * 执行清理选中的垃圾项
 */
export async function executeCleanGroups(
  groups: CleanGroupItem[],
  hostOverride?: any
): Promise<CleanExecutionResult> {
  const checkedGroups = groups.filter(g => g.checked && g.totalSizeBytes > 0)
  if (checkedGroups.length === 0) {
    return {
      ok: true,
      deletedCount: 0,
      deletedSizeBytes: 0,
      failedCount: 0,
      failedFiles: []
    }
  }

  if (!hostOverride || isRealElectronHost(hostOverride)) {
    let deletedCount = 0
    let deletedSizeBytes = 0
    const failedFiles: string[] = []

    for (const g of checkedGroups) {
      for (const sample of g.sampleFiles) {
        if (FORBIDDEN_TARGET_PATTERN.test(sample.path)) {
          failedFiles.push(sample.path)
          continue
        }
        const delRes = await trashRealItem(sample.path, hostOverride)
        if (delRes.ok) {
          deletedCount += 1
          deletedSizeBytes += sample.sizeBytes
        } else {
          failedFiles.push(sample.path)
        }
      }
    }

    if (deletedCount > 0) {
      return {
        ok: true,
        deletedCount,
        deletedSizeBytes,
        failedCount: failedFiles.length,
        failedFiles,
        fromFallback: false
      }
    }
  }

  // 构造原生 StartCleanWithSelection 入参
  const payload = {
    groups: checkedGroups.map(g => ({
      classId: g.classId,
      groupId: g.groupId,
      mode: 'all'
    }))
  }

  const res = await invokeNativeCapability('StartCleanWithSelection', payload, hostOverride)
  if (!res.ok) {
    return {
      ok: false,
      deletedCount: 0,
      deletedSizeBytes: 0,
      failedCount: checkedGroups.length,
      failedFiles: checkedGroups.map(g => g.name),
      error: res.error
    }
  }

  let deletedCount = 0
  let deletedSizeBytes = 0
  for (const g of checkedGroups) {
    deletedCount += g.fileCount
    deletedSizeBytes += g.totalSizeBytes
  }

  return {
    ok: true,
    deletedCount,
    deletedSizeBytes,
    failedCount: 0,
    failedFiles: [],
    fromFallback: res.fromFallback
  }
}

/**
 * 一键清空系统回收站
 */
export async function emptyRecycleBin(hostOverride?: any): Promise<{ ok: boolean; freedBytes: number; error?: string }> {
  const res = await invokeNativeCapability('EmptyRecycleBin', {}, hostOverride)
  if (!res.ok) {
    return { ok: false, freedBytes: 0, error: res.error }
  }
  let freedBytes = 0
  if (res.data && typeof res.data === 'object') {
    const d = res.data as Record<string, unknown>
    if (typeof d.freedSize === 'number') freedBytes = d.freedSize
  }
  return { ok: true, freedBytes }
}

/**
 * 关键词过滤与分段切换过滤
 */
export function filterCleanGroups(
  groups: CleanGroupItem[],
  query: string,
  category: 'all' | 'system' | 'browser' | 'app'
): CleanGroupItem[] {
  if (!Array.isArray(groups)) return []
  const q = typeof query === 'string' ? query.trim().toLowerCase() : ''

  return groups.filter(item => {
    if (!item) return false
    if (category !== 'all' && item.category !== category) return false
    if (!q) return true
    return (
      item.name.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.className.toLowerCase().includes(q) ||
      item.pathHint.toLowerCase().includes(q)
    )
  })
}
