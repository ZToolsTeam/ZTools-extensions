import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { Toast } from '@ztools/declarative-ui'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import { EnvManagerCommand, commands, loadEnvironment, applyEnvironment } from '../dist/index.js'
const sessionId = '11111111-1111-4111-8111-111111111111', planId = '22222222-2222-4222-8222-222222222222', backupId = '33333333-3333-4333-8333-333333333333'
let host, views, snapshot, plan
beforeEach(() => {
  host = createHost(); views = []
  snapshot = { success: true, sessionId, platform: 'darwin', notice: '新终端加载配置；当前进程只读', sources: [{ id: 'user', label: '/fixture/.zshrc' }],
    variables: [{ key: 'PROCESS_ONLY', value: '真实进程值', scope: 'process' }, { key: 'VALUE', value: '原值', scope: 'user' }, { key: 'PATH', value: '/usr/bin:/fixture/missing', scope: 'user' }],
    paths: [{ scope: 'user', index: 0, value: '/usr/bin', reason: '目录存在', status: 'directory' }, { scope: 'user', index: 1, value: '/fixture/missing', reason: '确认目录不存在', status: 'missing' }], backups: [] }
  host.ipc.environment_manager = async p => {
    if (p.action === 'list') return structuredClone(snapshot)
    if (p.action === 'prepare') { plan = p.change; return { success: true, planId, summary: '修改预览', location: '/fixture/.zshrc', notice: snapshot.notice, removed: p.change.kind === 'clean' ? ['/fixture/missing'] : [] } }
    if (p.action === 'apply') {
      if (plan.kind === 'set') { snapshot.variables = snapshot.variables.filter(v => v.scope !== plan.source || v.key !== plan.key); snapshot.variables.push({ scope: plan.source, key: plan.key, value: plan.value }) }
      return { success: true, verified: true, backupId, summary: '配置已核验' }
    }
    if (p.action === 'cancel') return { success: true, cancelRequested: true }
    throw new Error('unexpected request')
  }
})
afterEach(() => { for (const v of views.toReversed()) v.unmount() })
async function open(Command = EnvManagerCommand) { const v = await mount(Command, host); views.push(v); return v }
const globalAction = (v, id) => v.tree().props.filterBar.actions.find(a => a.id === id).onAction()
async function edit(v) { await v.run(v.item('user:VALUE'), '编辑变量'); const form = await mountPushed(host); views.push(form); return form }
const calls = action => host.ipcCalls.filter(([, p]) => p.action === action)
test('真实读取后按来源筛选，入口不自动清理；主界面只用列表布局', async () => {
  const v = await open(); assert.equal(v.items().length, 3); assert.equal(v.tree().props.isShowingDetail, false)
  await v.dropdown('process'); assert.deepEqual(v.items().map(i => i.props.id), ['process:PROCESS_ONLY'])
  assert.equal(v.actions(v.item('process:PROCESS_ONLY'))[0].props.title, '复制变量值')
  const clean = await open(commands['env-path-clean']); assert.deepEqual(clean.items().map(i => i.props.id), ['user:PATH']); assert.equal(calls('apply').length, 0)
  assert.deepEqual(clean.tree().props.filterBar.actions.map(a => a.id), ['refresh', 'new'])
})
test('读取失败明确保留原因，不显示空配置成功；旧客户端与嵌套失败拒绝', async () => {
  host.ipc.environment_manager = async () => { throw new Error('权限不足，无法读取') }
  const v = await open(); assert.match(v.text(), /权限不足/); assert.equal(v.items()[0].props.title, '环境变量读取未完成'); assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.deepEqual(v.tree().props.filterBar.actions.map(a => a.id), ['refresh'])
  host.ipc.environment_manager = async () => ({ success: false }); await assert.rejects(loadEnvironment(), /未确认/)
  host.ipc.environment_manager = async () => ({ success: true, sessionId, variables: [] }); await assert.rejects(loadEnvironment(), /不完整/)
  globalThis.__ztoolsElectron.transport.methods = {}; await assert.rejects(loadEnvironment(), /升级客户端/)
})
test('保存等待真实写入确认并刷新后才退出；空格和换行原样传递', async () => {
  const v = await open(), form = await edit(v), value = ' 中文 $HOME \n末尾 '
  await form.fill('value', value)
  let finish; const original = host.ipc.environment_manager
  host.ipc.environment_manager = async p => p.action === 'apply' ? new Promise(resolve => { finish = () => original(p).then(resolve) }) : original(p)
  const pending = form.run(undefined, '预览并保存'); await tick()
  assert.equal(host.pushed.length, 1); assert.equal(host.toasts.length, 0); assert.equal(form.tree().props.isLoading, true)
  finish(); await pending
  assert.equal(host.pushed.length, 0); assert.equal(host.lastToast().style, Toast.Style.Success)
  assert.equal(v.item('user:VALUE').props.subtitle, value); assert.equal(calls('prepare')[0][1].change.value, value)
})
test('写入失败保留表单输入，核验不完整不能冒充成功', async () => {
  const v = await open(), form = await edit(v), original = host.ipc.environment_manager
  await form.fill('value', '保留输入')
  host.ipc.environment_manager = async p => { if (p.action === 'apply') throw new Error('备份失败，未写入'); return original(p) }
  await form.run(undefined, '预览并保存')
  assert.equal(host.pushed.length, 1); assert.equal(form.field('value').props.value, '保留输入'); assert.match(form.text(), /备份失败/); assert.equal(host.lastToast().style, Toast.Style.Failure)
  host.ipc.environment_manager = async () => ({ success: true, backupId, summary: '缺少核验' }); await assert.rejects(applyEnvironment(planId), /完整确认/)
})
test('清理预览列出真实待移除项，取消不写入；备份动作明确对应所选备份', async () => {
  const v = await open(commands['env-path-clean']); host.setConfirm(false)
  await v.run(v.item('user:PATH'), '预览清理此 PATH')
  assert.match(host.confirms[0].message, /\/fixture\/missing/); assert.equal(calls('apply').length, 0)
  snapshot.backups = [{ id: backupId, source: 'user', createdAt: '2026-01-01', summary: '保存 VALUE' }]
  await globalAction(v, 'refresh'); await v.dropdown('backups')
  await v.run(v.item(`backup:${backupId}`), '预览恢复原配置')
  assert.deepEqual(calls('prepare').at(-1)[1].change, { kind: 'restore', source: 'user', backupId })
  assert.equal(calls('apply').length, 0)
})
test('表单关闭时取消未完成请求；迟到预览不得再弹确认或写入', async () => {
  const v = await open(), form = await edit(v), original = host.ipc.environment_manager
  let finish
  host.ipc.environment_manager = async p => p.action === 'prepare' ? new Promise(resolve => { finish = () => original(p).then(resolve) }) : original(p)
  const pending = form.run(undefined, '预览并保存'); await tick(); form.unmount(); finish(); await pending
  assert.equal(calls('cancel').length, 1); assert.equal(calls('apply').length, 0); assert.equal(host.confirms.length, 0); assert.equal(host.toasts.length, 0)
})
test('备份入口可复制真实快照；搜索和切换视图保留数据，未重复排列全局动作', async () => {
  const v = await open(commands['env-backup']); await globalAction(v, 'export')
  const exported = JSON.parse(host.clipboard.text); assert.deepEqual(exported.variables, snapshot.variables); assert.equal(exported.platform, 'darwin')
  assert.equal(host.lastToast().style, Toast.Style.Success)
  await v.dropdown('all'); await v.search('原值'); assert.deepEqual(v.items().map(i => i.props.id), ['user:VALUE'])
  assert.ok(v.items().every(row => v.actions(row).every(a => !['刷新', '新建变量', '复制变量快照'].includes(a.props.title))))
})
test('macOS 终端 PATH 按字面量整体替换：含 $PATH、~、相对目录或缺 /usr/bin 一律拒绝，不发预览请求', async () => {
  const v = await open(), { darwinPathProblem } = await import('../dist/index.js')
  await v.run(v.item('user:PATH'), '编辑变量'); const form = await mountPushed(host); views.push(form)
  assert.match(form.text(), /整体替换新终端里的 PATH/)
  for (const [value, reason] of [['/opt/bin:$PATH', /不会展开/], ['~/bin:/usr/bin:/bin', /~ 不会展开/], ['bin:/usr/bin:/bin', /以 \/ 开头/], ['/opt/homebrew/bin', /保留 \/usr\/bin 和 \/bin/]]) {
    await form.fill('value', value); await form.run(undefined, '预览并保存')
    assert.match(form.text(), reason); assert.equal(host.lastToast().style, Toast.Style.Failure)
  }
  assert.equal(calls('prepare').length, 0); assert.equal(host.pushed.length, 1)
  assert.equal(darwinPathProblem('/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin'), '')
  await form.fill('value', '/opt/homebrew/bin:/usr/bin:/bin'); await form.run(undefined, '预览并保存')
  assert.match(host.confirms.at(-1).message, /整体替换新终端里的 PATH/); assert.equal(calls('apply').length, 1)
})
test('macOS 当前进程的 PATH 不提供写入持久配置；含失效目录视图不列只读进程 PATH', async () => {
  snapshot.variables.push({ key: 'PATH', value: '/usr/bin:/gone', scope: 'process' })
  snapshot.paths.push({ scope: 'process', index: 1, value: '/gone', reason: '确认目录不存在', status: 'missing' })
  const v = await open()
  assert.deepEqual(v.actions(v.item('process:PATH')).map(a => a.props.title), ['复制变量值'])
  // macOS 当前进程变量一律只能复制，不提供写入持久配置
  assert.deepEqual(v.actions(v.item('process:PROCESS_ONLY')).map(a => a.props.title), ['复制变量值'])
  const clean = await open(commands['env-path-clean']); assert.deepEqual(clean.items().map(i => i.props.id), ['user:PATH'])
  snapshot.variables = snapshot.variables.filter(x => x.scope === 'process'); snapshot.paths = snapshot.paths.filter(x => x.scope === 'process')
  await globalAction(clean, 'refresh'); assert.equal(clean.items()[0].props.id, 'empty'); assert.match(clean.text(), /ZTools 管理段/)
})
test('Windows 注册表 Path 不区分大小写，识别失效目录并可预览清理；不做 macOS PATH 字面量校验', async () => {
  snapshot = { success: true, sessionId, platform: 'win32', notice: '重新登录后生效', sources: [{ id: 'user', label: '当前用户注册表环境' }, { id: 'system', label: '系统注册表环境' }],
    variables: [{ key: 'Path', value: 'C:\\ok;C:\\gone', scope: 'user' }], paths: [{ scope: 'user', index: 0, value: 'C:\\ok', reason: '目录存在', status: 'directory' }, { scope: 'user', index: 1, value: 'C:\\gone', reason: '确认目录不存在', status: 'missing' }], backups: [] }
  const v = await open(commands['env-path-clean']); assert.deepEqual(v.items().map(i => i.props.id), ['user:Path'])
  await v.run(v.item('user:Path'), '预览清理此 PATH'); assert.deepEqual(calls('prepare').at(-1)[1].change, { kind: 'clean', source: 'user' })
  await v.dropdown('all'); await v.run(v.item('user:Path'), '编辑变量'); const form = await mountPushed(host); views.push(form)
  assert.doesNotMatch(form.text(), /整体替换新终端/)
})
test('写入已核验但刷新失败：如实说明已保存，不报成未修改，也不再弹成功', async () => {
  const v = await open(), form = await edit(v), original = host.ipc.environment_manager
  let lists = 0
  host.ipc.environment_manager = async p => { if (p.action === 'list' && ++lists > 0) throw new Error('读取超时'); return original(p) }
  await form.fill('value', '新值'); await form.run(undefined, '预览并保存')
  assert.equal(calls('apply').length, 1); assert.equal(host.pushed.length, 0)
  assert.equal(host.lastToast().title, '配置已保存，刷新列表失败'); assert.match(v.text(), /已保存并核验，但刷新列表失败/)
})

test('全部变量按来源分组、组内按变量名排序，每行不重复来源标签', async () => {
  snapshot.variables.push({ key: 'alpha', value: 'a', scope: 'user' }, { key: 'BETA', value: 'b', scope: 'process' })
  const v = await open()
  assert.deepEqual(v.items().map(i => i.props.id), ['user:alpha', 'user:PATH', 'user:VALUE', 'process:BETA', 'process:PROCESS_ONLY'])
  const sections = v.tree().children.filter(c => c.type === 'List.Section').map(c => c.props.title)
  assert.deepEqual(sections, ['终端配置', '当前进程（只读）'])
  assert.ok(v.items().every(i => !(i.props.accessories || []).some(a => a.tag)))
  assert.doesNotMatch(v.text(), /当前进程 · 只读/)
  // 只有确有失效目录时才标注数量
  assert.equal(v.item('user:PATH').props.accessories[0].text, '1 个确认失效目录')
})

test('修改备份为空时如实说明自动备份；读取失败不显示该说明', async () => {
  const v = await open(commands['env-backup'])
  assert.equal(v.items()[0].props.title, '还没有修改备份')
  assert.equal(v.items()[0].props.subtitle, '修改变量前会自动备份，目前还没有修改记录')
  host.ipc.environment_manager = async () => { throw new Error('权限不足') }
  const failed = await open(commands['env-backup'])
  assert.equal(failed.items()[0].props.title, '环境变量读取未完成'); assert.match(failed.items()[0].props.subtitle, /权限不足/)
})

test('当前进程里的 shell 内部变量（_、SHLVL、OLDPWD、__CF_*）不列出；配置里同名变量照常显示', async () => {
  snapshot.variables.push(
    { key: '_', value: '/usr/bin/open', scope: 'process' },
    { key: 'SHLVL', value: '1', scope: 'process' },
    { key: 'OLDPWD', value: '/tmp', scope: 'process' },
    { key: '__CF_USER_TEXT_ENCODING', value: '0x1F5:0x19:0x34', scope: 'process' },
    { key: 'HOME', value: '/Users/test', scope: 'process' },
    { key: '_', value: '用户自己写的', scope: 'user' }
  )
  const v = await open()
  const ids = v.items().map(i => i.props.id)
  for (const hidden of ['process:_', 'process:SHLVL', 'process:OLDPWD', 'process:__CF_USER_TEXT_ENCODING']) assert.equal(ids.includes(hidden), false, hidden)
  assert.ok(ids.includes('process:HOME'))
  assert.ok(ids.includes('user:_'))
  await v.search('SHLVL')
  assert.equal(v.items()[0].props.id, 'empty')
})
test('Windows 当前进程变量仍可写入持久配置', async () => {
  snapshot.platform = 'win32'
  const v = await open()
  assert.ok(v.actions(v.item('process:PROCESS_ONLY')).some(a => a.props.title === '写入持久配置'))
})
