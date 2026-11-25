import React, { Action, ActionPanel, Clipboard, Form, Icon, List, Toast, confirmAlert, getLocale, showToast, useEffect, useLocale, useNavigation, useRef, useState } from '@ztools/declarative-ui'
import { t } from './i18n.js'
import { applyEnvironment, cancelEnvironment, darwinPathProblem, exportEnvSnapshot, isPathKey, loadEnvironment, prepareEnvironment } from './env-service.js'
import type { EnvChange, EnvItem, EnvScope, EnvSnapshot } from './types.js'
export * from './types.js'
export * from './env-service.js'
const failure = (error: unknown) => error instanceof Error ? error.message : String(error)
const sourceName = (scope: EnvItem['scope'], platform: string) => scope === 'process' ? t('sourceProcess') : scope === 'system' ? t('sourceSystem') : platform === 'darwin' ? t('sourceDarwinShell') : t('sourceUser')
/**
 * 当前进程里由 shell 或系统自动维护、对用户没有意义的变量：`_`（上一条命令的参数）、SHLVL、OLDPWD，
 * 以及 macOS 以双下划线开头的系统私有变量（如 __CF_USER_TEXT_ENCODING、__CFBundleIdentifier）。
 * 只过滤当前进程；用户在配置里自己写的同名变量照常显示。
 */
export function isShellInternal(item: Pick<EnvItem, 'key' | 'scope'>): boolean {
  return item.scope === 'process' && (item.key === '_' || item.key === 'SHLVL' || item.key === 'OLDPWD' || item.key.startsWith('__'))
}
/**
 * 名字像密钥的变量（GITHUB_TOKEN、AWS_SECRET_ACCESS_KEY、OPENAI_API_KEY、DB_PASSWORD 等）：列表里默认遮住值，
 * 防止打开插件或共享屏幕时直接露出密钥；用户在操作面板里选「显示变量值」才显示，复制和编辑不受影响。
 */
export function isSensitiveKey(key: string): boolean {
  return /(^|_)(TOKEN|TOKENS|SECRET|SECRETS|PASSWORD|PASSWD|PASSPHRASE|PWD_?HASH|CREDENTIALS?|PRIVATE_?KEY|ACCESS_?KEY|API_?KEY|KEY|COOKIE)(_|$)/i.test(key) && key.toUpperCase() !== 'PWD'
}
/** 遮住后的显示：只说明有值和长度，不露出任何字符 */
export function maskedValue(value: string): string {
  return value ? t('maskedValueHidden', { count: value.length }) : t('emptyValueLabel')
}
const SCOPE_ORDER: EnvItem['scope'][] = ['user', 'system', 'process']
/** 变量按来源分组（用户/终端、系统、当前进程），组内按变量名排序（不区分大小写）；来源只在分组标题出现一次，不在每行重复。 */
export function groupVariables(items: EnvItem[], platform: string) {
  const locale = getLocale()
  return SCOPE_ORDER.map(scope => ({
    scope,
    title: scope === 'process' ? t('sourceProcessReadonly') : sourceName(scope, platform),
    items: items.filter(v => v.scope === scope).sort((a, b) => a.key.localeCompare(b.key, locale, { sensitivity: 'base' }) || a.key.localeCompare(b.key, locale))
  })).filter(group => group.items.length)
}

export function EnvVarForm({ item, snapshot, onSave }: { item?: EnvItem; snapshot: EnvSnapshot; onSave: (change: EnvChange, isCurrent: () => boolean) => Promise<boolean> }) {
  useLocale()
  const { pop } = useNavigation()
  const [key, setKey] = useState(item?.key || ''), [value, setValue] = useState(item?.value || '')
  const [source, setSource] = useState<EnvScope>(item?.scope === 'system' ? 'system' : 'user'), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const active = useRef(false), alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (active.current) void cancelEnvironment().catch(e => console.warn('Cancel unconfirmed after form close', e)) } }, [])
  const submit = async () => {
    if (active.current) return
    active.current = true; setBusy(true); setError('')
    try {
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key.trim())) throw new Error(t('invalidVarName'))
      const pathProblem = snapshot.platform === 'darwin' && key.trim() === 'PATH' ? darwinPathProblem(value) : ''
      if (pathProblem) throw new Error(pathProblem)
      if (await onSave({ kind: 'set', source, key: key.trim(), value }, () => alive.current) && alive.current) pop()
    } catch (e) { if (alive.current) { setError(failure(e)); await showToast(Toast.Style.Failure, t('toastNotSavedTitle'), failure(e)) } }
    finally { active.current = false; if (alive.current) setBusy(false) }
  }
  return <Form navigationTitle={item?.scope === 'process' ? t('formTitlePersist') : item ? t('formTitleEdit') : t('formTitleNew')} isLoading={busy}
    actions={<ActionPanel><Action.SubmitForm title={t('actionPreviewSave')} onSubmit={submit} /><Action title={t('actionCancelBack')} onAction={pop} /></ActionPanel>}>
    {item ? <Form.Description title={t('fieldKeyTitle')} text={key} /> : <Form.TextField id="key" title={t('fieldKeyTitle')} value={key} onChange={setKey} placeholder={t('fieldKeyPlaceholder')} />}
    <Form.TextArea id="value" title={t('fieldValueTitle')} value={value} onChange={setValue} placeholder={t('fieldValuePlaceholder')} />
    <Form.Dropdown id="source" title={t('fieldSourceTitle')} value={source} onChange={v => setSource(v as EnvScope)}>
      {snapshot.sources.map(s => <Form.Dropdown.Item key={s.id} value={s.id} title={s.label} />)}
    </Form.Dropdown>
    <Form.Description title={t('fieldNoticeTitle')} text={snapshot.notice} />
    {snapshot.platform === 'darwin' && <Form.Description title={t('fieldLiteralTitle')} text={t('fieldLiteralText')} />}
    {snapshot.platform === 'darwin' && key.trim() === 'PATH' && <Form.Description title={t('fieldPathHintTitle')} text={t('darwinPathNotice')} />}
    {error && <Form.Description title={t('fieldNotSavedTitle')} text={error} />}
  </Form>
}

export function EnvManagerCommand({ featureCode = 'env-all' }: { featureCode?: string } = {}) {
  useLocale()
  const { push } = useNavigation()
  const [snapshot, setSnapshot] = useState<EnvSnapshot | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [revealed, setRevealed] = useState<string[]>([])
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
    try { await fn() } catch (e) { if (alive.current) { setError(failure(e)); await showToast(Toast.Style.Failure, t('toastOpFailedTitle'), failure(e)) } }
    finally { active.current = false; if (alive.current) setBusy(false) }
  }
  const refresh = () => work(reload)
  useEffect(() => { alive.current = true; void refresh(); return () => { alive.current = false; if (active.current) void cancelEnvironment().catch(e => console.warn('Env cancellation unconfirmed', e)) } }, [])
  const mutate = async (change: EnvChange, isCurrent: () => boolean = () => true): Promise<boolean> => {
    if (active.current) throw new Error(t('errOpBusy'))
    const loaded = current.current
    if (!loaded) throw new Error(t('errLoadEnvFirst'))
    active.current = true; setBusy(true); setError('')
    try {
      const plan = await prepareEnvironment(loaded.sessionId, change)
      if (!alive.current || !isCurrent()) return false
      const pathWarning = loaded.platform === 'darwin' && change.kind === 'set' && change.key === 'PATH' ? t('darwinPathNotice') + '\n' : ''
      const removedPart = plan.removed.length ? t('confirmRemovedHeader', { dirs: plan.removed.join('\n') }) : ''
      const confirmed = await confirmAlert({ title: plan.summary, message: `${t('confirmLocationLabel', { location: plan.location })}${pathWarning}${removedPart}${t('confirmBackupNote', { notice: plan.notice })}`, primaryAction: { title: t('confirmApplyBtn') }, dismissAction: { title: t('cancelBtn') } })
      if (!confirmed || !alive.current || !isCurrent()) { await cancelEnvironment(); return false }
      let result: { backupId: string; summary: string; recoveryPath?: string } | undefined, operationError = ''
      try { result = await applyEnvironment(plan.planId) } catch (e) { operationError = failure(e) }
      if (!alive.current) return false
      let refreshError = ''
      try { await reload() } catch (e) { refreshError = failure(e) }
      if (operationError) throw new Error(refreshError ? `${operationError}; ${t('refreshFailedPrefix', { error: refreshError })}` : operationError)
      if (refreshError) {
        // 写入已读回核验，只是列表没刷新成功：如实说明已保存，不报成“未修改成功”，以免用户重复提交
        if (alive.current) { setError(t('savedRefreshFailedErr', { error: refreshError })); await showToast(Toast.Style.Failure, t('savedRefreshFailedToastTitle'), t('savedRefreshFailedToastMsg', { error: refreshError })) }
        return isCurrent()
      }
      if (alive.current && isCurrent() && result) await showToast(Toast.Style.Success, t('toastSavedTitle'), result.recoveryPath ? t('toastSavedRecoveryMsg', { path: result.recoveryPath }) : t('toastSavedBackupMsg'))
      return isCurrent()
    } finally { active.current = false; if (alive.current) setBusy(false) }
  }
  const runChange = async (change: EnvChange) => { try { await mutate(change) } catch (e) { if (alive.current) { setError(failure(e)); await showToast(Toast.Style.Failure, t('toastChangeUnconfirmed'), failure(e)) } } }
  const edit = (item?: EnvItem) => { const loaded = current.current; if (loaded && !active.current) push(<EnvVarForm item={item} snapshot={loaded} onSave={mutate} />) }
  const exportBackup = () => work(async () => {
    if (!current.current) throw new Error(t('errLoadEnvFirst'))
    await Clipboard.copy(exportEnvSnapshot(current.current))
    if (alive.current) await showToast(Toast.Style.Success, t('toastSnapshotCopiedTitle'), t('toastSnapshotCopiedMsg'))
  })
  const cancel = async () => { try { await cancelEnvironment() } catch (e) { if (alive.current) setError(t('cancelUnconfirmed', { error: failure(e) })) } }
  const q = query.trim().toLowerCase(), platform = snapshot?.platform || ''
  const invalid = (scope: EnvItem['scope']) => snapshot?.paths.filter(p => p.scope === scope && p.status === 'missing').length || 0
  const isPath = (item: EnvItem) => isPathKey(item.key, platform)
  // “含失效目录的 PATH”只列可清理的持久配置；当前进程只读，不能清理
  const items = snapshot?.variables.filter(v => !isShellInternal(v) && (category === 'all' || category === v.scope || (category === 'invalid' && v.scope !== 'process' && isPath(v) && invalid(v.scope) > 0)) && `${v.key} ${v.value}`.toLowerCase().includes(q)) || []
  const paths = category === 'path' ? snapshot?.paths.filter(p => p.value.toLowerCase().includes(q)) || [] : []
  const backups = category === 'backups' ? snapshot?.backups.filter(b => `${b.createdAt} ${b.summary}`.toLowerCase().includes(q)) || [] : []
  const noBackups = category === 'backups' && Boolean(snapshot) && !snapshot?.backups.length
  const count = category === 'path' ? paths.length : category === 'backups' ? backups.length : items.length
  const rowId = (item: EnvItem) => `${item.scope}:${item.key}`
  const hidden = (item: EnvItem) => Boolean(item.value) && isSensitiveKey(item.key) && !revealed.includes(rowId(item))
  const toggleReveal = (item: EnvItem) => setRevealed(list => list.includes(rowId(item)) ? list.filter(id => id !== rowId(item)) : [...list, rowId(item)])
  const rowActions = (item: EnvItem) => <ActionPanel>
    {item.scope === 'process' ? <Action.CopyToClipboard title={t('actionCopyValue')} content={item.value} /> : category === 'invalid' ? <Action title={t('actionPreviewCleanPath')} onAction={() => runChange({ kind: 'clean', source: item.scope as EnvScope })} /> : <Action title={t('actionEditVar')} onAction={() => edit(item)} />}
    {/* macOS 的当前进程变量来自启动 ZTools 的环境，写进终端配置不会改变它，也容易把临时值固化下来：只提供复制 */}
    {item.scope !== 'process' ? <Action.CopyToClipboard title={t('actionCopyValue')} content={item.value} /> : platform !== 'darwin' && <Action title={t('actionPersistVar')} onAction={() => edit(item)} />}
    {item.scope !== 'process' && <Action title={t('actionRemoveVar')} onAction={() => runChange({ kind: 'delete', source: item.scope as EnvScope, key: item.key })} />}
    {item.scope !== 'process' && category !== 'invalid' && isPath(item) && invalid(item.scope) > 0 && <Action title={t('actionPreviewCleanPath')} onAction={() => runChange({ kind: 'clean', source: item.scope as EnvScope })} />}
    {Boolean(item.value) && isSensitiveKey(item.key) && <Action title={hidden(item) ? t('actionShowValue') : t('actionHideValue')} onAction={() => toggleReveal(item)} />}
  </ActionPanel>
  return <List navigationTitle={t('navTitle')} isLoading={busy} isShowingDetail={false} searchText={query} onSearchTextChange={setQuery} searchBarPlaceholder={t('searchPlaceholder')}
    searchBarAccessory={<List.Dropdown value={category} onChange={setCategory} tooltip={t('dropdownTooltip')}>
      <List.Dropdown.Item value="all" title={t('filterAll')} /><List.Dropdown.Item value="user" title={platform === 'darwin' ? t('sourceDarwinShell') : t('sourceUser')} />
      {snapshot?.sources.some(s => s.id === 'system') && <List.Dropdown.Item value="system" title={t('sourceSystem')} />}
      <List.Dropdown.Item value="process" title={t('sourceProcessReadonly')} /><List.Dropdown.Item value="path" title={t('filterPathDetails')} />
      <List.Dropdown.Item value="invalid" title={t('filterInvalidPath')} /><List.Dropdown.Item value="backups" title={t('filterBackups')} />
    </List.Dropdown>}
    filterBar={{ summaryText: error || (busy ? t('summaryBusy') : snapshot ? t('summaryReady', { count, hint: platform === 'darwin' ? t('summaryHintDarwin') : t('summaryHintWin') }) : t('summaryNotLoaded')), actions: busy ? [{ id: 'cancel', title: t('cancelBtn'), onAction: cancel }] : [{ id: 'refresh', title: t('actionRefresh'), onAction: refresh }, ...(snapshot ? [{ id: category === 'backups' ? 'export' : 'new', title: category === 'backups' ? t('actionCopySnapshot') : t('actionNewVar'), onAction: category === 'backups' ? exportBackup : () => edit() }] : [])] }}>
    {!count && <List.Item id="empty" title={error ? t('emptyLoadIncomplete') : busy ? t('emptyLoading') : noBackups ? t('emptyNoBackups') : t('emptyNoMatch')} subtitle={error || (noBackups ? t('emptyNoBackupsSub') : platform === 'darwin' && (category === 'user' || category === 'invalid') ? t('emptyDarwinSub') : t('emptyDefaultSub'))} icon={error ? Icon.ExclamationMark : Icon.Info} />}
    {groupVariables(items, platform).map(group => <List.Section key={group.scope} title={group.title}>
      {group.items.map(item => <List.Item key={`${item.scope}:${item.key}`} id={`${item.scope}:${item.key}`} title={item.key} subtitle={hidden(item) ? maskedValue(item.value) : item.value || t('emptyValueLabel')} icon={Icon.Key}
        accessories={isPath(item) && invalid(item.scope) > 0 ? [{ text: t('invalidDirCountTag', { count: invalid(item.scope) }) }] : []} actions={rowActions(item)} />)}
    </List.Section>)}
    {paths.map(p => <List.Item key={`${p.scope}:${p.index}`} id={`${p.scope}:path:${p.index}`} title={p.value || t('emptyPathEntryLabel')} subtitle={`${sourceName(p.scope, platform)} · ${p.reason}`} icon={Icon.Folder}
      actions={<ActionPanel><Action.CopyToClipboard title={t('actionCopyDir')} content={p.value} /></ActionPanel>} />)}
    {backups.map(b => <List.Item key={b.id} id={`backup:${b.id}`} title={b.summary} subtitle={`${b.createdAt} · ${sourceName(b.source, platform)}`} icon={Icon.Document}
      actions={<ActionPanel><Action title={t('actionPreviewRestore')} onAction={() => runChange({ kind: 'restore', source: b.source, backupId: b.id })} /><Action.CopyToClipboard title={t('actionCopyBackupId')} content={b.id} /></ActionPanel>} />)}
  </List>
}
export const commands = {
  'env-all': () => EnvManagerCommand(),
  'env-path-clean': () => EnvManagerCommand({ featureCode: 'env-path-clean' }),
  'env-backup': () => EnvManagerCommand({ featureCode: 'env-backup' })
}
export default EnvManagerCommand
