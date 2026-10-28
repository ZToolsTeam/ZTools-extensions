import React, { Action, ActionPanel, Form, Icon, List, Toast, showToast, useEffect, useNavigation, useRef, useState } from '@ztools/declarative-ui'
import { scanDisplays, setDisplays, type DisplaySnapshot, type MacDisplay } from './mac-service.js'
const message = (e: unknown) => e instanceof Error ? e.message : String(e)
function LevelForm({ title, initial, apply }: { title: string; initial: string; apply: (value: number, active: () => boolean) => Promise<boolean> }) {
  const [value, setValue] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const alive = useRef(true), guard = useRef(false), { pop } = useNavigation()
  useEffect(() => () => { alive.current = false }, [])
  const submit = async () => {
    if (guard.current) return
    guard.current = true; setBusy(true)
    try {
      if (!value.trim() || !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim()) || Number(value) > 100) throw new Error('请输入 0 到 100 之间的数值')
      const applied = await apply(Number(value), () => alive.current)
      if (applied && alive.current) pop()
      else if (alive.current) setError('调节未完成，请返回显示器列表，重新扫描后再操作')
    } catch (e) { if (alive.current) setError(message(e)) }
    finally { guard.current = false; if (alive.current) setBusy(false) }
  }
  return <Form navigationTitle={title} isLoading={busy} actions={<ActionPanel><Action.SubmitForm title="应用并核验" onSubmit={submit} /></ActionPanel>}>
    <Form.TextField id="level" title="目标百分比" value={value} onChange={setValue} />
    <Form.Description title="说明" text={error || '设置后读取硬件实际值；失败时仅在状态未被其他操作改变的情况下恢复原值。'} />
  </Form>
}
export default function MacMonitorCommand() {
  const [snapshot, setSnapshot] = useState<DisplaySnapshot | null>(null), [status, setStatus] = useState('正在读取显示器…')
  const [busy, setBusy] = useState(false), [query, setQuery] = useState(''), [filter, setFilter] = useState('all')
  const alive = useRef(true), guard = useRef(false), { push } = useNavigation()
  const refresh = async () => { const next = await scanDisplays(); if (alive.current) { setSnapshot(next); setStatus(`已连接 ${next.displays.length} 台 · 熄屏可搜索「熄屏」命令`) }; return next }
  const perform = async (work: () => Promise<void>) => {
    if (guard.current || !alive.current) return false
    guard.current = true; setBusy(true)
    try { await work(); return true }
    catch (e) { if (alive.current) { setStatus(message(e)); await showToast({ style: Toast.Style.Failure, title: '显示器操作未完成', message: message(e) }) }; return false }
    finally { guard.current = false; if (alive.current) setBusy(false) }
  }
  useEffect(() => { void perform(async () => { await refresh() }); return () => { alive.current = false } }, [])
  const change = (ids: string[], control: 'brightness' | 'contrast', value: number, active = () => true) => perform(async () => {
    if (!snapshot || !active()) throw new Error('请重新扫描显示器后操作')
    try { await setDisplays(snapshot, ids, control, value) }
    catch (e) { if (alive.current) setSnapshot(null); throw e }
    if (!alive.current) return
    await refresh()
    if (alive.current && active()) await showToast({ style: Toast.Style.Success, title: '硬件状态已读回确认' })
  })
  const edit = (d: MacDisplay, control: 'brightness' | 'contrast') => { if (!guard.current) push(<LevelForm title={`${d.name} · ${control === 'brightness' ? '亮度' : '对比度'}`} initial={String(d[control])} apply={(value, active) => change([d.id], control, value, active)} />) }
  const all = () => {
    if (guard.current) return
    const ids = snapshot?.displays.filter(d => d.canBrightness).map(d => d.id) || []
    if (!ids.length) { setStatus('当前没有可调节亮度的显示器，请重新扫描'); return }
    push(<LevelForm title={`统一调节 ${ids.length} 台显示器亮度`} initial="50" apply={(value, active) => change(ids, 'brightness', value, active)} />)
  }
  const rows = snapshot?.displays.filter(d => (filter === 'all' || (filter === 'builtin' ? d.builtIn : !d.builtIn)) && `${d.name} ${d.width}x${d.height}`.toLowerCase().includes(query.trim().toLowerCase())) || []
  return <List navigationTitle="屏幕亮度与控制" isShowingDetail={false} isLoading={busy} searchText={query} onSearchTextChange={setQuery} searchBarPlaceholder="搜索显示器名称、分辨率…"
    searchBarAccessory={<List.Dropdown value={filter} onChange={setFilter} tooltip="显示器类型"><List.Dropdown.Item value="all" title="全部显示器" /><List.Dropdown.Item value="builtin" title="内置显示器" /><List.Dropdown.Item value="external" title="外接显示器" /></List.Dropdown>}
    filterBar={{ summaryText: status, actions: [{ id: 'refresh', title: '重新扫描', onAction: () => perform(async () => { await refresh() }) }, { id: 'all', title: '统一亮度…', onAction: all }] }}>
    {rows.length ? rows.map(d => <List.Item key={d.id} id={d.id} title={d.name} icon={Icon.Monitor} subtitle={`${d.width} × ${d.height} · ${d.isPrimary ? '主显示器' : '扩展屏'}${d.reason ? ' · ' + d.reason : ''}`}
      accessories={[{ text: d.brightness === undefined ? '亮度未读取' : `亮度 ${Math.round(d.brightness)}%` }, ...(d.contrast === undefined ? [] : [{ text: `对比度 ${Math.round(d.contrast)}%` }])]}
      actions={<ActionPanel>
        {d.canBrightness && <Action title="亮度增加 10%" icon={Icon.Plus} onAction={async () => { await change([d.id], 'brightness', Math.min(100, Math.round(d.brightness! + 10))) }} />}
        {d.canBrightness && <Action title="亮度降低 10%" icon={Icon.Minus} onAction={async () => { await change([d.id], 'brightness', Math.max(0, Math.round(d.brightness! - 10))) }} />}
        {d.canBrightness && <Action title="设置亮度…" onAction={() => edit(d, 'brightness')} />}
        {d.canContrast && <Action title="设置对比度…" onAction={() => edit(d, 'contrast')} />}
      </ActionPanel>} />) : <List.Item id="empty" icon={Icon.Monitor} title={!snapshot ? '显示器状态未确认' : '没有匹配的显示器'} subtitle={!snapshot ? '请使用上方重新扫描；读取失败不会当作没有显示器' : '尝试更换搜索词或筛选条件'} />}
  </List>
}
