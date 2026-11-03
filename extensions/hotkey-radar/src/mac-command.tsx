import React, { Action, ActionPanel, Detail, Icon, List, Toast, showToast, useEffect, useRef, useState } from '@ztools/declarative-ui'
import { MAC_PRESETS, MAC_CATEGORIES, MAC_SHORTCUTS, MAC_PROBE_HELP, macPlusForm, macSymbols, macSystemAssignment } from './mac-data.js'
import { probeMac, hotkeyFingerprint, type MacProbeReport, type MacProbeItem } from './mac-service.js'
const label: Record<MacProbeItem['status'], string> = { registered: '可独占注册', occupied: '存在独占占用', system: '系统已分配', owned: 'ZTools 已注册' }
const explanation: Record<MacProbeItem['status'], string> = { registered: '本次独占注册成功并已释放；无法排除共享注册与应用内冲突', occupied: '检测到独占注册冲突；系统不提供占用程序信息', system: '当前系统键盘设置已启用此组合，检测没有修改它', owned: '当前客户端已持有此快捷键，原有绑定保持不变' }
/** 先对照自带的 macOS 系统快捷键表：系统默认组合被拒绝独占注册时，按“系统已分配（功能名）”显示，与系统设置读取到的结果一致 */
function describe(item: MacProbeItem): { tag: string; text: string } {
  const owner = item.status === 'occupied' || item.status === 'system' ? macSystemAssignment(item.combo, hotkeyFingerprint) : null
  if (!owner) return { tag: label[item.status], text: explanation[item.status] }
  return { tag: `系统已分配（${owner}）`, text: item.status === 'system' ? explanation.system : `macOS 默认将此组合分配给${owner}，系统拒绝了独占注册；可在系统设置“键盘 → 键盘快捷键”中修改` }
}
const searchKey = (s: string) => s.toLowerCase().replace(/command/g, 'cmd').replace(/control/g, 'ctrl').replace(/alt/g, 'option').replace(/\s+/g, '')
// 宿主返回 Command+Space、Alt+… 等写法；Mac 界面统一显示与复制为 ⌘⌃⌥⇧ 符号写法
const macCombo = (combo: string) => macSymbols(combo)
function HelpAction() { return <Action.Push title="检测范围与排查方法" target={<Detail markdown={MAC_PROBE_HELP} />} /> }
export default function MacHotkeyCommand(props: { featureCode?: string } = {}) {
  const [mode, setMode] = useState(props.featureCode === 'hotkey-cheatsheet' ? 'sheet:all' : 'probe')
  const [query, setQuery] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [report, setReport] = useState<MacProbeReport | null>(null)
  const guard = useRef(false), alive = useRef(true), lastCombos = useRef(MAC_PRESETS)
  async function scan(combos: string[]) {
    if (guard.current) return
    guard.current = true; setBusy(true); setError(''); setReport(null); lastCombos.current = combos
    try { const next = await probeMac(combos); if (alive.current) setReport(next) }
    catch (e) {
      if (alive.current) { const message = e instanceof Error ? e.message : String(e); setError(message); await showToast({ style: Toast.Style.Failure, title: '检测未完成', message }) }
    } finally { guard.current = false; if (alive.current) setBusy(false) }
  }
  useEffect(() => { alive.current = true; if (mode === 'probe') void scan(MAC_PRESETS); return () => { alive.current = false } }, [])
  const typed = macPlusForm(query)
  const probing = mode.startsWith('probe'), q = searchKey(query), custom = typed.includes('+') || /^f\d+$/i.test(typed)
  const results = (report?.results || []).filter(r => (mode !== 'probe:unavailable' || r.status !== 'registered') && (!q || (custom ? hotkeyFingerprint(r.combo) === hotkeyFingerprint(typed) : searchKey(`${r.combo} ${macCombo(r.combo)}`).includes(q) || describe(r).tag.includes(query.trim()))))
  const sheets = MAC_SHORTCUTS.filter(s => (mode === 'sheet:all' || mode === `sheet:${s.category}`) && searchKey(`${s.combo} ${macSymbols(s.combo)} ${s.title} ${s.subtitle}`).includes(q))
  return <List navigationTitle="热键侦测与快捷键速查" isShowingDetail={false} isLoading={busy} searchText={query} onSearchTextChange={setQuery} searchBarPlaceholder={probing ? '输入组合键后回车检测，如 ⇧⌘P 或 Shift+Cmd+P' : '搜索 Mac 快捷键或功能名'}
    searchBarAccessory={<List.Dropdown value={mode} onChange={value => { setMode(value); setQuery('') }} tooltip="切换检测或速查">
      <List.Dropdown.Item value="probe" title="快捷键检测" /><List.Dropdown.Item value="probe:unavailable" title="已占用 / 已分配 / 已注册" />
      <List.Dropdown.Item value="sheet:all" title="全部 Mac 快捷键" />
      {MAC_CATEGORIES.map(([id, name]) => <List.Dropdown.Item key={id} value={`sheet:${id}`} title={name} />)}
    </List.Dropdown>}
    filterBar={{ summaryText: probing ? busy ? '正在检测，旧结果已清除' : error ? '检测未完成' : report ? `本次检测 ${report.results.length} 组 · ${new Date(report.checkedAt).toLocaleTimeString()} · 无法排除共享注册与应用内冲突` : '选择候选组合或输入需要检测的快捷键' : `Mac 默认快捷键 · ${sheets.length} 条 · 自定义绑定以应用设置为准`, actions: probing ? [{ id: 'rescan', title: '重新检测', onAction: () => scan(custom ? [typed] : MAC_PRESETS) }] : [] }}>
    {probing ? <>
      {error && <List.Item id="error" title="检测失败" subtitle={error} icon={Icon.ExclamationMark} actions={<ActionPanel><Action title="重试检测" onAction={() => scan(lastCombos.current)} />{HelpAction()}</ActionPanel>} />}
      {custom && <List.Item id="custom" title={`检测 ${macCombo(typed)}`} subtitle="按 Enter 检测此组合；⌘ 与 ⌃ 分开识别" actions={<ActionPanel><Action title="检测输入的快捷键" onAction={() => scan([typed])} /><Action.CopyToClipboard title="复制组合键" content={macCombo(typed)} />{HelpAction()}</ActionPanel>} />}
      {results.map(item => { const d = describe(item); return <List.Item key={item.combo} id={`probe-${item.combo}`} title={macCombo(item.combo)} subtitle={d.text} accessories={[{ tag: d.tag }]} actions={<ActionPanel><Action title="重新检测此组合" onAction={() => scan([item.combo])} /><Action.CopyToClipboard title="复制组合键" content={macCombo(item.combo)} />{HelpAction()}</ActionPanel>} /> })}
      {!busy && !error && !custom && !results.length && <List.Item id="empty" title={report ? '没有匹配的检测结果' : '检测常见 Mac 组合键'} subtitle="也可以在搜索框输入自定义组合" actions={<ActionPanel><Action title="检测常见组合" onAction={() => scan(MAC_PRESETS)} />{HelpAction()}</ActionPanel>} />}
    </> : sheets.length ? sheets.map(item => <List.Item key={item.id} id={item.id} title={`${macSymbols(item.combo)} — ${item.title}`} subtitle={item.subtitle} accessories={[{ tag: MAC_CATEGORIES.find(([id]) => id === item.category)?.[1] || '' }]} actions={<ActionPanel><Action.CopyToClipboard title="复制 Mac 快捷键" content={macSymbols(item.combo)} /><Action title="检测全局注册情况" onAction={() => { setMode('probe'); setQuery(''); void scan([item.combo]) }} />{HelpAction()}</ActionPanel>} />) : <List.Item id="sheet-empty" title="没有匹配的快捷键" subtitle="试试应用名下拉筛选或功能关键词" />}
  </List>
}
