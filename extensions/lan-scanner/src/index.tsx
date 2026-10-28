import React, { Action, ActionPanel, List, useEffect, useState } from '@ztools/declarative-ui'
import MacCommand from './mac-command.js'
import { WakeForm } from './mac-forms.js'
import { lanInvoke } from './mac-service.js'
export * from './mac-service.js'
export interface LanScannerCommandProps { featureCode?: string }
export default function LanScannerCommand(props: LanScannerCommandProps = {}) {
  const [platform, setPlatform] = useState(''), [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true; setError('')
    void lanInvoke('system_get_platform', {}).then(data => {
      if (typeof data.platform !== 'string' || !['macos', 'windows'].includes(data.platform)) throw new Error('当前平台不支持局域网扫描')
      if (alive) setPlatform(String(data.platform))
    }).catch(e => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [attempt])
  // macOS 与 Windows 共用主进程 lan_network 服务（真实 ICMP/TCP 探测、按实际掩码计算网段与广播地址）
  if (platform === 'macos' || platform === 'windows') return props.featureCode === 'lan-wake-on-lan' ? WakeForm() : MacCommand()
  return <List isShowingDetail={false} isLoading={!error}><List.Item id="platform" title={error || '正在确认系统平台'} actions={<ActionPanel><Action title="重试" onAction={() => setAttempt(attempt + 1)} /></ActionPanel>} /></List>
}
export const commands = {
  'lan-scan-all': () => LanScannerCommand(),
  'lan-wake-on-lan': () => LanScannerCommand({ featureCode: 'lan-wake-on-lan' })
}
