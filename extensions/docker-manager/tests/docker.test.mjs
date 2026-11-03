import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { Toast } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import { DockerManagerCommand, commands, containerWebUrl, listContainers, removeContainers, getContainerTailLogs, logMarkdown } from '../dist/index.js'
const a = 'a'.repeat(64), b = 'b'.repeat(64), sessionId = '12345678-1234-1234-1234-123456789012'
const container = (id, state = 'exited') => ({ id, name: id === a ? 'alpha' : 'beta', image: 'fixture:latest', state, status: state, ports: '', createdAt: '2026-01-01', cpu: null, memory: null })
let host, views, rows
beforeEach(() => {
  host = createHost(); views = []; rows = [container(a), container(b, 'running')]
  host.ipc.docker_manager = async p => {
    if (p.action === 'list') return { success: true, sessionId, context: 'local', containers: structuredClone(rows), statsError: null }
    if (p.action === 'control') { rows.find(c => c.id === p.id).state = p.operation === 'stop' ? 'exited' : 'running'; return { success: true, id: p.id, state: rows.find(c => c.id === p.id).state } }
    if (p.action === 'logs') return { success: true, id: p.id, stdout: 'actual output\n```\n[link](https://example.invalid)', stderr: 'actual error' }
    if (p.action === 'remove') { rows = rows.filter(c => !p.ids.includes(c.id)); return { success: true, removed: p.ids, failures: [] } }
    if (p.action === 'cancel') return { success: true, cancelRequested: true }
    throw new Error('unexpected request')
  }
})
afterEach(() => { for (const v of views) v.unmount() })
async function open(Command = DockerManagerCommand) { const v = await mount(Command, host); views.push(v); await tick(); return v }
const globalAction = (v, id) => v.tree().props.filterBar.actions.find(a => a.id === id).onAction()
test('入口挂载即真实读取；显式命令应用筛选；无演示容器', async () => {
  const v = await open(); assert.equal(v.items().length, 2); assert.equal(v.tree().props.isShowingDetail, false)
  assert.ok(host.ipcCalls.some(([m, p]) => m === 'docker_manager' && p.action === 'list'))
  const running = await open(commands['docker-running']); assert.deepEqual(running.items().map(c => c.props.id), [b])
  const stopped = await open(commands['docker-clean-stopped']); assert.deepEqual(stopped.items().map(c => c.props.id), [a])
  assert.ok(!host.ipcCalls.some(([, p]) => p.action === 'remove'))
})
test('启动后读取实际列表，未盲目翻转原记录；操作失败保留错误', async () => {
  const v = await open(); await v.run(v.item(a), '启动容器'); assert.equal(rows[0].state, 'running'); assert.match(host.lastToast().title, /状态已更新/)
  host.ipc.docker_manager = async p => { if (p.action === 'control') throw new Error('permission denied'); return { success: true, sessionId, context: 'local', containers: rows, statsError: null } }
  await v.run(v.item(b), '停止容器'); assert.match(v.text(), /permission denied/); assert.equal(rows[1].state, 'running'); assert.equal(host.lastToast().style, Toast.Style.Failure)
})
test('日志有真实输出才展示预览，失败不变成“暂无日志”或成功提示', async () => {
  const v = await open(); await v.run(v.item(a), '查看日志'); assert.equal(v.tree().props.isShowingDetail, true)
  assert.match(v.item(a).props.detail.props.markdown, /actual output/); assert.match(v.item(a).props.detail.props.markdown, /\[link\]/)
  host.ipc.docker_manager = async () => { throw new Error('driver cannot read logs') }
  await v.run(v.item(b), '查看日志'); assert.match(v.text(), /driver cannot read logs/); assert.equal(host.lastToast().style, Toast.Style.Failure)
})
test('清理先列清单，取消不执行；部分失败明确保留失败项且不报全成功', async () => {
  rows = [container(a), container(b)]; const v = await open(); host.setConfirm(false)
  await globalAction(v, 'prune'); assert.equal(host.ipcCalls.filter(([, p]) => p.action === 'remove').length, 0); assert.match(host.confirms[0].message, /alpha.*\n.*beta/)
  host.setConfirm(true); const original = host.ipc.docker_manager
  host.ipc.docker_manager = async p => { if (p.action === 'remove') { rows = rows.filter(c => c.id !== a); return { success: true, removed: [a], failures: [{ id: b, error: 'permission denied' }] } } return original(p) }
  await globalAction(v, 'prune'); assert.deepEqual(v.items().map(c => c.props.id), [b]); assert.match(v.text(), /已确认清理 1 个；未确认清理 1 个/); assert.equal(host.lastToast().style, Toast.Style.Failure)
})
test('无 Docker、旧客户端、嵌套失败和不完整结果均拒绝，不生成空成功', async () => {
  host.ipc.docker_manager = async () => { throw new Error('未找到 Docker 命令行') }; const v = await open(); assert.match(v.text(), /未找到 Docker/); assert.equal(v.items()[0].props.id, 'empty')
  host.ipc.docker_manager = async () => ({ success: false, containers: [] }); await assert.rejects(listContainers(), /未确认/)
  host.ipc.docker_manager = async () => ({ success: true, removed: [a], failures: [] }); await assert.rejects(removeContainers(sessionId, [a, b]), /不完整/)
  host.ipc.docker_manager = async () => ({ success: true, id: a }); await assert.rejects(getContainerTailLogs(sessionId, a), /完整/)
  globalThis.__ztoolsElectron.transport.methods = {}; await assert.rejects(listContainers(), /升级客户端/)
})
test('清理全成功只计真实成功数，不重复放置清理动作', async () => {
  const v = await open(); assert.ok(v.items().every(row => !v.actions(row).some(a => /清理/.test(a.props.title))))
  await globalAction(v, 'prune'); assert.match(host.lastToast().title, /已确认清理 1 个；未确认清理 0 个/); assert.deepEqual(v.items().map(c => c.props.id), [b])
})
test('卸载取消后迟到的操作结果不再启动刷新，不触发成功提示', async () => {
  const v = await open(); let resolve
  const pending = new Promise(r => { resolve = r }), original = host.ipc.docker_manager
  host.ipc.docker_manager = async p => p.action === 'control' ? pending : original(p)
  const action = v.run(v.item(a), '启动容器'); await tick(); v.unmount(); resolve({ success: true, id: a, state: 'running' }); await action
  assert.equal(host.ipcCalls.filter(([, p]) => p.action === 'list').length, 1); assert.ok(host.ipcCalls.some(([, p]) => p.action === 'cancel')); assert.equal(host.toasts.length, 0)
})
test('端口地址保持实际绑定；UDP、数据库、未发布或范围端口不伪造网页', () => {
  assert.equal(containerWebUrl('127.0.0.1:8080->80/tcp'), 'http://127.0.0.1:8080')
  assert.equal(containerWebUrl('[::]:8443->443/tcp'), 'https://localhost:8443')
  for (const value of ['53/udp', '0.0.0.0:8080->80/udp', '0.0.0.0:3306->3306/tcp', '80/tcp', '0.0.0.0:8000-8001->8000-8001/tcp']) assert.equal(containerWebUrl(value), undefined)
})

test('日志按足够长的围栏转义，CR 换行也不能提前退出代码块', () => {
  const text = '```\r~~~\r![image](https://example.invalid/image.png)\r[link](https://example.invalid)'
  const markdown = logMarkdown({ stdout: text, stderr: '' })
  assert.ok(markdown.includes('````text\n```\n~~~\n![image]'))
  assert.equal(markdown.includes('\r'), false)
  assert.ok(markdown.includes('\n````\n\n### 标准错误输出'))
  assert.equal(containerWebUrl('0.0.0.0:3306->3306/tcp, 127.0.0.1:8080->80/tcp'), 'http://127.0.0.1:8080')
})

test('空列表提示区分原因：已连上但无匹配不再提示启动 Docker，连接失败显示真实错误', async () => {
  rows = []; const v = await open()
  assert.equal(v.items()[0].props.id, 'empty'); assert.match(v.items()[0].props.subtitle, /还没有容器/); assert.doesNotMatch(v.text(), /请确认本机 Docker 引擎已启动/)
  rows = [container(a)]; const filtered = await open(commands['docker-running'])
  assert.equal(filtered.items()[0].props.title, '没有符合条件的容器'); assert.match(filtered.items()[0].props.subtitle, /搜索词或状态筛选/)
  host.ipc.docker_manager = async () => { throw new Error('无法连接本机 Docker 引擎。请启动 Docker Desktop、Colima 或 OrbStack，再点击刷新') }
  const failed = await open(); assert.equal(failed.items()[0].props.title, '无法连接本机 Docker 引擎'); assert.match(failed.items()[0].props.subtitle, /OrbStack/)
  assert.equal(failed.tree().props.filterBar.summaryText, 'Docker 未就绪')
  // 刷新只在空状态行出现一次，顶部不重复
  assert.equal(failed.tree().props.filterBar.actions.some(a => a.id === 'refresh'), false)
  // 引擎未启动不是没装 Docker：只给刷新，不推下载页
  assert.deepEqual(failed.actions(failed.items()[0]).map(a => a.props.title), ['刷新'])
})

test('未找到 Docker 命令行：错误只在条目出现一次，主动作打开官网下载页，重试会重新读取', async () => {
  const message = '未找到 Docker 命令行。请安装并启动 Docker Desktop，或配置已有的 Colima / OrbStack Docker 环境后重试'
  let fail = true; const original = host.ipc.docker_manager
  host.ipc.docker_manager = async p => { if (fail) throw new Error(message); return original(p) }
  const v = await open(); const row = v.items()[0]
  assert.equal(v.tree().props.filterBar.summaryText, 'Docker 未就绪')
  assert.equal(row.props.title, '未找到 Docker 命令行'); assert.match(row.props.subtitle, /Docker Desktop/)
  assert.notEqual(row.props.icon, 'document')
  const titles = v.actions(row).map(a => a.props.title)
  assert.deepEqual(titles, ['打开 Docker 官网下载页', '刷新'])
  assert.equal(v.tree().props.filterBar.actions.some(a => a.id === 'refresh'), false)
  assert.equal(v.actions(row)[0].props.url, 'https://www.docker.com/products/docker-desktop/')
  fail = false; await v.run(row, '刷新'); await tick()
  assert.equal(v.items().length, 2); assert.equal(v.tree().props.filterBar.summaryText.includes('未就绪'), false)
  // 连上后列表有容器，刷新回到顶部状态条
  assert.ok(v.tree().props.filterBar.actions.some(a => a.id === 'refresh'))
})

test('清单只声明实际用到的 shell 权限，不声明未使用的网络或文件权限', async () => {
  const { readFile } = await import('node:fs/promises')
  const manifest = JSON.parse(await readFile(new URL('../plugin.json', import.meta.url), 'utf8'))
  assert.deepEqual(manifest.permissions, ['shell'])
})
