import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import Command, { commands } from '../dist/index.js'
import { scanSsh, applyProxy, openSshTerminal, sourceMarkdown } from '../dist/mac-service.js'
const id = '11111111-1111-4111-8111-111111111111'
const hostEntry = { alias: 'fixture', hostName: '127.0.0.1', user: 'example', port: 2222, identityFiles: [], localForwards: [], previewComplete: true, notices: [] }
let host, views, state
const calls = action => host.ipcCalls.filter(([m, p]) => m === 'ssh_proxy' && p.action === action)
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
beforeEach(() => {
  host = createHost(); views = []
  state = { success: true, sessionId: id, ssh: { status: 'ready', hosts: [], warnings: [] }, proxies: ['git', 'npm'].map(tool => ({ tool, status: 'ready', location: `/fixture/.${tool}config`, exists: true, values: [], notices: ['项目配置可能覆盖此文件'] })), backups: [], backupError: '' }
  host.ipc.system_get_platform = async () => ({ success: true, platform: 'macos' })
  host.ipc.ssh_proxy = async p => {
    if (p.action === 'scan') return structuredClone(state)
    if (p.action === 'prepare') return { success: true, planId: id, summary: '修改此文件中的代理', location: '/fixture/.npmrc', before: [], after: [], notices: ['项目配置可能覆盖此文件'] }
    if (p.action === 'apply') { state.backups.push({ id, tool: 'npm', createdAt: '2026-10-26T00:00:00Z', summary: '修改 NPM 代理' }); return { success: true, verified: true, summary: '已核验文件', backupId: id, recoveryPath: '/fixture/.ztools-env-recovery-test/original' } }
    if (p.action === 'cancel') return { success: true, cancelRequested: true }
    return { success: true, opened: true, notice: '连接状态以终端为准' }
  }
})
afterEach(async () => { for (const view of views) view.unmount(); await tick() })
async function open(command = Command) { const view = await mount(command, host); views.push(view); await tick(); return view }
async function form() { const view = await mountPushed(host); views.push(view); return view }
const refresh = view => view.tree().props.filterBar.actions[0].onAction()
test('Mac 入口使用现代接口，默认无 SSH 时首项仍可 Enter，不显示假代理开关', async () => {
  const v = await open()
  assert.equal(v.tree().props.isShowingDetail, false)
  assert.equal(v.items()[0].props.id, 'proxy:git')
  assert.equal(v.actions(v.items()[0])[0].props.title, '设置本机代理端口…')
  assert.match(v.item('proxy:git').props.subtitle, /^\.gitconfig 未设置通用代理$/); assert.equal(v.item('proxy:git').props.title, 'Git 代理'); assert.equal(v.item('proxy:npm').props.title, 'NPM 代理'); assert.ok(!v.text().includes('加速中'))
  assert.ok(!host.ipcCalls.some(([method]) => method === 'dllplugin_call'))
  assert.deepEqual(v.tree().props.filterBar.actions.map(a => a.id), ['refresh'])
})
test('主机 Enter 调用连接；隧道入口打开表单，三个清单命令均映射', async () => {
  state.ssh.hosts = [hostEntry]
  const v = await open(); await v.run(v.item('ssh:fixture'), '在终端连接')
  assert.equal(calls('connect').length, 1); assert.equal(host.clipboard.text, '')
  assert.match(host.lastToast().message, /终端/)
  const tunnel = await open(commands['ssh-tunnel'])
  assert.equal(tunnel.actions(tunnel.item('ssh:fixture'))[0].props.title, '建立本地端口转发…')
  const manifest = JSON.parse(fs.readFileSync(new URL('../plugin.json', import.meta.url)))
  assert.deepEqual(Object.keys(commands).sort(), manifest.features.map(feature => feature.code).sort())
})
test('平台、读取或单项错误均明确显示，不回退旧接口或冒充直连', async () => {
  state.ssh = { status: 'error', hosts: [], warnings: [], error: 'SSH 配置无法读取' }
  state.proxies[0] = { tool: 'git', status: 'error', error: 'Git 配置语法错误' }
  const v = await open(); assert.match(v.text(), /SSH 配置无法读取/); assert.match(v.item('proxy:git').props.subtitle, /语法错误/)
  host.ipc.ssh_proxy = async () => { throw new Error('宿主不可用') }; await refresh(v)
  assert.match(v.text(), /宿主不可用/); assert.equal(v.items().length, 1)
  host.ipc.system_get_platform = async () => { throw new Error('平台读取失败') }
  assert.match((await open()).text(), /平台读取失败/); assert.ok(!host.ipcCalls.some(([method]) => method === 'dllplugin_call'))
})
test('代理表单校验端口，预览、确认、写入核验和恢复位置形成完整链路', async () => {
  const v = await open(); await v.run(v.item('proxy:npm'), '设置本机代理端口…'); const f = await form()
  for (const port of ['', '-1', '0', '65536', '7890x']) { await f.fill('localPort', port); await f.run(null, '继续'); assert.equal(calls('prepare').length, 0) }
  await f.fill('localPort', '7890'); await f.run(null, '继续')
  assert.deepEqual(calls('prepare')[0][1], { action: 'prepare', sessionId: id, tool: 'npm', change: { kind: 'set', port: 7890 } })
  assert.equal(calls('apply').length, 1); assert.equal(host.pushed.length, 0)
  assert.match(host.confirms[0].message, /\/fixture\/\.npmrc/)
  assert.match(host.lastToast().message, /recovery-test\/original/)
  await v.dropdown('backups'); await v.run(v.item('retained-original'), '复制原文件位置')
  assert.equal(host.clipboard.text, '/fixture/.ztools-env-recovery-test/original')
  await v.run(v.item(`backup:${id}`), '预览恢复原配置')
  assert.equal(calls('prepare')[1][1].change.kind, 'restore')
})
test('取消预览不写配置，失败回执不能提示成功或关闭表单', async () => {
  host.setConfirm(false)
  const v = await open(); await v.run(v.item('proxy:git'), '设置本机代理端口…'); const f = await form()
  await f.run(null, '继续'); assert.equal(calls('apply').length, 0); assert.equal(calls('cancel').length, 1); assert.equal(host.pushed.length, 1)
  host.setConfirm(true)
  const normal = host.ipc.ssh_proxy; host.ipc.ssh_proxy = p => p.action === 'apply' ? { success: true, verified: false } : normal(p)
  await f.run(null, '继续'); assert.equal(host.pushed.length, 1); assert.equal(host.lastToast().style, 'FAILURE')
})
test('隧道表单提交真实参数，非法远端地址不发请求；终端代理只打开新窗口', async () => {
  state.ssh.hosts = [hostEntry]
  const v = await open(); await v.run(v.item('ssh:fixture'), '建立本地端口转发…'); const f = await form()
  await f.fill('localPort', '15432'); await f.fill('remotePort', '5432'); await f.fill('remoteHost', 'db;touch bad')
  await f.run(null, '在终端建立隧道'); assert.equal(calls('tunnel').length, 0)
  await f.fill('remoteHost', 'db.internal'); await f.run(null, '在终端建立隧道')
  assert.deepEqual(calls('tunnel')[0][1].tunnel, { localPort: 15432, remoteHost: 'db.internal', remotePort: 5432 })
  await v.run(v.item('terminal-proxy'), '打开带代理的新终端…'); const proxy = await form(); await proxy.fill('localPort', '10809'); await proxy.run(null, '继续')
  assert.deepEqual(calls('terminal-proxy')[0][1], { action: 'terminal-proxy', port: 10809 }); assert.equal(calls('apply').length, 0)
})
test('表单关闭取消在途预览，重复提交和迟到结果不能执行写入', async () => {
  const v = await open(); await v.run(v.item('proxy:git'), '设置本机代理端口…'); const f = await form(), pending = defer(), normal = host.ipc.ssh_proxy
  host.ipc.ssh_proxy = p => p.action === 'prepare' ? pending.promise : normal(p)
  const submit = f.actions(null)[0].props.onSubmit, first = submit(); await submit(); assert.equal(calls('prepare').length, 1)
  f.unmount(); await tick(); pending.resolve({ success: true, planId: id, summary: '旧结果', location: '/fixture/.gitconfig', before: [], after: [], notices: [] }); await first
  assert.equal(calls('apply').length, 0); assert.ok(calls('cancel').length >= 1)
})
test('畸形响应、重复来源及未打开回执拒绝成功；配置路径按 Markdown 字面量显示', async () => {
  const valid = structuredClone(state)
  for (const bad of [{ ...valid, sessionId: '' }, { ...valid, proxies: [valid.proxies[0], valid.proxies[0]] }, { ...valid, ssh: { status: 'error', hosts: [], warnings: [] } }]) {
    host.ipc.ssh_proxy = async () => bad; await assert.rejects(scanSsh())
  }
  host.ipc.ssh_proxy = async () => ({ success: true, opened: false, notice: 'no' }); await assert.rejects(openSshTerminal({ action: 'connect' }))
  host.ipc.ssh_proxy = async () => ({ success: true, verified: true, backupId: id }); await assert.rejects(applyProxy(id))
  const text = sourceMarkdown({ ...valid.proxies[0], location: '/fixture/![x](https://example.invalid/leak)' })
  assert.ok(text.includes('\\!\\[x\\]\\(https\\:')); assert.ok(!text.includes('![x]'))
})
test('取消请求失败时如实提示而不是抛出未处理异常；读取失败的代理行可直接重新读取', async () => {
  state.proxies[0] = { tool: 'git', status: 'error', error: '未找到 git 可执行文件' }
  const v = await open()
  assert.equal(v.actions(v.item('proxy:git'))[0].props.title, '重新读取')
  const pending = defer()
  host.ipc.ssh_proxy = async p => { if (p.action === 'scan') return pending.promise; if (p.action === 'cancel') throw new Error('没有正在进行的操作'); return { success: true } }
  const reading = v.run(v.item('proxy:git'), '重新读取'); await tick()
  assert.equal(v.tree().props.filterBar.actions[0].title, '取消操作')
  await v.tree().props.filterBar.actions[0].onAction(); await tick()
  assert.match(host.lastToast().title, /取消未确认/)
  pending.resolve(structuredClone(state)); await reading; await tick()
})
