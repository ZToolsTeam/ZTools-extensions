export type SyncMode = 'incremental' | 'two-way' | 'mirror'
export type DiffFilterType = 'all' | 'added' | 'modified' | 'orphan' | 'conflict'
export interface FolderSyncDiffItem {
  relPath: string
  diffType: 'added' | 'modified' | 'reverse-add' | 'orphan' | 'conflict'
  direction: 'src-to-dst' | 'dst-to-src' | 'delete-dst' | 'conflict'
  actionBadge: string
  reasonText: string
  sizeBytes: number
  sourceFullPath: string
  targetFullPath: string
}
export interface CompareFoldersResponse { success: true; ok: true; planId: string; diffs: FolderSyncDiffItem[] }
export interface ExecuteSyncResponse {
  success: true
  ok: boolean
  syncedCount: number
  deletedCount: number
  transferredBytes: number
  remainingCount: number
  failures: { relPath: string; error: string }[]
  recoveryPaths: string[]
  error?: string
}
