import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Command = require('../dist/index.js').default
const logic = require('../dist/logic.js')

test('image-editor 声明式视图渲染与旋转/翻转/水印状态机集成测试', () => {
  const view = Command()
  assert.ok(view && view.type === 'List')
  const s1 = logic.rotateClockwise(logic.DEFAULT_EDITOR_STATE)
  assert.equal(s1.rotation, 90)
  const s2 = logic.toggleFlipH(s1)
  assert.equal(s2.flipH, true)
  const out = logic.renderEditedImage(s2)
  assert.ok(out.previewDataUrl.startsWith('data:image/svg+xml'))
  assert.equal(out.width, 600)
  assert.equal(out.height, 800)
})

test('image-editor 极端缩放比例与连续旋转越界归一化测试 (Beyond Happy Path)', () => {
  let state = logic.DEFAULT_EDITOR_STATE
  for (let i = 0; i < 6; i++) state = logic.rotateClockwise(state)
  assert.equal(state.rotation, 180)
  const clampedLow = logic.updateScale(state, -50)
  assert.equal(clampedLow.scale, 0.1)
  const clampedHigh = logic.updateScale(state, 9999)
  assert.equal(clampedHigh.scale, 3.0)
})
