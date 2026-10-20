// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout3-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as batchVideo from '../dist/index.js'

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

test("P31/P32/P33 batch-video & batch-audio & pdf: 对接 dllplugin_call，真实宿主拒绝 simulated:true 与非对应类型文件充数（batch-video 部分）", async () => {
  await withRealElectronWindow(
    {
      system_get_path: ({ name }) => {
        if (name === 'videos') return 'D:\\Media\\Videos'
        if (name === 'music') return 'D:\\Media\\Music'
        if (name === 'documents') return 'D:\\Media\\Docs'
        return ''
      },
      system_search_files: ({ query }) => {
        if (query === 'dir:D:\\Media\\Videos') {
          // 目录下只有 .txt 文件，无视频文件：batch-video 绝不可把 .txt 当成视频返回
          return {
            files: [
              { name: 'notes.txt', path: 'D:\\Media\\Videos\\notes.txt', is_dir: false, size: 2048, mtime: 1700000000 }
            ]
          }
        }
        if (query === 'dir:D:\\Media\\Music') {
          return {
            files: [
              { name: 'readme.md', path: 'D:\\Media\\Music\\readme.md', is_dir: false, size: 1024, mtime: 1700000000 },
              { name: 'song.flac', path: 'D:\\Media\\Music\\song.flac', is_dir: false, size: 24000000, mtime: 1700000000 }
            ]
          }
        }
        if (query === 'dir:D:\\Media\\Docs') {
          return {
            files: [
              { name: 'arch.pdf', path: 'D:\\Media\\Docs\\arch.pdf', is_dir: false, size: 640000, mtime: 1700000000 }
            ]
          }
        }
        return { files: [] }
      },
      dllplugin_call: ({ plugin, func, params }) => {
        return { executed: true, plugin, func, inputPath: params.inputPath }
      }
    },
    async () => {
    const vidQueue = await batchVideo.scanLocalVideoQueue()
    assert.equal(vidQueue.files.length, 0)
    const vRes = await batchVideo.invokeNativeCapability('BatchCompressVideo', { crf: 23, inputPath: 'D:\\Media\\a.mp4' })
    assert.equal(vRes.ok, true)
    assert.equal(vRes.fromFallback, false)
    assert.equal(vRes.data.plugin, 'BatchVideoPlugin')
}
  )
  await withRealElectronWindow(
    {
      dllplugin_call: () => {
        throw new Error('FFMPEG_BINARY_MISSING')
      }
    },
    async () => {
    const vFail = await batchVideo.invokeNativeCapability('BatchCompressVideo', { crf: 23 })
    assert.equal(vFail.ok, false)
    assert.equal(vFail.data?.simulated, undefined)
}
  )
})
