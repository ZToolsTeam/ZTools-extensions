// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout3-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as colorConverter from '../dist/converter.js'

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

test('P35 color-picker: 结合 screen_get_cursor_pos 与 ColorPickerPlugin.pickScreenPixel 取色，异常如实报错且零 Math.random()', async () => {
  // 1. 源码级断言：converter.ts 中严禁出现 Math.random()
  const converterSrc = fs.readFileSync(path.join(SRC_EXAMPLES_DIR, 'converter.ts'), 'utf8')
  assert.ok(!converterSrc.includes('Math.random('), 'screen-color-picker/converter.ts 中严禁使用 Math.random() 生成随机假颜色')

  // 2. 真实宿主链路测试：获取光标位置 (512, 384) 并调用 ColorPickerPlugin.pickScreenPixel
  await withRealElectronWindow(
    {
      screen_get_cursor_pos: () => ({ x: 512, y: 384 }),
      dllplugin_call: ({ plugin, func, params }) => {
        assert.equal(plugin, 'ColorPickerPlugin')
        assert.equal(func, 'pickScreenPixel')
        assert.equal(params.x, 512)
        assert.equal(params.y, 384)
        return { r: 48, g: 209, b: 88, x: 512, y: 384 }
      }
    },
    async () => {
      const picked = await colorConverter.pickScreenColor()
      assert.equal(picked.source, 'native')
      assert.equal(picked.hex, '#30D158')
      assert.deepEqual(picked.rgb, { r: 48, g: 209, b: 88 })
      assert.equal(picked.x, 512)
      assert.equal(picked.y, 384)
    }
  )

  // 3. 异常边界测试：真实宿主下取色失败或无权限时必须抛出异常，严禁静默降级返回随机颜色
  await withRealElectronWindow(
    {
      screen_get_cursor_pos: () => ({ x: 100, y: 100 }),
      dllplugin_call: () => {
        throw new Error('GDI_GETPIXEL_FAILED')
      },
      screen_pick_color: () => {
        throw new Error('GDI_GETPIXEL_FAILED')
      },
      screen_capture: () => {
        throw new Error('GDI_GETPIXEL_FAILED')
      }
    },
    async () => {
      await assert.rejects(() => colorConverter.pickScreenColor(), /GDI_GETPIXEL_FAILED/)
    }
  )
})
