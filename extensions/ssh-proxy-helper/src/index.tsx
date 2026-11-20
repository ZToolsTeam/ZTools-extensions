import React, { Action, ActionPanel, List, useEffect, useLocale, useState } from '@ztools/declarative-ui'
import { t } from './i18n.js'
import MacCommand from './mac-command.js'
import { sshInvoke } from './mac-service.js'
export * from './types.js'
export interface SshProxyHelperCommandProps { featureCode?: string }
export function SshProxyHelperCommand(props: SshProxyHelperCommandProps = {}) {
  useLocale()
  const [platform, setPlatform] = useState(''), [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true; setError('')
    void sshInvoke('system_get_platform', {}).then(data => {
      if (data.platform !== 'macos' && data.platform !== 'windows') throw new Error(t('unsupportedPlatform'))
      if (alive) setPlatform(data.platform)
    }).catch(e => { if (alive) setError(e instanceof Error ? e.message : t('cannotConfirmPlatform')) })
    return () => { alive = false }
  }, [attempt])
  // Windows 与 Mac 共用 ssh_proxy 新接口（预览、备份、写入后读回核验），不再走旧的 dllplugin_call 入口
  if (platform === 'macos' || platform === 'windows') return MacCommand({ ...props, platform })
  return <List isLoading={!error} isShowingDetail={false}><List.Item id="platform" title={error || t('checkingPlatform')} actions={<ActionPanel><Action title={t('retry')} onAction={() => setAttempt(attempt + 1)} /></ActionPanel>} /></List>
}
export const commands = {
  'ssh-all': () => SshProxyHelperCommand({ featureCode: 'ssh-all' }),
  'ssh-proxy-toggle': () => SshProxyHelperCommand({ featureCode: 'ssh-proxy-toggle' }),
  'ssh-tunnel': () => SshProxyHelperCommand({ featureCode: 'ssh-tunnel' })
}
export default SshProxyHelperCommand
