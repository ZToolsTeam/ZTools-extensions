import React, { Action, ActionPanel, Detail, Icon, List, Toast, showToast, useEffect, useNavigation, useRef, useState } from '@ztools/declarative-ui'
import { cancelMacNetwork, lanOperationId, readMacInterfaces, saveMac, scanMacNetwork, type MacInterface, type MacScan } from './mac-service.js'
import { RangeForm, WakeForm } from './mac-forms.js'
const help = '## 扫描范围\n探测所选网卡网段内的一段 IPv4 地址，每次最多 256 个。更大网段可通过“选择范围”分段检查。\n\n使用 ICMP 与常见 TCP 端口 22、80、443、445、3389、5900、8080、8443；只展示本次有响应的设备与本机。防火墙、休眠和无线客户端隔离可能导致漏检；未响应不能判定设备不存在。\n\nMAC 来自系统 ARP 缓存，仅补充已探测设备，可能不可用。TCP 延迟是连接响应时间，不等同于 ping。\n\nWOL 需要目标设备和网络支持；发送成功只代表系统接收了 102 字节 UDP 广播，不证明设备开机。'
export default function MacLanCommand() {
  const [interfaces, setInterfaces] = useState<MacInterface[]>([]), [selected, setSelected] = useState(''), [address, setAddress] = useState('')
  const [report, setReport] = useState<MacScan | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [query, setQuery] = useState('')
  const pending = useRef<string | null>(null), alive = useRef(true), guard = useRef(false), cancelled = useRef(false), { push } = useNavigation()
  const fail = async (e: unknown) => { if (alive.current) { const message = e instanceof Error ? e.message : String(e); setError(message); await showToast({ style: Toast.Style.Failure, title: '扫描未完成', message }) } }
  const scan = async (id = selected, target = address) => {
    if (guard.current) return
    guard.current = true; cancelled.current = false; setBusy(true); setError(''); setReport(null)
    const operationId = lanOperationId(); pending.current = operationId
    try {
      const next = await readMacInterfaces()
      if (!alive.current || cancelled.current) return
      setInterfaces(next)
      const iface = id ? next.find(v => v.id === id) : next[0]
      if (!iface) { setSelected(''); setAddress(''); throw new Error(next.length ? '原网卡已断开，请选择当前网卡' : '未找到可用 IPv4 网卡，请连接网络后重试') }
      setSelected(iface.id); setAddress(target || iface.ip)
      const result = await scanMacNetwork(iface, target || iface.ip, operationId)
      if (alive.current && !cancelled.current) setReport(result)
    } catch (e) { if (!cancelled.current) await fail(e) }
    finally { if (pending.current === operationId) pending.current = null; guard.current = false; if (alive.current) setBusy(false) }
  }
  const stop = async () => {
    cancelled.current = true; setReport(null)
    if (pending.current) { try { await cancelMacNetwork(pending.current); if (alive.current) setError('扫描已停止') } catch (e) { await fail(e) } }
  }
  useEffect(() => { alive.current = true; void scan(); return () => { alive.current = false; cancelled.current = true; if (pending.current) void cancelMacNetwork(pending.current).catch(e => console.error('停止局域网扫描失败', e)) } }, [])
  const chooseRange = () => { if (!guard.current && selected) push(<RangeForm address={address} saved={value => { setAddress(value); void scan(selected, value) }} />) }
  const rows = (report?.devices ?? []).filter(d => `${d.ip} ${d.mac ?? ''} ${d.openPorts.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))
  return <List navigationTitle="局域网扫描" isShowingDetail={false} isLoading={busy} searchText={query} onSearchTextChange={setQuery} searchBarPlaceholder="搜索 IP、MAC 或端口"
    searchBarAccessory={<List.Dropdown value={selected} tooltip="扫描网卡" onChange={id => { if (guard.current) return; setSelected(id); setAddress(''); setReport(null); void scan(id, '') }}>{interfaces.map(v => <List.Dropdown.Item key={v.id} value={v.id} title={`${v.name} · ${v.subnet}`} />)}</List.Dropdown>}
    filterBar={{ summaryText: busy ? '正在探测；可停止扫描' : error || (report ? `${report.range} · 已探测 ${report.scanned} 个地址 · ${report.devices.length} 个有响应 · ${(report.durationMs / 1000).toFixed(1)} 秒` : '等待扫描'), actions: [
      { id: busy ? 'stop' : 'scan', title: busy ? '停止扫描' : '重新扫描', onAction: () => busy ? stop() : scan() },
      { id: 'range', title: '选择范围', onAction: chooseRange }
    ] }}>
    {error && <List.Item id="error" title={error} icon={Icon.ExclamationMark} actions={<ActionPanel><Action title="重新扫描" icon={Icon.ArrowClockwise} onAction={() => scan()} /><Action.Push title="远程唤醒设备" target={<WakeForm />} /></ActionPanel>} />}
    {rows.map(d => <List.Item key={d.ip} id={`device-${d.ip}`} title={d.ip} subtitle={d.mac || 'MAC 地址不可用'} icon={Icon.Desktop} accessories={[{ tag: d.response }, { text: d.openPorts.length ? `端口 ${d.openPorts.join(', ')}` : '未发现常见开放端口' }]} actions={<ActionPanel>
      <Action.CopyToClipboard title="复制 IP 地址" content={d.ip} />
      <Action.Push title="查看服务与探测详情" target={<Detail markdown={`## 服务探测\n\n${d.openPorts.length ? d.openPorts.map(p => `- TCP ${p}：连接成功`).join('\n') : '未发现所测常见端口开放。'}\n\n响应方式：${d.response}；${d.latencyMs === null ? '未测得延迟' : `响应耗时 ${d.latencyMs.toFixed(2)} ms`}。\n\n${help}`} />} />
      {d.openPorts.filter(p => [80, 443, 8080, 8443].includes(p)).map(p => <Action.OpenInBrowser key={p} title={`打开 Web 服务 ${p}`} url={`${p === 443 || p === 8443 ? 'https' : 'http'}://${d.ip}:${p}`} />)}
      {d.mac && <Action.Push title="唤醒此 MAC 地址" target={<WakeForm initialMac={d.mac} />} />}
      {d.mac && <Action title="收藏 MAC 地址" onAction={async () => { try { await saveMac(d.mac!); await showToast({ style: Toast.Style.Success, title: 'MAC 地址已收藏' }) } catch (e) { await showToast({ style: Toast.Style.Failure, title: e instanceof Error ? e.message : String(e) }) } }} />}
      <Action.Push title="扫描范围与限制" target={<Detail markdown={help} />} />
    </ActionPanel>} />)}
    {!busy && !error && !rows.length && <List.Item id="empty" title={report?.devices.length ? '没有匹配的设备' : '未发现有响应的设备'} subtitle="防火墙、休眠或网络隔离可能导致漏检" actions={<ActionPanel><Action.Push title="远程唤醒设备" target={<WakeForm />} /><Action.Push title="扫描范围与限制" target={<Detail markdown={help} />} /></ActionPanel>} />}
    {report?.warnings.map((w, index) => <List.Item key={index} id={`warning-${index}`} title="部分设备信息不可用" subtitle={w} />)}
  </List>
}
