import React, { Action, ActionPanel, Icon, List, Toast, confirmAlert, showToast, useEffect, useRef, useState } from '@ztools/declarative-ui'
import { filterStartup, scanStartup, startupInvoke, startupOperation, type StartupReport, type MacStartupItem } from './mac-service.js'

export default function MacStartupCommand({ featureCode }: { featureCode?: string }) {
  const [report, setReport] = useState<StartupReport | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [query, setQuery] = useState(''), [filter, setFilter] = useState(featureCode === 'startup-services' ? 'service' : featureCode === 'startup-tasks' ? 'task' : 'all')
  const alive = useRef(true), occupied = useRef(false), pending = useRef<string | null>(null), cancelled = useRef(false)
  const load = async () => {
    const operationId = startupOperation(); pending.current = operationId
    const data = await scanStartup(operationId)
    if (alive.current && !cancelled.current) setReport(data)
  }
  const perform = async (action = 'scan', fields: Record<string, unknown> = {}) => {
    if (occupied.current) { await showToast({ style: Toast.Style.Failure, title: '上一项启动管理操作尚未结束', message: '请等待完成，或在状态栏点“停止操作”' }); return }
    occupied.current = true; cancelled.current = false; setBusy(true); setError('')
    if (action === 'scan') setReport(null)
    try {
      if (action !== 'scan') {
        const operationId = startupOperation(); pending.current = operationId
        const result = await startupInvoke('startup_manager', { action, operationId, ...fields })
        if (!alive.current || cancelled.current) return
        if (action === 'settings') { if (result.accepted !== true) throw new Error('系统设置未确认打开'); return }
        if (typeof result.backupId !== 'string' || typeof result.message !== 'string' ||
            (action === 'set-enabled' ? result.enabled !== fields.enabled : action === 'remove' ? result.removed !== true : result.restored !== true && typeof result.enabled !== 'boolean')) throw new Error('系统修改回执不完整，请重新扫描')
        await showToast({ style: Toast.Style.Success, title: action === 'remove' ? '失效配置已移入恢复目录' : action === 'restore' ? '已恢复原配置状态' : result.enabled ? '已允许自启' : '已禁止后续自启', message: result.message })
      }
      if (alive.current && !cancelled.current) await load()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (!alive.current || cancelled.current) return
      if (action === 'scan' || action === 'settings') { if (action === 'scan') setReport(null); setError(message); return }
      // 修改失败后系统状态可能已部分变化：如实提示失败，并重新读取列表，避免继续显示旧状态
      setError(message)
      await showToast({ style: Toast.Style.Failure, title: action === 'remove' ? '清理失效配置未确认' : action === 'restore' ? '恢复未完成' : '修改自启状态未确认', message })
      try { if (alive.current && !cancelled.current) await load() }
      catch (reloadError) { if (alive.current && !cancelled.current) { setReport(null); setError(`${message}；重新扫描也失败：${reloadError instanceof Error ? reloadError.message : String(reloadError)}`) } }
    } finally { pending.current = null; occupied.current = false; if (alive.current) setBusy(false) }
  }
  const stop = async () => {
    cancelled.current = true
    setError('正在停止；如果系统授权窗口仍打开，请点取消')
    try {
      if (pending.current) await startupInvoke('startup_manager', { action: 'cancel', operationId: pending.current })
      if (alive.current) { setReport(null); setError('操作已停止，请重新扫描确认系统状态') }
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)) }
  }
  const remove = async (item: MacStartupItem) => {
    if (occupied.current) return
    const confirmed = await confirmAlert({ title: `清理失效配置「${item.label}」？`, message: `程序已丢失：${item.program}。原配置会移入恢复目录，可在“恢复记录”中还原；不会结束当前已加载的任务。` })
    if (confirmed && alive.current) await perform('remove', { id: item.id })
  }
  useEffect(() => {
    alive.current = true; void perform()
    return () => { alive.current = false; cancelled.current = true; if (pending.current) void startupInvoke('startup_manager', { action: 'cancel', operationId: pending.current }).catch(e => console.error('取消启动管理失败', e)) }
  }, [])
  const rows = filterStartup(report?.items || [], query, filter)
  const backups = (report?.backups || []).filter(b => b.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  return <List isShowingDetail={false} isLoading={busy} searchText={query} onSearchTextChange={setQuery} searchBarPlaceholder="搜索启动项、程序或配置路径"
    searchBarAccessory={<List.Dropdown value={filter} onChange={setFilter} tooltip="筛选启动项">
      <List.Dropdown.Item value="all" title="全部配置" /><List.Dropdown.Item value="user" title="当前用户" /><List.Dropdown.Item value="service" title="系统服务" />
      <List.Dropdown.Item value="task" title="计划任务" /><List.Dropdown.Item value="disabled" title="已禁用" /><List.Dropdown.Item value="broken" title="程序已丢失" /><List.Dropdown.Item value="backups" title="恢复记录" />
    </List.Dropdown>}
    filterBar={{ summaryText: error || (busy ? '正在处理启动配置' : filter === 'backups' ? `${backups.length} 条恢复记录` : `${rows.length} 个 launchd 启动配置 · App 登录项在“系统设置 > 通用 > 登录项与扩展”中管理`), actions: [
      { id: 'scan', title: busy ? '停止操作' : '重新扫描', onAction: () => busy ? stop() : perform() },
      { id: 'settings', title: '系统登录项设置', onAction: () => perform('settings') }
    ] }}>
    {filter !== 'backups' && rows.map(item => <List.Item key={item.id} id={item.id} title={item.label} subtitle={item.program} icon={Icon.Gear}
      accessories={[{ tag: item.enabled ? '允许自启' : '禁止自启' }, { text: item.running ? `运行中${item.pid ? ` · PID ${item.pid}` : ''}` : item.loaded ? '已加载' : '未加载' },
        ...(item.scheduled ? [{ tag: '计划任务' }] : []), ...(item.requiresAdmin ? [{ tag: '系统权限' }] : []), ...(item.programState === 'missing' ? [{ tag: '程序丢失' }] : [])]}
      actions={<ActionPanel>
        <Action title={item.blockedReason ? '查看限制原因' : item.enabled ? '禁止后续自启' : '允许自启'} onAction={async () => {
          if (item.blockedReason) await showToast({ style: Toast.Style.Failure, title: '此配置不能直接修改', message: item.blockedReason })
          else await perform('set-enabled', { id: item.id, enabled: !item.enabled })
        }} />
        <Action.CopyToClipboard title="复制程序路径" content={item.program} />
        <Action.CopyToClipboard title="复制启动配置路径" content={item.file} />
        <Action.CopyToClipboard title="复制程序参数" content={JSON.stringify(item.args)} />
        {item.programState === 'missing' && !item.blockedReason && <Action title="移除失效配置（可恢复）" icon={Icon.Trash} style={Action.Style.Destructive} onAction={() => remove(item)} />}
      </ActionPanel>} />)}
    {filter === 'backups' && backups.map(backup => <List.Item key={backup.id} id={backup.id} title={backup.label} subtitle={`${new Date(backup.createdAt).toLocaleString()} · ${backup.kind === 'remove' ? '失效配置清理' : `${backup.beforeEnabled ? '允许' : '禁止'} → ${backup.afterEnabled ? '允许' : '禁止'}`}`}
      actions={<ActionPanel><Action title={backup.kind === 'remove' ? '恢复启动配置' : `恢复为${backup.beforeEnabled ? '允许' : '禁止'}自启`} onAction={() => perform('restore', { id: backup.id })} /></ActionPanel>} />)}
    {!busy && (filter === 'backups' ? !backups.length : !rows.length) && <List.Item id="empty" title={error || (filter === 'backups' ? '没有恢复记录' : '没有匹配的启动配置')}
      subtitle="只读取 ~/Library/LaunchAgents、/Library/LaunchAgents 与 /Library/LaunchDaemons；App 自行注册的登录项请在系统设置中查看"
      actions={<ActionPanel><Action title="重新扫描" icon={Icon.ArrowClockwise} onAction={() => perform()} /><Action title="打开系统登录项设置" onAction={() => perform('settings')} /></ActionPanel>} />}
    {filter !== 'backups' && report?.warnings.map((warning, index) => <List.Item key={`warning-${index}`} id={`warning-${index}`} icon={Icon.ExclamationMark} title="部分配置读取失败，列表不完整" subtitle={warning}
      actions={<ActionPanel><Action.CopyToClipboard title="复制错误信息" content={warning} /><Action title="重新扫描" icon={Icon.ArrowClockwise} onAction={() => perform()} /></ActionPanel>} />)}
  </List>
}
