import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import Command, { commands } from '../dist/index.js'
import { scanSsh } from '../dist/mac-service.js'
const id = '22222222-2222-4222-8222-222222222222'
const hostEntry = { alias: 'fixture', hostName: '10.0.0.8', user: 'example', port: 22, identityFiles: ['C:\\Users\\fixture\\.ssh\\id_ed25519'], localForwards: [], previewComplete: true, notices: [] }
let host, views, state
const calls = action => host.ipcCalls.filter(([m, p]) => m === 'ssh_proxy' && p.action === action)
const legacy = () => host.ipcCalls.some(([method]) => method === 'dllplugin_call')
beforeEach(() => {
  host = createHost(); views = []
  state = { success: true, sessionId: id, ssh: { status: 'ready', hosts: [hostEntry], warnings: [] }, proxies: [
    { tool: 'git', status: 'ready', location: 'C:\\Users\\fixture\\.gitconfig', exists: true, values: [{ key: 'http.proxy', value: 'http://127.0.0.1:7890', hasCredentials: false, dynamic: false }], notices: [] },
    { tool: 'npm', status: 'ready', location: 'C:\\Users\\fixture\\.npmrc', exists: false, values: [], notices: [] }], backups: [], backupError: '' }
  host.ipc.system_get_platform = async () => ({ success: true, platform: 'windows' })
  host.ipc.dllplugin_call = async () => ({ ok: true, success: true, isEnabled: true })
  host.ipc.ssh_proxy = async p => {
    if (p.action === 'scan') return structuredClone(state)
    if (p.action === 'prepare') return { success: true, planId: id, summary: '清除 GIT 此文件中的通用代理', location: 'C:\\Users\\fixture\\.gitconfig', before: state.proxies[0].values, after: [], notices: [] }
    if (p.action === 'apply') { state.proxies[0].values = []; return { success: true, verified: true, summary: '已核验', backupId: id, recoveryPath: 'C:\\Users\\fixture\\.ztools-env-recovery-x\\original' } }
    if (p.action === 'cancel') return { success: true, cancelRequested: true }
    return { success: true, opened: true, notice: '已请求打开新的控制台窗口' }
  }
})
afterEach(async () => { for (const view of views) view.unmount(); await tick() })
async function open(command = Command) { const view = await mount(command, host); views.push(view); await tick(); return view }
test('Windows 入口走 ssh_proxy 新接口，初始状态取自真实读取结果，不调用旧 dllplugin_call', async () => {
  const v = await open()
  assert.equal(calls('scan').length, 1); assert.equal(legacy(), false)
  assert.match(v.item('proxy:git').props.subtitle, /http\.proxy: http:\/\/127\.0\.0\.1:7890/)
  assert.match(v.item('proxy:npm').props.subtitle, /此文件未设置/)
  assert.ok(!v.text().includes('加速中')); assert.ok(!/已启用/.test(v.text()))
  await v.run(v.item('ssh:fixture'), '复制连接命令'); assert.equal(host.clipboard.text, 'ssh fixture')
  for (const code of Object.keys(commands)) { await open(commands[code]); assert.equal(legacy(), false) }
})
test('Windows 清除代理先预览再写入并刷新；连接与代理终端只发新接口请求', async () => {
  const v = await open()
  await v.run(v.item('proxy:git'), '清除此文件中的通用代理')
  assert.deepEqual(calls('prepare')[0][1].change, { kind: 'clear' }); assert.equal(calls('apply').length, 1)
  assert.match(host.confirms[0].message, /C:\\Users\\fixture\\\.gitconfig/)
  assert.match(v.item('proxy:git').props.subtitle, /此文件未设置/)
  await v.run(v.item('ssh:fixture'), '在终端连接'); assert.equal(calls('connect')[0][1].alias, 'fixture')
  await v.run(v.item('terminal-proxy'), '打开带代理的新终端…'); const f = await mountPushed(host); views.push(f)
  await f.fill('localPort', '10809'); await f.run(null, '继续')
  assert.deepEqual(calls('terminal-proxy')[0][1], { action: 'terminal-proxy', port: 10809 }); assert.equal(legacy(), false)
})
test('Windows 写入失败、读取失败与相对路径均如实报错，不回退旧接口', async () => {
  const normal = host.ipc.ssh_proxy
  host.ipc.ssh_proxy = p => p.action === 'apply' ? Promise.reject(new Error('无法写入并验证原配置备份，未修改配置')) : normal(p)
  const v = await open(); await v.run(v.item('proxy:git'), '清除此文件中的通用代理')
  assert.equal(host.lastToast().style, 'FAILURE'); assert.match(host.lastToast().message, /备份/)
  host.ipc.ssh_proxy = async () => ({ ...structuredClone(state), proxies: [{ ...state.proxies[0], location: 'relative\\.gitconfig' }, state.proxies[1]] })
  await assert.rejects(scanSsh(), /不完整/)
  host.ipc.ssh_proxy = async () => { throw new Error('未找到 Git（git.exe）') }
  await v.tree().props.filterBar.actions[0].onAction()
  assert.match(v.text(), /git\.exe/); assert.equal(legacy(), false)
})
