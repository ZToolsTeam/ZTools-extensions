import React, { Action, ActionPanel, Form, Icon, List, Toast, confirmAlert, showToast, useEffect, useLocale, useNavigation, useRef, useState } from '@ztools/declarative-ui'
import { t } from './i18n.js'
import { finishMacLocks, inspectMacLocks, macDrives, mutateMacTarget, selectMacTarget, terminateMacLocks, type LockSnapshot } from './mac-service.js'
import { createCompatFileInputProps, isDeclarativeFileInputSupported } from './host-compat.js'
const failure = (error: unknown) => error instanceof Error ? error.message : String(error)
const basename = (file: string) => file.split('/').filter(Boolean).pop() || file
/** 粘贴的路径去掉首尾空白与成对引号（访达“拷贝为路径名”或终端拖入时常带引号） */
export const pastedMacPath = (input: string) => {
  const trimmed = input.trim(), quoted = trimmed.match(/^(['"])(.*)\1$/)
  const value = (quoted ? quoted[2]! : trimmed).trim()
  return value.startsWith('/') && !/[\r\n]/.test(value) ? value : ''
}

export function RenameTargetForm({ snapshot, save }: { snapshot: LockSnapshot; save: (name: string, current: () => boolean) => Promise<boolean> }) {
  useLocale()
  const [name, setName] = useState(basename(snapshot.targetPath)), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const { pop } = useNavigation(), alive = useRef(true), active = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const submit = async () => {
    if (active.current) return
    active.current = true; setBusy(true); setError('')
    try {
      if (!name || name === '.' || name === '..' || /[\0/\r\n:]/.test(name)) throw new Error(t('errInvalidNameNoPath'))
      if (await save(name, () => alive.current) && alive.current) pop()
    } catch (e) { if (alive.current) setError(failure(e)) }
    finally { active.current = false; if (alive.current) setBusy(false) }
  }
  return <Form navigationTitle={t('renameFormNavTitle')} isLoading={busy} actions={<ActionPanel><Action.SubmitForm title={t('renameConfirmBtn')} onSubmit={submit} /><Action title={t('backAction')} onAction={pop} /></ActionPanel>}>
    <Form.Description title={t('fieldOldPath')} text={snapshot.targetPath} /><Form.TextField id="name" title={t('fieldNewName')} value={name} onChange={setName} />
    <Form.Description title={t('fieldKeepRules')} text={t('fieldKeepRulesText')} />
    {error && <Form.Description title={t('fieldIncomplete')} text={error} />}
  </Form>
}

export default function MacFileUnlockCommand({ initialPath = '', featureCode = 'file-unlock' }: { initialPath?: string; featureCode?: string } = {}) {
  useLocale()
  const [snapshot, setSnapshot] = useState<LockSnapshot | null>(null), [target, setTarget] = useState(initialPath), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [drives, setDrives] = useState<Array<{ path: string; label: string }>>([])
  const current = useRef<LockSnapshot | null>(null), active = useRef(false), alive = useRef(true), revision = useRef(0), { push } = useNavigation()
  const remember = (value: LockSnapshot | null) => { current.current = value; if (alive.current) setSnapshot(value) }
  const inspect = async (file: string) => {
    remember(null); if (alive.current) setTarget(file)
    const result = await inspectMacLocks(file)
    if (alive.current) { remember(result); setQuery(''); setTarget(result.targetPath) }
  }
  const work = async (fn: (operation: number) => Promise<void>) => {
    if (active.current) return
    active.current = true; const operation = ++revision.current; setBusy(true); setError('')
    try { await fn(operation) } catch (e) { if (alive.current) { setError(failure(e)); await showToast(Toast.Style.Failure, t('toastOpFailed'), failure(e)) } }
    finally { active.current = false; if (alive.current) setBusy(false) }
  }
  const refresh = () => work(async () => { if (target) await inspect(target); else setDrives(await macDrives()) })
  const choose = (directory: boolean) => work(async operation => { const file = await selectMacTarget(directory, featureCode === 'usb-unlock' ? '/Volumes' : undefined); if (file && alive.current && operation === revision.current) await inspect(file) })
  useEffect(() => {
    alive.current = true
    void work(async () => { if (initialPath) await inspect(initialPath); else if (featureCode === 'usb-unlock') setDrives(await macDrives()) })
    return () => { alive.current = false; ++revision.current; void finishMacLocks('close').catch(e => console.warn('文件解锁关闭未确认', e)) }
  }, [])
  useEffect(() => {
    if (isDeclarativeFileInputSupported()) return
    const ztools = (globalThis as { window?: { ztools?: { events?: { on?: (event: string, cb: (payload: unknown) => void) => (() => void) | void; off?: (event: string, cb: (payload: unknown) => void) => void } } } }).window?.ztools
    if (typeof ztools?.events?.on !== 'function') return
    const handler = (envelopeOrPayload: unknown) => {
      const raw = envelopeOrPayload && typeof envelopeOrPayload === 'object'
        ? (envelopeOrPayload as { payload?: { files?: unknown }; files?: unknown })
        : {}
      const list = Array.isArray(raw.payload?.files) ? raw.payload!.files : Array.isArray(raw.files) ? raw.files : []
      const first = list.find((item): item is string => typeof item === 'string' && Boolean(pastedMacPath(item)))
      const dropped = first ? pastedMacPath(first) : ''
      if (!dropped) return
      void work(async operation => {
        if (alive.current && operation === revision.current) await inspect(dropped)
      })
    }
    const off = ztools.events.on('plugin_files_dropped', handler)
    return () => {
      if (typeof off === 'function') off()
      else ztools?.events?.off?.('plugin_files_dropped', handler)
    }
  }, [])
  const fileInputProps = createCompatFileInputProps(
    (files) => {
      const first = files.find((item) => Boolean(pastedMacPath(item)))
      const dropped = first ? pastedMacPath(first) : ''
      if (!dropped) return
      void work(async (operation) => {
        if (alive.current && operation === revision.current) await inspect(dropped)
      })
    },
    { allowDirectories: true }
  )
  const cancel = async () => {
    ++revision.current
    setError(t('macCancelRequested'))
    try { await finishMacLocks('cancel') } catch (e) { if (alive.current) setError(failure(e)) }
  }
  const clearTarget = async () => {
    if (busy || active.current) {
      await showToast(Toast.Style.Failure, t('toastBusyClear'))
      return
    }
    ++revision.current
    remember(null)
    setTarget('')
    setError('')
    setQuery('')
    setFilter('all')
  }
  const end = async (loaded: LockSnapshot, pids: number[], mode: 'graceful' | 'force') => {
    const result = await terminateMacLocks(loaded.sessionId, pids, mode)
    remember(result.snapshot)
    if (!result.success) throw new Error(t('macPartialTerminateErr', {
      count: result.terminated.length,
      failures: result.failures.map(f => `${f.pid}: ${f.message}`).join('; '),
      refreshErr: result.refreshError ? t('macRefreshFailedSuffix', { error: result.refreshError }) : ''
    }))
    return result
  }
  const terminate = (pids: number[], mode: 'graceful' | 'force') => work(async operation => {
    const loaded = current.current
    if (!loaded || !pids.length) throw new Error(t('errSelectProcessFirst'))
    const rows = loaded.processes.filter(p => pids.includes(p.pid))
    const confirmed = await confirmAlert({
      title: mode === 'force' ? t('confirmForceKillTitle') : t('confirmKillTitle'),
      message: t('confirmKillMsg', {
        rows: rows.map(p => t('procWithPid', { name: p.name, pid: p.pid })).join('\n'),
        hint: mode === 'force' ? t('confirmKillHintForce') : t('confirmKillHintGraceful')
      }),
      primaryAction: { title: t('confirmKillBtn') }
    })
    if (!confirmed || !alive.current || operation !== revision.current) return
    const result = await end(loaded, pids, mode)
    if (alive.current) await showToast(Toast.Style.Success, t('toastTerminatedTitle', { count: result.terminated.length }), t('toastTerminatedMsg', { count: result.snapshot?.processes.length ?? 0 }))
  })
  const trash = () => work(async operation => {
    const loaded = current.current
    if (!loaded) throw new Error(t('errScanFirst'))
    if (loaded.mutationBlockedReason) throw new Error(loaded.mutationBlockedReason)
    if (loaded.processes.some(p => p.protected)) throw new Error(t('errProtectedKeepOriginal'))
    const confirmed = await confirmAlert({
      title: t('confirmMacTrashTitle'),
      message: t('confirmMacTrashMsg', {
        path: loaded.targetPath,
        procs: loaded.processes.length ? t('confirmMacTrashProcs', { rows: loaded.processes.map(p => t('procWithPid', { name: p.name, pid: p.pid })).join('\n') }) : ''
      }),
      primaryAction: { title: t('confirmMacTrashBtn') }
    })
    if (!confirmed || !alive.current || operation !== revision.current) return
    if (loaded.processes.length) await end(loaded, loaded.processes.map(p => p.pid), 'graceful')
    if (!alive.current || operation !== revision.current) return
    try { await mutateMacTarget(loaded.sessionId, 'trash') }
    finally { remember(null) }
    if (alive.current) { setTarget(''); await showToast(Toast.Style.Success, t('toastMacTrashedTitle'), t('toastMacTrashedMsg')) }
  })
  const rename = (loaded: LockSnapshot) => {
    if (active.current) return
    push(<RenameTargetForm snapshot={loaded} save={async (name, formCurrent) => {
      if (active.current || current.current?.sessionId !== loaded.sessionId) throw new Error(t('errSnapshotChanged'))
      active.current = true; const operation = ++revision.current; setBusy(true)
      try {
        const confirmed = await confirmAlert({ title: t('confirmRenameTitle'), message: t('confirmRenameMsg', { path: loaded.targetPath, name }), primaryAction: { title: t('confirmRenameBtn') } })
        if (!confirmed || !alive.current || !formCurrent() || operation !== revision.current) return false
        let renamed: string
        try { renamed = await mutateMacTarget(loaded.sessionId, 'rename', name) } finally { remember(null) }
        if (alive.current) { setTarget(renamed); await showToast(Toast.Style.Success, t('toastRenamedTitle'), renamed) }
        return true
      } finally { active.current = false; if (alive.current) setBusy(false) }
    }} />)
  }
  const pathInput = pastedMacPath(query), q = pathInput ? '' : query.trim().toLowerCase()
  // “选择目标”行（文件解锁入口）的主次动作就是选择文件 / 文件夹，此时顶部不再重复这两个按钮
  const showChoose = !snapshot && !target && !pathInput, usb = featureCode === 'usb-unlock'
  const chooseInRow = showChoose && !usb
  const rows = snapshot?.processes.filter(p => (filter === 'all' || p.protected === (filter === 'protected')) && `${p.name} ${p.pid} ${p.executablePath}`.toLowerCase().includes(q)) || []
  const summaryText = error || (busy
    ? t('macSummaryBusy')
    : snapshot
      ? t('macSummarySnapshot', { count: snapshot.processes.length })
      : target
        ? t('macSummaryTarget', { name: basename(target) })
        : t('macSummaryIdle'))
  return <List {...fileInputProps} navigationTitle={t('navTitle')} isShowingDetail={false} isLoading={busy} searchText={query} onSearchTextChange={setQuery} searchBarPlaceholder={t('macSearchPlaceholder')}
    actions={target ? <ActionPanel><Action title={t('actionClearTarget')} icon={Icon.Trash} shortcut={{ modifiers: ['ctrl', 'shift'], key: 'backspace' }} onAction={() => { void clearTarget() }} /></ActionPanel> : undefined}
    searchBarAccessory={<List.Dropdown value={filter} onChange={setFilter} tooltip={t('dropdownProcessFilter')}><List.Dropdown.Item value="all" title={t('filterAllMac')} /><List.Dropdown.Item value="killable" title={t('filterKillableMac')} /><List.Dropdown.Item value="protected" title={t('filterProtectedMac')} /></List.Dropdown>}
    filterBar={{ summaryText, actions: busy ? [{ id: 'cancel', title: t('cancelAction'), onAction: cancel }] : chooseInRow ? [] : [{ id: 'file', title: t('chooseFileBtn'), onAction: () => choose(false) }, { id: 'folder', title: t('chooseFolderBtn'), onAction: () => choose(true) }] }}>
    {pathInput && <List.Item id="input" title={t('inspectPathTitle')} subtitle={pathInput} icon={Icon.MagnifyingGlass} actions={<ActionPanel><Action title={t('inspectPathTitle')} onAction={() => work(() => inspect(pathInput))} /></ActionPanel>} />}
    {target && <List.Item id="target" title={basename(target)} subtitle={snapshot?.mutationBlockedReason || target} icon={Icon.Document} accessories={[{ tag: snapshot ? t('tagInspectedTarget') : t('tagPendingReinspect') }]} actions={<ActionPanel>
      <Action title={t('actionRescanTarget')} onAction={refresh} /><Action.CopyToClipboard title={t('actionCopyTargetPath')} content={target} />
      {snapshot && <Action title={t('actionKillAllKillable')} onAction={() => terminate(snapshot.processes.filter(p => !p.protected).map(p => p.pid), 'graceful')} />}
      {snapshot && !snapshot.mutationBlockedReason && <Action title={snapshot.processes.length ? t('actionKillAndTrashMac') : t('actionTrashMac')} onAction={trash} />}
      {snapshot && !snapshot.mutationBlockedReason && <Action title={t('actionRenameTarget')} onAction={() => rename(snapshot)} />}
      <Action title={t('actionClearTarget')} icon={Icon.Trash} shortcut={{ modifiers: ['ctrl', 'shift'], key: 'backspace' }} onAction={() => { void clearTarget() }} />
    </ActionPanel>} />}
    {rows.map(p => <List.Item key={p.pid} id={`process:${p.pid}`} title={p.name} subtitle={`${p.pid} · ${p.reason || p.executablePath}`} icon={Icon.Gear} accessories={[{ tag: p.protected ? t('tagProtected') : t('tagLockingPathsCount', { count: p.paths.length }) }]} actions={<ActionPanel>
      {!p.protected && <Action title={t('actionKillProc')} onAction={() => terminate([p.pid], 'graceful')} />}
      <Action.CopyToClipboard title={t('actionCopyProcAndPaths')} content={`${p.name} (${p.pid})\n${p.executablePath}\n${p.paths.join('\n')}`} />
      {!p.protected && <Action title={t('actionForceKillProc')} onAction={() => terminate([p.pid], 'force')} />}
      {snapshot && <Action title={t('actionKillAllKillable')} onAction={() => terminate(snapshot.processes.filter(item => !item.protected).map(item => item.pid), 'graceful')} />}
      {snapshot && !snapshot.mutationBlockedReason && <Action title={snapshot.processes.length ? t('actionKillAndTrashMac') : t('actionTrashMac')} onAction={trash} />}
      <Action title={t('actionClearTarget')} icon={Icon.Trash} shortcut={{ modifiers: ['ctrl', 'shift'], key: 'backspace' }} onAction={() => { void clearTarget() }} />
    </ActionPanel>} />)}
    {showChoose && <List.Item id="choose" title={error ? t('chooseErrTitle') : usb ? (drives.length ? t('chooseUsbReady') : busy ? t('chooseUsbLoading') : t('chooseUsbEmpty')) : t('chooseDefaultTitle')}
      subtitle={error || (usb ? t('chooseUsbSub') : t('chooseDefaultSub'))} icon={Icon.Folder} actions={<ActionPanel>{usb
      ? <Action title={t('actionRefreshDrives')} onAction={refresh} />
      : <Action title={t('actionChooseFileEllipsis')} onAction={() => choose(false)} />}{!usb && <Action title={t('actionChooseFolderEllipsis')} onAction={() => choose(true)} />}</ActionPanel>} />}
    {!snapshot && drives.map(d => <List.Item key={d.path} id={`drive:${d.path}`} title={d.label} subtitle={d.path} icon={Icon.HardDrive} actions={<ActionPanel><Action title={t('actionInspectDrive')} onAction={() => work(() => inspect(d.path))} /></ActionPanel>} />)}
    {snapshot && <List.Item id="notice" title={snapshot.processes.length === 0 ? t('noticeNoLocks') : rows.length === 0 ? t('noticeNoFilterMatch') : t('noticeScopeTitle')} subtitle={snapshot.notice} icon={Icon.Info} />}
  </List>
}
