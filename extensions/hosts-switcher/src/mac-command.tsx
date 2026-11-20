import React, { Action, ActionPanel, Clipboard, Detail, Form, Icon, List, Toast, confirmAlert, showToast, useEffect, useLocale, useNavigation, useRef, useState } from '@ztools/declarative-ui'
import { combineHosts, hostsCodeBlock as code, loadProfiles, removeProfile, rules, saveProfile, splitHosts, type Profile } from './mac-model.js'
import { applyHosts, cancelHosts, flushHostsDns, prepareHosts, readHosts, type HostsPlan, type HostsState } from './mac-service.js'
import { t } from './i18n.js'
const failure = (e: unknown) => e instanceof Error ? e.message : String(e)
async function copyText(text: string) {
  try { await Clipboard.copy(text); await showToast(Toast.Style.Success, t('toastCopiedSystemHosts')) }
  catch (e) { await showToast(Toast.Style.Failure, t('toastCopyFailed'), failure(e)) }
}
export function ProfileForm({ initial, saved }: { initial?: Profile; saved: () => Promise<void> }) {
  useLocale()
  const [name, setName] = useState(initial?.name ?? ''), [content, setContent] = useState(initial?.content ?? ''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const active = useRef(false), alive = useRef(true), { pop } = useNavigation()
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const submit = async () => {
    if (active.current) return
    active.current = true; setBusy(true); setError('')
    try {
      const profile = { id: initial?.id ?? `hosts-${globalThis.crypto.randomUUID()}`, name: name.trim(), content, updatedAt: Date.now() }
      if (!rules(content).length) throw new Error(t('errMinOneValidRule'))
      await saveProfile(profile, initial); await saved()
      if (alive.current) { await showToast(Toast.Style.Success, t('toastLocalProfileSaved'), t('toastLocalProfileSavedDesc')); pop() }
    } catch (e) { if (alive.current) setError(failure(e)) }
    finally { active.current = false; if (alive.current) setBusy(false) }
  }
  return <Form navigationTitle={initial ? t('macFormNavEdit') : t('macFormNavNew')} isLoading={busy} actions={<ActionPanel><Action.SubmitForm title={t('macSaveLocalAction')} onSubmit={submit} /></ActionPanel>}>
    <Form.TextField id="name" title={t('macFieldNameTitle')} value={name} onChange={setName} /><Form.TextArea id="content" title={t('macFieldContentTitle')} value={content} onChange={setContent} placeholder="127.0.0.1 example.local" />
    <Form.Description title={t('macApplyHintTitle')} text={t('macApplyHintText')} />
    {error && <Form.Description title={t('macUnsavedTitle')} text={error} />}
  </Form>
}
export function ApplyPreview({ plan, finished }: { plan: HostsPlan; finished: () => Promise<void> }) {
  useLocale()
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), active = useRef(false), alive = useRef(true), { pop } = useNavigation()
  useEffect(() => { alive.current = true; return () => { alive.current = false; void cancelHosts().catch(e => console.warn('Hosts 预览关闭', e)) } }, [])
  const apply = async () => {
    if (active.current) return
    active.current = true; setBusy(true); setError('')
    try {
      const result = await applyHosts(plan.planId)
      if (!alive.current) return
      // 写入已由宿主读回确认；之后重新读取列表失败只影响展示，不能把已写入说成未确认。
      let reread = ''
      try { await finished() } catch (e) { reread = failure(e) }
      const detail = [result.dnsError, reread && t('macRereadFailedNote', { error: reread })].filter(Boolean).join('; ') || t('macBackupIdNote', { id: result.backupId })
      await showToast(result.dnsFlushed && !reread ? Toast.Style.Success : Toast.Style.Failure, result.dnsFlushed ? t('toastAppliedAndDnsFlushed') : t('toastAppliedDnsNotFlushed'), detail)
      pop()
    } catch (e) { if (alive.current) setError(failure(e)) }
    finally { active.current = false; if (alive.current) setBusy(false) }
  }
  return <Detail navigationTitle={t('macPreviewNavTitle')} isLoading={busy} markdown={`${error ? `${t('macPreviewUnconfirmed', { code: code(error) })}\n` : ''}${t('macPreviewTarget', { target: code(plan.path) })}\n\n${t('macPreviewDesc')}\n\n${t('macPreviewAfter')}\n${code(plan.content)}\n${t('macPreviewBefore')}\n${code(plan.before)}`} actions={<ActionPanel>
    {!error && <Action title={t('macApplyAction')} icon={Icon.CheckCircle} onAction={apply} />}
    {busy ? <Action title={t('macRequestCancelAction')} onAction={async () => { await cancelHosts(); if (alive.current) setError(t('macCancelRequestedMsg')) }} /> : <Action title={t('macBackAndRereadAction')} onAction={async () => { await finished(); pop() }} />}
  </ActionPanel>} />
}
export default function MacHostsCommand({ featureCode = 'hosts-all' }: { featureCode?: string } = {}) {
  useLocale()
  const [snapshot, setSnapshot] = useState<HostsState | null>(null), [profiles, setProfiles] = useState<Profile[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [query, setQuery] = useState('')
  const current = useRef<HostsState | null>(null), alive = useRef(true), active = useRef(false), generation = useRef(0), { push } = useNavigation()
  const refresh = async () => {
    current.current = null; if (alive.current) setSnapshot(null)
    const locals = await loadProfiles(), state = await readHosts(); splitHosts(state.content)
    if (alive.current) { current.current = state; setSnapshot(state); setProfiles(locals) }
  }
  const work = async (fn: (operation: number) => Promise<void>) => {
    if (active.current) return
    active.current = true; const operation = ++generation.current; setBusy(true); setError('')
    try { await fn(operation) } catch (e) { if (alive.current) { setError(failure(e)); await showToast(Toast.Style.Failure, t('toastActionIncomplete'), failure(e)) } }
    finally { active.current = false; if (alive.current) setBusy(false) }
  }
  const read = () => work(refresh)
  const newProfile = () => { if (!active.current && snapshot) push(<ProfileForm saved={read} />) }
  const dns = () => work(async operation => {
    if (!(await confirmAlert({ title: t('confirmFlushDnsTitle'), message: t('confirmFlushDnsMsg'), primaryAction: { title: t('confirmFlushDnsBtn') } })) || !alive.current || operation !== generation.current) return
    await flushHostsDns(); if (alive.current) await showToast(Toast.Style.Success, t('toastDnsFlushed'))
  })
  useEffect(() => {
    alive.current = true
    void work(async () => {
      await refresh()
      if (!alive.current) return
      if (featureCode === 'hosts-new-profile') push(<ProfileForm saved={read} />)
    })
    return () => { alive.current = false; ++generation.current; void cancelHosts().catch(e => console.warn('Hosts 窗口关闭', e)) }
  }, [])
  const plan = (change: { content: string } | { backupId: string }) => work(async operation => {
    const loaded = current.current; if (!loaded) throw new Error(t('errLoadHostsFirst'))
    const preview = await prepareHosts(loaded.sessionId, change)
    if (alive.current && operation === generation.current) push(<ApplyPreview plan={preview} finished={refresh} />)
  })
  const parsed = snapshot ? splitHosts(snapshot.content) : { base: '', active: [] as Profile[] }
  const all = [...profiles, ...parsed.active.filter(a => !profiles.some(p => p.id === a.id))]
  const matches = all.filter(p => `${p.name}\n${p.content}`.toLowerCase().includes(query.toLowerCase()))
  // 合并可能因冲突抛错，统一经 work 报告，不能在动作回调里变成未处理的异常。
  const planActive = (next: () => Profile[]) => {
    let content: string
    try { content = combineHosts(parsed.base, next()) } catch (e) { return work(async () => { throw e }) }
    return plan({ content })
  }
  const toggle = (profile: Profile) => {
    const selected = parsed.active.find(p => p.id === profile.id), identical = selected?.content === profile.content
    return planActive(() => identical ? parsed.active.filter(p => p.id !== profile.id) : [...parsed.active.filter(p => p.id !== profile.id), profile])
  }
  const remove = (profile: Profile) => work(async operation => {
    if (parsed.active.some(p => p.id === profile.id)) throw new Error(t('errDisableBeforeDelete'))
    if (!(await confirmAlert({ title: t('confirmDeleteLocalTitle'), message: profile.name, primaryAction: { title: t('confirmDeleteLocalBtn') } })) || !alive.current || operation !== generation.current) return
    const next = await removeProfile(profile); if (alive.current) setProfiles(next)
  })
  const backups = () => push(<List navigationTitle={t('macBackupsNavTitle')} isShowingDetail={false}>
    {snapshot?.backups.length ? snapshot.backups.map(b => <List.Item key={b.id} id={b.id} title={new Date(b.createdAt).toLocaleString()} subtitle={b.id} actions={<ActionPanel><Action title={t('macPreviewRestoreAction')} onAction={() => plan({ backupId: b.id })} /></ActionPanel>} />) : <List.Item id="empty-backups" title={t('macNoBackupsTitle')} subtitle={t('macNoBackupsSub')} />}
  </List>)
  return <List navigationTitle={t('macNavTitle')} isShowingDetail={!!snapshot} isLoading={busy} searchText={query} onSearchTextChange={setQuery} searchBarPlaceholder={t('macSearchPlaceholder')}
    filterBar={{ summaryText: error || (snapshot ? t('macSummaryText', { localCount: profiles.length, activeCount: parsed.active.length }) : t('macLoadingSummary')), actions: busy ? [{ id: 'cancel', title: t('macCancelBtn'), onAction: async () => { ++generation.current; await cancelHosts() } }] : snapshot ? [{ id: 'new', title: t('macNewBtn'), onAction: newProfile }, { id: 'refresh', title: t('macRefreshBtn'), onAction: read }] : [] }}>
    {!snapshot ? <List.Item id="read-error" title={error || t('macLoadingTitle')} actions={<ActionPanel><Action title={t('macRefreshBtn')} onAction={read} /></ActionPanel>} /> : <>
      <List.Item id="system" title={t('macSystemHostsTitle')} subtitle={snapshot.path} icon={Icon.Document} detail={<List.Item.Detail markdown={code(snapshot.content)} />} actions={<ActionPanel>
        {featureCode === 'hosts-flush-dns' ? <Action title={t('macActionFlushDns')} onAction={dns} /> : <Action title={t('macActionCopySystem')} onAction={() => copyText(snapshot.content)} />}
        <Action title={t('macActionViewBackups')} onAction={backups} />
        {featureCode === 'hosts-flush-dns' ? <Action title={t('macActionCopySystem')} onAction={() => copyText(snapshot.content)} /> : <Action title={t('macActionFlushDns')} onAction={dns} />}
      </ActionPanel>} />
      {matches.map(profile => {
        const enabled = parsed.active.find(p => p.id === profile.id), changed = enabled && enabled.content !== profile.content, local = profiles.find(p => p.id === profile.id)
        return <List.Item key={profile.id} id={profile.id} title={profile.name} subtitle={t('macRulesSubtitle', { count: rules(profile.content).length })} icon={enabled ? Icon.CheckCircle : Icon.Circle} accessories={[{ text: changed ? t('macTagOutdated') : enabled ? t('macTagActive') : t('macTagInactive') }]} detail={<List.Item.Detail markdown={code(profile.content)} />} actions={<ActionPanel>
          <Action title={changed ? t('macActionUpdateSystem') : enabled ? t('macActionDisableProfile') : t('macActionEnableProfile')} onAction={() => toggle(profile)} />
          {changed && <Action title={t('macActionDisableActive')} onAction={() => planActive(() => parsed.active.filter(p => p.id !== profile.id))} />}
          {local && <Action title={t('macActionEditLocal')} onAction={() => { if (!active.current) push(<ProfileForm initial={local} saved={read} />) }} />}
          {local && !enabled && <Action title={t('macActionDeleteLocal')} style={Action.Style.Destructive} onAction={() => remove(local)} />}
          {!local && <Action title={t('macActionSaveLocal')} onAction={() => work(async () => { await saveProfile(profile); await refresh() })} />}
        </ActionPanel>} />
      })}
    </>}
  </List>
}
