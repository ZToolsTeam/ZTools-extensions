import { t } from './i18n.js'

export interface FolderItem {
  id: string
  name: string
  path: string
  category: 'personal' | 'system' | 'temp'
  description: string
  /** 额外搜索关键词（英文目录名等），不显示在标题里 */
  keywords?: string[]
  shortcut?: string
}

type I18nKey = Parameters<typeof t>[0]

function makeFolderItem(spec: {
  id: string
  nameKey?: I18nKey
  nameParams?: Record<string, string | number>
  fixedName?: string
  path: string
  category: 'personal' | 'system' | 'temp'
  descKey: I18nKey
  keywords?: string[]
  shortcut?: string
}): FolderItem {
  const { id, nameKey, nameParams, fixedName, path, category, descKey, keywords, shortcut } = spec
  return {
    id,
    path,
    category,
    ...(keywords ? { keywords } : {}),
    ...(shortcut ? { shortcut } : {}),
    get name() {
      return nameKey ? t(nameKey, nameParams) : (fixedName ?? '')
    },
    get description() {
      return t(descKey)
    }
  }
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
    makeFolderItem({
      id: 'desktop',
      nameKey: 'folderDesktopName',
      keywords: ['Desktop'],
      path: `${userProfile}\\Desktop`,
      category: 'personal',
      descKey: 'folderDesktopDesc'
    }),
    makeFolderItem({
      id: 'downloads',
      nameKey: 'folderDownloadsName',
      keywords: ['Downloads'],
      path: `${userProfile}\\Downloads`,
      category: 'personal',
      descKey: 'folderDownloadsDesc'
    }),
    makeFolderItem({
      id: 'documents',
      nameKey: 'folderDocumentsName',
      keywords: ['Documents'],
      path: `${userProfile}\\Documents`,
      category: 'personal',
      descKey: 'folderDocumentsDesc'
    }),
    makeFolderItem({
      id: 'pictures',
      nameKey: 'folderPicturesName',
      keywords: ['Pictures'],
      path: `${userProfile}\\Pictures`,
      category: 'personal',
      descKey: 'folderPicturesDesc'
    }),
    makeFolderItem({
      id: 'userprofile',
      nameKey: 'folderHomeName',
      keywords: ['Home'],
      path: userProfile,
      category: 'personal',
      descKey: 'folderHomeDesc'
    }),
    makeFolderItem({
      id: 'appdata-roaming',
      fixedName: 'AppData Roaming',
      path: appData,
      category: 'system',
      descKey: 'folderAppDataRoamingDesc'
    }),
    makeFolderItem({
      id: 'appdata-local',
      fixedName: 'AppData Local',
      path: localAppData,
      category: 'system',
      descKey: 'folderAppDataLocalDesc'
    }),
    makeFolderItem({
      id: 'temp',
      nameKey: 'folderTempName',
      keywords: ['Temp'],
      path: temp,
      category: 'temp',
      descKey: 'folderTempDesc'
    }),
    makeFolderItem({
      id: 'system-drive',
      nameKey: 'folderSystemDriveName',
      nameParams: { drive: 'C:' },
      path: 'C:\\',
      category: 'system',
      descKey: 'folderSystemDriveDesc'
    }),
    makeFolderItem({
      id: 'windows-dir',
      nameKey: 'folderWindowsDirName',
      path: windir,
      category: 'system',
      descKey: 'folderWindowsDirDesc'
    }),
    makeFolderItem({
      id: 'system32',
      fixedName: 'System32',
      path: `${windir}\\System32`,
      category: 'system',
      descKey: 'folderSystem32Desc'
    })
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
    makeFolderItem({ id: 'desktop', nameKey: 'folderDesktopName', keywords: ['Desktop'], path: pick(paths.desktop, 'Desktop'), category: 'personal', descKey: 'folderDesktopDesc' }),
    makeFolderItem({ id: 'downloads', nameKey: 'folderDownloadsName', keywords: ['Downloads'], path: pick(paths.downloads, 'Downloads'), category: 'personal', descKey: 'folderDownloadsDesc' }),
    makeFolderItem({ id: 'documents', nameKey: 'folderDocumentsName', keywords: ['Documents'], path: pick(paths.documents, 'Documents'), category: 'personal', descKey: 'folderDocumentsDesc' }),
    makeFolderItem({ id: 'pictures', nameKey: 'folderPicturesName', keywords: ['Pictures'], path: pick(paths.pictures, 'Pictures'), category: 'personal', descKey: 'folderPicturesDesc' }),
    makeFolderItem({ id: 'videos', nameKey: windows ? 'folderVideosName' : 'folderMoviesName', keywords: [windows ? 'Videos' : 'Movies'], path: pick(paths.videos, windows ? 'Videos' : 'Movies'), category: 'personal', descKey: 'folderVideosDesc' }),
    makeFolderItem({ id: 'music', nameKey: 'folderMusicName', keywords: ['Music'], path: pick(paths.music, 'Music'), category: 'personal', descKey: 'folderMusicDesc' }),
    makeFolderItem({ id: 'userprofile', nameKey: 'folderHomeName', keywords: ['Home'], path: home, category: 'personal', descKey: 'folderHomeDesc' })
  ]

  if (windows) {
    const drive = /^[A-Za-z]:/.test(home) ? home.slice(0, 2).toUpperCase() : 'C:'
    const localAppData = joinPath(home, 'AppData\\Local', true)
    return [
      ...personal,
      makeFolderItem({ id: 'appdata-roaming', fixedName: 'AppData Roaming', path: pick(paths.appData, 'AppData\\Roaming'), category: 'system', descKey: 'folderAppDataRoamingDesc' }),
      makeFolderItem({ id: 'appdata-local', fixedName: 'AppData Local', path: localAppData, category: 'system', descKey: 'folderAppDataLocalDesc' }),
      makeFolderItem({ id: 'system-drive', nameKey: 'folderSystemDriveName', nameParams: { drive }, path: `${drive}\\`, category: 'system', descKey: 'folderSystemDriveDesc' }),
      makeFolderItem({ id: 'temp', nameKey: 'folderTempName', keywords: ['Temp'], path: systemTempPath(home, true), category: 'temp', descKey: 'folderTempDesc' })
    ]
  }

  return [
    ...personal,
    makeFolderItem({ id: 'applications', nameKey: 'folderApplicationsName', keywords: ['Applications'], path: '/Applications', category: 'system', descKey: 'folderApplicationsDesc' }),
    makeFolderItem({ id: 'app-support', fixedName: 'Application Support', path: pick(paths.appData, 'Library/Application Support'), category: 'system', descKey: 'folderAppSupportDesc' }),
    makeFolderItem({ id: 'library', nameKey: 'folderLibraryName', keywords: ['Library'], path: joinPath(home, 'Library', false), category: 'system', descKey: 'folderLibraryDesc' }),
    makeFolderItem({ id: 'caches', nameKey: 'folderCachesName', keywords: ['Caches'], path: joinPath(home, 'Library/Caches', false), category: 'temp', descKey: 'folderCachesDesc' }),
    makeFolderItem({ id: 'temp', nameKey: 'folderTempName', keywords: ['Temp'], path: systemTempPath(home, false), category: 'temp', descKey: 'folderTempDesc' })
  ]
}

/** 宿主 system_list_common_folders 返回的一项：已按当前平台生成，exists 为宿主实测（只有存在的目录才授权给本窗口打开） */
export interface HostCommonFolder {
  id: string
  path: string
  exists: boolean
}

interface FolderTemplate {
  itemId: string
  nameKey?: I18nKey
  fixedName?: string
  keywords?: string[]
  category: 'personal' | 'system' | 'temp'
  descKey: I18nKey
}

/**
 * 宿主目录 id → 本插件列表项（名称、分类、说明）。顺序即列表顺序；宿主返回而这里没有的 id 不显示。
 * 宿主 temp 在 macOS 是 os.tmpdir()（/var/folders/...），Windows 是 %TEMP%，都是当前用户的系统临时目录。
 */
function folderTemplates(windows: boolean): Array<[string, FolderTemplate]> {
  const personal: Array<[string, FolderTemplate]> = [
    ['desktop', { itemId: 'desktop', nameKey: 'folderDesktopName', keywords: ['Desktop'], category: 'personal', descKey: 'folderDesktopDesc' }],
    ['downloads', { itemId: 'downloads', nameKey: 'folderDownloadsName', keywords: ['Downloads'], category: 'personal', descKey: 'folderDownloadsDesc' }],
    ['documents', { itemId: 'documents', nameKey: 'folderDocumentsName', keywords: ['Documents'], category: 'personal', descKey: 'folderDocumentsDesc' }],
    ['pictures', { itemId: 'pictures', nameKey: 'folderPicturesName', keywords: ['Pictures'], category: 'personal', descKey: 'folderPicturesDesc' }],
    ['videos', { itemId: 'videos', nameKey: windows ? 'folderVideosName' : 'folderMoviesName', keywords: [windows ? 'Videos' : 'Movies'], category: 'personal', descKey: 'folderVideosDesc' }],
    ['music', { itemId: 'music', nameKey: 'folderMusicName', keywords: ['Music'], category: 'personal', descKey: 'folderMusicDesc' }],
    ['home', { itemId: 'userprofile', nameKey: 'folderHomeName', keywords: ['Home'], category: 'personal', descKey: 'folderHomeDesc' }]
  ]
  const temp: [string, FolderTemplate] = ['temp', { itemId: 'temp', nameKey: 'folderTempName', keywords: ['Temp'], category: 'temp', descKey: 'folderTempDesc' }]
  if (windows) {
    return [
      ...personal,
      ['appData', { itemId: 'appdata-roaming', fixedName: 'AppData Roaming', category: 'system', descKey: 'folderAppDataRoamingDesc' }],
      ['localAppData', { itemId: 'appdata-local', fixedName: 'AppData Local', category: 'system', descKey: 'folderAppDataLocalDesc' }],
      ['systemDrive', { itemId: 'system-drive', nameKey: 'folderSystemDrivePlain', category: 'system', descKey: 'folderSystemDriveDesc' }],
      temp
    ]
  }
  return [
    ...personal,
    ['applications', { itemId: 'applications', nameKey: 'folderApplicationsName', keywords: ['Applications'], category: 'system', descKey: 'folderApplicationsDesc' }],
    ['appData', { itemId: 'app-support', fixedName: 'Application Support', category: 'system', descKey: 'folderAppSupportDesc' }],
    ['library', { itemId: 'library', nameKey: 'folderLibraryName', keywords: ['Library'], category: 'system', descKey: 'folderLibraryDesc' }],
    ['libraryCaches', { itemId: 'caches', nameKey: 'folderCachesName', keywords: ['Caches'], category: 'temp', descKey: 'folderCachesDesc' }],
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
    if (hostId === 'systemDrive') {
      const drive = entry.path.replace(/[\\/]+$/, '')
      out.push(
        makeFolderItem({
          id: itemId,
          nameKey: 'folderSystemDriveName',
          nameParams: { drive },
          path: entry.path,
          category: rest.category,
          descKey: rest.descKey,
          keywords: rest.keywords
        })
      )
    } else {
      out.push(
        makeFolderItem({
          id: itemId,
          nameKey: rest.nameKey,
          fixedName: rest.fixedName,
          path: entry.path,
          category: rest.category,
          descKey: rest.descKey,
          keywords: rest.keywords
        })
      )
    }
  }
  return out
}
