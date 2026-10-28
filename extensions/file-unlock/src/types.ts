export type UnlockProcessFilter = 'all' | 'killable' | 'protected'

export type HandleKind = 'file' | 'directory' | 'dll' | 'unknown'

export type ServiceTypeLabel = '系统内核' | '资源管理器' | '后台服务' | '普通进程'

export interface LockingProcessItem {
  id: string
  pid: number
  name: string
  executablePath: string
  lockedPath: string
  handleType: HandleKind
  serviceTypeLabel: ServiceTypeLabel
  isProtected: boolean
  user: string
}

export interface RemovableDriveItem {
  mount: string
  label: string
  totalBytes: number
  freeBytes: number
  totalText: string
  freeText: string
}

export interface FileUnlockInspectionResult {
  ok: boolean
  targetPath: string
  isDirectory: boolean
  isUnlocked: boolean
  processes: LockingProcessItem[]
  /** 目录只抽查了部分文件（或有子目录读取失败），不能据此判断未被占用 */
  partial?: boolean
  errorCode?: string
  error?: string
}

export interface FileUnlockExecutionResult {
  ok: boolean
  pid?: number
  expectedName?: string
  unlockedCount: number
  skippedProtectedCount: number
  explorerRestarted?: boolean
  trashed?: boolean
  renamedPath?: string
  errorCode?: string
  error?: string
}
