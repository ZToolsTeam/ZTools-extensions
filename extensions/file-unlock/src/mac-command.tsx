import React, { Action, ActionPanel, Form, Icon, List, Toast, confirmAlert, showToast, useEffect, useNavigation, useRef, useState } from '@ztools/declarative-ui'
import { finishMacLocks, inspectMacLocks, macDrives, mutateMacTarget, selectMacTarget, terminateMacLocks, type LockSnapshot } from './mac-service.js'
const failure = (error: unknown) => error instanceof Error ? error.message : String(error)
const basename = (file: string) => file.split('/').filter(Boolean).pop() || file
/** 粘贴的路径去掉首尾空白与成对引号（访达“拷贝为路径名”或终端拖入时常带引号） */
export const pastedMacPath = (input: string) => {
  const trimmed = input.trim(), quoted = trimmed.match(/^(['"])(.*)\1$/)
  const value = (quoted ? quoted[2]! : trimmed).trim()
  return value.startsWith('/') && !/[\r\n]/.test(value) ? value : ''
}

export function RenameTargetForm({ snapshot, save }: { snapshot: LockSnapshot; save: (name: string, current: () => boolean) => Promise<boolean> }) {
  const [name, setName] = useState(basename(snapshot.targetPath)), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const { pop } = useNavigation(), alive = useRef(true), active = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const submit = async () => {
    if (active.current) return
    active.current = true; setBusy(true); setError('')
    try {
      if (!name || name === '.' || name === '..' || /[\0/\r\n:]/.test(name)) throw new Error('请输入有效名称，不能包含路径')
      if (await save(name, () => alive.current) && alive.current) pop()
    } catch (e) { if (alive.current) setError(failure(e)) }
    finally { active.current = false; if (alive.current) setBusy(false) }
  }
  return <Form navigationTitle="重命名目标" isLoading={busy} actions={<ActionPanel><Action.SubmitForm title="确认重命名" onSubmit={submit} /><Action title="返回" onAction={pop} /></ActionPanel>}>
    <Form.Description title="原路径" text={snapshot.targetPath} /><Form.TextField id="name" title="新名称" value={name} onChange={setName} />
    <Form.Description title="保留规则" text="只在原目录内改名；同名目标已存在或仍检测到占用时停止，保留原文件。" />
    {error && <Form.Description title="未完成" text={error} />}
  </Form>
}

export default function MacFileUnlockCommand({ initialPath = '', featureCode = 'file-unlock' }: { initialPath?: string; featureCode?: string } = {}) {
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
    try { await fn(operation) } catch (e) { if (alive.current) { setError(failure(e)); await showToast(Toast.Style.Failure, '操作未完成', failure(e)) } }
    finally { active.current = false; if (alive.current) setBusy(false) }
  }
  const refresh = () => work(async () => { if (target) await inspect(target); else setDrives(await macDrives()) })
  const choose = (directory: boolean) => work(async operation => { const file = await selectMacTarget(directory, featureCode === 'usb-unlock' ? '/Volumes' : undefined); if (file && alive.current && operation === revision.current) await inspect(file) })
  useEffect(() => {
    alive.current = true
    void work(async () => { if (initialPath) await inspect(initialPath); else if (featureCode === 'usb-unlock') setDrives(await macDrives()) })
    return () => { alive.current = false; ++revision.current; void finishMacLocks('close').catch(e => console.warn('文件解锁关闭未确认', e)) }
  }, [])
  const cancel = async () => {
    ++revision.current
    setError('已请求取消，后续操作已停止；已发出的结束信号或文件操作请重新检测确认')
    try { await finishMacLocks('cancel') } catch (e) { if (alive.current) setError(failure(e)) }
  }
  const end = async (loaded: LockSnapshot, pids: number[], mode: 'graceful' | 'force') => {
    const result = await terminateMacLocks(loaded.sessionId, pids, mode)
    remember(result.snapshot)
    if (!result.success) throw new Error(`已确认退出 ${result.terminated.length} 个进程；${result.failures.map(f => `${f.pid}：${f.message}`).join('；')}${result.refreshError ? '；重新扫描失败：' + result.refreshError : ''}`)
    return result
  }
  const terminate = (pids: number[], mode: 'graceful' | 'force') => work(async operation => {
    const loaded = current.current
    if (!loaded || !pids.length) throw new Error('请先成功检测并选择进程')
    const rows = loaded.processes.filter(p => pids.includes(p.pid))
    const confirmed = await confirmAlert({ title: mode === 'force' ? '强制结束所选占用进程？' : '结束所选占用进程？', message: `${rows.map(p => `${p.name}（${p.pid}）`).join('\n')}\n未保存的数据可能丢失。${mode === 'force' ? '强制结束不会给程序保存的机会。' : '普通结束超时不会自动升级为强制结束。'}`, primaryAction: { title: '确认结束' } })
    if (!confirmed || !alive.current || operation !== revision.current) return
    const result = await end(loaded, pids, mode)
    if (alive.current) await showToast(Toast.Style.Success, `已确认 ${result.terminated.length} 个进程退出`, `重新检测发现 ${result.snapshot?.processes.length ?? 0} 个占用进程`)
  })
  const trash = () => work(async operation => {
    const loaded = current.current
    if (!loaded) throw new Error('请先成功扫描')
    if (loaded.mutationBlockedReason) throw new Error(loaded.mutationBlockedReason)
    if (loaded.processes.some(p => p.protected)) throw new Error('仍有受保护或无法确认身份的占用进程，保留原文件')
    const confirmed = await confirmAlert({ title: '移入废纸篓？', message: `${loaded.targetPath}\n${loaded.processes.length ? `先尝试结束以下占用进程，未保存的数据可能丢失：\n${loaded.processes.map(p => `${p.name}（${p.pid}）`).join('\n')}\n` : ''}重新检测仍有占用就停止；只移入废纸篓，不永久删除。`, primaryAction: { title: '确认移入废纸篓' } })
    if (!confirmed || !alive.current || operation !== revision.current) return
    if (loaded.processes.length) await end(loaded, loaded.processes.map(p => p.pid), 'graceful')
    if (!alive.current || operation !== revision.current) return
    try { await mutateMacTarget(loaded.sessionId, 'trash') }
    finally { remember(null) }
    if (alive.current) { setTarget(''); await showToast(Toast.Style.Success, '已移入废纸篓', '可在访达的废纸篓中恢复') }
  })
  const rename = (loaded: LockSnapshot) => {
    if (active.current) return
    push(<RenameTargetForm snapshot={loaded} save={async (name, formCurrent) => {
      if (active.current || current.current?.sessionId !== loaded.sessionId) throw new Error('检测结果已变化，请返回重新扫描')
      active.current = true; const operation = ++revision.current; setBusy(true)
      try {
        const confirmed = await confirmAlert({ title: '确认重命名？', message: `${loaded.targetPath}\n新名称：${name}\n不会覆盖已有同名文件。`, primaryAction: { title: '重命名' } })
        if (!confirmed || !alive.current || !formCurrent() || operation !== revision.current) return false
        let renamed: string
        try { renamed = await mutateMacTarget(loaded.sessionId, 'rename', name) } finally { remember(null) }
        if (alive.current) { setTarget(renamed); await showToast(Toast.Style.Success, '已重命名', renamed) }
        return true
      } finally { active.current = false; if (alive.current) setBusy(false) }
    }} />)
  }
  const pathInput = pastedMacPath(query), q = pathInput ? '' : query.trim().toLowerCase()
  // “选择目标”行（文件解锁入口）的主次动作就是选择文件 / 文件夹，此时顶部不再重复这两个按钮
  const showChoose = !snapshot && !target && !pathInput, usb = featureCode === 'usb-unlock'
  const chooseInRow = showChoose && !usb
  const rows = snapshot?.processes.filter(p => (filter === 'all' || p.protected === (filter === 'protected')) && `${p.name} ${p.pid} ${p.executablePath}`.toLowerCase().includes(q)) || []
  return <List navigationTitle="文件解锁" isShowingDetail={false} isLoading={busy} searchText={query} onSearchTextChange={setQuery} searchBarPlaceholder="搜索进程，或粘贴完整路径后按 Enter 检测"
    searchBarAccessory={<List.Dropdown value={filter} onChange={setFilter} tooltip="进程筛选"><List.Dropdown.Item value="all" title="全部占用" /><List.Dropdown.Item value="killable" title="可结束" /><List.Dropdown.Item value="protected" title="受保护" /></List.Dropdown>}
    filterBar={{ summaryText: error || (busy ? '正在检测或执行操作…' : snapshot ? `当前权限范围内发现 ${snapshot.processes.length} 个占用进程` : '选择文件、文件夹或外接磁盘，确认后操作'), actions: busy ? [{ id: 'cancel', title: '取消', onAction: cancel }] : chooseInRow ? [] : [{ id: 'file', title: '选择文件', onAction: () => choose(false) }, { id: 'folder', title: '选择文件夹', onAction: () => choose(true) }] }}>
    {pathInput && <List.Item id="input" title="检测此路径" subtitle={pathInput} icon={Icon.MagnifyingGlass} actions={<ActionPanel><Action title="检测此路径" onAction={() => work(() => inspect(pathInput))} /></ActionPanel>} />}
    {target && <List.Item id="target" title={basename(target)} subtitle={snapshot?.mutationBlockedReason || target} icon={Icon.Document} accessories={[{ tag: snapshot ? '检测目标' : '待重新检测' }]} actions={<ActionPanel>
      <Action title="重新扫描目标" onAction={refresh} /><Action.CopyToClipboard title="复制目标路径" content={target} />
      {snapshot && <Action title="结束全部可结束进程" onAction={() => terminate(snapshot.processes.filter(p => !p.protected).map(p => p.pid), 'graceful')} />}
      {snapshot && !snapshot.mutationBlockedReason && <Action title={snapshot.processes.length ? '结束占用并移入废纸篓' : '移入废纸篓'} onAction={trash} />}
      {snapshot && !snapshot.mutationBlockedReason && <Action title="重命名目标" onAction={() => rename(snapshot)} />}
    </ActionPanel>} />}
    {rows.map(p => <List.Item key={p.pid} id={`process:${p.pid}`} title={p.name} subtitle={`${p.pid} · ${p.reason || p.executablePath}`} icon={Icon.Gear} accessories={[{ tag: p.protected ? '受保护' : `${p.paths.length} 个占用路径` }]} actions={<ActionPanel>
      {!p.protected && <Action title="结束此进程" onAction={() => terminate([p.pid], 'graceful')} />}
      <Action.CopyToClipboard title="复制进程与占用路径" content={`${p.name}（${p.pid}）\n${p.executablePath}\n${p.paths.join('\n')}`} />
      {!p.protected && <Action title="强制结束此进程" onAction={() => terminate([p.pid], 'force')} />}
    </ActionPanel>} />)}
    {showChoose && <List.Item id="choose" title={error ? '检测尚未完成' : usb ? (drives.length ? '选择下方的外接磁盘检测占用' : busy ? '正在读取外接磁盘' : '未发现已挂载的外接磁盘') : '选择需要检测的目标'}
      // 提示与这一行的主动作一致：外接磁盘入口的 Enter 是刷新磁盘列表，文件入口的 Enter 是选择文件
      subtitle={error || (usb ? '按 Enter 刷新外接磁盘列表；也可以在搜索框粘贴完整路径后检测' : '按 Enter 选择文件；也可以在搜索框粘贴完整路径后检测')} icon={Icon.Folder} actions={<ActionPanel>{usb
      ? <Action title="刷新外接磁盘" onAction={refresh} />
      : <Action title="选择文件…" onAction={() => choose(false)} />}{!usb && <Action title="选择文件夹…" onAction={() => choose(true)} />}</ActionPanel>} />}
    {!snapshot && drives.map(d => <List.Item key={d.path} id={`drive:${d.path}`} title={d.label} subtitle={d.path} icon={Icon.HardDrive} actions={<ActionPanel><Action title="检测磁盘占用" onAction={() => work(() => inspect(d.path))} /></ActionPanel>} />)}
    {snapshot && <List.Item id="notice" title={snapshot.processes.length === 0 ? '当前权限范围内未发现占用' : rows.length === 0 ? '没有符合筛选条件的进程' : '检测范围说明'} subtitle={snapshot.notice} icon={Icon.Info} />}
  </List>
}
