import React, { Action, ActionPanel, Form, Icon, List, Toast, confirmAlert, showToast, useEffect, useRef, useState, useNavigation } from '@ztools/declarative-ui'
import { enrichAndSortCountdowns, formatRemainingMmSs, validateCountdownInput } from './pomodoro-service.js'
import { changeCountdown, loadCountdowns } from './countdown-storage.js'
import { focusCall, type FocusState } from './focus-host.js'
import type { CountdownCategory, CountdownItem } from './types.js'

export const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)

export function CountdownForm({ initialItem, onSaved }: { initialItem?: CountdownItem; onSaved?: (items: CountdownItem[]) => void } = {}) {
  const { pop } = useNavigation()
  const [title, setTitle] = useState(initialItem?.title ?? '')
  const [targetDate, setTargetDate] = useState(initialItem?.targetDate ?? localDay())
  const [category, setCategory] = useState<CountdownCategory>(initialItem?.category ?? 'work')
  const [isRecurring, setRecurring] = useState(initialItem?.isRecurring ?? false)
  const [busy, setBusy] = useState(false), guard = useRef(false), alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  const submit = async () => {
    if (guard.current) return
    const validation = validateCountdownInput({ title, targetDate, category })
    if (!validation.valid) { await showToast({ style: Toast.Style.Failure, title: '无法保存倒数日', message: validation.error }); return }
    guard.current = true; setBusy(true)
    try {
      // 先读取并校验旧存储；读取失败时绝不按新用户覆盖。
      await loadCountdowns()
      if (!alive.current) return
      const item: CountdownItem = { id: initialItem?.id ?? globalThis.crypto.randomUUID(), title: title.trim(), targetDate: targetDate.trim(), category, isRecurring, createdAt: initialItem?.createdAt ?? Date.now() }
      const items = await changeCountdown(item, initialItem)
      if (alive.current) { onSaved?.(items); await showToast({ style: Toast.Style.Success, title: '倒数日已保存' }); pop() }
    } catch (error) { if (alive.current) await showToast({ style: Toast.Style.Failure, title: '保存失败，原数据已保留', message: errorText(error) }) }
    finally { guard.current = false; if (alive.current) setBusy(false) }
  }
  return <Form navigationTitle={initialItem ? '编辑倒数日' : '新建倒数日'} isLoading={busy} actions={<ActionPanel><Action.SubmitForm title={busy ? '正在保存' : '保存倒数日'} onSubmit={submit} /></ActionPanel>}>
    <Form.TextField id="title" title="日程名称" value={title} onChange={setTitle} placeholder="例如：项目上线" />
    <Form.TextField id="targetDate" title="目标日期 (YYYY-MM-DD)" value={targetDate} onChange={setTargetDate} placeholder="YYYY-MM-DD" />
    <Form.Dropdown id="category" title="日程分类" value={category} onChange={value => setCategory(value as CountdownCategory)}>
      <Form.Dropdown.Item title="工作" value="work" /><Form.Dropdown.Item title="财务" value="finance" /><Form.Dropdown.Item title="生活" value="life" />
    </Form.Dropdown>
    <Form.Checkbox id="isRecurring" title="重复" label="每月按此日期循环（月末自动适配）" value={isRecurring} onChange={setRecurring} />
  </Form>
}

export function PomodoroFocusCommand({ startImmediately = false, newCountdown = false }: { startImmediately?: boolean; newCountdown?: boolean } = {}) {
  const { push } = useNavigation()
  const [state, setState] = useState<FocusState | null>(null), [items, setItems] = useState<CountdownItem[]>([])
  const [category, setCategory] = useState('all'), [query, setQuery] = useState(''), [day, setDay] = useState(localDay())
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const alive = useRef(true), guard = useRef(false), ready = useRef(false)
  const perform = async (work: () => Promise<void>, failureTitle: string) => {
    if (guard.current) return
    guard.current = true; setBusy(true)
    try { await work() }
    catch (e) { if (alive.current) { setError(errorText(e)); await showToast({ style: Toast.Style.Failure, title: failureTitle, message: errorText(e) }) } }
    finally { guard.current = false; if (alive.current) setBusy(false) }
  }
  const refresh = async (autoStart = false) => perform(async () => {
    const [current, countdowns] = await Promise.all([focusCall('focus_get_current'), loadCountdowns()])
    let next = current
    if (autoStart && !['running', 'paused'].includes(current?.status ?? '')) next = await focusCall('focus_start', { mode: 'pomodoro', title: '25 分钟深度专注' })
    if (alive.current) { setState(next); setItems(countdowns); setError(''); setLoaded(true); ready.current = true }
  }, '无法读取番茄钟，请重试')
  useEffect(() => {
    void refresh(startImmediately).then(() => {
      if (alive.current && ready.current && newCountdown) push(<CountdownForm onSaved={setItems} />)
    })
    const timer = setInterval(() => {
      if (!alive.current || !ready.current || guard.current) return
      guard.current = true
      void focusCall('focus_get_current').then(next => { if (alive.current) { setState(next); setDay(localDay()) } })
        .catch(e => { if (alive.current) setError(`计时状态读取失败，请刷新：${errorText(e)}`) })
        .finally(() => { guard.current = false })
    }, 1000)
    return () => { alive.current = false; clearInterval(timer) }
  }, [])
  const timerAction = (method: string, params: Record<string, unknown> = {}) => perform(async () => {
    const next = await focusCall(method, params)
    if (alive.current) { setState(next); setError('') }
  }, '操作未确认，请刷新状态')
  const active = state?.status === 'running' || state?.status === 'paused'
  const paused = state?.status === 'paused'
  const phase = state?.phase === 'short_break' ? '短休息' : state?.phase === 'long_break' ? '长休息' : '专注'
  const primary = active ? paused ? `继续${phase}` : `暂停${phase}` : '开始 25 分钟专注'
  const rows = enrichAndSortCountdowns(items, day).filter(item => (category === 'all' || item.category === category) && `${item.title} ${item.targetDate}`.toLowerCase().includes(query.trim().toLowerCase()))
  const remove = (item: CountdownItem) => perform(async () => {
    if (!await confirmAlert({ title: `删除倒数日“${item.title}”？`, primaryAction: { title: '删除', style: 'destructive' } })) return
    if (!alive.current) return
    const next = await changeCountdown(null, item)
    if (alive.current) setItems(next)
  }, '删除失败，原数据已保留')
  return <List navigationTitle="番茄倒数" isShowingDetail={false} isLoading={!loaded && !error || busy} searchText={query} onSearchTextChange={setQuery} searchBarPlaceholder="搜索倒数日名称或日期"
    searchBarAccessory={<List.Dropdown value={category} onChange={setCategory}><List.Dropdown.Item title="全部倒数日" value="all" /><List.Dropdown.Item title="工作" value="work" /><List.Dropdown.Item title="财务" value="finance" /><List.Dropdown.Item title="生活" value="life" /></List.Dropdown>}
    filterBar={{ summaryText: error || `${rows.length} 个倒数日 · 计时在离开页面后继续`, actions: [{ id: 'refresh', title: '刷新', onAction: () => refresh() }, { id: 'new', title: '新建倒数日', onAction: () => push(<CountdownForm onSaved={setItems} />) }] }}>
    {error ? <List.Item id="load-error" title="无法确认当前状态" subtitle={error} icon={Icon.ExclamationMark} actions={<ActionPanel><Action title="重新读取" onAction={() => refresh()} /></ActionPanel>} /> : loaded ? <>
      <List.Item id="pomodoro-timer" title={active ? `${phase}${paused ? '已暂停' : '进行中'}` : '番茄钟已就绪'} subtitle={`累计完成 ${state?.completedCycles ?? 0} 轮番茄${state?.notificationWarning ? ` · ${state.notificationWarning}` : ''}`} icon={active && !paused ? Icon.Clock : Icon.Play}
        accessories={[{ text: formatRemainingMmSs(active ? state!.remainingMs : 25 * 60_000) }]} actions={<ActionPanel>
          <Action title={primary} onAction={() => timerAction(active ? paused ? 'focus_resume' : 'focus_pause' : 'focus_start', active ? {} : { mode: 'pomodoro', title: '25 分钟深度专注' })} />
          {active && <Action title="取消当前计时" icon={Icon.Stop} onAction={() => timerAction('focus_cancel')} />}
        </ActionPanel>} />
      {rows.map(item => { const original = items.find(value => value.id === item.id)!; return <List.Item key={item.id} id={item.id} title={item.title} subtitle={item.targetDateFormatted} icon={Icon.Calendar} accessories={[{ text: item.daysLeftText }]} actions={<ActionPanel>
        <Action title="编辑倒数日" onAction={() => push(<CountdownForm initialItem={original} onSaved={setItems} />)} />
        <Action.CopyToClipboard title="复制天数摘要" content={`${item.title}：${item.daysLeftText}（${item.targetDateFormatted}）`} />
        <Action title="删除倒数日" style={Action.Style.Destructive} onAction={() => remove(original)} />
      </ActionPanel>} /> })}
      {!rows.length && <List.Item id="empty-countdowns" title={items.length ? '没有匹配的倒数日' : '还没有倒数日'} subtitle="使用上方“新建倒数日”添加自己的日程" />}
    </> : null}
  </List>
}
export const commands = { 'pomodoro-main': PomodoroFocusCommand, 'pomodoro-start': () => PomodoroFocusCommand({ startImmediately: true }), 'pomodoro-new-countdown': () => PomodoroFocusCommand({ newCountdown: true }) }
export default PomodoroFocusCommand
