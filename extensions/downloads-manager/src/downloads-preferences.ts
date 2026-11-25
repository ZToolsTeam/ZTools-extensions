import { LocalStorage } from '@ztools/declarative-ui'
import { t } from './i18n.js'

const KEY = 'ztools_downloads_preferences_v2'
const LEGACY_PINS = 'ztools_downloads_pinned_v1'
const LEGACY_DIRS = 'ztools_downloads_custom_dirs_v1'
export interface DownloadPreferences { pins: string[]; directories: string[] }
const empty = (): DownloadPreferences => ({ pins: [], directories: [] })

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string' && item.length > 0 && !item.includes('\0'))) {
    throw new Error(t('prefCorrupted'))
  }
  return [...new Set(value)]
}

function parse(value: unknown): DownloadPreferences {
  if (value === undefined) return empty()
  if (!value || typeof value !== 'object' || !('pins' in value) || !('directories' in value)) throw new Error(t('prefInvalidFormat'))
  return { pins: stringArray(value.pins), directories: stringArray(value.directories) }
}

export async function readDownloadPreferences(): Promise<DownloadPreferences> {
  const stored = await LocalStorage.getItem(KEY)
  if (stored !== undefined) return parse(stored)
  // 只在新版记录不存在时迁移旧数据；保留旧记录，读取或保存失败时不得当作空设置。
  if (typeof localStorage === 'undefined') return empty()
  const pins = localStorage.getItem(LEGACY_PINS), directories = localStorage.getItem(LEGACY_DIRS)
  if (pins === null && directories === null) return empty()
  const migrated = { pins: pins === null ? [] : stringArray(JSON.parse(pins)), directories: directories === null ? [] : stringArray(JSON.parse(directories)) }
  if (await LocalStorage.compareAndSet(KEY, undefined, migrated)) return migrated
  const current = await LocalStorage.getItem(KEY)
  if (current === undefined) throw new Error(t('prefMigrationUnconfirmed'))
  return parse(current)
}

export async function updateDownloadPreferences(change: (current: DownloadPreferences) => DownloadPreferences): Promise<DownloadPreferences> {
  await readDownloadPreferences()
  return LocalStorage.updateItem(KEY, raw => parse(change(parse(raw))))
}
