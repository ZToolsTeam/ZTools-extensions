import React, { Action, ActionPanel, List, useEffect, useState } from '@ztools/declarative-ui'
import WindowsFileUnlockCommand from './windows-command.js'
import MacFileUnlockCommand from './mac-command.js'
import { unlockInvoke } from './mac-service.js'
export { MacFileUnlockCommand, WindowsFileUnlockCommand }
export * from './mac-service.js'
export default function FileUnlockCommand(props: { initialPath?: string; featureCode?: string; hostOverride?: unknown } = {}) {
  const [platform, setPlatform] = useState(''), [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    setError('')
    void unlockInvoke('system_get_platform', {}).then(data => {
      if (data.success !== true || !['windows', 'macos'].includes(String(data.platform))) throw new Error('当前平台不支持文件解锁')
      if (alive) setPlatform(String(data.platform))
    }).catch(e => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [attempt])
  if (platform === 'windows') return WindowsFileUnlockCommand(props)
  if (platform === 'macos') return MacFileUnlockCommand({ initialPath: props.initialPath, featureCode: props.featureCode })
  return <List navigationTitle="文件解锁" isShowingDetail={false} isLoading={!error}>
    <List.Item id="platform" title={error || '正在确认系统平台'} actions={<ActionPanel><Action title="重试" onAction={() => setAttempt(attempt + 1)} /></ActionPanel>} />
  </List>
}
export const commands = {
  'file-unlock': () => FileUnlockCommand(),
  'usb-unlock': () => FileUnlockCommand({ featureCode: 'usb-unlock' })
}
