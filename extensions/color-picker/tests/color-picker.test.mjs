import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const mod = require('../dist/index.js')
const Command = mod.default

test('color-picker 声明式视图渲染与色彩双向换算集成测试', () => {
  const view = Command()
  assert.ok(view && view.type === 'List')
  const rgb = mod.hexToRgb('#0ea5e9')
  assert.deepEqual(rgb, { r: 14, g: 165, b: 233 })
  assert.equal(mod.rgbToHex({ r: 14, g: 165, b: 233 }).toLowerCase(), '#0ea5e9')
  const ratio = mod.calculateContrast({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })
  assert.ok(ratio >= 20)
  const wcag = mod.calculateWcag({ r: 0, g: 0, b: 0 })
  assert.ok(wcag.contrastOnWhite >= 20)
  assert.equal(wcag.whiteRating, 'AAA')
})

test('color-picker 非法色值与边界输入防御测试 (Beyond Happy Path)', () => {
  const emptyParsed = mod.parseColor('')
  assert.equal(emptyParsed.isValid, false)
  const invalidParsed = mod.parseColor('not-a-color-xyz')
  assert.equal(invalidParsed.isValid, false)
  assert.equal(mod.normalizeHex('invalid'), '#000000')
  assert.deepEqual(mod.hexToRgb('invalid'), { r: 0, g: 0, b: 0 })
})
