/**
 * 软件卸载业务逻辑：读取系统登记的已安装软件、按名称归类、启动软件自带的卸载程序，
 * 以及只读列出 AppData 下的目录占用。
 *
 * - 软件清单只来自客户端读取的系统登记信息；读不到就如实报错，不按目录名推测软件、版本或发布商
 * - 缺失的版本、发布商、安装日期、安装盘符一律显示为未知，不填默认值
 * - 卸载只是启动软件自带的卸载程序，是否卸载完成以卸载向导为准
 * - AppData 目录只读列出，客户端目前不能把扫描到的目录移入回收站，插件也不提供删除
 */

import {
  callHostTransport,
  getRealSystemPath,
  isRealElectronHost,
  joinWinPath,
  openRealPath,
  readRealDirectory,
  scanRealDirectoryTree,
  showRealItemInFolder
} from './native-ipc.js'

export const NOT_IN_CLIENT_MESSAGE = '需要在 ZTools 客户端中使用'

export type SoftwareSmartCategoryId =
  | 'dev_geek'
  | 'browser_net'
  | 'media_design'
  | 'office_doc'
  | 'game_platform'
  | 'security_driver'
  | 'runtime_system'
  | 'other'

export interface SoftwareSmartCategoryMeta {
  id: SoftwareSmartCategoryId
  name: string
  shortName: string
  description: string
}

export const SOFTWARE_SMART_CATEGORIES: SoftwareSmartCategoryMeta[] = [
  {
    id: 'dev_geek',
    name: '开发工具',
    shortName: '开发工具',
    description: 'IDE 编辑器、编译器、SDK、Git、容器虚拟化与终端工具'
  },
  {
    id: 'browser_net',
    name: '浏览器与通讯',
    shortName: '浏览通讯',
    description: '浏览器、即时通讯、远程控制与下载工具'
  },
  {
    id: 'media_design',
    name: '影音与设计',
    shortName: '影音设计',
    description: '音视频播放、剪辑转码、3D 建模与平面设计'
  },
  {
    id: 'office_doc',
    name: '办公与效率',
    shortName: '办公效率',
    description: 'Office/WPS 办公套件、PDF、笔记与解压缩工具'
  },
  {
    id: 'game_platform',
    name: '游戏与外设',
    shortName: '游戏外设',
    description: '游戏平台、外设驱动中心与游戏客户端'
  },
  {
    id: 'security_driver',
    name: '安全软件与驱动',
    shortName: '安全驱动',
    description: '显卡/声卡/网卡驱动、安全防护软件与芯片组组件'
  },
  {
    id: 'runtime_system',
    name: '运行库与系统组件',
    shortName: '运行库',
    description: 'Visual C++ 运行库、.NET、WebView2 等系统基础组件'
  },
  {
    id: 'other',
    name: '其他',
    shortName: '其他',
    description: '按名称无法归入以上分类的软件'
  }
]

export interface SoftwareItem {
  id: string
  name: string
  /** 版本号；系统登记里没有时为空 */
  version: string
  /** 发布商；系统登记里没有时为空 */
  publisher: string
  installDate: string
  /** 系统登记的估算占用（字节）；没有登记时为 0 */
  estimatedSize: number
  installLocation: string
  uninstallString: string
  category: 'desktop' | 'store' | 'runtime'
  smartCategory?: SoftwareSmartCategoryId
  smartCategoryName?: string
  /** 安装盘符，如 C:；无法从安装位置或卸载命令判断时为空 */
  installDrive?: string
  /** 距安装日期的天数；安装日期未知时为 undefined */
  daysSinceInstall?: number
  isSystem: boolean
  launchPath?: string
}

export interface AppDataDirItem {
  id: string
  folderName: string
  fullPath: string
  scope: 'AppData\\Roaming' | 'AppData\\Local'
  sizeBytes: number
  fileCount: number
  /** 目录名与之相近的已安装软件（按名称粗略比对，可能不准） */
  similarSoftwareName?: string
}

export interface SoftwareListResult {
  ok: boolean
  items: SoftwareItem[]
  error?: string
}

export interface AppDataScanResult {
  ok: boolean
  items: AppDataDirItem[]
  error?: string
}

// 受保护的系统运行库（卸载前额外警告）
export const PROTECTED_SYSTEM_SOFTWARE_PATTERN = new RegExp(
  "^(?:Microsoft Visual C\\+\\+.*|Microsoft \\.NET.*|DirectX.*|Windows (?:Security|Defender|Subsystem)|.*Edge WebView2 Runtime.*)",
  'i'
)
// 操作系统本身，不允许卸载
export const FORBIDDEN_SOFTWARE_PATTERN = new RegExp(
  "^(?:Microsoft Windows|Windows Operating System|Windows Security)",
  'i'
)
export const FORBIDDEN_UNINSTALL_REASON = '这是 Windows 系统组件，不能在这里卸载'

/**
 * 按软件名称、发布商与安装位置归入分类；都匹配不上时归入「其他」
 */
export function classifySoftwareSmartCategory(
  name: string,
  publisher: string,
  installLocation: string,
  isSystem: boolean
): SoftwareSmartCategoryId {
  const text = `${name} ${publisher} ${installLocation}`.toLowerCase()

  if (
    isSystem ||
    PROTECTED_SYSTEM_SOFTWARE_PATTERN.test(name) ||
    /redistributable|runtime|webview2|directx|msxml|openal|\.net framework|\.net desktop|\.net host/i.test(text)
  ) {
    return 'runtime_system'
  }

  if (
    /visual studio|vscode|vs code|git|node\.js|nodejs|python|docker|jetbrains|intellij|pycharm|webstorm|clion|goland|rust|cargo|cmake|postman|insomnia|wireshark|vmware|virtualbox|cursor|windsurf|android studio|sdk|jdk|openjdk|llvm|mingw|cygwin|xshell|putty|dbeaver|navicat|heidisql|windows terminal/i.test(
      text
    )
  ) {
    return 'dev_geek'
  }

  if (
    /chrome|microsoft edge|firefox|brave|opera|vivaldi|wechat|微信|tencent qq|qq|tim|telegram|discord|dingtalk|钉钉|feishu|飞书|slack|zoom|tencent meeting|腾讯会议|thunder|迅雷|fdm|idm|aria2|clash|v2ray|tailscale|zerotier|todesk|sunlogin|向日葵|anydesk|teamviewer/i.test(
      text
    )
  ) {
    return 'browser_net'
  }

  if (
    /vlc|potplayer|mpv|kmplayer|spotify|netease|网易云|qqmusic|qq音乐|kugou|酷狗|kuwo|bilibili|哔哩哔哩|capcut|剪映|adobe|photoshop|illustrator|premiere|after effects|lightroom|figma|blender|obs studio|ffmpeg|audacity|handbrake|davinci|cinema 4d|maya|3ds max/i.test(
      text
    )
  ) {
    return 'media_design'
  }

  if (
    /steam|epic games|ubisoft|battle\.net|wegame|ea app|origin|gog galaxy|xbox|riot|genshin|mihoyo|razer|logitech g|steelseries|corsair/i.test(
      text
    )
  ) {
    return 'game_platform'
  }

  if (
    /nvidia|amd|radeon|geforce|intel\(r\)|realtek|driver|驱动程序|360|huorong|火绒|kaspersky|bitdefender|avast|mcafee|norton|bluetooth|vulkan|physx|chipset|thunderbolt/i.test(
      text
    )
  ) {
    return 'security_driver'
  }

  if (/office|word|excel|powerpoint|wps|pdf|acrobat|foxit|onenote|notion|obsidian|evernote|印象笔记|有道|7-zip|winrar|bandizip|xmind|typora/i.test(text)) {
    return 'office_doc'
  }

  return 'other'
}

export function getSmartCategoryMeta(id?: SoftwareSmartCategoryId): SoftwareSmartCategoryMeta {
  return SOFTWARE_SMART_CATEGORIES.find((c) => c.id === id) || SOFTWARE_SMART_CATEGORIES[SOFTWARE_SMART_CATEGORIES.length - 1]
}

/**
 * 从安装位置或卸载命令中提取盘符；判断不出时返回空字符串
 */
export function extractInstallDrive(installLocation: string, uninstallString: string): string {
  const source = (installLocation || uninstallString || '').trim()
  const match = source.match(/([A-Za-z]):\\/)
  return match ? `${match[1].toUpperCase()}:` : ''
}

/**
 * 解析安装日期距今的天数；日期缺失或无法解析时返回 undefined
 */
export function parseInstallDays(installDate: string): number | undefined {
  if (!installDate) return undefined
  let ts = NaN
  if (/^\d{8}$/.test(installDate)) {
    const y = parseInt(installDate.slice(0, 4), 10)
    const m = parseInt(installDate.slice(4, 6), 10) - 1
    const d = parseInt(installDate.slice(6, 8), 10)
    ts = new Date(y, m, d).getTime()
  } else {
    ts = Date.parse(installDate)
  }
  if (Number.isNaN(ts) || ts <= 0) return undefined
  return Math.max(0, Math.floor((Date.now() - ts) / (24 * 3600 * 1000)))
}

/** 把 20240115 这类登记日期显示为 2024-01-15；其他格式原样返回 */
export function formatInstallDate(installDate: string): string {
  return /^\d{8}$/.test(installDate)
    ? `${installDate.slice(0, 4)}-${installDate.slice(4, 6)}-${installDate.slice(6, 8)}`
    : installDate
}

function enrichSoftwareItem(item: SoftwareItem): SoftwareItem {
  const smartCategory =
    item.smartCategory || classifySoftwareSmartCategory(item.name, item.publisher, item.installLocation, item.isSystem)
  const meta = getSmartCategoryMeta(smartCategory)
  return {
    ...item,
    smartCategory,
    smartCategoryName: meta.shortName,
    installDrive: item.installDrive ?? extractInstallDrive(item.installLocation, item.uninstallString),
    daysSinceInstall: item.daysSinceInstall ?? parseInstallDays(item.installDate)
  }
}

export function formatBytes(bytes: number): string {
  if (typeof bytes !== 'number' || Number.isNaN(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

export function mapRecordToSoftwareItem(rec: Record<string, unknown>, index: number): SoftwareItem {
  const name = String(rec.name || rec.DisplayName || '').trim()
  const isSystem = Boolean(rec.isSystemComponent || rec.SystemComponent || PROTECTED_SYSTEM_SOFTWARE_PATTERN.test(name))
  const rawSize =
    typeof rec.estimatedSize === 'number' && rec.estimatedSize > 0
      ? rec.estimatedSize
      : typeof rec.estimatedSizeKb === 'number' && rec.estimatedSizeKb > 0
        ? rec.estimatedSizeKb * 1024
        : 0
  const installLocation = String(rec.installLocation || rec.InstallLocation || '')

  let category: SoftwareItem['category'] = 'desktop'
  if (isSystem) {
    category = 'runtime'
  } else if (installLocation.includes('WindowsApps')) {
    category = 'store'
  }

  const launchPath =
    typeof rec.launchPath === 'string' && rec.launchPath
      ? rec.launchPath
      : installLocation.toLowerCase().endsWith('.exe')
        ? installLocation
        : undefined

  return enrichSoftwareItem({
    id: String(rec.id || `app-${index}-${encodeURIComponent(name).slice(0, 16)}`),
    name,
    version: String(rec.version || rec.DisplayVersion || '').trim(),
    publisher: String(rec.publisher || rec.Publisher || '').trim(),
    installDate: String(rec.installDate || rec.InstallDate || '').trim(),
    estimatedSize: rawSize,
    installLocation,
    uninstallString: String(rec.uninstallString || rec.UninstallString || ''),
    category,
    isSystem,
    launchPath
  })
}

function hasClientHost(host?: unknown): boolean {
  return Boolean(host) || isRealElectronHost()
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 读取系统登记的已安装软件
 */
export async function fetchSoftwareList(host?: unknown, forceRefresh = false): Promise<SoftwareListResult> {
  if (!hasClientHost(host)) {
    return { ok: false, items: [], error: NOT_IN_CLIENT_MESSAGE }
  }
  const res = await callHostTransport<Array<Record<string, unknown>>>(
    'applications_list',
    { forceRefresh, includeSystemComponents: true },
    host
  )
  if (!res.ok) {
    return { ok: false, items: [], error: `读取已安装软件失败：${res.error || '客户端没有返回结果'}` }
  }
  if (!Array.isArray(res.data)) {
    return { ok: false, items: [], error: '读取已安装软件失败：客户端返回的格式无效' }
  }
  const items = res.data
    .filter((rec) => rec && typeof rec === 'object')
    .map((rec, idx) => mapRecordToSoftwareItem(rec, idx))
    .filter((item) => item.name.length > 0)
  return { ok: true, items }
}

export interface SoftwareSummaryData {
  totalCount: number
  totalSizeBytes: number
  /** 没有登记估算占用的软件数 */
  unknownSizeCount: number
}

export function summarizeSoftware(list: SoftwareItem[]): SoftwareSummaryData {
  return {
    totalCount: list.length,
    totalSizeBytes: list.reduce((sum, item) => sum + (item.estimatedSize || 0), 0),
    unknownSizeCount: list.filter((item) => !(item.estimatedSize > 0)).length
  }
}

const PROTECTED_APPDATA_DIRS = new Set([
  'microsoft',
  'windows',
  'packages',
  'programs',
  'temp',
  'connecteddevicesplatform',
  'd3dscache',
  'fontcache',
  'ztools'
])

/** 按目录名粗略找名称相近的已安装软件（只用于提示，可能不准） */
export function findSimilarSoftware(folderName: string, softwareList: SoftwareItem[]): SoftwareItem | undefined {
  const lowerDir = folderName.toLowerCase()
  if (lowerDir.length < 2) return undefined
  return softwareList.find((sw) => {
    const swName = sw.name.toLowerCase()
    const firstWord = swName.split(/\s+/)[0] || ''
    const swPub = (sw.publisher || '').toLowerCase()
    return (
      swName.includes(lowerDir) ||
      (firstWord.length >= 3 && lowerDir.includes(firstWord)) ||
      (swPub.length > 0 && swPub.includes(lowerDir))
    )
  })
}

/**
 * 只读列出 %APPDATA% 与 %LOCALAPPDATA% 下各前 12 个目录的占用
 */
export async function probeAppDataDirs(softwareList: SoftwareItem[], host?: unknown): Promise<AppDataScanResult> {
  if (!hasClientHost(host)) {
    return { ok: false, items: [], error: NOT_IN_CLIENT_MESSAGE }
  }
  try {
    const [appData, home] = await Promise.all([getRealSystemPath('appData', host), getRealSystemPath('home', host)])
    const roots: Array<{ path: string; scope: AppDataDirItem['scope'] }> = []
    if (appData) roots.push({ path: appData, scope: 'AppData\\Roaming' })
    if (home) roots.push({ path: `${home.replace(/[\\/]+$/, '')}\\AppData\\Local`, scope: 'AppData\\Local' })
    if (roots.length === 0) {
      return { ok: false, items: [], error: '无法获取 AppData 路径' }
    }

    const results: AppDataDirItem[] = []
    await Promise.all(
      roots.map(async (root) => {
        const entries = await readRealDirectory(root.path, host)
        const dirs = entries
          .filter((e) => e.isDirectory && !e.name.startsWith('.') && !PROTECTED_APPDATA_DIRS.has(e.name.toLowerCase()))
          .slice(0, 12)

        await Promise.all(
          dirs.map(async (dir) => {
            const fullPath = dir.path || joinWinPath(root.path, dir.name)
            const stats = await scanRealDirectoryTree(fullPath, { maxFiles: 120, collectTopN: 5, hostOverride: host })
            if (stats.totalBytes <= 64 * 1024) return
            results.push({
              id: `appdata-${root.scope}-${dir.name}`,
              folderName: dir.name,
              fullPath,
              scope: root.scope,
              sizeBytes: stats.totalBytes,
              fileCount: stats.fileCount,
              similarSoftwareName: findSimilarSoftware(dir.name, softwareList)?.name
            })
          })
        )
      })
    )
    return { ok: true, items: results.sort((a, b) => b.sizeBytes - a.sizeBytes) }
  } catch (err) {
    return { ok: false, items: [], error: `扫描 AppData 失败：${errorText(err)}` }
  }
}

/**
 * 启动软件自带的卸载程序。按软件名称匹配客户端登记的软件（名称在登记清单中唯一）。
 */
export async function uninstallSoftware(item: SoftwareItem, host?: unknown): Promise<{ ok: boolean; error?: string }> {
  if (!item || !item.name) {
    return { ok: false, error: '没有选择软件' }
  }
  if (FORBIDDEN_SOFTWARE_PATTERN.test(item.name)) {
    return { ok: false, error: FORBIDDEN_UNINSTALL_REASON }
  }
  if (!item.uninstallString) {
    return { ok: false, error: '系统登记里没有这个软件的卸载程序' }
  }
  if (!hasClientHost(host)) {
    return { ok: false, error: NOT_IN_CLIENT_MESSAGE }
  }
  const res = await callHostTransport<{ success?: boolean; message?: string; error?: string }>(
    'applications_uninstall',
    { command: item.name },
    host
  )
  if (!res.ok) {
    return { ok: false, error: res.error || '启动卸载程序失败' }
  }
  if (res.data && typeof res.data === 'object' && res.data.success === false) {
    return { ok: false, error: res.data.error || res.data.message || '启动卸载程序失败' }
  }
  return { ok: true }
}

export async function openSoftwareLocation(installLocation: string, host?: unknown): Promise<boolean> {
  if (!installLocation) return false
  return showRealItemInFolder(installLocation, host)
}

export async function launchSoftware(launchPath: string, host?: unknown): Promise<boolean> {
  if (!launchPath) return false
  return openRealPath(launchPath, host)
}

/**
 * 按分类、盘符与关键词过滤，按登记的占用体积降序
 */
export function filterSoftwareList(
  list: SoftwareItem[],
  query: string,
  smartCatFilter = 'all',
  driveFilter = 'all'
): SoftwareItem[] {
  if (!Array.isArray(list)) return []
  let filtered = list.map(enrichSoftwareItem)

  if (smartCatFilter && smartCatFilter !== 'all') {
    filtered = filtered.filter((s) => s.smartCategory === smartCatFilter)
  }

  if (driveFilter && driveFilter !== 'all') {
    if (driveFilter === 'OTHER') {
      filtered = filtered.filter((s) => s.installDrive !== 'C:' && s.installDrive !== 'D:')
    } else {
      filtered = filtered.filter((s) => s.installDrive === driveFilter)
    }
  }

  const q = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (q) {
    filtered = filtered.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.name.toLowerCase().replace(/\s+/g, '').includes(q) ||
        s.publisher.toLowerCase().includes(q) ||
        (s.installLocation && s.installLocation.toLowerCase().includes(q)) ||
        (s.version && s.version.toLowerCase().includes(q)) ||
        (s.smartCategoryName && s.smartCategoryName.toLowerCase().includes(q))
    )
  }

  return filtered.slice().sort((a, b) => (b.estimatedSize || 0) - (a.estimatedSize || 0))
}
