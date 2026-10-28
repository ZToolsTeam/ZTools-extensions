import React, { Action, ActionPanel, List, useEffect, useState } from '@ztools/declarative-ui'
import MacCommand from './mac-command.js'
import { speedtestInvoke } from './mac-service.js'
export * from './types.js'
export default function SpeedtestCommand(props: { featureCode?: string } = {}) {
  const [platform, setPlatform] = useState(''), [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true; setError('')
    void speedtestInvoke('system_get_platform', {}).then(r => {
      if (typeof r.platform !== 'string' || !['macos', 'windows'].includes(r.platform)) throw new Error('当前系统不支持网络测速')
      if (alive) setPlatform(r.platform)
    }).catch(e => { if (alive) setError(String(e)) })
    return () => { alive = false }
  }, [attempt])
  if (platform === 'macos') return MacCommand({ diagnostic: props.featureCode === 'speedtest-ping-check' })
  // Windows 旧测速接口会按延迟推算带宽、猜测网关，宿主已停用；新版测速接口目前只支持 macOS，这里明确告知而不显示估算结果
  if (platform === 'windows') return <List isShowingDetail={false}><List.Item id="unsupported" title="Windows 版网络测速暂不可用" subtitle="新版测速接口目前只支持 macOS；不会显示估算的带宽或网关" /></List>
  return <List isShowingDetail={false} isLoading={!error}><List.Item id="platform" title={error || '正在确认系统平台'} actions={<ActionPanel><Action title="重试" onAction={() => setAttempt(attempt + 1)} /></ActionPanel>} /></List>
}
export const commands = {
  'speedtest-full': () => SpeedtestCommand(),
  'speedtest-ping-check': () => SpeedtestCommand({ featureCode: 'speedtest-ping-check' })
}
