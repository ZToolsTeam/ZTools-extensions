// 界面集成测试：真实声明式运行时 + 模拟客户端共享服务（可注入失败）
// 覆盖：顶栏双按钮、启动/停止服务、选择文件/文件夹并分批共享、同名提示、拖入/粘贴文件夹展开、清空共享列表（含部分失败）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Toast } from '@ztools/declarative-ui'
import { createHost, installDirectoryHost, mount, tick } from '../../shared/test-harness.mjs'
import { installLanHost } from './lan-host-fake.mjs'
import LanShareCommand from '../dist/index.js'

const host = createHost()
const rejections = []
process.on('unhandledRejection', (reason) => rejections.push(reason))

test.beforeEach(() => {
  host.reset()
  rejections.length = 0
})

const dllCalls = (func) => host.ipcCalls.filter(([m, p]) => m === 'dllplugin_call' && p.func === func)
const ipcCount = (method) => host.ipcCalls.filter(([m]) => m === method).length

function makeTempTree(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-lan-'))
  for (const [rel, content] of Object.entries(spec)) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return root
}

async function clickFilterBar(view, id) {
  const action = view.tree().props.filterBar.actions.find((a) => a.id === id)
  assert.ok(action, `顶栏缺少按钮 ${id}`)
  action.onAction()
  await tick(35)
}

test('打开时只读取状态，不扫描本机目录；顶栏固定为「选择文件」「选择文件夹」2 个按钮，刷新移入服务项', async () => {
  installLanHost(host)
  const view = await mount(LanShareCommand)
  await tick(20)
  assert.equal(dllCalls('startShareServer').length, 0)
  assert.equal(ipcCount('system_get_path'), 0)
  assert.equal(ipcCount('system_list_common_folders'), 0)
  assert.equal(ipcCount('system_search_files'), 0)
  assert.equal(ipcCount('filesystem_get_directory_contents'), 0)
  assert.equal(view.item('lan-service').props.title, '共享服务未运行')

  const filterActions = view.tree().props.filterBar.actions
  assert.deepEqual(
    filterActions.map((a) => [a.id, a.title]),
    [['pick-files', '选择文件'], ['pick-folder', '选择文件夹']]
  )
  assert.ok(view.actions(view.item('lan-service')).some((a) => a.props.title === '刷新共享状态'))
  assert.ok(view.actions(null).some((a) => a.props.title === '刷新共享状态'))

  const text = view.text()
  assert.equal(/剪贴板投送|上传照片|双向/.test(text), false)
  assert.equal(/"color"/.test(text), false)
  view.unmount()
})

test('启动服务：成功后显示访问地址与二维码，提示无需密码', async () => {
  installLanHost(host)
  const view = await mount(LanShareCommand)
  await tick(20)
  await view.run(view.item('lan-service'), '启动共享服务')
  await tick(20)
  assert.equal(dllCalls('startShareServer').length, 1)
  assert.equal(host.lastToast().style, Toast.Style.Success)
  assert.equal(host.lastToast().title, '共享服务已启动')
  const service = view.item('lan-service')
  assert.equal(service.props.title, '共享服务运行中：http://192.168.1.20:8765')
  const md = service.props.detail.props.markdown
  assert.match(md, /data:image\/svg\+xml/)
  assert.match(md, /不需要密码/)
  assert.match(md, /172\.20\.0\.1:8765/, '应列出本机的其他地址')
  view.unmount()
})

test('[故障] 启动服务失败：提示原因，仍显示未运行', async () => {
  const state = installLanHost(host)
  state.startError = Object.assign(new Error('listen EACCES: permission denied 0.0.0.0:8765'), { code: 'EACCES' })
  const view = await mount(LanShareCommand)
  await tick(20)
  await view.run(view.item('lan-service'), '启动共享服务')
  await tick(20)
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.equal(host.lastToast().title, '启动共享服务失败')
  assert.match(host.lastToast().message, /调用局域网共享服务失败/)
  assert.equal(view.item('lan-service').props.title, '共享服务未运行')
  assert.deepEqual(rejections, [])
  view.unmount()
})

test('选择文件并共享：读不到的文件如实提示跳过，列表只显示客户端确认加入的文件', async () => {
  const state = installLanHost(host, { existing: ['D:\\Share\\a.txt'] })
  state.dialog = { canceled: false, filePaths: [{ path: 'D:\\Share\\a.txt' }, { path: 'D:\\Share\\gone.txt' }] }
  const view = await mount(LanShareCommand)
  await tick(20)
  await clickFilterBar(view, 'pick-files')
  assert.deepEqual(dllCalls('addFiles')[0][1].params, { paths: ['D:\\Share\\a.txt', 'D:\\Share\\gone.txt'] })
  assert.equal(host.lastToast().style, Toast.Style.Success)
  assert.equal(host.lastToast().title, '已共享 1 个文件，1 个文件无法读取已跳过')
  assert.match(host.lastToast().message, /不需要密码/)
  const fileRows = view.items().filter((i) => String(i.props.id).startsWith('lan-file-'))
  assert.deepEqual(fileRows.map((i) => i.props.title), ['a.txt'])
  assert.deepEqual(rejections, [])
  view.unmount()
})

test('[边界] 取消选择文件：不调用客户端加文件，也不提示', async () => {
  installLanHost(host)
  const view = await mount(LanShareCommand)
  await tick(20)
  host.toasts.length = 0
  await clickFilterBar(view, 'pick-files')
  assert.equal(dllCalls('addFiles').length, 0)
  assert.equal(host.toasts.length, 0)
  view.unmount()
})

test('[故障] 选中的文件都读不到：提示失败，不报成功', async () => {
  const state = installLanHost(host)
  state.dialog = { canceled: false, filePath: 'D:\\Share\\gone.txt' }
  const view = await mount(LanShareCommand)
  await tick(20)
  await clickFilterBar(view, 'pick-files')
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.equal(host.lastToast().title, '共享文件失败')
  assert.equal(host.toasts.some((t) => t.style === Toast.Style.Success), false)
  view.unmount()
})

test('选择文件夹并共享：收集非隐藏普通文件、分批调用、提示同名文件并支持整盘确认与数量上限', async () => {
  const spec = {
    'dirA/readme.md': 'a',
    'dirB/readme.md': 'b',
    'dirA/.hidden.txt': 'h',
    'dirA/empty.txt': ''
  }
  for (let i = 0; i < 105; i++) {
    spec[`bulk/file_${String(i).padStart(3, '0')}.txt`] = 'x'
  }
  const tmp = makeTempTree(spec)
  try {
    const allPaths = [
      path.join(tmp, 'dirA', 'readme.md'),
      path.join(tmp, 'dirB', 'readme.md'),
      ...Array.from({ length: 105 }, (_, i) => path.join(tmp, 'bulk', `file_${String(i).padStart(3, '0')}.txt`))
    ]
    const state = installLanHost(host, { existing: allPaths })
    await installDirectoryHost(host, { authorized: [tmp] })

    const view = await mount(LanShareCommand)
    await tick(20)

    // 整盘根目录确认取消
    state.folderDialog = { canceled: false, folderPath: 'E:\\' }
    host.setConfirm(false)
    await clickFilterBar(view, 'pick-folder')
    assert.equal(host.confirms.length, 1)
    assert.equal(dllCalls('addFiles').length, 0)

    // 真实目录：共 107 个有效非隐藏文件，按 100 + 7 分 2 批调用，且存在 2 个同名 readme.md
    state.folderDialog = { canceled: false, folderPath: tmp }
    await clickFilterBar(view, 'pick-folder')
    await tick(30)
    const batches = dllCalls('addFiles').map(([, p]) => p.params.paths.length)
    assert.deepEqual(batches, [100, 7])
    assert.equal(host.lastToast().style, Toast.Style.Success)
    assert.equal(host.lastToast().title, '已共享 107 个文件')
    assert.match(host.lastToast().message, /忽略 2 个隐藏或系统文件/)
    assert.match(host.lastToast().message, /有 2 个文件与其他文件同名，网页上请按大小区分/)
    view.unmount()
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('暂停、恢复、移出共享列表：用 id 调用客户端，界面以客户端状态为准', async () => {
  const state = installLanHost(host)
  state.running = true
  state.files.set('id1', { id: 'id1', name: 'a.txt', path: 'D:\\Share\\a.txt', size: 10, sizeBytes: 10, shared: true, isDirectory: false })
  const view = await mount(LanShareCommand)
  await tick(20)

  await view.run(view.item('lan-file-id1'), '暂停共享该文件')
  await tick(20)
  assert.deepEqual(dllCalls('toggleFileShare')[0][1].params, { id: 'id1', shared: false })
  let row = view.item('lan-file-id1')
  assert.deepEqual(row.props.accessories[0], { tag: { value: '已暂停' } })
  assert.equal(view.actions(row).some((a) => a.props.title === '复制下载地址'), false)

  await view.run(row, '恢复共享该文件')
  await tick(20)
  row = view.item('lan-file-id1')
  assert.deepEqual(row.props.accessories[0], { tag: { value: '共享中' } })

  await view.run(row, '从共享列表移除（不删除文件）')
  await tick(20)
  assert.equal(view.items().some((i) => i.props.id === 'lan-file-id1'), false)
  assert.match(host.lastToast().title, /文件本身没有删除/)
  view.unmount()
})

test('清空共享列表：全部移除成功与部分失败如实汇报“已移除 N 个，M 个失败”', async () => {
  const state = installLanHost(host)
  state.running = true
  state.files.set('id1', { id: 'id1', name: 'a.txt', path: 'D:\\Share\\a.txt', sizeBytes: 10, shared: true, isDirectory: false })
  state.files.set('id2', { id: 'id2', name: 'b.txt', path: 'D:\\Share\\b.txt', sizeBytes: 10, shared: true, isDirectory: false })
  state.files.set('id3', { id: 'id3', name: 'c.txt', path: 'D:\\Share\\c.txt', sizeBytes: 10, shared: true, isDirectory: false })
  state.removeFailIds.add('id2')

  const view = await mount(LanShareCommand)
  await tick(20)
  assert.match(view.tree().props.filterBar.summaryText, /清空列表 Ctrl\+Shift\+Backspace/)

  await view.run(view.item('lan-service'), '清空共享列表')
  await tick(25)
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.equal(host.lastToast().title, '已移除 2 个，1 个失败')
  assert.match(host.lastToast().message, /b\.txt/)
  assert.deepEqual(
    view.items().filter((i) => String(i.props.id).startsWith('lan-file-')).map((i) => i.props.title),
    ['b.txt']
  )

  state.removeFailIds.clear()
  await view.run(view.item('lan-file-id2'), '清空共享列表')
  await tick(25)
  assert.equal(host.lastToast().style, Toast.Style.Success)
  assert.match(host.lastToast().title, /已清空共享列表/)
  assert.equal(view.items().filter((i) => String(i.props.id).startsWith('lan-file-')).length, 0)
  view.unmount()
})

test('停止服务：文件标签停止显示共享中，重新启动后恢复', async () => {
  const state = installLanHost(host)
  state.running = true
  state.files.set('active', { id: 'active', name: 'a.txt', path: 'D:\\Share\\a.txt', sizeBytes: 10, shared: true, isDirectory: false })
  state.files.set('paused', { id: 'paused', name: 'b.txt', path: 'D:\\Share\\b.txt', sizeBytes: 10, shared: false, isDirectory: false })
  const view = await mount(LanShareCommand)
  await tick(20)
  await view.run(view.item('lan-service'), '停止共享服务')
  await tick(20)
  assert.equal(host.lastToast().title, '共享服务已停止')
  assert.equal(view.item('lan-service').props.title, '共享服务未运行')
  assert.equal(view.item('lan-file-active').props.accessories[0].tag.value, '服务未启动')
  assert.equal(view.item('lan-file-paused').props.accessories[0].tag.value, '已暂停')
  await view.run(view.item('lan-service'), '启动共享服务'); await tick(20)
  assert.equal(view.item('lan-file-active').props.accessories[0].tag.value, '共享中')
  view.unmount()
})

test('拖拽文件与文件夹接收：旧版 plugin_files_dropped 事件也能展开文件夹逐个共享', async () => {
  const tmp = makeTempTree({ 'sub.v1/inner.txt': 'inner' })
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
  try {
    const folder = path.join(tmp, 'sub.v1')
    const inner = path.join(folder, 'inner.txt')
    installLanHost(host, { existing: [inner, 'D:\\Share\\dropped.txt'] })
    await installDirectoryHost(host, { authorized: [tmp] })
    host.ipc.filesystem_directory_exists = async ({ path: p }) => ({
      success: true,
      exists: fs.existsSync(p) && fs.statSync(p).isDirectory()
    })

    const view = await mount(LanShareCommand)
    await tick(20)
    assert.equal(dropListeners.length, 1)

    dropListeners[0]({ payload: { files: [folder, 'D:\\Share\\dropped.txt'] } })
    await tick(35)

    assert.deepEqual(dllCalls('addFiles')[0][1].params, { paths: [inner, 'D:\\Share\\dropped.txt'] })
    assert.equal(host.lastToast().style, Toast.Style.Success)
    assert.equal(host.lastToast().title, '已共享 2 个文件')
    const fileRows = view.items().filter((i) => String(i.props.id).startsWith('lan-file-'))
    assert.deepEqual(fileRows.map((i) => i.props.title), ['inner.txt', 'dropped.txt'])
    view.unmount()
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('Ctrl+V 粘贴文件、文件夹与剪贴板截图：展开文件夹内的文件逐个加入共享列表（不把文件夹本身加入）', async () => {
  const tmp = makeTempTree({ 'SharedFolder.v2/doc.pdf': 'pdf', 'SharedFolder.v2/photo.png': 'png' })
  try {
    const folder = path.join(tmp, 'SharedFolder.v2')
    const f1 = path.join(folder, 'doc.pdf')
    const f2 = path.join(folder, 'photo.png')
    installLanHost(host, { existing: ['D:\\Share\\screenshot.png', f1, f2] })
    await installDirectoryHost(host, { authorized: [tmp] })

    const view = await mount(LanShareCommand)
    await tick(20)

    assert.equal(view.tree().props.fileInput?.allowClipboardImage, true)
    assert.equal(view.tree().props.fileInput?.allowDirectories, true)

    await view.pasteFiles(['D:\\Share\\screenshot.png', folder], { directories: [folder] })
    await tick(35)

    assert.deepEqual(dllCalls('addFiles')[0][1].params, {
      paths: [f1, f2, 'D:\\Share\\screenshot.png']
    })
    assert.equal(host.lastToast().style, Toast.Style.Success)
    assert.equal(host.lastToast().title, '已共享 3 个文件')
    const fileRows = view.items().filter((i) => String(i.props.id).startsWith('lan-file-'))
    assert.deepEqual(fileRows.map((i) => i.props.title), ['doc.pdf', 'photo.png', 'screenshot.png'])
    assert.equal(fileRows.some((i) => i.props.title === 'SharedFolder.v2'), false, '不再把文件夹本身加入共享列表')
    view.unmount()
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
