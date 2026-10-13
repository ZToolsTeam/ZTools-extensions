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
