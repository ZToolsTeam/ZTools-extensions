import React, { Action, ActionPanel, Icon, List, Toast, showToast, useEffect, useMemo, useRef, useState } from '@ztools/declarative-ui'
import { PUBLIC_DNS_PRESETS } from './dns-service.js'
import { cancelDns, changeDns, flushDns, listServices, operationId, probeServers, type NetworkService, type ProbeResult } from './mac-dns-service.js'
const endpoints = PUBLIC_DNS_PRESETS.flatMap(p => [{ server: p.primary, name: `${p.name} · 主地址` }, { server: p.secondary, name: `${p.name} · 备用地址` }])
  .filter((v, i, all) => Boolean(v.server) && all.findIndex(other => other.server === v.server) === i)
export function MacDnsCommand({ featureCode = 'dns-benchmark-run' }: { featureCode?: string } = {}) {
  const [services, setServices] = useState<NetworkService[]>([]), [selected, setSelected] = useState('')
  const [results, setResults] = useState<ProbeResult[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [query, setQuery] = useState(''), [selection, setSelection] = useState(featureCode === 'dns-reset-dhcp' ? 'automatic' : featureCode === 'dns-flush-cache' ? 'flush' : endpoints[0]?.server || '')
  const alive = useRef(true), job = useRef<{ id: string; cancelled: boolean } | null>(null)
  const current = services.find(v => v.name === selected)
  const work = async (run: (active: { id: string; cancelled: boolean }) => Promise<void>) => {
    if (job.current) return
    const active = { id: operationId(), cancelled: false }; job.current = active; setBusy(true); setError('')
    try { await run(active) }
    catch (failure) { if (alive.current) { const message = failure instanceof Error ? failure.message : String(failure); setError(message); await showToast(Toast.Style.Failure, 'DNS 操作未完成', message) } }
    finally { if (job.current === active) job.current = null; if (alive.current) setBusy(false) }
  }
  const refresh = () => work(async active => {
    setResults([])
    const networks = await listServices(active.id)
    if (!alive.current || active.cancelled) return
    setServices(networks); setSelected(previous => networks.some(v => v.name === previous) ? previous : networks[0]?.name || '')
    if (!networks.length) { setError('未找到已连接的网络服务'); return }
    const probes = await probeServers(active.id, endpoints.map(v => v.server))
    if (alive.current && !active.cancelled) setResults(probes)
  })
  const cancel = async () => {
    const active = job.current
    if (!active) return
    active.cancelled = true
    try { await cancelDns(active.id) }
    catch (failure) { if (alive.current) setError(`取消未确认：${failure instanceof Error ? failure.message : String(failure)}`) }
  }
  useEffect(() => { alive.current = true; void refresh(); return () => {
    alive.current = false
    const active = job.current
    if (active) { active.cancelled = true; void cancelDns(active.id).catch(failure => console.warn('DNS 取消结果未确认', failure)) }
  } }, [])
  const change = (action: 'apply' | 'reset' | 'restore', server?: string) => work(async active => {
    if (!current) throw new Error('请先选择已连接的网络服务')
    if (action === 'restore' && !current.backup) throw new Error('当前网络没有可恢复的备份')
    if (action === 'apply' && !results.some(v => v.server === server && v.milliseconds !== null)) throw new Error('请先测速，选择成功返回解析结果的 DNS 地址')
    const next = await changeDns(active.id, current, action, server)
    if (alive.current) {
      setServices(previous => previous.map(v => v.name === next.name ? next : v))
      await showToast(Toast.Style.Success, '系统已确认 DNS 配置', next.servers.join('、') || '自动获取 DNS')
    }
  })
  const sorted = useMemo(() => endpoints.map(v => ({ ...v, probe: results.find(p => p.server === v.server) }))
    .sort((a, b) => (a.probe?.milliseconds ?? Infinity) - (b.probe?.milliseconds ?? Infinity))
    .filter(v => !query || `${v.name} ${v.server}`.toLowerCase().includes(query.toLowerCase())), [results, query])
  return <List navigationTitle="DNS 测速与切换" isShowingDetail={false} isLoading={busy} searchText={query} onSearchTextChange={setQuery}
    selectedItemId={selection} onSelectionChange={id => setSelection(id || '')} searchBarPlaceholder="搜索 DNS 名称或地址；回车应用所选地址"
    searchBarAccessory={<List.Dropdown value={selected} onChange={setSelected} tooltip="选择网络服务">
      {services.map(v => <List.Dropdown.Item key={v.name} value={v.name} title={v.name} />)}
    </List.Dropdown>}
    filterBar={{ summaryText: error || (busy ? '正在处理；系统授权等待可以取消' : `${current?.name || '未连接'} · 当前 DNS：${current?.servers.join('、') || '自动获取'} · 单次解析 example.com`),
      actions: [{ id: busy ? 'cancel' : 'refresh', title: busy ? '取消' : '重新测速', icon: Icon.ArrowClockwise, onAction: busy ? cancel : refresh }] }}>
    <List.Section title="公共 DNS · 每个地址独立测速">
      {sorted.map(v => <List.Item key={v.server} id={v.server} title={v.name} subtitle={v.server} icon={Icon.Globe}
        accessories={[{ text: v.probe ? v.probe.milliseconds === null ? '解析失败' : `${v.probe.milliseconds} ms` : '尚未测试' }, ...(current?.servers.includes(v.server) ? [{ text: '当前使用' }] : [])]}
        actions={<ActionPanel><Action title="应用此 DNS 地址" onAction={() => change('apply', v.server)} /><Action.CopyToClipboard title="复制地址" content={v.server} /></ActionPanel>} />)}
    </List.Section>
    {!query && <List.Section title="网络配置">
      <List.Item id="automatic" title="恢复自动 DNS" subtitle="清除手动 DNS 地址，保留修改前的备份" icon={Icon.RotateAntiClockwise}
        actions={<ActionPanel><Action title="恢复自动 DNS" onAction={() => change('reset')} /></ActionPanel>} />
      <List.Item id="restore" title="恢复最近备份" subtitle={current?.backup ? `${current.backup.servers.join('、') || '自动获取'} · ${new Date(current.backup.createdAt).toLocaleString()}` : '此网络尚无备份'} icon={Icon.Clock}
        actions={<ActionPanel><Action title="恢复备份" onAction={() => change('restore')} /></ActionPanel>} />
      <List.Item id="flush" title="刷新 DNS 缓存" subtitle="系统将请求管理员授权；取消授权不会显示成功" icon={Icon.ArrowClockwise}
        actions={<ActionPanel><Action title="刷新 DNS 缓存" onAction={() => work(async active => { await flushDns(active.id); if (alive.current) await showToast(Toast.Style.Success, '系统 DNS 缓存已刷新') })} /></ActionPanel>} />
    </List.Section>}
  </List>
}
