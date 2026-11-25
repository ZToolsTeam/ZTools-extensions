import React, { Action, ActionPanel, Icon, List, Toast, confirmAlert, showToast, useEffect, useLocale, useRef, useState, getLocale } from '@ztools/declarative-ui'
import { filterStartup, scanStartup, startupInvoke, startupOperation, type StartupReport, type MacStartupItem } from './mac-service.js'
import { t } from './i18n.js'

export default function MacStartupCommand({ featureCode }: { featureCode?: string }) {
  useLocale()
  const [report, setReport] = useState<StartupReport | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [query, setQuery] = useState(''), [filter, setFilter] = useState(featureCode === 'startup-services' ? 'service' : featureCode === 'startup-tasks' ? 'task' : 'all')
  const alive = useRef(true), occupied = useRef(false), pending = useRef<string | null>(null), cancelled = useRef(false)
  const load = async () => {
    const operationId = startupOperation(); pending.current = operationId
    const data = await scanStartup(operationId)
    if (alive.current && !cancelled.current) setReport(data)
  }
  const perform = async (action = 'scan', fields: Record<string, unknown> = {}) => {
    if (occupied.current) { await showToast({ style: Toast.Style.Failure, title: t('macToastBusyTitle'), message: t('macToastBusyMsg') }); return }
    occupied.current = true; cancelled.current = false; setBusy(true); setError('')
    if (action === 'scan') setReport(null)
    try {
      if (action !== 'scan') {
        const operationId = startupOperation(); pending.current = operationId
        const result = await startupInvoke('startup_manager', { action, operationId, ...fields })
        if (!alive.current || cancelled.current) return
        if (action === 'settings') { if (result.accepted !== true) throw new Error(t('macErrSettingsNotOpened')); return }
        if (typeof result.backupId !== 'string' || typeof result.message !== 'string' ||
            (action === 'set-enabled' ? result.enabled !== fields.enabled : action === 'remove' ? result.removed !== true : result.restored !== true && typeof result.enabled !== 'boolean')) throw new Error(t('macErrReceiptIncomplete'))
        await showToast({ style: Toast.Style.Success, title: action === 'remove' ? t('macToastRemoved') : action === 'restore' ? t('macToastRestored') : result.enabled ? t('macToastAllowed') : t('macToastBlocked'), message: result.message })
      }
      if (alive.current && !cancelled.current) await load()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (!alive.current || cancelled.current) return
      if (action === 'scan' || action === 'settings') { if (action === 'scan') setReport(null); setError(message); return }
      // 修改失败后系统状态可能已部分变化：如实提示失败，并重新读取列表，避免继续显示旧状态
      setError(message)
      await showToast({ style: Toast.Style.Failure, title: action === 'remove' ? t('macToastRemoveFailed') : action === 'restore' ? t('macToastRestoreFailed') : t('macToastToggleFailed'), message })
      try { if (alive.current && !cancelled.current) await load() }
      catch (reloadError) { if (alive.current && !cancelled.current) { setReport(null); setError(t('macErrRescanAlsoFailed', { msg: message, reload: reloadError instanceof Error ? reloadError.message : String(reloadError) })) } }
    } finally { pending.current = null; occupied.current = false; if (alive.current) setBusy(false) }
  }
  const stop = async () => {
    cancelled.current = true
    setError(t('macStatusStopping'))
    try {
      if (pending.current) await startupInvoke('startup_manager', { action: 'cancel', operationId: pending.current })
      if (alive.current) { setReport(null); setError(t('macStatusStopped')) }
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)) }
  }
  const remove = async (item: MacStartupItem) => {
    if (occupied.current) return
    const confirmed = await confirmAlert({ title: t('macConfirmRemoveTitle', { label: item.label }), message: t('macConfirmRemoveMsg', { program: item.program }) })
    if (confirmed && alive.current) await perform('remove', { id: item.id })
  }
  useEffect(() => {
    alive.current = true; void perform()
    return () => { alive.current = false; cancelled.current = true; if (pending.current) void startupInvoke('startup_manager', { action: 'cancel', operationId: pending.current }).catch(e => console.error('Cancel startup manager failed', e)) }
  }, [])
  const rows = filterStartup(report?.items || [], query, filter)
  const backups = (report?.backups || []).filter(b => b.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  return <List isShowingDetail={false} isLoading={busy} searchText={query} onSearchTextChange={setQuery} searchBarPlaceholder={t('macSearchPlaceholder')}
    searchBarAccessory={<List.Dropdown value={filter} onChange={setFilter} tooltip={t('macFilterTooltip')}>
      <List.Dropdown.Item value="all" title={t('macFilterAll')} /><List.Dropdown.Item value="user" title={t('macFilterUser')} /><List.Dropdown.Item value="service" title={t('macFilterService')} />
      <List.Dropdown.Item value="task" title={t('macFilterTask')} /><List.Dropdown.Item value="disabled" title={t('macFilterDisabled')} /><List.Dropdown.Item value="broken" title={t('macFilterBroken')} /><List.Dropdown.Item value="backups" title={t('macFilterBackups')} />
    </List.Dropdown>}
    filterBar={{ summaryText: error || (busy ? t('macSummaryBusy') : filter === 'backups' ? t('macSummaryBackups', { count: backups.length }) : t('macSummaryItems', { count: rows.length })), actions: [
      { id: 'scan', title: busy ? t('macActionStop') : t('actionRescan'), onAction: () => busy ? stop() : perform() },
      { id: 'settings', title: t('macActionSettings'), onAction: () => perform('settings') }
    ] }}>
    {filter !== 'backups' && rows.map(item => <List.Item key={item.id} id={item.id} title={item.label} subtitle={item.program} icon={Icon.Gear}
      accessories={[{ tag: item.enabled ? t('macTagAllowed') : t('macTagBlocked') }, { text: item.running ? `${t('macStateRunning')}${item.pid ? ` · PID ${item.pid}` : ''}` : item.loaded ? t('macStateLoaded') : t('macStateUnloaded') },
        ...(item.scheduled ? [{ tag: t('macTagTask') }] : []), ...(item.requiresAdmin ? [{ tag: t('macTagAdmin') }] : []), ...(item.programState === 'missing' ? [{ tag: t('macTagMissing') }] : [])]}
      actions={<ActionPanel>
        <Action title={item.blockedReason ? t('macActionViewBlocked') : item.enabled ? t('macActionBlock') : t('macActionAllow')} onAction={async () => {
          if (item.blockedReason) await showToast({ style: Toast.Style.Failure, title: t('macToastBlockedItem'), message: item.blockedReason })
          else await perform('set-enabled', { id: item.id, enabled: !item.enabled })
        }} />
        <Action.CopyToClipboard title={t('macActionCopyProgram')} content={item.program} />
        <Action.CopyToClipboard title={t('macActionCopyPlist')} content={item.file} />
        <Action.CopyToClipboard title={t('macActionCopyArgs')} content={JSON.stringify(item.args)} />
        {item.programState === 'missing' && !item.blockedReason && <Action title={t('macActionRemoveBroken')} icon={Icon.Trash} style={Action.Style.Destructive} onAction={() => remove(item)} />}
      </ActionPanel>} />)}
    {filter === 'backups' && backups.map(backup => <List.Item key={backup.id} id={backup.id} title={backup.label} subtitle={`${new Date(backup.createdAt).toLocaleString(getLocale())} · ${backup.kind === 'remove' ? t('macBackupKindRemove') : `${backup.beforeEnabled ? t('macBackupAllow') : t('macBackupBlock')} → ${backup.afterEnabled ? t('macBackupAllow') : t('macBackupBlock')}`}`}
      actions={<ActionPanel><Action title={backup.kind === 'remove' ? t('macActionRestoreConfig') : t('macActionRestoreToggle', { state: backup.beforeEnabled ? t('macBackupAllow') : t('macBackupBlock') })} onAction={() => perform('restore', { id: backup.id })} /></ActionPanel>} />)}
    {!busy && (filter === 'backups' ? !backups.length : !rows.length) && <List.Item id="empty" title={error || (filter === 'backups' ? t('macEmptyBackups') : t('macEmptyItems'))}
      subtitle={t('macEmptySubtitle')}
      actions={<ActionPanel><Action title={t('actionRescan')} icon={Icon.ArrowClockwise} onAction={() => perform()} /><Action title={t('macActionOpenSettings')} onAction={() => perform('settings')} /></ActionPanel>} />}
    {filter !== 'backups' && report?.warnings.map((warning, index) => <List.Item key={`warning-${index}`} id={`warning-${index}`} icon={Icon.ExclamationMark} title={t('macWarningTitle')} subtitle={warning}
      actions={<ActionPanel><Action.CopyToClipboard title={t('macActionCopyError')} content={warning} /><Action title={t('actionRescan')} icon={Icon.ArrowClockwise} onAction={() => perform()} /></ActionPanel>} />)}
  </List>
}
