import React, { Action, ActionPanel, Detail, Icon, List, Toast, confirmAlert, showToast, useEffect, useLocale, useNavigation, useRef, useState } from '@ztools/declarative-ui'
import { t } from './i18n.js'
import { applyProxy, cancelSsh, openSshTerminal, prepareProxy, scanSsh, sourceMarkdown, type ProxyChange, type ProxyRow, type ProxyTool, type Snapshot, type SshHost } from './mac-service.js'
import { ConnectionForm } from './mac-forms.js'
import { resolveErrorMessage } from './error-i18n.js'
const failure = (error: unknown) => resolveErrorMessage(error, t('opIncomplete'))
const TOOL_LABEL: Record<ProxyTool, string> = { git: 'Git', npm: 'NPM' }
/** 只显示文件名（如 .gitconfig、.npmrc），完整路径在“查看配置来源”里 */
const fileName = (location: string) => location.split(/[\\/]/).filter(Boolean).pop() || location

export default function MacSshCommand({ featureCode = 'ssh-all', platform = 'macos' }: { featureCode?: string; platform?: 'macos' | 'windows' } = {}) {
  useLocale()
  const windows = platform === 'windows'
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [query, setQuery] = useState(''), [category, setCategory] = useState(featureCode === 'ssh-proxy-toggle' ? 'proxy' : featureCode === 'ssh-tunnel' ? 'hosts' : 'all')
  const [recoveryPath, setRecoveryPath] = useState('')
  const alive = useRef(true), guard = useRef(false), current = useRef<Snapshot | null>(null), { push } = useNavigation()
  const reload = async () => {
    current.current = null; if (alive.current) setSnapshot(null)
    const next = await scanSsh()
    if (alive.current) { current.current = next; setSnapshot(next) }
  }
  const run = async (work: () => Promise<void>) => {
    if (guard.current || !alive.current) return false
    guard.current = true; setBusy(true); setError('')
    try { await work(); return true }
    catch (e) { if (alive.current) { setError(failure(e)); await showToast(Toast.Style.Failure, t('opIncompleteTitle'), failure(e)) }; return false }
    finally { guard.current = false; if (alive.current) setBusy(false) }
  }
  // 取消请求本身失败（如客户端已无此操作）要如实提示，不能变成未处理的异常
  const stop = async () => {
    try { await cancelSsh() }
    catch (e) { if (alive.current) { setError(t('cancelUnconfirmedPrefix', { error: failure(e) })); await showToast(Toast.Style.Failure, t('cancelUnconfirmedTitle'), failure(e)) } }
  }
  useEffect(() => { void run(reload); return () => { alive.current = false; if (guard.current) void cancelSsh().catch(e => console.warn(t('warnCancelUnconfirmed'), e)) } }, [])
  const mutate = async (tool: ProxyTool, change: ProxyChange, active = () => true) => {
    let done = false
    const ok = await run(async () => {
      const loaded = current.current
      if (!loaded || !active()) throw new Error(t('refreshBeforeMutate'))
      const plan = await prepareProxy(loaded.sessionId, tool, change)
      if (!alive.current || !active()) { await cancelSsh(); return }
      const format = (items: typeof plan.before) => items.length ? items.map(p => t('confirmTitlePrefix', { key: p.key, value: p.value })).join('\n') : t('noGenericProxyInFile', { file: fileName(plan.location) })
      const confirmed = await confirmAlert({ title: plan.summary, message: t('confirmMessage', { location: plan.location, before: format(plan.before), after: format(plan.after), notices: plan.notices.join('\n') }), primaryAction: { title: t('confirmAndVerify') }, dismissAction: { title: t('cancel') } })
      if (!confirmed || !alive.current || !active()) { await cancelSsh(); return }
      let operationError = '', retained = ''
      try {
        const result = await applyProxy(plan.planId); retained = result.recoveryPath || ''; done = true
        if (alive.current && retained) setRecoveryPath(retained)
      } catch (e) { operationError = failure(e) }
      if (alive.current) { try { await reload() } catch (e) { operationError += `${operationError ? '；' : ''}${t('refreshFailed', { error: failure(e) })}` } }
      if (operationError) throw new Error(operationError)
      if (alive.current && active()) await showToast(Toast.Style.Success, t('configWrittenTitle'), t('retainedHint', { retained: retained ? t('retainedPrefix', { path: retained }) : '' }))
    })
    return ok && done
  }
  const terminal = (params: Record<string, unknown>, active = () => true) => run(async () => {
    if (!active()) return
    const notice = await openSshTerminal(params)
    if (alive.current && active()) await showToast(Toast.Style.Success, t('terminalOpenedTitle'), notice)
  })
  const connect = (host: SshHost) => terminal({ action: 'connect', sessionId: current.current?.sessionId, alias: host.alias })
  const tunnel = (host: SshHost) => { if (!guard.current) push(<ConnectionForm title={t('tunnelTitle', { alias: host.alias })} tunnel save={(v, active) => terminal({ action: 'tunnel', sessionId: current.current?.sessionId, alias: host.alias, tunnel: { localPort: v.port, remoteHost: v.remoteHost, remotePort: v.remotePort } }, active)} />) }
  const editProxy = (tool?: ProxyTool) => { if (!guard.current) push(<ConnectionForm title={tool ? t('editProxyTitle', { tool: TOOL_LABEL[tool] }) : t('newTerminalProxy')} save={(v, active) => tool ? mutate(tool, { kind: 'set', port: v.port }, active) : terminal({ action: 'terminal-proxy', port: v.port }, active)} />) }
  const sources = (row: ProxyRow) => { if (row.status === 'ready') push(<Detail navigationTitle={t('sourceTitle', { tool: TOOL_LABEL[row.tool] })} markdown={sourceMarkdown(row)} />) }
  const q = query.trim().toLowerCase(), showHosts = category === 'all' || category === 'hosts', showProxy = category === 'all' || category === 'proxy'
  const hosts = showHosts ? snapshot?.ssh.hosts.filter(h => `${h.alias} ${h.hostName || ''} ${h.user || ''}`.toLowerCase().includes(q)) || [] : []
  const proxies = showProxy ? snapshot?.proxies.filter(p => p.tool.includes(q) || (p.status === 'ready' && p.values.some(v => v.value.includes(q)))) || [] : []
  const backups = category === 'backups' ? snapshot?.backups.filter(b => `${b.summary} ${b.createdAt}`.toLowerCase().includes(q)) || [] : []
  const notices = snapshot ? [snapshot.ssh.error, ...snapshot.ssh.warnings, snapshot.backupError].filter(Boolean).join('；') : ''
  return <List navigationTitle={t('navTitle')} isShowingDetail={false} isLoading={busy} searchText={query} onSearchTextChange={setQuery} searchBarPlaceholder={t('searchPlaceholder')}
    searchBarAccessory={<List.Dropdown value={category} onChange={setCategory} tooltip={t('viewDropdownTooltip')}><List.Dropdown.Item value="all" title={t('catAll')} /><List.Dropdown.Item value="hosts" title={t('catHosts')} /><List.Dropdown.Item value="proxy" title={t('catProxy')} /><List.Dropdown.Item value="backups" title={t('catBackups')} /></List.Dropdown>}
    filterBar={{ summaryText: error || notices || (busy ? t('readingOrVerifying') : snapshot ? t('summaryHosts', { count: snapshot.ssh.hosts.length }) : t('notReadYet')), actions: [{ id: 'refresh', title: busy ? t('cancelOp') : t('refresh'), onAction: () => busy ? stop() : run(reload) }] }}>
    {!snapshot && <List.Item id="unread" icon={Icon.Document} title={error ? t('readIncompleteTitle') : t('readingConfigTitle')} subtitle={error || t('readingConfigSubtitle')} />}
    {hosts.map(h => <List.Item key={h.alias} id={`ssh:${h.alias}`} title={h.alias} icon={Icon.Terminal} subtitle={`${h.hostName || t('conditionalHostFallback')}${h.user ? ` · ${h.user}` : ''}${h.port ? `:${h.port}` : ''}`}
      accessories={h.previewComplete ? [] : [{ text: t('hasConditionBadge') }]} actions={<ActionPanel>
        <Action title={featureCode === 'ssh-tunnel' ? t('createLocalTunnel') : t('connectInTerminal')} onAction={async () => { if (featureCode === 'ssh-tunnel') tunnel(h); else await connect(h) }} />
        <Action title={featureCode === 'ssh-tunnel' ? t('connectInTerminal') : t('createLocalTunnel')} onAction={async () => { if (featureCode === 'ssh-tunnel') await connect(h); else tunnel(h) }} />
        <Action.CopyToClipboard title={t('copyConnectCmd')} content={windows ? `ssh ${h.alias}` : `ssh '${h.alias}'`} />
      </ActionPanel>} />)}
    {proxies.map(p => <List.Item key={p.tool} id={`proxy:${p.tool}`} title={t('toolProxyTitle', { tool: TOOL_LABEL[p.tool] })} icon={Icon.Globe} subtitle={p.status === 'error' ? p.error : p.values.length ? p.values.map(v => `${v.key}: ${v.value}`).join(' · ') : (p.exists ? t('proxyUnsetExists', { file: fileName(p.location) }) : t('proxyUnsetMissing', { file: fileName(p.location) }))}
      actions={<ActionPanel>{p.status === 'error' && <Action title={t('reread')} onAction={async () => { await run(reload) }} />}{p.status === 'ready' && <Action title={t('setLocalProxyPort')} onAction={() => editProxy(p.tool)} />}{p.status === 'ready' && p.values.length > 0 && <Action title={t('clearProxyInFile')} onAction={async () => { await mutate(p.tool, { kind: 'clear' }) }} />}{p.status === 'ready' && <Action title={t('viewConfigSource')} onAction={() => sources(p)} />}</ActionPanel>} />)}
    {snapshot && showProxy && (!q || `${t('newTerminalProxy')} terminal`.toLowerCase().includes(q)) && <List.Item id="terminal-proxy" title={t('newTerminalProxy')} subtitle={t('terminalProxySubtitle')} icon={Icon.Terminal} actions={<ActionPanel><Action title={t('openTerminalWithProxy')} onAction={() => editProxy()} /></ActionPanel>} />}
    {snapshot && showHosts && !hosts.length && <List.Item id="hosts-empty" icon={Icon.Terminal} title={snapshot.ssh.status === 'error' ? t('sshReadFailedTitle') : q ? t('sshNoMatchTitle') : t('sshNoAliasTitle')} subtitle={resolveErrorMessage(snapshot.ssh, t('sshEmptySubtitle', { path: windows ? '%USERPROFILE%\\.ssh\\config' : '~/.ssh/config' }))} actions={<ActionPanel><Action title={q ? t('clearSearch') : t('reread')} onAction={async () => { if (q) setQuery(''); else await run(reload) }} /></ActionPanel>} />}
    {category === 'backups' && recoveryPath && <List.Item id="retained-original" title={t('retainedOriginalTitle')} subtitle={recoveryPath} icon={Icon.Document} actions={<ActionPanel><Action.CopyToClipboard title={t('copyOriginalLocation')} content={recoveryPath} /></ActionPanel>} />}
    {category === 'backups' && snapshot && !backups.length && <List.Item id="no-backups" title={snapshot.backupError ? t('backupReadIncomplete') : t('noMatchingBackups')} subtitle={snapshot.backupError || t('backupHint')} icon={Icon.Document} />}
    {backups.map(b => <List.Item key={b.id} id={`backup:${b.id}`} title={b.summary} subtitle={b.createdAt} icon={Icon.Document} actions={<ActionPanel><Action title={t('previewRestore')} onAction={async () => { await mutate(b.tool, { kind: 'restore', backupId: b.id }) }} /></ActionPanel>} />)}
  </List>
}
