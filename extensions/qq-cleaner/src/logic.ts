/**
 * QQ / NTQQ / TIM 缓存清理：扫描与分类逻辑
 * 12 个清理分组 (201~213) + 聊天数据库保护区 (999)：
 * - 扫描 Documents\Tencent Files、C 到 G 盘根目录下的 Tencent Files、AppData\Roaming\Tencent (Users / QQ / TIM / Logs / QQTempSys)、
 *   AppData\Roaming\QQ (NTQQ) 与 AppData\Local\Tencent
 * - 从目录名识别本机登录过的 QQ 号
 * - 聊天记录与账号数据库 (Msg3.0.db / Msg3.0index.db / nt_msg.db / Registry.db / Info.db) 受保护，不会被清理
 * - 只把用户勾选的文件移入回收站，失败如实返回
 */

import { t } from './i18n.js'
import {
  formatBytes,
  getRealFileSize,
  getRealSystemPath,
  invokeDllPluginCapability,
  validateNativeCapabilityPayload,
  isRealElectronHost,
  listRealDirectoryContents,
  createDirectoryScanner,
  showRealItemInFolder,
  trashRealItem,
  openRealPath
} from './native-ipc.js'

export { formatBytes, isRealElectronHost } from './native-ipc.js'

import type { CapabilityActionItem, PluginInvocationResult as NativeInvocationResult } from './native-ipc.js'
import { resolveErrorMessage } from './error-i18n.js'
export type { CapabilityActionItem, PluginInvocationResult as NativeInvocationResult } from './native-ipc.js'


/**
 * 与 Windows 原生插件一致的官方清理分组 ID (201~213) + 999 聊天核心数据库保护区
 */
export type QQGroupId = 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 209 | 211 | 212 | 213 | 999

export interface QQScannedFileEntry {
  id: string
  name: string
  path: string
  parentDir: string
  groupId: QQGroupId
  groupName: string
  accountId: string
  clientType: 'ClassicQQ' | 'QQNT' | 'TIM' | 'Shared'
  sizeBytes: number
  mtime: number
  isProtected: boolean
  /** 没有命中任何已知规则、只是归入默认分组显示的文件：不默认勾选 */
  unrecognized?: boolean
}

export interface QQCleanCategoryItem {
  id: string
  groupId: QQGroupId
  name: string
  shortName: string
  color: string
  category: 'cache' | 'media' | 'files' | 'logs' | 'protected'
  riskLevel: 'safe' | 'recommended' | 'caution' | 'protected'
  safetyLevel?: 'safe' | 'recommended' | 'caution' | 'protected'
  targetDir: string
  existsOnDisk: boolean
  fileCount: number
  totalSizeBytes: number
  checked: boolean
  sampleFiles: Array<{ path: string; sizeBytes: number; mtime?: number; accountId?: string }>
  files: QQScannedFileEntry[]
  description: string
}

export interface QQAccountStat {
  accountId: string
  label: string
  clientType: string
  rootDir: string
  fileCount: number
  totalBytes: number
}

export interface QQScanSnapshot {
  baseDirectories: string[]
  detectedAccounts: string[]
  accountStats: QQAccountStat[]
  categories: QQCleanCategoryItem[]
  allFiles: QQScannedFileEntry[]
  totalScannableBytes: number
  protectedDbBytes: number
  error?: string
}

export interface QQCleanupResult {
  /** 所有勾选的可清理文件都已移入回收站 */
  ok: boolean
  deletedCount: number
  freedBytes: number
  failedCount: number
  failed: Array<{ path: string; error: string }>
  skippedProtected: number
  deletedPaths: string[]
  skippedPaths: string[]
  error?: string
}

/** 右侧明细一次最多显示的文件数；默认勾选与“全选”都只作用于显示出来的文件 */
export const QQ_FILE_DISPLAY_LIMIT = 60

/** 在这些盘符根目录下查找自定义的 Tencent Files 目录；盘符不存在时扫描结果为空 */
const DRIVE_LETTERS = ['C', 'D', 'E', 'F', 'G']

export const DLL_PLUGIN_NAME = 'QQCleanerPlugin'
export const FORBIDDEN_TARGET_PATTERN = new RegExp(
  '(?:^|[\\\\/])(?:Msg3\\.0\\.db|Msg3\\.0index\\.db|nt_msg\\.db|Registry\\.db|Registry2\\.0\\.db|Info\\.db|FoldMsg\\.db)(?:-journal|-wal|-shm)?$',
  'i'
)
export const getForbiddenReason = (): string => t('forbiddenReason')

export interface OfficialQQGroupRule {
  groupId: QQGroupId
  id: string
  name: string
  shortName: string
  color: string
  category: QQCleanCategoryItem['category']
  riskLevel: QQCleanCategoryItem['riskLevel']
  defaultChecked: boolean
  description: string
}

/**
 * 12 大官方清理分组 (201~213) + 999 核心聊天数据库保护区，分组规则与 Windows 原生组件一致
 */
export function getOfficialQQGroupRules(): OfficialQQGroupRule[] {
  return [
    {
      groupId: 203,
      id: 'qq-group-203-logs',
      name: t('g203Name'),
      shortName: t('g203Short'),
      color: '#64748b',
      category: 'logs',
      riskLevel: 'safe',
      defaultChecked: true,
      description: t('g203Desc')
    },
    {
      groupId: 201,
      id: 'qq-group-201-images',
      name: t('g201Name'),
      shortName: t('g201Short'),
      color: '#64748b',
      category: 'media',
      riskLevel: 'caution',
      defaultChecked: false,
      description: t('g201Desc')
    },
    {
      groupId: 208,
      id: 'qq-group-208-avatars',
      name: t('g208Name'),
      shortName: t('g208Short'),
      color: '#64748b',
      category: 'media',
      riskLevel: 'safe',
      defaultChecked: true,
      description: t('g208Desc')
    },
    {
      groupId: 202,
      id: 'qq-group-202-cache',
      name: t('g202Name'),
      shortName: t('g202Short'),
      color: '#64748b',
      category: 'cache',
      riskLevel: 'safe',
      defaultChecked: true,
      description: t('g202Desc')
    },
    {
      groupId: 209,
      id: 'qq-group-209-app-cache',
      name: t('g209Name'),
      shortName: t('g209Short'),
      color: '#64748b',
      category: 'cache',
      riskLevel: 'safe',
      defaultChecked: true,
      description: t('g209Desc')
    },
    {
      groupId: 211,
      id: 'qq-group-211-browser-miniapp',
      name: t('g211Name'),
      shortName: t('g211Short'),
      color: '#64748b',
      category: 'cache',
      riskLevel: 'recommended',
      defaultChecked: true,
      description: t('g211Desc')
    },
    {
      groupId: 205,
      id: 'qq-group-205-videos',
      name: t('g205Name'),
      shortName: t('g205Short'),
      color: '#64748b',
      category: 'media',
      riskLevel: 'caution',
      defaultChecked: false,
      description: t('g205Desc')
    },
    {
      groupId: 206,
      id: 'qq-group-206-voice',
      name: t('g206Name'),
      shortName: t('g206Short'),
      color: '#64748b',
      category: 'media',
      riskLevel: 'caution',
      defaultChecked: false,
      description: t('g206Desc')
    },
    {
      groupId: 207,
      id: 'qq-group-207-emoji-cache',
      name: t('g207Name'),
      shortName: t('g207Short'),
      color: '#64748b',
      category: 'media',
      riskLevel: 'safe',
      defaultChecked: true,
      description: t('g207Desc')
    },
    {
      groupId: 212,
      id: 'qq-group-212-fav-emoji',
      name: t('g212Name'),
      shortName: t('g212Short'),
      color: '#64748b',
      category: 'files',
      riskLevel: 'caution',
      defaultChecked: false,
      description: t('g212Desc')
    },
    {
      groupId: 204,
      id: 'qq-group-204-file-recv',
      name: t('g204Name'),
      shortName: t('g204Short'),
      color: '#64748b',
      category: 'files',
      riskLevel: 'caution',
      defaultChecked: false,
      description: t('g204Desc')
    },
    {
      groupId: 213,
      id: 'qq-group-213-session',
      name: t('g213Name'),
      shortName: t('g213Short'),
      color: '#64748b',
      category: 'files',
      riskLevel: 'caution',
      defaultChecked: false,
      description: t('g213Desc')
    },
    {
      groupId: 999,
      id: 'qq-group-999-protected-db',
      name: t('g999Name'),
      shortName: t('g999Short'),
      color: '#64748b',
      category: 'protected',
      riskLevel: 'protected',
      defaultChecked: false,
      description: t('g999Desc')
    }
  ]
}

export function getCapabilityItems(): CapabilityActionItem[] {
  return [
    {
      id: 'qq-info-detect',
      title: t('preset1Title'),
      subtitle: t('preset1Sub'),
      tag: t('preset1Tag'),
      method: 'QueryQQInfo',
      params: {}
    },
    {
      id: 'qq-scan-junk',
      title: t('preset2Title'),
      subtitle: t('preset2Sub'),
      tag: t('preset2Tag'),
      method: 'StartScanAsync',
      params: { scanScope: 'safe_cache' }
    },
    {
      id: 'qq-stats-summary',
      title: t('preset3Title'),
      subtitle: t('preset3Sub'),
      tag: t('preset3Tag'),
      method: 'GetTotalStats',
      params: {}
    }
  ]
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
  if (!mtimeSeconds || !Number.isFinite(mtimeSeconds) || mtimeSeconds <= 0) return t('unknownDate')
  const ms = mtimeSeconds > 1e12 ? mtimeSeconds : mtimeSeconds * 1000
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return t('unknownDate')
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function validateInvocationPayload(method: string, params: unknown): { valid: boolean; error?: string } {
  return validateNativeCapabilityPayload(method, params, FORBIDDEN_TARGET_PATTERN, getForbiddenReason())
}

export async function invokeNativeCapability(
  method: string,
  params: Record<string, unknown>,
  hostBridge?: unknown
): Promise<NativeInvocationResult> {
  const check = validateInvocationPayload(method, params)
  if (!check.valid) {
    throw new Error(resolveErrorMessage(check, t('paramValidationFailed')))
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

/**
 * 根据 QQ / NTQQ / TIM 文件的真实路径，精准归入 12 大官方分组 (201~213，与 Windows 原生组件规则一致) 或 999 聊天数据库保护区，
 * 并提取所属 QQ 号 (UIN) 与客户端类型
 */
export function classifyQQFilePath(fullPath: string): {
  groupId: QQGroupId
  accountId: string
  clientType: 'ClassicQQ' | 'QQNT' | 'TIM' | 'Shared'
  isProtected: boolean
  unrecognized?: boolean
} {
  const norm = fullPath.replace(/\//g, '\\')
  const lower = norm.toLowerCase()

  // 1. 提取所属 QQ 号 (UIN: 5~12 位数字)
  const sharedId = t('sharedAccountId')
  let accountId = sharedId
  const tfMatch = norm.match(/Tencent Files\\(\d{5,12})(?:\\|$)/i)
  const usersMatch = norm.match(/\\Tencent\\Users\\(\d{5,12})(?:\\|$)/i)
  if (tfMatch && tfMatch[1]) {
    accountId = tfMatch[1]
  } else if (usersMatch && usersMatch[1]) {
    accountId = usersMatch[1]
  }

  // 2. 识别客户端类型
  let clientType: 'ClassicQQ' | 'QQNT' | 'TIM' | 'Shared' = 'ClassicQQ'
  if (lower.includes('\\nt_qq\\') || lower.includes('\\appdata\\roaming\\qq\\')) {
    clientType = 'QQNT'
  } else if (lower.includes('\\tim\\') || lower.includes('tim.tlg') || lower.includes('timlibsdk')) {
    clientType = 'TIM'
  } else if (accountId === sharedId) {
    clientType = 'Shared'
  }

  // 3. 判定是否属于受保护的核心聊天记录与配置数据库 (Group 999)
  if (
    FORBIDDEN_TARGET_PATTERN.test(norm) ||
    lower.includes('\\nt_db\\') ||
    /\\(?:msg3\.0|msg3\.0index|nt_msg|registry|registry2\.0|info|foldmsg|dingdongstorage|fileshare1\.0|pubacc2\.0|sharedocstroragev1|todostorage)\.db/i.test(
      lower
    )
  ) {
    return { groupId: 999, accountId, clientType, isProtected: true }
  }

  // 4. 判定 12 大官方清理分组 (201~213)
  // Group 203 & 210: 运行跟踪日志 (.tlg / .log / Logs)
  if (
    lower.includes('\\tencent\\logs\\') ||
    lower.includes('\\log\\') ||
    lower.includes('\\logs\\') ||
    lower.endsWith('.tlg') ||
    /\.tlg\.\d+$/i.test(lower) ||
    lower.endsWith('.log')
  ) {
    return { groupId: 203, accountId, clientType, isProtected: false }
  }

  // Group 212: 用户收藏的自定义表情 (CustomFace.db / CustomFace.dbc / CustomFace / MyCollection)
  if (
    /\\customface\.dbc?$/i.test(lower) ||
    lower.includes('\\customface\\') ||
    lower.includes('\\mycollection\\') ||
    lower.includes('\\groupcollection\\')
  ) {
    return { groupId: 212, accountId, clientType, isProtected: false }
  }

  // Group 207: 接收表情缓存 (CustomFaceRecv / ExpressionRecommend / RecommendFace / emoji_cache)
  if (
    lower.includes('\\customfacerecv\\') ||
    lower.includes('\\expressionrecommend') ||
    lower.includes('\\recommendface\\') ||
    lower.includes('\\emoji_cache\\') ||
    lower.includes('\\qqface\\')
  ) {
    return { groupId: 207, accountId, clientType, isProtected: false }
  }

  // Group 208: 头像缓存 (MiscHead.db / QQHead / GroupHead / PushHead / SelCreateGroupHead / nt_data\Head)
  if (
    lower.endsWith('\\mischead.db') ||
    lower.endsWith('\\thumbnails.db') ||
    lower.includes('\\qqhead\\') ||
    lower.includes('\\grouphead\\') ||
    lower.includes('\\pushhead\\') ||
    lower.includes('\\selcreategrouphead\\') ||
    lower.includes('\\nt_data\\head\\') ||
    lower.endsWith('_qh.png')
  ) {
    return { groupId: 208, accountId, clientType, isProtected: false }
  }

  // Group 201: 聊天图片 (Image / nt_data\Pic)
  if (lower.includes('\\image\\') || lower.includes('\\nt_data\\pic\\')) {
    return { groupId: 201, accountId, clientType, isProtected: false }
  }

  // Group 204: 接收的文件 (FileRecv / FileCloud / nt_data\File)
  if (
    lower.includes('\\filerecv\\') ||
    lower.includes('\\filecloud\\') ||
    lower.includes('\\nt_data\\file\\') ||
    lower.endsWith('\\fileinfo.db')
  ) {
    return { groupId: 204, accountId, clientType, isProtected: false }
  }

  // Group 205: 聊天视频 (Video / nt_data\Video)
  if (lower.includes('\\video\\') || lower.includes('\\nt_data\\video\\')) {
    return { groupId: 205, accountId, clientType, isProtected: false }
  }

  // Group 206: 聊天语音 (Audio / Voice / nt_data\Ptt)
  if (
    lower.includes('\\audio\\') ||
    lower.includes('\\voice\\') ||
    lower.includes('\\nt_data\\ptt\\')
  ) {
    return { groupId: 206, accountId, clientType, isProtected: false }
  }

  // Group 213: 登录会话与快速凭证 (Session Storage / Local Storage / loginrdo.cache / urdo.cache / rdo.cache)
  if (
    lower.includes('\\session storage\\') ||
    lower.includes('\\local storage\\') ||
    lower.endsWith('\\loginrdo.cache') ||
    lower.endsWith('\\urdo.cache') ||
    lower.endsWith('\\rdo.cache')
  ) {
    return { groupId: 213, accountId, clientType, isProtected: false }
  }

  // Group 211: 内置浏览器与小程序组件 (MiniBrowser / QQGuild / QQApp / TIMApp / Partitions / miniapp)
  if (
    lower.includes('\\minibrowser\\') ||
    lower.includes('\\qqguild\\') ||
    lower.includes('\\qqapp\\') ||
    lower.includes('\\timapp\\') ||
    lower.includes('\\partitions\\') ||
    lower.includes('\\miniapp\\') ||
    lower.includes('\\qqex\\') ||
    lower.includes('\\qqgame\\') ||
    lower.includes('\\arks\\')
  ) {
    return { groupId: 211, accountId, clientType, isProtected: false }
  }

  // Group 209: QQ/TIM 系统级内核缓存 (Roaming\Tencent\QQ / TIM / Roaming\QQ)
  if (
    lower.includes('\\tencent\\qq\\') ||
    lower.includes('\\tencent\\tim\\') ||
    lower.includes('\\appdata\\roaming\\qq\\') ||
    lower.includes('\\tencent\\users\\') ||
    lower.includes('\\tencent\\txsso\\') ||
    lower.includes('\\tencent\\qqtempsys\\')
  ) {
    return { groupId: 209, accountId, clientType, isProtected: false }
  }

  // Group 202: 账号运行与网页临时缓存 (AppWebCache / Temp / OfflinePackage / Ads / CloudRes / VasscUpdate / nt_temp)
  if (
    lower.includes('\\appwebcache\\') ||
    lower.includes('\\temp\\') ||
    lower.includes('\\offlinepackage\\') ||
    lower.includes('\\ads\\') ||
    lower.includes('\\cloudres\\') ||
    lower.includes('\\vasscupdate\\') ||
    lower.includes('\\nt_temp\\')
  ) {
    return { groupId: 202, accountId, clientType, isProtected: false }
  }

  // 其余无法识别用途的文件也归入 202 显示，但标记为未识别，不默认勾选
  return { groupId: 202, accountId, clientType, isProtected: false, unrecognized: true }
}

/**
 * 探测并深度扫描本机真实 QQ / NTQQ / TIM 存储路径、登录 QQ 号 (UIN)、12 大官方清理分组与核心聊天数据库保护区
 */
export async function fetchQQCleanSnapshot(hostOverride?: Record<string, unknown>): Promise<QQScanSnapshot> {
  const scanner = createDirectoryScanner(hostOverride)
  const [documentsDir, appDataDir, homeDir] = await Promise.all([
    getRealSystemPath('documents', hostOverride),
    getRealSystemPath('appData', hostOverride),
    getRealSystemPath('home', hostOverride)
  ])

  const localAppData = homeDir ? `${homeDir}\\AppData\\Local` : ''
  const tencentFilesDir = documentsDir
    ? `${documentsDir}\\Tencent Files`
    : 'C:\\Users\\Default\\Documents\\Tencent Files'

  // 系统默认路径之外，再查 C 到 G 盘根目录下的 Tencent Files（盘符或目录不存在时扫描结果为空）
  const driveTencentRoots = DRIVE_LETTERS.map(letter => `${letter}:\\Tencent Files`)

  const candidateRoots = [
    tencentFilesDir,
    ...driveTencentRoots,
    appDataDir ? `${appDataDir}\\Tencent\\Users` : '',
    appDataDir ? `${appDataDir}\\Tencent\\Logs` : '',
    appDataDir ? `${appDataDir}\\Tencent\\QQ` : '',
    appDataDir ? `${appDataDir}\\Tencent\\TIM` : '',
    appDataDir ? `${appDataDir}\\QQ` : '',
    localAppData ? `${localAppData}\\Tencent` : ''
  ].filter(Boolean)

  const detectedAccountSet = new Set<string>()
  const allFiles: QQScannedFileEntry[] = []
  const seenPaths = new Set<string>()

  // 归一化 AppData\Roaming\Tencent 与符号链接路径，严防重复计数
  const canonicalizeQQKey = (p: string): string => {
    const lower = p.replace(/\//g, '\\').toLowerCase()
    const idx = lower.indexOf('\\tencent\\')
    if (idx >= 0) return lower.slice(idx)
    return lower
  }

  const groupRules = getOfficialQQGroupRules()
  const sharedAccountId = t('sharedAccountId')
  const registerScannedFile = (fullPath: string, sizeBytes: number, mtime = 0) => {
    if (!fullPath || sizeBytes <= 0) return
    const key = canonicalizeQQKey(fullPath)
    if (seenPaths.has(key)) return
    seenPaths.add(key)

    const cleanPath = fullPath.replace(/\//g, '\\')
    const lastSep = cleanPath.lastIndexOf('\\')
    const name = lastSep >= 0 ? cleanPath.slice(lastSep + 1) : cleanPath
    const parentDir = lastSep > 0 ? cleanPath.slice(0, lastSep) : cleanPath

    const cls = classifyQQFilePath(cleanPath)
    if (cls.accountId !== sharedAccountId) {
      detectedAccountSet.add(cls.accountId)
    }

    const ruleMeta = groupRules.find(r => r.groupId === cls.groupId) || groupRules[0]

    allFiles.push({
      id: `qq-file-${allFiles.length}`,
      name,
      path: cleanPath,
      parentDir,
      groupId: cls.groupId,
      groupName: ruleMeta.shortName,
      accountId: cls.accountId,
      clientType: cls.clientType,
      sizeBytes,
      // 宿主没有给出修改时间时记为 0（界面显示“未知日期”），不用当前时间冒充
      mtime: mtime > 0 ? mtime : 0,
      isProtected: cls.isProtected,
      ...(cls.unrecognized ? { unrecognized: true } : {})
    })
  }

  const extraGroupTotals = new Map<QQGroupId, { extraFiles: number; extraBytes: number; targetDir?: string }>()
  const supportsDeepScan =
    (!hostOverride && isRealElectronHost()) ||
    typeof hostOverride?.system_search_files === 'function'

  if (supportsDeepScan) {
    const deepTargets: Array<{ dir: string; defaultGroup?: QQGroupId }> = [
      { dir: tencentFilesDir },
      ...driveTencentRoots.map(dir => ({ dir })),
      ...(appDataDir
        ? [
            { dir: `${appDataDir}\\Tencent\\Users`, defaultGroup: 209 as QQGroupId },
            { dir: `${appDataDir}\\Tencent\\Logs`, defaultGroup: 203 as QQGroupId },
            { dir: `${appDataDir}\\Tencent\\QQ`, defaultGroup: 209 as QQGroupId },
            { dir: `${appDataDir}\\Tencent\\TIM`, defaultGroup: 209 as QQGroupId },
            { dir: `${appDataDir}\\Tencent\\QQTempSys`, defaultGroup: 209 as QQGroupId },
            { dir: `${appDataDir}\\QQ`, defaultGroup: 209 as QQGroupId }
          ]
        : []),
      ...(localAppData
        ? [
            { dir: `${localAppData}\\Tencent\\MiniBrowser`, defaultGroup: 211 as QQGroupId },
            { dir: `${localAppData}\\Tencent\\QQGuild`, defaultGroup: 211 as QQGroupId },
            { dir: `${localAppData}\\Tencent\\Misc`, defaultGroup: 209 as QQGroupId }
          ]
        : [])
    ]

    const seenSubdirTotals = new Set<string>()
    const scanResults = await Promise.all(deepTargets.map(t => scanner.scan(t.dir, 140)))

    // 从 Tencent Files 与 Tencent\Users 一级子目录提取全部本机登录 QQ 号 (UIN)
    for (let i = 0; i < deepTargets.length; i++) {
      const target = deepTargets[i]
      const res = scanResults[i]
      if (!res) continue
      const lowerDir = target.dir.toLowerCase()
      if (lowerDir.endsWith('tencent files') || lowerDir.endsWith('\\tencent\\users')) {
        for (const sub of res.subdirs) {
          if (/^\d{5,12}$/.test(sub.name) || /^nt_qq/i.test(sub.name)) {
            detectedAccountSet.add(sub.name)
          }
        }
      }
    }

    for (let i = 0; i < deepTargets.length; i++) {
      const target = deepTargets[i]
      const res = scanResults[i]
      if (!res || (res.files.length === 0 && res.totalFiles === 0)) continue

      let sampledBytes = 0
      let sampledCount = 0
      for (const f of res.files) {
        if (!f.isDir && f.size > 0) {
          const beforeLen = allFiles.length
          registerScannedFile(f.path, f.size, f.mtime)
          if (allFiles.length > beforeLen) {
            sampledBytes += f.size
            sampledCount += 1
          }
        }
      }

      if (target.defaultGroup) {
        const canonDirKey = canonicalizeQQKey(target.dir)
        if (!seenSubdirTotals.has(canonDirKey) && res.totalBytes > sampledBytes) {
          seenSubdirTotals.add(canonDirKey)
          const cur = extraGroupTotals.get(target.defaultGroup) || { extraFiles: 0, extraBytes: 0 }
          cur.extraFiles += Math.max(0, res.totalFiles - sampledCount)
          cur.extraBytes += Math.max(0, res.totalBytes - sampledBytes)
          cur.targetDir = target.dir
          extraGroupTotals.set(target.defaultGroup, cur)
        }
      }
    }
  } else {
    // 兼容自定义 hostOverride (filesystem_get_directory_contents) 测试链路
    const subDirs = await listRealDirectoryContents(tencentFilesDir, hostOverride)
    for (const sub of subDirs) {
      const name = sub.split(/[\\/]/).pop() || ''
      if (/^\d{5,12}$/.test(name) || /^nt_qq/i.test(name)) {
        detectedAccountSet.add(name)
      }
    }

    // 只读取 QQ / TIM 数据目录的第一层（不读取系统临时目录，避免把别的程序的文件当成 QQ 缓存）
    const fallbackDirs = [
      appDataDir ? `${appDataDir}\\Tencent\\QQ` : 'C:\\Users\\Default\\AppData\\Roaming\\Tencent\\QQ',
      appDataDir ? `${appDataDir}\\Tencent\\Logs` : 'C:\\Users\\Default\\AppData\\Roaming\\Tencent\\Logs',
      appDataDir ? `${appDataDir}\\Tencent` : 'C:\\Users\\Default\\AppData\\Roaming\\Tencent',
      tencentFilesDir,
      localAppData ? `${localAppData}\\Tencent` : 'C:\\Users\\Default\\AppData\\Local\\Tencent'
    ]
    for (const d of fallbackDirs) {
      const entries = await listRealDirectoryContents(d, hostOverride)
      const slice = entries.slice(0, 25)
      const sizes = await Promise.all(slice.map(p => getRealFileSize(p, hostOverride)))
      for (let i = 0; i < slice.length; i++) {
        registerScannedFile(slice[i], sizes[i] || 0)
      }
    }
  }

  allFiles.sort((a, b) => b.sizeBytes - a.sizeBytes)

  // 构建 12 大官方清理分组 + 1 个核心聊天数据库保护区
  const categories: QQCleanCategoryItem[] = groupRules.map(rule => {
    const catFiles = allFiles.filter(f => f.groupId === rule.groupId)
    const extra = extraGroupTotals.get(rule.groupId)
    const sampledBytes = catFiles.reduce((acc, f) => acc + f.sizeBytes, 0)
    const totalSizeBytes = sampledBytes + (extra?.extraBytes || 0)
    const fileCount = catFiles.length + (extra?.extraFiles || 0)

    const defaultDir =
      catFiles[0]?.parentDir ||
      extra?.targetDir ||
      (rule.groupId === 203
        ? appDataDir
          ? `${appDataDir}\\Tencent\\Logs`
          : 'C:\\Users\\Default\\AppData\\Roaming\\Tencent\\Logs'
        : rule.groupId === 209 || rule.groupId === 213
        ? appDataDir
          ? `${appDataDir}\\Tencent\\QQ`
          : 'C:\\Users\\Default\\AppData\\Roaming\\Tencent\\QQ'
        : rule.groupId === 211
        ? localAppData
          ? `${localAppData}\\Tencent\\MiniBrowser`
          : 'C:\\Users\\Default\\AppData\\Local\\Tencent'
        : tencentFilesDir)

    return {
      id: rule.id,
      groupId: rule.groupId,
      name: rule.name,
      shortName: rule.shortName,
      color: rule.color,
      category: rule.category,
      riskLevel: rule.riskLevel,
      safetyLevel: rule.riskLevel,
      targetDir: defaultDir,
      existsOnDisk: fileCount > 0,
      fileCount,
      totalSizeBytes,
      checked: rule.defaultChecked && rule.groupId !== 999 && totalSizeBytes > 0,
      sampleFiles: catFiles.slice(0, 12).map(f => ({
        path: f.path,
        sizeBytes: f.sizeBytes,
        mtime: f.mtime,
        accountId: f.accountId
      })),
      files: catFiles,
      description: rule.description
    }
  })

  categories.sort((a, b) => {
    if (a.groupId === 999) return 1
    if (b.groupId === 999) return -1
    return b.totalSizeBytes - a.totalSizeBytes
  })

  // 汇总各 QQ 账号 (UIN) 统计
  const accountMap = new Map<string, { fileCount: number; totalBytes: number; rootDir: string; clientType: string }>()
  for (const acc of detectedAccountSet) {
    accountMap.set(acc, {
      fileCount: 0,
      totalBytes: 0,
      rootDir: `${tencentFilesDir}\\${acc}`,
      clientType: 'ClassicQQ / TIM'
    })
  }
  for (const f of allFiles) {
    const cur = accountMap.get(f.accountId) || {
      fileCount: 0,
      totalBytes: 0,
      rootDir: f.parentDir,
      clientType: f.clientType
    }
    cur.fileCount += 1
    cur.totalBytes += f.sizeBytes
    accountMap.set(f.accountId, cur)
  }

  const accountStats: QQAccountStat[] = Array.from(accountMap.entries())
    .map(([accountId, stat]) => ({
      accountId,
      label:
        accountId === sharedAccountId
          ? t('sharedAccountLabel')
          : t('qqAccountLabel', { id: accountId }),
      clientType: stat.clientType,
      rootDir: stat.rootDir,
      fileCount: stat.fileCount,
      totalBytes: stat.totalBytes
    }))
    .sort((a, b) => b.totalBytes - a.totalBytes)

  const detectedAccounts = Array.from(detectedAccountSet)
  const scannableCategories = categories.filter(c => c.groupId !== 999)
  const totalScannableBytes = scannableCategories.reduce((s, c) => s + c.totalSizeBytes, 0)
  const protectedDbBytes = categories.find(c => c.groupId === 999)?.totalSizeBytes || 0

  return {
    baseDirectories: candidateRoots,
    detectedAccounts,
    accountStats,
    categories,
    allFiles,
    totalScannableBytes,
    protectedDbBytes,
    error: scanner.error
  }
}

/** 路径是否属于受保护的聊天记录 / 账号数据库（与列表里锁定显示的规则一致） */
export function isQQProtectedPath(filePath: string): boolean {
  const cls = classifyQQFilePath(filePath)
  return FORBIDDEN_TARGET_PATTERN.test(filePath) || cls.isProtected || cls.groupId === 999
}

/** 按账号、分组与搜索词筛选文件，按体积从大到小排列（右侧明细与默认勾选共用同一套规则） */
export function filterQQFiles(
  files: QQScannedFileEntry[],
  filter: { accountId?: string; groupId?: number; query?: string }
): QQScannedFileEntry[] {
  const account = filter.accountId && filter.accountId !== 'ALL' ? filter.accountId : ''
  const group = filter.groupId || 0
  const q = (filter.query || '').trim().toLowerCase()
  return files
    .filter(f => {
      if (account && f.accountId !== account) return false
      if (group !== 0 && f.groupId !== group) return false
      if (!q) return true
      return (
        f.name.toLowerCase().includes(q) ||
        f.path.toLowerCase().includes(q) ||
        f.groupName.toLowerCase().includes(q) ||
        f.accountId.toLowerCase().includes(q)
      )
    })
    .sort((a, b) => b.sizeBytes - a.sizeBytes)
}

/**
 * 扫描后的默认勾选：只勾选当前显示出来的文件里属于默认勾选分组的那些，
 * 没显示出来的文件、无法识别用途的文件、受保护的数据库与默认不勾选的分组（聊天图片、视频、语音、收藏表情、接收文件、登录会话）一律不勾选
 */
export function pickDefaultCheckedPaths(
  visibleFiles: QQScannedFileEntry[],
  categories: QQCleanCategoryItem[]
): string[] {
  const groups = new Set(categories.filter(c => c.checked && c.groupId !== 999).map(c => c.groupId))
  return visibleFiles
    .filter(f => !f.isProtected && !f.unrecognized && f.groupId !== 999 && groups.has(f.groupId))
    .map(f => f.path)
}

/**
 * 把用户勾选的文件逐个移入回收站。只处理传入的路径，不会按分组补选其它文件；
 * 聊天数据库路径直接跳过；任何一个文件失败都会如实计入 failed，ok 只在全部成功时为 true
 */
export async function executeQQCleanup(
  filePaths: string[],
  knownFiles: QQScannedFileEntry[] = [],
  hostOverride?: unknown
): Promise<QQCleanupResult> {
  const sizeOf = new Map<string, number>()
  for (const f of knownFiles) sizeOf.set(f.path, f.sizeBytes)
  const unique = Array.from(
    new Set((Array.isArray(filePaths) ? filePaths : []).filter(p => typeof p === 'string' && p.trim().length > 0))
  )
  const result: QQCleanupResult = {
    ok: false,
    deletedCount: 0,
    freedBytes: 0,
    failedCount: 0,
    failed: [],
    skippedProtected: 0,
    deletedPaths: [],
    skippedPaths: []
  }
  if (unique.length === 0) {
    return { ...result, error: t('noFilesCheckedTitle') }
  }

  for (const targetPath of unique) {
    if (isQQProtectedPath(targetPath)) {
      result.skippedProtected += 1
      result.skippedPaths.push(targetPath)
      continue
    }
    const res = await trashRealItem(targetPath, hostOverride)
    if (res.ok) {
      result.deletedCount += 1
      result.freedBytes += sizeOf.get(targetPath) || 0
      result.deletedPaths.push(targetPath)
    } else {
      result.failed.push({ path: targetPath, error: resolveErrorMessage(res, t('trashFailed')) })
    }
  }

  result.failedCount = result.failed.length
  if (result.deletedCount === 0 && result.failedCount === 0) {
    return { ...result, error: t('allProtectedSkipped') }
  }
  result.ok = result.failedCount === 0
  if (!result.ok) {
    result.error = t('partialTrashFailed', { count: result.failedCount, error: result.failed[0].error })
  }
  return result
}

/** 清理结果的提示文字：只有全部成功才算成功，部分失败与全部失败都如实说明 */
export function summarizeQQCleanup(res: QQCleanupResult): { success: boolean; title: string; message: string } {
  if (res.ok) {
    return {
      success: true,
      title: t('summaryAllOkTitle', { count: res.deletedCount }),
      message: t('summaryAllOkMsg', { bytes: formatBytes(res.freedBytes) })
    }
  }
  if (res.deletedCount > 0) {
    return {
      success: false,
      title: t('summaryPartialTitle', { count: res.failedCount }),
      message: t('summaryPartialMsg', {
        count: res.deletedCount,
        bytes: formatBytes(res.freedBytes),
        error: resolveErrorMessage(res.failed[0], t('unknownError'))
      })
    }
  }
  return { success: false, title: t('summaryFailTitle'), message: resolveErrorMessage(res, t('summaryFailMsg')) }
}

export async function openQQDirectory(dirPath: string, hostOverride?: unknown): Promise<boolean> {
  if (!dirPath) return false
  return showRealItemInFolder(dirPath, hostOverride)
}

export async function openQQFileDefault(filePath: string, hostOverride?: unknown): Promise<boolean> {
  if (!filePath) return false
  return openRealPath(filePath, hostOverride)
}
