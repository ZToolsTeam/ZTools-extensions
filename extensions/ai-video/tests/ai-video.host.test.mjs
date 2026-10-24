// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout3-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as aiVideo from '../dist/index.js'

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

test('P30 ai-video: 真实宿主扫描、AiVideoPlugin.enhanceVideo 真实文件校验与无产出拦截', async () => {
  await withRealElectronWindow(
    {
      system_get_path: ({ name }) => (name === 'videos' ? 'D:\\RealClips' : ''),
      system_search_files: ({ query }) => {
        if (query === 'dir:D:\\RealClips') {
          return {
            files: [
              { name: 'clip.mp4', path: 'D:\\RealClips\\clip.mp4', is_dir: false, size: 8000000, mtime: 1700000000 }
            ]
          }
        }
        return { files: [] }
      },
      dllplugin_call: ({ plugin, func }) => {
        assert.equal(plugin, 'AiVideoPlugin')
        assert.equal(func, 'enhanceVideo')
        return {
          ok: true,
          outputPath: 'D:\\RealClips\\clip_60fps_4k_2160p.mp4',
          sizeBytes: 19500000
        }
      }
    },
    async () => {
      const queue = await aiVideo.fetchAiVideoQueue()
      assert.equal(queue.files.length, 1, '真实宿主下严禁拼接 INITIAL_AI_VIDEO_FILES')

      const res = await aiVideo.executeAiVideoBatch(queue.files, {
        modelId: 'rife-v4-6',
        targetFps: '60fps',
        targetResolution: '4k_2160p',
        videoEncoder: 'hevc_nvenc',
        sceneChangeProtection: true
      })
      assert.equal(res.ok, true)
      assert.equal(res.processedCount, 1)
      assert.equal(res.totalOutputBytes, 19500000)
    }
  )

  // 异常测试：当插件未生成有效文件（sizeBytes === 0）时严禁假报成功
  await withRealElectronWindow(
    {
      dllplugin_call: () => ({ ok: true, outputPath: 'D:\\RealClips\\non_existent.mp4', sizeBytes: 0 }),
      filesystem_get_file_size: () => 0,
      filesystem_stat: () => ({ size: 0 })
    },
    async () => {
      const failRes = await aiVideo.executeAiVideoBatch(
        [
          {
            id: 'v1',
            name: 'clip.mp4',
            path: 'D:\\RealClips\\clip.mp4',
            parentDir: 'D:\\RealClips',
            extension: '.mp4',
            sizeBytes: 8000000,
            sourceFps: 30,
            sourceResolution: '1920×1080'
          }
        ],
        {
          modelId: 'rife-v4-6',
          targetFps: '60fps',
          targetResolution: '4k_2160p',
          videoEncoder: 'hevc_nvenc',
          sceneChangeProtection: true
        }
      )
      assert.equal(failRes.ok, false, '无有效产出文件时严禁假报成功')
    }
  )
})
