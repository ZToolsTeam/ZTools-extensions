import React, { Action, ActionPanel, Icon, List, Toast, showToast, useEffect, useRef, useState } from '@ztools/declarative-ui'
import { cancelMacProjects, describeOpenError, filterMacProjects, openMacProject, projectOperationId, scanMacProjects, type MacProject, type MacProjectsReport } from './mac-service.js'

export default function MacProjectsCommand({ featureCode }: { featureCode?: string }) {
  const [report, setReport] = useState<MacProjectsReport | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [query, setQuery] = useState(''), [family, setFamily] = useState(featureCode === 'projects-vscode-cursor' ? 'vsc' : featureCode === 'projects-jetbrains' ? 'jetbrains' : 'all'), [hideMissing, setHideMissing] = useState(false)
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
    const message = pendingAction.current === 'scan' ? '扫描已停止' : '打开请求已取消，请检查目标应用窗口'
    try { if (pending.current) await cancelMacProjects(pending.current); if (alive.current) setError(message) }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)) }
  }
  useEffect(() => {
    alive.current = true; void scan()
    return () => { alive.current = false; cancelled.current = true; if (pending.current) void cancelMacProjects(pending.current).catch(e => console.error('停止项目读取失败', e)) }
  }, [])
  const open = async (item: MacProject, action: 'open' | 'terminal') => {
    if (guard.current) return
    // 扫描时已确认路径不存在：直接如实提示，不再向系统发送注定失败的打开请求
    if (item.pathState === 'missing') { await showToast({ style: Toast.Style.Failure, title: '项目路径不存在', message: `${item.path}。若已恢复请重新扫描` }); return }
    guard.current = true; cancelled.current = false; pending.current = item.id; pendingAction.current = 'open'; setBusy(true); setError('')
    try { await openMacProject(item, action); if (alive.current && !cancelled.current) await showToast({ style: Toast.Style.Success, title: action === 'open' ? `已向 ${item.editorName} 发送打开请求` : '已向终端发送打开请求' }) }
    catch (e) { if (alive.current && !cancelled.current) await showToast({ style: Toast.Style.Failure, title: '打开失败', message: describeOpenError(e, item) }) }
    finally { if (pending.current === item.id) { pending.current = null; pendingAction.current = null }; guard.current = false; if (alive.current) setBusy(false) }
  }
  const rows = filterMacProjects(report?.projects || [], query, family, hideMissing)
  return <List isShowingDetail={false} isLoading={busy} searchText={query} onSearchTextChange={setQuery} searchBarPlaceholder="搜索项目名称、路径、编辑器或 Git 分支"
    searchBarAccessory={<List.Dropdown value={family} tooltip="筛选编辑器" onChange={setFamily}><List.Dropdown.Item title="全部编辑器" value="all" /><List.Dropdown.Item title="VS Code / Cursor / Trae / Windsurf" value="vsc" /><List.Dropdown.Item title="JetBrains" value="jetbrains" /></List.Dropdown>}
    filterBar={{ summaryText: busy ? (pendingAction.current === 'scan' ? '正在读取本地项目历史' : '正在打开项目') : error || `${rows.length} 个项目 · ${report?.sourcesRead || 0} 份历史记录${report?.skippedRemote ? ` · 跳过 ${report.skippedRemote} 条远程记录` : ''}`, actions: [
      // 空状态条目的主动作已是“重新扫描”，此时工具栏不再重复；扫描/打开进行中始终保留停止入口
      ...(!busy && !rows.length ? [] : [{ id: 'scan', title: busy ? (pendingAction.current === 'scan' ? '停止扫描' : '取消打开') : '重新扫描', onAction: () => busy ? stop() : scan() }]),
      { id: 'missing', title: hideMissing ? '显示失效项目' : '隐藏失效项目', onAction: () => setHideMissing(!hideMissing) }
    ] }}>
    {rows.map(item => <List.Item key={item.id} id={item.id} title={item.name} subtitle={item.path} icon={Icon.Folder} accessories={[
      { tag: item.editorName }, ...(item.gitBranch ? [{ text: item.gitBranch }] : []),
      ...(item.pathState === 'available' ? [] : [{ tag: item.pathState === 'missing' ? '路径不存在' : '无法访问' }]),
      ...(item.lastOpenedMs ? [{ text: new Date(item.lastOpenedMs).toLocaleDateString() }] : [])
    ]} actions={<ActionPanel>
      <Action title={`用 ${item.editorName} 打开项目`} onAction={() => open(item, 'open')} />
      <Action title="在终端打开" shortcut={{ modifiers: ['cmd'], key: 'enter' }} onAction={() => open(item, 'terminal')} />
      <Action.CopyToClipboard title="复制项目路径" content={item.path} />
      {item.gitBranch && <Action.CopyToClipboard title="复制 Git 分支" content={item.gitBranch} />}
    </ActionPanel>} />)}
    {!rows.length && !busy && <List.Item id="empty" title={error || (report?.projects.length ? '没有匹配的项目' : '没有找到本地项目历史')} subtitle={error ? '原始历史记录未修改，可重新扫描' : '读取编辑器的最近文件夹与工作区；隐藏失效项目不会删除记录'}
      actions={<ActionPanel><Action title="重新扫描" icon={Icon.ArrowClockwise} onAction={() => scan()} /></ActionPanel>} />}
    {report?.warnings.map((warning, index) => <List.Item key={index} id={`warning-${index}`} title="部分历史读取失败" subtitle={warning} />)}
  </List>
}
