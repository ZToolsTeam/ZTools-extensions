/**
 * 微信电脑版缓存清理：扫描与分类逻辑
 * 9 个清理分类 (owner 107~115) + 聊天数据库保护区 (999)：
 * - 扫描 Documents\xwechat_files、WeChat Files、C 到 G 盘根目录下的同名目录、AppData\Roaming\Tencent\xwechat 与 LocalLow\TENCENT\WeType
 * - 聊天记录数据库 (MSG*.db / MicroMsg.db / db_storage\*.db) 受保护，不会被清理
 * - 只把用户勾选的文件移入回收站，失败如实返回
 */

import {
  formatBytes,
  getRealFileSize,
  getRealSystemPath,
  invokeDllPluginCapability,
  isRealElectronHost,
  listRealDirectoryContents,
  createDirectoryScanner,
  showRealItemInFolder,
  trashRealItem,
  openRealPath
} from './native-ipc.js'

export { formatBytes, isRealElectronHost } from './native-ipc.js'

import type { CapabilityActionItem, PluginInvocationResult as NativeInvocationResult } from './native-ipc.js'
export type { CapabilityActionItem, PluginInvocationResult as NativeInvocationResult } from './native-ipc.js'
import { t } from './i18n.js'
import { resolveErrorMessage } from './error-i18n.js'


export type WechatOwnerId = 107 | 108 | 109 | 110 | 111 | 112 | 113 | 114 | 115 | 999

export interface WechatScannedFileEntry {
  id: string
  name: string
  path: string
  parentDir: string
  ownerId: WechatOwnerId
  ownerName: string
  accountId: string
  sizeBytes: number
  mtime: number
  isProtected: boolean
  /** 没有命中任何已知规则、只是归入默认分类显示的文件：不默认勾选 */
  unrecognized?: boolean
}

export interface WechatCleanCategoryItem {
  id: string
  ownerId: WechatOwnerId
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
  files: WechatScannedFileEntry[]
  description: string
}

export interface WechatAccountStat {
  accountId: string
  label: string
  rootDir: string
  fileCount: number
  totalBytes: number
}

export interface WechatScanSnapshot {
  baseDirectories: string[]
  detectedAccounts: string[]
  accountStats: WechatAccountStat[]
  categories: WechatCleanCategoryItem[]
  allFiles: WechatScannedFileEntry[]
  totalScannableBytes: number
  protectedDbBytes: number
  error?: string
}

export interface WechatCleanupResult {
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
export const WECHAT_FILE_DISPLAY_LIMIT = 60

/** 在这些盘符根目录下查找自定义的微信存储目录；盘符不存在时扫描结果为空 */
const DRIVE_LETTERS = ['C', 'D', 'E', 'F', 'G']

export const DLL_PLUGIN_NAME = 'WechatCleanerPlugin'
export const FORBIDDEN_TARGET_PATTERN = new RegExp(
  '(?:^|[\\\\/])(?:MSG\\d*\\.db|MicroMsg\\.db|MediaMsg\\d*\\.db|db_storage[\\\\/].*\\.db(?:-wal|-shm)?|message_\\d+\\.db|contact\\.db|session\\.db)$',
  'i'
)
export function getForbiddenReason(): string {
  return t('forbiddenReason')
}

export interface OfficialWechatOwnerRule {
  ownerId: WechatOwnerId
  id: string
  name: string
  shortName: string
  color: string
  category: WechatCleanCategoryItem['category']
  riskLevel: WechatCleanCategoryItem['riskLevel']
  defaultChecked: boolean
  description: string
}

/**
 * 9 大专项清理分类 (owner 107~115) + 1 项核心聊天数据库保护区 (999)，分类规则与 Windows 原生组件一致
 */
export function getOfficialWechatOwnerRules(): OfficialWechatOwnerRule[] {
  return [
    {
      ownerId: 107,
      id: 'wx-owner-107-sns-web',
      name: t('owner107Name'),
      shortName: t('owner107Short'),
      color: '#64748b',
      category: 'cache',
      riskLevel: 'safe',
      defaultChecked: true,
      description: t('owner107Desc')
    },
    {
      ownerId: 115,
      id: 'wx-owner-115-xplugin',
      name: t('owner115Name'),
      shortName: t('owner115Short'),
      color: '#64748b',
      category: 'cache',
      riskLevel: 'recommended',
      defaultChecked: true,
      description: t('owner115Desc')
    },
    {
      ownerId: 113,
      id: 'wx-owner-113-xlog',
      name: t('owner113Name'),
      shortName: t('owner113Short'),
      color: '#64748b',
      category: 'logs',
      riskLevel: 'safe',
      defaultChecked: true,
      description: t('owner113Desc')
    },
    {
      ownerId: 112,
      id: 'wx-owner-112-crash',
      name: t('owner112Name'),
      shortName: t('owner112Short'),
      color: '#64748b',
      category: 'logs',
      riskLevel: 'safe',
      defaultChecked: true,
      description: t('owner112Desc')
    },
    {
      ownerId: 111,
      id: 'wx-owner-111-emoticon',
      name: t('owner111Name'),
      shortName: t('owner111Short'),
      color: '#64748b',
      category: 'media',
      riskLevel: 'safe',
      defaultChecked: true,
      description: t('owner111Desc')
    },
    {
      ownerId: 114,
      id: 'wx-owner-114-update',
      name: t('owner114Name'),
      shortName: t('owner114Short'),
      color: '#64748b',
      category: 'cache',
      riskLevel: 'safe',
      defaultChecked: true,
      description: t('owner114Desc')
    },
    {
      ownerId: 109,
      id: 'wx-owner-109-video-voice',
      name: t('owner109Name'),
      shortName: t('owner109Short'),
      color: '#64748b',
      category: 'media',
      riskLevel: 'caution',
      defaultChecked: false,
      description: t('owner109Desc')
    },
    {
      ownerId: 108,
      id: 'wx-owner-108-chat-images',
      name: t('owner108Name'),
      shortName: t('owner108Short'),
      color: '#64748b',
      category: 'media',
      riskLevel: 'caution',
      defaultChecked: false,
      description: t('owner108Desc')
    },
    {
      ownerId: 110,
      id: 'wx-owner-110-recv-files',
      name: t('owner110Name'),
      shortName: t('owner110Short'),
      color: '#64748b',
      category: 'files',
      riskLevel: 'caution',
      defaultChecked: false,
      description: t('owner110Desc')
    },
    {
      ownerId: 999,
      id: 'wx-owner-999-protected-db',
      name: t('owner999Name'),
      shortName: t('owner999Short'),
      color: '#64748b',
      category: 'protected',
      riskLevel: 'protected',
      defaultChecked: false,
      description: t('owner999Desc')
    }
  ]
}

export function getCapabilityItems(): CapabilityActionItem[] {
  return [
    {
      id: 'wx-detect-info',
      title: t('capDetectTitle'),
      subtitle: t('capDetectSub'),
      tag: t('capDetectTag'),
      method: 'GetWechatInfo',
      params: {}
    },
    {
      id: 'wx-scan-cache',
      title: t('capScanTitle'),
      subtitle: t('capScanSub'),
      tag: t('capScanTag'),
      method: 'StartScanAsync',
      params: { scope: 'cache_and_video' }
    },
    {
      id: 'wx-total-stats',
      title: t('capStatsTitle'),
      subtitle: t('capStatsSub'),
      tag: t('capStatsTag'),
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
  if (typeof method !== 'string' || method.trim().length === 0) {
    return { valid: false, error: t('errMethodEmpty') }
  }
  if (method.length > 128 || !/^[A-Za-z0-9_]+$/.test(method.trim())) {
    return { valid: false, error: t('errMethodFormat') }
  }
  if (params === null || params === undefined || typeof params !== 'object' || Array.isArray(params)) {
    return { valid: false, error: t('errParamsObject') }
  }

  const record = params as Record<string, unknown>
  for (const [key, val] of Object.entries(record)) {
    if (typeof val === 'string') {
      if (val.length > 4096) {
        return { valid: false, error: t('errParamTooLong', { key }) }
      }
      if (FORBIDDEN_TARGET_PATTERN.test(val)) {
        return { valid: false, error: `SECURITY_INTERCEPTED: ${t('forbiddenReason')}` }
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
  hostBridge?: unknown
): Promise<NativeInvocationResult> {
  const check = validateInvocationPayload(method, params)
  if (!check.valid) {
    throw new Error(resolveErrorMessage(check, t('errParamValidationFailed')))
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
 * 根据微信文件的完整真实路径，将其精准归入 9 大专项分类 (107~115，与 Windows 原生组件规则一致) 或 999 聊天数据库保护区，
 * 并提取所属微信号 (accountId)
 */
export function classifyWechatFilePath(
  fullPath: string,
  knownAccounts: string[]
): {
  ownerId: WechatOwnerId
  accountId: string
  isProtected: boolean
  unrecognized?: boolean
} {
  const norm = fullPath.replace(/\//g, '\\')
  const lower = norm.toLowerCase()

  // 1. 识别所属账号 (wxid / 微信号目录)
  let accountId = t('sharedAccountId')
  const xwMatch = norm.match(/xwechat_files\\([^\\]+)/i) || norm.match(/WeChat Files\\([^\\]+)/i)
  if (xwMatch && xwMatch[1]) {
    const seg = xwMatch[1]
    if (!/^(?:all_users|all users|wmpf|applet|backup)$/i.test(seg)) {
      accountId = seg
    }
  } else {
    const radiumUserMatch = norm.match(/radium\\Users\\([0-9a-f]{16,64})/i)
    if (radiumUserMatch && radiumUserMatch[1]) {
      const hash = radiumUserMatch[1].toLowerCase()
      const matchedKnown = knownAccounts.find(a => {
        const suffix = a.split('_').pop()?.toLowerCase() || ''
        return suffix.length >= 4 && hash.startsWith(suffix)
      })
      accountId = matchedKnown || `wx_${hash.slice(0, 8)}`
    }
  }

  // 2. 判定是否属于受保护的核心聊天数据库 (Owner 999)
  if (
    FORBIDDEN_TARGET_PATTERN.test(norm) ||
    lower.includes('\\db_storage\\') ||
    lower.includes('\\msg\\multi\\') ||
    /\\(?:micromsg|msg\d*|mediamsg\d*|contact|session|message_\d+|head_image|favorite)\.db/i.test(lower)
  ) {
    return { ownerId: 999, accountId, isProtected: true }
  }

  // 3. 判定 9 大专项清理分类 (Owner 107~115)
  if (lower.includes('\\crashinfo\\') || lower.includes('\\crashpad\\') || lower.endsWith('.dmp')) {
    return { ownerId: 112, accountId, isProtected: false }
  }
  if (lower.includes('\\log\\') || lower.includes('\\wetype\\') || lower.endsWith('.xlog')) {
    return { ownerId: 113, accountId, isProtected: false }
  }
  if (lower.includes('\\xplugin\\') || lower.includes('\\applet\\') || lower.includes('radiumwmpf')) {
    return { ownerId: 115, accountId, isProtected: false }
  }
  if (
    lower.includes('\\emoticon\\') ||
    lower.includes('\\customemotion\\') ||
    lower.includes('\\resource\\') ||
    lower.includes('\\filestorage\\temp\\')
  ) {
    return { ownerId: 111, accountId, isProtected: false }
  }
  if (
    lower.includes('\\msg\\attach\\') ||
    lower.includes('\\filestorage\\msgattach\\') ||
    lower.includes('\\filestorage\\image\\')
  ) {
    return { ownerId: 108, accountId, isProtected: false }
  }
  if (
    lower.includes('\\msg\\video\\') ||
    lower.includes('\\msg\\voice\\') ||
    lower.includes('\\filestorage\\video\\') ||
    lower.includes('\\filestorage\\voice\\') ||
    lower.includes('\\media cache\\') ||
    /\.(?:mp4|mov|avi|amr|silk|mp3|wav)$/i.test(lower)
  ) {
    return { ownerId: 109, accountId, isProtected: false }
  }
  if (lower.includes('\\msg\\file\\') || lower.includes('\\filestorage\\file\\')) {
    return { ownerId: 110, accountId, isProtected: false }
  }
  if (
    lower.includes('\\wmpf\\') ||
    lower.includes('\\all_users\\') ||
    lower.includes('\\update\\') ||
    lower.includes('\\xwechat\\net') ||
    lower.includes('\\xwechat\\roam') ||
    lower.includes('\\config\\')
  ) {
    return { ownerId: 114, accountId, isProtected: false }
  }

  // 朋友圈与公众号网页缓存 (radium、Sns、cache 目录)
  if (lower.includes('\\radium\\') || lower.includes('\\sns\\') || lower.includes('\\cache\\')) {
    return { ownerId: 107, accountId, isProtected: false }
  }

  // 其余无法识别用途的文件也归入 107 显示，但标记为未识别，不默认勾选
  return { ownerId: 107, accountId, isProtected: false, unrecognized: true }
}

/**
 * 探测并深度扫描本机真实微信存储路径、微信号账号、9 大专项分类与聊天数据库保护区
 */
export async function fetchWechatCleanSnapshot(hostOverride?: Record<string, unknown>): Promise<WechatScanSnapshot> {
  const scanner = createDirectoryScanner(hostOverride)
  const [documentsDir, appDataDir, homeDir] = await Promise.all([
    getRealSystemPath('documents', hostOverride),
    getRealSystemPath('appData', hostOverride),
    getRealSystemPath('home', hostOverride)
  ])

  const localAppData = homeDir ? `${homeDir}\\AppData\\Local` : ''
  const localLowAppData = homeDir ? `${homeDir}\\AppData\\LocalLow` : ''

  // 系统默认路径之外，再查 C 到 G 盘根目录下的微信数据目录（盘符或目录不存在时扫描结果为空）
  const driveWechatRoots = DRIVE_LETTERS.flatMap(letter => [`${letter}:\\WeChat Files`, `${letter}:\\xwechat_files`])

  const candidateRoots = [
    documentsDir ? `${documentsDir}\\xwechat_files` : '',
    documentsDir ? `${documentsDir}\\WeChat Files` : '',
    appDataDir ? `${appDataDir}\\Tencent\\xwechat` : '',
    appDataDir ? `${appDataDir}\\Tencent\\WeChat` : '',
    ...driveWechatRoots,
    localLowAppData ? `${localLowAppData}\\TENCENT\\WeType` : '',
    localAppData ? `${localAppData}\\Tencent\\WeChat` : ''
  ].filter(Boolean)

  // 1. 先探测本机微信号账号目录
  const detectedAccountSet = new Set<string>()
  if (hostOverride || !isRealElectronHost()) {
    for (const root of candidateRoots.slice(0, 2)) {
      const subDirs = await listRealDirectoryContents(root, hostOverride)
      for (const sub of subDirs) {
        const name = sub.split(/[\\/]/).pop() || ''
        if (
          name &&
          !name.includes('.') &&
          !/^(?:All Users|all_users|Applet|WMPF|Backup|config)$/i.test(name)
        ) {
          detectedAccountSet.add(name)
        }
      }
    }
  }

  const allFiles: WechatScannedFileEntry[] = []
  const seenPaths = new Set<string>()

  // 归一化 AppData\Roaming\Tencent 与符号链接路径，避免重复计数
  const canonicalizeWechatKey = (p: string): string => {
    const lower = p.replace(/\//g, '\\').toLowerCase()
    const idx = lower.indexOf('\\tencent\\xwechat\\')
    if (idx >= 0) return lower.slice(idx)
    const idx2 = lower.indexOf('\\tencent\\wechat\\')
    if (idx2 >= 0) return lower.slice(idx2)
    return lower
  }

  const registerScannedFile = (fullPath: string, sizeBytes: number, mtime = 0) => {
    if (!fullPath || sizeBytes <= 0) return
    const key = canonicalizeWechatKey(fullPath)
    if (seenPaths.has(key)) return
    seenPaths.add(key)

    const cleanPath = fullPath.replace(/\//g, '\\')
    const lastSep = cleanPath.lastIndexOf('\\')
    const name = lastSep >= 0 ? cleanPath.slice(lastSep + 1) : cleanPath
    const parentDir = lastSep > 0 ? cleanPath.slice(0, lastSep) : cleanPath

    // 从路径中补充识别账号
    const xwAcc = cleanPath.match(/xwechat_files\\([^\\]+)\\/i)
    if (xwAcc && xwAcc[1] && !/^(?:all_users|wmpf|applet|backup)$/i.test(xwAcc[1])) {
      detectedAccountSet.add(xwAcc[1])
    }

    const knownAccounts = Array.from(detectedAccountSet)
    const cls = classifyWechatFilePath(cleanPath, knownAccounts)
    if (cls.accountId !== t('sharedAccountId')) {
      detectedAccountSet.add(cls.accountId)
    }

    const ownerRules = getOfficialWechatOwnerRules()
    const ruleMeta =
      ownerRules.find(r => r.ownerId === cls.ownerId) ||
      ownerRules[0]

    allFiles.push({
      id: `wx-file-${allFiles.length}`,
      name,
      path: cleanPath,
      parentDir,
      ownerId: cls.ownerId,
      ownerName: ruleMeta.shortName,
      accountId: cls.accountId,
      sizeBytes,
      // 宿主没有给出修改时间时记为 0（界面显示“未知日期”），不用当前时间冒充
      mtime: mtime > 0 ? mtime : 0,
      isProtected: cls.isProtected,
      ...(cls.unrecognized ? { unrecognized: true } : {})
    })
  }

  // 2A. 真实 Electron 宿主环境或支持 dir: 深度扫描的测试环境：执行深度目录树扫描 (dir:)
  // 同时跟踪各分类的真实全量文件数与真实全量字节数（即使 Top 样本只取前 200 个）
  const extraOwnerTotals = new Map<WechatOwnerId, { extraFiles: number; extraBytes: number; targetDir?: string }>()
  const supportsDeepScan =
    (!hostOverride && isRealElectronHost()) ||
    typeof hostOverride?.system_search_files === 'function'

  if (supportsDeepScan) {
    const deepTargets: Array<{ dir: string; defaultOwner?: WechatOwnerId }> = [
      ...(documentsDir
        ? [
            { dir: `${documentsDir}\\xwechat_files` },
            { dir: `${documentsDir}\\WeChat Files` }
          ]
        : []),
      ...driveWechatRoots.map(dir => ({ dir })),
      ...(appDataDir
        ? [
            { dir: `${appDataDir}\\Tencent\\xwechat\\radium`, defaultOwner: 107 as WechatOwnerId },
            { dir: `${appDataDir}\\Tencent\\xwechat\\xplugin`, defaultOwner: 115 as WechatOwnerId },
            { dir: `${appDataDir}\\Tencent\\xwechat\\log`, defaultOwner: 113 as WechatOwnerId },
            { dir: `${appDataDir}\\Tencent\\xwechat\\crashinfo`, defaultOwner: 112 as WechatOwnerId },
            { dir: `${appDataDir}\\Tencent\\xwechat\\net`, defaultOwner: 114 as WechatOwnerId }
          ]
        : []),
      ...(localLowAppData
        ? [{ dir: `${localLowAppData}\\TENCENT\\WeType`, defaultOwner: 113 as WechatOwnerId }]
        : [])
    ]

    const seenSubdirTotals = new Set<string>()
    const scanResults = await Promise.all(deepTargets.map(t => scanner.scan(t.dir, 150)))

    // 先从 xwechat_files / WeChat Files 子目录提取本机微信号账号目录 (如 geek_user_xxxx)
    for (let i = 0; i < Math.min(2, deepTargets.length); i++) {
      const res = scanResults[i]
      if (!res) continue
      for (const sub of res.subdirs) {
        if (
          sub.name &&
          !sub.name.includes('.') &&
          !/^(?:All Users|all_users|Applet|WMPF|Backup|config)$/i.test(sub.name)
        ) {
          detectedAccountSet.add(sub.name)
        }
      }
    }

    for (let i = 0; i < deepTargets.length; i++) {
      const target = deepTargets[i]
      const res = scanResults[i]
      if (!res || (res.files.length === 0 && res.totalFiles === 0)) continue

      // 从 radium\Users 子目录识别更多微信号 profile
      if (target.dir.toLowerCase().endsWith('\\radium')) {
        for (const sub of res.subdirs) {
          if (sub.name.toLowerCase() === 'users') {
            const usersScan = await scanner.scan(sub.path, 40)
            for (const u of usersScan.subdirs) {
              if (/^[0-9a-f]{16,64}$/i.test(u.name)) {
                const hash = u.name.toLowerCase()
                const matched = Array.from(detectedAccountSet).find(a => {
                  const suf = a.split('_').pop()?.toLowerCase() || ''
                  return suf.length >= 4 && hash.startsWith(suf)
                })
                if (!matched) {
                  detectedAccountSet.add(`wx_${hash.slice(0, 8)}`)
                }
              }
            }
          }
        }
      }

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

      // 如果该专项子目录真实全量字节数大于 Top 采样字节数，记录真实全量差值以确保统计 100% 精确反映磁盘真实占用
      if (target.defaultOwner) {
        const canonDirKey = canonicalizeWechatKey(target.dir)
        if (!seenSubdirTotals.has(canonDirKey) && res.totalBytes > sampledBytes) {
          seenSubdirTotals.add(canonDirKey)
          const cur = extraOwnerTotals.get(target.defaultOwner) || { extraFiles: 0, extraBytes: 0 }
          cur.extraFiles += Math.max(0, res.totalFiles - sampledCount)
          cur.extraBytes += Math.max(0, res.totalBytes - sampledBytes)
          cur.targetDir = target.dir
          extraOwnerTotals.set(target.defaultOwner, cur)
        }
      }
    }
  } else {
    // 2B. 宿主不支持 dir: 深度扫描时，只读取微信数据目录的第一层（不读取系统临时目录，避免把别的程序的文件当成微信缓存）
    const fallbackDirs = [
      appDataDir ? `${appDataDir}\\Tencent\\WeChat` : 'C:\\Users\\Default\\AppData\\Roaming\\Tencent\\WeChat',
      appDataDir ? `${appDataDir}\\Tencent\\xwechat` : 'C:\\Users\\Default\\AppData\\Roaming\\Tencent\\xwechat',
      documentsDir ? `${documentsDir}\\WeChat Files` : 'C:\\Users\\Default\\Documents\\WeChat Files',
      documentsDir ? `${documentsDir}\\xwechat_files` : 'C:\\Users\\Default\\Documents\\xwechat_files'
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

  // 3. 构建 9 大官方专项分类 + 1 个核心数据库保护区
  const categories: WechatCleanCategoryItem[] = getOfficialWechatOwnerRules().map(rule => {
    const catFiles = allFiles.filter(f => f.ownerId === rule.ownerId)
    const extra = extraOwnerTotals.get(rule.ownerId)
    const sampledBytes = catFiles.reduce((acc, f) => acc + f.sizeBytes, 0)
    const totalSizeBytes = sampledBytes + (extra?.extraBytes || 0)
    const fileCount = catFiles.length + (extra?.extraFiles || 0)

    const defaultDir =
      catFiles[0]?.parentDir ||
      extra?.targetDir ||
      (rule.ownerId === 107 || rule.ownerId === 115 || rule.ownerId === 112 || rule.ownerId === 113
        ? appDataDir
          ? `${appDataDir}\\Tencent\\xwechat`
          : 'C:\\Users\\Default\\AppData\\Roaming\\Tencent\\xwechat'
        : documentsDir
        ? `${documentsDir}\\xwechat_files`
        : 'C:\\Users\\Default\\Documents\\xwechat_files')

    return {
      id: rule.id,
      ownerId: rule.ownerId,
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
      checked: rule.defaultChecked && rule.ownerId !== 999 && totalSizeBytes > 0,
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

  // 按实际体积降序排列（但保持 999 保护区在最后以便清晰核对）
  categories.sort((a, b) => {
    if (a.ownerId === 999) return 1
    if (b.ownerId === 999) return -1
    return b.totalSizeBytes - a.totalSizeBytes
  })

  // 4. 汇总各微信账号统计
  const accountMap = new Map<string, { fileCount: number; totalBytes: number; rootDir: string }>()
  for (const acc of detectedAccountSet) {
    accountMap.set(acc, {
      fileCount: 0,
      totalBytes: 0,
      rootDir: documentsDir ? `${documentsDir}\\xwechat_files\\${acc}` : acc
    })
  }
  for (const f of allFiles) {
    const cur = accountMap.get(f.accountId) || {
      fileCount: 0,
      totalBytes: 0,
      rootDir: f.parentDir
    }
    cur.fileCount += 1
    cur.totalBytes += f.sizeBytes
    accountMap.set(f.accountId, cur)
  }

  const accountStats: WechatAccountStat[] = Array.from(accountMap.entries())
    .map(([accountId, stat]) => ({
      accountId,
      label:
        accountId === t('sharedAccountId')
          ? t('sharedAccountLabel')
          : t('accountLabelPrefix', { id: accountId }),
      rootDir: stat.rootDir,
      fileCount: stat.fileCount,
      totalBytes: stat.totalBytes
    }))
    .sort((a, b) => b.totalBytes - a.totalBytes)

  const detectedAccounts = Array.from(detectedAccountSet)
  const scannableCategories = categories.filter(c => c.ownerId !== 999)
  const totalScannableBytes = scannableCategories.reduce((s, c) => s + c.totalSizeBytes, 0)
  const protectedDbBytes =
    categories.find(c => c.ownerId === 999)?.totalSizeBytes || 0

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

/** 路径是否属于受保护的聊天记录 / 联系人数据库（与列表里锁定显示的规则一致） */
export function isWechatProtectedPath(filePath: string): boolean {
  return FORBIDDEN_TARGET_PATTERN.test(filePath) || classifyWechatFilePath(filePath, []).isProtected
}

/** 按账号、分类与搜索词筛选文件，按体积从大到小排列（右侧明细与默认勾选共用同一套规则） */
export function filterWechatFiles(
  files: WechatScannedFileEntry[],
  filter: { accountId?: string; ownerId?: string; query?: string }
): WechatScannedFileEntry[] {
  const account = filter.accountId && filter.accountId !== 'ALL' ? filter.accountId : ''
  const owner = filter.ownerId && filter.ownerId !== 'ALL' ? filter.ownerId : ''
  const q = (filter.query || '').trim().toLowerCase()
  return files
    .filter(f => {
      if (account && f.accountId !== account) return false
      if (owner && String(f.ownerId) !== owner) return false
      if (!q) return true
      return (
        f.name.toLowerCase().includes(q) ||
        f.path.toLowerCase().includes(q) ||
        f.ownerName.toLowerCase().includes(q) ||
        f.accountId.toLowerCase().includes(q)
      )
    })
    .sort((a, b) => b.sizeBytes - a.sizeBytes)
}

/**
 * 扫描后的默认勾选：只勾选当前显示出来的文件里属于默认勾选分类的那些，
 * 没显示出来的文件、无法识别用途的文件、受保护的数据库与默认不勾选的分类（聊天图片、视频语音、接收文件）一律不勾选
 */
export function pickDefaultCheckedPaths(
  visibleFiles: WechatScannedFileEntry[],
  categories: WechatCleanCategoryItem[]
): string[] {
  const owners = new Set(categories.filter(c => c.checked && c.ownerId !== 999).map(c => c.ownerId))
  return visibleFiles
    .filter(f => !f.isProtected && !f.unrecognized && f.ownerId !== 999 && owners.has(f.ownerId))
    .map(f => f.path)
}

/**
 * 把用户勾选的文件逐个移入回收站。只处理传入的路径，不会按分类补选其它文件；
 * 聊天数据库路径直接跳过；任何一个文件失败都会如实计入 failed，ok 只在全部成功时为 true
 */
export async function executeWechatCleanup(
  filePaths: string[],
  knownFiles: WechatScannedFileEntry[] = [],
  hostOverride?: unknown
): Promise<WechatCleanupResult> {
  const sizeOf = new Map<string, number>()
  for (const f of knownFiles) sizeOf.set(f.path, f.sizeBytes)
  const unique = Array.from(
    new Set((Array.isArray(filePaths) ? filePaths : []).filter(p => typeof p === 'string' && p.trim().length > 0))
  )
  const result: WechatCleanupResult = {
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
    return { ...result, error: t('errNoFilesChecked') }
  }

  for (const targetPath of unique) {
    if (isWechatProtectedPath(targetPath)) {
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
      result.failed.push({ path: targetPath, error: resolveErrorMessage(res, t('errTrashFailed')) })
    }
  }

  result.failedCount = result.failed.length
  if (result.deletedCount === 0 && result.failedCount === 0) {
    return { ...result, error: t('errAllProtected') }
  }
  result.ok = result.failedCount === 0
  if (!result.ok) {
    result.error = t('errPartialTrash', { count: result.failedCount, error: result.failed[0].error })
  }
  return result
}

/** 清理结果的提示文字：只有全部成功才算成功，部分失败与全部失败都如实说明 */
export function summarizeWechatCleanup(res: WechatCleanupResult): { success: boolean; title: string; message: string } {
  if (res.ok) {
    return {
      success: true,
      title: t('summarySuccessTitle', { count: res.deletedCount }),
      message: t('summarySuccessMsg', { size: formatBytes(res.freedBytes) })
    }
  }
  if (res.deletedCount > 0) {
    return {
      success: false,
      title: t('summaryPartialTitle', { count: res.failedCount }),
      message: t('summaryPartialMsg', {
        deleted: res.deletedCount,
        size: formatBytes(res.freedBytes),
        error: resolveErrorMessage(res.failed[0], t('unknownError'))
      })
    }
  }
  return { success: false, title: t('summaryFailedTitle'), message: resolveErrorMessage(res, t('summaryFailedMsg')) }
}

export async function openWechatDirectory(dirPath: string, hostOverride?: unknown): Promise<boolean> {
  if (!dirPath) return false
  return showRealItemInFolder(dirPath, hostOverride)
}

export async function openWechatFileDefault(filePath: string, hostOverride?: unknown): Promise<boolean> {
  if (!filePath) return false
  return openRealPath(filePath, hostOverride)
}
