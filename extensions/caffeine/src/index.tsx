import React, {
  Action, ActionPanel, Icon, List, Toast, showToast, useEffect, useMemo, useRef, useState
} from '@ztools/declarative-ui'
import {
  CAFFEINE_PRESETS, getCaffeineStatus, getDefaultInactiveStatus,
  startCaffeineSession, stopCaffeineSession, toggleCaffeineSession
} from './caffeine-service.js'
import type { CaffeineActionResult, CaffeineMode } from './types.js'

export * from './types.js'
export * from './caffeine-service.js'

export function CaffeineCommand(props: { featureCode?: string; hostOverride?: unknown } = {}) {
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
      setStatusError(result.error || '无法获取系统电源状态')
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
        title: success ? (result.status!.active ? '已开启防休眠' : '已停止防休眠') : '防休眠操作失败',
        message: success ? (result.status!.active ? result.status!.remainingText : '已释放本插件的电源保持请求') : result.error
      })
    } catch (error) {
      if (mounted.current && token === revision.current) {
        const message = error instanceof Error ? error.message : String(error)
        setStatusError(message)
        await showToast({ style: Toast.Style.Failure, title: '防休眠操作失败', message })
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
    return CAFFEINE_PRESETS.filter(p => !q || `${p.title} ${p.subtitle} ${p.minutes}`.toLowerCase().includes(q))
  }, [searchText])

  return (
    <List isLoading={isLoading} searchText={searchText} onSearchTextChange={setSearchText}
      searchBarPlaceholder="选择防休眠持续时间（回车立即生效）..."
      searchBarAccessory={
        <List.Dropdown tooltip="下一次启动的防休眠模式" value={mode} onChange={value => setMode(value as CaffeineMode)}>
          <List.Dropdown.Item title="保持屏幕常亮 + 防系统休眠" value="display" />
          <List.Dropdown.Item title="允许息屏，仅保持系统运行" value="system" />
        </List.Dropdown>
      }
      filterBar={{
        summaryText: statusError ? `状态无法确认：${statusError}` : isLoading ? '正在读取系统状态…' : status.active
          ? `已开启${status.mode === 'display' ? '屏幕常亮' : '系统保活'} · 剩余 ${status.remainingText}`
          : '未开启 · 系统按默认电源策略运行',
        actions: [
          ...(status.active ? [{ id: 'stop', title: '停止防休眠', onAction: () => perform(() => stopCaffeineSession(props.hostOverride)) }] : []),
          ...(statusError ? [{ id: 'retry', title: '重试查询', onAction: () => refresh() }] : [])
        ]
      }}>
      <List.Section title="防休眠时长" subtitle="到期或退出客户端后释放；不会阻止手动锁屏与合盖休眠">
        {filteredPresets.map(preset => (
          <List.Item key={preset.id} id={preset.id} title={preset.title} subtitle={preset.subtitle}
            icon={status.active && status.durationMinutes === preset.minutes ? Icon.CheckCircle : Icon.Clock}
            accessories={[status.active && status.durationMinutes === preset.minutes
              ? { tag: `生效中 · ${status.remainingText}` }
              : { text: preset.minutes === 0 ? '手动停止' : '到期自动停止' }]}
            actions={<ActionPanel><Action title={`开启：${preset.title}`} icon={Icon.Bolt}
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
