export interface FolderItem {
  id: string
  name: string
  path: string
  category: 'personal' | 'system' | 'temp'
  description: string
  shortcut?: string
}

/**
 * 展开环境变量字符串，如 %USERPROFILE% -> C:\Users\xxx
 */
export function expandEnvironmentVariables(
  template: string,
  envMap: Record<string, string> = {}
): string {
  return template.replace(/%([^%]+)%/g, (_, key) => {
    const upper = key.toUpperCase()
    return envMap[upper] || (typeof process !== 'undefined' && process.env?.[upper]) || ''
  })
}

/**
 * 获取 Windows 预置核心目录列表
 */
export function getDefaultFolders(envOverrides?: Record<string, string>): FolderItem[] {
  const userProfile = envOverrides?.USERPROFILE || 'C:\\Users\\Default'
  const appData = envOverrides?.APPDATA || `${userProfile}\\AppData\\Roaming`
  const localAppData = envOverrides?.LOCALAPPDATA || `${userProfile}\\AppData\\Local`
  const windir = envOverrides?.WINDIR || 'C:\\Windows'
  const temp = envOverrides?.TEMP || `${localAppData}\\Temp`

  return [
    {
      id: 'desktop',
      name: '桌面 (Desktop)',
      path: `${userProfile}\\Desktop`,
      category: 'personal',
      description: '个人桌面文件与工作区'
    },
    {
      id: 'downloads',
      name: '下载 (Downloads)',
      path: `${userProfile}\\Downloads`,
      category: 'personal',
      description: '浏览器与网络文件默认下载目录'
    },
    {
      id: 'documents',
      name: '文档 (Documents)',
      path: `${userProfile}\\Documents`,
      category: 'personal',
      description: '个人文档、工程与应用数据'
    },
    {
      id: 'pictures',
      name: '图片 (Pictures)',
      path: `${userProfile}\\Pictures`,
      category: 'personal',
      description: '照片与屏幕截图保存目录'
    },
    {
      id: 'userprofile',
      name: '用户主目录 (Home)',
      path: userProfile,
      category: 'personal',
      description: '当前系统登录用户根目录'
    },
    {
      id: 'appdata-roaming',
      name: 'AppData Roaming',
      path: appData,
      category: 'system',
      description: '应用程序漫游配置与核心数据'
    },
    {
      id: 'appdata-local',
      name: 'AppData Local',
      path: localAppData,
      category: 'system',
      description: '应用程序本地缓存与运行时数据'
    },
    {
      id: 'temp',
      name: '临时文件夹 (Temp)',
      path: temp,
      category: 'temp',
      description: '系统与应用临时文件存放目录'
    },
    {
      id: 'system-drive',
      name: '系统盘 (C:)',
      path: 'C:\\',
      category: 'system',
      description: 'Windows 系统安装驱动器'
    },
    {
      id: 'windows-dir',
      name: 'Windows 系统目录',
      path: windir,
      category: 'system',
      description: '操作系统核心文件目录'
    },
    {
      id: 'system32',
      name: 'System32',
      path: `${windir}\\System32`,
      category: 'system',
      description: '系统 64 位核心动态库与命令行工具'
    }
  ]
}

/** 宿主 system_get_path 读到的当前用户真实目录（读不到的项为空字符串） */
export interface HostFolderPaths {
  home: string
  desktop: string
  downloads: string
  documents: string
  pictures: string
  videos: string
  music: string
  appData: string
}

function joinPath(base: string, child: string, windows: boolean): string {
  const sep = windows ? '\\' : '/'
  return base.replace(/[\\/]+$/, '') + sep + child
}

/**
 * 系统临时目录：不向宿主要 system_get_path('temp')——宿主把它定义为 ZTools 自己的隔离缓存目录
 * （…/ZTools/Cache/main/Temp），不是系统临时目录。这里按系统约定生成：
 * Windows 为当前用户的 %LOCALAPPDATA%\Temp，macOS 为系统公共临时目录 /tmp。
 */
export function systemTempPath(home: string, windows: boolean): string {
  return windows ? joinPath(home, 'AppData\\Local\\Temp', true) : '/tmp'
}

/**
 * 按当前系统生成常用目录：个人目录一律用宿主读到的真实路径（支持被重定向到 OneDrive 等位置的目录），
 * 系统目录按 Windows / macOS 各自的约定生成。宿主没读到主目录时返回空列表，由界面提示读取失败。
 */
export function buildFolders(paths: HostFolderPaths): FolderItem[] {
  const home = String(paths?.home || '').trim()
  if (!home) return []
  const windows = !home.startsWith('/')
  const pick = (value: string, child: string) => String(value || '').trim() || joinPath(home, child, windows)

  const personal: FolderItem[] = [
    { id: 'desktop', name: '桌面 (Desktop)', path: pick(paths.desktop, 'Desktop'), category: 'personal', description: '个人桌面文件与工作区' },
    { id: 'downloads', name: '下载 (Downloads)', path: pick(paths.downloads, 'Downloads'), category: 'personal', description: '浏览器与网络文件默认下载目录' },
    { id: 'documents', name: '文档 (Documents)', path: pick(paths.documents, 'Documents'), category: 'personal', description: '个人文档、工程与应用数据' },
    { id: 'pictures', name: '图片 (Pictures)', path: pick(paths.pictures, 'Pictures'), category: 'personal', description: '照片与屏幕截图保存目录' },
    { id: 'videos', name: windows ? '视频 (Videos)' : '影片 (Movies)', path: pick(paths.videos, windows ? 'Videos' : 'Movies'), category: 'personal', description: '视频与录屏文件' },
    { id: 'music', name: '音乐 (Music)', path: pick(paths.music, 'Music'), category: 'personal', description: '音乐与音频文件' },
    { id: 'userprofile', name: '用户主目录 (Home)', path: home, category: 'personal', description: '当前系统登录用户根目录' }
  ]

  if (windows) {
    const drive = /^[A-Za-z]:/.test(home) ? home.slice(0, 2).toUpperCase() : 'C:'
    const localAppData = joinPath(home, 'AppData\\Local', true)
    return [
      ...personal,
      { id: 'appdata-roaming', name: 'AppData Roaming', path: pick(paths.appData, 'AppData\\Roaming'), category: 'system', description: '应用程序漫游配置与核心数据' },
      { id: 'appdata-local', name: 'AppData Local', path: localAppData, category: 'system', description: '应用程序本地缓存与运行时数据' },
      { id: 'system-drive', name: `系统盘 (${drive})`, path: `${drive}\\`, category: 'system', description: 'Windows 系统安装驱动器' },
      { id: 'temp', name: '临时文件夹 (Temp)', path: systemTempPath(home, true), category: 'temp', description: '系统与应用临时文件存放目录' }
    ]
  }

  return [
    ...personal,
    { id: 'applications', name: '应用程序 (Applications)', path: '/Applications', category: 'system', description: '系统安装的应用程序' },
    { id: 'app-support', name: 'Application Support', path: pick(paths.appData, 'Library/Application Support'), category: 'system', description: '应用程序配置与数据' },
    { id: 'library', name: '资源库 (Library)', path: joinPath(home, 'Library', false), category: 'system', description: '当前用户的偏好设置、缓存与日志' },
    { id: 'caches', name: '缓存 (Caches)', path: joinPath(home, 'Library/Caches', false), category: 'temp', description: '应用程序缓存文件' },
    { id: 'temp', name: '临时文件夹 (Temp)', path: systemTempPath(home, false), category: 'temp', description: '系统与应用临时文件存放目录' }
  ]
}

/** 宿主 system_list_common_folders 返回的一项：已按当前平台生成，exists 为宿主实测（只有存在的目录才授权给本窗口打开） */
export interface HostCommonFolder {
  id: string
  path: string
  exists: boolean
}

type FolderTemplate = Omit<FolderItem, 'id' | 'path'> & { itemId: string }

/**
 * 宿主目录 id → 本插件列表项（名称、分类、说明）。顺序即列表顺序；宿主返回而这里没有的 id 不显示。
 * 宿主 temp 在 macOS 是 os.tmpdir()（/var/folders/...），Windows 是 %TEMP%，都是当前用户的系统临时目录。
 */
function folderTemplates(windows: boolean): Array<[string, FolderTemplate]> {
  const personal: Array<[string, FolderTemplate]> = [
    ['desktop', { itemId: 'desktop', name: '桌面 (Desktop)', category: 'personal', description: '个人桌面文件与工作区' }],
    ['downloads', { itemId: 'downloads', name: '下载 (Downloads)', category: 'personal', description: '浏览器与网络文件默认下载目录' }],
    ['documents', { itemId: 'documents', name: '文档 (Documents)', category: 'personal', description: '个人文档、工程与应用数据' }],
    ['pictures', { itemId: 'pictures', name: '图片 (Pictures)', category: 'personal', description: '照片与屏幕截图保存目录' }],
    ['videos', { itemId: 'videos', name: windows ? '视频 (Videos)' : '影片 (Movies)', category: 'personal', description: '视频与录屏文件' }],
    ['music', { itemId: 'music', name: '音乐 (Music)', category: 'personal', description: '音乐与音频文件' }],
    ['home', { itemId: 'userprofile', name: '用户主目录 (Home)', category: 'personal', description: '当前系统登录用户根目录' }]
  ]
  const temp: [string, FolderTemplate] = ['temp', { itemId: 'temp', name: '临时文件夹 (Temp)', category: 'temp', description: '系统与应用临时文件存放目录' }]
  if (windows) {
    return [
      ...personal,
      ['appData', { itemId: 'appdata-roaming', name: 'AppData Roaming', category: 'system', description: '应用程序漫游配置与核心数据' }],
      ['localAppData', { itemId: 'appdata-local', name: 'AppData Local', category: 'system', description: '应用程序本地缓存与运行时数据' }],
      ['systemDrive', { itemId: 'system-drive', name: '系统盘', category: 'system', description: 'Windows 系统安装驱动器' }],
      temp
    ]
  }
  return [
    ...personal,
    ['applications', { itemId: 'applications', name: '应用程序 (Applications)', category: 'system', description: '系统安装的应用程序' }],
    ['appData', { itemId: 'app-support', name: 'Application Support', category: 'system', description: '应用程序配置与数据' }],
    ['library', { itemId: 'library', name: '资源库 (Library)', category: 'system', description: '当前用户的偏好设置、缓存与日志' }],
    ['libraryCaches', { itemId: 'caches', name: '缓存 (Caches)', category: 'temp', description: '应用程序缓存文件' }],
    temp
  ]
}

/**
 * 按宿主 system_list_common_folders 的结果生成列表：路径一律用宿主给的（宿主已按平台约定生成并授权），
 * 不存在的目录（exists 不为 true）不显示——宿主不会授权打开它们。
 * 返回 null 表示宿主数据不可用（不是数组），调用方应回落到 system_get_path 拼路径。
 */
export function buildFoldersFromHost(folders: unknown): FolderItem[] | null {
  if (!Array.isArray(folders)) return null
  const byId = new Map<string, HostCommonFolder>()
  for (const raw of folders) {
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as Record<string, unknown>
    const id = typeof entry.id === 'string' ? entry.id : ''
    const folderPath = typeof entry.path === 'string' ? entry.path.trim() : ''
    if (!id || !folderPath || byId.has(id)) continue
    byId.set(id, { id, path: folderPath, exists: entry.exists === true })
  }
  const sample = byId.get('home')?.path || [...byId.values()][0]?.path || ''
  const windows = /^[A-Za-z]:/.test(sample) || sample.startsWith('\\\\')
  const out: FolderItem[] = []
  for (const [hostId, tpl] of folderTemplates(windows)) {
    const entry = byId.get(hostId)
    if (!entry || !entry.exists) continue
    const { itemId, ...rest } = tpl
    const name = hostId === 'systemDrive' ? `系统盘 (${entry.path.replace(/[\\/]+$/, '')})` : rest.name
    out.push({ ...rest, id: itemId, name, path: entry.path })
  }
  return out
}
