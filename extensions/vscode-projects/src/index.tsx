import React, { Action, ActionPanel, List, useEffect, useLocale, useState } from '@ztools/declarative-ui'
import MacCommand from './mac-command.js'
import { projectsInvoke } from './mac-service.js'
import { t } from './i18n.js'
export * from './types.js'
export interface VscodeProjectsCommandProps { featureCode?: string }
export function VscodeProjectsCommand(props: VscodeProjectsCommandProps = {}) {
  useLocale()
  const [platform, setPlatform] = useState(''), [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true; setError('')
    void projectsInvoke('system_get_platform', {}).then(data => {
      if (typeof data.platform !== 'string' || !['macos', 'windows'].includes(data.platform)) throw new Error(t('errUnsupportedPlatform'))
      if (alive) setPlatform(String(data.platform))
    }).catch(e => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [attempt])
  // macOS 与 Windows 共用主进程的最近项目服务（读取编辑器历史、直接启动编辑器，不经过命令行解释器）
  if (platform === 'macos' || platform === 'windows') return MacCommand({ featureCode: props.featureCode, platform })
  return <List isShowingDetail={false} isLoading={!error}><List.Item id="platform" title={error || t('checkingPlatform')} actions={<ActionPanel><Action title={t('actionRetry')} onAction={() => setAttempt(attempt + 1)} /></ActionPanel>} /></List>
}
export default VscodeProjectsCommand
export const commands = {
  'projects-all': () => VscodeProjectsCommand(),
  'projects-vscode-cursor': () => VscodeProjectsCommand({ featureCode: 'projects-vscode-cursor' }),
  'projects-jetbrains': () => VscodeProjectsCommand({ featureCode: 'projects-jetbrains' })
}
