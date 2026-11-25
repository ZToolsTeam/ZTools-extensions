import React, { Action, ActionPanel, Icon, List, Toast, confirmAlert, showToast, useEffect, useLocale, useRef, useState } from '@ztools/declarative-ui'
import { t } from './i18n.js'
import { cancelDocker, containerWebUrl, controlContainer, getContainerTailLogs, logMarkdown, listContainers, removeContainers } from './docker-service.js'
import { isStopped, type ContainerStatusFilter, type ContainerSummary, type DockerLogs, type DockerSnapshot } from './types.js'
export * from './types.js'
export * from './docker-service.js'
const failureMessage = (e: unknown) => e instanceof Error ? e.message : String(e)
/** 空列表提示按实际原因区分：已连上 Docker 但没有匹配项时，不能再提示“请启动 Docker 引擎”。 */
export function emptyHint(error: string, busy: boolean, snapshot: DockerSnapshot | null, total: number): string {
  if (error) return error
  if (busy) return t('hintConnecting')
  if (!snapshot) return t('hintStartDaemon')
  return total ? t('hintNoMatch') : t('hintNoContainers')
}
export const DOCKER_DOWNLOAD_URL = 'https://www.docker.com/products/docker-desktop/'
/** 空列表条目：错误原文只在条目里出现一次（首句作标题、其余作说明），摘要栏只写“Docker 未就绪”。 */
export function emptyState(error: string, busy: boolean, snapshot: DockerSnapshot | null, total: number) {
  if (error) {
    const at = error.search(/。|\.(?:\s|$)/)
    const title = at > 0 ? error.slice(0, at) : error, rest = at > 0 ? error.slice(at + 1).trim() : ''
    const isMissingCli =
      /DOCKER_CLI_NOT_FOUND|Docker CLI not found/i.test(error) ||
      // i18n-allow: legacy host fallback
      /未找到 Docker 命令行/.test(error)
    return { title, subtitle: rest || t('emptyRefreshSubtitle'), icon: Icon.ExclamationMark, missingCli: isMissingCli }
  }
  if (busy) return { title: t('emptyLoadingTitle'), subtitle: emptyHint(error, busy, snapshot, total), icon: Icon.CircleProgress, missingCli: false }
  return { title: snapshot ? t('emptyNoMatchTitle') : t('emptyNotConnectedTitle'), subtitle: emptyHint(error, busy, snapshot, total), icon: Icon.Info, missingCli: false }
}
export interface DockerManagerCommandProps { featureCode?: string }
export function DockerManagerCommand({ featureCode = 'docker-all' }: DockerManagerCommandProps = {}) {
  useLocale()
  const [snapshot, setSnapshot] = useState<DockerSnapshot | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<ContainerStatusFilter>(featureCode === 'docker-running' ? 'running' : featureCode === 'docker-clean-stopped' ? 'exited' : 'all')
  const [query, setQuery] = useState(''), [selected, setSelected] = useState<string | null>(null), [logs, setLogs] = useState<Record<string, DockerLogs>>({})
  const active = useRef(false), alive = useRef(true)
  const work = async (run: () => Promise<void>) => {
    if (active.current) return
    active.current = true; setBusy(true); setError('')
    try { await run() }
    catch (e) { if (alive.current) { setError(failureMessage(e)); await showToast(Toast.Style.Failure, t('toastOpFailed'), failureMessage(e)) } }
    finally { active.current = false; if (alive.current) setBusy(false) }
  }
  const reload = async () => {
    // 读取失败时禁用旧列表，避免用户继续操作旧上下文。
    setSnapshot(null); setLogs({})
    const next = await listContainers()
    if (alive.current) { setSnapshot(next); setSelected(id => next.containers.some(c => c.id === id) ? id : next.containers[0]?.id || null) }
  }
  const refresh = () => work(reload)
  const cancel = async () => { try { await cancelDocker() } catch (e) { if (alive.current) setError(t('cancelUnconfirmed', { error: failureMessage(e) })) } }
  useEffect(() => { alive.current = true; void refresh(); return () => { alive.current = false; if (active.current) void cancelDocker().catch(e => console.warn('Docker cancellation unconfirmed', e)) } }, [])
  const toggle = (c: ContainerSummary, restart = false) => work(async () => {
    if (!snapshot) throw new Error(t('refreshListFirst'))
    let operationError = ''
    try { await controlContainer(snapshot.sessionId, c.id, restart ? 'restart' : c.state === 'running' ? 'stop' : 'start') }
    catch (e) { operationError = failureMessage(e) }
    if (!alive.current) return
    try { await reload() } catch (e) { operationError += `${operationError ? '; ' : ''}${t('refreshFailedPrefix', { error: failureMessage(e) })}` }
    if (operationError) throw new Error(operationError)
    if (alive.current) await showToast(Toast.Style.Success, t('containerUpdatedToast'))
  })
  const loadLogs = (c: ContainerSummary) => work(async () => {
    if (!snapshot) throw new Error(t('refreshListFirst'))
    const result = await getContainerTailLogs(snapshot.sessionId, c.id)
    if (alive.current) { setLogs(previous => ({ ...previous, [c.id]: result })); setSelected(c.id) }
  })
  const prune = () => work(async () => {
    if (!snapshot) throw new Error(t('refreshListFirst'))
    const stopped = snapshot.containers.filter(isStopped)
    if (!stopped.length) throw new Error(t('noStoppedToPrune'))
    if (stopped.length > 100) throw new Error(t('tooManyToPrune'))
    const confirmed = await confirmAlert({ title: t('pruneConfirmTitle', { count: stopped.length }), message: t('pruneConfirmMessage', { list: stopped.map(c => `${c.name} (${c.id.slice(0, 12)})`).join('\n') }), primaryAction: { title: t('pruneConfirmAction'), style: 'destructive' }, dismissAction: { title: t('cancelAction') } })
    if (!confirmed || !alive.current) return
    let summary = '', incomplete = false
    try {
      const result = await removeContainers(snapshot.sessionId, stopped.map(c => c.id))
      incomplete = result.failures.length > 0
      const detail = incomplete ? ': ' + result.failures.map(f => `${stopped.find(c => c.id === f.id)?.name || f.id.slice(0, 12)}: ${f.error}`).join('; ') : ''
      summary = t('pruneSummary', { removed: result.removed.length, failed: result.failures.length, detail })
    } catch (e) { incomplete = true; summary = failureMessage(e) }
    if (!alive.current) return
    try { await reload() } catch (e) { incomplete = true; summary += `; ${t('refreshFailedPrefix', { error: failureMessage(e) })}` }
    if (!alive.current) return
    if (incomplete) throw new Error(summary)
    await showToast(Toast.Style.Success, summary)
  })
  const containers = snapshot?.containers || [], q = query.toLowerCase().trim()
  const visible = containers.filter(c => (status === 'all' || (status === 'running' ? c.state === 'running' : isStopped(c))) && (!q || `${c.name} ${c.image} ${c.id} ${c.ports}`.toLowerCase().includes(q)))
  const stoppedCount = containers.filter(isStopped).length
  // 没拿到列表时错误原文放在空状态条目里，摘要只写“Docker 未就绪”；有列表时操作失败仍在摘要显示原文。
  const loadError = snapshot ? '' : error
  // 未连上 Docker 时空状态行带“刷新”动作（与客户端提示“再点击刷新”一致），顶部不再重复同一按钮
  const emptyOffersRetry = !visible.length && !busy && !snapshot
  return <List navigationTitle={t('navTitle')} isLoading={busy} isShowingDetail={Boolean(selected && logs[selected])} selectedItemId={selected || undefined} onSelectionChange={setSelected}
    searchText={query} onSearchTextChange={setQuery} searchBarPlaceholder={t('searchPlaceholder')}
    searchBarAccessory={<List.Dropdown value={status} onChange={value => setStatus(value as ContainerStatusFilter)} tooltip={t('statusTooltip')}>
      <List.Dropdown.Item value="all" title={t('statusAll')} /><List.Dropdown.Item value="running" title={t('statusRunning')} /><List.Dropdown.Item value="exited" title={t('statusExited')} />
    </List.Dropdown>}
    filterBar={{ summaryText: loadError ? t('summaryNotReady') : error || (busy ? t('summaryBusy') : snapshot ? t('summaryReady', { context: snapshot.context, count: containers.length, statsError: snapshot.statsError ? ' · ' + snapshot.statsError : '' }) : t('summaryDisconnected')),
      actions: busy ? [{ id: 'cancel', title: t('cancelAction'), onAction: cancel }] : [...(emptyOffersRetry ? [] : [{ id: 'refresh', title: t('refreshAction'), onAction: refresh }]), ...(stoppedCount ? [{ id: 'prune', title: t('pruneAction'), onAction: prune }] : [])] }}>
    {!visible.length && (() => { const empty = emptyState(loadError, busy, snapshot, containers.length)
      return <List.Item id="empty" title={empty.title} subtitle={empty.subtitle} icon={empty.icon}
        actions={busy || snapshot ? undefined : <ActionPanel>
          {empty.missingCli && <Action.OpenInBrowser title={t('openDownloadPage')} url={DOCKER_DOWNLOAD_URL} />}
          <Action title={t('refreshAction')} icon={Icon.ArrowClockwise} onAction={refresh} />
        </ActionPanel>} />
    })()}
    {visible.map(c => { const url = c.state === 'running' ? containerWebUrl(c.ports) : undefined
      return <List.Item key={c.id} id={c.id} title={c.name} subtitle={`${c.image}${c.ports ? ' · ' + c.ports : ''}`} icon={c.state === 'running' ? Icon.CheckCircle : Icon.Circle}
        accessories={[...(c.cpu ? [{ text: `CPU ${c.cpu}` }] : []), ...(c.memory ? [{ text: c.memory }] : []), { text: c.status || c.state }]}
        detail={<List.Item.Detail markdown={logMarkdown(logs[c.id])} />}
        actions={<ActionPanel>
          {url ? <Action.OpenInBrowser title={t('openWebAction')} url={url} /> : <Action title={t('viewLogsAction')} icon={Icon.Document} onAction={() => loadLogs(c)} />}
          {(c.state === 'running' || isStopped(c)) && <Action title={c.state === 'running' ? t('stopContainerAction') : t('startContainerAction')} onAction={() => toggle(c)} />}
          {url && <Action title={t('viewLogsAction')} onAction={() => loadLogs(c)} />}
          {c.state === 'running' && <Action title={t('restartContainerAction')} onAction={() => toggle(c, true)} />}
          <Action.CopyToClipboard title={t('copyIdAction')} content={c.id} />
        </ActionPanel>} />
    })}
  </List>
}
export const commands = {
  'docker-all': () => DockerManagerCommand(),
  'docker-running': () => DockerManagerCommand({ featureCode: 'docker-running' }),
  'docker-clean-stopped': () => DockerManagerCommand({ featureCode: 'docker-clean-stopped' })
}
export default DockerManagerCommand
