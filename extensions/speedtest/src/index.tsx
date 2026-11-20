import React, { Action, ActionPanel, List, useEffect, useLocale, useState } from '@ztools/declarative-ui'
import { t } from './i18n.js'
import MacCommand from './mac-command.js'
import { speedtestInvoke } from './mac-service.js'
export * from './types.js'
export default function SpeedtestCommand(props: { featureCode?: string } = {}) {
  useLocale()
  const [platform, setPlatform] = useState(''), [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true; setError('')
    void speedtestInvoke('system_get_platform', {}).then(r => {
      if (typeof r.platform !== 'string' || !['macos', 'windows'].includes(r.platform)) throw new Error(t('unsupportedPlatform'))
      if (alive) setPlatform(r.platform)
    }).catch(e => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [attempt])
  if (platform === 'macos') return MacCommand({ diagnostic: props.featureCode === 'speedtest-ping-check' })
  // Windows 旧测速接口会按延迟推算带宽、猜测网关，宿主已停用；新版测速接口目前只支持 macOS，这里明确告知而不显示估算结果
  if (platform === 'windows') return <List isShowingDetail={false}><List.Item id="unsupported" title={t('winUnavailableTitle')} subtitle={t('winUnavailableSubtitle')} /></List>
  return <List isShowingDetail={false} isLoading={!error}><List.Item id="platform" title={error || t('checkingPlatform')} actions={<ActionPanel><Action title={t('retry')} onAction={() => setAttempt(attempt + 1)} /></ActionPanel>} /></List>
}
export const commands = {
  'speedtest-full': () => SpeedtestCommand(),
  'speedtest-ping-check': () => SpeedtestCommand({ featureCode: 'speedtest-ping-check' })
}
