import React, { Action, ActionPanel, Clipboard, Detail, Form, Icon, List, Toast, confirmAlert, showToast, useEffect, useNavigation, useRef, useState } from '@ztools/declarative-ui'
import { combineHosts, hostsCodeBlock as code, loadProfiles, removeProfile, rules, saveProfile, splitHosts, type Profile } from './mac-model.js'
import { applyHosts, cancelHosts, flushHostsDns, prepareHosts, readHosts, type HostsPlan, type HostsState } from './mac-service.js'
const failure = (e: unknown) => e instanceof Error ? e.message : String(e)
export function ProfileForm({ initial, saved }: { initial?: Profile; saved: () => Promise<void> }) {
  const [name, setName] = useState(initial?.name ?? ''), [content, setContent] = useState(initial?.content ?? ''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const active = useRef(false), alive = useRef(true), { pop } = useNavigation()
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const submit = async () => {
    if (active.current) return
    active.current = true; setBusy(true); setError('')
    try {
      const profile = { id: initial?.id ?? `hosts-${globalThis.crypto.randomUUID()}`, name: name.trim(), content, updatedAt: Date.now() }
      if (!rules(content).length) throw new Error('请至少填写一条有效映射')
      await saveProfile(profile, initial); await saved()
      if (alive.current) { await showToast(Toast.Style.Success, '方案已保存到本地', '返回列表后启用才会修改系统 Hosts'); pop() }
    } catch (e) { if (alive.current) setError(failure(e)) }
    finally { active.current = false; if (alive.current) setBusy(false) }
  }
  return <Form navigationTitle={initial ? '编辑 Hosts 方案' : '新建 Hosts 方案'} isLoading={busy} actions={<ActionPanel><Action.SubmitForm title="保存本地方案" onSubmit={submit} /></ActionPanel>}>
    <Form.TextField id="name" title="方案名称" value={name} onChange={setName} /><Form.TextArea id="content" title="映射内容" value={content} onChange={setContent} placeholder="127.0.0.1 example.local" />
    <Form.Description title="应用方式" text="保存只更新本地方案；启用前会显示完整预览并请求系统授权，系统原有规则会保留。" />
    {error && <Form.Description title="未保存" text={error} />}
  </Form>
}
export function ApplyPreview({ plan, finished }: { plan: HostsPlan; finished: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), active = useRef(false), alive = useRef(true), { pop } = useNavigation()
  useEffect(() => { alive.current = true; return () => { alive.current = false; void cancelHosts().catch(e => console.warn('Hosts 预览关闭', e)) } }, [])
  const apply = async () => {
    if (active.current) return
    active.current = true; setBusy(true); setError('')
    try {
      const result = await applyHosts(plan.planId)
      if (!alive.current) return
      await finished()
      await showToast(result.dnsFlushed ? Toast.Style.Success : Toast.Style.Failure, result.dnsFlushed ? 'Hosts 已写入并刷新 DNS' : 'Hosts 已写入，DNS 未刷新', result.dnsError || `备份编号：${result.backupId}`)
      pop()
    } catch (e) { if (alive.current) setError(failure(e)) }
    finally { active.current = false; if (alive.current) setBusy(false) }
  }
  return <Detail navigationTitle="确认 Hosts 修改" isLoading={busy} markdown={`${error ? `结果未确认：${code(error)}\n` : ''}目标：${code(plan.path)}\n\n写入前校验并备份；系统授权可取消。已提交的修改需要通过备份恢复。\n\n## 修改后\n${code(plan.content)}\n## 修改前\n${code(plan.before)}`} actions={<ActionPanel>
    {!error && <Action title="确认应用到系统" icon={Icon.CheckCircle} onAction={apply} />}
    {busy ? <Action title="请求取消" onAction={async () => { await cancelHosts(); if (alive.current) setError('已请求取消，请返回重新读取系统 Hosts 确认最终状态') }} /> : <Action title="返回并重新读取" onAction={async () => { await finished(); pop() }} />}
  </ActionPanel>} />
}
export default function MacHostsCommand({ featureCode = 'hosts-all' }: { featureCode?: string } = {}) {
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
    try { await fn(operation) } catch (e) { if (alive.current) { setError(failure(e)); await showToast(Toast.Style.Failure, '操作未完成', failure(e)) } }
    finally { active.current = false; if (alive.current) setBusy(false) }
  }
  const read = () => work(refresh)
  const newProfile = () => { if (!active.current && snapshot) push(<ProfileForm saved={read} />) }
  const dns = () => work(async operation => {
    if (!(await confirmAlert({ title: '刷新系统 DNS 缓存？', message: 'macOS 将请求管理员授权；取消授权不会报告成功。', primaryAction: { title: '刷新 DNS' } })) || !alive.current || operation !== generation.current) return
    await flushHostsDns(); if (alive.current) await showToast(Toast.Style.Success, 'DNS 刷新命令已成功执行')
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
    const loaded = current.current; if (!loaded) throw new Error('请先成功读取系统 Hosts 和本地方案')
    const preview = await prepareHosts(loaded.sessionId, change)
    if (alive.current && operation === generation.current) push(<ApplyPreview plan={preview} finished={refresh} />)
  })
  const parsed = snapshot ? splitHosts(snapshot.content) : { base: '', active: [] as Profile[] }
  const all = [...profiles, ...parsed.active.filter(a => !profiles.some(p => p.id === a.id))]
  const matches = all.filter(p => `${p.name}\n${p.content}`.toLowerCase().includes(query.toLowerCase()))
  const toggle = (profile: Profile) => {
    const selected = parsed.active.find(p => p.id === profile.id), identical = selected?.content === profile.content
    try { return plan({ content: combineHosts(parsed.base, identical ? parsed.active.filter(p => p.id !== profile.id) : [...parsed.active.filter(p => p.id !== profile.id), profile]) }) }
    catch (e) { return work(async () => { throw e }) }
  }
  const remove = (profile: Profile) => work(async operation => {
    if (parsed.active.some(p => p.id === profile.id)) throw new Error('请先停用系统中的此方案，再删除本地副本')
    if (!(await confirmAlert({ title: '删除本地方案？', message: profile.name, primaryAction: { title: '删除方案' } })) || !alive.current || operation !== generation.current) return
    const next = await removeProfile(profile); if (alive.current) setProfiles(next)
  })
  const backups = () => push(<List navigationTitle="恢复 Hosts 备份" isShowingDetail={false}>
    {snapshot?.backups.length ? snapshot.backups.map(b => <List.Item key={b.id} id={b.id} title={new Date(b.createdAt).toLocaleString()} subtitle={b.id} actions={<ActionPanel><Action title="预览恢复" onAction={() => plan({ backupId: b.id })} /></ActionPanel>} />) : <List.Item id="empty-backups" title="没有备份" subtitle="每次系统写入前会自动保存原内容" />}
  </List>)
  return <List navigationTitle="域名映射" isShowingDetail={!!snapshot} isLoading={busy} searchText={query} onSearchTextChange={setQuery} searchBarPlaceholder="搜索本地方案或映射内容"
    filterBar={{ summaryText: error || (snapshot ? `${profiles.length} 个本地方案 · 系统管理区包含 ${parsed.active.length} 个方案` : '正在读取系统 Hosts 和本地方案'), actions: busy ? [{ id: 'cancel', title: '取消', onAction: async () => { ++generation.current; await cancelHosts() } }] : snapshot ? [{ id: 'new', title: '新建方案', onAction: newProfile }, { id: 'refresh', title: '重新读取', onAction: read }] : [] }}>
    {!snapshot ? <List.Item id="read-error" title={error || '正在读取'} actions={<ActionPanel><Action title="重新读取" onAction={read} /></ActionPanel>} /> : <>
      <List.Item id="system" title="当前系统 Hosts" subtitle={snapshot.path} icon={Icon.Document} detail={<List.Item.Detail markdown={code(snapshot.content)} />} actions={<ActionPanel>
        {featureCode === 'hosts-flush-dns' ? <Action title="刷新系统 DNS" onAction={dns} /> : <Action title="复制当前系统内容" onAction={() => Clipboard.copy(snapshot.content)} />}
        <Action title="查看恢复备份" onAction={backups} />
        {featureCode === 'hosts-flush-dns' ? <Action title="复制当前系统内容" onAction={() => Clipboard.copy(snapshot.content)} /> : <Action title="刷新系统 DNS" onAction={dns} />}
      </ActionPanel>} />
      {matches.map(profile => {
        const enabled = parsed.active.find(p => p.id === profile.id), changed = enabled && enabled.content !== profile.content, local = profiles.find(p => p.id === profile.id)
        return <List.Item key={profile.id} id={profile.id} title={profile.name} subtitle={`${rules(profile.content).length} 条映射`} icon={enabled ? Icon.CheckCircle : Icon.Circle} accessories={[{ text: changed ? '系统使用旧内容' : enabled ? '系统中已写入' : '未启用' }]} detail={<List.Item.Detail markdown={code(profile.content)} />} actions={<ActionPanel>
          <Action title={changed ? '预览并更新系统内容' : enabled ? '预览并停用方案' : '预览并启用方案'} onAction={() => toggle(profile)} />
          {changed && <Action title="预览并停用当前系统方案" onAction={() => plan({ content: combineHosts(parsed.base, parsed.active.filter(p => p.id !== profile.id)) })} />}
          {local && <Action title="编辑本地方案" onAction={() => { if (!active.current) push(<ProfileForm initial={local} saved={read} />) }} />}
          {local && !enabled && <Action title="删除本地方案" style={Action.Style.Destructive} onAction={() => remove(local)} />}
          {!local && <Action title="保存为本地方案" onAction={() => work(async () => { await saveProfile(profile); await refresh() })} />}
        </ActionPanel>} />
      })}
    </>}
  </List>
}
