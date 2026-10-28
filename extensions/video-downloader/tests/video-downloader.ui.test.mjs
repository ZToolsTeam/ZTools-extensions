// 界面集成测试：用真实声明式运行时渲染 dist/，模拟客户端 IPC，验证勾选、确认、链接动作与非客户端空状态
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import VideoDownloaderCommand from '../dist/index.js'

const VIDEOS = 'C:\\Users\\RealUser\\Videos'

function installClient(host, { clipboard = '' } = {}) {
  host.ipc.system_get_path = async ({ name }) => (name === 'videos' ? VIDEOS : `C:\\Users\\RealUser\\${name}`)
  host.ipc.system_search_files = async ({ query }) =>
    String(query).includes('Videos')
      ? {
          files: [
            { name: 'a.mp4', path: `${VIDEOS}\\a.mp4`, is_dir: false, size: 30 * 1024 * 1024, mtime: 1710000300 },
            { name: 'b.mp4', path: `${VIDEOS}\\b.mp4`, is_dir: false, size: 20 * 1024 * 1024, mtime: 1710000200 },
            { name: 'c.mkv', path: `${VIDEOS}\\c.mkv`, is_dir: false, size: 10 * 1024 * 1024, mtime: 1710000100 }
          ],
          total_matches: 3
        }
      : { files: [], total_matches: 0 }
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
const videoItem = (view, name) => view.item((it) => it.props.title === name)

test('video-downloader UI: 扫描后不自动勾选，没有勾选时不提供移入回收站，左侧导航没有凑出来的进度条', async () => {
  const { view } = await mountClient()
  const items = view.items()
  const videos = items.filter((it) => String(it.props.id).startsWith('vid-item-'))
  assert.equal(videos.length, 3)
  assert.ok(videos.every((it) => it.props.checked === false), '扫描后不能默认勾选任何视频')

  const navItems = items.filter((it) => String(it.props.id).startsWith('nav-'))
  assert.ok(navItems.length > 0)
  for (const nav of navItems) {
    assert.ok(!(nav.props.accessories || []).some((a) => 'progress' in a), `${nav.props.id} 不应显示无含义的进度条`)
  }

  const titles = view.actions(videoItem(view, 'a.mp4')).map((a) => a.props.title)
  assert.deepEqual(titles.slice(0, 2), ['用默认程序打开', '在资源管理器中显示'])
  assert.ok(!titles.some((t) => t.includes('回收站')), '没有勾选时不能出现移入回收站动作')
  assert.equal(/[\u{1F300}-\u{1FAFF}]/u.test(view.text()), false)
  view.unmount()
})

test('video-downloader UI: 移入回收站必须确认；取消时不处理，确认后只处理已勾选项并如实报告失败', async () => {
  const { host, view } = await mountClient()
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
  assert.equal(ipcCount(host, 'shell_trash_item'), 0, '用户取消后不能移入回收站')

  host.setConfirm(true)
  await view.run(videoItem(view, 'c.mkv'), trashTitle(videoItem(view, 'c.mkv')))
  await tick(20)
  assert.deepEqual(trashed, [`${VIDEOS}\\a.mp4`], '只处理已勾选的视频，未勾选的 c.mkv 不受影响')
  assert.equal(ipcCount(host, 'shell_trash_item'), 2)
  const toast = host.lastToast()
  assert.match(String(toast.title), /已将 1 个视频移入回收站/)
  assert.match(String(toast.title), /1 个失败.*b\.mp4.*文件被占用/)
  view.unmount()
})

test('video-downloader UI: 平台链接的主动作是复制 yt-dlp 命令，不弹保存框也不发下载请求', async () => {
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

test('video-downloader UI: 搜索框里的视频直链走保存对话框和客户端下载，失败时提示失败', async () => {
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
  assert.equal(ipcCount(host, 'window_show_save_dialog'), 1)
  assert.equal(String(host.lastToast().style).toLowerCase(), 'failure')
  assert.match(String(host.lastToast().title), /下载失败.*1 GiB/)

  host.ipc.network_http_download = async ({ savePath }) => ({ success: true, path: savePath, size: 2048 })
  await view.run(view.item('nav-current-link'), '下载视频直链')
  await tick(10)
  assert.equal(String(host.lastToast().style).toLowerCase(), 'success')
  assert.match(String(host.lastToast().title), /已下载到 .*clip\.mp4/)
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
    assert.equal(view.items().filter((it) => String(it.props.id).startsWith('vid-item-')).length, 0)
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
