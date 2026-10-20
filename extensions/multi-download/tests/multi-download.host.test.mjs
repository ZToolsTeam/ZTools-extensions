// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout2-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as multiDownload from '../dist/logic.js'

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

test('P12 multi-download: 真实宿主传输层下载、磁盘空间探测、目录 {files} 兼容与异常边界验证', async () => {
  const host = createRealHostStub({
    system_get_path: () => 'C:\\Users\\RealUser\\Downloads',
    system_search_files: () => ({
      files: [
        {
          name: 'ubuntu-24.04.iso',
          path: 'C:\\Users\\RealUser\\Downloads\\ubuntu-24.04.iso',
          is_dir: false,
          size: 4096000,
          mtime: 1710000000
        }
      ],
      total_matches: 1,
      total_bytes: 4096000
    }),
    system_get_disk_usage: () => ({
      total: 500 * 1024 ** 3,
      used: 377 * 1024 ** 3,
      available: 123 * 1024 ** 3,
      percent: 75
    }),
    network_http_download: (payload) => ({
      destPath: payload.destPath,
      bytesDownloaded: 4096000
    }),
    shell_trash_item: () => ({ ok: true })
  })

  const snap = await multiDownload.fetchMultiDownloadSnapshot(host)
  assert.equal(snap.downloadDir, 'C:\\Users\\RealUser\\Downloads')
  assert.equal(snap.driveFreeBytes, 123 * 1024 ** 3)
  assert.equal(snap.files.length, 1)
  assert.equal(snap.files[0].name, 'ubuntu-24.04.iso')

  // 真实 HTTP 下载成功链路
  const dlOk = await multiDownload.startMultiThreadDownloadTask(
    'https://releases.ubuntu.com/24.04/ubuntu-24.04.iso',
    snap.downloadDir,
    multiDownload.THREAD_SPLIT_PRESETS[0],
    host
  )
  assert.equal(dlOk.ok, true)
  assert.ok(host.calls.some(c => c.channel === 'network_http_download'))

  // 真实回收站清理与释放体积计算
  const trashRes = await multiDownload.deleteDownloadedFiles(
    ['C:\\Users\\RealUser\\Downloads\\ubuntu-24.04.iso'],
    snap.files,
    host
  )
  assert.equal(trashRes.deletedCount, 1)
  assert.equal(trashRes.freedBytes, 4096000)

  // 异常边界：非法 URL 与下载失败严禁伪装成功
  const badUrlRes = await multiDownload.startMultiThreadDownloadTask(
    'invalid-protocol://bad',
    snap.downloadDir,
    multiDownload.THREAD_SPLIT_PRESETS[0],
    host
  )
  assert.equal(badUrlRes.ok, false)

  const failHost = createRealHostStub({
    network_http_download: () => {
      throw new Error('HTTP 502 Bad Gateway')
    }
  })
  const dlFail = await multiDownload.startMultiThreadDownloadTask(
    'https://example.com/file.zip',
    'C:\\Users\\RealUser\\Downloads',
    multiDownload.THREAD_SPLIT_PRESETS[0],
    failHost
  )
  assert.equal(dlFail.ok, false)
  assert.match(dlFail.error || dlFail.message, /502|失败/)
})
