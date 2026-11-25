import React, { Action, ActionPanel, List, useEffect, useLocale, useState } from '@ztools/declarative-ui'
import MacCommand from './mac-command.js'
import { monitorInvoke } from './mac-service.js'
import { t } from './i18n.js'

export default function MonitorCommand(props: { featureCode?: string; hostOverride?: unknown } = {}) {
  useLocale()
  const [platform, setPlatform] = useState(''), [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true; setError('')
    void monitorInvoke('system_get_platform', {}).then(data => {
      if (data.platform !== 'macos' && data.platform !== 'windows') throw new Error(t('errPlatformUnsupported'))
      if (alive) setPlatform(data.platform)
    }).catch(e => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [attempt])
  // macOS 与 Windows 共用主进程的显示器接口：逐屏读取真实状态，调节后读回核验
  if (platform === 'macos' || platform === 'windows') return MacCommand()
  return <List isLoading={!error} isShowingDetail={false}><List.Item id="platform" title={error || t('checkingPlatform')} actions={<ActionPanel><Action title={t('retryAction')} onAction={() => setAttempt(attempt + 1)} /></ActionPanel>} /></List>
}
let sleepPending = false
export async function SleepMonitorsCommand() {
  if (sleepPending) throw new Error(t('errSleepPending'))
  sleepPending = true
  try {
    const data = await monitorInvoke('system_get_platform', {})
    if (data.platform === 'macos' || data.platform === 'windows') { const result = await monitorInvoke('monitor_control', { action: 'sleep' }); if (result.requested !== true) throw new Error(t('errSleepUnconfirmed')) }
    else throw new Error(t('errSleepUnsupported'))
    return t('sleepRequestedMsg')
  } finally { sleepPending = false }
}
export const commands = { 'monitor-brightness': MonitorCommand, 'monitor-sleep': SleepMonitorsCommand }
