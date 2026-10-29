import React, { Action, ActionPanel, Form, Icon, List, Toast, showToast, useEffect, useNavigation, useRef, useState } from '@ztools/declarative-ui'
import { CLEAN_DURATION_PRESETS, createLockOperationId, formatCleanDuration, keyboardLock, unlockReasons } from './keyboard-lock-service.js'
import type { KeyboardLockState } from './types.js'
export * from './keyboard-lock-service.js'
export * from './types.js'

function CustomDurationForm({ start }: { start: (seconds: number) => Promise<boolean> }) {
  const { pop } = useNavigation()
  return <Form navigationTitle="自定义清洁时长" actions={<ActionPanel><Action.SubmitForm title="开始清洁" onSubmit={async values => {
    if (await start(Number(values.seconds))) pop()
  }} /></ActionPanel>}>
    <Form.TextField id="seconds" title="时长（5～300 秒）" defaultValue="45" placeholder="输入整数秒数" />
  </Form>
}
export function CleanKeyboardCommand() {
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
      void keyboardLock({ action: 'unlock', operationId: id.current }).catch(failure => console.warn('解除清洁锁未获确认，独立进程将按租约自动退出', failure))
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
      await showToast(Toast.Style.Failure, '时长无效', '请输入 5～300 秒的整数'); return false
    }
    changing.current = true; revision.current++; setBusy(true)
    try {
      const next = await keyboardLock(seconds === undefined ? { action: 'unlock', operationId: id.current } :
        { action: 'start', operationId: id.current, durationSeconds: seconds, lockPointer: pointer })
      if (!alive.current) {
        await keyboardLock({ action: 'unlock', operationId: id.current }); return false
      }
      if (seconds !== undefined && next.status !== 'locked') throw new Error('系统未确认锁定，请勿开始清洁')
      setState(next); setError(''); return true
    } catch (failure) {
      if (alive.current) { const message = failure instanceof Error ? failure.message : String(failure); setError(message); await showToast(Toast.Style.Failure, '输入锁操作失败', message) }
      return false
    } finally { changing.current = false; if (alive.current) setBusy(false) }
  }
  const locked = state?.status === 'locked'
  return <List navigationTitle="键盘清洁锁" isShowingDetail={false} isLoading={busy}
    searchBarPlaceholder="选择清洁时长，⌘+U 或 Control+U 紧急解除"
    searchBarAccessory={!locked ? <List.Dropdown value={pointer ? 'all' : 'keyboard'} onChange={value => setPointer(value === 'all')}>
      <List.Dropdown.Item value="keyboard" title="仅键盘" /><List.Dropdown.Item value="all" title="键盘与鼠标" />
    </List.Dropdown> : undefined}
    filterBar={{ summaryText: error ? `状态未确认：${error}` : locked ? `系统输入锁已启用 · 剩余 ${state.remainingSeconds} 秒` : state?.reason ? unlockReasons[state.reason] || '输入锁已退出' : '最长 5 分钟；电源键、Touch ID、系统保留按键与部分手势不在保护范围' }}>
    {locked ? <List.Item id="active" icon={Icon.Lock} title={error ? '锁定状态未确认，请勿开始清洁' : state.lockPointer ? '键盘与鼠标已锁定' : '键盘已锁定'}
      subtitle="⌘+U 或 Control+U 立即解除；到时或离开插件自动解除" accessories={error ? [] : [{ text: `${state.blockedEvents} 次拦截` }]}
      actions={<ActionPanel><Action title="立即解除" icon={Icon.Unlock} onAction={async () => { await change() }} /></ActionPanel>} /> :
      state ? <>{CLEAN_DURATION_PRESETS.map(seconds => <List.Item key={seconds} id={`duration-${seconds}`} icon={Icon.Clock} title={`清洁 ${formatCleanDuration(seconds)}`}
        subtitle={pointer ? '暂时拦截键盘、鼠标点击与滚动；使用紧急快捷键解除' : '暂时拦截键盘输入；鼠标可用于点击“立即解除”'}
        actions={<ActionPanel><Action title="开始清洁" icon={Icon.Lock} onAction={async () => { await change(seconds) }} />
          <Action.Push title="自定义时长" target={<CustomDurationForm start={change} />} shortcut={{ modifiers: ['cmd'], key: 'enter' }} />
        </ActionPanel>} />)}</> : <List.Item id="unavailable" icon={Icon.Info} title={error ? '无法连接系统输入锁' : '正在检查输入锁状态'} subtitle={error || '正在连接客户端'}
        actions={<ActionPanel><Action title="重新检查" onAction={refresh} /></ActionPanel>} />}
  </List>
}
export const commands = { 'clean-keyboard': CleanKeyboardCommand }
export default CleanKeyboardCommand
