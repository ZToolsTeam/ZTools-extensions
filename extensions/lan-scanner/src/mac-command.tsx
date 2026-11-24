import React, { Action, ActionPanel, Detail, Icon, List, Toast, showToast, useEffect, useLocale, useNavigation, useRef, useState } from '@ztools/declarative-ui'
import { cancelMacNetwork, lanOperationId, readMacInterfaces, saveMac, scanMacNetwork, type MacInterface, type MacScan } from './mac-service.js'
import { RangeForm, WakeForm } from './mac-forms.js'
import { t } from './i18n.js'
import { MAC_RESPONSE_LOCAL } from './mac-protocol.zh-data.js'
export default function MacLanCommand() {
  useLocale()
  const [interfaces, setInterfaces] = useState<MacInterface[]>([]), [selected, setSelected] = useState(''), [address, setAddress] = useState('')
  const [report, setReport] = useState<MacScan | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [query, setQuery] = useState('')
  const pending = useRef<string | null>(null), alive = useRef(true), guard = useRef(false), cancelled = useRef(false), { push } = useNavigation()
  const fail = async (e: unknown) => { if (alive.current) { const message = e instanceof Error ? e.message : String(e); setError(message); await showToast({ style: Toast.Style.Failure, title: t('toastScanFailed'), message }) } }
  const scan = async (id = selected, target = address) => {
    if (guard.current) return
    guard.current = true; cancelled.current = false; setBusy(true); setError(''); setReport(null)
    const operationId = lanOperationId(); pending.current = operationId
    try {
      const next = await readMacInterfaces()
      if (!alive.current || cancelled.current) return
      setInterfaces(next)
      const iface = id ? next.find(v => v.id === id) : next[0]
      if (!iface) { setSelected(''); setAddress(''); throw new Error(next.length ? t('errNicDisconnected') : t('errNoNicConnected')) }
      setSelected(iface.id); setAddress(target || iface.ip)
      const result = await scanMacNetwork(iface, target || iface.ip, operationId)
      if (alive.current && !cancelled.current) setReport(result)
    } catch (e) { if (!cancelled.current) await fail(e) }
    finally { if (pending.current === operationId) pending.current = null; guard.current = false; if (alive.current) setBusy(false) }
  }
  const stop = async () => {
    cancelled.current = true; setReport(null)
    if (pending.current) { try { await cancelMacNetwork(pending.current); if (alive.current) setError(t('scanStoppedMsg')) } catch (e) { await fail(e) } }
  }
  useEffect(() => { alive.current = true; void scan(); return () => { alive.current = false; cancelled.current = true; if (pending.current) void cancelMacNetwork(pending.current).catch(e => console.error(t('errStopScanFailed'), e)) } }, [])
  const chooseRange = () => { if (!guard.current && selected) push(<RangeForm address={address} saved={value => { setAddress(value); void scan(selected, value) }} />) }
  const rows = (report?.devices ?? []).filter(d => `${d.ip} ${d.mac ?? ''} ${d.openPorts.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))
  const responseLabel = (r: MacScan['devices'][number]['response']) => (r === MAC_RESPONSE_LOCAL ? t('responseLocalhost') : r)
  return <List navigationTitle={t('navTitle')} isShowingDetail={false} isLoading={busy} searchText={query} onSearchTextChange={setQuery} searchBarPlaceholder={t('searchPlaceholder')}
    searchBarAccessory={<List.Dropdown value={selected} tooltip={t('nicDropdownTooltip')} onChange={id => { if (guard.current) return; setSelected(id); setAddress(''); setReport(null); void scan(id, '') }}>{interfaces.map(v => <List.Dropdown.Item key={v.id} value={v.id} title={`${v.name} · ${v.subnet}`} />)}</List.Dropdown>}
    filterBar={{ summaryText: busy ? t('summaryBusy') : error || (report ? t('summaryReport', { range: report.range, scanned: report.scanned, found: report.devices.length, sec: (report.durationMs / 1000).toFixed(1) }) : t('summaryIdle')), actions: [
      { id: busy ? 'stop' : 'scan', title: busy ? t('btnStopScan') : t('btnRescan'), onAction: () => busy ? stop() : scan() },
      { id: 'range', title: t('btnChooseRange'), onAction: chooseRange }
    ] }}>
    {error && <List.Item id="error" title={error} icon={Icon.ExclamationMark} actions={<ActionPanel><Action title={t('btnRescan')} icon={Icon.ArrowClockwise} onAction={() => scan()} /><Action.Push title={t('actionWakeDevice')} target={<WakeForm />} /></ActionPanel>} />}
    {rows.map(d => <List.Item key={d.ip} id={`device-${d.ip}`} title={d.ip} subtitle={d.mac || t('macUnavailable')} icon={Icon.Desktop} accessories={[{ tag: responseLabel(d.response) }, { text: d.openPorts.length ? t('portsOpenText', { ports: d.openPorts.join(', ') }) : t('portsNoneText') }]} actions={<ActionPanel>
      <Action.CopyToClipboard title={t('actionCopyIp')} content={d.ip} />
      <Action.Push title={t('actionViewDetails')} target={<Detail markdown={t('detailMarkdown', {
        ports: d.openPorts.length ? d.openPorts.map(p => t('detailPortOpenLine', { port: p })).join('\n') : t('detailNoPorts'),
        response: responseLabel(d.response),
        latency: d.latencyMs === null ? t('detailLatencyNone') : t('detailLatencyMs', { ms: d.latencyMs.toFixed(2) }),
        help: t('helpMarkdown')
      })} />} />
      {d.openPorts.filter(p => [80, 443, 8080, 8443].includes(p)).map(p => <Action.OpenInBrowser key={p} title={t('actionOpenWeb', { port: p })} url={`${p === 443 || p === 8443 ? 'https' : 'http'}://${d.ip}:${p}`} />)}
      {d.mac && <Action.Push title={t('actionWakeThisMac')} target={<WakeForm initialMac={d.mac} />} />}
      {d.mac && <Action title={t('actionSaveMac')} onAction={async () => { try { await saveMac(d.mac!); await showToast({ style: Toast.Style.Success, title: t('wakeToastSavedMac') }) } catch (e) { await showToast({ style: Toast.Style.Failure, title: e instanceof Error ? e.message : String(e) }) } }} />}
      <Action.Push title={t('actionScanScope')} target={<Detail markdown={t('helpMarkdown')} />} />
    </ActionPanel>} />)}
    {!busy && !error && !rows.length && <List.Item id="empty" title={report?.devices.length ? t('emptyNoMatch') : t('emptyNoDevice')} subtitle={t('emptySubtitle')} actions={<ActionPanel><Action.Push title={t('actionWakeDevice')} target={<WakeForm />} /><Action.Push title={t('actionScanScope')} target={<Detail markdown={t('helpMarkdown')} />} /></ActionPanel>} />}
    {report?.warnings.map((w, index) => <List.Item key={index} id={`warning-${index}`} title={t('warningPartialTitle')} subtitle={w} />)}
  </List>
}
