import React, { List, Action, ActionPanel, Icon, Clipboard, showToast, Toast, useState, useEffect, useRef, useLocale } from '@ztools/declarative-ui'
import { t } from './i18n.js'
import { speedtestId, diagnoseNetwork, measureBandwidth, stopSpeedtest, networkReport, type MacBandwidth, type MacDiagnosis, type MacProbe } from './mac-service.js'
import { resolveErrorMessage } from './error-i18n.js'
const ms = (n: number | null) => n === null ? t('notProvided') : `${n.toFixed(2)} ms`
export default function MacSpeedtestCommand({ diagnostic = false }: { diagnostic?: boolean } = {}) {
  const locale = useLocale()
  const [bandwidth, setBandwidth] = useState<MacBandwidth | null>(null), [diagnosis, setDiagnosis] = useState<MacDiagnosis | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [search, setSearch] = useState(''), [group, setGroup] = useState('all'), [busy, setBusy] = useState(''), [error, setError] = useState(''), [status, setStatus] = useState('')
  const alive = useRef(true), latestId = useRef(''), operation = useRef<{ id: string; cancelled: boolean; stopping: boolean } | null>(null)
  const copy = async (text: string) => {
    try { await Clipboard.copy(text); if (alive.current) await showToast({ style: Toast.Style.Success, title: t('copied') }) }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)) }
  }
  const run = async (kind: 'bandwidth' | 'diagnose', target?: string, replaceNode?: MacProbe) => {
    if (operation.current || !alive.current) return
    const task = { id: speedtestId(), cancelled: false, stopping: false }; operation.current = task; latestId.current = task.id
    setBusy(kind); setError(''); setStatus(kind === 'bandwidth' ? t('measuringBandwidth') : t('diagnosingNodes'))
    if (kind === 'bandwidth') setBandwidth(null); else if (!replaceNode) setDiagnosis(null)
    try {
      const result = kind === 'bandwidth' ? await measureBandwidth(task.id) : await diagnoseNetwork(task.id, target)
      if (!alive.current || task.cancelled) return
      let doneStatus = t('speedtestDone')
      if (kind === 'bandwidth') setBandwidth(result as MacBandwidth)
      else {
        const next = result as MacDiagnosis
        next.nodes = next.nodes.map(n => ({ ...n, checkedAt: next.checkedAt }))
        if (replaceNode && diagnosis) {
          const replacement = next.nodes[0]
          if (next.nodes.length !== 1 || !replacement || replacement.host !== replaceNode.host || replacement.port !== replaceNode.port) throw new Error(t('singleNodeMismatch'))
          next.nodes = diagnosis.nodes.map(n => n.host === replaceNode.host && n.port === replaceNode.port ? { ...replacement, name: n.name, group: n.group } : n)
        } else if (target) { setSearch(''); setGroup('all') }
        setDiagnosis(next)
        // 按实际失败数量写状态，全部连通时不能再提示“连接失败原因见各行”
        const failed = next.nodes.filter(n => n.error).length
        doneStatus = failed ? t('diagnoseFailedStatus', { count: failed }) : t('diagnoseAllOkStatus', { count: next.nodes.length })
        if (!replaceNode && next.nodes[0]) setSelected('node-' + next.nodes[0].host + ':' + next.nodes[0].port)
      }
      setStatus(doneStatus)
    } catch (e) { if (alive.current && !task.cancelled) { setError(e instanceof Error ? e.message : String(e)); setStatus(t('diagnoseIncomplete')) } }
    finally { if (operation.current === task) operation.current = null; if (alive.current) setBusy('') }
  }
  const cancel = async () => {
    const task = operation.current
    if (!task || task.stopping) return
    task.cancelled = true; task.stopping = true; setStatus(t('stopping'))
    try { await stopSpeedtest(task.id); if (alive.current && latestId.current === task.id) setStatus(t('stopped')) }
    catch (e) { if (alive.current && latestId.current === task.id) { setError(t('stopUnconfirmed', { error: e instanceof Error ? e.message : String(e) })); setStatus(t('waitingOperationEnd')) } }
    finally { task.stopping = false }
  }
  useEffect(() => {
    alive.current = true
    if (diagnostic) void run('diagnose')
    return () => { alive.current = false; const task = operation.current; if (task) { task.cancelled = true; void stopSpeedtest(task.id).catch(e => console.warn('离页停止测速未确认', e)) } }
  }, [])
  const report = () => networkReport(bandwidth, diagnosis)
  const target = search.trim(), custom = !!target && /[.:/]|^localhost$/i.test(target)
  const nodes = (diagnosis?.nodes ?? []).filter(n => (group === 'all' || n.group === group) && (!target || `${n.name} ${n.host}`.toLowerCase().includes(target.toLowerCase())))
  const probeAddress = (n: MacProbe) => `${n.host.includes(':') ? `[${n.host}]` : n.host}:${n.port}`
  return <List isShowingDetail={false} isLoading={!!busy} selectedItemId={selected ?? undefined} onSelectionChange={setSelected} searchText={search} onSearchTextChange={setSearch} searchBarPlaceholder={t('searchPlaceholder')}
    searchBarAccessory={<List.Dropdown value={group} onChange={setGroup} tooltip={t('nodeScopeTooltip')}><List.Dropdown.Item value="all" title={t('scopeAll')} /><List.Dropdown.Item value="domestic" title={t('scopeDomestic')} /><List.Dropdown.Item value="global" title={t('scopeGlobal')} /></List.Dropdown>}
    filterBar={{ summaryText: status || t('ready'), actions: [{ id: 'diagnose', title: busy ? t('stopCheck') : t('checkPresetNodes'), onAction: busy ? cancel : () => run('diagnose') }, { id: 'report', title: t('copyReport'), onAction: () => copy(report()), disabled: !bandwidth && !diagnosis }] }}>
    {custom ? <List.Item id="custom" title={t('checkTargetTitle', { target })} subtitle={t('checkTargetSubtitle')} icon={Icon.Globe} actions={<ActionPanel><Action title={t('checkThisAddress')} onAction={() => run('diagnose', target)} /></ActionPanel>} /> : null}
    {!target && group === 'all' ? <List.Item id="bandwidth" title={bandwidth ? t('bandwidthResultTitle', { down: bandwidth.downloadMbps.toFixed(1), up: bandwidth.uploadMbps.toFixed(1) }) : t('startBandwidthTest')}
      subtitle={bandwidth ? t('bandwidthResultSubtitle', { iface: bandwidth.interfaceName, time: new Date(bandwidth.checkedAt).toLocaleTimeString(locale) }) : t('bandwidthWarningSubtitle')} icon={Icon.Bolt}
      actions={<ActionPanel><Action title={bandwidth ? t('remeasureBandwidth') : t('startBandwidthTest')} onAction={() => run('bandwidth')} />{bandwidth ? <Action title={t('copyBandwidthResult')} onAction={() => copy(networkReport(bandwidth, null))} /> : null}</ActionPanel>} /> : null}
    {bandwidth && !target && group === 'all' ? <List.Item id="quality" title={t('idleLatencyTitle', { latency: ms(bandwidth.baseRttMs) })} subtitle={t('qualitySubtitle', { rpm: bandwidth.responsivenessRpm === null ? t('notProvided') : t('rpmUnit', { val: bandwidth.responsivenessRpm.toFixed(1) }), secs: (bandwidth.durationMs / 1000).toFixed(1) })} icon={Icon.Clock}
      actions={<ActionPanel><Action title={t('copyNetworkQuality')} onAction={() => copy(t('copyQualityText', { latency: ms(bandwidth.baseRttMs), rpm: bandwidth.responsivenessRpm ?? t('notProvided') }))} /></ActionPanel>} /> : null}
    {nodes.map(n => <List.Item key={n.host + ':' + n.port} id={'node-' + n.host + ':' + n.port} title={n.name} icon={Icon.Globe}
      subtitle={t('nodeSubtitle', { host: n.host, protocol: n.protocol, count: n.samplesMs.length, detail: resolveErrorMessage(n, t('nodeMetrics', { avg: ms(n.latencyMs), jitter: ms(n.jitterMs) })) })}
      actions={<ActionPanel>{n.protocol === 'TCP' ? <Action title={t('recheckNode')} onAction={() => run('diagnose', probeAddress(n), n)} /> : null}<Action title={t('copyNodeResult')} onAction={() => copy(t('copyNodeText', { name: n.name, host: n.host, protocol: n.protocol, avg: ms(n.latencyMs), jitter: ms(n.jitterMs), error: n.error || '' }).trim())} /></ActionPanel>} />)}
    {error ? <List.Item id="error" title={t('checkFailed')} subtitle={error} icon={Icon.ExclamationMark} /> : null}
    {diagnosis?.network.warning ? <List.Item id="warning" title={t('networkInfo')} subtitle={diagnosis.network.warning} /> : null}
    {!nodes.length && diagnosis && !error ? <List.Item id="empty" title={t('noMatchingNodes')} subtitle={t('adjustFilterHint')} /> : null}
  </List>
}
