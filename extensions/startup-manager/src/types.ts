export type StartupSourceType = 'registry' | 'folder' | 'service' | 'task' | 'launchd'

export type StartupSourceLabel = '注册表' | '启动目录' | '后台服务' | '计划任务' | 'LaunchAgent'

export type StartupSourceFilter = 'all' | 'app' | 'service' | 'task' | 'enabled' | 'broken'

export interface StartupEntryItem {
  id: string
  name: string
  publisher: string
  command: string
  exePath: string
  source: StartupSourceType
  sourceLabel: StartupSourceLabel
  scope: string
  regKey?: string
  serviceName?: string
  taskPath?: string
  enabled: boolean
  fileMissing: boolean
}

export interface StartupScanSummary {
  ok: boolean
  items: StartupEntryItem[]
  totalCount: number
  enabledCount: number
  serviceCount: number
  taskCount: number
  brokenCount: number
  /** 部分来源（注册表、启动目录、服务、计划任务）读取失败，列表不完整 */
  warnings?: string[]
  errorCode?: string
  error?: string
}

export interface StartupToggleResult {
  ok: boolean
  id: string
  enabled: boolean
  updatedItems?: StartupEntryItem[]
  errorCode?: string
  error?: string
}

export interface StartupCleanBrokenResult {
  ok: boolean
  /** 部分成功：已清理 removedIds，其余见 failed */
  partial?: boolean
  removedCount: number
  removedIds: string[]
  remainingItems?: StartupEntryItem[]
  /** 未能清理的条目与原因 */
  failed?: Array<{ id: string; errorCode: string; error: string }>
  errorCode?: string
  error?: string
}
