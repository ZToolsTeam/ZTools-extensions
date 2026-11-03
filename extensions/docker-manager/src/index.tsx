import React, { Action, ActionPanel, Icon, List, Toast, confirmAlert, showToast, useEffect, useRef, useState } from '@ztools/declarative-ui'
import { cancelDocker, containerWebUrl, controlContainer, getContainerTailLogs, logMarkdown, listContainers, removeContainers } from './docker-service.js'
import { isStopped, type ContainerStatusFilter, type ContainerSummary, type DockerLogs, type DockerSnapshot } from './types.js'
export * from './types.js'
export * from './docker-service.js'
const failureMessage = (e: unknown) => e instanceof Error ? e.message : String(e)
/** 空列表提示按实际原因区分：已连上 Docker 但没有匹配项时，不能再提示“请启动 Docker 引擎”。 */
export function emptyHint(error: string, busy: boolean, snapshot: DockerSnapshot | null, total: number): string {
  if (error) return error
  if (busy) return '正在连接本机 Docker 引擎…'
  if (!snapshot) return '请确认本机 Docker 引擎已启动，然后刷新。'
  return total ? '换个搜索词或状态筛选试试。' : '当前 Docker 上下文中还没有容器。'
}
export const DOCKER_DOWNLOAD_URL = 'https://www.docker.com/products/docker-desktop/'
/** 空列表条目：错误原文只在条目里出现一次（首句作标题、其余作说明），摘要栏只写“Docker 未就绪”。 */
export function emptyState(error: string, busy: boolean, snapshot: DockerSnapshot | null, total: number) {
  if (error) {
    const at = error.indexOf('。')
    const title = at > 0 ? error.slice(0, at) : error, rest = at > 0 ? error.slice(at + 1).trim() : ''
    return { title, subtitle: rest || '处理后按回车刷新', icon: Icon.ExclamationMark, missingCli: /未找到 Docker 命令行/.test(error) }
  }
  if (busy) return { title: '正在读取 Docker', subtitle: emptyHint(error, busy, snapshot, total), icon: Icon.CircleProgress, missingCli: false }
  return { title: snapshot ? '没有符合条件的容器' : '未连接 Docker', subtitle: emptyHint(error, busy, snapshot, total), icon: Icon.Info, missingCli: false }
}
export interface DockerManagerCommandProps { featureCode?: string }
export function DockerManagerCommand({ featureCode = 'docker-all' }: DockerManagerCommandProps = {}) {
  const [snapshot, setSnapshot] = useState<DockerSnapshot | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<ContainerStatusFilter>(featureCode === 'docker-running' ? 'running' : featureCode === 'docker-clean-stopped' ? 'exited' : 'all')
  const [query, setQuery] = useState(''), [selected, setSelected] = useState<string | null>(null), [logs, setLogs] = useState<Record<string, DockerLogs>>({})
  const active = useRef(false), alive = useRef(true)
  const work = async (run: () => Promise<void>) => {
    if (active.current) return
    active.current = true; setBusy(true); setError('')
    try { await run() }
    catch (e) { if (alive.current) { setError(failureMessage(e)); await showToast(Toast.Style.Failure, 'Docker 操作未完成', failureMessage(e)) } }
    finally { active.current = false; if (alive.current) setBusy(false) }
  }
  const reload = async () => {
    // 读取失败时禁用旧列表，避免用户继续操作旧上下文。
    setSnapshot(null); setLogs({})
    const next = await listContainers()
    if (alive.current) { setSnapshot(next); setSelected(id => next.containers.some(c => c.id === id) ? id : next.containers[0]?.id || null) }
  }
  const refresh = () => work(reload)
  const cancel = async () => { try { await cancelDocker() } catch (e) { if (alive.current) setError(`取消未确认：${failureMessage(e)}`) } }
  useEffect(() => { alive.current = true; void refresh(); return () => { alive.current = false; if (active.current) void cancelDocker().catch(e => console.warn('Docker 取消未确认', e)) } }, [])
  const toggle = (c: ContainerSummary, restart = false) => work(async () => {
    if (!snapshot) throw new Error('请刷新容器列表')
    let operationError = ''
    try { await controlContainer(snapshot.sessionId, c.id, restart ? 'restart' : c.state === 'running' ? 'stop' : 'start') }
    catch (e) { operationError = failureMessage(e) }
    if (!alive.current) return
    try { await reload() } catch (e) { operationError += `${operationError ? '；' : ''}刷新失败：${failureMessage(e)}` }
    if (operationError) throw new Error(operationError)
    if (alive.current) await showToast(Toast.Style.Success, '容器状态已更新')
  })
  const loadLogs = (c: ContainerSummary) => work(async () => {
    if (!snapshot) throw new Error('请刷新容器列表')
    const result = await getContainerTailLogs(snapshot.sessionId, c.id)
    if (alive.current) { setLogs(previous => ({ ...previous, [c.id]: result })); setSelected(c.id) }
  })
  const prune = () => work(async () => {
    if (!snapshot) throw new Error('请刷新容器列表')
    const stopped = snapshot.containers.filter(isStopped)
    if (!stopped.length) throw new Error('当前没有可清理的已停止容器')
    if (stopped.length > 100) throw new Error('待清理容器超过 100 个，请使用 Docker 命令行分批处理')
    const confirmed = await confirmAlert({ title: `清理 ${stopped.length} 个已停止容器？`, message: `${stopped.map(c => `${c.name} (${c.id.slice(0, 12)})`).join('\n')}\n\n将永久删除这些容器的可写层；保留镜像、挂载数据卷及宿主目录。请确认容器内未挂载的数据已另行保存。`, primaryAction: { title: '确认清理', style: 'destructive' }, dismissAction: { title: '取消' } })
    if (!confirmed || !alive.current) return
    let summary = '', incomplete = false
    try {
      const result = await removeContainers(snapshot.sessionId, stopped.map(c => c.id))
      incomplete = result.failures.length > 0
      summary = `已确认清理 ${result.removed.length} 个；未确认清理 ${result.failures.length} 个${incomplete ? '：' + result.failures.map(f => `${stopped.find(c => c.id === f.id)?.name || f.id.slice(0, 12)}：${f.error}`).join('；') : ''}`
    } catch (e) { incomplete = true; summary = failureMessage(e) }
    if (!alive.current) return
    try { await reload() } catch (e) { incomplete = true; summary += `；刷新失败：${failureMessage(e)}` }
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
  return <List navigationTitle="容器管控" isLoading={busy} isShowingDetail={Boolean(selected && logs[selected])} selectedItemId={selected || undefined} onSelectionChange={setSelected}
    searchText={query} onSearchTextChange={setQuery} searchBarPlaceholder="搜索容器、镜像或端口"
    searchBarAccessory={<List.Dropdown value={status} onChange={value => setStatus(value as ContainerStatusFilter)} tooltip="容器状态">
      <List.Dropdown.Item value="all" title="全部容器" /><List.Dropdown.Item value="running" title="运行中" /><List.Dropdown.Item value="exited" title="已停止" />
    </List.Dropdown>}
    filterBar={{ summaryText: loadError ? 'Docker 未就绪' : error || (busy ? '正在读取或操作 Docker…' : snapshot ? `${snapshot.context} · ${containers.length} 个容器${snapshot.statsError ? ' · ' + snapshot.statsError : ''}` : '尚未连接 Docker'),
      actions: busy ? [{ id: 'cancel', title: '取消', onAction: cancel }] : [...(emptyOffersRetry ? [] : [{ id: 'refresh', title: '刷新', onAction: refresh }]), ...(stoppedCount ? [{ id: 'prune', title: '清理停止容器', onAction: prune }] : [])] }}>
    {!visible.length && (() => { const empty = emptyState(loadError, busy, snapshot, containers.length)
      return <List.Item id="empty" title={empty.title} subtitle={empty.subtitle} icon={empty.icon}
        actions={busy || snapshot ? undefined : <ActionPanel>
          {empty.missingCli && <Action.OpenInBrowser title="打开 Docker 官网下载页" url={DOCKER_DOWNLOAD_URL} />}
          <Action title="刷新" icon={Icon.ArrowClockwise} onAction={refresh} />
        </ActionPanel>} />
    })()}
    {visible.map(c => { const url = c.state === 'running' ? containerWebUrl(c.ports) : undefined
      return <List.Item key={c.id} id={c.id} title={c.name} subtitle={`${c.image}${c.ports ? ' · ' + c.ports : ''}`} icon={c.state === 'running' ? Icon.CheckCircle : Icon.Circle}
        accessories={[...(c.cpu ? [{ text: `CPU ${c.cpu}` }] : []), ...(c.memory ? [{ text: c.memory }] : []), { text: c.status || c.state }]}
        detail={<List.Item.Detail markdown={logMarkdown(logs[c.id])} />}
        actions={<ActionPanel>
          {url ? <Action.OpenInBrowser title="打开服务网页" url={url} /> : <Action title="查看日志" icon={Icon.Document} onAction={() => loadLogs(c)} />}
          {(c.state === 'running' || isStopped(c)) && <Action title={c.state === 'running' ? '停止容器' : '启动容器'} onAction={() => toggle(c)} />}
          {url && <Action title="查看日志" onAction={() => loadLogs(c)} />}
          {c.state === 'running' && <Action title="重启容器" onAction={() => toggle(c, true)} />}
          <Action.CopyToClipboard title="复制完整容器 ID" content={c.id} />
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
