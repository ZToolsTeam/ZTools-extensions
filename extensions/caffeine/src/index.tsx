import React, {
  Action, ActionPanel, Icon, List, Toast, showToast, useEffect, useLocale, useMemo, useRef, useState
} from '@ztools/declarative-ui'
import {
  formatRemainingDuration, getCaffeinePresets, getCaffeineStatus, getDefaultInactiveStatus,
  startCaffeineSession, stopCaffeineSession, toggleCaffeineSession
} from './caffeine-service.js'
import type { CaffeineActionResult, CaffeineMode } from './types.js'
import { t } from './i18n.js'

export * from './types.js'
export * from './caffeine-service.js'

export function CaffeineCommand(props: { featureCode?: string; hostOverride?: unknown } = {}) {
  const locale = useLocale()
  const [mode, setMode] = useState<CaffeineMode>('display')
  const [status, setStatus] = useState(() => getDefaultInactiveStatus())
  const [statusError, setStatusError] = useState('')
  const [searchText, setSearchText] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const mounted = useRef(false)
  const operationRunning = useRef(false)
  const queryRunning = useRef(false)
  const revision = useRef(0)

  const applyResult = (result: CaffeineActionResult, updateMode = false) => {
    if (!result.ok || !result.status) {
      setStatusError(result.error || t('statusUnavailable'))
      return false
    }
    setStatusError('')
    setStatus(result.status)
    if (updateMode) setMode(result.status.mode)
    return true
  }

  const refresh = async (initial = false) => {
    if (operationRunning.current || queryRunning.current) return
    queryRunning.current = true
    const token = revision.current
    try {
      const result = await getCaffeineStatus(props.hostOverride)
      if (mounted.current && token === revision.current) applyResult(result, initial)
    } catch (error) {
      if (mounted.current && token === revision.current) setStatusError(error instanceof Error ? error.message : String(error))
    } finally {
      queryRunning.current = false
      if (mounted.current && token === revision.current) setIsLoading(false)
    }
  }

  const perform = async (request: () => Promise<CaffeineActionResult>) => {
    if (operationRunning.current) return
    operationRunning.current = true
    const token = ++revision.current
    setIsLoading(true)
    try {
      const result = await request()
      if (!mounted.current || token !== revision.current) return
      const success = applyResult(result, true)
      await showToast({
        style: success ? Toast.Style.Success : Toast.Style.Failure,
        title: success ? (result.status!.active ? t('toastStarted') : t('toastStopped')) : t('toastFailed'),
        message: success ? (result.status!.active ? result.status!.remainingText : t('toastReleased')) : result.error
      })
    } catch (error) {
      if (mounted.current && token === revision.current) {
        const message = error instanceof Error ? error.message : String(error)
        setStatusError(message)
        await showToast({ style: Toast.Style.Failure, title: t('toastFailed'), message })
      }
    } finally {
      operationRunning.current = false
      if (mounted.current && token === revision.current) setIsLoading(false)
    }
  }

  useEffect(() => {
    mounted.current = true
    if (props.featureCode === 'caffeine-toggle') void perform(() => toggleCaffeineSession(mode, props.hostOverride))
    else void refresh(true)
    return () => { mounted.current = false; revision.current += 1 }
  }, [props.featureCode, props.hostOverride])

  // 仅轮询状态；到期释放由主进程负责，离开页面和隐藏窗口不影响倒计时。
  useEffect(() => {
    if (!status.active) return
    const timer = setInterval(() => { void refresh() }, 1000)
    return () => clearInterval(timer)
  }, [status.active, props.hostOverride])

  const filteredPresets = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    return getCaffeinePresets().filter(p => !q || `${p.title} ${p.subtitle} ${p.minutes}`.toLowerCase().includes(q))
  }, [searchText, locale])

  const remainingText = formatRemainingDuration(status.active, status.durationMinutes, status.remainingMs)

  // 生效中的那一档在列表里可见时，它的主动作就是“停止防休眠”，顶部不再重复；被搜索过滤掉时才在顶部提供
  const activePresetVisible = status.active && filteredPresets.some(p => p.minutes === status.durationMinutes)

  return (
    <List isLoading={isLoading} searchText={searchText} onSearchTextChange={setSearchText}
      searchBarPlaceholder={t('searchPlaceholder')}
      searchBarAccessory={
        <List.Dropdown tooltip={t('modeTooltip')} value={mode} onChange={value => setMode(value as CaffeineMode)}>
          <List.Dropdown.Item title={t('modeDisplay')} value="display" />
          <List.Dropdown.Item title={t('modeSystem')} value="system" />
        </List.Dropdown>
      }
      filterBar={{
        summaryText: statusError ? t('summaryError', { error: statusError }) : isLoading ? t('summaryLoading') : status.active
          ? t('summaryActive', {
              mode: status.mode === 'display' ? t('summaryModeDisplay') : t('summaryModeSystem'),
              remaining: status.durationMinutes === 0 || status.remainingMs === null ? remainingText : t('summaryRemaining', { text: remainingText })
            })
          : t('summaryInactive'),
        actions: [
          ...(status.active && !activePresetVisible ? [{ id: 'stop', title: t('stopAction'), onAction: () => perform(() => stopCaffeineSession(props.hostOverride)) }] : []),
          ...(statusError ? [{ id: 'retry', title: t('retryAction'), onAction: () => refresh() }] : [])
        ]
      }}>
      <List.Section title={t('sectionTitle')} subtitle={t('sectionSubtitle')}>
        {filteredPresets.map(preset => (
          <List.Item key={preset.id} id={preset.id} title={preset.title} subtitle={preset.subtitle}
            icon={status.active && status.durationMinutes === preset.minutes ? Icon.CheckCircle : Icon.Clock}
            // 剩余时间只在顶部状态栏显示一次；未生效的时长项不加重复的说明标签
            accessories={status.active && status.durationMinutes === preset.minutes ? [{ tag: t('activeTag') }] : []}
            actions={status.active && status.durationMinutes === preset.minutes
              // 正在生效的这一项：回车停止，而不是重复开启同一档
              ? <ActionPanel><Action title={t('stopAction')} icon={Icon.Stop}
                onAction={() => perform(() => stopCaffeineSession(props.hostOverride))} /></ActionPanel>
              // 各档时长由条目标题区分，动作名保持简短，避免在底部操作栏被截断
              : <ActionPanel><Action title={status.active ? t('switchDurationAction') : t('startAction')} icon={Icon.Bolt}
                onAction={() => perform(() => startCaffeineSession(preset.minutes, mode, props.hostOverride))} /></ActionPanel>}
          />
        ))}
      </List.Section>
    </List>
  )
}

export const commands = {
  'caffeine-panel': () => <CaffeineCommand />,
  'caffeine-toggle': () => <CaffeineCommand featureCode="caffeine-toggle" />
}
export default CaffeineCommand
