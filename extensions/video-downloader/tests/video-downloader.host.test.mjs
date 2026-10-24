// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout2-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as videoDownloader from '../dist/logic.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
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

test('P13 video-downloader: 真实磁盘空间、直链下载、无 yt-dlp 时如实复制命令及异常边界验证', async () => {
  let clipboardContent = ''
  const host = createRealHostStub({
    system_get_path: () => 'C:\\Users\\RealUser\\Videos',
    system_search_files: () => ({
      files: [
        {
          name: 'demo.mp4',
          path: 'C:\\Users\\RealUser\\Videos\\demo.mp4',
          is_dir: false,
          size: 8192000,
          mtime: 1710000000
        }
      ],
      total_matches: 1,
      total_bytes: 8192000
    }),
    system_get_disk_usage: () => ({
      total: 500 * 1024 ** 3,
      used: 412 * 1024 ** 3,
      available: 88 * 1024 ** 3,
      percent: 82
    }),
    clipboard_write_text: (payload) => {
      clipboardContent = payload.text
      return { ok: true }
    },
    shell_trash_item: () => ({ ok: true })
  })

  const snap = await videoDownloader.fetchVideoDownloaderSnapshot(host)
  assert.equal(snap.driveFreeBytes, 88 * 1024 ** 3)
  assert.ok(snap.videos.length >= 1)
  assert.equal(snap.videos[0].name, 'demo.mp4')

  // 无 yt-dlp 插件时如实告知复制命令到剪贴板，不谎称已启动后台下载
  const res = await videoDownloader.parseAndDownloadStreamVideo(
    'https://www.bilibili.com/video/BV1xx411c7mD',
    snap.saveDir,
    videoDownloader.VIDEO_QUALITY_PRESETS[0],
    host
  )
  assert.equal(res.ok, true)
  assert.match(res.message, /已生成并复制 yt-dlp 命令到剪贴板/)
  assert.match(clipboardContent, /yt-dlp/)

  // 直链下载失败时在真实宿主下必须返回 ok: false
  const failHost = createRealHostStub({
    network_http_download: () => {
      throw new Error('Connection reset by peer')
    }
  })
  const directFail = await videoDownloader.parseAndDownloadStreamVideo(
    'https://cdn.example.com/media/sample.mp4',
    'C:\\Users\\RealUser\\Videos',
    videoDownloader.VIDEO_QUALITY_PRESETS[0],
    failHost
  )
  assert.equal(directFail.ok, false)

  // 真实删除视频统计 freedBytes
  const delRes = await videoDownloader.trashLocalVideoFiles(
    ['C:\\Users\\RealUser\\Videos\\demo.mp4'],
    snap.videos,
    host
  )
  assert.equal(delRes.deletedCount, 1)
  assert.equal(delRes.freedBytes, 8192000)
})
