import React, { Action, ActionPanel, Clipboard, Form, Icon, List, Toast, confirmAlert, showToast, useEffect, useNavigation, useRef, useState } from '@ztools/declarative-ui'
import { applyEnvironment, cancelEnvironment, darwinPathProblem, exportEnvSnapshot, isPathKey, loadEnvironment, prepareEnvironment } from './env-service.js'
import type { EnvChange, EnvItem, EnvScope, EnvSnapshot } from './types.js'
export * from './types.js'
export * from './env-service.js'
const failure = (error: unknown) => error instanceof Error ? error.message : String(error)
const DARWIN_PATH_NOTICE = '会整体替换新终端里的 PATH：ZTools 段之前由 .zprofile、Homebrew 等设置的目录不再生效，请写入完整目录列表。'
const sourceName = (scope: EnvItem['scope'], platform: string) => scope === 'process' ? '当前进程' : scope === 'system' ? '系统配置' : platform === 'darwin' ? '终端配置' : '用户配置'
/**
 * 当前进程里由 shell 或系统自动维护、对用户没有意义的变量：`_`（上一条命令的参数）、SHLVL、OLDPWD，
 * 以及 macOS 以双下划线开头的系统私有变量（如 __CF_USER_TEXT_ENCODING、__CFBundleIdentifier）。
 * 只过滤当前进程；用户在配置里自己写的同名变量照常显示。
 */
export function isShellInternal(item: Pick<EnvItem, 'key' | 'scope'>): boolean {
  return item.scope === 'process' && (item.key === '_' || item.key === 'SHLVL' || item.key === 'OLDPWD' || item.key.startsWith('__'))
}
const SCOPE_ORDER: EnvItem['scope'][] = ['user', 'system', 'process']
/** 变量按来源分组（用户/终端、系统、当前进程），组内按变量名排序（不区分大小写）；来源只在分组标题出现一次，不在每行重复。 */
export function groupVariables(items: EnvItem[], platform: string) {
  return SCOPE_ORDER.map(scope => ({
    scope,
    title: scope === 'process' ? '当前进程（只读）' : sourceName(scope, platform),
    items: items.filter(v => v.scope === scope).sort((a, b) => a.key.localeCompare(b.key, 'en', { sensitivity: 'base' }) || a.key.localeCompare(b.key))
  })).filter(group => group.items.length)
}

export function EnvVarForm({ item, snapshot, onSave }: { item?: EnvItem; snapshot: EnvSnapshot; onSave: (change: EnvChange, isCurrent: () => boolean) => Promise<boolean> }) {
  const { pop } = useNavigation()
  const [key, setKey] = useState(item?.key || ''), [value, setValue] = useState(item?.value || '')
  const [source, setSource] = useState<EnvScope>(item?.scope === 'system' ? 'system' : 'user'), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const active = useRef(false), alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (active.current) void cancelEnvironment().catch(e => console.warn('表单关闭后取消未确认', e)) } }, [])
  const submit = async () => {
    if (active.current) return
    active.current = true; setBusy(true); setError('')
    try {
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key.trim())) throw new Error('变量名只能含字母、数字和下划线，且不能以数字开头')
      const pathProblem = snapshot.platform === 'darwin' && key.trim() === 'PATH' ? darwinPathProblem(value) : ''
      if (pathProblem) throw new Error(pathProblem)
      if (await onSave({ kind: 'set', source, key: key.trim(), value }, () => alive.current) && alive.current) pop()
    } catch (e) { if (alive.current) { setError(failure(e)); await showToast(Toast.Style.Failure, '环境变量未保存', failure(e)) } }
    finally { active.current = false; if (alive.current) setBusy(false) }
  }
  return <Form navigationTitle={item?.scope === 'process' ? '写入持久配置' : item ? '编辑环境变量' : '新建环境变量'} isLoading={busy}
    actions={<ActionPanel><Action.SubmitForm title="预览并保存" onSubmit={submit} /><Action title="取消返回" onAction={pop} /></ActionPanel>}>
    {item ? <Form.Description title="变量名" text={key} /> : <Form.TextField id="key" title="变量名" value={key} onChange={setKey} placeholder="例如 JAVA_HOME" />}
    <Form.TextArea id="value" title="变量值" value={value} onChange={setValue} placeholder="保留原样写入，包括空值、空格和换行" />
    <Form.Dropdown id="source" title="保存位置" value={source} onChange={v => setSource(v as EnvScope)}>
      {snapshot.sources.map(s => <Form.Dropdown.Item key={s.id} value={s.id} title={s.label} />)}
    </Form.Dropdown>
    <Form.Description title="生效范围" text={snapshot.notice} />
    {snapshot.platform === 'darwin' && <Form.Description title="字面量保存" text="变量值按文字保存；$HOME、反引号和命令表达式不会被执行。PATH 请使用完整目录路径，以冒号分隔。" />}
    {snapshot.platform === 'darwin' && key.trim() === 'PATH' && <Form.Description title="PATH 提示" text={DARWIN_PATH_NOTICE} />}
    {error && <Form.Description title="未保存" text={error} />}
  </Form>
}

export function EnvManagerCommand({ featureCode = 'env-all' }: { featureCode?: string } = {}) {
  const { push } = useNavigation()
  const [snapshot, setSnapshot] = useState<EnvSnapshot | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [category, setCategory] = useState(featureCode === 'env-backup' ? 'backups' : featureCode === 'env-path-clean' ? 'invalid' : 'all'), [query, setQuery] = useState('')
  const active = useRef(false), alive = useRef(true), current = useRef<EnvSnapshot | null>(null)
  const reload = async () => {
    current.current = null; setSnapshot(null)
    const result = await loadEnvironment()
    if (alive.current) { current.current = result; setSnapshot(result) }
  }
  const work = async (fn: () => Promise<void>) => {
    if (active.current) return
    active.current = true; setBusy(true); setError('')
    try { await fn() } catch (e) { if (alive.current) { setError(failure(e)); await showToast(Toast.Style.Failure, '环境变量操作未完成', failure(e)) } }
    finally { active.current = false; if (alive.current) setBusy(false) }
  }
  const refresh = () => work(reload)
  useEffect(() => { alive.current = true; void refresh(); return () => { alive.current = false; if (active.current) void cancelEnvironment().catch(e => console.warn('环境变量取消未确认', e)) } }, [])
  const mutate = async (change: EnvChange, isCurrent: () => boolean = () => true): Promise<boolean> => {
    if (active.current) throw new Error('环境变量操作正在进行，请稍候')
    const loaded = current.current
    if (!loaded) throw new Error('请先成功读取环境变量')
    active.current = true; setBusy(true); setError('')
    try {
      const plan = await prepareEnvironment(loaded.sessionId, change)
      if (!alive.current || !isCurrent()) return false
      const pathWarning = loaded.platform === 'darwin' && change.kind === 'set' && change.key === 'PATH' ? DARWIN_PATH_NOTICE + '\n' : ''
      const confirmed = await confirmAlert({ title: plan.summary, message: `位置：${plan.location}\n${pathWarning}${plan.removed.length ? '仅移除以下目录：\n' + plan.removed.join('\n') + '\n' : ''}先保存并校验原配置备份，再写入和读回确认。\n${plan.notice}`, primaryAction: { title: '确认修改' }, dismissAction: { title: '取消' } })
      if (!confirmed || !alive.current || !isCurrent()) { await cancelEnvironment(); return false }
      let result: { backupId: string; summary: string; recoveryPath?: string } | undefined, operationError = ''
      try { result = await applyEnvironment(plan.planId) } catch (e) { operationError = failure(e) }
      if (!alive.current) return false
      let refreshError = ''
      try { await reload() } catch (e) { refreshError = failure(e) }
      if (operationError) throw new Error(refreshError ? `${operationError}；刷新失败：${refreshError}` : operationError)
      if (refreshError) {
        // 写入已读回核验，只是列表没刷新成功：如实说明已保存，不报成“未修改成功”，以免用户重复提交
        if (alive.current) { setError(`配置已保存并核验，但刷新列表失败：${refreshError}`); await showToast(Toast.Style.Failure, '配置已保存，刷新列表失败', `${refreshError}；请稍后手动刷新，不要重复提交`) }
        return isCurrent()
      }
      if (alive.current && isCurrent() && result) await showToast(Toast.Style.Success, '配置已保存并核验', result.recoveryPath ? `原文件另存于 ${result.recoveryPath}；配置备份可在“修改备份”恢复` : '原配置备份可在“修改备份”中恢复')
      return isCurrent()
    } finally { active.current = false; if (alive.current) setBusy(false) }
  }
  const runChange = async (change: EnvChange) => { try { await mutate(change) } catch (e) { if (alive.current) { setError(failure(e)); await showToast(Toast.Style.Failure, '配置未确认修改成功', failure(e)) } } }
  const edit = (item?: EnvItem) => { const loaded = current.current; if (loaded && !active.current) push(<EnvVarForm item={item} snapshot={loaded} onSave={mutate} />) }
  const exportBackup = () => work(async () => {
    if (!current.current) throw new Error('请先成功读取环境变量')
    await Clipboard.copy(exportEnvSnapshot(current.current))
    if (alive.current) await showToast(Toast.Style.Success, '真实变量快照已复制', '快照可能含密钥，请妥善保管；修改前的配置备份单独保存在本机')
  })
  const cancel = async () => { try { await cancelEnvironment() } catch (e) { if (alive.current) setError(`取消未确认：${failure(e)}`) } }
  const q = query.trim().toLowerCase(), platform = snapshot?.platform || ''
  const invalid = (scope: EnvItem['scope']) => snapshot?.paths.filter(p => p.scope === scope && p.status === 'missing').length || 0
  const isPath = (item: EnvItem) => isPathKey(item.key, platform)
  // “含失效目录的 PATH”只列可清理的持久配置；当前进程只读，不能清理
  const items = snapshot?.variables.filter(v => !isShellInternal(v) && (category === 'all' || category === v.scope || (category === 'invalid' && v.scope !== 'process' && isPath(v) && invalid(v.scope) > 0)) && `${v.key} ${v.value}`.toLowerCase().includes(q)) || []
  const paths = category === 'path' ? snapshot?.paths.filter(p => p.value.toLowerCase().includes(q)) || [] : []
  const backups = category === 'backups' ? snapshot?.backups.filter(b => `${b.createdAt} ${b.summary}`.toLowerCase().includes(q)) || [] : []
  const noBackups = category === 'backups' && Boolean(snapshot) && !snapshot?.backups.length
  const count = category === 'path' ? paths.length : category === 'backups' ? backups.length : items.length
  const rowActions = (item: EnvItem) => <ActionPanel>
    {item.scope === 'process' ? <Action.CopyToClipboard title="复制变量值" content={item.value} /> : category === 'invalid' ? <Action title="预览清理此 PATH" onAction={() => runChange({ kind: 'clean', source: item.scope as EnvScope })} /> : <Action title="编辑变量" onAction={() => edit(item)} />}
    {/* macOS 的当前进程变量来自启动 ZTools 的环境，写进终端配置不会改变它，也容易把临时值固化下来：只提供复制 */}
    {item.scope !== 'process' ? <Action.CopyToClipboard title="复制变量值" content={item.value} /> : platform !== 'darwin' && <Action title="写入持久配置" onAction={() => edit(item)} />}
    {item.scope !== 'process' && <Action title="移除配置中的变量" onAction={() => runChange({ kind: 'delete', source: item.scope as EnvScope, key: item.key })} />}
    {item.scope !== 'process' && category !== 'invalid' && isPath(item) && invalid(item.scope) > 0 && <Action title="预览清理此 PATH" onAction={() => runChange({ kind: 'clean', source: item.scope as EnvScope })} />}
  </ActionPanel>
  return <List navigationTitle="环境变量" isLoading={busy} isShowingDetail={false} searchText={query} onSearchTextChange={setQuery} searchBarPlaceholder="搜索变量名、值或 PATH 目录"
    searchBarAccessory={<List.Dropdown value={category} onChange={setCategory} tooltip="来源与视图">
      <List.Dropdown.Item value="all" title="全部变量" /><List.Dropdown.Item value="user" title={platform === 'darwin' ? '终端配置' : '用户配置'} />
      {snapshot?.sources.some(s => s.id === 'system') && <List.Dropdown.Item value="system" title="系统配置" />}
      <List.Dropdown.Item value="process" title="当前进程（只读）" /><List.Dropdown.Item value="path" title="PATH 目录明细" />
      <List.Dropdown.Item value="invalid" title="含失效目录的 PATH" /><List.Dropdown.Item value="backups" title="修改备份" />
    </List.Dropdown>}
    filterBar={{ summaryText: error || (busy ? '正在读取或核验环境配置…' : snapshot ? `${count} 项 · ${platform === 'darwin' ? '终端配置在新终端加载，当前进程只读' : '修改后重新登录，当前进程只读'}` : '尚未读取环境变量'), actions: busy ? [{ id: 'cancel', title: '取消', onAction: cancel }] : [{ id: 'refresh', title: '刷新', onAction: refresh }, ...(snapshot ? [{ id: category === 'backups' ? 'export' : 'new', title: category === 'backups' ? '复制变量快照' : '新建变量', onAction: category === 'backups' ? exportBackup : () => edit() }] : [])] }}>
    {!count && <List.Item id="empty" title={error ? '环境变量读取未完成' : busy ? '正在读取' : noBackups ? '还没有修改备份' : '没有符合条件的条目'} subtitle={error || (noBackups ? '修改变量前会自动备份，目前还没有修改记录' : platform === 'darwin' && (category === 'user' || category === 'invalid') ? '这里只显示和清理 ZTools 管理段中的终端变量；.zshrc、.zprofile 等脚本里其他位置设置的变量保持原样，不在此列出。' : '成功读取后才能修改，失败不会当成空配置。')} icon={error ? Icon.ExclamationMark : Icon.Info} />}
    {groupVariables(items, platform).map(group => <List.Section key={group.scope} title={group.title}>
      {group.items.map(item => <List.Item key={`${item.scope}:${item.key}`} id={`${item.scope}:${item.key}`} title={item.key} subtitle={item.value || '（空值）'} icon={Icon.Key}
        accessories={isPath(item) && invalid(item.scope) > 0 ? [{ text: `${invalid(item.scope)} 个确认失效目录` }] : []} actions={rowActions(item)} />)}
    </List.Section>)}
    {paths.map(p => <List.Item key={`${p.scope}:${p.index}`} id={`${p.scope}:path:${p.index}`} title={p.value || '（空项：当前目录）'} subtitle={`${sourceName(p.scope, platform)} · ${p.reason}`} icon={Icon.Folder}
      actions={<ActionPanel><Action.CopyToClipboard title="复制目录" content={p.value} /></ActionPanel>} />)}
    {backups.map(b => <List.Item key={b.id} id={`backup:${b.id}`} title={b.summary} subtitle={`${b.createdAt} · ${sourceName(b.source, platform)}`} icon={Icon.Document}
      actions={<ActionPanel><Action title="预览恢复原配置" onAction={() => runChange({ kind: 'restore', source: b.source, backupId: b.id })} /><Action.CopyToClipboard title="复制备份编号" content={b.id} /></ActionPanel>} />)}
  </List>
}
export const commands = {
  'env-all': () => EnvManagerCommand(),
  'env-path-clean': () => EnvManagerCommand({ featureCode: 'env-path-clean' }),
  'env-backup': () => EnvManagerCommand({ featureCode: 'env-backup' })
}
export default EnvManagerCommand
