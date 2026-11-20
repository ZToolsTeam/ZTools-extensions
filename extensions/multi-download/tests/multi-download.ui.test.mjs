// 界面集成测试：用真实声明式运行时渲染 dist/，模拟客户端 IPC 与本机 aria2，验证零扫描、导入展开、移除清空、下载入列与非客户端空状态
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Color } from '@ztools/declarative-ui'
import { createHost, installDirectoryHost, mount, tick } from '../../shared/test-harness.mjs'
import MultiDownloadCommand from '../dist/index.js'

const DOWNLOADS = 'C:\\Users\\RealUser\\Downloads'

function makeTempTree(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-md-'))
  for (const [rel, content] of Object.entries(spec)) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return root
}

function installClient(host, { clipboard = '', disk = { total: 500, used: 100, available: 400 } } = {}) {
  host.ipc.system_get_path = async ({ name }) => (name === 'downloads' ? DOWNLOADS : `C:\\Users\\RealUser\\${name}`)
  host.ipc.system_get_disk_usage = async () => disk
  host.ipc.clipboard_read_text = async () => clipboard
}

/** 让组件里的 aria2 请求连不上（与本机没有运行 aria2 时一致） */
async function withAria2Offline(fn) {
  const original = globalThis.fetch
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed')
  }
  try {
    return await fn()
  } finally {
    globalThis.fetch = original
  }
}

async function mountClient(options) {
  const host = createHost()
  installClient(host, options)
  const view = await mount(MultiDownloadCommand, host)
  await tick(20)
  return { host, view }
}

const ipcCount = (host, method) => host.ipcCalls.filter(([m]) => m === method).length
const dlFiles = (view) => view.items().filter((it) => String(it.props.id).startsWith('dl-file-'))
const fileItem = (view, name) => view.item((it) => it.props.title === name)

async function clickFilterBar(view, id) {
  const action = view.tree().props.filterBar.actions.find((a) => a.id === id)
  assert.ok(action, `顶栏缺少按钮 ${id}`)
  await action.onAction()
  await tick(25)
}

test('multi-download UI: 挂载时不扫描目录，列表为空，顶栏恰为 2 个按钮，磁盘不足 10% 时红色提示', async () => {
  await withAria2Offline(async () => {
    const { host, view } = await mountClient({ disk: { total: 1000, used: 950, available: 50 } })
    assert.equal(dlFiles(view).length, 0)
    assert.equal(ipcCount(host, 'system_search_files'), 0)
    assert.equal(ipcCount(host, 'system_list_common_folders'), 0)
    assert.equal(ipcCount(host, 'filesystem_get_directory_contents'), 0)
    assert.equal(ipcCount(host, 'dllplugin_call'), 0)

    const filterActions = view.tree().props.filterBar.actions
    assert.deepEqual(
      filterActions.map((a) => [a.id, a.title]),
      [['pick-files', '选择文件'], ['pick-folder', '选择文件夹']]
    )
    assert.deepEqual(view.actions(null).slice(0, 2).map((a) => a.props.title), ['选择文件…', '选择文件夹…'])

    const link = view.item('nav-dl-link')
    const warn = link.props.accessories.find((a) => a.tag && /不足 10%/.test(a.tag.value))
    assert.ok(warn, '剩余空间不足 10% 时要有提示')
    assert.equal(warn.tag.color, Color.Red)
    assert.match(view.tree().props.filterBar.summaryText, /未连接 aria2.*剩余.*不足 10%.*尚未添加文件/)
    assert.equal(/[\u{1F300}-\u{1FAFF}]/u.test(view.text()), false)
    view.unmount()
  })
})

test('multi-download UI: 选择文件与选择文件夹导入任意非隐藏文件并分类，支持移除、清空与整盘确认', async () => {
  const tmp = makeTempTree({
    'a.zip': 'zipdata',
    'sub/b.iso': 'isodata',
    'sub/c.pdf': 'pdfdata',
    'sub/.hidden.zip': 'hidden',
    'sub/empty.txt': ''
  })
  await withAria2Offline(async () => {
    try {
      const { host, view } = await mountClient()
      await installDirectoryHost(host, { authorized: [tmp] })
      host.ipc.filesystem_get_file_size = async ({ path: p }) => ({ success: true, size: fs.statSync(p).size })

      // 选择文件（含重复与取消）
      host.ipc.window_show_open_dialog = async (params) => {
        assert.equal('filters' in params, false, '任意文件导入不传过滤串')
        return { canceled: false, filePaths: [path.join(tmp, 'a.zip')] }
      }
      await clickFilterBar(view, 'pick-files')
      assert.deepEqual(dlFiles(view).map((i) => i.props.title), ['a.zip'])
      assert.ok(dlFiles(view).every((i) => i.props.checked === false))
      assert.match(view.tree().props.filterBar.summaryText, /清空列表 Ctrl\+Shift\+Backspace/)

      // 整盘确认取消
      host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: 'D:\\' })
      host.setConfirm(false)
      await clickFilterBar(view, 'pick-folder')
      assert.equal(host.confirms.length, 1)
      assert.equal(ipcCount(host, 'filesystem_get_directory_contents'), 0)

      // 选择文件夹（去重 a.zip，新增 b.iso / c.pdf，过滤隐藏与空文件）
      host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: tmp })
      await clickFilterBar(view, 'pick-folder')
      assert.deepEqual(dlFiles(view).map((i) => i.props.title), ['a.zip', 'b.iso', 'c.pdf'])
      assert.match(String(host.lastToast().title), /已添加 2 个文件/)
      assert.match(String(host.lastToast().message), /1 个已在列表中/)

      // 左栏分类筛选
      await view.run(view.item('nav-dl-iso_image'), '只看系统镜像与模型')
      assert.deepEqual(dlFiles(view).map((i) => i.props.title), ['b.iso'])
      await view.run(view.item('nav-dl-all'), '查看全部文件')
      assert.equal(dlFiles(view).length, 3)

      // 从列表移除不删文件
      await view.run(fileItem(view, 'a.zip'), '从列表移除')
      assert.deepEqual(dlFiles(view).map((i) => i.props.title), ['b.iso', 'c.pdf'])
      assert.equal(ipcCount(host, 'shell_trash_item'), 0)

      // 清空列表不删文件
      await view.run(fileItem(view, 'b.iso'), '清空列表')
      assert.equal(dlFiles(view).length, 0)
      assert.equal(ipcCount(host, 'shell_trash_item'), 0)
      view.unmount()
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

test('multi-download UI: 拖放名称带点的文件夹自动展开（新版 directories、旧版探测及旧事件回退）', async () => {
  const tmp = makeTempTree({
    'v2.1_pkgs/app.exe': 'exedata',
    'legacy_dir/doc.md': 'mddata'
  })
  const dotted = path.join(tmp, 'v2.1_pkgs')
  const legacy = path.join(tmp, 'legacy_dir')
  await withAria2Offline(async () => {
    try {
      const { host, view } = await mountClient()
      await installDirectoryHost(host, { authorized: [tmp] })
      host.ipc.filesystem_directory_exists = async ({ path: p }) => ({
        success: true,
        exists: fs.existsSync(p) && fs.statSync(p).isDirectory()
      })

      await view.dropFiles([dotted], { directories: [dotted] })
      await tick(25)
      assert.deepEqual(dlFiles(view).map((i) => i.props.title), ['app.exe'])
      assert.equal(ipcCount(host, 'filesystem_directory_exists'), 0)

      await view.dropFiles([legacy])
      await tick(25)
      assert.deepEqual(dlFiles(view).map((i) => i.props.title), ['app.exe', 'doc.md'])
      assert.equal(ipcCount(host, 'filesystem_directory_exists'), 1)
      view.unmount()

      // 旧版客户端事件回退（fileInput: false）
      const listeners = []
      const host2 = createHost()
      installClient(host2)
      globalThis.window.__ztoolsDeclarativeFeatures = { fileInput: false }
      globalThis.window.ztools = {
        ...(globalThis.window.ztools || {}),
        events: {
          on(ev, cb) {
            if (ev === 'plugin_files_dropped') listeners.push(cb)
            return () => {}
          }
        }
      }
      await installDirectoryHost(host2, { authorized: [tmp] })
      host2.ipc.filesystem_directory_exists = async ({ path: p }) => ({
        success: true,
        exists: fs.existsSync(p) && fs.statSync(p).isDirectory()
      })
      const view2 = await mount(MultiDownloadCommand, host2)
      await tick(20)
      listeners[0]({ payload: { files: [dotted] } })
      await tick(30)
      assert.deepEqual(dlFiles(view2).map((i) => i.props.title), ['app.exe'])
      view2.unmount()
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

test('multi-download UI: 导入进行中清空列表则丢弃结果；移入回收站后直接移除成功项', async () => {
  const tmp = makeTempTree({ 'a.zip': 'zip', 'b.iso': 'iso', 'c.pdf': 'pdf' })
  await withAria2Offline(async () => {
    try {
      const { host, view } = await mountClient()
      host.ipc.filesystem_get_file_size = async () => ({ success: true, size: 1024 })
      host.ipc.window_show_open_dialog = async () => ({
        canceled: false,
        filePaths: [path.join(tmp, 'a.zip'), path.join(tmp, 'b.iso'), path.join(tmp, 'c.pdf')]
      })
      await clickFilterBar(view, 'pick-files')

      // 导入进行中清空列表 -> 丢弃结果、不弹提示
      let releaseSlow
      const slowGate = new Promise((r) => (releaseSlow = r))
      host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: tmp })
      host.ipc.filesystem_get_directory_contents = async () => {
        await slowGate
        return {
          success: true,
          files: [{ name: 'late.zip', size: 100, isDirectory: false, lastModified: new Date().toISOString() }]
        }
      }
      host.toasts.length = 0
      const pickFolderBtn = view.tree().props.filterBar.actions.find((a) => a.id === 'pick-folder')
      pickFolderBtn.onAction()
      await tick(10)
      assert.match(view.tree().props.filterBar.summaryText, /正在导入/)
      await view.run(fileItem(view, 'a.zip'), '清空列表')
      assert.equal(dlFiles(view).length, 0)
      const countAfterClear = host.toasts.length
      releaseSlow()
      await tick(30)
      assert.equal(dlFiles(view).length, 0)
      assert.equal(host.toasts.length, countAfterClear)

      // 重新导入并验证移入回收站流程
      await clickFilterBar(view, 'pick-files')
      const trashed = []
      host.ipc.shell_trash_item = async ({ fullPath }) => {
        if (fullPath.endsWith('b.iso')) throw Object.assign(new Error('文件被占用'), { code: 'SHELL_ERROR' })
        trashed.push(fullPath)
        return { success: true }
      }
      fileItem(view, 'a.zip').props.onCheckChange(true)
      fileItem(view, 'b.iso').props.onCheckChange(true)
      await tick()
      const trashTitle = (node) => view.actions(node).find((a) => a.props.title.startsWith('移入回收站')).props.title

      host.setConfirm(false)
      await view.run(fileItem(view, 'c.pdf'), trashTitle(fileItem(view, 'c.pdf')))
      assert.equal(host.confirms.length, 1)
      assert.equal(host.confirms[0].primaryAction.style, 'destructive')
      assert.equal(ipcCount(host, 'shell_trash_item'), 0)

      host.setConfirm(true)
      await view.run(fileItem(view, 'c.pdf'), trashTitle(fileItem(view, 'c.pdf')))
      await tick(20)
      assert.deepEqual(trashed, [path.join(tmp, 'a.zip')])
      assert.equal(ipcCount(host, 'system_search_files'), 0)
      assert.deepEqual(dlFiles(view).map((i) => i.props.title), ['b.iso', 'c.pdf'])
      assert.equal(fileItem(view, 'b.iso').props.checked, true)
      assert.match(String(host.lastToast().title), /已将 1 个文件移入回收站.*1 个失败.*b\.iso.*文件被占用/)
      view.unmount()
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

test('multi-download UI: 没有 aria2 时 HTTP 链接单连接下载完成后入列，下载中拒绝清空，磁力链接如实报错', async () => {
  await withAria2Offline(async () => {
    const { host, view } = await mountClient({ clipboard: 'https://example.com/pkg/tool.zip' })
    host.ipc.window_show_save_dialog = async () => ({ canceled: false, filePath: `${DOWNLOADS}\\tool.zip` })
    host.ipc.network_http_download = async ({ savePath }) => ({ success: true, path: savePath, size: 4096 })

    const link = view.item('nav-dl-link')
    assert.equal(view.actions(link)[0].props.title, '下载此链接')
    await view.run(link, '下载此链接')
    await tick(20)
    assert.equal(ipcCount(host, 'window_show_save_dialog'), 1)
    assert.equal(ipcCount(host, 'network_http_download'), 1)
    assert.equal(ipcCount(host, 'dllplugin_call'), 0)
    assert.equal(String(host.lastToast().style).toLowerCase(), 'success')
    assert.match(String(host.lastToast().title), /单连接下载到 .*tool\.zip.*线程档位未生效/)
    assert.deepEqual(dlFiles(view).map((i) => i.props.title), ['tool.zip'])
    assert.equal(fileItem(view, 'tool.zip').props.checked, false)

    // 下载进行中尝试清空列表应拒绝
    let releaseDl
    const dlGate = new Promise((r) => (releaseDl = r))
    host.ipc.window_show_save_dialog = async () => ({ canceled: false, filePath: `${DOWNLOADS}\\tool2.zip` })
    host.ipc.network_http_download = async ({ savePath }) => {
      await dlGate
      return { success: true, path: savePath, size: 8192 }
    }
    await view.search('https://example.com/pkg/tool2.zip')
    const dlPromise = view.run(view.item('nav-dl-link'), '下载此链接')
    await tick(10)
    await view.run(fileItem(view, 'tool.zip'), '清空列表')
    assert.equal(host.lastToast().title, '正在处理，完成后再清空')
    assert.equal(dlFiles(view).length, 1)
    releaseDl()
    await dlPromise
    await tick(15)
    assert.deepEqual(dlFiles(view).map((i) => i.props.title), ['tool.zip', 'tool2.zip'])

    await view.search('magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567')
    await view.run(view.item('nav-dl-link'), '下载此链接')
    await tick(10)
    assert.equal(String(host.lastToast().style).toLowerCase(), 'failure')
    assert.match(String(host.lastToast().title), /磁力链接需要本机运行 aria2/)
    assert.equal(host.clipboard.text, '', '失败时不能自动改写剪贴板')
    view.unmount()
  })
})

test('multi-download UI: 不在客户端里运行时只显示空状态，不显示示例文件', async () => {
  const host = createHost()
  const saved = globalThis.__ztoolsElectron
  delete globalThis.__ztoolsElectron
  try {
    const view = await mount(MultiDownloadCommand, host)
    await tick(10)
    const text = view.text()
    assert.match(text, /需要在 ZTools 客户端中使用/)
    assert.equal(dlFiles(view).length, 0)
    assert.doesNotMatch(text, /ExampleApp-Setup|Windows11_24H2|C:\\\\Users\\\\Default/)
    view.unmount()
  } finally {
    globalThis.__ztoolsElectron = saved
  }
})

test('multi-download: 客户端提供带插件身份的通道时，单连接下载把超时放宽到 5 分钟', async () => {
  const { getDeclarativeBridge, setDeclarativeBridge } = await import('@ztools/declarative-ui')
  const { startMultiThreadDownloadTask, THREAD_SPLIT_PRESETS } = await import('../dist/logic.js')
  const host = createHost()
  host.ipc.window_show_save_dialog = async () => ({ canceled: false, filePath: `${DOWNLOADS}\\a.zip` })
  const transportCalls = []
  setDeclarativeBridge({
    ...getDeclarativeBridge(),
    hostTransport: {
      async call(method, params, options) {
        transportCalls.push({ method, params, options })
        return { success: true, path: params.savePath, size: 1024 }
      }
    }
  })
  const res = await startMultiThreadDownloadTask('https://example.com/a.zip', DOWNLOADS, THREAD_SPLIT_PRESETS[0], undefined, {
    fetchImpl: async () => {
      throw new TypeError('fetch failed')
    }
  })
  assert.equal(res.ok, true)
  assert.deepEqual(transportCalls, [
    {
      method: 'network_http_download',
      params: { url: 'https://example.com/a.zip', savePath: `${DOWNLOADS}\\a.zip` },
      options: { timeoutMs: 300000 }
    }
  ])
  assert.equal(ipcCount(host, 'network_http_download'), 0)
})
