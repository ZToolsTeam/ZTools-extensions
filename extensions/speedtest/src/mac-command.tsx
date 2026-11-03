import React, { List, Action, ActionPanel, Icon, Clipboard, showToast, Toast, useState, useEffect, useRef } from '@ztools/declarative-ui'
import { speedtestId, diagnoseNetwork, measureBandwidth, stopSpeedtest, networkReport, type MacBandwidth, type MacDiagnosis, type MacProbe } from './mac-service.js'
const ms = (n: number | null) => n === null ? '未提供' : `${n.toFixed(2)} ms`
export default function MacSpeedtestCommand({ diagnostic = false }: { diagnostic?: boolean } = {}) {
  const [bandwidth, setBandwidth] = useState<MacBandwidth | null>(null), [diagnosis, setDiagnosis] = useState<MacDiagnosis | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [search, setSearch] = useState(''), [group, setGroup] = useState('all'), [busy, setBusy] = useState(''), [error, setError] = useState(''), [status, setStatus] = useState('就绪')
  const alive = useRef(true), latestId = useRef(''), operation = useRef<{ id: string; cancelled: boolean; stopping: boolean } | null>(null)
  const copy = async (text: string) => {
    try { await Clipboard.copy(text); if (alive.current) await showToast({ style: Toast.Style.Success, title: '已复制' }) }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)) }
  }
  const run = async (kind: 'bandwidth' | 'diagnose', target?: string, replaceNode?: MacProbe) => {
    if (operation.current || !alive.current) return
    const task = { id: speedtestId(), cancelled: false, stopping: false }; operation.current = task; latestId.current = task.id
    setBusy(kind); setError(''); setStatus(kind === 'bandwidth' ? '正在测量上下行吞吐量，约 15 秒' : '正在检测节点连接')
    if (kind === 'bandwidth') setBandwidth(null); else if (!replaceNode) setDiagnosis(null)
    try {
      const result = kind === 'bandwidth' ? await measureBandwidth(task.id) : await diagnoseNetwork(task.id, target)
      if (!alive.current || task.cancelled) return
      let doneStatus = '测速完成'
      if (kind === 'bandwidth') setBandwidth(result as MacBandwidth)
      else {
        const next = result as MacDiagnosis
        next.nodes = next.nodes.map(n => ({ ...n, checkedAt: next.checkedAt }))
        if (replaceNode && diagnosis) {
          const replacement = next.nodes[0]
          if (next.nodes.length !== 1 || !replacement || replacement.host !== replaceNode.host || replacement.port !== replaceNode.port) throw new Error('单项检测回执与目标节点不一致')
          next.nodes = diagnosis.nodes.map(n => n.host === replaceNode.host && n.port === replaceNode.port ? { ...replacement, name: n.name, group: n.group } : n)
        } else if (target) { setSearch(''); setGroup('all') }
        setDiagnosis(next)
        // 按实际失败数量写状态，全部连通时不能再提示“连接失败原因见各行”
        const failed = next.nodes.filter(n => n.error).length
        doneStatus = failed ? `节点检测完成，${failed} 个节点连接失败，原因见各行` : `节点检测完成，${next.nodes.length} 个节点均已连通`
        if (!replaceNode && next.nodes[0]) setSelected('node-' + next.nodes[0].host + ':' + next.nodes[0].port)
      }
      setStatus(doneStatus)
    } catch (e) { if (alive.current && !task.cancelled) { setError(e instanceof Error ? e.message : String(e)); setStatus('检测未完成') } }
    finally { if (operation.current === task) operation.current = null; if (alive.current) setBusy('') }
  }
  const cancel = async () => {
    const task = operation.current
    if (!task || task.stopping) return
    task.cancelled = true; task.stopping = true; setStatus('正在停止')
    try { await stopSpeedtest(task.id); if (alive.current && latestId.current === task.id) setStatus('已停止') }
    catch (e) { if (alive.current && latestId.current === task.id) { setError(`停止未确认：${e instanceof Error ? e.message : String(e)}`); setStatus('等待当前操作结束') } }
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
  return <List isShowingDetail={false} isLoading={!!busy} selectedItemId={selected ?? undefined} onSelectionChange={setSelected} searchText={search} onSearchTextChange={setSearch} searchBarPlaceholder="搜索节点，或输入域名、IP:端口"
    searchBarAccessory={<List.Dropdown value={group} onChange={setGroup} tooltip="节点范围"><List.Dropdown.Item value="all" title="全部" /><List.Dropdown.Item value="domestic" title="国内节点" /><List.Dropdown.Item value="global" title="国际节点" /></List.Dropdown>}
    filterBar={{ summaryText: status, actions: [{ id: 'diagnose', title: busy ? '停止检测' : '检测预设节点', onAction: busy ? cancel : () => run('diagnose') }, { id: 'report', title: '复制报告', onAction: () => copy(report()), disabled: !bandwidth && !diagnosis }] }}>
    {custom ? <List.Item id="custom" title={`检测 ${target}`} subtitle="Enter 检测此地址的 TCP 连接；默认端口 443" icon={Icon.Globe} actions={<ActionPanel><Action title="检测此地址" onAction={() => run('diagnose', target)} /></ActionPanel>} /> : null}
    {!target && group === 'all' ? <List.Item id="bandwidth" title={bandwidth ? `下载 ${bandwidth.downloadMbps.toFixed(1)} Mbps · 上传 ${bandwidth.uploadMbps.toFixed(1)} Mbps` : '开始测量带宽'}
      subtitle={bandwidth ? `Apple 测试服务 · ${bandwidth.interfaceName} · ${new Date(bandwidth.checkedAt).toLocaleTimeString()}` : '约 15 秒，可能产生 GB 级流量；使用当前网络及 VPN'} icon={Icon.Bolt}
      actions={<ActionPanel><Action title={bandwidth ? '重新测量带宽' : '开始测量带宽'} onAction={() => run('bandwidth')} />{bandwidth ? <Action title="复制带宽结果" onAction={() => copy(networkReport(bandwidth, null))} /> : null}</ActionPanel>} /> : null}
    {bandwidth && !target && group === 'all' ? <List.Item id="quality" title={`空闲延迟 ${ms(bandwidth.baseRttMs)}`} subtitle={`负载响应 ${bandwidth.responsivenessRpm === null ? '未提供' : bandwidth.responsivenessRpm.toFixed(1) + ' RPM'} · 实测用时 ${(bandwidth.durationMs / 1000).toFixed(1)} 秒`} icon={Icon.Clock}
      actions={<ActionPanel><Action title="复制网络质量" onAction={() => copy(`空闲延迟 ${ms(bandwidth.baseRttMs)}；负载响应 ${bandwidth.responsivenessRpm ?? '未提供'} RPM`)} /></ActionPanel>} /> : null}
    {nodes.map(n => <List.Item key={n.host + ':' + n.port} id={'node-' + n.host + ':' + n.port} title={n.name} icon={Icon.Globe}
      subtitle={`${n.host} · ${n.protocol} ${n.samplesMs.length}/3 · ${n.error || `平均 ${ms(n.latencyMs)} · 抖动 ${ms(n.jitterMs)}`}`}
      actions={<ActionPanel>{n.protocol === 'TCP' ? <Action title="重新检测此节点" onAction={() => run('diagnose', probeAddress(n), n)} /> : null}<Action title="复制节点结果" onAction={() => copy(`${n.name} ${n.host} ${n.protocol} 平均 ${ms(n.latencyMs)} 抖动 ${ms(n.jitterMs)} ${n.error || ''}`)} /></ActionPanel>} />)}
    {error ? <List.Item id="error" title="检测失败" subtitle={error} icon={Icon.ExclamationMark} /> : null}
    {diagnosis?.network.warning ? <List.Item id="warning" title="网络信息" subtitle={diagnosis.network.warning} /> : null}
    {!nodes.length && diagnosis && !error ? <List.Item id="empty" title="没有匹配节点" subtitle="调整搜索或节点范围后查看" /> : null}
  </List>
}
