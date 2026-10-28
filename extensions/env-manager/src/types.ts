export type EnvScope = 'user' | 'system'
export interface EnvItem { key: string; value: string; scope: EnvScope | 'process' }
export interface EnvPath { scope: EnvItem['scope']; index: number; value: string; status: 'directory' | 'missing' | 'unknown'; reason: string }
export interface EnvBackup { id: string; source: EnvScope; createdAt: string; summary: string }
export interface EnvSnapshot {
  sessionId: string; platform: string; notice: string; sources: Array<{ id: EnvScope; label: string }>
  variables: EnvItem[]; paths: EnvPath[]; backups: EnvBackup[]
}
export type EnvChange = { kind: 'set'; source: EnvScope; key: string; value: string } | { kind: 'delete'; source: EnvScope; key: string } |
  { kind: 'clean'; source: EnvScope } | { kind: 'restore'; source: EnvScope; backupId: string }
export interface EnvPlan { planId: string; summary: string; location: string; removed: string[]; notice: string }
