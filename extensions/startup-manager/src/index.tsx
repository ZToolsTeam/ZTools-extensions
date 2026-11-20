import React, { Action, ActionPanel, List, useEffect, useLocale, useState } from '@ztools/declarative-ui'
import WindowsCommand from './windows-command.js'
import MacCommand from './mac-command.js'
import { startupInvoke } from './mac-service.js'
import { t } from './i18n.js'
export default function StartupManagerCommand(props: { featureCode?: string; hostOverride?: unknown } = {}) {
  useLocale()
  const [platform, setPlatform] = useState(''), [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true; setError('')
    void startupInvoke('system_get_platform', {}).then(data => {
      if (typeof data.platform !== 'string' || !['macos', 'windows'].includes(data.platform)) throw new Error(t('errUnsupportedPlatform'))
      if (alive) setPlatform(data.platform)
    }).catch(e => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [attempt])
  if (platform === 'macos') return MacCommand({ featureCode: props.featureCode })
  if (platform === 'windows') return WindowsCommand(props)
  return <List isShowingDetail={false} isLoading={!error}><List.Item id="platform" title={error || t('checkingPlatform')} actions={<ActionPanel><Action title={t('actionRetry')} onAction={() => setAttempt(attempt + 1)} /></ActionPanel>} /></List>
}
export const commands = {
  'startup-all': () => StartupManagerCommand(),
  'startup-services': () => StartupManagerCommand({ featureCode: 'startup-services' }),
  'startup-tasks': () => StartupManagerCommand({ featureCode: 'startup-tasks' })
}
