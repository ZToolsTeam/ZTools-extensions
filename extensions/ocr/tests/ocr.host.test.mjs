// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout3-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ocr from '../dist/index.js'

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

test('P27 ocr: 真实宿主队列扫描、OcrPlugin.recognizeImage / captureAndRecognize 剪贴板写入与失败拦截', async () => {
  let clipboardText = ''

  await withRealElectronWindow(
    {
      system_get_path: ({ name }) => (name === 'pictures' ? 'D:\\RealPics' : ''),
      system_search_files: ({ query }) => {
        if (query === 'dir:D:\\RealPics') {
          return {
            files: [
              { name: 'invoice_01.png', path: 'D:\\RealPics\\invoice_01.png', is_dir: false, size: 128000, mtime: 1700000000 }
            ]
          }
        }
        return { files: [] }
      },
      dllplugin_call: ({ plugin, func, params }) => {
        assert.equal(plugin, 'OcrPlugin')
        if (func === 'recognizeImage') {
          return { text: `真实识别内容:${path.win32.basename(params.path)}`, confidence: 99.1, latencyMs: 32 }
        }
        if (func === 'captureAndRecognize') {
          return { text: '屏幕框选识别出的真实文字 2026', confidence: 98.5 }
        }
        throw new Error(`Unexpected func: ${func}`)
      },
      clipboard_write_text: ({ text }) => {
        clipboardText = text
        return true
      }
    },
    async () => {
      // 1. 仅 1 张真实图片时严禁拼接 INITIAL_OCR_QUEUE_ITEMS
      const snapshot = await ocr.fetchOcrQueueSnapshot()
      assert.equal(snapshot.length, 1)
      assert.equal(snapshot.items.length, 1)
      assert.equal(snapshot[0].path, 'D:\\RealPics\\invoice_01.png')

      // 2. 批量 OCR 识别并写入真实剪贴板
      const batchRes = await ocr.executeBatchOcr(snapshot.items, {
        languageModelId: 'ocr-ch-en-v4',
        layoutStrategy: 'natural_paragraph',
        postAction: 'copy_clipboard',
        filterStampNoise: true
      })
      assert.equal(batchRes.ok, true)
      assert.equal(batchRes.recognizedCount, 1)
      assert.equal(batchRes.combinedText, '真实识别内容:invoice_01.png')
      assert.equal(clipboardText, '真实识别内容:invoice_01.png')

      // 3. 截屏框选 OCR 识别并写入剪贴板（绝不包含 EACCES 假报错文本）
      const capRes = await ocr.captureScreenAreaOcr()
      assert.equal(capRes.ok, true)
      assert.equal(capRes.text, '屏幕框选识别出的真实文字 2026')
      assert.ok(!capRes.text.includes('EACCES'), '严禁返回 EACCES 假报错文本')
      assert.equal(clipboardText, '屏幕框选识别出的真实文字 2026')
    }
  )

  // 4. 异常测试：真实宿主下 OcrPlugin 失败时如实返回 ok: false，绝不把文件名拼成假识别结果
  await withRealElectronWindow(
    {
      dllplugin_call: () => {
        throw new Error('ONNX_MODEL_LOAD_FAILED')
      }
    },
    async () => {
      const failBatch = await ocr.executeBatchOcr(
        [
          {
            id: '1',
            name: 'broken.png',
            path: 'D:\\RealPics\\broken.png',
            parentDir: 'D:\\RealPics',
            extension: '.png',
            sizeBytes: 1024,
            sampleText: '',
            confidencePercent: 0
          }
        ],
        {
          languageModelId: 'ocr-ch-en-v4',
          layoutStrategy: 'natural_paragraph',
          postAction: 'copy_clipboard',
          filterStampNoise: false
        }
      )
      assert.equal(failBatch.ok, false)
      assert.equal(failBatch.combinedText, '')

      const failCap = await ocr.captureScreenAreaOcr()
      assert.equal(failCap.ok, false)
      assert.equal(failCap.text, '')
    }
  )
})
