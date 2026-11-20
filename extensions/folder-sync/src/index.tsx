import React, { Action, ActionPanel, Icon, List, Toast, showToast, useEffect, useLocale, useMemo, useRef, useState } from '@ztools/declarative-ui'
import { t } from './i18n.js'
import { createCompatFileInputProps, type CompatFileInputPayload } from './host-compat.js'
import { chooseFolder, compareFolderTrees, executeFolderSync, filterSyncDiffItems, formatSyncBytes, revealRecovery } from './sync-service.js'
import type { DiffFilterType, FolderSyncDiffItem, SyncMode } from './types.js'

// 镜像模式依赖宿主的安全回收（目前只有 macOS 实现，移入废纸篓），其他平台不提供该选项
const supportsMirror = () => typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent || '')

/** folder-sync-compare 选好两个目录后直接比对；工作台命令选完目录先调整模式再比对 */
export function FolderSyncCommand({ featureCode = 'folder-sync-workbench' }: { featureCode?: string } = {}) {
  useLocale()
  const compareOnly = featureCode === 'folder-sync-compare'
  const [sourceDir, setSourceDir] = useState(''), [targetDir, setTargetDir] = useState('')
  const [syncMode, setSyncMode] = useState<SyncMode>('incremental'), [ignoreDevJunk, setIgnoreDevJunk] = useState(true)
  const [diffFilter, setDiffFilter] = useState<DiffFilterType>('all'), [searchText, setSearchText] = useState('')
  const [diffItems, setDiffItems] = useState<FolderSyncDiffItem[]>([]), [checked, setChecked] = useState<Set<string>>(new Set())
  const [planId, setPlanId] = useState(''), [busy, setBusy] = useState(false), [recovery, setRecovery] = useState<string[]>([])
  const [status, setStatus] = useState(() => t('statusInit'))
  const controller = useRef<AbortController | null>(null), mounted = useRef(true)
  const sourceRef = useRef(sourceDir), targetRef = useRef(targetDir)
  sourceRef.current = sourceDir
  targetRef.current = targetDir
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort() } }, [])
  const invalidate = () => { setPlanId(''); setDiffItems([]); setChecked(new Set()); setStatus(t('statusConfigChanged')) }
  const applyInputDirs = (files: string[], payload?: CompatFileInputPayload) => {
    if (busy) return
    const dirs = files.map(f => (f || '').trim()).filter(Boolean)
    if (dirs.length === 0) return
    const fieldId = (payload?.targetFieldId || '').toLowerCase()
    let nextSource = sourceRef.current
    let nextTarget = targetRef.current
    if (fieldId && /target|dest|right/.test(fieldId)) {
      nextTarget = dirs[0]
      targetRef.current = nextTarget
      setTargetDir(nextTarget)
    } else if (fieldId && /source|src|left/.test(fieldId)) {
      nextSource = dirs[0]
      sourceRef.current = nextSource
      setSourceDir(nextSource)
    } else if (dirs.length >= 2) {
      nextSource = dirs[0]
      nextTarget = dirs[1]
      sourceRef.current = nextSource
      targetRef.current = nextTarget
      setSourceDir(nextSource)
      setTargetDir(nextTarget)
    } else {
      const single = dirs[0]
      if (!sourceRef.current) {
        nextSource = single
        sourceRef.current = nextSource
        setSourceDir(nextSource)
      } else if (!targetRef.current) {
        nextTarget = single
        targetRef.current = nextTarget
        setTargetDir(nextTarget)
      } else {
        nextSource = single
        sourceRef.current = nextSource
        setSourceDir(nextSource)
      }
    }
    invalidate()
    if (compareOnly && nextSource && nextTarget) {
      void run(signal => compareDirs(nextSource, nextTarget, signal))
    }
  }
  const fileInputProps = createCompatFileInputProps((files, payload) => {
    applyInputDirs(files, payload)
  }, { allowDirectories: true })
  const run = async (work: (signal: AbortSignal) => Promise<void>) => {
    if (controller.current) return
    const active = new AbortController(); controller.current = active; setBusy(true)
    try { await work(active.signal) }
    catch (error) {
      if (mounted.current) {
        const text = active.signal.aborted ? t('statusAborted') : error instanceof Error ? error.message : String(error)
        setPlanId(''); setStatus(text)
        await showToast({ style: Toast.Style.Failure, title: text })
      }
    } finally { controller.current = null; if (mounted.current) setBusy(false) }
  }
  const compareDirs = async (source: string, target: string, signal: AbortSignal) => {
    if (!source || !target) throw new Error(t('errSelectBothDirs'))
    invalidate(); setStatus(t('statusComparing'))
    const result = await compareFolderTrees({ sourceDir: source, targetDir: target, syncMode, ignoreDevJunk }, signal)
    if (!mounted.current) return
    setDiffItems(result.diffs); setPlanId(result.planId)
    setChecked(new Set(result.diffs.filter(item => item.direction !== 'delete-dst' && item.direction !== 'conflict').map(item => item.relPath)))
    setStatus(result.diffs.length ? t('statusCompareDone', { count: result.diffs.length, trashHint: result.diffs.some(item => item.direction === 'delete-dst') ? t('statusCompareTrashHint') : '' }) : t('statusCompareEqual'))
  }
  const pick = () => run(async signal => {
    const source = await chooseFolder(t('dialogSelectSource')); if (!source) return
    const target = await chooseFolder(t('dialogSelectTarget')); if (!target || !mounted.current) return
    setSourceDir(source); setTargetDir(target); invalidate()
    if (compareOnly) { signal.throwIfAborted(); await compareDirs(source, target, signal) }
  })
  const compare = () => run(signal => compareDirs(sourceDir, targetDir, signal))
  const execute = () => run(async signal => {
    if (!planId || !checked.size) throw new Error(t('errCompareAndCheckFirst'))
    const id = planId; setPlanId(''); setStatus(t('statusSyncing'))
    const result = await executeFolderSync(id, [...checked], signal)
    if (!mounted.current) return
    setRecovery(result.recoveryPaths); setChecked(new Set())
    const summary = t('syncSummary', {
      synced: result.syncedCount,
      deletedPart: result.deletedCount ? t('syncDeletedPart', { count: result.deletedCount }) : '',
      remaining: result.remainingCount
    })
    setStatus(`${summary}${result.error ? `; ${result.error}` : t('syncBackupHint')}`)
    await showToast({ style: result.ok ? Toast.Style.Success : Toast.Style.Failure, title: summary, message: result.error })
  })
  const mirror = supportsMirror()
  const visible = useMemo(() => filterSyncDiffItems(diffItems, diffFilter, searchText), [diffItems, diffFilter, searchText])
  const actionable = visible.filter(item => item.direction !== 'conflict')
  const selected = diffItems.filter(item => checked.has(item.relPath))
  const counts = { add: selected.filter(item => item.diffType === 'added' || item.diffType === 'reverse-add').length,
    replace: selected.filter(item => item.diffType === 'modified').length, trash: selected.filter(item => item.direction === 'delete-dst').length }
  const all = actionable.length > 0 && actionable.every(item => checked.has(item.relPath))
  const toggle = (names: string[]) => {
    if (busy || !planId) return
    setChecked(previous => { const next = new Set(previous), remove = names.every(name => next.has(name)); for (const name of names) { if (remove) next.delete(name); else next.add(name) } return next })
  }
  const ready = Boolean(sourceDir && targetDir)
  // 没有可选的清单行时（未选目录、未比对或筛选为空），底栏 Enter 落在这里
  const emptyActions = <ActionPanel>
    {ready && !planId ? <Action title={t('actionStartCompare')} icon={Icon.MagnifyingGlass} onAction={compare} /> : null}
    <Action title={ready ? t('actionRepickDirs') : t('actionPickDirsEllipsis')} icon={Icon.Folder} onAction={pick} />
  </ActionPanel>
  return <List {...fileInputProps} navigationTitle={compareOnly ? t('navTitleCompare') : t('navTitleSync')} isLoading={busy} isShowingDetail={false} searchText={searchText} onSearchTextChange={setSearchText}
    searchBarPlaceholder={t('searchPlaceholder')} searchBarAccessory={<List.Dropdown value={diffFilter} onChange={value => setDiffFilter(value as DiffFilterType)}>
      <List.Dropdown.Item title={t('filterAll')} value="all" /><List.Dropdown.Item title={t('filterAdded')} value="added" />
      <List.Dropdown.Item title={t('filterModified')} value="modified" />{mirror && <List.Dropdown.Item title={t('filterOrphan')} value="orphan" />}<List.Dropdown.Item title={t('filterConflict')} value="conflict" />
    </List.Dropdown>}
    actions={emptyActions}
    filterBar={{ summaryText: status, actions: busy ? [{ id: 'cancel', title: t('btnStop'), onAction: () => controller.current?.abort() }] : [
      { id: 'pick', title: t('btnPickDirs'), onAction: pick }, { id: 'compare', title: t('btnRecompare'), onAction: compare }] }}
    workbenchPanel={{ title: t('wbTitle'), subtitle: t('wbSubtitle'), fields: [
      { id: 'mode', label: t('fieldModeLabel'), type: 'select', value: syncMode, options: [{ label: t('modeIncremental'), value: 'incremental' }, { label: t('modeTwoWay'), value: 'two-way' }, ...(mirror ? [{ label: t('modeMirror'), value: 'mirror' }] : [])], onChange: value => { if (!busy) { setSyncMode(value as SyncMode); invalidate() } } },
      { id: 'ignore', label: t('fieldIgnoreLabel'), type: 'toggle', value: ignoreDevJunk, onChange: value => { if (!busy) { setIgnoreDevJunk(Boolean(value)); invalidate() } } },
      { id: 'source', label: t('fieldSourceLabel'), type: 'info', value: sourceDir || t('notSelected') },
      { id: 'target', label: t('fieldTargetLabel'), type: 'info', value: targetDir || t('notSelected') },
      { id: 'limit', label: t('fieldLimitLabel'), type: 'info', value: t('fieldLimitValue') },
      ...recovery.map((file, index) => ({ id: `backup-${index}`, label: t('fieldBackupLabel'), type: 'info' as const, value: file }))
    ], previewCard: { title: t('cardSelectedTitle', { count: selected.length }), subtitle: t('cardSelectedSub', { add: counts.add, replace: counts.replace, trashPart: mirror ? t('cardTrashPart', { count: counts.trash }) : '', size: formatSyncBytes(selected.filter(item => item.direction !== 'delete-dst').reduce((sum, item) => sum + item.sizeBytes, 0)) }) } }}
    subList={{ title: t('subListTitle'), subtitle: t('subListSubtitle'), emptyText: planId ? t('subListEmptyPlan') : t('subListEmptyIdle'),
      checkable: Boolean(planId && actionable.length), checked: all ? true : actionable.some(item => checked.has(item.relPath)) ? 'indeterminate' : false,
      onCheckChange: () => toggle(actionable.map(item => item.relPath)), items: visible.map(item => <List.Item key={item.relPath} id={item.relPath}
        title={item.relPath} subtitle={item.reasonText} icon={item.direction === 'delete-dst' ? Icon.Trash : Icon.Document}
        checkable={Boolean(planId && item.direction !== 'conflict')} checked={checked.has(item.relPath)} onCheckChange={() => toggle([item.relPath])}
        accessories={[{ tag: item.actionBadge }, { text: formatSyncBytes(item.sizeBytes) }]} actions={<ActionPanel>
          <Action title={t('actionExecuteSelected', { count: selected.length })} icon={Icon.Play} onAction={execute} />
          <Action.ShowInFinder title={t('actionRevealFile')} path={item.sourceFullPath || item.targetFullPath} />
          {recovery.map((file, index) => <Action key={file} title={t('actionRevealBackup', { index: index + 1 })} icon={Icon.Folder} onAction={() => run(async () => { await revealRecovery(file) })} />)}
        </ActionPanel>} />) }} />
}
// 宿主按清单功能码选择命令；比对命令选好目录后直接比对
export const commands = {
  'folder-sync-workbench': () => <FolderSyncCommand />,
  'folder-sync-compare': () => <FolderSyncCommand featureCode="folder-sync-compare" />
}
export default FolderSyncCommand
