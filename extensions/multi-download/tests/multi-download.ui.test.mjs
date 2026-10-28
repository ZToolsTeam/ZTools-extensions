// 界面集成测试：用真实声明式运行时渲染 dist/，模拟客户端 IPC 与本机 aria2，验证勾选、确认、下载动作与非客户端空状态
import test from 'node:test'
import assert from 'node:assert/strict'
import { Color } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import MultiDownloadCommand from '../dist/index.js'

const DOWNLOADS = 'C:\\Users\\RealUser\\Downloads'

function installClient(host, { clipboard = '', disk = { total: 500, used: 100, available: 400 } } = {}) {
  host.ipc.system_get_path = async ({ name }) => (name === 'downloads' ? DOWNLOADS : `C:\\Users\\RealUser\\${name}`)
  host.ipc.system_search_files = async () => ({
    files: [
      { name: 'a.zip', path: `${DOWNLOADS}\\a.zip`, is_dir: false, size: 3000, mtime: 1710000300 },
      { name: 'b.iso', path: `${DOWNLOADS}\\b.iso`, is_dir: false, size: 2000, mtime: 1710000200 },
      { name: 'c.pdf', path: `${DOWNLOADS}\\c.pdf`, is_dir: false, size: 1000, mtime: 1710000100 }
    ],
    total_matches: 3
  })
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
const fileItem = (view, name) => view.item((it) => it.props.title === name)

test('multi-download UI: 扫描后不自动勾选，没有勾选时不提供移入回收站，磁盘不足 10% 时红色提示', async () => {
  await withAria2Offline(async () => {
    const { view } = await mountClient({ disk: { total: 1000, used: 950, available: 50 } })
    const files = view.items().filter((it) => String(it.props.id).startsWith('dl-file-'))
    assert.equal(files.length, 3)
    assert.ok(files.every((it) => it.props.checked === false), '扫描后不能默认勾选任何文件')

    const titles = view.actions(fileItem(view, 'a.zip')).map((a) => a.props.title)
    assert.deepEqual(titles.slice(0, 2), ['用默认程序打开', '在资源管理器中显示'])
    assert.ok(!titles.some((t) => t.includes('回收站')))

    const link = view.item('nav-dl-link')
    const warn = link.props.accessories.find((a) => a.tag && /不足 10%/.test(a.tag.value))
    assert.ok(warn, '剩余空间不足 10% 时要有提示')
    assert.equal(warn.tag.color, Color.Red)
    assert.match(view.tree().props.filterBar.summaryText, /未连接 aria2.*剩余.*不足 10%/)
    assert.equal(/[\u{1F300}-\u{1FAFF}]/u.test(view.text()), false)
    view.unmount()
  })
})

test('multi-download UI: 移入回收站必须确认；取消时不处理，确认后只处理已勾选项并如实报告失败', async () => {
  await withAria2Offline(async () => {
    const { host, view } = await mountClient()
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
    assert.deepEqual(trashed, [`${DOWNLOADS}\\a.zip`], '未勾选的 c.pdf 不受影响')
    assert.match(String(host.lastToast().title), /已将 1 个文件移入回收站.*1 个失败.*b\.iso.*文件被占用/)
    view.unmount()
  })
})

test('multi-download UI: 没有 aria2 时 HTTP 链接经保存对话框单连接下载，磁力链接如实报错', async () => {
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
    assert.equal(view.items().filter((it) => String(it.props.id).startsWith('dl-file-')).length, 0)
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
