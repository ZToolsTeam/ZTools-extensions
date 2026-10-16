import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Command = require('../dist/index.js').default
const logic = require('../dist/logic.js')

test('image-tool 声明式视图渲染与二进制头部解析集成测试', () => {
  const view = Command()
  assert.ok(view && view.type === 'List')
  assert.ok(logic.PRESET_IMAGES.length > 0)
  const meta = logic.parseImageMetadata(logic.PRESET_IMAGES[0].dataUrl)
  assert.ok(meta.width > 0 && meta.height > 0)
  assert.equal(logic.calculateAspectRatio(1920, 1080), '16:9')
})

test('image-tool 损坏图像数据与零尺寸边界防御测试 (Beyond Happy Path)', () => {
  assert.equal(logic.calculateAspectRatio(0, 0), '1:1')
  assert.equal(logic.calculateAspectRatio(-100, 200), '1:1')
  assert.equal(logic.formatBytes(-50), '0 B')
  const badBytes = new Uint8Array([0x00, 0x01, 0x02])
  const info = logic.parseImageBinary(badBytes)
  assert.equal(info.format, 'UNKNOWN')
})
