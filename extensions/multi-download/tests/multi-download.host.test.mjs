// 本插件业务逻辑的宿主集成测试：用宿主替身与可注入的 fetch 模拟客户端与本机 aria2，覆盖成功与各类失败路径
import test from 'node:test'
import assert from 'node:assert/strict'
import * as multiDownload from '../dist/logic.js'

function createRealHostStub(handlers = {}) {
  const calls = []
  const dispatch = async (method, params) => {
    calls.push({ channel: method, payload: params })
    if (typeof handlers[method] === 'function') {
      return await handlers[method](params)
    }
    if (method in handlers) {
      return handlers[method]
    }
    throw new Error(`CHANNEL_NOT_IMPLEMENTED: ${method}`)
  }

  const stub = {
    __isRealHost: true,
    calls,
    transport: {
      call: dispatch
    }
  }

  for (const key of Object.keys(handlers)) {
    stub[key] = (params) => dispatch(key, params)
  }

  return stub
}

const called = (host, channel) => host.calls.filter((c) => c.channel === channel)
const preset16 = multiDownload.THREAD_SPLIT_PRESETS[0]

/** 模拟本机 aria2 JSON-RPC：按 method 返回响应体，记录请求 */
function aria2Fetch(responder) {
  const requests = []
  const impl = async (url, init) => {
    const body = JSON.parse(init.body)
    requests.push({ url, body })
    const { status = 200, json } = await responder(body)
    return { ok: status >= 200 && status < 300, status, json: async () => json }
  }
  impl.requests = requests
  return impl
}
const aria2Offline = async () => {
  throw new TypeError('fetch failed: connect ECONNREFUSED 127.0.0.1:6800')
}

test('multi-download: 扫描下载文件夹、读取磁盘空间与 aria2 状态', async () => {
  const host = createRealHostStub({
    system_get_path: () => 'C:\\Users\\RealUser\\Downloads',
    system_search_files: () => ({
      files: [
        { name: 'ubuntu-24.04.iso', path: 'C:\\Users\\RealUser\\Downloads\\ubuntu-24.04.iso', is_dir: false, size: 4096000, mtime: 1710000000 }
      ],
      total_matches: 1,
      total_bytes: 4096000
    }),
    system_get_disk_usage: () => ({ total: 500 * 1024 ** 3, used: 377 * 1024 ** 3, available: 123 * 1024 ** 3, percent: 75 }),
    clipboard_read_text: () => 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567'
  })
  const fetchImpl = aria2Fetch(() => ({ json: { jsonrpc: '2.0', id: 'x', result: { version: '1.37.0' } } }))

  const snap = await multiDownload.fetchMultiDownloadSnapshot(host, { fetchImpl })
  assert.equal(snap.downloadDir, 'C:\\Users\\RealUser\\Downloads')
  assert.equal(snap.driveInfoAvailable, true)
  assert.equal(snap.driveFreeBytes, 123 * 1024 ** 3)
  assert.equal(snap.files.length, 1)
  assert.equal(snap.files[0].category, 'iso_image')
  assert.equal(snap.aria2Status.online, true)
  assert.equal(snap.aria2Status.version, '1.37.0')
  assert.equal(snap.sniffedProtocol, '磁力链接')
  assert.equal(fetchImpl.requests[0].url, 'http://127.0.0.1:6800/jsonrpc')
  assert.equal(fetchImpl.requests[0].body.method, 'aria2.getVersion')
  assert.equal(multiDownload.isDriveLowOnSpace(snap), false)
})

test('multi-download: 磁盘空间读不到时标记为未知，不拿别的盘或 0 冒充；aria2 拒绝时如实记录原因', async () => {
  const host = createRealHostStub({
    system_get_path: () => 'D:\\Downloads',
    system_search_files: () => ({ files: [], total_matches: 0 }),
    system_get_disk_usage: ({ drive }) => {
      if (drive.startsWith('C')) return { total: 100, used: 10, available: 90 }
      throw new Error('无法读取磁盘')
    },
    clipboard_read_text: () => ''
  })
  const fetchImpl = aria2Fetch(() => ({ status: 400, json: { jsonrpc: '2.0', id: 'x', error: { code: 1, message: 'Unauthorized' } } }))
  const snap = await multiDownload.fetchMultiDownloadSnapshot(host, { fetchImpl })
  assert.equal(snap.driveInfoAvailable, false)
  assert.equal(snap.driveFreeBytes, 0)
  assert.equal(multiDownload.isDriveLowOnSpace(snap), false)
  assert.equal(snap.aria2Status.online, false)
  assert.equal(snap.aria2Status.error, 'Unauthorized')

  const offline = await multiDownload.probeAria2JsonRpc({ fetchImpl: aria2Offline })
  assert.equal(offline.online, false)
  assert.match(offline.error, /ECONNREFUSED/)

  assert.equal(
    multiDownload.isDriveLowOnSpace({ driveInfoAvailable: true, driveTotalBytes: 1000, driveFreeBytes: 50 }),
    true
  )
})

test('multi-download: 连接到 aria2 时按档位提交任务，返回任务号，不走客户端下载', async () => {
  const host = createRealHostStub({
    window_show_save_dialog: () => ({ canceled: false, filePath: 'x' }),
    network_http_download: () => ({ success: true }),
    dllplugin_call: () => ({ ok: true, success: true, tasks: [] })
  })
  const fetchImpl = aria2Fetch(() => ({ json: { jsonrpc: '2.0', id: 'x', result: '2089b05ecca3d829' } }))
  const res = await multiDownload.startMultiThreadDownloadTask(
    'https://releases.ubuntu.com/24.04/ubuntu-24.04.iso',
    'C:\\Users\\RealUser\\Downloads',
    preset16,
    host,
    { fetchImpl }
  )
  assert.equal(res.ok, true)
  assert.equal(res.data.engine, 'aria2')
  assert.match(res.message, /16 线程，任务 2089b05ecca3d829/)
  const [uris, opts] = fetchImpl.requests[0].body.params
  assert.deepEqual(uris, ['https://releases.ubuntu.com/24.04/ubuntu-24.04.iso'])
  assert.equal(opts.dir, 'C:\\Users\\RealUser\\Downloads')
  assert.equal(opts.split, '16')
  assert.equal(opts['min-split-size'], '1M')
  assert.equal(host.calls.length, 0, '交给 aria2 后不应再调用客户端下载或原生组件')
})

test('multi-download: aria2 拒绝任务时返回失败，不悄悄换成别的下载方式', async () => {
  const host = createRealHostStub({
    window_show_save_dialog: () => ({ canceled: false, filePath: 'x' }),
    network_http_download: () => ({ success: true })
  })
  const fetchImpl = aria2Fetch(() => ({ status: 400, json: { jsonrpc: '2.0', id: 'x', error: { code: 1, message: 'Unauthorized' } } }))
  const res = await multiDownload.startMultiThreadDownloadTask('https://example.com/file.zip', 'C:\\D', preset16, host, { fetchImpl })
  assert.equal(res.ok, false)
  assert.equal(res.error, 'ARIA2_REJECTED')
  assert.match(res.message, /Unauthorized/)
  assert.equal(host.calls.length, 0)
})

test('multi-download: 连不上 aria2 时 HTTP 链接经保存对话框由客户端单连接下载，并如实说明线程档位未生效', async () => {
  const host = createRealHostStub({
    window_show_save_dialog: () => ({ canceled: false, filePath: 'D:\\Saved\\file.zip' }),
    network_http_download: (payload) => ({ success: true, path: payload.savePath, size: 4096000, statusCode: 200 })
  })
  const res = await multiDownload.startMultiThreadDownloadTask(
    'https://example.com/pkg/file.zip?sig=1',
    'C:\\Users\\RealUser\\Downloads',
    preset16,
    host,
    { fetchImpl: aria2Offline }
  )
  assert.equal(res.ok, true)
  assert.equal(res.data.engine, 'client')
  assert.match(res.message, /未连接到本机 aria2.*单连接下载到 D:\\Saved\\file\.zip.*线程档位未生效/)
  const dialog = called(host, 'window_show_save_dialog')[0].payload
  assert.equal(dialog.defaultPath, 'C:\\Users\\RealUser\\Downloads')
  assert.equal(dialog.defaultName, 'file.zip')
  assert.equal(dialog.filters, 'ZIP 文件|zip|所有文件|*')
  // 宿主只接受 url / savePath / headers / timeout
  assert.deepEqual(called(host, 'network_http_download')[0].payload, {
    url: 'https://example.com/pkg/file.zip?sig=1',
    savePath: 'D:\\Saved\\file.zip'
  })
})

test('multi-download: 客户端下载的取消、对话框失败与下载失败都返回失败', async () => {
  const canceledHost = createRealHostStub({
    window_show_save_dialog: () => ({ canceled: true }),
    network_http_download: () => ({ success: true })
  })
  const canceled = await multiDownload.startMultiThreadDownloadTask('https://example.com/a.zip', '', preset16, canceledHost, { fetchImpl: aria2Offline })
  assert.equal(canceled.error, 'CANCELED')
  assert.equal(called(canceledHost, 'network_http_download').length, 0)

  const dialogFail = await multiDownload.startMultiThreadDownloadTask(
    'https://example.com/a.zip',
    '',
    preset16,
    createRealHostStub({ window_show_save_dialog: () => { throw new Error('窗口已关闭') } }),
    { fetchImpl: aria2Offline }
  )
  assert.equal(dialogFail.ok, false)
  assert.equal(dialogFail.error, 'SAVE_DIALOG_FAILED')

  const failHost = createRealHostStub({
    window_show_save_dialog: () => ({ canceled: false, filePath: 'D:\\a.zip' }),
    network_http_download: () => {
      throw new Error('下载请求返回 HTTP 502')
    }
  })
  const dlFail = await multiDownload.startMultiThreadDownloadTask('https://example.com/a.zip', 'D:\\', preset16, failHost, { fetchImpl: aria2Offline })
  assert.equal(dlFail.ok, false)
  assert.equal(dlFail.error, 'DOWNLOAD_FAILED')
  assert.match(dlFail.message, /502/)
})

test('multi-download: 连不上 aria2 时磁力与 FTP 链接直接报错，不打开外部程序也不写剪贴板', async () => {
  const host = createRealHostStub({
    shell_open_external: () => ({ success: true }),
    clipboard_copy_text: () => ({ success: true }),
    window_show_save_dialog: () => ({ canceled: false, filePath: 'x' })
  })
  const magnet = await multiDownload.startMultiThreadDownloadTask(
    'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
    'C:\\D',
    preset16,
    host,
    { fetchImpl: aria2Offline }
  )
  assert.equal(magnet.ok, false)
  assert.equal(magnet.error, 'ARIA2_REQUIRED')
  assert.match(magnet.message, /磁力链接需要本机运行 aria2/)

  const ftp = await multiDownload.startMultiThreadDownloadTask('ftp://mirror.example.com/a.iso', 'C:\\D', preset16, host, { fetchImpl: aria2Offline })
  assert.equal(ftp.ok, false)
  assert.equal(ftp.error, 'ARIA2_REQUIRED')
  assert.equal(host.calls.length, 0)

  const bad = await multiDownload.startMultiThreadDownloadTask('invalid-protocol://bad', 'C:\\D', preset16, host, { fetchImpl: aria2Offline })
  assert.equal(bad.ok, false)
  assert.equal(bad.error, 'INVALID_URL')
})

test('multi-download: 复制 aria2c 命令，剪贴板失败时返回失败', async () => {
  let copied = ''
  const host = createRealHostStub({
    clipboard_copy_text: ({ text }) => {
      copied = text
      return { success: true }
    }
  })
  const res = await multiDownload.copyAria2cCommand('https://example.com/a.zip', 'C:\\Users\\RealUser\\Downloads', preset16, host)
  assert.equal(res.ok, true)
  assert.match(res.message, /插件不会运行它/)
  assert.equal(copied, `aria2c ${preset16.aria2Flags} -d "C:\\Users\\RealUser\\Downloads" "https://example.com/a.zip"`)

  const failing = createRealHostStub({
    clipboard_copy_text: () => { throw new Error('剪贴板被占用') },
    clipboard_write_text: () => { throw new Error('剪贴板被占用') }
  })
  const failed = await multiDownload.copyAria2cCommand('https://example.com/a.zip', '', preset16, failing)
  assert.equal(failed.ok, false)
  assert.equal(failed.error, 'CLIPBOARD_WRITE_FAILED')
})

test('multi-download: 移入回收站逐个处理，失败与系统目录拦截如实列出', async () => {
  const host = createRealHostStub({
    shell_trash_item: ({ fullPath }) => {
      if (fullPath.endsWith('locked.zip')) throw new Error('文件被占用')
      return { success: true }
    }
  })
  const res = await multiDownload.deleteDownloadedFiles(
    ['C:\\Users\\RealUser\\Downloads\\ubuntu-24.04.iso', 'C:\\Users\\RealUser\\Downloads\\locked.zip', 'C:\\Windows\\x.zip'],
    [
      { path: 'C:\\Users\\RealUser\\Downloads\\ubuntu-24.04.iso', sizeBytes: 4096000 },
      { path: 'C:\\Users\\RealUser\\Downloads\\locked.zip', sizeBytes: 10 }
    ],
    host
  )
  assert.equal(res.deletedCount, 1)
  assert.equal(res.freedBytes, 4096000)
  assert.equal(res.failed.length, 2)
  assert.match(res.failed[0].reason, /文件被占用/)
  assert.equal(res.failed[1].path, 'C:\\Windows\\x.zip')
  assert.equal(called(host, 'shell_trash_item').length, 2)
})

test('multi-download: 链接识别不因畸形转义抛错，档位文字不再夸大', () => {
  const r = multiDownload.detectDownloadUrlFromText('下载 https://example.com/%E0%A4%A.zip 这个')
  assert.equal(r.url, 'https://example.com/%E0%A4%A.zip')
  assert.equal(r.suggestedFileName, '%E0%A4%A.zip')
  assert.equal(multiDownload.detectDownloadUrlFromText('https://example.com/a%20b.zip').suggestedFileName, 'a b.zip')
  assert.doesNotMatch(JSON.stringify(multiDownload.THREAD_SPLIT_PRESETS), /极速|千兆|加速/)
})
