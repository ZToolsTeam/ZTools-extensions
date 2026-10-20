// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout3-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as aiImage from '../dist/index.js'

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

test('P29 ai-image: 真实宿主扫描、AiImagePlugin.processImage 真实输出体积读取与异常拦截', async () => {
  await withRealElectronWindow(
    {
      system_get_path: ({ name }) => (name === 'pictures' ? 'D:\\RealImages' : ''),
      system_search_files: ({ query }) => {
        if (query === 'dir:D:\\RealImages') {
          return {
            files: [
              { name: 'photo.png', path: 'D:\\RealImages\\photo.png', is_dir: false, size: 500000, mtime: 1700000000 }
            ]
          }
        }
        return { files: [] }
      },
      dllplugin_call: ({ plugin, func, params }) => {
        assert.equal(plugin, 'AiImagePlugin')
        assert.equal(func, 'processImage')
        return {
          ok: true,
          outputPath: `${params.outputDir}\\photo_2x.png`
        }
      },
      filesystem_get_file_size: ({ path: targetPath }) => {
        if (targetPath === 'D:\\RealImages\\photo_2x.png') {
          return 1480000
        }
        return 0
      },
      filesystem_stat: ({ path: targetPath }) => {
        if (targetPath === 'D:\\RealImages\\photo_2x.png') {
          return { size: 1480000 }
        }
        return { size: 0 }
      }
    },
    async () => {
      const queue = await aiImage.fetchAiImageQueue()
      assert.equal(queue.files.length, 1, '真实宿主下严禁拼接 INITIAL_AI_IMAGE_FILES')

      const batchRes = await aiImage.executeAiImageBatch(queue.files, {
        engineId: 'realesrgan-x4plus',
        scaleFactor: '2x',
        denoiseStrength: 'standard',
        outputFormat: 'png',
        gpuAccel: true
      })
      assert.equal(batchRes.ok, true)
      assert.equal(batchRes.processedCount, 1)
      assert.equal(batchRes.totalOutputBytes, 1480000)
      assert.equal(batchRes.outputs[0].sizeBytes, 1480000)
    }
  )

  // 异常与安全拦截测试
  const secRes = await aiImage.executeAiImageBatch(
    [
      {
        id: '1',
        name: 'cmd.png',
        path: 'C:\\Windows\\System32\\cmd.png',
        parentDir: 'C:\\Windows\\System32',
        extension: '.png',
        sizeBytes: 1024,
        width: 100,
        height: 100
      }
    ],
    {
      engineId: 'realesrgan-x4plus',
      scaleFactor: '2x',
      denoiseStrength: 'standard',
      outputFormat: 'png'
    }
  )
  assert.equal(secRes.ok, false)
  assert.match(secRes.error, /SECURITY_INTERCEPTED/)

  // 真实宿主下引擎报错时如实返回 ok: false
  await withRealElectronWindow(
    {
      dllplugin_call: () => {
        throw new Error('VULKAN_DEVICE_LOST')
      }
    },
    async () => {
      const failRes = await aiImage.executeAiImageBatch(
        [
          {
            id: '1',
            name: 'photo.png',
            path: 'D:\\RealImages\\photo.png',
            parentDir: 'D:\\RealImages',
            extension: '.png',
            sizeBytes: 500000,
            width: 1280,
            height: 720
          }
        ],
        {
          engineId: 'realesrgan-x4plus',
          scaleFactor: '2x',
          denoiseStrength: 'standard',
          outputFormat: 'png'
        }
      )
      assert.equal(failRes.ok, false)
      assert.match(failRes.error, /VULKAN_DEVICE_LOST/)
    }
  )
})
