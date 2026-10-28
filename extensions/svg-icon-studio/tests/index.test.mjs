import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import Command, { optimizeSvgSource } from '../dist/index.js'

const host = createHost()
test('无输入不显示示例或虚构成功，缺少解析器明确停止', async () => {
  const view = await mount(Command)
  try {
    assert.deepEqual(view.items().map(item => item.props.id), ['svg-input'])
    assert.match(view.text(), /载入 SVG 源码开始/)
    assert.throws(() => optimizeSvgSource(''), /EMPTY_SVG_INPUT/)
    assert.throws(() => optimizeSvgSource('<svg/>'), /XML_PARSER_UNAVAILABLE/)
    host.clipboard.text = '<svg/>'
    await view.run(view.items()[0], '从剪贴板载入 SVG')
    assert.match(view.text(), /XML_PARSER_UNAVAILABLE/)
    assert.equal(view.actions(view.items()[0]).some(action => action.type === 'Action.CopyToClipboard'), false)
    host.clipboard.text = ''
    await view.run(view.items()[0], '从剪贴板载入 SVG')
    await tick()
    assert.match(host.lastToast().title, /未能载入/)
    assert.match(view.text(), /载入 SVG 源码开始/)
  } finally { view.unmount() }
})
