// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout3-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as colorConverter from '../dist/converter.js'
import ColorPickerCommand, { formatColorByMode } from '../dist/index.js'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'

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

test('color-picker: 结合 screen_get_cursor_pos 与 ColorPickerPlugin.pickScreenPixel 取色，异常如实报错且零 Math.random()', async () => {
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

test('回归：OKLCH 采用真实 sRGB -> Linear RGB -> OKLab -> OKLCH 算法，不再用 HSL 近似', () => {
  const red = colorConverter.parseColor('#FF0000')
  const redOklch = colorConverter.rgbToOklch(red.rgb)
  assert.equal(redOklch.css, 'oklch(62.8% 0.2577 29.23)')
  assert.equal(formatColorByMode(red, 'oklch', true), 'oklch(62.8% 0.2577 29.23)')

  const white = colorConverter.parseColor('#FFFFFF')
  assert.equal(formatColorByMode(white, 'oklch', true), 'oklch(100% 0 none)')

  const black = colorConverter.parseColor('#000000')
  assert.equal(formatColorByMode(black, 'oklch', true), 'oklch(0% 0 none)')

  const accent = colorConverter.parseColor('#0A84FF')
  assert.match(formatColorByMode(accent, 'oklch', true), /^oklch\(\d+(?:\.\d+)?% 0\.\d+ \d+(?:\.\d+)?\)$/)
  assert.notEqual(formatColorByMode(accent, 'oklch', true), 'oklch(0.52 0.240 210)')
})

test('回归：拾色历史 history 在界面中展示并支持一键复制', async () => {
  const host = createHost()
  await colorConverter.saveColorHistory({
    hex: '#30D158',
    rgb: { r: 48, g: 209, b: 88 },
    hsl: { h: 135, s: 64, l: 50 },
    hsv: { h: 135, s: 77, v: 82 },
    x: 100,
    y: 200,
    source: 'native',
    pickedAt: Date.now()
  })

  const view = await mount(ColorPickerCommand)
  try {
    await tick()
    await tick()
    const subItems = view.tree().props.subList.items
    const histQueueItem = subItems.find((i) => String(i.props.id).startsWith('hist_'))
    assert.ok(histQueueItem, '右侧队列应展示近期拾色历史项')
    assert.match(histQueueItem.props.title, /#30D158/)

    // 切换到“近期屏幕拾取”分组，仅展示拾色历史
    await view.dropdown('recent')
    const recentItems = view.tree().props.subList.items
    assert.equal(recentItems.length, 1)
    assert.match(recentItems[0].props.title, /#30D158/)

    // 一键复制该拾色历史记录
    const copyAction = recentItems[0].props.actions.children[0]
    await copyAction.props.onAction()
    assert.equal(host.clipboard.text, '#30D158')
    assert.equal(host.lastToast().style, 'SUCCESS')
  } finally {
    view.unmount()
  }
})
