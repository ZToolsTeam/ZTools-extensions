import React, { Action, ActionPanel, Icon, List, Toast, showToast, useEffect, useLocale, useMemo, useRef, useState, getLocale } from '@ztools/declarative-ui'
import { getPublicDnsPresets } from './dns-service.js'
import { t } from './i18n.js'
import { cancelDns, changeDns, flushDns, listServices, operationId, probeServers, type NetworkService, type ProbeResult } from './mac-dns-service.js'
import { resolveErrorMessage } from './error-i18n.js'

function getEndpoints() {
  return getPublicDnsPresets()
    .flatMap(p => [{ server: p.primary, name: t('macPrimarySuffix', { name: p.name }) }, { server: p.secondary, name: t('macSecondarySuffix', { name: p.name }) }])
    .filter((v, i, all) => Boolean(v.server) && all.findIndex(other => other.server === v.server) === i)
}

export function MacDnsCommand({ featureCode = 'dns-benchmark-run' }: { featureCode?: string } = {}) {
  const locale = useLocale()
  const endpoints = useMemo(() => getEndpoints(), [locale])
  const [services, setServices] = useState<NetworkService[]>([]), [selected, setSelected] = useState('')
  const [results, setResults] = useState<ProbeResult[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [query, setQuery] = useState(''), [selection, setSelection] = useState(featureCode === 'dns-reset-dhcp' ? 'automatic' : featureCode === 'dns-flush-cache' ? 'flush' : endpoints[0]?.server || '')
  const alive = useRef(true), job = useRef<{ id: string; cancelled: boolean } | null>(null)
  // 程序自动选中的地址；选中项仍是它时说明用户没手动选过，测速完成后跟随排序选中最快的成功地址
  const autoSelection = useRef(selection)
  const current = services.find(v => v.name === selected)
  const work = async (run: (active: { id: string; cancelled: boolean }) => Promise<void>) => {
    if (job.current) { await showToast(Toast.Style.Failure, t('macBusyTitle'), t('macBusyMsg')); return }
    const active = { id: operationId(), cancelled: false }; job.current = active; setBusy(true); setError('')
    try { await run(active) }
    catch (failure) { if (alive.current) { const message = failure instanceof Error ? failure.message : String(failure); setError(message); await showToast(Toast.Style.Failure, t('macOpFailedTitle'), message) } }
    finally { if (job.current === active) job.current = null; if (alive.current) setBusy(false) }
  }
  // 只有测速命令打开时自动测速；刷新缓存、恢复自动 DNS 只读取网络配置，不额外发解析请求
  const refresh = (probe = true) => work(async active => {
    if (probe) setResults([])
    const networks = await listServices(active.id)
    if (!alive.current || active.cancelled) return
    setServices(networks); setSelected(previous => networks.some(v => v.name === previous) ? previous : networks[0]?.name || '')
    if (!networks.length) { setError(t('macNoServiceErr')); return }
    if (!probe) return
    const probes = await probeServers(active.id, endpoints.map(v => v.server))
    if (!alive.current || active.cancelled) return
    setResults(probes)
    const fastest = probes.filter(v => v.milliseconds !== null).sort((a, b) => (a.milliseconds as number) - (b.milliseconds as number))[0]
    if (fastest) setSelection(previous => {
      if (previous && previous !== autoSelection.current) return previous
      autoSelection.current = fastest.server
      return fastest.server
    })
  })
  const cancel = async () => {
    const active = job.current
    if (!active) return
    active.cancelled = true
    try { await cancelDns(active.id) }
    catch (failure) { if (alive.current) setError(t('macCancelUnconfirmed', { error: failure instanceof Error ? failure.message : String(failure) })) }
  }
  useEffect(() => { alive.current = true; void refresh(featureCode === 'dns-benchmark-run'); return () => {
    alive.current = false
    const active = job.current
    if (active) { active.cancelled = true; void cancelDns(active.id).catch(failure => console.warn('DNS cancellation unconfirmed', failure)) }
  } }, [])
  const change = (action: 'apply' | 'reset' | 'restore', server?: string) => work(async active => {
    if (!current) throw new Error(t('macSelectServiceFirst'))
    if (action === 'restore' && !current.backup) throw new Error(t('macNoBackup'))
    if (action === 'apply' && !results.some(v => v.server === server && v.milliseconds !== null)) throw new Error(t('macProbeFirst'))
    const next = await changeDns(active.id, current, action, server)
    if (alive.current) {
      setServices(previous => previous.map(v => v.name === next.name ? next : v))
      await showToast(Toast.Style.Success, t('macAppliedToast'), next.servers.join(', ') || t('macAutoDnsLabel'))
    }
  })
  const sorted = useMemo(() => endpoints.map(v => ({ ...v, probe: results.find(p => p.server === v.server) }))
    .sort((a, b) => (a.probe?.milliseconds ?? Infinity) - (b.probe?.milliseconds ?? Infinity))
    .filter(v => !query || `${v.name} ${v.server}`.toLowerCase().includes(query.toLowerCase())), [endpoints, results, query])
  const isAutomatic = Boolean(current) && current!.servers.length === 0
  // 从“恢复自动 DNS”入口打开但本来就是自动获取：那一行只是状态说明、没有动作，默认选中改到可操作的“刷新 DNS 缓存”，
  // 否则 Enter 没有反应。只调整程序自动选的项，用户手动选过就不动
  useEffect(() => {
    if (isAutomatic && selection === 'automatic' && autoSelection.current === 'automatic') {
      autoSelection.current = 'flush'
      setSelection('flush')
    }
  }, [isAutomatic, selection])
  return <List navigationTitle={t('macNavTitle')} isShowingDetail={false} isLoading={busy} searchText={query} onSearchTextChange={setQuery}
    selectedItemId={selection} onSelectionChange={id => setSelection(id || '')} searchBarPlaceholder={t('macSearchPlaceholder')}
    searchBarAccessory={<List.Dropdown value={selected} onChange={setSelected} tooltip={t('macServiceTooltip')}>
      {services.map(v => <List.Dropdown.Item key={v.name} value={v.name} title={v.name} />)}
    </List.Dropdown>}
    filterBar={{ summaryText: error || (busy ? t('macSummaryBusy') : t('macSummaryReady', { service: current?.name || t('macNotConnected'), dns: current?.servers.join(', ') || t('macAutoShort') })),
      actions: [{ id: busy ? 'cancel' : 'refresh', title: busy ? t('macCancelBtn') : results.length ? t('macRetestBtn') : t('macStartTestBtn'), icon: Icon.ArrowClockwise, onAction: busy ? cancel : () => refresh(true) }] }}>
    <List.Section title={t('macSectionPublic')}>
      {sorted.map(v => <List.Item key={v.server} id={v.server} title={v.name} subtitle={v.server} icon={Icon.Globe}
        accessories={[v.probe?.milliseconds === null ? { text: t('macProbeFailed'), tooltip: resolveErrorMessage(v.probe, t('macProbeNoReason')) } : { text: v.probe ? `${v.probe.milliseconds} ms` : t('macProbePending') }, ...(current?.servers.includes(v.server) ? [{ text: t('macInUse') }] : [])]}
        actions={<ActionPanel><Action title={t('macApplyAction')} onAction={() => change('apply', v.server)} /><Action.CopyToClipboard title={t('macCopyAddress')} content={v.server} /></ActionPanel>} />)}
    </List.Section>
    {!query && <List.Section title={t('macSectionConfig')}>
      {isAutomatic
        ? <List.Item id="automatic" title={t('macAlreadyAutoTitle')} subtitle={t('macAlreadyAutoSub')} icon={Icon.RotateAntiClockwise} />
        : <List.Item id="automatic" title={t('macResetAutoTitle')} subtitle={t('macResetAutoSub')} icon={Icon.RotateAntiClockwise}
          actions={<ActionPanel><Action title={t('macResetAutoTitle')} onAction={() => change('reset')} /></ActionPanel>} />}
      {current?.backup
        ? <List.Item id="restore" title={t('macRestoreBackupTitle')} subtitle={`${current.backup.servers.join(', ') || t('macAutoShort')} · ${new Date(current.backup.createdAt).toLocaleString(getLocale())}`} icon={Icon.Clock}
          actions={<ActionPanel><Action title={t('macRestoreAction')} onAction={() => change('restore')} /></ActionPanel>} />
        : <List.Item id="restore" title={t('macRestoreBackupTitle')} subtitle={t('macRestoreBackupEmptySub')} icon={Icon.Clock} />}
      <List.Item id="flush" title={t('macFlushTitle')} subtitle={t('macFlushSub')} icon={Icon.ArrowClockwise}
        actions={<ActionPanel><Action title={t('macFlushTitle')} onAction={() => work(async active => { await flushDns(active.id); if (alive.current) await showToast(Toast.Style.Success, t('macFlushDoneToast')) })} /></ActionPanel>} />
    </List.Section>}
  </List>
}
