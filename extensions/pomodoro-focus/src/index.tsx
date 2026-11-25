import React, { Action, ActionPanel, Form, Icon, List, Toast, confirmAlert, showToast, useEffect, useLocale, useRef, useState, useNavigation } from '@ztools/declarative-ui'
import { enrichAndSortCountdowns, formatRemainingMmSs, parseCustomFocusMinutes, resolveCountdownRepeat, validateCountdownInput } from './pomodoro-service.js'
import { changeCountdown, loadCountdowns } from './countdown-storage.js'
import { focusCall, type FocusState } from './focus-host.js'
import type { CountdownCategory, CountdownItem, CountdownRepeat } from './types.js'
import { t } from './i18n.js'

export const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)

export function CountdownForm({ initialItem, onSaved }: { initialItem?: CountdownItem; onSaved?: (items: CountdownItem[]) => void } = {}) {
  useLocale()
  const { pop } = useNavigation()
  const [title, setTitle] = useState(initialItem?.title ?? '')
  const [targetDate, setTargetDate] = useState(initialItem?.targetDate ?? localDay())
  const [category, setCategory] = useState<CountdownCategory>(initialItem?.category ?? 'work')
  const [repeat, setRepeat] = useState<CountdownRepeat>(() => (initialItem ? resolveCountdownRepeat(initialItem) : 'none'))
  const [busy, setBusy] = useState(false), guard = useRef(false), alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  const submit = async () => {
    if (guard.current) return
    const validation = validateCountdownInput({ title, targetDate, category })
    if (!validation.valid) { await showToast({ style: Toast.Style.Failure, title: t('toastCannotSaveCountdown'), message: validation.error }); return }
    guard.current = true; setBusy(true)
    try {
      // 先读取并校验旧存储；读取失败时绝不按新用户覆盖。
      await loadCountdowns()
      if (!alive.current) return
      const item: CountdownItem = {
        id: initialItem?.id ?? globalThis.crypto.randomUUID(),
        title: title.trim(),
        targetDate: targetDate.trim(),
        category,
        isRecurring: repeat !== 'none',
        repeat,
        createdAt: initialItem?.createdAt ?? Date.now()
      }
      const items = await changeCountdown(item, initialItem)
      if (alive.current) { onSaved?.(items); await showToast({ style: Toast.Style.Success, title: t('toastCountdownSaved') }); pop() }
    } catch (error) { if (alive.current) await showToast({ style: Toast.Style.Failure, title: t('toastSaveFailedKept'), message: errorText(error) }) }
    finally { guard.current = false; if (alive.current) setBusy(false) }
  }
  return <Form navigationTitle={initialItem ? t('formTitleEdit') : t('formTitleNew')} isLoading={busy} actions={<ActionPanel><Action.SubmitForm title={busy ? t('btnSaving') : t('btnSaveCountdown')} onSubmit={submit} /></ActionPanel>}>
    <Form.TextField id="title" title={t('fieldTitleLabel')} value={title} onChange={setTitle} placeholder={t('fieldTitlePlaceholder')} />
    <Form.TextField id="targetDate" title={t('fieldTargetDateLabel')} value={targetDate} onChange={setTargetDate} placeholder="YYYY-MM-DD" />
    <Form.Dropdown id="category" title={t('fieldCategoryLabel')} value={category} onChange={value => setCategory(value as CountdownCategory)}>
      <Form.Dropdown.Item title={t('catWork')} value="work" /><Form.Dropdown.Item title={t('catFinance')} value="finance" /><Form.Dropdown.Item title={t('catLife')} value="life" />
    </Form.Dropdown>
    <Form.Dropdown id="repeat" title={t('fieldRecurringLabel')} value={repeat} onChange={value => setRepeat(value as CountdownRepeat)}>
      <Form.Dropdown.Item title={t('repeatNone')} value="none" />
      <Form.Dropdown.Item title={t('repeatMonthly')} value="monthly" />
      <Form.Dropdown.Item title={t('repeatYearly')} value="yearly" />
    </Form.Dropdown>
  </Form>
}

export function PomodoroFocusCommand({ startImmediately = false, newCountdown = false }: { startImmediately?: boolean; newCountdown?: boolean } = {}) {
  useLocale()
  const { push } = useNavigation()
  const [state, setState] = useState<FocusState | null>(null), [items, setItems] = useState<CountdownItem[]>([])
  const [category, setCategory] = useState('all'), [query, setQuery] = useState(''), [day, setDay] = useState(localDay())
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [startBlocked, setStartBlocked] = useState(false)
  // guard 只管用户操作；每秒轮询单独用 polling，不能让轮询占住锁把用户按键悄悄吞掉。
  // generation 在每次用户操作时递增，操作开始前发出的轮询结果迟到时丢弃，不覆盖操作回执。
  const alive = useRef(true), guard = useRef(false), ready = useRef(false), polling = useRef(false), generation = useRef(0)
  const perform = async (work: () => Promise<void>, failureTitle: string) => {
    if (guard.current) return
    guard.current = true; generation.current += 1; setBusy(true)
    try { await work() }
    catch (e) { if (alive.current) { setError(errorText(e)); await showToast({ style: Toast.Style.Failure, title: failureTitle, message: errorText(e) }) } }
    finally { guard.current = false; if (alive.current) setBusy(false) }
  }
  const refresh = async (autoStart = false) => perform(async () => {
    const [current, countdowns] = await Promise.all([focusCall('focus_get_current'), loadCountdowns()])
    let next = current
    const occupied = ['running', 'paused'].includes(current?.status ?? '')
    if (autoStart && !occupied) next = await focusCall('focus_start', { mode: 'pomodoro', title: t('focusDefaultTitle') })
    if (alive.current) { setState(next); setItems(countdowns); setError(''); setLoaded(true); ready.current = true; setStartBlocked(autoStart && occupied) }
    // “立即开始专注”被已有计时挡住时如实说明，不能静默无反应。
    if (alive.current && autoStart && occupied && current) {
      const breaking = current.phase !== 'focus'
      await showToast({
        style: Toast.Style.Failure,
        title: breaking
          ? t('toastBreakingBlocked', { kind: current.phase === 'long_break' ? t('toastBreakingPrefixLong') : t('toastBreakingPrefixShort') })
          : t('toastFocusBlocked', { status: current.status === 'paused' ? t('toastPausedWord') : t('toastRunningWord') }),
        message: breaking ? t('toastSkipBreakHint') : undefined
      })
    }
  }, t('errLoadPomodoro'))
  useEffect(() => {
    void refresh(startImmediately).then(() => {
      if (alive.current && ready.current && newCountdown) push(<CountdownForm onSaved={setItems} />)
    })
    const timer = setInterval(() => {
      if (!alive.current || !ready.current || guard.current || polling.current) return
      polling.current = true
      const issued = generation.current
      const fresh = () => alive.current && !guard.current && issued === generation.current
      void focusCall('focus_get_current').then(next => { if (fresh()) { setState(next); setDay(localDay()) } })
        .catch(e => { if (fresh()) setError(t('errPollTimerFailed', { error: errorText(e) })) })
        .finally(() => { polling.current = false })
    }, 1000)
    return () => { alive.current = false; clearInterval(timer) }
  }, [])
  const timerAction = (method: string, params: Record<string, unknown> = {}) => perform(async () => {
    const next = await focusCall(method, params)
    if (alive.current) { setState(next); setError(''); setStartBlocked(false) }
  }, t('errActionUnconfirmed'))
  // 先取消休息再开始专注；取消成功、开始失败时界面停在已取消状态并提示失败，不假装已开始。
  const skipBreakAndFocus = () => perform(async () => {
    const cancelled = await focusCall('focus_cancel')
    if (!alive.current) return
    setState(cancelled); setStartBlocked(false)
    const next = await focusCall('focus_start', { mode: 'pomodoro', title: t('focusDefaultTitle') })
    if (alive.current) { setState(next); setError('') }
  }, t('errStartFocusFailed'))
  const active = state?.status === 'running' || state?.status === 'paused'
  const paused = state?.status === 'paused'
  const phase = state?.phase === 'short_break' ? t('phaseShortBreak') : state?.phase === 'long_break' ? t('phaseLongBreak') : t('phaseFocus')
  const primary = active ? paused ? t('actionResumePhase', { phase }) : t('actionPausePhase', { phase }) : t('actionStartFocus25')
  const breaking = active && state?.phase !== 'focus'
  const primaryAction = <Action title={primary} onAction={() => timerAction(active ? paused ? 'focus_resume' : 'focus_pause' : 'focus_start', active ? {} : { mode: 'pomodoro', title: t('focusDefaultTitle') })} />
  const skipAction = breaking ? <Action title={t('actionSkipBreakFocus')} icon={Icon.Play} onAction={skipBreakAndFocus} /> : null
  const customFocusMinutes = parseCustomFocusMinutes(query)
  const startCustomFocus = (minutes: number) =>
    timerAction('focus_start', { mode: 'single', durationMinutes: minutes, title: t('customFocusSessionTitle', { minutes }) })
  const rows = enrichAndSortCountdowns(items, day).filter(item => (category === 'all' || item.category === category) && `${item.title} ${item.targetDate}`.toLowerCase().includes(query.trim().toLowerCase()))
  const remove = (item: CountdownItem) => perform(async () => {
    if (!await confirmAlert({ title: t('confirmDeleteTitle', { title: item.title }), primaryAction: { title: t('confirmDeletePrimary'), style: 'destructive' } })) return
    if (!alive.current) return
    const next = await changeCountdown(null, item)
    if (alive.current) setItems(next)
  }, t('errDeleteFailedKept'))
  return <List navigationTitle={t('navTitle')} isShowingDetail={false} isLoading={!loaded && !error || busy} searchText={query} onSearchTextChange={setQuery} searchBarPlaceholder={t('searchPlaceholder')}
    searchBarAccessory={<List.Dropdown value={category} onChange={setCategory}><List.Dropdown.Item title={t('filterAll')} value="all" /><List.Dropdown.Item title={t('catWork')} value="work" /><List.Dropdown.Item title={t('catFinance')} value="finance" /><List.Dropdown.Item title={t('catLife')} value="life" /></List.Dropdown>}
    filterBar={{ summaryText: error || t('summaryBar', { count: rows.length }), actions: [{ id: 'refresh', title: t('btnRefresh'), onAction: () => refresh() }, { id: 'new', title: t('btnNewCountdown'), onAction: () => push(<CountdownForm onSaved={setItems} />) }] }}>
    {error ? <List.Item id="load-error" title={t('loadErrorTitle')} subtitle={error} icon={Icon.ExclamationMark} actions={<ActionPanel><Action title={t('actionReload')} onAction={() => refresh()} /></ActionPanel>} /> : loaded ? <>
      {customFocusMinutes !== null && (
        <List.Item
          id="pomodoro-custom-focus"
          title={t('customFocusTitle', { minutes: customFocusMinutes })}
          subtitle={active ? t('customFocusBusySubtitle') : t('customFocusSubtitle')}
          icon={Icon.Clock}
          accessories={[{ text: formatRemainingMmSs(customFocusMinutes * 60_000) }]}
          actions={
            <ActionPanel>
              <Action
                title={t('customFocusAction', { minutes: customFocusMinutes })}
                icon={Icon.Play}
                onAction={() => startCustomFocus(customFocusMinutes)}
              />
            </ActionPanel>
          }
        />
      )}
      <List.Item id="pomodoro-timer" title={active ? (paused ? t('timerStatePaused', { phase }) : t('timerStateRunning', { phase })) : t('timerReadyTitle')} subtitle={t('timerCyclesSubtitle', { cycles: state?.completedCycles ?? 0, warning: state?.notificationWarning ? ` · ${state.notificationWarning}` : '' })} icon={active && !paused ? Icon.Clock : Icon.Play}
        accessories={[{ text: formatRemainingMmSs(active ? state!.remainingMs : 25 * 60_000) }]} actions={<ActionPanel>
          {startBlocked && skipAction}
          {primaryAction}
          {!startBlocked && skipAction}
          {active && <Action title={t('actionCancelTimer')} icon={Icon.Stop} onAction={() => timerAction('focus_cancel')} />}
        </ActionPanel>} />
      {rows.map(item => { const original = items.find(value => value.id === item.id)!; return <List.Item key={item.id} id={item.id} title={item.title} subtitle={item.targetDateFormatted} icon={Icon.Calendar} accessories={[{ text: item.daysLeftText }]} actions={<ActionPanel>
        <Action title={t('actionEditCountdown')} onAction={() => push(<CountdownForm initialItem={original} onSaved={setItems} />)} />
        <Action.CopyToClipboard title={t('actionCopySummary')} content={t('copySummaryContent', { title: item.title, daysLeftText: item.daysLeftText, targetDateFormatted: item.targetDateFormatted })} />
        <Action title={t('actionDeleteCountdown')} style={Action.Style.Destructive} onAction={() => remove(original)} />
      </ActionPanel>} /> })}
      {!rows.length && customFocusMinutes === null && <List.Item id="empty-countdowns" title={items.length ? t('emptyNoMatch') : t('emptyNoCountdowns')} subtitle={t('emptySubtitle')} />}
    </> : null}
  </List>
}
export const commands = { 'pomodoro-main': PomodoroFocusCommand, 'pomodoro-start': () => PomodoroFocusCommand({ startImmediately: true }), 'pomodoro-new-countdown': () => PomodoroFocusCommand({ newCountdown: true }) }
export default PomodoroFocusCommand
