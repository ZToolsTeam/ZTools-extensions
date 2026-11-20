import { LocalStorage } from '@ztools/declarative-ui'
import { validateCountdownInput } from './pomodoro-service.js'
import type { CountdownItem } from './types.js'
import { t } from './i18n.js'

export const COUNTDOWN_STORAGE_KEY = 'ztools:pomodoro-countdowns-v1'

export function validateCountdowns(value: unknown): CountdownItem[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 2000) throw new Error(t('errCountdownCorrupted'))
  const ids = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id || item.id.length > 160 || ids.has(item.id) ||
        typeof item.isRecurring !== 'boolean' || !Number.isSafeInteger(item.createdAt) || item.createdAt < 0 ||
        !validateCountdownInput(item).valid || !['work', 'finance', 'life'].includes(item.category)) throw new Error(t('errCountdownInvalid'))
    ids.add(item.id)
  }
  return value as CountdownItem[]
}

export async function loadCountdowns(): Promise<CountdownItem[]> {
  const current = await LocalStorage.getItem<unknown>(COUNTDOWN_STORAGE_KEY)
  if (current !== undefined) return validateCountdowns(current)
  const legacy = (globalThis as unknown as { localStorage?: { getItem(key: string): string | null } }).localStorage?.getItem(COUNTDOWN_STORAGE_KEY)
  if (!legacy) return []
  const imported = validateCountdowns(JSON.parse(legacy))
  if (await LocalStorage.compareAndSet(COUNTDOWN_STORAGE_KEY, undefined, imported)) return imported
  return validateCountdowns(await LocalStorage.getItem<unknown>(COUNTDOWN_STORAGE_KEY))
}

export async function changeCountdown(next: CountdownItem | null, expected?: CountdownItem): Promise<CountdownItem[]> {
  if (next) validateCountdowns([next])
  if (!next && !expected) throw new Error(t('errNoDeleteTarget'))
  return LocalStorage.updateItem<CountdownItem[]>(COUNTDOWN_STORAGE_KEY, value => {
    const current = validateCountdowns(value)
    if (expected) {
      const found = current.find(item => item.id === expected.id)
      if (!found || JSON.stringify(found) !== JSON.stringify(expected)) throw new Error(t('errCountdownChangedOtherWin'))
      return current.flatMap(item => item.id === expected.id ? next ? [next] : [] : [item])
    }
    if (current.length >= 2000 || current.some(item => item.id === next!.id)) throw new Error(t('errCountdownLimitOrDup'))
    return [next!, ...current]
  })
}
