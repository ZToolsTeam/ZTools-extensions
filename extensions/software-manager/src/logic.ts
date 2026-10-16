/**
 * 软件管理与卸载中心业务逻辑与 Native 契约层 (SoftwareManager Logic)
 * 对接 Win32 SoftwareManagerPlugin 原生导出能力，提供数据过滤、安全防护与离线 Mock
 */

export interface SoftwareItem {
  id: string
  name: string
  version: string
  publisher: string
  installDate: string
  estimatedSize: number // 估算字节数
  installLocation: string
  uninstallString: string
  quietUninstallString?: string
  category: 'desktop' | 'store' | 'runtime' | 'other'
  isSystem: boolean
  launchPath?: string
  launchCount?: number
  lastUsedTime?: number
}

export interface SoftwareSummaryData {
  totalCount: number
  totalSizeBytes: number
  recentInstalledCount: number
  silentSupportedCount: number
}

export interface NativeInvocationResult {
  ok: boolean
  pluginName: string
  method: string
  data?: unknown
  error?: string
  fromFallback?: boolean
}

export const DLL_PLUGIN_NAME = "SoftwareManagerPlugin"

// 受保护的系统核心与不可卸载组件白名单
export const PROTECTED_SYSTEM_SOFTWARE_PATTERN = new RegExp(
  "^(?:Microsoft Visual C\\+\\+.*|Microsoft .NET.*|DirectX.*|Windows (?:Security|Defender|Subsystem)|Edge WebView2 Runtime)",
  'i'
)
export const FORBIDDEN_SOFTWARE_PATTERN = new RegExp(
  "^(?:Microsoft Windows|Windows Operating System|Windows Security)",
  'i'
)
export const FORBIDDEN_UNINSTALL_REASON = "系统内核与操作系统必备底座受 Windows 安全保护，严禁强制卸载"

/**
 * 离线/测试高保真已装软件 Mock 数据集
 */
const MOCK_SOFTWARE_LIST: SoftwareItem[] = [
  {
    id: "chrome-google-llc",
    name: "Google Chrome",
    version: "124.0.6367.91",
    publisher: "Google LLC",
    installDate: "2026-03-15",
    estimatedSize: 1850 * 1024 * 1024, // 1.85 GB
    installLocation: "C:\\Program Files\\Google\\Chrome\\Application",
    uninstallString: "\"C:\\Program Files\\Google\\Chrome\\Application\\124.0.6367.91\\Installer\\setup.exe\" --uninstall",
    quietUninstallString: "\"C:\\Program Files\\Google\\Chrome\\Application\\124.0.6367.91\\Installer\\setup.exe\" --uninstall --force-uninstall",
    category: "desktop",
    isSystem: false,
    launchPath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    launchCount: 428,
    lastUsedTime: Date.now() - 1000 * 60 * 15
  },
  {
    id: "vscode-microsoft",
    name: "Visual Studio Code",
    version: "1.89.1",
    publisher: "Microsoft Corporation",
    installDate: "2026-02-10",
    estimatedSize: 1250 * 1024 * 1024, // 1.25 GB
    installLocation: "C:\\Program Files\\Microsoft VS Code",
    uninstallString: "\"C:\\Program Files\\Microsoft VS Code\\unins000.exe\"",
    quietUninstallString: "\"C:\\Program Files\\Microsoft VS Code\\unins000.exe\" /VERYSILENT",
    category: "desktop",
    isSystem: false,
    launchPath: "C:\\Program Files\\Microsoft VS Code\\Code.exe",
    launchCount: 312,
    lastUsedTime: Date.now() - 1000 * 60 * 30
  },
  {
    id: "nodejs-runtime",
    name: "Node.js (x64)",
    version: "24.13.0",
    publisher: "Node.js Foundation",
    installDate: "2026-01-20",
    estimatedSize: 180 * 1024 * 1024, // 180 MB
    installLocation: "C:\\Program Files\\nodejs",
    uninstallString: "MsiExec.exe /I{B668B8D2-4752-4414-998F-E64415C292E4}",
    quietUninstallString: "MsiExec.exe /qn /x{B668B8D2-4752-4414-998F-E64415C292E4}",
    category: "desktop",
    isSystem: false,
    launchPath: "C:\\Program Files\\nodejs\\node.exe",
    launchCount: 185,
    lastUsedTime: Date.now() - 1000 * 60 * 60
  },
  {
    id: "git-scm",
    name: "Git version 2.45.0",
    version: "2.45.0",
    publisher: "The Git Development Community",
    installDate: "2026-01-15",
    estimatedSize: 320 * 1024 * 1024, // 320 MB
    installLocation: "C:\\Program Files\\Git",
    uninstallString: "\"C:\\Program Files\\Git\\unins000.exe\"",
    quietUninstallString: "\"C:\\Program Files\\Git\\unins000.exe\" /VERYSILENT",
    category: "desktop",
    isSystem: false,
    launchPath: "C:\\Program Files\\Git\\cmd\\git.exe",
    launchCount: 220,
    lastUsedTime: Date.now() - 1000 * 60 * 45
  },
  {
    id: "wechat-tencent",
    name: "微信 (WeChat)",
    version: "4.0.1.20",
    publisher: "Tencent Technology (Shenzhen) Co., Ltd.",
    installDate: "2026-02-28",
    estimatedSize: 2400 * 1024 * 1024, // 2.4 GB
    installLocation: "C:\\Program Files\\Tencent\\WeChat",
    uninstallString: "\"C:\\Program Files\\Tencent\\WeChat\\Uninstall.exe\"",
    category: "desktop",
    isSystem: false,
    launchPath: "C:\\Program Files\\Tencent\\WeChat\\WeChat.exe",
    launchCount: 650,
    lastUsedTime: Date.now() - 1000 * 60 * 5
  },
  {
    id: "windows-terminal-store",
    name: "Windows Terminal",
    version: "1.20.10822.0",
    publisher: "Microsoft Corporation",
    installDate: "2026-03-01",
    estimatedSize: 95 * 1024 * 1024, // 95 MB
    installLocation: "C:\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal_1.20.10822.0_x64__8wekyb3d8bbwe",
    uninstallString: "powershell -Command \"Get-AppxPackage *WindowsTerminal* | Remove-AppxPackage\"",
    quietUninstallString: "powershell -Command \"Get-AppxPackage *WindowsTerminal* | Remove-AppxPackage\"",
    category: "store",
    isSystem: false,
    launchPath: "wt.exe",
    launchCount: 140,
    lastUsedTime: Date.now() - 1000 * 60 * 120
  },
  {
    id: "ms-vcredist-2022-x64",
    name: "Microsoft Visual C++ 2015-2022 Redistributable (x64)",
    version: "14.40.33810",
    publisher: "Microsoft Corporation",
    installDate: "2026-01-10",
    estimatedSize: 34 * 1024 * 1024, // 34 MB
    installLocation: "C:\\Windows\\System32",
    uninstallString: "\"C:\\ProgramData\\Package Cache\\{1234-VC-REDIST}\\VC_redist.x64.exe\" /uninstall",
    quietUninstallString: "\"C:\\ProgramData\\Package Cache\\{1234-VC-REDIST}\\VC_redist.x64.exe\" /uninstall /quiet",
    category: "runtime",
    isSystem: true,
    launchCount: 0
  },
  {
    id: "ms-net-desktop-runtime-8",
    name: "Microsoft .NET Desktop Runtime - 8.0.4 (x64)",
    version: "8.0.4",
    publisher: "Microsoft Corporation",
    installDate: "2026-01-12",
    estimatedSize: 110 * 1024 * 1024, // 110 MB
    installLocation: "C:\\Program Files\\dotnet",
    uninstallString: "\"C:\\ProgramData\\Package Cache\\{5678-DOTNET}\\dotnet-runtime.exe\" /uninstall",
    quietUninstallString: "\"C:\\ProgramData\\Package Cache\\{5678-DOTNET}\\dotnet-runtime.exe\" /uninstall /quiet",
    category: "runtime",
    isSystem: true,
    launchCount: 0
  }
]

export function getMockSoftwareList(): SoftwareItem[] {
  return JSON.parse(JSON.stringify(MOCK_SOFTWARE_LIST))
}

export function getMockSoftwareSummary(list: SoftwareItem[] = MOCK_SOFTWARE_LIST): SoftwareSummaryData {
  const totalSizeBytes = list.reduce((sum, item) => sum + (item.estimatedSize || 0), 0)
  const silentSupportedCount = list.filter(item => Boolean(item.quietUninstallString)).length
  const thirtyDaysAgo = Date.now() - 30 * 24 * 3600 * 1000
  const recentInstalledCount = list.filter(item => {
    if (!item.installDate) return false
    const parsed = Date.parse(item.installDate)
    return !Number.isNaN(parsed) && parsed >= thirtyDaysAgo
  }).length

  return {
    totalCount: list.length,
    totalSizeBytes,
    recentInstalledCount,
    silentSupportedCount
  }
}

/**
 * 格式化字节大小为易读文本
 */
export function formatBytes(bytes: number): string {
  if (typeof bytes !== 'number' || Number.isNaN(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

/**
 * 调度底层 Native 能力（自动嗅探 window.ztools.nativeHost，脱机自动平滑降级）
 */
export async function invokeNativeCapability(
  method: string,
  params: Record<string, unknown> = {},
  hostOverride?: any
): Promise<NativeInvocationResult> {
  const host = hostOverride || (typeof window !== 'undefined' ? (window as any).ztools?.nativeHost : undefined)

  if (host && typeof host.invokePlugin === 'function') {
    try {
      const res = await host.invokePlugin(DLL_PLUGIN_NAME, method, params)
      if (res && typeof res === 'object') {
        return {
          ok: res.ok !== false,
          pluginName: DLL_PLUGIN_NAME,
          method,
          data: res.data !== undefined ? res.data : res,
          error: res.error,
          fromFallback: false
        }
      }
    } catch (err: any) {
      console.warn(`[software-manager] Native invoke failed for ${method}:`, err)
      return {
        ok: false,
        pluginName: DLL_PLUGIN_NAME,
        method,
        error: err instanceof Error ? err.message : String(err),
        fromFallback: false
      }
    }
  }

  // 离线环境 Mock 自动兜底
  return {
    ok: true,
    pluginName: DLL_PLUGIN_NAME,
    method,
    data: resolveMockData(method, params),
    fromFallback: true
  }
}

function resolveMockData(method: string, params: Record<string, unknown>): unknown {
  switch (method) {
    case 'GetAllSoftware':
    case 'SearchSoftware':
      return { software: getMockSoftwareList() }
    case 'GetSummary':
      return getMockSoftwareSummary()
    case 'UninstallSoftware':
    case 'OpenInstallLocation':
    case 'LaunchSoftware':
      return { success: true }
    default:
      return {}
  }
}

/**
 * 转换后端或注册表扫描记录为统一的 SoftwareItem
 */
export function mapRecordToSoftwareItem(rec: any, index: number): SoftwareItem {
  const name = String(rec.name || rec.DisplayName || '').trim()
  const isSystem = Boolean(rec.isSystemComponent || rec.SystemComponent || PROTECTED_SYSTEM_SOFTWARE_PATTERN.test(name))
  const rawSize = typeof rec.estimatedSize === 'number' && rec.estimatedSize > 0
    ? rec.estimatedSize
    : (typeof rec.estimatedSizeKb === 'number' && rec.estimatedSizeKb > 0 ? rec.estimatedSizeKb * 1024 : 0)

  let category: 'desktop' | 'store' | 'runtime' | 'other' = 'desktop'
  if (isSystem || PROTECTED_SYSTEM_SOFTWARE_PATTERN.test(name)) {
    category = 'runtime'
  } else if (name.includes('Store') || (rec.installLocation && rec.installLocation.includes('WindowsApps'))) {
    category = 'store'
  }

  // 推导 launchPath
  let launchPath = rec.launchPath
  if (!launchPath && rec.installLocation && typeof rec.installLocation === 'string') {
    if (rec.installLocation.toLowerCase().endsWith('.exe')) {
      launchPath = rec.installLocation
    }
  }

  return {
    id: String(rec.id || `app-${index}-${encodeURIComponent(name).slice(0, 16)}`),
    name,
    version: String(rec.version || rec.DisplayVersion || ''),
    publisher: String(rec.publisher || rec.Publisher || '未知开发商'),
    installDate: String(rec.installDate || rec.InstallDate || ''),
    estimatedSize: rawSize,
    installLocation: String(rec.installLocation || rec.InstallLocation || ''),
    uninstallString: String(rec.uninstallString || rec.UninstallString || ''),
    quietUninstallString: rec.quietUninstallString || rec.QuietUninstallString || undefined,
    category,
    isSystem,
    launchPath,
    launchCount: rec.launchCount,
    lastUsedTime: rec.lastUsedTime
  }
}

import {
  callHostTransport,
  isRealElectronHost,
  openRealPath,
  showRealItemInFolder
} from '../../shared/native-ipc'

/**
 * 拉取软件列表
 */
export async function fetchSoftwareList(host?: any, forceRefresh = false): Promise<SoftwareItem[]> {
  // 1. 优先通过真实 Electron Preload Transport 调用 applications_list (带合法 messageId 与 params)
  if (!host || isRealElectronHost(host)) {
    const ipcRes = await callHostTransport<any[]>(
      'applications_list',
      { forceRefresh, includeSystemComponents: false },
      host
    )
    if (ipcRes.ok && Array.isArray(ipcRes.data) && ipcRes.data.length > 0) {
      return ipcRes.data.map((item: any, idx: number) => mapRecordToSoftwareItem(item, idx))
    }
  }

  // 2. 尝试从 window.ztools?.applications_list
  try {
    const ztools = typeof window !== 'undefined' ? (window as any).ztools : undefined
    if (typeof ztools?.applications_list === 'function') {
      const list = await ztools.applications_list({ forceRefresh, includeSystemComponents: false })
      if (Array.isArray(list) && list.length > 0) {
        return list.map((item: any, idx: number) => mapRecordToSoftwareItem(item, idx))
      }
    }
  } catch (err) {
    console.warn('[software-manager] fetchSoftwareList from window.ztools failed:', err)
  }

  // 3. 尝试调用原生 DLL 插件
  try {
    const res = await invokeNativeCapability('GetAllSoftware', { forceRefresh }, host)
    if (res.ok && !res.fromFallback && res.data && typeof res.data === 'object' && Array.isArray((res.data as any).software)) {
      return (res.data as any).software as SoftwareItem[]
    }
  } catch (err) {
    console.warn('[software-manager] fetchSoftwareList DLL invoke failed:', err)
  }

  if (isRealElectronHost(host)) {
    return []
  }

  // 4. 仅在纯 Node 离线单测且未提供 host 时兜底
  return getMockSoftwareList()
}

/**
 * 拉取统计概览
 */
export async function fetchSoftwareSummary(host?: any, list?: SoftwareItem[]): Promise<SoftwareSummaryData> {
  let items = list
  if (!items || items.length === 0) {
    items = await fetchSoftwareList(host, false)
  }

  if (items && items.length > 0) {
    const totalCount = items.length
    const totalSizeBytes = items.reduce((sum, item) => sum + (item.estimatedSize || 0), 0)
    const silentSupportedCount = items.filter(item => Boolean(item.quietUninstallString || item.uninstallString)).length

    // 最近 30 天内安装 (基于 installDate 'YYYYMMDD' 或 'YYYY-MM-DD')
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    const recentInstalledCount = items.filter(item => {
      if (!item.installDate) return false
      try {
        let d: number
        if (/^\d{8}$/.test(item.installDate)) {
          const y = parseInt(item.installDate.slice(0, 4), 10)
          const m = parseInt(item.installDate.slice(4, 6), 10) - 1
          const day = parseInt(item.installDate.slice(6, 8), 10)
          d = new Date(y, m, day).getTime()
        } else {
          d = new Date(item.installDate).getTime()
        }
        return !isNaN(d) && d >= thirtyDaysAgo
      } catch {
        return false
      }
    }).length

    return {
      totalCount,
      totalSizeBytes,
      recentInstalledCount,
      silentSupportedCount
    }
  }

  if (isRealElectronHost(host)) {
    return {
      totalCount: 0,
      totalSizeBytes: 0,
      recentInstalledCount: 0,
      silentSupportedCount: 0
    }
  }

  return getMockSoftwareSummary()
}

/**
 * 执行卸载软件（带安全规则拦截）
 */
export async function uninstallSoftware(
  item: SoftwareItem,
  isQuiet = false,
  host?: any
): Promise<{ ok: boolean; error?: string }> {
  if (FORBIDDEN_SOFTWARE_PATTERN.test(item.name)) {
    return { ok: false, error: FORBIDDEN_UNINSTALL_REASON }
  }

  const uninstallCmd = isQuiet ? (item.quietUninstallString || item.uninstallString) : item.uninstallString
  if (!uninstallCmd && !item.id) {
    return { ok: false, error: '未找到可用的卸载程序命令行' }
  }

  // 1. 优先从 Electron Preload Transport 调用 applications_uninstall
  if (!host || isRealElectronHost(host)) {
    const ipcRes = await callHostTransport<{ success?: boolean; message?: string }>(
      'applications_uninstall',
      { command: item.id || item.name },
      host
    )
    if (ipcRes.ok && ipcRes.data?.success !== false) {
      return { ok: true }
    }
  }

  // 2. 尝试调用原生 DLL 插件
  try {
    const res = await invokeNativeCapability('UninstallSoftware', {
      id: item.id,
      name: item.name,
      uninstallString: uninstallCmd,
      isQuiet
    }, host)
    if (res.ok) {
      return { ok: true }
    }
    return { ok: false, error: res.error || '卸载程序启动失败或被用户取消' }
  } catch (err: any) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * 在资源管理器中定位软件安装目录
 */
export async function openSoftwareLocation(installLocation: string, host?: any): Promise<boolean> {
  if (!installLocation) return false
  if (!host || isRealElectronHost(host)) {
    const ok = await showRealItemInFolder(installLocation, host)
    if (ok) return true
  }

  try {
    const res = await invokeNativeCapability('OpenInstallLocation', { path: installLocation }, host)
    return res.ok
  } catch (err) {
    console.warn('[software-manager] openSoftwareLocation error:', err)
    return false
  }
}

/**
 * 启动软件
 */
export async function launchSoftware(launchPath: string, host?: any): Promise<boolean> {
  if (!launchPath) return false
  if (!host || isRealElectronHost(host)) {
    const ok = await openRealPath(launchPath, host)
    if (ok) return true
  }

  try {
    const res = await invokeNativeCapability('LaunchSoftware', { path: launchPath }, host)
    return res.ok
  } catch (err) {
    console.warn('[software-manager] launchSoftware error:', err)
    return false
  }
}

/**
 * 多维过滤与排序
 */
export function filterSoftwareList(
  list: SoftwareItem[],
  query: string,
  tab: string
): SoftwareItem[] {
  if (!Array.isArray(list)) return []
  let filtered = list

  if (tab === 'desktop') {
    filtered = filtered.filter(s => s.category === 'desktop')
  } else if (tab === 'store') {
    filtered = filtered.filter(s => s.category === 'store')
  } else if (tab === 'runtime') {
    filtered = filtered.filter(s => s.category === 'runtime' || s.isSystem)
  }

  const q = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (q) {
    filtered = filtered.filter(s =>
      s.id.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q) ||
      s.name.toLowerCase().replace(/\s+/g, '').includes(q) ||
      s.publisher.toLowerCase().includes(q) ||
      (s.installLocation && s.installLocation.toLowerCase().includes(q)) ||
      (s.version && s.version.toLowerCase().includes(q))
    )
  }

  // 默认优先按估算体积降序排列，大文件在前
  return filtered.slice().sort((a, b) => {
    return (b.estimatedSize || 0) - (a.estimatedSize || 0)
  })
}
