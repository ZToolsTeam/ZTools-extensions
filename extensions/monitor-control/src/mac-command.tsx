import React, { Action, ActionPanel, Form, Icon, List, Toast, showToast, useEffect, useLocale, useNavigation, useRef, useState } from '@ztools/declarative-ui'
import { scanDisplays, setDisplays, type DisplaySnapshot, type MacDisplay } from './mac-service.js'
import { t } from './i18n.js'

const message = (e: unknown) => e instanceof Error ? e.message : String(e)
function LevelForm({ title, initial, apply }: { title: string; initial: string; apply: (value: number, active: () => boolean) => Promise<boolean> }) {
  useLocale()
  const [value, setValue] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const alive = useRef(true), guard = useRef(false), { pop } = useNavigation()
  useEffect(() => () => { alive.current = false }, [])
  const submit = async () => {
    if (guard.current) return
    guard.current = true; setBusy(true)
    try {
      if (!value.trim() || !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim()) || Number(value) > 100) throw new Error(t('errPercentRange'))
      const applied = await apply(Number(value), () => alive.current)
      if (applied && alive.current) pop()
      else if (alive.current) setError(t('errAdjustIncomplete'))
    } catch (e) { if (alive.current) setError(message(e)) }
    finally { guard.current = false; if (alive.current) setBusy(false) }
  }
  return <Form navigationTitle={title} isLoading={busy} actions={<ActionPanel><Action.SubmitForm title={t('applyAndVerifyAction')} onSubmit={submit} /></ActionPanel>}>
    <Form.TextField id="level" title={t('targetPercentField')} value={value} onChange={setValue} />
    <Form.Description title={t('descriptionField')} text={error || t('levelFormHint')} />
  </Form>
}
export default function MacMonitorCommand() {
  useLocale()
  const [snapshot, setSnapshot] = useState<DisplaySnapshot | null>(null), [status, setStatus] = useState(() => t('loadingDisplays'))
  const [busy, setBusy] = useState(false), [query, setQuery] = useState(''), [filter, setFilter] = useState('all')
  const alive = useRef(true), guard = useRef(false), { push } = useNavigation()
  const refresh = async () => { const next = await scanDisplays(); if (alive.current) { setSnapshot(next); setStatus(t('statusConnected', { count: next.displays.length })) }; return next }
  const perform = async (work: () => Promise<void>) => {
    if (guard.current || !alive.current) return false
    guard.current = true; setBusy(true)
    try { await work(); return true }
    catch (e) { if (alive.current) { setStatus(message(e)); await showToast({ style: Toast.Style.Failure, title: t('opIncompleteToast'), message: message(e) }) }; return false }
    finally { guard.current = false; if (alive.current) setBusy(false) }
  }
  useEffect(() => { void perform(async () => { await refresh() }); return () => { alive.current = false } }, [])
  const change = (ids: string[], control: 'brightness' | 'contrast', value: number, active = () => true) => perform(async () => {
    if (!snapshot || !active()) throw new Error(t('errRescanRequired'))
    try { await setDisplays(snapshot, ids, control, value) }
    catch (e) { if (alive.current) setSnapshot(null); throw e }
    if (!alive.current) return
    await refresh()
    if (alive.current && active()) await showToast({ style: Toast.Style.Success, title: t('hardwareConfirmedToast') })
  })
  const edit = (d: MacDisplay, control: 'brightness' | 'contrast') => { if (!guard.current) push(<LevelForm title={t('formTitleSingle', { name: d.name, control: control === 'brightness' ? t('brightnessWord') : t('contrastWord') })} initial={String(d[control])} apply={(value, active) => change([d.id], control, value, active)} />) }
  const all = () => {
    if (guard.current) return
    const ids = snapshot?.displays.filter(d => d.canBrightness).map(d => d.id) || []
    if (!ids.length) { setStatus(t('noBrightnessDisplays')); return }
    push(<LevelForm title={t('formTitleAll', { count: ids.length })} initial="50" apply={(value, active) => change(ids, 'brightness', value, active)} />)
  }
  const rows = snapshot?.displays.filter(d => (filter === 'all' || (filter === 'builtin' ? d.builtIn : !d.builtIn)) && `${d.name} ${d.width}x${d.height}`.toLowerCase().includes(query.trim().toLowerCase())) || []
  return <List navigationTitle={t('navTitle')} isShowingDetail={false} isLoading={busy} searchText={query} onSearchTextChange={setQuery} searchBarPlaceholder={t('searchPlaceholder')}
    searchBarAccessory={<List.Dropdown value={filter} onChange={setFilter} tooltip={t('filterTooltip')}><List.Dropdown.Item value="all" title={t('filterAll')} /><List.Dropdown.Item value="builtin" title={t('filterBuiltin')} /><List.Dropdown.Item value="external" title={t('filterExternal')} /></List.Dropdown>}
    filterBar={{ summaryText: status, actions: [{ id: 'refresh', title: t('rescanAction'), onAction: () => perform(async () => { await refresh() }) }, { id: 'all', title: t('allBrightnessAction'), onAction: all }] }}>
    {rows.length ? rows.map(d => <List.Item key={d.id} id={d.id} title={d.name} icon={Icon.Monitor} subtitle={`${d.width} × ${d.height} · ${d.isPrimary ? t('primaryDisplay') : t('externalDisplay')}${d.reason ? ' · ' + d.reason : ''}`}
      accessories={[{ text: d.brightness === undefined ? t('brightnessUnread') : t('brightnessPercent', { value: Math.round(d.brightness) }) }, ...(d.contrast === undefined ? [] : [{ text: t('contrastPercent', { value: Math.round(d.contrast) }) }])]}
      actions={<ActionPanel>
        {d.canBrightness && <Action title={t('brightnessUpAction')} icon={Icon.Plus} onAction={async () => { await change([d.id], 'brightness', Math.min(100, Math.round(d.brightness! + 10))) }} />}
        {d.canBrightness && <Action title={t('brightnessDownAction')} icon={Icon.Minus} onAction={async () => { await change([d.id], 'brightness', Math.max(0, Math.round(d.brightness! - 10))) }} />}
        {d.canBrightness && <Action title={t('setBrightnessAction')} onAction={() => edit(d, 'brightness')} />}
        {d.canContrast && <Action title={t('setContrastAction')} onAction={() => edit(d, 'contrast')} />}
      </ActionPanel>} />) : <List.Item id="empty" icon={Icon.Monitor} title={!snapshot ? t('emptyUnconfirmedTitle') : t('emptyNoMatchTitle')} subtitle={!snapshot ? t('emptyUnconfirmedSubtitle') : t('emptyNoMatchSubtitle')} />}
  </List>
}
