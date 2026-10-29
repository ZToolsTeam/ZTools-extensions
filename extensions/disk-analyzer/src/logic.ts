import { scanRealDirectoryTree } from './directory-scan.js'
import { probeRealDiskDrives, uniqueCapacityDrives, type RealDiskDriveInfo } from './volume-ipc.js'
import { hostUpgradeError, isHostMethodMissing } from './host-compat.js'
/**
 * 磁盘空间分析业务逻辑
 * 读取磁盘分区容量 (system_get_disk_usage)、扫描分区与用户目录，
 * 按 10 类文件类型分组统计体积，并可下钻到二级扩展名
 */

import {
  formatBytes as formatBinaryBytes,
  getRealFileSize,
  getRealSystemPath,
  invokeDllPluginCapability,
  isRealElectronHost,
  listRealDirectoryContents,


  searchRealIndexedFiles,
  callHostTransport,
  showRealItemInFolder,
  trashRealItem,
  openRealPath
} from './native-ipc.js'

export { isRealElectronHost } from './native-ipc.js'

/**
 * 容量与文件大小按系统习惯显示：macOS 的访达按 1000 进制（与硬件信息插件、「关于本机」一致），
 * Windows 资源管理器按 1024 进制。否则同一块盘在 macOS 上会比访达少约 7%（例如 460 GB 对 494 GB）。
 */
export function formatBytes(bytes: number, decimals = 1, mac: boolean = isMacPlatform()): string {
  if (!mac) return formatBinaryBytes(bytes, decimals)
  const num = Number(bytes)
  if (!Number.isFinite(num) || num <= 0) return '0 B'
  if (num < 1000) return `${Math.round(num)} B`
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let val = num
  let idx = 0
  while (val >= 1000 && idx < units.length - 1) {
    val /= 1000
    idx += 1
  }
  const safeDecimals = Math.max(0, Math.floor(decimals))
  return `${val >= 100 ? val.toFixed(0) : val.toFixed(safeDecimals)} ${units[idx]}`
}

/** 测试注入的宿主替身（与 callHostTransport 的 hostOverride 相同） */
type HostOverride = Parameters<typeof callHostTransport>[2]

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

export interface DiskDriveItem {
  drive: string
  label: string
  fileSystem: string
  totalBytes: number
  usedBytes: number
  availableBytes: number
  usagePercent: number
  status: 'normal' | 'warning' | 'danger'
}

/**
 * 与 Windows 原生插件一致的 10 大官方文件类型分组
 */
export type OfficialFileTypeGroupId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 99

export interface OfficialFileTypeGroupMeta {
  groupId: OfficialFileTypeGroupId
  name: string
  shortName: string
  color: string
  legacyCategory: DiskFileEntry['category']
  description: string
  sampleQueries: string[]
}

export const OFFICIAL_FILE_TYPE_GROUPS: OfficialFileTypeGroupMeta[] = [
  {
    groupId: 1,
    name: '视频文件',
    shortName: '视频文件',
    color: '#a855f7',
    legacyCategory: 'video',
    description: '高清影视、录屏素材、直播缓存与流媒体切片 (.mp4, .mkv, .mov, .avi, .webm, .ts)',
    sampleQueries: ['.mp4', '.mkv', '.mov', '.webm']
  },
  {
    groupId: 2,
    name: '音频文件',
    shortName: '音频文件',
    color: '#ec4899',
    legacyCategory: 'video',
    description: '无损音乐、播客录音、语音素材与音效文件 (.mp3, .flac, .wav, .m4a, .aac, .ogg)',
    sampleQueries: ['.mp3', '.wav', '.flac', '.m4a']
  },
  {
    groupId: 3,
    name: '图片文件',
    shortName: '图片文件',
    color: '#10b981',
    legacyCategory: 'other',
    description: '相机照片、设计原图、截图与图标纹理 (.png, .jpg, .webp, .svg, .psd, .gif, .bmp)',
    sampleQueries: ['.png', '.jpg', '.webp', '.svg']
  },
  {
    groupId: 4,
    name: '文档文件',
    shortName: '文档文件',
    color: '#3b82f6',
    legacyCategory: 'document',
    description: '办公文档、PDF 电子书、表格报表与演示文稿 (.pdf, .docx, .xlsx, .pptx, .md, .txt)',
    sampleQueries: ['.pdf', '.docx', '.xlsx', '.pptx']
  },
  {
    groupId: 5,
    name: '压缩包与镜像',
    shortName: '压缩包',
    color: '#f59e0b',
    legacyCategory: 'archive',
    description: '归档压缩包、系统光盘镜像与固件包 (.zip, .7z, .rar, .tar, .gz, .iso, .wim)',
    sampleQueries: ['.zip', '.7z', '.rar', '.gz']
  },
  {
    groupId: 6,
    name: '安装包与程序',
    shortName: '安装包',
    color: '#f97316',
    legacyCategory: 'installer',
    description: 'Windows 可执行安装程序、MSI 部署包与独立启动器 (.exe, .msi, .msix, .appx)',
    sampleQueries: ['.exe', '.msi']
  },
  {
    groupId: 7,
    name: '代码与工程文件',
    shortName: '代码文件',
    color: '#06b6d4',
    legacyCategory: 'other',
    description: '源码文件、前端构建产物、脚本与工程配置 (.ts, .js, .vue, .py, .cpp, .rs, .json)',
    sampleQueries: ['.js', '.ts', '.json', '.wasm']
  },
  {
    groupId: 8,
    name: '系统与运行库',
    shortName: '系统文件',
    color: '#ef4444',
    legacyCategory: 'temp',
    description: '动态链接库、驱动程序、崩溃转储与运行日志 (.dll, .sys, .pdb, .dmp, .log, .tmp)',
    sampleQueries: ['.dll', '.log', '.dmp', '.pdb']
  },
  {
    groupId: 9,
    name: '数据库与资源包',
    shortName: '数据库/资源',
    color: '#6366f1',
    legacyCategory: 'document',
    description: 'SQLite 数据库、Electron 资源封包与索引数据 (.db, .sqlite, .asar, .pak, .bin, .dat)',
    sampleQueries: ['.db', '.asar', '.pak', '.bin']
  },
  {
    groupId: 99,
    name: '其他文件',
    shortName: '其他文件',
    color: '#64748b',
    legacyCategory: 'other',
    description: '未归入以上 9 类的字体、模型权重、专有缓存与无后缀数据文件',
    sampleQueries: ['.ttf', '.woff2']
  }
]

export interface DiskFileEntry {
  id: string
  name: string
  path: string
  parentDir: string
  drive: string
  extension: string
  category: 'video' | 'archive' | 'installer' | 'document' | 'temp' | 'other'
  groupId: OfficialFileTypeGroupId
  groupName: string
  groupColor: string
  sizeBytes: number
  mtime: number
  isProtected: boolean
}

export interface DiskExtStat {
  extension: string
  groupId: OfficialFileTypeGroupId
  categoryLabel: string
  fileCount: number
  totalSizeBytes: number
  sharePercent: number
}

export interface DiskGroupStat {
  groupId: OfficialFileTypeGroupId
  name: string
  shortName: string
  color: string
  description: string
  fileCount: number
  totalSizeBytes: number
  sharePercent: number
  topExtensions: DiskExtStat[]
}

export interface DiskScanFailure {
  /** 未能扫描的目录 */
  path: string
  /** 宿主给出的原因（已去掉重复的目录前缀），权限类失败附带该怎么办 */
  reason: string
}

/** 把单个目录的扫描异常整理成界面可读的原因：保留宿主原话，权限类失败补一句处理办法 */
export function describeScanFailure(directory: string, error: unknown): string {
  let raw = (error instanceof Error ? error.message : String(error ?? '')).trim()
  if (raw.startsWith(`${directory}: `)) raw = raw.slice(directory.length + 2).trim()
  if (!raw) raw = '目录扫描失败'
  const permission = /PERMISSION_DENIED|EACCES|EPERM|not permitted|权限|拒绝访问|未授权/i.test(raw)
  if (!permission) return raw
  const hint = directory.startsWith('/')
    ? '可在「系统设置 › 隐私与安全性 › 文件与文件夹」中允许 ZTools 访问后重新扫描'
    : '请确认当前账户有权读取该目录后重新扫描'
  return `${raw}（${hint}）`
}

export interface DiskAnalysisSnapshot {
  drives: DiskDriveItem[]
  files: DiskFileEntry[]
  extStats: DiskExtStat[]
  groupStats: DiskGroupStat[]
  topDirectories?: Array<{
    name: string
    path: string
    drive: string
    sizeBytes: number
    fileCount: number
    /** 体积只是下限（宿主扫描截断且独立统计未完成） */
    approximate?: boolean
  }>
  /** 有目录扫描达到宿主条目上限：大文件列表只是抽样，不是全盘完整结果 */
  sampled?: boolean
  /** 各目录扫描实际遍历的条目数之和 */
  scannedEntries?: number
  /** 未能扫描的目录与原因（这些目录的内容不在结果里）；为空表示全部扫描成功 */
  failedScans: DiskScanFailure[]
  totalCapacityBytes: number
  totalUsedBytes: number
  totalAvailableBytes: number
}

export const DLL_PLUGIN_NAME = 'AnalyzerPlugin'
/** Windows：系统目录、卷影副本区与程序安装目录 */
const WINDOWS_PROTECTED_PATTERN =
  /^(?:C:\\Windows(?:\\.*)?|C:\\System Volume Information(?:\\.*)?|C:\\Program Files(?:\\.*)?|C:\\Program Files \(x86\)(?:\\.*)?)$/i
/**
 * macOS：系统卷与系统配置（/System、/bin、/sbin、/etc、/Library、/usr 但不含用户自装的 /usr/local、
 * /var 但不含用户临时目录 /var/folders）、用户 ~/Library（仅 ~/Library/Caches 可清理）
 * 以及应用、照片 / iMovie / Final Cut 图库、虚拟机等“包”内部的文件（访达里显示为单个文件，删掉包内文件会直接损坏应用或图库）。
 * APFS 默认不区分大小写，按不区分大小写匹配
 */
const MACOS_PROTECTED_PATTERN =
  /^(?:\/(?:private\/)?(?:System|bin|sbin|etc|Library)(?:\/.*)?|\/usr(?:\/(?!local(?:\/|$)).*)?|\/(?:private\/)?var(?:\/(?!folders(?:\/|$)).*)?|\/Users\/[^/]+\/Library(?:\/(?!Caches(?:\/|$)).*)?|\/.*\.(?:app|framework|bundle|plugin|kext|appex|xpc|photoslibrary|photolibrary|musiclibrary|tvlibrary|imovielibrary|fcpbundle|logicx|band|xcarchive|sparsebundle|vmwarevm|pvm|utm)\/.+)$/i
/** 含 .. 段的路径无法按前缀判断真实位置（如 /usr/local/../bin），一律按受保护处理 */
const PARENT_SEGMENT_PATTERN = /^(?:.*[\\/])?\.\.(?:[\\/].*)?$/
export const FORBIDDEN_TARGET_PATTERN = new RegExp(
  `${WINDOWS_PROTECTED_PATTERN.source}|${MACOS_PROTECTED_PATTERN.source}|${PARENT_SEGMENT_PATTERN.source}`,
  'i'
)
export const FORBIDDEN_REASON = '系统核心目录、应用程序包内部文件与卷影副本区受保护，禁止通过分析器直接清理'

const PRESET_ITEMS: CapabilityActionItem[] = [
  {
    id: 'disk-c-overview',
    title: '系统盘 (C:) 空间占用深度透视',
    subtitle: '定位 AppData、休眠文件、虚拟内存与大体积残留目录',
    tag: '系统盘分析',
    method: 'StartScanAsync',
    params: { drive: 'C:\\' }
  },
  {
    id: 'disk-large-files',
    title: '全盘超大文件排行榜 (> 500MB)',
    subtitle: '快速揪出遗忘的系统镜像 ISO、未清理安装包与冗余视频',
    tag: '大文件排行',
    method: 'GetGroupFiles',
    params: { minSizeMb: 500 }
  },
  {
    id: 'disk-ext-stats',
    title: '按文件扩展名类型统计空间分布',
    subtitle: '统计视频、开发依赖 (node_modules)、文档与归档占比',
    tag: '类型分布',
    method: 'GetExtensionStats',
    params: { topN: 20 }
  },
  {
    id: 'disk-drives-list',
    title: '查看本机全部物理卷与挂载分区健康度',
    subtitle: '汇总各分区总容量、剩余可用空间与文件系统格式',
    tag: '分区概览',
    method: 'GetAvailableDrives',
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

export function formatDateTime(mtimeSeconds: number): string {
  if (!mtimeSeconds || !Number.isFinite(mtimeSeconds) || mtimeSeconds <= 0) return '未知时间'
  const ms = mtimeSeconds > 1e12 ? mtimeSeconds : mtimeSeconds * 1000
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return '未知时间'
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
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

export function getGroupMetaById(groupId: OfficialFileTypeGroupId): OfficialFileTypeGroupMeta {
  return OFFICIAL_FILE_TYPE_GROUPS.find(g => g.groupId === groupId) || OFFICIAL_FILE_TYPE_GROUPS[OFFICIAL_FILE_TYPE_GROUPS.length - 1]
}

/**
 * 按扩展名判定文件属于 10 类文件类型中的哪一类
 */
export function classifyFileExtension(filePath: string): {
  extension: string
  category: DiskFileEntry['category']
  categoryLabel: string
  groupId: OfficialFileTypeGroupId
  groupName: string
  groupColor: string
} {
  const name = filePath.split(/[\\/]/).pop() || filePath
  const dotIdx = name.lastIndexOf('.')
  const rawExt = dotIdx > 0 ? name.slice(dotIdx).toLowerCase() : ''
  // 版本号结尾（如 2.1.301、libfoo.so.1）不是扩展名：否则同一程序的多个版本会各自成为一个「扩展名」，
  // 与无后缀、以哈希命名的同类文件分到不同统计里。扩展名至少含一个字母、不超过 16 个字符。
  const ext = /^\.[a-z0-9_+-]{1,15}$/.test(rawExt) && /[a-z]/.test(rawExt) ? rawExt : '(无扩展名)'

  let groupId: OfficialFileTypeGroupId = 99
  if (/\.(?:mp4|mkv|mov|avi|flv|webm|wmv|mts|m2ts|m4v|rmvb|mpg|mpeg|3gp)$/i.test(ext)) {
    groupId = 1
  } else if (/\.(?:mp3|flac|wav|aac|ogg|wma|m4a|opus|ape|mid)$/i.test(ext)) {
    groupId = 2
  } else if (/\.(?:jpg|jpeg|png|gif|bmp|webp|svg|psd|ico|tif|tiff|heic|avif|dng|cr2|cr3|nef|arw|raf|orf|rw2)$/i.test(ext)) {
    groupId = 3
  } else if (/\.(?:pdf|doc|docx|xls|xlsx|ppt|pptx|md|txt|csv|rtf|epub|mobi|odt|wps)$/i.test(ext)) {
    groupId = 4
  } else if (/\.(?:zip|7z|rar|tar|gz|bz2|xz|iso|wim|cab|dmg|tgz|zst|img|sparseimage|sparsebundle|ipsw)$/i.test(ext)) {
    groupId = 5
  } else if (/\.(?:exe|msi|msix|appx|apk|ipa|bat|cmd|com|scr|pkg|mpkg)$/i.test(ext)) {
    groupId = 6
  } else if (/\.(?:ts|tsx|js|jsx|mjs|cjs|vue|py|cpp|c|h|hpp|rs|go|java|cs|json|yaml|yml|toml|xml|html|css|scss|less|sql|sh|ps1|wasm|map)$/i.test(ext)) {
    groupId = 7
  } else if (/\.(?:dll|sys|drv|ocx|pdb|dmp|log|tmp|bak|old|cat|inf|mui|winmd|etl|evtx|pf|dylib|crash|ips|kext)$/i.test(ext)) {
    groupId = 8
  } else if (/* .raw 在 macOS 上通常是 Docker Desktop 的虚拟磁盘 Docker.raw，不按相机原图归类 */ /\.(?:db|sqlite|sqlite3|wal|shm|mdf|ldf|accdb|mdb|frm|ibd|idx|dat|bin|pak|asar|vmdk|vhdx|vhd|raw|qcow2)$/i.test(ext)) {
    groupId = 9
  }

  const meta = getGroupMetaById(groupId)
  return {
    extension: ext,
    category: meta.legacyCategory,
    categoryLabel: meta.shortName,
    groupId: meta.groupId,
    groupName: meta.name,
    groupColor: meta.color
  }
}

export function computeExtStats(files: DiskFileEntry[]): DiskExtStat[] {
  const map = new Map<
    string,
    { groupId: OfficialFileTypeGroupId; categoryLabel: string; fileCount: number; totalSizeBytes: number }
  >()
  let grandTotal = 0

  for (const f of files) {
    grandTotal += f.sizeBytes
    const info = classifyFileExtension(f.name)
    const cur = map.get(info.extension) || {
      groupId: info.groupId,
      categoryLabel: info.categoryLabel,
      fileCount: 0,
      totalSizeBytes: 0
    }
    cur.fileCount += 1
    cur.totalSizeBytes += f.sizeBytes
    map.set(info.extension, cur)
  }

  const list: DiskExtStat[] = []
  for (const [extension, val] of map.entries()) {
    list.push({
      extension,
      groupId: val.groupId,
      categoryLabel: val.categoryLabel,
      fileCount: val.fileCount,
      totalSizeBytes: val.totalSizeBytes,
      sharePercent: grandTotal > 0 ? Math.max(1, Math.round((val.totalSizeBytes / grandTotal) * 100)) : 0
    })
  }

  return list.sort((a, b) => b.totalSizeBytes - a.totalSizeBytes)
}

/**
 * 汇总 10 大官方分类统计及其内部二级扩展名占比
 */
export function computeGroupStats(files: DiskFileEntry[]): DiskGroupStat[] {
  const grandTotal = files.reduce((acc, f) => acc + f.sizeBytes, 0)
  const byGroup = new Map<OfficialFileTypeGroupId, DiskFileEntry[]>()
  for (const g of OFFICIAL_FILE_TYPE_GROUPS) {
    byGroup.set(g.groupId, [])
  }
  for (const f of files) {
    const gid = f.groupId || classifyFileExtension(f.name).groupId
    const arr = byGroup.get(gid) || []
    arr.push(f)
    byGroup.set(gid, arr)
  }

  const result: DiskGroupStat[] = []
  for (const meta of OFFICIAL_FILE_TYPE_GROUPS) {
    const groupFiles = byGroup.get(meta.groupId) || []
    const totalSizeBytes = groupFiles.reduce((acc, f) => acc + f.sizeBytes, 0)
    const sharePercent =
      grandTotal > 0 && totalSizeBytes > 0
        ? Math.max(1, Math.round((totalSizeBytes / grandTotal) * 100))
        : 0
    const topExtensions = computeExtStats(groupFiles).slice(0, 12)
    result.push({
      groupId: meta.groupId,
      name: meta.name,
      shortName: meta.shortName,
      color: meta.color,
      description: meta.description,
      fileCount: groupFiles.length,
      totalSizeBytes,
      sharePercent,
      topExtensions
    })
  }

  return result.sort((a, b) => b.totalSizeBytes - a.totalSizeBytes)
}

/** macOS / Linux 的路径以 / 开头，保持原样；Windows 路径统一成反斜杠。宿主的定位、删除接口都要用本机原生路径 */
function toNativePath(filePath: string): string {
  const raw = String(filePath || '')
  return raw.startsWith('/') ? raw : raw.replace(/\//g, '\\')
}

function splitNativePath(nativePath: string): { name: string; parentDir: string } {
  const lastSep = Math.max(nativePath.lastIndexOf('/'), nativePath.lastIndexOf('\\'))
  return {
    name: lastSep >= 0 ? nativePath.slice(lastSep + 1) : nativePath,
    parentDir: lastSep > 0 ? nativePath.slice(0, lastSep) : nativePath
  }
}

function extractDrivePrefix(filePath: string): string {
  if (String(filePath || '').startsWith('/')) return '/'
  const m = String(filePath || '').match(/^([A-Za-z]:)/)
  return m ? m[1].toUpperCase() : 'C:'
}

/**
 * 读取挂载卷；个别卷读不到容量（BitLocker 锁定卷、断开的网络卷、损坏的磁盘映像等）时，
 * 其余卷照常返回，读不到的卷连同原因放在 errors 里由界面如实列出，不让整次分析失败。
 * 公共的 probeRealDiskDrives 遇到不完整列表直接报错，这里先去掉不完整标记再交给它校验每一卷的数据。
 */
export async function probeDiskVolumesTolerant(hostOverride?: HostOverride): Promise<{ drives: RealDiskDriveInfo[]; errors: string[] }> {
  const res = await callHostTransport<Record<string, unknown>>('system_list_volumes', {}, hostOverride)
  if (!res.ok && isHostMethodMissing(res.error)) throw hostUpgradeError('读取磁盘卷列表')
  if (!res.ok || !res.data || !Array.isArray(res.data.volumes)) throw new Error(res.error || '无法读取挂载卷列表')
  const errors = res.data.partial
    ? (Array.isArray(res.data.errors) && res.data.errors.length ? res.data.errors.map(String) : ['部分卷容量读取失败'])
    : []
  if (!res.data.volumes.length && errors.length) throw new Error(`没有读取到已挂载卷：${errors.join('；')}`)
  // 同一份宿主快照交给公共解析（校验每一卷的数据），不重复请求宿主
  const snapshot = { ...res.data, partial: false, errors: [] }
  const drives = await probeRealDiskDrives([], { system_list_volumes: () => snapshot } as unknown as HostOverride)
  return { drives, errors }
}

/**
 * 系统临时目录（Windows 为 %TEMP%，macOS 为 /var/folders/.../T）。
 * 不能用 system_get_path('temp')：宿主把它定义为本插件自己的隔离临时目录（…/ZTools/Cache/…/Temp），
 * 扫描它找不到系统里的临时大文件。新版宿主的 system_list_common_folders 返回真正的系统临时目录；
 * 旧宿主没有该方法时不扫描临时目录，而不是扫描插件自己的目录冒充。
 */
export async function getSystemTempDir(hostOverride?: HostOverride): Promise<string> {
  const res = await callHostTransport<{ folders?: unknown }>('system_list_common_folders', {}, hostOverride)
  if (!res.ok || !Array.isArray(res.data?.folders)) return ''
  const temp = (res.data.folders as unknown[]).find((item): item is { id: string; path: string; exists: boolean } =>
    Boolean(item) && typeof item === 'object' && (item as { id?: unknown }).id === 'temp')
  return temp && temp.exists === true && typeof temp.path === 'string' ? temp.path.trim() : ''
}

/**
 * 采集本机真实磁盘分区、10 大分类分布与热点大文件全景快照
 */
export async function fetchDiskAnalysisSnapshot(hostOverride?: HostOverride): Promise<DiskAnalysisSnapshot> {
  // 1. 探测真实磁盘分区 (C:/ ~ G:/)
  const { drives: rawDrives, errors: volumeErrors } = await probeDiskVolumesTolerant(hostOverride)
  const drives: DiskDriveItem[] = rawDrives.map(d => ({
    drive: d.drive,
    label: d.label || d.drive,
    fileSystem: d.fileSystem || '未知',
    totalBytes: d.totalBytes,
    usedBytes: d.usedBytes,
    availableBytes: d.availableBytes,
    usagePercent: d.usagePercent,
    status: d.usagePercent >= 90 ? 'danger' : d.usagePercent >= 75 ? 'warning' : 'normal'
  }))

  // 2. 获取标准用户目录
  const [downloadsDir, documentsDir, desktopDir, videosDir, tempDir] = await Promise.all([
    getRealSystemPath('downloads', hostOverride),
    getRealSystemPath('documents', hostOverride),
    getRealSystemPath('desktop', hostOverride),
    getRealSystemPath('videos', hostOverride),
    getSystemTempDir(hostOverride)
  ])

  // macOS 额外扫描用户缓存目录（~/Library/Caches），优先覆盖用户可清理的位置
  const homeDir = downloadsDir.startsWith('/') ? await getRealSystemPath('home', hostOverride) : ''
  const macCachesDir = homeDir.startsWith('/') ? `${homeDir.replace(/\/+$/, '')}/Library/Caches` : ''
  const scanDirs = [downloadsDir, documentsDir, desktopDir, videosDir, tempDir, macCachesDir].filter(Boolean)
  const volumeRoots = rawDrives.map(({ drive }) => {
    const posix = drive.startsWith('/')
    const root = posix ? drive.replace(/\/+$/, '') || '/' : drive.replace(/[\\/]+$/, '').replace(/\//g, '\\')
    return { drive, root, posix }
  }).sort((a, b) => b.root.length - a.root.length)
  const driveForPath = (filePath: string) => volumeRoots.find(({ root, posix }) => {
    const candidate = posix ? filePath : filePath.replace(/\//g, '\\').toLowerCase()
    const base = posix ? root : root.toLowerCase()
    return candidate === base || candidate.startsWith(base === '/' ? base : `${base}${posix ? '/' : '\\'}`)
  })?.drive || extractDrivePrefix(filePath)
  const files: DiskFileEntry[] = []
  const seenPaths = new Set<string>()

  const addFileEntry = (fullPath: string, sizeBytes: number, mtime = 0) => {
    if (!fullPath || sizeBytes <= 0) return
    const cleanPath = toNativePath(fullPath)
    const normKey = cleanPath.toLowerCase()
    if (seenPaths.has(normKey)) return
    seenPaths.add(normKey)

    const { name, parentDir } = splitNativePath(cleanPath)
    const cls = classifyFileExtension(name)
    files.push({
      id: `file-${files.length}-${name}`,
      name,
      path: cleanPath,
      parentDir,
      drive: driveForPath(cleanPath),
      extension: cls.extension,
      category: cls.category,
      groupId: cls.groupId,
      groupName: cls.groupName,
      groupColor: cls.groupColor,
      sizeBytes,
      // 宿主没给修改时间时保持 0（界面显示“未知时间”），不能用当前时间冒充
      mtime: Number.isFinite(mtime) && mtime > 0 ? mtime : 0,
      isProtected: FORBIDDEN_TARGET_PATTERN.test(cleanPath)
    })
  }

  const supportsDeepScan =
    (!hostOverride && isRealElectronHost()) ||
    typeof hostOverride?.system_search_files === 'function'

  const topDirectories: Array<{
    name: string
    path: string
    drive: string
    sizeBytes: number
    fileCount: number
    approximate?: boolean
  }> = []
  const seenDirs = new Set<string>()
  let sampled = false
  let scannedEntries = 0
  // 读不到容量的卷不在分区列表里，也不扫描；连同宿主给的原因列在“未能扫描的目录”中
  const failedScans: DiskScanFailure[] = volumeErrors.map(error => {
    const match = error.match(/^(.+?): (.+)$/)
    return match ? { path: match[1]!, reason: `卷容量读取失败：${match[2]}` } : { path: '挂载卷', reason: error }
  })
  const volumeFailureCount = failedScans.length

  if (supportsDeepScan) {
    // 宿主支持 dir: 目录扫描时，并发扫描本机挂载分区与系统用户目录（路径来自宿主，不硬编码）
    const driveRoots = !hostOverride
      ? volumeRoots.map(({ root, posix }) => posix ? root : `${root}\\`)
      : []
    const realTargetDirs = Array.from(new Set([...scanDirs, ...driveRoots])).filter(Boolean)

    // 逐目录降级：某个目录读不到（用户拒绝访问「文稿 / 桌面 / 下载」、外接卷不可读、扫描不完整）不拖垮其它目录，
    // 失败的目录连同原因如实返回给界面；全部失败才算扫描失败
    const settled = await Promise.allSettled(
      realTargetDirs.map(d => scanRealDirectoryTree(d, 100, hostOverride))
    )
    for (const [scanIndex, outcome] of settled.entries()) {
      if (outcome.status === 'rejected') failedScans.push({ path: realTargetDirs[scanIndex]!, reason: describeScanFailure(realTargetDirs[scanIndex]!, outcome.reason) })
    }
    if (realTargetDirs.length > 0 && failedScans.length - volumeFailureCount === realTargetDirs.length) {
      throw new Error(`所有目录都未能扫描：${failedScans.map(f => `${f.path}：${f.reason}`).join('；')}`)
    }
    for (const [scanIndex, outcome] of settled.entries()) {
      if (outcome.status !== 'fulfilled') continue
      const res = outcome.value
      if (res.truncated) sampled = true
      scannedEntries += Number(res.visitedEntries) || 0
      // 分区根目录扫描被截断时，文件只是最先遍历到的系统文件（如 /usr/bin），不代表大文件，只取其子目录体积
      const isTruncatedDriveRoot = Boolean(res.truncated) && driveRoots.includes(realTargetDirs[scanIndex]!)
      if (Array.isArray(res.subdirs)) {
        for (const sub of res.subdirs) {
          if (!sub.path || sub.totalBytes <= 0) continue
          const cleanSub = toNativePath(sub.path)
          const normSub = cleanSub.toLowerCase()
          if (seenDirs.has(normSub)) continue
          seenDirs.add(normSub)
          topDirectories.push({
            name: sub.name || splitNativePath(cleanSub).name || cleanSub,
            path: cleanSub,
            drive: driveForPath(cleanSub),
            sizeBytes: sub.totalBytes,
            fileCount: sub.fileCount || 0,
            ...(sub.approximate ? { approximate: true } : {})
          })
        }
      }
      if (isTruncatedDriveRoot) continue
      for (const f of res.files) {
        if (!f.isDir && f.size > 0) {
          addFileEntry(f.path, f.size, f.mtime)
        }
      }
    }
  } else {
    // 兼容单元测试与自定义 hostOverride 目录扫描链路
    for (const dir of scanDirs) {
      const entries = await listRealDirectoryContents(dir, hostOverride)
      const slice = entries.slice(0, 24)
      const sizes = await Promise.all(slice.map(p => getRealFileSize(p, hostOverride)))

      for (let i = 0; i < slice.length; i++) {
        addFileEntry(slice[i], sizes[i] || 0)
      }
    }
  }

  files.sort((a, b) => b.sizeBytes - a.sizeBytes)
  topDirectories.sort((a, b) => b.sizeBytes - a.sizeBytes)
  const extStats = computeExtStats(files)
  const groupStats = computeGroupStats(files)

  const capacityDrives = uniqueCapacityDrives(rawDrives)
  const totalCapacityBytes = capacityDrives.reduce((s, d) => s + d.totalBytes, 0)
  const totalUsedBytes = capacityDrives.reduce((s, d) => s + d.usedBytes, 0)
  const totalAvailableBytes = capacityDrives.reduce((s, d) => s + d.availableBytes, 0)

  return {
    drives,
    files,
    extStats,
    groupStats,
    topDirectories,
    ...(sampled ? { sampled: true, scannedEntries } : {}),
    failedScans,
    totalCapacityBytes,
    totalUsedBytes,
    totalAvailableBytes
  }
}

/**
 * 安全删除磁盘大文件（移入系统回收站，拦截系统保护目录）
 */
export async function deleteDiskFileItem(
  filePath: string,
  hostOverride?: HostOverride
): Promise<{ ok: boolean; error?: string }> {
  if (!filePath || typeof filePath !== 'string') {
    return { ok: false, error: '文件路径不能为空' }
  }
  if (FORBIDDEN_TARGET_PATTERN.test(filePath.trim())) {
    return { ok: false, error: FORBIDDEN_REASON }
  }
  const res = await trashRealItem(filePath.trim(), hostOverride)
  return res.ok ? res : { ok: false, error: describeHostPathError(res.error) }
}

/**
 * 回收失败的说明：宿主只放行本窗口扫描结果里的路径（30 分钟过期），回收站只给本插件扫描到的普通文件
 * （文件夹、符号链接与系统目录除外）。保留宿主原话（只有错误码时不显示码），再补一句该怎么办。
 */
export function describeHostPathError(error: string | undefined): string {
  const raw = String(error || '').trim()
  const permission = /PERMISSION_DENIED|未由当前窗口授权|权限不足|未授权/i.test(raw)
  const missing = !permission && /FILE_ERROR|FILE_NOT_FOUND|ENOENT|不存在|文件操作失败/i.test(raw)
  if (!permission && !missing) return raw || '移除失败'
  const hint = missing
    ? '文件可能已被移动或删除，请重新扫描'
    : '只能回收本次扫描到的普通文件（文件夹、链接与系统目录除外），授权可能已过期，请重新扫描后再试'
  return /^[A-Z_]+$/.test(raw) || !raw ? hint : `${raw}（${hint}）`
}

/**
 * 批量将选中的磁盘文件安全移入系统回收站
 */
export async function batchDeleteDiskFileItems(
  filePaths: string[],
  hostOverride?: HostOverride
): Promise<{
  succeeded: string[]
  failed: Array<{ path: string; error: string }>
}> {
  const succeeded: string[] = []
  const failed: Array<{ path: string; error: string }> = []
  for (const rawPath of filePaths) {
    const res = await deleteDiskFileItem(rawPath, hostOverride)
    if (res.ok) {
      succeeded.push(rawPath)
    } else {
      failed.push({ path: rawPath, error: res.error || '移除失败' })
    }
  }
  return { succeeded, failed }
}

/** 分区根目录：Windows 裸盘符补反斜杠（C: → C:\\）；目录挂载点（C:\\mount\\）与 macOS 挂载点（/、/Volumes/X）本身就是路径 */
export function driveRoot(drive: string): string {
  return /^[A-Za-z]:$/.test(drive) ? `${drive}\\` : drive
}

/** 当前是否运行在 macOS（按宿主页面的 navigator 判断；拿不到时按 Windows 处理） */
export function isMacPlatform(): boolean {
  const nav = (globalThis as { navigator?: { platform?: string; userAgent?: string } }).navigator
  return /Mac/i.test(String(nav?.platform || nav?.userAgent || ''))
}

/** macOS 上与 Windows 用词或扩展名不同的分类说明 */
const MAC_GROUP_DESCRIPTIONS: Partial<Record<OfficialFileTypeGroupId, string>> = {
  6: '安装包与安装程序 (.pkg, .mpkg, .ipa, .apk；.dmg 磁盘镜像归入「压缩包与镜像」)',
  8: '动态库、内核扩展、崩溃报告、运行日志与临时文件 (.dylib, .kext, .ips, .crash, .log, .tmp)'
}

/** 按平台给出分类说明：macOS 不出现 .dll / .exe 这类 Windows 示例 */
export function groupDescriptionFor(groupId: OfficialFileTypeGroupId, mac: boolean = isMacPlatform()): string {
  const meta = getGroupMetaById(groupId)
  return (mac && MAC_GROUP_DESCRIPTIONS[groupId]) || meta.description
}

/** 搜索框占位提示里的后缀示例按平台给 */
export function searchPlaceholderFor(mac: boolean = isMacPlatform()): string {
  return mac ? '搜索大文件、后缀 (.mp4/.dmg/.zip) 或路径...' : '搜索大文件、后缀 (.mp4/.iso/.zip/.dll) 或路径...'
}

/** 回收站名称：Windows 为「回收站」，macOS 为「废纸篓」 */
export function trashName(samplePath: string): string {
  return String(samplePath || '').startsWith('/') ? '废纸篓' : '回收站'
}

/** 系统文件管理器名称：Windows 路径为「资源管理器」，macOS 为「访达」 */
export function fileManagerName(samplePath: string): string {
  return /^[A-Za-z]:/.test(String(samplePath || '')) || String(samplePath || '').startsWith('\\\\') ? '资源管理器' : '访达'
}

/** 最后一个不授权分区根目录的客户端版本（之后的版本在 system_list_volumes 返回卷时只读登记卷根） */
export const DRIVE_ROOT_LAST_UNSUPPORTED_APP_VERSION = '1.1.8.6'

/**
 * 在文件管理器中打开分区根目录。
 * 分区根目录不在任何扫描结果里：新版客户端在列出挂载卷时只读授权卷根（只能打开，不能读写卷内内容）；
 * 旧版客户端没有这项授权，会以「路径未由当前窗口授权」拒绝——这时提示升级，而不是说分区「可能已被移动或删除」。
 */
export async function openDriveRoot(drive: string, hostOverride?: HostOverride): Promise<{ ok: boolean; error?: string }> {
  const target = driveRoot(String(drive || ''))
  if (!target) return { ok: false, error: '分区路径为空' }
  const res = await callHostTransport('shell_open_path', { fullPath: target }, hostOverride)
  if (res.ok) return { ok: true }
  const raw = String(res.error || '').trim()
  if (/PERMISSION_DENIED|未由当前窗口授权|未授权/i.test(raw)) {
    return { ok: false, error: `ZTools ${DRIVE_ROOT_LAST_UNSUPPORTED_APP_VERSION} 及更早版本不允许插件打开分区根目录，请升级 ZTools；已是更新的版本时请点「重新扫描」后再试（授权 30 分钟后过期）` }
  }
  if (/FILE_ERROR|FILE_NOT_FOUND|ENOENT|不存在|文件操作失败/i.test(raw)) {
    return { ok: false, error: '分区可能已被推出或卸载，请重新扫描' }
  }
  if (/METHOD_NOT_FOUND|METHOD_NOT_AVAILABLE|未知方法|未实现/.test(raw)) {
    return { ok: false, error: '当前 ZTools 版本过低，请升级到最新版本后再试' }
  }
  return { ok: false, error: raw || '打开分区失败' }
}

/**
 * 在系统文件管理器中定位文件或目录
 */
export async function openDiskItemLocation(
  targetPath: string,
  hostOverride?: HostOverride
): Promise<boolean> {
  if (!targetPath) return false
  return showRealItemInFolder(targetPath, hostOverride)
}

/**
 * 使用系统默认应用直接打开文件
 */
export async function openDiskFileDefault(
  targetPath: string,
  hostOverride?: HostOverride
): Promise<boolean> {
  if (!targetPath) return false
  return openRealPath(targetPath, hostOverride)
}
