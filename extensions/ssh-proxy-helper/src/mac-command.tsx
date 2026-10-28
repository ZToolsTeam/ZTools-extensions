import React, { Action, ActionPanel, Detail, Icon, List, Toast, confirmAlert, showToast, useEffect, useNavigation, useRef, useState } from '@ztools/declarative-ui'
import { applyProxy, cancelSsh, openSshTerminal, prepareProxy, scanSsh, sourceMarkdown, type ProxyChange, type ProxyRow, type ProxyTool, type Snapshot, type SshHost } from './mac-service.js'
import { ConnectionForm } from './mac-forms.js'
const failure = (error: unknown) => error instanceof Error ? error.message : '操作未完成'
export default function MacSshCommand({ featureCode = 'ssh-all', platform = 'macos' }: { featureCode?: string; platform?: 'macos' | 'windows' } = {}) {
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
    catch (e) { if (alive.current) { setError(failure(e)); await showToast(Toast.Style.Failure, '主机与代理操作未完成', failure(e)) }; return false }
    finally { guard.current = false; if (alive.current) setBusy(false) }
  }
  useEffect(() => { void run(reload); return () => { alive.current = false; if (guard.current) void cancelSsh().catch(e => console.warn('主机操作取消未确认', e)) } }, [])
  const mutate = async (tool: ProxyTool, change: ProxyChange, active = () => true) => {
    let done = false
    const ok = await run(async () => {
      const loaded = current.current
      if (!loaded || !active()) throw new Error('请刷新代理配置后再操作')
      const plan = await prepareProxy(loaded.sessionId, tool, change)
      if (!alive.current || !active()) { await cancelSsh(); return }
      const format = (items: typeof plan.before) => items.length ? items.map(p => `${p.key}：${p.value}`).join('\n') : '此文件未设置通用代理'
      const confirmed = await confirmAlert({ title: plan.summary, message: `文件：${plan.location}\n\n修改前：\n${format(plan.before)}\n\n修改后：\n${format(plan.after)}\n\n先备份并核验，再修改。\n${plan.notices.join('\n')}`, primaryAction: { title: '确认并核验' }, dismissAction: { title: '取消' } })
      if (!confirmed || !alive.current || !active()) { await cancelSsh(); return }
      let operationError = '', retained = ''
      try {
        const result = await applyProxy(plan.planId); retained = result.recoveryPath || ''; done = true
        if (alive.current && retained) setRecoveryPath(retained)
      } catch (e) { operationError = failure(e) }
      if (alive.current) { try { await reload() } catch (e) { operationError += `${operationError ? '；' : ''}刷新失败：${failure(e)}` } }
      if (operationError) throw new Error(operationError)
      if (alive.current && active()) await showToast(Toast.Style.Success, '配置已写入并读回确认', `${retained ? `原文件保留于 ${retained}；` : ''}可在“修改备份”恢复或复制原文件位置`)
    })
    return ok && done
  }
  const terminal = (params: Record<string, unknown>, active = () => true) => run(async () => {
    if (!active()) return
    const notice = await openSshTerminal(params)
    if (alive.current && active()) await showToast(Toast.Style.Success, '已请求打开终端', notice)
  })
  const connect = (host: SshHost) => terminal({ action: 'connect', sessionId: current.current?.sessionId, alias: host.alias })
  const tunnel = (host: SshHost) => { if (!guard.current) push(<ConnectionForm title={`${host.alias} · 端口转发`} tunnel save={(v, active) => terminal({ action: 'tunnel', sessionId: current.current?.sessionId, alias: host.alias, tunnel: { localPort: v.port, remoteHost: v.remoteHost, remotePort: v.remotePort } }, active)} />) }
  const editProxy = (tool?: ProxyTool) => { if (!guard.current) push(<ConnectionForm title={tool ? `${tool.toUpperCase()} · 设置代理` : '新终端代理'} save={(v, active) => tool ? mutate(tool, { kind: 'set', port: v.port }, active) : terminal({ action: 'terminal-proxy', port: v.port }, active)} />) }
  const sources = (row: ProxyRow) => { if (row.status === 'ready') push(<Detail navigationTitle={`${row.tool.toUpperCase()} · 配置来源`} markdown={sourceMarkdown(row)} />) }
  const q = query.trim().toLowerCase(), showHosts = category === 'all' || category === 'hosts', showProxy = category === 'all' || category === 'proxy'
  const hosts = showHosts ? snapshot?.ssh.hosts.filter(h => `${h.alias} ${h.hostName || ''} ${h.user || ''}`.toLowerCase().includes(q)) || [] : []
  const proxies = showProxy ? snapshot?.proxies.filter(p => p.tool.includes(q) || (p.status === 'ready' && p.values.some(v => v.value.includes(q)))) || [] : []
  const backups = category === 'backups' ? snapshot?.backups.filter(b => `${b.summary} ${b.createdAt}`.toLowerCase().includes(q)) || [] : []
  const notices = snapshot ? [snapshot.ssh.error, ...snapshot.ssh.warnings, snapshot.backupError].filter(Boolean).join('；') : ''
  return <List navigationTitle="主机与代理" isShowingDetail={false} isLoading={busy} searchText={query} onSearchTextChange={setQuery} searchBarPlaceholder="搜索 SSH 主机、Git、NPM 或代理端口"
    searchBarAccessory={<List.Dropdown value={category} onChange={setCategory} tooltip="查看内容"><List.Dropdown.Item value="all" title="全部" /><List.Dropdown.Item value="hosts" title="SSH 主机" /><List.Dropdown.Item value="proxy" title="开发代理" /><List.Dropdown.Item value="backups" title="修改备份" /></List.Dropdown>}
    filterBar={{ summaryText: error || notices || (busy ? '正在读取或核验配置…' : snapshot ? `${snapshot.ssh.hosts.length} 个主机 · Git、NPM 分别管理` : '尚未读取配置'), actions: [{ id: 'refresh', title: busy ? '取消操作' : '刷新', onAction: () => busy ? cancelSsh() : run(reload) }] }}>
    {!snapshot && <List.Item id="unread" icon={Icon.Document} title={error ? '配置读取未完成' : '正在读取配置'} subtitle={error || '读取完成后可连接主机或管理代理'} />}
    {hosts.map(h => <List.Item key={h.alias} id={`ssh:${h.alias}`} title={h.alias} icon={Icon.Terminal} subtitle={`${h.hostName || '目标由 SSH 条件配置决定'}${h.user ? ` · ${h.user}` : ''}${h.port ? `:${h.port}` : ''}`}
      accessories={h.previewComplete ? [] : [{ text: '含条件配置' }]} actions={<ActionPanel>
        <Action title={featureCode === 'ssh-tunnel' ? '建立本地端口转发…' : '在终端连接'} onAction={async () => { if (featureCode === 'ssh-tunnel') tunnel(h); else await connect(h) }} />
        <Action title={featureCode === 'ssh-tunnel' ? '在终端连接' : '建立本地端口转发…'} onAction={async () => { if (featureCode === 'ssh-tunnel') await connect(h); else tunnel(h) }} />
        <Action.CopyToClipboard title="复制连接命令" content={windows ? `ssh ${h.alias}` : `ssh '${h.alias}'`} />
      </ActionPanel>} />)}
    {proxies.map(p => <List.Item key={p.tool} id={`proxy:${p.tool}`} title={`${p.tool.toUpperCase()} 代理`} icon={Icon.Globe} subtitle={p.status === 'error' ? p.error : p.values.length ? p.values.map(v => `${v.key}: ${v.value}`).join(' · ') : '此文件未设置通用代理'}
      actions={<ActionPanel>{p.status === 'ready' && <Action title="设置本机代理端口…" onAction={() => editProxy(p.tool)} />}{p.status === 'ready' && p.values.length > 0 && <Action title="清除此文件中的通用代理" onAction={async () => { await mutate(p.tool, { kind: 'clear' }) }} />}{p.status === 'ready' && <Action title="查看配置来源" onAction={() => sources(p)} />}</ActionPanel>} />)}
    {snapshot && showProxy && (!q || '终端 terminal'.includes(q)) && <List.Item id="terminal-proxy" title="新终端代理" subtitle="只在新窗口设置代理环境，已有终端保持原样" icon={Icon.Terminal} actions={<ActionPanel><Action title="打开带代理的新终端…" onAction={() => editProxy()} /></ActionPanel>} />}
    {snapshot && showHosts && !hosts.length && <List.Item id="hosts-empty" icon={Icon.Terminal} title={snapshot.ssh.status === 'error' ? 'SSH 配置读取失败' : q ? '没有匹配的 SSH 主机' : '没有明确的 SSH 主机别名'} subtitle={snapshot.ssh.error || `从 ${windows ? '%USERPROFILE%\\.ssh\\config' : '~/.ssh/config'} 及其 Include 文件读取 Host 别名；通配符规则不单独列为主机。`} actions={<ActionPanel><Action title={q ? '清空搜索' : '重新读取'} onAction={async () => { if (q) setQuery(''); else await run(reload) }} /></ActionPanel>} />}
    {category === 'backups' && recoveryPath && <List.Item id="retained-original" title="最近保留的原文件" subtitle={recoveryPath} icon={Icon.Document} actions={<ActionPanel><Action.CopyToClipboard title="复制原文件位置" content={recoveryPath} /></ActionPanel>} />}
    {category === 'backups' && snapshot && !backups.length && <List.Item id="no-backups" title={snapshot.backupError ? '备份读取未完成' : '没有匹配的修改备份'} subtitle={snapshot.backupError || '修改 Git 或 NPM 配置前会保存原文件'} icon={Icon.Document} />}
    {backups.map(b => <List.Item key={b.id} id={`backup:${b.id}`} title={b.summary} subtitle={b.createdAt} icon={Icon.Document} actions={<ActionPanel><Action title="预览恢复原配置" onAction={async () => { await mutate(b.tool, { kind: 'restore', backupId: b.id }) }} /></ActionPanel>} />)}
  </List>
}
