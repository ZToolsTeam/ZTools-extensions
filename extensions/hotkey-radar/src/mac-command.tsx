import React, { Action, ActionPanel, Detail, Icon, List, Toast, showToast, useEffect, useLocale, useRef, useState, getLocale } from '@ztools/declarative-ui'
import { MAC_PRESETS, MAC_CATEGORIES, getMacProbeHelp, getMacShortcuts, macPlusForm, macSymbols, macSystemAssignment } from './mac-data.js'
import { probeMac, hotkeyFingerprint, type MacProbeReport, type MacProbeItem } from './mac-service.js'
import { t } from './i18n.js'

const getStatusLabel = (status: MacProbeItem['status']): string => {
  switch (status) {
    case 'registered': return t('macStatusRegistered')
    case 'occupied': return t('macStatusOccupied')
    case 'system': return t('macStatusSystem')
    case 'owned': return t('macStatusOwned')
  }
}

const getStatusExplanation = (status: MacProbeItem['status']): string => {
  switch (status) {
    case 'registered': return t('macExpRegistered')
    case 'occupied': return t('macExpOccupied')
    case 'system': return t('macExpSystem')
    case 'owned': return t('macExpOwned')
  }
}

/** 先对照自带的 macOS 系统快捷键表：系统默认组合被拒绝独占注册时，按“系统已分配（功能名）”显示，与系统设置读取到的结果一致 */
function describe(item: MacProbeItem): { tag: string; text: string } {
  const owner = item.status === 'occupied' || item.status === 'system' ? macSystemAssignment(item.combo, hotkeyFingerprint) : null
  if (!owner) return { tag: getStatusLabel(item.status), text: getStatusExplanation(item.status) }
  return {
    tag: t('macSystemAssignedTag', { owner }),
    text: item.status === 'system' ? getStatusExplanation('system') : t('macSystemAssignedExplain', { owner })
  }
}
const searchKey = (s: string) => s.toLowerCase().replace(/command/g, 'cmd').replace(/control/g, 'ctrl').replace(/alt/g, 'option').replace(/\s+/g, '')
// 宿主返回 Command+Space、Alt+… 等写法；Mac 界面统一显示与复制为 ⌘⌃⌥⇧ 符号写法
const macCombo = (combo: string) => macSymbols(combo)
function HelpAction() { return <Action.Push title={t('macHelpActionTitle')} target={<Detail markdown={getMacProbeHelp()} />} /> }
export default function MacHotkeyCommand(props: { featureCode?: string } = {}) {
  useLocale()
  const [mode, setMode] = useState(props.featureCode === 'hotkey-cheatsheet' ? 'sheet:all' : 'probe')
  const [query, setQuery] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [report, setReport] = useState<MacProbeReport | null>(null)
  const guard = useRef(false), alive = useRef(true), lastCombos = useRef(MAC_PRESETS)
  async function scan(combos: string[]) {
    if (guard.current) return
    guard.current = true; setBusy(true); setError(''); setReport(null); lastCombos.current = combos
    try { const next = await probeMac(combos); if (alive.current) setReport(next) }
    catch (e) {
      if (alive.current) { const message = e instanceof Error ? e.message : String(e); setError(message); await showToast({ style: Toast.Style.Failure, title: t('macToastProbeFailed'), message }) }
    } finally { guard.current = false; if (alive.current) setBusy(false) }
  }
  useEffect(() => { alive.current = true; if (mode === 'probe') void scan(MAC_PRESETS); return () => { alive.current = false } }, [])
  const typed = macPlusForm(query)
  const probing = mode.startsWith('probe'), q = searchKey(query), custom = typed.includes('+') || /^f\d+$/i.test(typed)
  const results = (report?.results || []).filter(r => (mode !== 'probe:unavailable' || r.status !== 'registered') && (!q || (custom ? hotkeyFingerprint(r.combo) === hotkeyFingerprint(typed) : searchKey(`${r.combo} ${macCombo(r.combo)}`).includes(q) || describe(r).tag.toLowerCase().includes(query.trim().toLowerCase()))))
  const sheets = getMacShortcuts().filter(s => (mode === 'sheet:all' || mode === `sheet:${s.category}`) && searchKey(`${s.combo} ${macSymbols(s.combo)} ${s.title} ${s.subtitle}`).includes(q))
  return <List navigationTitle={t('macNavTitle')} isShowingDetail={false} isLoading={busy} searchText={query} onSearchTextChange={setQuery} searchBarPlaceholder={probing ? t('macPlaceholderProbe') : t('macPlaceholderSheet')}
    searchBarAccessory={<List.Dropdown value={mode} onChange={value => { setMode(value); setQuery('') }} tooltip={t('macDropdownTooltip')}>
      <List.Dropdown.Item value="probe" title={t('macModeProbe')} /><List.Dropdown.Item value="probe:unavailable" title={t('macModeProbeUnavailable')} />
      <List.Dropdown.Item value="sheet:all" title={t('macModeSheetAll')} />
      {MAC_CATEGORIES.map(([id, name]) => <List.Dropdown.Item key={id} value={`sheet:${id}`} title={name} />)}
    </List.Dropdown>}
    filterBar={{ summaryText: probing ? busy ? t('macSummaryBusy') : error ? t('macSummaryError') : report ? t('macSummaryReport', { count: report.results.length, time: new Date(report.checkedAt).toLocaleTimeString(getLocale()) }) : t('macSummaryIdle') : t('macSummarySheet', { count: sheets.length }), actions: probing ? [{ id: 'rescan', title: t('macRescanBtn'), onAction: () => scan(custom ? [typed] : MAC_PRESETS) }] : [] }}>
    {probing ? <>
      {error && <List.Item id="error" title={t('macErrorItemTitle')} subtitle={error} icon={Icon.ExclamationMark} actions={<ActionPanel><Action title={t('macRetryProbeAction')} onAction={() => scan(lastCombos.current)} />{HelpAction()}</ActionPanel>} />}
      {custom && <List.Item id="custom" title={t('macCustomTitle', { combo: macCombo(typed) })} subtitle={t('macCustomSubtitle')} actions={<ActionPanel><Action title={t('macCustomProbeAction')} onAction={() => scan([typed])} /><Action.CopyToClipboard title={t('macCopyComboAction')} content={macCombo(typed)} />{HelpAction()}</ActionPanel>} />}
      {results.map(item => { const d = describe(item); return <List.Item key={item.combo} id={`probe-${item.combo}`} title={macCombo(item.combo)} subtitle={d.text} accessories={[{ tag: d.tag }]} actions={<ActionPanel><Action title={t('macReprobeComboAction')} onAction={() => scan([item.combo])} /><Action.CopyToClipboard title={t('macCopyComboAction')} content={macCombo(item.combo)} />{HelpAction()}</ActionPanel>} /> })}
      {!busy && !error && !custom && !results.length && <List.Item id="empty" title={report ? t('macEmptyReportTitle') : t('macEmptyIdleTitle')} subtitle={t('macEmptySubtitle')} actions={<ActionPanel><Action title={t('macProbePresetsAction')} onAction={() => scan(MAC_PRESETS)} />{HelpAction()}</ActionPanel>} />}
    </> : sheets.length ? sheets.map(item => <List.Item key={item.id} id={item.id} title={`${macSymbols(item.combo)} — ${item.title}`} subtitle={item.subtitle} accessories={[{ tag: MAC_CATEGORIES.find(([id]) => id === item.category)?.[1] || '' }]} actions={<ActionPanel><Action.CopyToClipboard title={t('macCopyShortcutAction')} content={macSymbols(item.combo)} /><Action title={t('macProbeGlobalAction')} onAction={() => { setMode('probe'); setQuery(''); void scan([item.combo]) }} />{HelpAction()}</ActionPanel>} />) : <List.Item id="sheet-empty" title={t('macSheetEmptyTitle')} subtitle={t('macSheetEmptySubtitle')} />}
  </List>
}
