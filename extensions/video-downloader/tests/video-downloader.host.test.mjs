// 本插件业务逻辑的宿主集成测试：用宿主替身模拟客户端返回，覆盖成功与各类失败路径
import test from 'node:test'
import assert from 'node:assert/strict'
import { setRuntimeLocale } from '@ztools/declarative-ui'

setRuntimeLocale('zh-CN')
const videoDownloader = await import('../dist/logic.js')

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
const preset1080 = videoDownloader.VIDEO_QUALITY_PRESETS.find((p) => p.id === 'q_1080p_mp4')

test('video-downloader: 挂载快照只读取视频路径与剪贴板链接，不扫描目录或读取磁盘空间', async () => {
  const host = createRealHostStub({
    system_get_path: ({ name }) => (name === 'videos' ? 'C:\\Users\\RealUser\\Videos' : `C:\\Users\\RealUser\\${name}`),
    clipboard_read_text: () => '看看这个 https://www.bilibili.com/video/BV1xx411c7mD 很好看'
  })

  const snap = await videoDownloader.fetchVideoDownloaderSnapshot(host)
  assert.equal(snap.saveDir, 'C:\\Users\\RealUser\\Videos')
  assert.deepEqual(snap.videos, [])
  assert.equal(snap.totalSizeBytes, 0)
  assert.equal(snap.clipboardUrl, 'https://www.bilibili.com/video/BV1xx411c7mD')
  assert.equal(snap.detectedPlatform.id, 'bilibili')
  assert.equal('driveFreeBytes' in snap, false)
  assert.equal(called(host, 'system_search_files').length, 0)
  assert.equal(called(host, 'filesystem_get_directory_contents').length, 0)
  assert.equal(called(host, 'system_list_common_folders').length, 0)
  assert.equal(called(host, 'system_get_disk_usage').length, 0)
  // 只请求 videos 路径，不再批量请求无关系统目录
  assert.deepEqual(called(host, 'system_get_path').map((c) => c.payload.name), ['videos'])
})

test('video-downloader: 导入规则对齐视频格式且对大小未知不填 0，下载完成条目正确构造', () => {
  for (const ext of ['.mp4', '.mkv', '.mov', '.webm', '.flv', '.avi', '.m4v', '.ts']) {
    assert.ok(videoDownloader.VIDEO_IMPORT_RULES.extensions.includes(ext), `应包含 ${ext}`)
  }
  const unknown = videoDownloader.toLocalMediaVideoItem({
    path: 'D:\\Videos\\clip.mp4',
    name: 'clip.mp4',
    parentDir: 'D:\\Videos',
    extension: '.mp4',
    sizeBytes: null,
    lastModifiedMs: null
  })
  assert.equal(unknown.sizeBytes, null)
  assert.equal(unknown.sourceDirLabel, '手动导入')

  const downloaded = videoDownloader.createDownloadedVideoItem('D:\\Videos\\out.webm', 2048)
  assert.equal(downloaded.name, 'out.webm')
  assert.equal(downloaded.ext, '.webm')
  assert.equal(downloaded.sizeBytes, 2048)
  assert.equal(downloaded.sourceDirLabel, '本次下载')
})

test('video-downloader: 剪贴板读取失败或没有链接时不编造平台和链接', async () => {
  const failing = createRealHostStub({
    system_get_path: () => 'C:\\Users\\RealUser\\Videos',
    system_search_files: () => ({ files: [], total_matches: 0 }),
    clipboard_read_text: () => {
      throw new Error('剪贴板被占用')
    }
  })
  const snap = await videoDownloader.fetchVideoDownloaderSnapshot(failing)
  assert.equal(snap.clipboardUrl, '')
  assert.deepEqual(snap.videos, [])

  const noLink = await videoDownloader.readClipboardStreamUrl(createRealHostStub({ clipboard_read_text: () => '普通文字' }))
  assert.equal(noLink.url, '')
})

test('video-downloader: 链接识别区分视频直链与平台链接', () => {
  assert.equal(videoDownloader.describeVideoLink('https://cdn.example.com/media/clip.MP4?token=1').directExt, 'mp4')
  assert.equal(videoDownloader.describeVideoLink('https://www.youtube.com/watch?v=abc').directExt, '')
  assert.equal(videoDownloader.describeVideoLink('https://www.youtube.com/watch?v=abc').platform.id, 'youtube')
  assert.equal(videoDownloader.describeVideoLink('https://cdn.example.com/live/index.m3u8').directExt, '')
  assert.equal(videoDownloader.describeVideoLink('BV1xx411c7mD').url, 'https://www.bilibili.com/video/BV1xx411c7mD')
  assert.equal(videoDownloader.describeVideoLink('没有链接').url, '')
  // 畸形转义不能抛错
  assert.equal(videoDownloader.suggestVideoFileName('https://cdn.example.com/%E0%A4%A.mp4', 'mp4'), 'video.mp4')
  assert.equal(videoDownloader.suggestVideoFileName('https://cdn.example.com/a%20b.mp4', 'mp4'), 'a b.mp4')
})

test('video-downloader: 视频直链先弹保存对话框，再按宿主契约调用 network_http_download', async () => {
  const host = createRealHostStub({
    window_show_save_dialog: () => ({ canceled: false, filePath: 'D:\\Saved\\clip.mp4' }),
    network_http_download: (params) => ({ success: true, path: params.savePath, size: 4096000, statusCode: 200 })
  })
  const res = await videoDownloader.downloadDirectVideo(
    'https://cdn.example.com/media/clip.mp4',
    'C:\\Users\\RealUser\\Videos',
    host
  )
  assert.equal(res.ok, true)
  assert.match(res.message, /已下载到 D:\\Saved\\clip\.mp4/)
  assert.equal(res.data.size, 4096000)

  const dialog = called(host, 'window_show_save_dialog')[0].payload
  assert.equal(dialog.defaultPath, 'C:\\Users\\RealUser\\Videos')
  assert.equal(dialog.defaultName, 'clip.mp4')
  assert.equal(dialog.filters, '视频|mp4|所有文件|*')
  // 宿主只接受 url / savePath / headers / timeout，多余字段会被拒绝
  assert.deepEqual(called(host, 'network_http_download')[0].payload, {
    url: 'https://cdn.example.com/media/clip.mp4',
    savePath: 'D:\\Saved\\clip.mp4'
  })
})

test('video-downloader: 直链下载的取消、对话框失败、下载失败、空文件都如实返回失败', async () => {
  const canceledHost = createRealHostStub({
    window_show_save_dialog: () => ({ canceled: true }),
    network_http_download: () => ({ success: true, path: 'x', size: 1 })
  })
  const canceled = await videoDownloader.downloadDirectVideo('https://cdn.example.com/a.mp4', '', canceledHost)
  assert.equal(canceled.ok, false)
  assert.equal(canceled.error, 'CANCELED')
  assert.equal(called(canceledHost, 'network_http_download').length, 0)

  const dialogFail = await videoDownloader.downloadDirectVideo(
    'https://cdn.example.com/a.mp4',
    '',
    createRealHostStub({
      window_show_save_dialog: () => {
        throw new Error('窗口已关闭')
      }
    })
  )
  assert.equal(dialogFail.ok, false)
  assert.equal(dialogFail.error, 'SAVE_DIALOG_FAILED')
  assert.match(dialogFail.message, /窗口已关闭/)

  const downloadFail = await videoDownloader.downloadDirectVideo(
    'https://cdn.example.com/a.mp4',
    '',
    createRealHostStub({
      window_show_save_dialog: () => ({ canceled: false, filePath: 'D:\\a.mp4' }),
      network_http_download: () => {
        throw new Error('下载请求返回 HTTP 403')
      }
    })
  )
  assert.equal(downloadFail.ok, false)
  assert.equal(downloadFail.error, 'DOWNLOAD_FAILED')
  assert.match(downloadFail.message, /HTTP 403/)

  const empty = await videoDownloader.downloadDirectVideo(
    'https://cdn.example.com/a.mp4',
    '',
    createRealHostStub({
      window_show_save_dialog: () => ({ canceled: false, filePath: 'D:\\a.mp4' }),
      network_http_download: () => ({ success: true, path: 'D:\\a.mp4', size: 0 })
    })
  )
  assert.equal(empty.ok, false)
  assert.equal(empty.error, 'EMPTY_FILE')

  const forbidden = await videoDownloader.downloadDirectVideo(
    'https://cdn.example.com/a.mp4',
    '',
    createRealHostStub({
      window_show_save_dialog: () => ({ canceled: false, filePath: 'C:\\Windows\\a.mp4' }),
      network_http_download: () => ({ success: true, path: 'C:\\Windows\\a.mp4', size: 1 })
    })
  )
  assert.equal(forbidden.ok, false)
  assert.equal(forbidden.error, 'FORBIDDEN_TARGET')
})

test('video-downloader: 平台链接不能直接下载，也不会偷偷写剪贴板或调用原生组件', async () => {
  const host = createRealHostStub({
    window_show_save_dialog: () => ({ canceled: false, filePath: 'D:\\a.mp4' }),
    network_http_download: () => ({ success: true }),
    dllplugin_call: () => ({ ok: true, success: true, tasks: [] }),
    clipboard_copy_text: () => ({ ok: true })
  })
  const res = await videoDownloader.downloadDirectVideo('https://www.bilibili.com/video/BV1xx411c7mD', '', host)
  assert.equal(res.ok, false)
  assert.equal(res.error, 'NOT_DIRECT_VIDEO_URL')
  assert.equal(host.calls.length, 0)

  const noUrl = await videoDownloader.downloadDirectVideo('随便一段文字', '', host)
  assert.equal(noUrl.ok, false)
  assert.equal(noUrl.error, 'INVALID_STREAM_URL')
})

test('video-downloader: 复制 yt-dlp 命令如实说明插件不下载，剪贴板写入失败时返回失败', async () => {
  let clipboardContent = ''
  const host = createRealHostStub({
    clipboard_copy_text: (payload) => {
      clipboardContent = payload.text
      return { ok: true }
    }
  })
  const res = await videoDownloader.copyYtDlpCommand(
    'https://www.youtube.com/watch?v=abc',
    'C:\\Users\\RealUser\\Videos',
    preset1080,
    host
  )
  assert.equal(res.ok, true)
  assert.match(res.message, /插件不会下载该链接/)
  assert.equal(
    clipboardContent,
    `yt-dlp ${preset1080.ytDlpArgs} -P "C:\\Users\\RealUser\\Videos" -o "%(title)s [%(id)s].%(ext)s" "https://www.youtube.com/watch?v=abc"`
  )

  const failing = createRealHostStub({
    clipboard_copy_text: () => {
      throw new Error('剪贴板被占用')
    },
    clipboard_write_text: () => {
      throw new Error('剪贴板被占用')
    }
  })
  const failed = await videoDownloader.copyYtDlpCommand('https://www.youtube.com/watch?v=abc', '', preset1080, failing)
  assert.equal(failed.ok, false)
  assert.equal(failed.error, 'CLIPBOARD_WRITE_FAILED')

  const noUrl = await videoDownloader.copyYtDlpCommand('没有链接', '', preset1080, host)
  assert.equal(noUrl.ok, false)
})

test('video-downloader: 档位文字不再承诺 4K / 60fps / 320k / 无损抽离等做不到的效果', () => {
  const text = JSON.stringify(videoDownloader.VIDEO_QUALITY_PRESETS)
  assert.doesNotMatch(text, /4K|60fps|320|无损抽离|兼容所有/)
  const platforms = JSON.stringify(videoDownloader.STREAM_PLATFORMS)
  assert.doesNotMatch(platforms, /去水印|弹幕|Handler/)
})

test('video-downloader: 移入回收站逐个处理，失败与系统目录拦截如实列出', async () => {
  const host = createRealHostStub({
    shell_trash_item: ({ fullPath }) => {
      if (fullPath.endsWith('locked.mp4')) throw new Error('文件被占用')
      return { success: true }
    }
  })
  const res = await videoDownloader.trashLocalVideoFiles(
    ['C:\\Users\\RealUser\\Videos\\demo.mp4', 'C:\\Users\\RealUser\\Videos\\locked.mp4', 'C:\\Windows\\a.mp4'],
    [{ path: 'C:\\Users\\RealUser\\Videos\\demo.mp4', sizeBytes: 8192000 }],
    host
  )
  assert.equal(res.deletedCount, 1)
  assert.equal(res.freedBytes, 8192000)
  assert.equal(res.failed.length, 2)
  assert.match(res.failed[0].reason, /文件被占用/)
  assert.equal(res.failed[1].path, 'C:\\Windows\\a.mp4')
  // 系统目录里的文件不会交给宿主
  assert.equal(called(host, 'shell_trash_item').length, 2)
})

test('video-downloader: 打开与定位失败时返回失败而不是静默', async () => {
  const host = createRealHostStub({
    shell_open_path: () => {
      throw new Error('路径未由当前窗口授权')
    },
    shell_show_item_in_folder: () => {
      throw new Error('路径未由当前窗口授权')
    }
  })
  const opened = await videoDownloader.openLocalVideoFile('C:\\Users\\RealUser\\Videos', host)
  assert.equal(opened.ok, false)
  const shown = await videoDownloader.openLocalVideoFolder('C:\\Users\\RealUser\\Videos\\demo.mp4', host)
  assert.equal(shown.ok, false)
  const empty = await videoDownloader.openLocalVideoFile('', host)
  assert.equal(empty.error, 'EMPTY_PATH')
})
