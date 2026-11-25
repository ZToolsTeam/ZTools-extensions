import React, { Action, ActionPanel, Form, Icon, List, Toast, showToast, useEffect, useLocale, useNavigation, useRef, useState } from '@ztools/declarative-ui'
import { CLEAN_DURATION_PRESETS, createLockOperationId, formatCleanDuration, keyboardLock, unlockReasons } from './keyboard-lock-service.js'
import type { KeyboardLockState } from './types.js'
import { t } from './i18n.js'
export * from './keyboard-lock-service.js'
export * from './types.js'

function CustomDurationForm({ start }: { start: (seconds: number) => Promise<boolean> }) {
  useLocale()
  const { pop } = useNavigation()
  return <Form navigationTitle={t('customFormTitle')} actions={<ActionPanel><Action.SubmitForm title={t('startCleanAction')} onSubmit={async values => {
    if (await start(Number(values.seconds))) pop()
  }} /></ActionPanel>}>
    <Form.TextField id="seconds" title={t('durationFieldTitle')} defaultValue="45" placeholder={t('durationPlaceholder')} />
  </Form>
}
export function CleanKeyboardCommand() {
  useLocale()
  const [state, setState] = useState<KeyboardLockState | null>(null), [error, setError] = useState('')
  const [busy, setBusy] = useState(false), [pointer, setPointer] = useState(false)
  const id = useRef(createLockOperationId()), alive = useRef(true), changing = useRef(false)
  const revision = useRef(0), refreshing = useRef<number | null>(null)
  const refresh = async () => {
    const current = revision.current
    if (changing.current || refreshing.current === current) return
    refreshing.current = current
    try {
      const next = await keyboardLock({ action: 'status', operationId: id.current })
      if (alive.current && revision.current === current) { setState(next); setError('') }
    } catch (failure) { if (alive.current && revision.current === current) setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { if (refreshing.current === current) refreshing.current = null }
  }
  useEffect(() => {
    alive.current = true; void refresh()
    return () => {
      alive.current = false; revision.current++
      void keyboardLock({ action: 'unlock', operationId: id.current }).catch(failure => console.warn(t('warnUnlockUnconfirmed'), failure))
    }
  }, [])
  useEffect(() => {
    if (state?.status !== 'locked') return
    const timer = setInterval(() => { void refresh() }, 500)
    return () => clearInterval(timer)
  }, [state?.status])
  const change = async (seconds?: number): Promise<boolean> => {
    if (changing.current) return false
    if (seconds !== undefined && (!Number.isInteger(seconds) || seconds < 5 || seconds > 300)) {
      await showToast(Toast.Style.Failure, t('invalidDurationTitle'), t('invalidDurationMessage')); return false
    }
    changing.current = true; revision.current++; setBusy(true)
    try {
      const next = await keyboardLock(seconds === undefined ? { action: 'unlock', operationId: id.current } :
        { action: 'start', operationId: id.current, durationSeconds: seconds, lockPointer: pointer })
      if (!alive.current) {
        await keyboardLock({ action: 'unlock', operationId: id.current }); return false
      }
      if (seconds !== undefined && next.status !== 'locked') throw new Error(t('lockNotConfirmed'))
      setState(next); setError(''); return true
    } catch (failure) {
      if (alive.current) { const message = failure instanceof Error ? failure.message : String(failure); setError(message); await showToast(Toast.Style.Failure, t('lockFailedTitle'), message) }
      return false
    } finally { changing.current = false; if (alive.current) setBusy(false) }
  }
  const locked = state?.status === 'locked'
  return <List navigationTitle={t('navTitle')} isShowingDetail={false} isLoading={busy}
    searchBarPlaceholder={t('searchPlaceholder')}
    searchBarAccessory={!locked ? <List.Dropdown value={pointer ? 'all' : 'keyboard'} onChange={value => setPointer(value === 'all')}>
      <List.Dropdown.Item value="keyboard" title={t('modeKeyboardOnly')} /><List.Dropdown.Item value="all" title={t('modeKeyboardAndPointer')} />
    </List.Dropdown> : undefined}
    filterBar={{ summaryText: error ? t('summaryUnconfirmed', { error }) : locked ? t('summaryLocked', { seconds: state.remainingSeconds }) : state?.reason ? unlockReasons[state.reason] || t('summaryExitedFallback') : t('summaryDefault') }}>
    {locked ? <List.Item id="active" icon={Icon.Lock} title={error ? t('activeUnconfirmedTitle') : state.lockPointer ? t('activeBothLockedTitle') : t('activeKeyboardLockedTitle')}
      subtitle={t('activeSubtitle')} accessories={error ? [] : [{ text: t('blockedEventsAcc', { count: state.blockedEvents }) }]}
      actions={<ActionPanel><Action title={t('unlockNowAction')} icon={Icon.Unlock} onAction={async () => { await change() }} /></ActionPanel>} /> :
      state ? <>{CLEAN_DURATION_PRESETS.map(seconds => <List.Item key={seconds} id={`duration-${seconds}`} icon={Icon.Clock} title={t('cleanPresetTitle', { duration: formatCleanDuration(seconds) })}
        subtitle={pointer ? t('presetSubtitleBoth') : t('presetSubtitleKeyboard')}
        actions={<ActionPanel><Action title={t('startCleanAction')} icon={Icon.Lock} onAction={async () => { await change(seconds) }} />
          <Action.Push title={t('customDurationAction')} target={<CustomDurationForm start={change} />} shortcut={{ modifiers: ['cmd'], key: 'enter' }} />
        </ActionPanel>} />)}</> : <List.Item id="unavailable" icon={Icon.Info} title={error ? t('unavailableErrorTitle') : t('checkingTitle')} subtitle={error || t('connectingSubtitle')}
        actions={<ActionPanel><Action title={t('recheckAction')} onAction={refresh} /></ActionPanel>} />}
  </List>
}
export const commands = { 'clean-keyboard': CleanKeyboardCommand }
export default CleanKeyboardCommand
