// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout3-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as screenshotsService from '../dist/screenshots-service.js'

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

// OcrPlugin 只有 Windows DLL 实现：涉及 OCR 的用例按 Windows 平台运行
async function asWindows(fn) {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { value: { platform: 'Win32', userAgent: 'Windows NT 10.0' }, configurable: true, writable: true })
  try {
    return await fn()
  } finally {
    if (desc) Object.defineProperty(globalThis, 'navigator', desc)
    else delete globalThis.navigator
  }
}

test('P34 screenshots: 真实 PNG/GIF/BMP 文件头尺寸解析、真实剪贴板回贴/复制与 OcrPlugin 识别（清零假 OCR 文本）', () => asWindows(async () => {
  // 1. 构造真实 320x180 PNG 头部字节流并验证 parseImageDimensionsFromBytes
  const pngHeader = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x01, 0x40, // width = 320
    0x00, 0x00, 0x00, 0xb4  // height = 180
  ])
  const parsedDims = screenshotsService.parseImageDimensionsFromBytes(pngHeader)
  assert.deepEqual(parsedDims, { width: 320, height: 180 })

  const pngBase64 = Buffer.from(pngHeader).toString('base64')
  let copiedText = ''

  await withRealElectronWindow(
    {
      screenshots_scan: () => [
        {
          id: 'ss-real-1',
          filename: 'capture_real.png',
          path: 'D:\\RealShots\\capture_real.png',
          sizeBytes: 64000,
          modifiedAt: 1700000005000
        }
      ],
      // 宿主真实形状：filesystem_read_file_chunk / filesystem_read_file 返回 { success, content(base64) }
      filesystem_read_file_chunk: ({ path: p, offset, length }) => {
        assert.equal(offset, 0)
        assert.ok(length > 0 && length <= 2 * 1024 * 1024)
        if (p === 'D:\\RealShots\\capture_real.png') return { success: true, content: pngBase64 }
        throw new Error('路径未由当前窗口授权')
      },
      filesystem_read_file: ({ path: p, encoding }) => {
        assert.equal(encoding, 'base64')
        if (p === 'D:\\RealShots\\capture_real.png') return { success: true, content: pngBase64 }
        throw new Error('路径未由当前窗口授权')
      },
      clipboard_hide_and_paste_image: (params) => {
        assert.deepEqual(Object.keys(params), ['image'])
        assert.equal(params.image, pngBase64)
        return { success: true }
      },
      clipboard_copy_image: (params) => {
        assert.deepEqual(Object.keys(params), ['image'])
        return { success: true }
      },
      dllplugin_call: ({ plugin, func, params }) => {
        assert.equal(plugin, 'OcrPlugin')
        assert.equal(func, 'recognizeImage')
        assert.equal(params.path, 'D:\\RealShots\\capture_real.png')
        return { text: '截图中的真实报错信息: ECONNREFUSED 127.0.0.1:8080' }
      },
      clipboard_write_text: ({ text }) => {
        copiedText = text
        return true
      }
    },
    async calls => {
      const mgr = new screenshotsService.ScreenshotsManager()
      const list = await mgr.loadScreenshots(true)
      assert.equal(list.length, 1)
      const shot = list[0]

      // 校验从 PNG 头部解析出的真实尺寸 320x180
      assert.equal(shot.width, 320)
      assert.equal(shot.height, 180)
      // 校验未执行 OCR 前绝不包含 `系统自动提取文件文本` 假文案
      assert.ok(!shot.ocrText.includes('系统自动提取文件文本'))
      assert.equal(shot.ocrText, '')

      // 校验 pasteToActiveWindow 读出图片后调用 clipboard_hide_and_paste_image
      const pasteRes = await mgr.pasteToActiveWindow(shot)
      assert.equal(pasteRes.success, true)
      assert.ok(calls.some(c => c.channel === 'clipboard_hide_and_paste_image'))

      // 校验 copyImageToClipboard 以图片格式写入剪贴板
      const copyRes = await mgr.copyImageToClipboard(shot)
      assert.equal(copyRes.success, true)
      assert.ok(calls.some(c => c.channel === 'clipboard_copy_image'))

      // 校验 extractOcr 调用 OcrPlugin.recognizeImage 并写入剪贴板
      const ocrText = await mgr.extractOcr(shot)
      assert.equal(ocrText, '截图中的真实报错信息: ECONNREFUSED 127.0.0.1:8080')
      assert.equal(copiedText, '截图中的真实报错信息: ECONNREFUSED 127.0.0.1:8080')
    }
  )

  // 异常测试：真实宿主下 OcrPlugin 失败时 extractOcr 必须抛出异常，严禁伪造文本
  await withRealElectronWindow(
    {
      dllplugin_call: () => {
        throw new Error('OCR_SERVICE_DOWN')
      }
    },
    async () => {
      const mgr = new screenshotsService.ScreenshotsManager()
      await assert.rejects(
        () =>
          mgr.extractOcr({
            id: 'ss-1',
            filename: 'test.png',
            path: 'D:\\RealShots\\test.png',
            width: 100,
            height: 100,
            dimensions: '100 x 100',
            sizeBytes: 1000,
            formattedSize: '1 KB',
            createdAt: Date.now(),
            modifiedAt: Date.now(),
            formattedDate: '刚刚',
            pinned: false,
            ocrText: '',
            ocrStatus: 'pending',
            thumbnailSvg: ''
          }),
        /OCR_SERVICE_DOWN/
      )
    }
  )
}))
