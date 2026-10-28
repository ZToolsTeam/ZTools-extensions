import React, { Action, ActionPanel, List, useEffect, useState } from '@ztools/declarative-ui'
import WindowsCommand, { type HostsSwitcherCommandProps } from './windows-command.js'
import MacHostsCommand from './mac-command.js'
import { hostsInvoke } from './mac-service.js'
export * from './mac-model.js'
export * from './mac-service.js'
export default function HostsCommand(props: HostsSwitcherCommandProps = {}) {
  const [platform, setPlatform] = useState(''), [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true; setError('')
    void hostsInvoke('system_get_platform', {}).then(data => {
      if (!['macos', 'windows'].includes(String(data.platform))) throw new Error('当前平台不支持域名映射')
      if (alive) setPlatform(String(data.platform))
    }).catch(e => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [attempt])
  if (platform === 'macos') return MacHostsCommand({ featureCode: props.featureCode })
  if (platform === 'windows') return WindowsCommand(props)
  return <List isShowingDetail={false} isLoading={!error}><List.Item id="platform" title={error || '正在确认系统平台'} actions={<ActionPanel><Action title="重试" onAction={() => setAttempt(attempt + 1)} /></ActionPanel>} /></List>
}
export const commands = {
  'hosts-all': () => HostsCommand(),
  'hosts-new-profile': () => HostsCommand({ featureCode: 'hosts-new-profile' }),
  'hosts-flush-dns': () => HostsCommand({ featureCode: 'hosts-flush-dns' })
}
