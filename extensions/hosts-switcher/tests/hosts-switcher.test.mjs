import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { Toast } from '@ztools/declarative-ui'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import Command, { commands, STORAGE_KEY, splitHosts, combineHosts, rules, validIp, hostsCodeBlock, loadProfiles, saveProfile } from '../dist/index.js'
const base = '# existing comment\r\n127.0.0.1 localhost local-alias\r\n::1 localhost\r\n255.255.255.255 broadcasthost'
const profile = { id: 'hosts-test', name: '测试环境', content: '# 中文备注\n127.0.0.2 test.local\n', updatedAt: 100 }
let host, views, state, planned
beforeEach(() => {
  host = createHost(); views = []; planned = null
  state = { success: true, sessionId: '11111111-1111-4111-8111-111111111111', content: base, path: '/private/etc/hosts', backups: [] }
  host.ipc.system_get_platform = async () => ({ success: true, platform: 'macos' })
  host.ipc.hosts_manager = async p => {
    if (p.action === 'read') return structuredClone(state)
    if (p.action === 'prepare') { planned = p.content; return { success: true, planId: '22222222-2222-4222-8222-222222222222', before: state.content, content: p.content, path: state.path } }
    if (p.action === 'apply') { state.content = planned; state.backups.push({ id: '33333333-3333-4333-8333-333333333333', createdAt: new Date().toISOString() }); return { success: true, written: true, dnsFlushed: true, dnsError: '', backupId: state.backups[0].id, recoveryPath: '/private/etc/.ztools-hosts-test' } }
    if (p.action === 'flush') return { success: true, flushed: true }
    if (p.action === 'cancel') { planned = null; return { success: true } }
    throw new Error('unexpected request')
  }
})
afterEach(async () => { for (const v of views.toReversed()) v.unmount(); await tick() })
async function open(command = Command) { const v = await mount(command, host); views.push(v); await tick(); return v }
async function pushed() { const v = await mountPushed(host); views.push(v); await tick(); return v }
const calls = action => host.ipcCalls.filter(([method,p]) => method === 'hosts_manager' && p.action === action)
function seed(profiles = [profile]) { host.storage.set(STORAGE_KEY, JSON.stringify({ version: 1, profiles })) }

test('真实命令入口读取系统 Hosts；无四套假方案和固定DNS成功状态', async () => {
  const view = await open(); assert.equal(calls('read').length, 1); assert.ok(view.item('system'))
  assert.match(view.text(), /0 个本地方案/); assert.doesNotMatch(view.text(), /已处于最新|系统基础默认|Staging|GitHub 静态/)
  assert.equal(view.tree().props.isShowingDetail, true)
  assert.deepEqual(view.tree().props.filterBar.actions.map(x=>x.id), ['new','refresh'])
  assert.ok(!host.ipcCalls.some(([method]) => method === 'dllplugin_call'))
  assert.match(view.item('system').props.detail.props.markdown, /local-alias/)
})
test('本地存储损坏或系统读取失败保留原数据，没有启用操作', async () => {
  host.storage.set(STORAGE_KEY, '{"version":999}'); const view = await open()
  assert.match(view.text(), /保留原数据/); assert.equal(calls('read').length, 0); assert.equal(host.storage.get(STORAGE_KEY), '{"version":999}')
  host.storage.delete(STORAGE_KEY); host.ipc.hosts_manager = async () => { throw new Error('读取无权限') }
  await view.run(view.item('read-error'), '重新读取'); assert.match(view.text(), /读取无权限/); assert.equal(view.tree().props.isShowingDetail, false)
})
test('规则校验支持双栈/本地域名/别名，拒绝坏IPv6和注入；启停按字节恢复基础原文', () => {
  assert.equal(validIp('1:2:3'), false); assert.equal(validIp(':::1'), false); assert.equal(validIp('::1'), true); assert.equal(validIp('255.255.255.255'), true)
  assert.equal(validIp('::ffff:192.0.2.1'), true)
  assert.throws(() => combineHosts('127.0.0.1 test.local\n127.0.0.2 test.local', [profile]), /冲突/)
  assert.doesNotThrow(() => combineHosts('::1 localhost', [{...profile,content:'0:0:0:0:0:0:0:1 localhost'}]))
  assert.equal(rules('127.0.0.1 localhost alias\n::1 localhost').length, 3)
  assert.throws(() => rules('1000.1.1.1 test.local'), /第 1 行/)
  assert.throws(() => combineHosts(base, [{ ...profile, content: '127.0.0.2 localhost' }]), /冲突/)
  assert.throws(() => combineHosts(base, [{ ...profile, content: '# >>> ZTools Hosts v1 >>>' }]), /标记/)
  for (const raw of ['', base, base+'\n', 'empty-no-rules', '# end\n\n']) {
    for (const contents of ['127.0.0.2 test.local','127.0.0.2 test.local\n','127.0.0.2 test.local\n\n']) {
      const expected = {...profile,content:contents}, combined=combineHosts(raw,[expected]), parsed=splitHosts(combined)
      assert.equal(parsed.base, raw); assert.deepEqual(parsed.active,[expected]); assert.equal(combineHosts(parsed.base,[]),raw)
    }
  }
  assert.throws(() => splitHosts(combineHosts(base,[profile])+'# outside edit'), /外部修改/)
})
test('新建入口的 Enter 保存会持久化，重开仍在且未启用；错误留在表单', async () => {
  await open(commands['hosts-new-profile']); const form = await pushed()
  await form.fill('name', '新方案'); await form.fill('content', '::: bad'); await form.run(undefined,'保存本地方案'); assert.match(form.text(), /规则无效/); assert.equal(host.storage.size,0)
  await form.fill('content','127.0.0.2 fresh.local'); host.faults.storageWrite = new Error('磁盘不可写')
  await form.run(undefined,'保存本地方案'); assert.match(form.text(), /磁盘不可写/); assert.equal(host.pushed.length,1)
  host.faults.storageWrite=null; await form.run(undefined,'保存本地方案'); assert.equal(host.pushed.length,0); assert.equal(calls('apply').length,0)
  const stored=await loadProfiles(); assert.equal(stored.length,1)
  const reopened=await open(); assert.match(reopened.text(), /新方案/); assert.match(reopened.text(), /未启用/)
})
test('启用必须先预览，真实回执后才显示已写入；失败保持未启用', async () => {
  seed(); const view=await open(); await view.run(view.item(profile.id),'预览并启用方案')
  assert.equal(calls('apply').length,0); const preview=await pushed(); assert.match(preview.text(), /修改前/); assert.match(preview.text(), /test.local/)
  const real=host.ipc.hosts_manager;host.ipc.hosts_manager=async p=> {if(p.action==='apply')throw new Error('未获得系统授权'); return real(p)}
  await preview.run(undefined,'确认应用到系统'); assert.match(preview.text(), /未获得系统授权/); assert.match(view.text(), /未启用/)
  assert.ok(!host.toasts.some(t=>t.style===Toast.Style.Success));assert.equal(state.content,base)
})
test('写入后DNS失败分开报告，启用状态来自重新读取的系统内容', async () => {
  seed(); const view=await open(), real=host.ipc.hosts_manager
  host.ipc.hosts_manager=async p=>{const result=await real(p);return p.action==='apply'?{...result,dnsFlushed:false,dnsError:'DNS 权限被拒'}:result}
  await view.run(view.item(profile.id),'预览并启用方案'); const preview=await pushed(); await preview.run(undefined,'确认应用到系统')
  assert.equal(calls('apply').length,1); assert.match(host.lastToast().title,/Hosts 已写入，DNS 未刷新/); assert.match(view.text(),/系统中已写入/)
  assert.equal(splitHosts(state.content).base,base)
  await view.run(view.item(profile.id),'预览并停用方案'); const disable=await pushed(); await disable.run(undefined,'确认应用到系统'); assert.equal(state.content,base)
})
test('编辑已启用方案只保存本地，不谎报系统已更新；并发保存拒绝覆盖', async () => {
  seed(); state.content=combineHosts(base,[profile]); const view=await open()
  await view.run(view.item(profile.id),'编辑本地方案'); const form=await pushed(); await form.fill('content','127.0.0.3 test.local'); await form.run(undefined,'保存本地方案')
  assert.match(view.text(),/系统使用旧内容/);assert.equal(calls('apply').length,0);assert.equal(splitHosts(state.content).active[0].content,profile.content)
  await assert.rejects(saveProfile({...profile,content:'127.0.0.4 test.local'},profile), /其他窗口修改/)
})
test('刷新DNS入口 Enter 才请求授权，取消不刷新、失败不显示成功', async () => {
  const view=await open(commands['hosts-flush-dns']);assert.equal(calls('flush').length,0)
  host.setConfirm(false);await view.run(view.item('system'),'刷新系统 DNS');assert.equal(calls('flush').length,0)
  host.setConfirm(true);const real=host.ipc.hosts_manager;host.ipc.hosts_manager=async p=>{if(p.action==='flush')throw new Error('系统拒绝');return real(p)}
  await view.run(view.item('system'),'刷新系统 DNS');assert.match(host.lastToast().message,/系统拒绝/);assert.equal(host.lastToast().style,Toast.Style.Failure)
})
test('多次 Enter 不重复申请写入，关闭预览取消计划且不继续写', async () => {
  seed();const view=await open();await view.run(view.item(profile.id),'预览并启用方案');const preview=await pushed()
  let finish;const real=host.ipc.hosts_manager
  host.ipc.hosts_manager=async p=>p.action==='apply'?new Promise(resolve=>{finish=()=>resolve({success:true,written:true,dnsFlushed:false,dnsError:'cancelled',backupId:'backup',recoveryPath:''})}):real(p)
  const waiting=preview.run(undefined,'确认应用到系统');await tick();await preview.run(undefined,'确认应用到系统');assert.equal(calls('apply').length,1)
  preview.unmount();await tick();assert.ok(calls('cancel').length);finish();await waiting
  assert.ok(!host.toasts.some(t=>t.style===Toast.Style.Success));assert.equal(state.content,base)
})

test('所有原文用动态围栏显示，注释图片链接和CR都不能跳出代码区', () => {
  const raw = '# ![preview](https://example.invalid/image) [open](https://example.invalid)\r\n```\r~~~\r# data'
  const result = hostsCodeBlock(raw), lines = result.split('\n')
  assert.equal(lines[1], '````text'); assert.equal(lines.at(-2), '````'); assert.ok(!result.includes('\r'))
  assert.ok(result.includes('![preview]'));assert.equal(hostsCodeBlock('``````').split('\n')[1], '```````text')
})

test('编辑启用方案产生冲突后仍可停用旧系统内容，保留已编辑的本地副本', async () => {
  seed([{...profile,content:'127.0.0.3 localhost'}]);state.content=combineHosts(base,[profile])
  const view=await open();assert.match(view.text(),/系统使用旧内容/)
  await view.run(view.item(profile.id),'预览并更新系统内容');assert.match(host.lastToast().message,/冲突/);assert.equal(calls('prepare').length,0)
  await view.run(view.item(profile.id),'预览并停用当前系统方案');const preview=await pushed();await preview.run(undefined,'确认应用到系统')
  assert.equal(state.content,base);assert.equal((await loadProfiles())[0].content,'127.0.0.3 localhost');assert.match(view.text(),/未启用/)
})

// ==================== Windows 旧入口：宿主回执如实透传 ====================
const winHosts = '127.0.0.1 localhost\r\n'
function windowsHost(applyReply) {
  host.ipc.system_get_platform = async () => ({ success: true, platform: 'windows' })
  host.ipc.dllplugin_call = async p => {
    if (p.func === 'readSystemHosts') return { ok: true, success: true, content: winHosts, hostsPath: 'C:\\Windows\\System32\\drivers\\etc\\hosts' }
    if (p.func === 'applyCombinedHosts') return applyReply(p)
    if (p.func === 'flushDns') return { ok: true, success: true, output: '已成功刷新 DNS 解析缓存。' }
    throw new Error('unexpected request')
  }
}
const applyCalls = () => host.ipcCalls.filter(([m, p]) => m === 'dllplugin_call' && p.func === 'applyCombinedHosts')
test('Windows：写入成功但刷新 DNS 失败时，成功提示如实写明“已写入，但刷新 DNS 缓存失败”，不再宣称已刷新', async () => {
  windowsHost(() => ({ ok: true, success: true, hostsPath: 'C:\\hosts', warnings: ['hosts 已写入，但刷新 DNS 缓存失败：拒绝访问。'] }))
  const view = await open()
  assert.doesNotMatch(view.text(), /DNS 缓存已处于最新/)
  await view.run(view.item('hosts-local-dev'), '启用此方案')
  const toast = host.lastToast()
  assert.equal(toast.style, Toast.Style.Success)
  assert.match(toast.title, /^已写入 \(\d+ 条映射\)，但刷新 DNS 缓存失败：拒绝访问/)
  assert.doesNotMatch(toast.title, /并刷新 DNS/)
  assert.equal(applyCalls().length, 1)
  assert.equal('customHostsPath' in applyCalls()[0][1].params, false, '不再发送宿主忽略的 customHostsPath')
  assert.equal(view.item('hosts-local-dev').props.accessories.at(-1).text, '已启用')
  // 宿主没有警告才显示已刷新
  windowsHost(() => ({ ok: true, success: true, hostsPath: 'C:\\hosts' }))
  await view.run(view.item('hosts-staging'), '启用此方案')
  assert.match(host.lastToast().title, /已生效 \(\d+ 条映射\) 并刷新 DNS/)
})
test('Windows：备份失败宿主停止写入，界面报失败并保留错误码，方案启用状态退回', async () => {
  windowsHost(() => ({ ok: false, success: false, errorCode: 'BACKUP_FAILED', error: 'BACKUP_FAILED: 备份系统 hosts 到 C:\\hosts.ztools.bak 失败（权限不足），已停止写入，系统 hosts 未改动' }))
  const view = await open()
  await view.run(view.item('hosts-local-dev'), '启用此方案')
  const toast = host.lastToast()
  assert.equal(toast.style, Toast.Style.Failure)
  assert.match(toast.message, /BACKUP_FAILED.*已停止写入/)
  assert.equal(view.item('hosts-local-dev').props.accessories.at(-1).text, '未激活', '写入失败不能显示成已启用')
  const { applyCombinedHosts } = await import('../dist/hosts-service.js')
  const backup = await applyCombinedHosts('x', undefined)
  assert.equal(backup.success, false); assert.equal(backup.errorCode, 'BACKUP_FAILED')
  // 传输层故障与无错误码文本：不再一律报成 EACCES
  host.ipc.dllplugin_call = async () => { throw new Error('通道断开') }
  const broken = await applyCombinedHosts('x', undefined)
  assert.equal(broken.success, false); assert.equal(broken.errorCode, 'WRITE_FAILED'); assert.match(broken.error, /通道断开/)
  // 畸形警告（非字符串、空白）被丢弃，不会冒充成功提示内容
  host.ipc.dllplugin_call = async () => ({ ok: true, success: true, warnings: [42, '  ', null] })
  assert.deepEqual(await applyCombinedHosts('x', undefined), { success: true })
})

test('Mac：写入成功后重新读取失败，仍报告已写入而不是“结果未确认”', async () => {
  seed(); const view = await open(), real = host.ipc.hosts_manager
  await view.run(view.item(profile.id), '预览并启用方案'); const preview = await pushed()
  host.ipc.hosts_manager = async p => { if (p.action === 'read') throw new Error('读取被拒'); return real(p) }
  await preview.run(undefined, '确认应用到系统')
  assert.equal(calls('apply').length, 1); assert.equal(host.pushed.length, 0)
  const toast = host.lastToast()
  assert.equal(toast.style, Toast.Style.Failure); assert.match(toast.title, /Hosts 已写入并刷新 DNS/); assert.match(toast.message, /已写入，但重新读取列表失败：读取被拒/)
  assert.doesNotMatch(preview.text(), /结果未确认/)
})
test('Mac：停用时外部规则与剩余方案冲突，报告错误且不请求预览', async () => {
  const other = { ...profile, id: 'hosts-other', name: '另一个', content: '127.0.0.5 other.local\n' }
  seed([profile, other]); state.content = '127.0.0.9 test.local\n' + combineHosts(base, [profile, other])
  const view = await open()
  await view.run(view.item(other.id), '预览并停用方案')
  assert.match(host.lastToast().message, /冲突/); assert.equal(calls('prepare').length, 0); assert.match(view.text(), /冲突/)
})
test('Mac：复制系统内容有成功与失败反馈', async () => {
  const view = await open()
  await view.run(view.item('system'), '复制当前系统内容')
  assert.equal(host.lastToast().style, Toast.Style.Success); assert.equal(host.clipboard.text, base)
})
