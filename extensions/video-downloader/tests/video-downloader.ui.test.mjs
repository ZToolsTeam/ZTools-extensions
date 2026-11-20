// 界面集成测试：用真实声明式运行时渲染 dist/，验证零启动扫描、选择文件/文件夹、拖放展开、移除清空、下载入列与非客户端空状态
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHost, installDirectoryHost, mount, tick } from '../../shared/test-harness.mjs'
import VideoDownloaderCommand from '../dist/index.js'

const VIDEOS = 'C:\\Users\\RealUser\\Videos'

function makeTempTree(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-vd-'))
  for (const [rel, content] of Object.entries(spec)) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return root
}

function installClient(host, { clipboard = '' } = {}) {
  host.ipc.system_get_path = async ({ name }) => (name === 'videos' ? VIDEOS : `C:\\Users\\RealUser\\${name}`)
  host.ipc.clipboard_read_text = async () => clipboard
}

async function mountClient(options) {
  const host = createHost()
  installClient(host, options)
  const view = await mount(VideoDownloaderCommand, host)
  await tick(20)
  return { host, view }
}

const ipcCount = (host, method) => host.ipcCalls.filter(([m]) => m === method).length
const videoItems = (view) => view.items().filter((it) => String(it.props.id).startsWith('vid-item-'))
const videoItem = (view, name) => view.item((it) => it.props.title === name)

async function clickFilterBar(view, id) {
  const action = view.tree().props.filterBar.actions.find((a) => a.id === id)
  assert.ok(action, `顶栏缺少按钮 ${id}`)
  await action.onAction()
  await tick(25)
}

test('video-downloader UI: 挂载时不扫描目录，列表为空，顶栏恰为 2 个按钮，左侧导航无多余进度条', async () => {
  const { host, view } = await mountClient()
  assert.equal(videoItems(view).length, 0)
  assert.equal(ipcCount(host, 'system_search_files'), 0)
  assert.equal(ipcCount(host, 'system_list_common_folders'), 0)
  assert.equal(ipcCount(host, 'filesystem_get_directory_contents'), 0)
  assert.equal(ipcCount(host, 'dllplugin_call'), 0)

  const filterActions = view.tree().props.filterBar.actions
  assert.deepEqual(
    filterActions.map((a) => [a.id, a.title]),
    [['pick-files', '选择文件'], ['pick-folder', '选择文件夹']]
  )
  assert.match(view.tree().props.filterBar.summaryText, /尚未添加文件/)

  const rootActionTitles = view.actions(null).map((a) => a.props.title)
  assert.deepEqual(rootActionTitles.slice(0, 2), ['选择文件…', '选择文件夹…'])

  const navItems = view.items().filter((it) => String(it.props.id).startsWith('nav-'))
  assert.ok(navItems.length > 0)
  for (const nav of navItems) {
    assert.ok(!(nav.props.accessories || []).some((a) => 'progress' in a), `${nav.props.id} 不应显示无含义的进度条`)
  }
  assert.equal(/[\u{1F300}-\u{1FAFF}]/u.test(view.text()), false)
  view.unmount()
})

test('video-downloader UI: 选择文件导入视频，支持去重、取消与宿主错误提示，导入后不默认勾选', async () => {
  const tmp = makeTempTree({ 'a.mp4': 'video-a', 'b.mkv': 'video-b', 'note.txt': 'ignored' })
  try {
    const { host, view } = await mountClient()
    const pickedA = path.join(tmp, 'a.mp4')
    const pickedB = path.join(tmp, 'b.mkv')
    host.ipc.filesystem_get_file_size = async ({ path: p }) => ({ success: true, size: fs.statSync(p).size })

    host.ipc.window_show_open_dialog = async (params) => {
      assert.match(params.filters, /mp4/)
      return { canceled: false, filePaths: [pickedA, pickedB, path.join(tmp, 'note.txt')] }
    }
    await clickFilterBar(view, 'pick-files')
    assert.deepEqual(videoItems(view).map((i) => i.props.title), ['a.mp4', 'b.mkv'])
    assert.ok(videoItems(view).every((i) => i.props.checked === false), '导入后不能默认勾选')
    assert.match(String(host.lastToast().title), /已添加 2 个文件/)
    assert.match(view.tree().props.filterBar.summaryText, /清空列表 Ctrl\+Shift\+Backspace/)

    // 重复导入同一文件应去重
    host.ipc.window_show_open_dialog = async () => ({ canceled: false, filePaths: [pickedA] })
    await clickFilterBar(view, 'pick-files')
    assert.equal(videoItems(view).length, 2)
    assert.equal(host.lastToast().title, '这些文件已在列表中')

    // 取消选择不弹错误
    const toastBeforeCancel = host.toasts.length
    host.ipc.window_show_open_dialog = async () => ({ canceled: true })
    await clickFilterBar(view, 'pick-files')
    assert.equal(host.toasts.length, toastBeforeCancel)

    // 宿主 capability 超限给出友好提示
    host.ipc.window_show_open_dialog = async () => {
      throw new Error('当前窗口的文件 capability 数量超过上限')
    }
    await clickFilterBar(view, 'pick-files')
    assert.equal(String(host.lastToast().style).toLowerCase(), 'failure')
    assert.match(String(host.lastToast().message), /改用「选择文件夹」/)
    view.unmount()
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('video-downloader UI: 选择文件夹递归导入视频、过滤非视频文件、支持整盘确认、从列表移除与清空（不删文件）', async () => {
  const tmp = makeTempTree({
    'clip1.mp4': '1111',
    'sub/clip2.ts': '2222',
    'sub/.hidden.mp4': 'hidden',
    'sub/empty.mp4': '',
    'sub/readme.md': 'text'
  })
  try {
    const { host, view } = await mountClient()
    await installDirectoryHost(host, { authorized: [tmp] })

    // 整盘根目录取消时不读取目录
    host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: 'D:\\' })
    host.setConfirm(false)
    await clickFilterBar(view, 'pick-folder')
    assert.equal(host.confirms.length, 1)
    assert.equal(ipcCount(host, 'filesystem_get_directory_contents'), 0)

    // 正常文件夹只调用 window_show_select_folder_dialog，不走 open_dialog
    host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: tmp })
    await clickFilterBar(view, 'pick-folder')
    assert.equal(ipcCount(host, 'window_show_open_dialog'), 0)
    assert.deepEqual(videoItems(view).map((i) => i.props.title), ['clip1.mp4', 'clip2.ts'])
    assert.match(String(host.lastToast().title), /已添加 2 个文件/)

    // 从列表移除不调用 shell_trash_item
    await view.run(videoItem(view, 'clip1.mp4'), '从列表移除')
    assert.deepEqual(videoItems(view).map((i) => i.props.title), ['clip2.ts'])
    assert.equal(ipcCount(host, 'shell_trash_item'), 0)

    // 清空列表不调用 shell_trash_item
    await view.run(videoItem(view, 'clip2.ts'), '清空列表')
    assert.equal(videoItems(view).length, 0)
    assert.equal(ipcCount(host, 'shell_trash_item'), 0)
    view.unmount()
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('video-downloader UI: 拖放名称带点的文件夹自动展开（含新版 directories 与旧版探测回退）', async () => {
  const tmp = makeTempTree({
    'v1.2_clips/one.mov': 'movdata',
    'legacy_dir/two.flv': 'flvdata'
  })
  const dottedDir = path.join(tmp, 'v1.2_clips')
  const legacyDir = path.join(tmp, 'legacy_dir')
  try {
    const { host, view } = await mountClient()
    await installDirectoryHost(host, { authorized: [tmp] })
    host.ipc.filesystem_directory_exists = async ({ path: p }) => ({
      success: true,
      exists: fs.existsSync(p) && fs.statSync(p).isDirectory()
    })

    // 新版宿主透传 directories，不再逐个调用 filesystem_directory_exists
    await view.dropFiles([dottedDir], { directories: [dottedDir] })
    await tick(25)
    assert.deepEqual(videoItems(view).map((i) => i.props.title), ['one.mov'])
    assert.equal(ipcCount(host, 'filesystem_directory_exists'), 0)

    // 旧版宿主不传 directories，走 filesystem_directory_exists 探测展开
    await view.dropFiles([legacyDir])
    await tick(25)
    assert.deepEqual(videoItems(view).map((i) => i.props.title), ['one.mov', 'two.flv'])
    assert.equal(ipcCount(host, 'filesystem_directory_exists'), 1)
    view.unmount()
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('video-downloader UI: 导入进行中清空列表则丢弃过期导入结果，不弹完成提示', async () => {
  const tmp = makeTempTree({ 'slow.mp4': 'slow' })
  try {
    const { host, view } = await mountClient()
    let releaseDir
    const gate = new Promise((r) => (releaseDir = r))
    host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: tmp })
    host.ipc.filesystem_get_directory_contents = async () => {
      await gate
      return {
        success: true,
        files: [{ name: 'slow.mp4', size: 4, isDirectory: false, lastModified: new Date().toISOString() }]
      }
    }

    const pickAction = view.tree().props.filterBar.actions.find((a) => a.id === 'pick-folder')
    const importPromise = pickAction.onAction()
    await tick(10)
    assert.match(view.tree().props.filterBar.summaryText, /正在导入/)

    // 导入进行中触发清空（从根动作或空状态执行清空）
    await view.run(view.item('nav-current-link'), '选择文件夹…').catch(() => {})
    // 先放行慢目录前，直接用另一条已有项测试或测试清空：先加入一个条目再测竞态清空
    releaseDir()
    await importPromise
    await tick(20)
    assert.equal(videoItems(view).length, 1)

    // 现列表中已有 1 项，再次慢速导入并在完成前通过该列表项执行「清空列表」
    let releaseSecond
    const gateSecond = new Promise((r) => (releaseSecond = r))
    const tmp2 = makeTempTree({ 'late.mp4': 'late' })
    try {
      host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: tmp2 })
      host.ipc.filesystem_get_directory_contents = async () => {
        await gateSecond
        return {
          success: true,
          files: [{ name: 'late.mp4', size: 4, isDirectory: false, lastModified: new Date().toISOString() }]
        }
      }
      host.toasts.length = 0
      pickAction.onAction()
      await tick(10)
      await view.run(videoItem(view, 'slow.mp4'), '清空列表')
      assert.equal(videoItems(view).length, 0)
      const toastCountAfterClear = host.toasts.length
      releaseSecond()
      await tick(30)
      assert.equal(videoItems(view).length, 0, '清空后过期批次的导入结果必须被丢弃')
      assert.equal(host.toasts.length, toastCountAfterClear, '被取消批次不能再弹导入提示')
    } finally {
      fs.rmSync(tmp2, { recursive: true, force: true })
    }
    view.unmount()
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('video-downloader UI: 移入回收站必须确认；取消不处理，确认后只移走已勾选项并保留失败项，不重扫目录', async () => {
  const { host, view } = await mountClient()
  host.ipc.filesystem_get_file_size = async () => ({ success: true, size: 2048 })
  host.ipc.window_show_open_dialog = async () => ({
    canceled: false,
    filePaths: [`${VIDEOS}\\a.mp4`, `${VIDEOS}\\b.mp4`, `${VIDEOS}\\c.mkv`]
  })
  await clickFilterBar(view, 'pick-files')

  const trashed = []
  host.ipc.shell_trash_item = async ({ fullPath }) => {
    if (fullPath.endsWith('b.mp4')) throw Object.assign(new Error('文件被占用'), { code: 'SHELL_ERROR' })
    trashed.push(fullPath)
    return { success: true }
  }

  videoItem(view, 'a.mp4').props.onCheckChange(true)
  videoItem(view, 'b.mp4').props.onCheckChange(true)
  await tick()

  const trashTitle = (node) => view.actions(node).find((a) => a.props.title.startsWith('移入回收站')).props.title

  host.setConfirm(false)
  await view.run(videoItem(view, 'c.mkv'), trashTitle(videoItem(view, 'c.mkv')))
  assert.equal(host.confirms.length, 1)
  assert.equal(host.confirms[0].primaryAction.style, 'destructive')
  assert.match(host.confirms[0].title, /2 个视频/)
  assert.equal(ipcCount(host, 'shell_trash_item'), 0)

  host.setConfirm(true)
  await view.run(videoItem(view, 'c.mkv'), trashTitle(videoItem(view, 'c.mkv')))
  await tick(20)
  assert.deepEqual(trashed, [`${VIDEOS}\\a.mp4`])
  assert.equal(ipcCount(host, 'system_search_files'), 0, '移入回收站后不得触发目录扫描')
  // a.mp4 已从列表移除，失败的 b.mp4 保留并保持勾选，未选的 c.mkv 保留未勾选
  assert.deepEqual(videoItems(view).map((i) => i.props.title), ['b.mp4', 'c.mkv'])
  assert.equal(videoItem(view, 'b.mp4').props.checked, true)
  assert.equal(videoItem(view, 'c.mkv').props.checked, false)
  const toast = host.lastToast()
  assert.match(String(toast.title), /已将 1 个视频移入回收站/)
  assert.match(String(toast.title), /1 个失败.*b\.mp4.*文件被占用/)
  view.unmount()
})

test('video-downloader UI: 平台链接主动作是复制 yt-dlp 命令，不弹保存框也不发下载请求', async () => {
  const { host, view } = await mountClient({ clipboard: 'https://www.bilibili.com/video/BV1xx411c7mD' })
  host.ipc.clipboard_copy_text = async ({ text }) => {
    host.clipboard.text = text
    return { success: true }
  }
  const nav = view.item('nav-current-link')
  const primary = view.actions(nav)[0].props.title
  assert.match(primary, /复制 yt-dlp 命令/)
  await view.run(nav, primary)
  assert.match(host.clipboard.text, /^yt-dlp .*bilibili\.com\/video\/BV1xx411c7mD"$/)
  assert.match(String(host.lastToast().title), /插件不会下载该链接/)
  assert.equal(ipcCount(host, 'window_show_save_dialog'), 0)
  assert.equal(ipcCount(host, 'network_http_download'), 0)
  assert.equal(ipcCount(host, 'dllplugin_call'), 0)
  view.unmount()
})

test('video-downloader UI: 直链下载成功后将输出文件追加进右栏列表，下载进行中拒绝清空列表', async () => {
  const { host, view } = await mountClient()
  host.ipc.window_show_save_dialog = async () => ({ canceled: false, filePath: `${VIDEOS}\\clip.mp4` })
  host.ipc.network_http_download = async () => {
    throw Object.assign(new Error('下载文件超过 1 GiB 上限'), { code: 'RESPONSE_TOO_LARGE' })
  }
  await view.search('https://cdn.example.com/clip.mp4')
  const nav = view.item('nav-current-link')
  assert.equal(view.actions(nav)[0].props.title, '下载视频直链')
  await view.run(nav, '下载视频直链')
  await tick(10)
  assert.equal(String(host.lastToast().style).toLowerCase(), 'failure')
  assert.match(String(host.lastToast().title), /下载失败.*1 GiB/)
  assert.equal(videoItems(view).length, 0)

  let releaseDl
  const dlGate = new Promise((r) => (releaseDl = r))
  host.ipc.network_http_download = async ({ savePath }) => {
    await dlGate
    return { success: true, path: savePath, size: 2048 }
  }
  const dlPromise = view.run(view.item('nav-current-link'), '下载视频直链')
  await tick(10)

  // 下载先完成一次，再入列验证下载中清空拒绝
  releaseDl()
  await dlPromise
  await tick(10)
  assert.equal(String(host.lastToast().style).toLowerCase(), 'success')
  assert.match(String(host.lastToast().title), /已下载到 .*clip\.mp4/)
  assert.deepEqual(videoItems(view).map((i) => i.props.title), ['clip.mp4'])
  assert.equal(videoItem(view, 'clip.mp4').props.checked, false)
  assert.ok(videoItem(view, 'clip.mp4').props.accessories.some((a) => a.tag?.value === '本次下载'))

  // 再次发起耗时下载，在下载过程中尝试清空列表，必须被拒绝
  let releaseSecondDl
  const dlGate2 = new Promise((r) => (releaseSecondDl = r))
  host.ipc.window_show_save_dialog = async () => ({ canceled: false, filePath: `${VIDEOS}\\clip2.mp4` })
  host.ipc.network_http_download = async ({ savePath }) => {
    await dlGate2
    return { success: true, path: savePath, size: 4096 }
  }
  const dlPromise2 = view.run(view.item('nav-current-link'), '下载视频直链')
  await tick(10)
  await view.run(videoItem(view, 'clip.mp4'), '清空列表')
  assert.equal(host.lastToast().title, '正在处理，完成后再清空')
  assert.equal(videoItems(view).length, 1)
  releaseSecondDl()
  await dlPromise2
  await tick(10)
  assert.deepEqual(videoItems(view).map((i) => i.props.title), ['clip.mp4', 'clip2.mp4'])
  view.unmount()
})

test('video-downloader UI: 不在客户端里运行时只显示空状态，不显示示例视频', async () => {
  const host = createHost()
  const saved = globalThis.__ztoolsElectron
  delete globalThis.__ztoolsElectron
  try {
    const view = await mount(VideoDownloaderCommand, host)
    await tick(10)
    const text = view.text()
    assert.match(text, /需要在 ZTools 客户端中使用/)
    assert.equal(videoItems(view).length, 0)
    assert.doesNotMatch(text, /Bilibili_4K60|Douyin_1080P|C:\\\\Users\\\\Default/)
    view.unmount()
  } finally {
    globalThis.__ztoolsElectron = saved
  }
})

test('video-downloader: 客户端提供带插件身份的通道时，下载请求把超时放宽到 5 分钟', async () => {
  const { getDeclarativeBridge, setDeclarativeBridge } = await import('@ztools/declarative-ui')
  const { downloadDirectVideo, DIRECT_DOWNLOAD_TIMEOUT_MS } = await import('../dist/logic.js')
  const host = createHost()
  host.ipc.window_show_save_dialog = async () => ({ canceled: false, filePath: `${VIDEOS}\\a.mp4` })
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
  const res = await downloadDirectVideo('https://cdn.example.com/a.mp4', VIDEOS)
  assert.equal(res.ok, true)
  assert.equal(DIRECT_DOWNLOAD_TIMEOUT_MS, 300000)
  assert.deepEqual(transportCalls, [
    {
      method: 'network_http_download',
      params: { url: 'https://cdn.example.com/a.mp4', savePath: `${VIDEOS}\\a.mp4` },
      options: { timeoutMs: 300000 }
    }
  ])
  assert.equal(ipcCount(host, 'network_http_download'), 0)

  setDeclarativeBridge({
    ...getDeclarativeBridge(),
    hostTransport: {
      async call() {
        throw Object.assign(new Error('文件传输已取消'), { code: 'REQUEST_TIMEOUT' })
      }
    }
  })
  const timeout = await downloadDirectVideo('https://cdn.example.com/a.mp4', VIDEOS)
  assert.equal(timeout.ok, false)
  assert.match(timeout.message, /下载失败.*文件传输已取消/)
})
