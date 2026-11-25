import React, { Action, ActionPanel, Icon, List, LocalStorage, Toast, showToast, useEffect, useLocale, useRef, useState, getLocale } from '@ztools/declarative-ui'
import {
  cancelMacProjects, describeOpenError, filterMacProjects, normalizePinnedProjectIds,
  openMacProject, PINNED_PROJECTS_STORAGE_KEY, projectOperationId, revealMacProjectInFolder,
  scanMacProjects, sortProjectsWithPinned, togglePinnedProjectId,
  type MacProject, type MacProjectsReport
} from './mac-service.js'
import { t } from './i18n.js'

export default function MacProjectsCommand({ featureCode, platform = 'macos' }: { featureCode?: string; platform?: 'macos' | 'windows' }) {
  useLocale()
  const [report, setReport] = useState<MacProjectsReport | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [query, setQuery] = useState(''), [family, setFamily] = useState(featureCode === 'projects-vscode-cursor' ? 'vsc' : featureCode === 'projects-jetbrains' ? 'jetbrains' : 'all'), [hideMissing, setHideMissing] = useState(false)
  const [pinnedIds, setPinnedIds] = useState<string[]>([])
  const alive = useRef(true), guard = useRef(false), pending = useRef<string | null>(null), pendingAction = useRef<'scan' | 'open' | null>(null), cancelled = useRef(false)
  const scan = async () => {
    if (guard.current) return
    guard.current = true; cancelled.current = false; setBusy(true); setError(''); setReport(null)
    const operationId = projectOperationId(); pending.current = operationId; pendingAction.current = 'scan'
    try { const data = await scanMacProjects(operationId); if (alive.current && !cancelled.current) setReport(data) }
    catch (e) { if (alive.current && !cancelled.current) setError(e instanceof Error ? e.message : String(e)) }
    finally { pending.current = null; pendingAction.current = null; guard.current = false; if (alive.current) setBusy(false) }
  }
  const stop = async () => {
    cancelled.current = true
    const message = pendingAction.current === 'scan' ? t('statusScanStopped') : t('statusOpenCancelled')
    try { if (pending.current) await cancelMacProjects(pending.current); if (alive.current) setError(message) }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)) }
  }
  useEffect(() => {
    alive.current = true; void scan()
    void LocalStorage.getItem(PINNED_PROJECTS_STORAGE_KEY)
      .then(raw => { if (alive.current) setPinnedIds(normalizePinnedProjectIds(raw)) })
      .catch(() => { if (alive.current) setPinnedIds([]) })
    return () => { alive.current = false; cancelled.current = true; if (pending.current) void cancelMacProjects(pending.current).catch(e => console.error('Stop project scan failed', e)) }
  }, [])
  const open = async (item: MacProject, action: 'open' | 'terminal') => {
    if (guard.current) return
    // 扫描时已确认路径不存在：直接如实提示，不再向系统发送注定失败的打开请求
    if (item.pathState === 'missing') { await showToast({ style: Toast.Style.Failure, title: t('toastPathMissingTitle'), message: t('toastPathMissingMsg', { path: item.path }) }); return }
    guard.current = true; cancelled.current = false; pending.current = item.id; pendingAction.current = 'open'; setBusy(true); setError('')
    try { await openMacProject(item, action); if (alive.current && !cancelled.current) await showToast({ style: Toast.Style.Success, title: action === 'open' ? t('toastOpenedEditor', { editor: item.editorName }) : t('toastOpenedTerminal') }) }
    catch (e) { if (alive.current && !cancelled.current) await showToast({ style: Toast.Style.Failure, title: t('toastOpenFailed'), message: describeOpenError(e, item) }) }
    finally { if (pending.current === item.id) { pending.current = null; pendingAction.current = null }; guard.current = false; if (alive.current) setBusy(false) }
  }
  const reveal = async (item: MacProject) => {
    if (item.pathState === 'missing') { await showToast({ style: Toast.Style.Failure, title: t('toastPathMissingTitle'), message: t('toastPathMissingMsg', { path: item.path }) }); return }
    try {
      await revealMacProjectInFolder(item)
      if (alive.current) await showToast({ style: Toast.Style.Success, title: platform === 'macos' ? t('toastRevealedFinder') : t('toastRevealedExplorer'), message: item.path })
    } catch (e) {
      if (alive.current) await showToast({ style: Toast.Style.Failure, title: t('toastRevealFailed'), message: describeOpenError(e, item) })
    }
  }
  const togglePin = async (item: MacProject) => {
    const { next, pinned } = togglePinnedProjectId(pinnedIds, item.id)
    try {
      await LocalStorage.setItem(PINNED_PROJECTS_STORAGE_KEY, next)
      if (alive.current) {
        setPinnedIds(next)
        await showToast({ style: Toast.Style.Success, title: pinned ? t('toastPinned') : t('toastUnpinned'), message: item.name })
      }
    } catch (e) {
      if (alive.current) await showToast({ style: Toast.Style.Failure, title: t('toastPinSaveFailed'), message: e instanceof Error ? e.message : String(e) })
    }
  }
  const pinnedSet = new Set(pinnedIds)
  const rows = sortProjectsWithPinned(filterMacProjects(report?.projects || [], query, family, hideMissing), pinnedIds)
  const revealTitle = platform === 'macos' ? t('actionRevealInFinder') : t('actionRevealInExplorer')
  return <List isShowingDetail={false} isLoading={busy} searchText={query} onSearchTextChange={setQuery} searchBarPlaceholder={t('searchPlaceholder')}
    searchBarAccessory={<List.Dropdown value={family} tooltip={t('filterTooltip')} onChange={setFamily}><List.Dropdown.Item title={t('filterAll')} value="all" /><List.Dropdown.Item title="VS Code / Cursor / Trae / Windsurf" value="vsc" /><List.Dropdown.Item title="JetBrains" value="jetbrains" /></List.Dropdown>}
    filterBar={{ summaryText: busy ? (pendingAction.current === 'scan' ? t('summaryScanning') : t('summaryOpening')) : error || t('summaryReady', { count: rows.length, sources: report?.sourcesRead || 0, skipped: report?.skippedRemote ? t('summarySkippedRemote', { count: report.skippedRemote }) : '' }), actions: [
      // 空状态条目的主动作已是“重新扫描”，此时工具栏不再重复；扫描/打开进行中始终保留停止入口
      ...(!busy && !rows.length ? [] : [{ id: 'scan', title: busy ? (pendingAction.current === 'scan' ? t('actionStopScan') : t('actionCancelOpen')) : t('actionRescan'), onAction: () => busy ? stop() : scan() }]),
      { id: 'missing', title: hideMissing ? t('actionShowMissing') : t('actionHideMissing'), onAction: () => setHideMissing(!hideMissing) }
    ] }}>
    {rows.map(item => {
      const isPinned = pinnedSet.has(item.id)
      return <List.Item key={item.id} id={item.id} title={item.name} subtitle={item.path} icon={isPinned ? Icon.Pin : Icon.Folder} accessories={[
        ...(isPinned ? [{ tag: t('tagPinned') }] : []),
        { tag: item.editorName }, ...(item.gitBranch ? [{ text: item.gitBranch }] : []),
        ...(item.pathState === 'available' ? [] : [{ tag: item.pathState === 'missing' ? t('tagPathMissing') : t('tagPathUnreadable') }]),
        ...(item.lastOpenedMs ? [{ text: new Date(item.lastOpenedMs).toLocaleDateString(getLocale()) }] : [])
      ]} actions={<ActionPanel>
        <Action title={t('actionOpenWithEditor', { editor: item.editorName })} onAction={() => open(item, 'open')} />
        <Action title={t('actionOpenInTerminal')} shortcut={{ modifiers: ['cmd'], key: 'enter' }} onAction={() => open(item, 'terminal')} />
        <Action title={revealTitle} icon={Icon.Folder} onAction={() => reveal(item)} />
        <Action title={isPinned ? t('actionUnpinProject') : t('actionPinProject')} icon={Icon.Pin} onAction={() => togglePin(item)} />
        <Action.CopyToClipboard title={t('actionCopyPath')} content={item.path} />
        {item.gitBranch && <Action.CopyToClipboard title={t('actionCopyBranch')} content={item.gitBranch} />}
      </ActionPanel>} />
    })}
    {!rows.length && !busy && <List.Item id="empty" title={error || (report?.projects.length ? t('emptyNoMatch') : t('emptyNoHistory'))} subtitle={error ? t('emptyErrorSub') : t('emptyDefaultSub')}
      actions={<ActionPanel><Action title={t('actionRescan')} icon={Icon.ArrowClockwise} onAction={() => scan()} /></ActionPanel>} />}
    {report?.warnings.map((warning, index) => <List.Item key={index} id={`warning-${index}`} title={t('warningPartialHistory')} subtitle={warning} />)}
  </List>
}
