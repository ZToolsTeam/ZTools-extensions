import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount } from '../../shared/test-harness.mjs'
import Command, { parseColor } from '../dist/index.js'
createHost()
test('原型键与无效颜色进入正常空态，之后仍可解析并复制颜色', async () => {
  const view = await mount(Command)
  try {
    for (const input of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
      assert.equal(parseColor(input).isValid, false)
      await view.search(input)
      assert.ok(!view.items().some(item => item.props.id === 'fmt-hex'))
    }
    await view.search('#123456')
    assert.equal(view.item('fmt-hex').props.title, '#123456')
  } finally { view.unmount() }
})
