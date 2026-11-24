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

test('拖拽文件接收：收到 plugin_files_dropped 事件后自动扫描被占用目标', async () => {
  const dropListeners = []
  globalThis.window.__ztoolsDeclarativeFeatures = { fileInput: false }
  globalThis.window.ztools = {
    ...(globalThis.window.ztools || {}),
    events: {
      on(event, cb) {
        if (event === 'plugin_files_dropped') dropListeners.push(cb)
        return () => {}
      }
    }
  }
  const view = await open(commands['file-unlock'])
  assert.equal(dropListeners.length, 1)

  dropListeners[0]({ payload: { files: ['/fixture/文档.txt'] } })
  await tick()
  await tick()

  assert.equal(calls('inspect').length, 1)
  assert.equal(calls('inspect')[0][1].targetPath, '/fixture/文档.txt')
  assert.ok(view.item('process:55'))
})

test('Ctrl+V 粘贴文件或文件夹与 Windows 手动选择文件/文件夹检测占用进程', async () => {
  const view = await open(commands['file-unlock'])
  assert.equal(view.tree().props.fileInput?.allowDirectories, true)
  await view.pasteFiles(['/fixture/文档.txt'])
  await tick()
  assert.equal(calls('inspect').length, 1)
  assert.equal(calls('inspect')[0][1].targetPath, '/fixture/文档.txt')
  assert.ok(view.item('process:55'))

  // Windows 平台下支持粘贴文件检测，且提供手动「选择文件检测」「选择文件夹检测」Action
  host.reset()
  host.ipc.system_get_platform = async () => ({ success: true, platform: 'windows' })
  host.ipc.window_show_open_dialog = async (params) => ({
    canceled: false,
    filePath: params.properties?.includes('openDirectory') ? 'D:\\Locked\\FolderA' : 'D:\\Locked\\report.docx'
  })
  const winInspectCalls = []
  host.ipc.dllplugin_call = async ({ func, params }) => {
    if (func === 'listRemovableDrives') return { ok: true, drives: [] }
    if (func === 'inspectLocks') {
      winInspectCalls.push(params.targetPath)
      return {
        ok: true,
        targetPath: params.targetPath,
        isDirectory: params.targetPath.endsWith('FolderA'),
        processes: [{ id: 'win-p1', pid: 4321, name: 'WINWORD.EXE', executablePath: 'C:\\Program Files\\WINWORD.EXE', lockedPath: params.targetPath }]
      }
    }
    return { ok: true }
  }

  const winView = await open(commands['file-unlock'])
  await tick(10)
  const emptyItem = winView.item('empty-status')
  const actionTitles = winView.actions(emptyItem).map(a => a.props.title)
  assert.ok(actionTitles.includes('选择文件检测'))
  assert.ok(actionTitles.includes('选择文件夹检测'))

  await winView.run(emptyItem, '选择文件检测')
  await tick(10)
  assert.equal(winInspectCalls.at(-1), 'D:\\Locked\\report.docx')
  assert.ok(winView.item('win-p1'))

  await winView.pasteFiles(['D:\\Locked\\pasted_table.xlsx'])
  await tick(10)
  assert.equal(winInspectCalls.at(-1), 'D:\\Locked\\pasted_table.xlsx')
})

test('Windows 挂载零扫盘且不读剪贴板；usb-unlock 只列磁盘不扫描占用；手动检测剪贴板与清空当前目标（双端）', async () => {
  // 1. Windows file-unlock 挂载：不调 clipboard_read_text、inspectLocks、listRemovableDrives，顶栏恰 2 个按钮
  host.reset()
  host.ipc.system_get_platform = async () => ({ success: true, platform: 'windows' })
  host.clipboard.text = 'D:\\Secret\\from-clipboard.docx'
  const winCalls = []
  host.ipc.clipboard_read_text = async () => {
    winCalls.push('clipboard_read_text')
    return { success: true, data: '"D:\\Secret\\from-clipboard.docx"' }
  }
  let releasePendingInspect
  let pendingInspectMode = false
  host.ipc.dllplugin_call = async ({ func, params }) => {
    winCalls.push(`${func}:${params.targetPath || ''}`)
    if (func === 'listRemovableDrives') {
      return {
        ok: true,
        drives: [{ mount: 'E:\\', label: 'MyUSB', totalBytes: 1024, freeBytes: 512, totalText: '1.0 KB', freeText: '512 B' }]
      }
    }
    if (func === 'inspectLocks') {
      if (pendingInspectMode) {
        return await new Promise((resolve) => {
          releasePendingInspect = () => resolve({
            ok: true,
            targetPath: params.targetPath,
            isDirectory: false,
            processes: [{ id: 'late-1', pid: 7777, name: 'notepad.exe', executablePath: 'C:\\Windows\\notepad.exe', lockedPath: params.targetPath }]
          })
        })
      }
      return {
        ok: true,
        targetPath: params.targetPath,
        isDirectory: false,
        processes: [{ id: 'clip-p1', pid: 5566, name: 'WINWORD.EXE', executablePath: 'C:\\Program Files\\WINWORD.EXE', lockedPath: params.targetPath }]
      }
    }
    return { ok: true }
  }

  const winView = await open(commands['file-unlock'])
  await tick(10)
  assert.deepEqual(winCalls, [], `Windows 挂载不应读取剪贴板或扫描占用，实际：${JSON.stringify(winCalls)}`)
  assert.equal(host.ipcCalls.some(([m]) => m === 'clipboard_read_text'), false)
  assert.deepEqual(
    winView.tree().props.filterBar.actions.map((a) => [a.id, a.title]),
    [
      ['pick-file', '选择文件检测'],
      ['pick-folder', '选择文件夹检测']
    ]
  )

  // 2. 点击空状态「检测剪贴板中的路径」后才读取剪贴板并检测占用
  await winView.run(winView.item('empty-status'), '检测剪贴板中的路径')
  await tick(10)
  assert.equal(winCalls[0], 'clipboard_read_text')
  assert.equal(winCalls[1], 'inspectLocks:D:\\Secret\\from-clipboard.docx')
  const procItem = winView.item('clip-p1')
  const procActionTitles = winView.actions(procItem).map((a) => a.props.title)
  assert.ok(procActionTitles.includes('一键全部解锁'))
  assert.ok(procActionTitles.includes('解锁并移入回收站'))
  assert.ok(procActionTitles.includes('清空当前目标'))
  const clearWinAction = winView.actions(procItem).find((a) => a.props.title === '清空当前目标')
  assert.deepEqual(clearWinAction.props.shortcut, { modifiers: ['ctrl', 'shift'], key: 'backspace' })

  // 清空当前目标回到空状态，不碰磁盘
  await winView.run(procItem, '清空当前目标')
  await tick(10)
  assert.ok(winView.item('empty-status'))
  assert.match(winView.tree().props.filterBar.summaryText, /尚未选择目标/)

  // 剪贴板无有效路径时给出提示，不触发 inspectLocks
  host.ipc.clipboard_read_text = async () => ({ success: true, data: 'plain text not a path' })
  const countBeforeBadClip = winCalls.length
  await winView.run(winView.item('empty-status'), '检测剪贴板中的路径')
  await tick(10)
  assert.equal(host.lastToast().style, 'FAILURE')
  assert.equal(host.lastToast().title, '剪贴板中没有可检测的路径')
  assert.equal(winCalls.length, countBeforeBadClip)

  // 检测进行中：摘要与列表应显式显示「正在扫描占用进程…」，且禁止提前断言未占用或清空
  pendingInspectMode = true
  host.ipc.clipboard_read_text = async () => ({ success: true, data: 'D:\\Secret\\slow.docx' })
  const inspecting = winView.run(winView.item('empty-status'), '检测剪贴板中的路径')
  await tick(10)
  assert.equal(winView.tree().props.isLoading, true)
  assert.match(winView.tree().props.filterBar.summaryText, /正在扫描占用进程/)
  assert.match(winView.item('empty-status').props.title, /正在扫描占用进程/)
  assert.doesNotMatch(winView.item('empty-status').props.title, /未被任何进程占用/)
  await winView.run(null, '清空当前目标')
  assert.equal(host.lastToast().style, 'FAILURE')
  assert.equal(host.lastToast().title, '正在检测，完成后再清空')
  releasePendingInspect()
  await inspecting
  await tick(10)
  assert.ok(winView.item('late-1'))

  // 3. Windows usb-unlock 挂载：只调用 listRemovableDrives 列出盘符，不自动检测磁盘占用也不读剪贴板
  winCalls.length = 0
  pendingInspectMode = false
  const usbView = await open(commands['usb-unlock'])
  await tick(10)
  assert.deepEqual(winCalls, ['listRemovableDrives:'])
  assert.ok(usbView.item('drive-E:\\'))
  assert.ok(usbView.item('empty-status'))
  await usbView.run(usbView.item('drive-E:\\'), '检测此移动磁盘的占用进程')
  await tick(10)
  assert.equal(winCalls.at(-1), 'inspectLocks:E:\\')

  // 4. macOS 端支持「清空当前目标」（Cmd+Shift+Backspace）且操作进行中不可用
  host.reset()
  host.ipc.system_get_platform = async () => ({ success: true, platform: 'macos' })
  host.ipc.file_unlock = async (p) => {
    if (p.action === 'inspect') return structuredClone(snapshot)
    if (p.action === 'close' || p.action === 'cancel') return { success: true, cancelRequested: true }
    throw new Error('unexpected')
  }
  const macView = await open(commands['file-unlock'])
  await inspect(macView)
  const macTarget = macView.item('target')
  const macClearAction = macView.actions(macTarget).find((a) => a.props.title === '清空当前目标')
  assert.ok(macClearAction)
  assert.deepEqual(macClearAction.props.shortcut, { modifiers: ['ctrl', 'shift'], key: 'backspace' })
  await macView.run(macTarget, '清空当前目标')
  await tick(10)
  assert.ok(macView.item('choose'))

  // macOS 检测进行中拒绝清空
  let releaseMacInspect
  host.ipc.file_unlock = async (p) => {
    if (p.action === 'inspect') {
      return await new Promise((resolve) => {
        releaseMacInspect = () => resolve(structuredClone(snapshot))
      })
    }
    return { success: true, cancelRequested: true }
  }
  await macView.search('/fixture/文档.txt')
  const macInspecting = macView.run(macView.item('input'), '检测此路径')
  await tick(5)
  assert.equal(macView.tree().props.isLoading, true)
  await macView.run(macView.item('target'), '清空当前目标')
  assert.equal(host.lastToast().style, 'FAILURE')
  assert.match(host.lastToast().title, /正在检测或执行操作/)
  releaseMacInspect()
  await macInspecting
})
