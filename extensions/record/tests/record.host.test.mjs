// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout3-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as record from '../dist/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC_EXAMPLES_DIR = path.resolve(__dirname, '../src')
async function withRealElectronWindow(handlers, fn) {
  const prevWindow = globalThis.window
  const calls = []
  const transportMethods = {}

  for (const [channel, impl] of Object.entries(handlers)) {
    transportMethods[channel] = async envelope => {
      const actualParams =
        envelope && typeof envelope === 'object' && 'params' in envelope && 'messageId' in envelope
          ? envelope.params
          : envelope
      calls.push({ channel, payload: actualParams })
      return impl(actualParams)
    }
  }

  globalThis.window = {
    __ztoolsElectron: {
      transport: {
        methods: transportMethods
      }
    }
  }

  try {
    return await fn(calls)
  } finally {
    if (prevWindow === undefined) {
      delete globalThis.window
    } else {
      globalThis.window = prevWindow
    }
  }
}

test('P28 record: 真实宿主录像扫描、RecordPlugin 启停录屏与状态栏联动、失败时严禁返回 rec_sim_', async () => {
  await withRealElectronWindow(
    {
      system_get_path: ({ name }) => (name === 'videos' ? 'D:\\RealVideos' : ''),
      system_search_files: ({ query }) => {
        if (query === 'dir:D:\\RealVideos') {
          return {
            files: [
              { name: 'demo_01.mp4', path: 'D:\\RealVideos\\demo_01.mp4', is_dir: false, size: 10 * 1024 * 1024, mtime: 1700000000 }
            ]
          }
        }
        return { files: [] }
      },
      dllplugin_call: ({ plugin, func }) => {
        assert.equal(plugin, 'RecordPlugin')
        if (func === 'startRecording') {
          return { ok: true, sessionId: 'real_rec_9001', saveDir: 'D:\\RealVideos' }
        }
        if (func === 'stopRecording') {
          return { ok: true, outputPath: 'D:\\RealVideos\\out_9001.mp4' }
        }
        throw new Error(`Unexpected: ${func}`)
      },
      window_show_record_bar: () => ({ ok: true }),
      window_hide_record_bar: () => ({ ok: true })
    },
    async calls => {
      // 1. 仅 1 个真实视频时严禁拼接 INITIAL_RECORDED_VIDEOS
      const ws = await record.fetchRecordWorkspace()
      assert.equal(ws.recordings.length, 1)
      assert.equal(ws.recordings[0].path, 'D:\\RealVideos\\demo_01.mp4')

      // 2. 启动录制与显示录制状态栏
      const startRes = await record.startScreenRecording({
        sourceModeId: 'rec-fullscreen-primary',
        fps: '60',
        codecContainer: 'mp4_h264',
        wasapiLoopback: true,
        micMix: false,
        cursorHighlight: true,
        saveDir: 'D:\\RealVideos'
      })
      assert.equal(startRes.ok, true)
      assert.equal(startRes.sessionId, 'real_rec_9001')
      assert.ok(!startRes.sessionId.startsWith('rec_sim_'))
      assert.ok(calls.some(c => c.channel === 'window_show_record_bar'))

      // 3. 停止录制与隐藏录制状态栏
      const stopRes = await record.stopScreenRecording()
      assert.equal(stopRes.ok, true)
      assert.equal(stopRes.outputPath, 'D:\\RealVideos\\out_9001.mp4')
      assert.ok(calls.some(c => c.channel === 'window_hide_record_bar'))
    }
  )

  // 4. 异常测试：真实宿主下录制引擎不可用时如实返回 ok: false，绝不返回 rec_sim_
  await withRealElectronWindow(
    {
      system_get_path: () => 'D:\\RealVideos',
      dllplugin_call: () => {
        throw new Error('DXGI_DUPLICATION_ACCESS_LOST')
      },
      screen_record_start: () => {
        throw new Error('DXGI_DUPLICATION_ACCESS_LOST')
      }
    },
    async () => {
      const failStart = await record.startScreenRecording({
        sourceModeId: 'rec-fullscreen-primary',
        fps: '60',
        codecContainer: 'mp4_h264',
        wasapiLoopback: true,
        micMix: false,
        cursorHighlight: true
      })
      assert.equal(failStart.ok, false)
      assert.equal(failStart.sessionId, '')
      assert.match(failStart.error, /DXGI_DUPLICATION_ACCESS_LOST/)
    }
  )
})
