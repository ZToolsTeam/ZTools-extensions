import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { Toast } from '@ztools/declarative-ui'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import Command, { commands, inspectMacLocks, terminateMacLocks } from '../dist/index.js'
const sessionId = '11111111-1111-4111-8111-111111111111'
let host, views, snapshot
beforeEach(() => {
  host = createHost(); views = []
  snapshot = { success: true, sessionId, targetPath: '/fixture/文档.txt', isDirectory: false, processes: [{ pid: 55, name: 'test-app', executablePath: '/fixture/test-app', userId: 501, paths: ['/fixture/文档.txt'], protected: false, reason: '' }], notice: '仅当前权限可见的占用，不保证可安全弹出', mutationBlockedReason: '' }
  host.ipc.system_get_platform = async () => ({ success: true, platform: 'macos' })
  host.ipc.window_show_open_dialog = async () => ({ canceled: false, filePath: snapshot.targetPath })
  host.ipc.file_unlock = async p => {
    if (p.action === 'inspect') return structuredClone(snapshot)
    if (p.action === 'drives') return { success: true, drives: [{ path: '/Volumes/test-disk', label: '测试磁盘' }] }
    if (p.action === 'close' || p.action === 'cancel') return { success: true, cancelRequested: true }
    if (p.action === 'terminate') { snapshot.processes = []; return { success: true, terminated: p.pids, failures: [], snapshot: structuredClone(snapshot), refreshError: '' } }
    if (p.action === 'trash') return { success: true, status: 'trashed', targetPath: snapshot.targetPath }
    if (p.action === 'rename') return { success: true, status: 'renamed', targetPath: '/fixture/' + p.name }
    throw new Error('unexpected request')
  }
})
afterEach(async () => { for (const v of views.toReversed()) v.unmount(); await tick() })
const calls = action => host.ipcCalls.filter(([method, p]) => method === 'file_unlock' && p.action === action)
async function open(command = Command) { const view = await mount(command, host); views.push(view); await tick(); return view }
async function inspect(view) { await view.search('/fixture/文档.txt'); await view.run(view.item('input'), '检测此路径') }

test('真实命令入口会执行平台读取、Mac 磁盘初始化及卸载清理，不经过 Windows DLL', async () => {
  const view = await open(commands['usb-unlock'])
  assert.ok(host.ipcCalls.some(([method]) => method === 'system_get_platform')); assert.equal(calls('drives').length, 1)
  assert.ok(view.item('drive:/Volumes/test-disk')); assert.equal(view.tree().props.isShowingDetail, false)
  assert.ok(!host.ipcCalls.some(([method]) => /dll|native_host/i.test(method)))
  view.unmount(); views = []; await tick(); assert.equal(calls('close').length, 1)
})
test('路径输入不会逐字扫描，Enter 主动作才检测；全局按钮只选择目标', async () => {
  const view = await open(commands['file-unlock']); await view.search('/fixture/文档.txt'); assert.equal(calls('inspect').length, 0)
  assert.deepEqual(view.tree().props.filterBar.actions.map(a => a.id), ['file', 'folder'])
  await view.run(view.item('input'), '检测此路径'); assert.equal(calls('inspect').length, 1)
  assert.ok(view.item('process:55')); assert.equal(view.actions(view.item('process:55'))[0].props.title, '结束此进程')
  await view.dropdown('protected'); assert.match(view.text(), /没有符合筛选条件/); assert.doesNotMatch(view.text(), /当前权限范围内未发现占用/)
})
test('扫描失败或不完整不能冒充无占用，旧客户端提示升级且不回退 DLL', async () => {
  const view = await open(), original = host.ipc.file_unlock; await inspect(view)
  host.ipc.file_unlock = async p => { if (p.action === 'inspect') throw new Error('扫描无权限'); return original(p) }
  await view.run(view.item('target'), '重新扫描目标')
  assert.match(view.text(), /扫描无权限/); assert.doesNotMatch(view.text(), /当前权限范围内未发现占用/)
  assert.ok(!view.actions(view.item('target')).some(a => /废纸篓|重命名/.test(a.props.title)))
  host.ipc.file_unlock = async () => ({ success: true, processes: [] }); await assert.rejects(inspectMacLocks('/fixture'), /不完整/)
  globalThis.__ztoolsElectron.transport.methods = {}; await assert.rejects(inspectMacLocks('/fixture'), /升级客户端/)
})
test('结束等待真实退出结果，确认取消不结束，并发 Enter 不会重复发送', async () => {
  const view = await open(); await inspect(view); host.setConfirm(false)
  await view.run(view.item('process:55'), '结束此进程'); assert.equal(calls('terminate').length, 0)
  host.setConfirm(true); let finish; const original = host.ipc.file_unlock
  host.ipc.file_unlock = async p => p.action === 'terminate' ? new Promise(resolve => { finish = () => original(p).then(resolve) }) : original(p)
  const pending = view.run(view.item('process:55'), '结束此进程'); await tick()
  assert.equal(view.tree().props.isLoading, true); await view.run(view.item('process:55'), '结束此进程'); assert.equal(calls('terminate').length, 1)
  assert.equal(host.toasts.length, 0); finish(); await pending
  assert.match(host.lastToast().title, /确认 1 个进程退出/); assert.equal(host.lastToast().style, Toast.Style.Success)
  assert.equal(calls('terminate')[0][1].mode, 'graceful')
})
test('部分结束失败和刷新失败如实显示，不自动强杀也不继续回收文件', async () => {
  const view = await open(); await inspect(view); const original = host.ipc.file_unlock
  host.ipc.file_unlock = async p => p.action === 'terminate' ? { success: false, terminated: [], failures: [{ pid: 55, message: '进程仍未退出' }], refreshError: '扫描超时' } : original(p)
  await view.run(view.item('target'), '结束占用并移入废纸篓')
  assert.match(host.lastToast().message, /仍未退出/); assert.match(host.lastToast().message, /扫描超时/); assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.equal(calls('trash').length, 0); assert.deepEqual(calls('terminate').map(([,p]) => p.mode), ['graceful'])
  host.ipc.file_unlock = async () => ({ success: true, terminated: [55], failures: [], refreshError: '' })
  await assert.rejects(terminateMacLocks(sessionId, [55], 'force'), /扫描缺失/)
})
test('回收确认列出真实目标和进程，结束后才回收；保护目标不显示写操作', async () => {
  const view = await open(); await inspect(view)
  await view.run(view.item('target'), '结束占用并移入废纸篓')
  assert.match(host.confirms[0].message, /test-app（55）/); assert.match(host.confirms[0].message, /文档.txt/)
  assert.deepEqual(host.ipcCalls.filter(([,p]) => ['terminate', 'trash'].includes(p.action)).map(([,p]) => p.action), ['terminate', 'trash'])
  assert.match(host.lastToast().title, /已移入废纸篓/)
  snapshot.mutationBlockedReason = '磁盘根目录不能改名或回收'; await inspect(view)
  assert.ok(!view.actions(view.item('target')).some(a => /废纸篓|重命名/.test(a.props.title)))
})
test('改名表单 Enter 等待确认，失败保留输入，不覆盖同名文件的错误明确显示', async () => {
  const view = await open(); await inspect(view); await view.run(view.item('target'), '重命名目标')
  const form = await mountPushed(host); views.push(form); await form.fill('name', '已有文件.txt')
  const original = host.ipc.file_unlock; let finish
  host.ipc.file_unlock = async p => p.action === 'rename' ? new Promise((_resolve, reject) => { finish = () => reject(new Error('同名文件已存在，未覆盖')) }) : original(p)
  const pending = form.run(undefined, '确认重命名'); await tick(); assert.equal(form.tree().props.isLoading, true); assert.equal(host.pushed.length, 1)
  finish(); await pending; assert.equal(host.pushed.length, 1); assert.equal(form.field('name').props.value, '已有文件.txt'); assert.match(form.text(), /未覆盖/)
})
test('选择文件取消不触发扫描，选定后进行真实 IPC 读写流程', async () => {
  const view = await open(); host.ipc.window_show_open_dialog = async () => ({ canceled: true })
  await view.run(view.item('choose'), '选择文件…'); assert.equal(calls('inspect').length, 0)
  host.ipc.window_show_open_dialog = async p => { assert.deepEqual(p.properties, ['openFile']); return { canceled: false, filePath: '/fixture/文档.txt' } }
  await view.run(view.item('choose'), '选择文件…'); assert.equal(calls('inspect').length, 1)
  // 检测后“选择目标”行消失，顶部恢复选择文件 / 文件夹，用来换一个目标
  assert.deepEqual(view.tree().props.filterBar.actions.map(a => a.id), ['file', 'folder'])
})
test('取消整个解锁回收流程后，即使结束进程迟到返回成功也不能开始新的回收', async () => {
  const view = await open(); await inspect(view); let finish; const original = host.ipc.file_unlock
  host.ipc.file_unlock = async p => p.action === 'terminate' ? new Promise(resolve => { finish = () => original(p).then(resolve) }) : original(p)
  const pending = view.run(view.item('target'), '结束占用并移入废纸篓'); await tick()
  await view.tree().props.filterBar.actions.find(a => a.id === 'cancel').onAction()
  finish(); await pending
  assert.equal(calls('terminate').length, 1); assert.equal(calls('cancel').length, 1); assert.equal(calls('trash').length, 0)
  assert.match(view.text(), /后续操作已停止/)
  assert.ok(!host.toasts.some(t => t.style === Toast.Style.Success))
})
test('Mac 粘贴带引号或首尾空白的路径按原路径检测；usb 入口选择窗口默认打开 /Volumes', async () => {
  const view = await open(commands['file-unlock'])
  await view.search('  "/fixture/文档.txt"\n')
  assert.ok(view.item('input'))
  await view.run(view.item('input'), '检测此路径')
  assert.equal(calls('inspect')[0][1].targetPath, '/fixture/文档.txt')
  await view.search('relative/path')
  assert.throws(() => view.item('input'), /找不到列表项/)
  const usb = await open(commands['usb-unlock'])
  await usb.tree().props.filterBar.actions.find(a => a.id === 'folder').onAction(); await tick()
  const dialog = host.ipcCalls.filter(([method]) => method === 'window_show_open_dialog').at(-1)[1]
  assert.equal(dialog.defaultPath, '/Volumes')
  assert.deepEqual(dialog.properties, ['openDirectory'])
})
test('Mac 回收动作使用废纸篓与访达的叫法', async () => {
  const view = await open(commands['file-unlock']); await inspect(view)
  const titles = view.actions(view.item('target')).map(a => a.props.title)
  assert.ok(titles.includes('结束占用并移入废纸篓'))
  assert.ok(!titles.some(t => /回收站/.test(t)))
})
test('未选目标时 file-unlock 主动作是选择文件，刷新外接磁盘只出现在 usb-unlock', async () => {
  const view = await open(commands['file-unlock'])
  const titles = view.actions(view.item('choose')).map(a => a.props.title)
  assert.deepEqual(titles, ['选择文件…', '选择文件夹…'])
  await view.run(view.item('choose'), '选择文件…')
  const dialog = host.ipcCalls.filter(([method]) => method === 'window_show_open_dialog').at(-1)[1]
  assert.deepEqual(dialog.properties, ['openFile'])
  assert.equal(calls('inspect').length, 1)
  assert.equal(calls('drives').length, 0)
  const usb = await open(commands['usb-unlock'])
  assert.equal(usb.actions(usb.item('choose'))[0].props.title, '刷新外接磁盘')
  await usb.run(usb.item('choose'), '刷新外接磁盘')
  assert.equal(calls('drives').length, 2)
})
test('取消选择文件不触发检测，也不显示成功提示', async () => {
  host.ipc.window_show_open_dialog = async () => ({ canceled: true })
  const view = await open(commands['file-unlock'])
  await view.run(view.item('choose'), '选择文件…')
  assert.equal(calls('inspect').length, 0)
  assert.ok(!host.toasts.some(t => t.style === Toast.Style.Success))
  assert.ok(view.item('choose'))
})

test('选择文件 / 文件夹只出现一次：选择目标行在时顶部不重复；外接磁盘入口的 Enter 提示与刷新动作一致', async () => {
  const view = await open(commands['file-unlock'])
  const row = view.item('choose')
  assert.deepEqual(view.actions(row).map(a => a.props.title), ['选择文件…', '选择文件夹…'])
  assert.deepEqual(view.tree().props.filterBar.actions, [])
  assert.match(row.props.subtitle, /按 Enter 选择文件/)
  const usb = await open(commands['usb-unlock'])
  const usbRow = usb.item('choose')
  assert.equal(usb.actions(usbRow)[0].props.title, '刷新外接磁盘')
  assert.match(usbRow.props.subtitle, /按 Enter 刷新外接磁盘/)
  assert.doesNotMatch(usbRow.props.subtitle, /Enter 开始检测/)
  assert.equal(usbRow.props.title, '选择下方的外接磁盘检测占用')
  assert.deepEqual(usb.tree().props.filterBar.actions.map(a => a.id), ['file', 'folder'])
  // 没有外接磁盘时也不承诺 Enter 检测
  host.ipc.file_unlock = async p => p.action === 'drives' ? { success: true, drives: [] } : { success: true, cancelRequested: true }
  const empty = await open(commands['usb-unlock'])
  assert.equal(empty.item('choose').props.title, '未发现已挂载的外接磁盘')
  const before = calls('drives').length
  await empty.run(empty.item('choose'), '刷新外接磁盘')
  assert.equal(calls('drives').length, before + 1)
})
