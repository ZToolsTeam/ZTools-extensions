import React, { Action, ActionPanel, Icon, List, Toast, showToast, useEffect, useMemo, useRef, useState } from '@ztools/declarative-ui'
import { chooseFolder, compareFolderTrees, executeFolderSync, filterSyncDiffItems, formatSyncBytes, revealRecovery } from './sync-service.js'
import type { DiffFilterType, FolderSyncDiffItem, SyncMode } from './types.js'

// 镜像模式依赖宿主的安全回收（目前只有 macOS 实现，移入废纸篓），其他平台不提供该选项
const supportsMirror = () => typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent || '')

/** folder-sync-compare 选好两个目录后直接比对；工作台命令选完目录先调整模式再比对 */
export function FolderSyncCommand({ featureCode = 'folder-sync-workbench' }: { featureCode?: string } = {}) {
  const compareOnly = featureCode === 'folder-sync-compare'
  const [sourceDir, setSourceDir] = useState(''), [targetDir, setTargetDir] = useState('')
  const [syncMode, setSyncMode] = useState<SyncMode>('incremental'), [ignoreDevJunk, setIgnoreDevJunk] = useState(true)
  const [diffFilter, setDiffFilter] = useState<DiffFilterType>('all'), [searchText, setSearchText] = useState('')
  const [diffItems, setDiffItems] = useState<FolderSyncDiffItem[]>([]), [checked, setChecked] = useState<Set<string>>(new Set())
  const [planId, setPlanId] = useState(''), [busy, setBusy] = useState(false), [recovery, setRecovery] = useState<string[]>([])
  const [status, setStatus] = useState('选择两个目录后比对；先检查右侧清单，再执行')
  const controller = useRef<AbortController | null>(null), mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort() } }, [])
  const invalidate = () => { setPlanId(''); setDiffItems([]); setChecked(new Set()); setStatus('配置已变化，请重新比对') }
  const run = async (work: (signal: AbortSignal) => Promise<void>) => {
    if (controller.current) return
    const active = new AbortController(); controller.current = active; setBusy(true)
    try { await work(active.signal) }
    catch (error) {
      if (mounted.current) {
        const text = active.signal.aborted ? '操作已停止；如已开始执行，请检查备份目录后重新比对' : error instanceof Error ? error.message : String(error)
        setPlanId(''); setStatus(text)
        await showToast({ style: Toast.Style.Failure, title: text })
      }
    } finally { controller.current = null; if (mounted.current) setBusy(false) }
  }
  const compareDirs = async (source: string, target: string, signal: AbortSignal) => {
    if (!source || !target) throw new Error('请先选择源目录和目标目录')
    invalidate(); setStatus('正在读取文件内容并比对…')
    const result = await compareFolderTrees({ sourceDir: source, targetDir: target, syncMode, ignoreDevJunk }, signal)
    if (!mounted.current) return
    setDiffItems(result.diffs); setPlanId(result.planId)
    setChecked(new Set(result.diffs.filter(item => item.direction !== 'delete-dst' && item.direction !== 'conflict').map(item => item.relPath)))
    setStatus(result.diffs.length ? `比对完成，共 ${result.diffs.length} 项${result.diffs.some(item => item.direction === 'delete-dst') ? '；移入废纸篓的文件需手动勾选' : ''}` : '文件内容一致；空目录不参与同步')
  }
  const pick = () => run(async signal => {
    const source = await chooseFolder('选择源文件夹'); if (!source) return
    const target = await chooseFolder('选择目标文件夹'); if (!target || !mounted.current) return
    setSourceDir(source); setTargetDir(target); invalidate()
    if (compareOnly) { signal.throwIfAborted(); await compareDirs(source, target, signal) }
  })
  const compare = () => run(signal => compareDirs(sourceDir, targetDir, signal))
  const execute = () => run(async signal => {
    if (!planId || !checked.size) throw new Error('请先比对并勾选待执行文件')
    const id = planId; setPlanId(''); setStatus('正在备份、校验并同步…')
    const result = await executeFolderSync(id, [...checked], signal)
    if (!mounted.current) return
    setRecovery(result.recoveryPaths); setChecked(new Set())
    const summary = `已写入 ${result.syncedCount} 项${result.deletedCount ? `，已移入废纸篓 ${result.deletedCount} 项` : ''}，未完成 ${result.remainingCount} 项`
    setStatus(`${summary}${result.error ? `；${result.error}` : '；备份已保留，请重新比对查看最新差异'}`)
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
    {ready && !planId ? <Action title="开始比对" icon={Icon.MagnifyingGlass} onAction={compare} /> : null}
    <Action title={ready ? '重新选择目录…' : '选择目录…'} icon={Icon.Folder} onAction={pick} />
  </ActionPanel>
  return <List navigationTitle={compareOnly ? '目录比对' : '目录同步'} isLoading={busy} isShowingDetail={false} searchText={searchText} onSearchTextChange={setSearchText}
    searchBarPlaceholder="搜索差异文件" searchBarAccessory={<List.Dropdown value={diffFilter} onChange={value => setDiffFilter(value as DiffFilterType)}>
      <List.Dropdown.Item title="全部差异" value="all" /><List.Dropdown.Item title="新增" value="added" />
      <List.Dropdown.Item title="覆盖" value="modified" />{mirror && <List.Dropdown.Item title="移入废纸篓" value="orphan" />}<List.Dropdown.Item title="冲突" value="conflict" />
    </List.Dropdown>}
    actions={emptyActions}
    filterBar={{ summaryText: status, actions: busy ? [{ id: 'cancel', title: '停止', onAction: () => controller.current?.abort() }] : [
      { id: 'pick', title: '选择目录', onAction: pick }, { id: 'compare', title: '重新比对', onAction: compare }] }}
    workbenchPanel={{ title: '同步配置', subtitle: '覆盖前保留备份；链接或读取失败会停止扫描', fields: [
      { id: 'mode', label: '模式', type: 'select', value: syncMode, options: [{ label: '单向增量', value: 'incremental' }, { label: '双向合并', value: 'two-way' }, ...(mirror ? [{ label: '镜像（目标独有文件移入废纸篓）', value: 'mirror' }] : [])], onChange: value => { if (!busy) { setSyncMode(value as SyncMode); invalidate() } } },
      { id: 'ignore', label: '忽略 .git、node_modules 和系统缩略图', type: 'toggle', value: ignoreDevJunk, onChange: value => { if (!busy) { setIgnoreDevJunk(Boolean(value)); invalidate() } } },
      { id: 'source', label: '源目录', type: 'info', value: sourceDir || '未选择' },
      { id: 'target', label: '目标目录', type: 'info', value: targetDir || '未选择' },
      { id: 'limit', label: '范围', type: 'info', value: '仅普通文件；最多 5000 项，单文件 2 GiB；空目录不复制' },
      ...recovery.map((file, index) => ({ id: `backup-${index}`, label: '备份目录', type: 'info' as const, value: file }))
    ], previewCard: { title: `已选 ${selected.length} 项`, subtitle: `新增 ${counts.add} · 覆盖 ${counts.replace}${mirror ? ` · 移入废纸篓 ${counts.trash}` : ''} · 写入 ${formatSyncBytes(selected.filter(item => item.direction !== 'delete-dst').reduce((sum, item) => sum + item.sizeBytes, 0))}` } }}
    subList={{ title: '执行清单', subtitle: '空格勾选；Enter 执行已选项；冲突文件需自行处理后重新比对', emptyText: planId ? '没有符合筛选条件的差异' : '请先选择目录并比对',
      checkable: Boolean(planId && actionable.length), checked: all ? true : actionable.some(item => checked.has(item.relPath)) ? 'indeterminate' : false,
      onCheckChange: () => toggle(actionable.map(item => item.relPath)), items: visible.map(item => <List.Item key={item.relPath} id={item.relPath}
        title={item.relPath} subtitle={item.reasonText} icon={item.direction === 'delete-dst' ? Icon.Trash : Icon.Document}
        checkable={Boolean(planId && item.direction !== 'conflict')} checked={checked.has(item.relPath)} onCheckChange={() => toggle([item.relPath])}
        accessories={[{ tag: item.actionBadge }, { text: formatSyncBytes(item.sizeBytes) }]} actions={<ActionPanel>
          <Action title={`执行已选 ${selected.length} 项`} icon={Icon.Play} onAction={execute} />
          <Action.ShowInFinder title="查看文件" path={item.sourceFullPath || item.targetFullPath} />
          {recovery.map((file, index) => <Action key={file} title={`查看备份 ${index + 1}`} icon={Icon.Folder} onAction={() => run(async () => { await revealRecovery(file) })} />)}
        </ActionPanel>} />) }} />
}
// 宿主按清单功能码选择命令；比对命令选好目录后直接比对
export const commands = {
  'folder-sync-workbench': () => <FolderSyncCommand />,
  'folder-sync-compare': () => <FolderSyncCommand featureCode="folder-sync-compare" />
}
export default FolderSyncCommand
