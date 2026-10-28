import React, { Action, ActionPanel, List, useEffect, useState } from '@ztools/declarative-ui'
import WindowsCommand from './windows-command.js'
import MacCommand from './mac-command.js'
import { startupInvoke } from './mac-service.js'
export default function StartupManagerCommand(props: { featureCode?: string; hostOverride?: unknown } = {}) {
  const [platform, setPlatform] = useState(''), [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true; setError('')
    void startupInvoke('system_get_platform', {}).then(data => {
      if (typeof data.platform !== 'string' || !['macos', 'windows'].includes(data.platform)) throw new Error('当前系统不支持启动管理')
      if (alive) setPlatform(data.platform)
    }).catch(e => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [attempt])
  if (platform === 'macos') return MacCommand({ featureCode: props.featureCode })
  if (platform === 'windows') return WindowsCommand(props)
  return <List isShowingDetail={false} isLoading={!error}><List.Item id="platform" title={error || '正在确认系统平台'} actions={<ActionPanel><Action title="重试" onAction={() => setAttempt(attempt + 1)} /></ActionPanel>} /></List>
}
export const commands = {
  'startup-all': () => StartupManagerCommand(),
  'startup-services': () => StartupManagerCommand({ featureCode: 'startup-services' }),
  'startup-tasks': () => StartupManagerCommand({ featureCode: 'startup-tasks' })
}
