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

// 借用前端依赖里的 jsdom 提供 XML 解析器；没有安装时跳过（完整的浏览器用例见 browser-cases.mjs）
import { createRequire } from 'node:module'
let JSDOM = null
try { JSDOM = createRequire(new URL('../../../frontend/package.json', import.meta.url))('jsdom').JSDOM } catch { /* 未安装前端依赖 */ }

test('导出结果的详情里显示清理后 SVG 的真实图片预览（Base64 Data URI，不内联 SVG 标记）', { skip: !JSDOM && '需要 frontend 依赖中的 jsdom' }, async () => {
  const previous = globalThis.DOMParser
  globalThis.DOMParser = new JSDOM('').window.DOMParser
  const view = await mount(Command)
  try {
    host.clipboard.text = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4" fill="#000"/><script>alert(1)</script></svg>'
    await view.run(view.items()[0], '从剪贴板载入 SVG')
    await tick()
    const expected = optimizeSvgSource(host.clipboard.text).base64DataUri
    for (const item of view.items()) {
      const md = item.props.detail.props.markdown
      assert.ok(md.startsWith(`![清理后的 SVG 预览](${expected})`), item.props.id)
      assert.doesNotMatch(md.split('\n')[0], /<svg|<script/)
    }
    assert.doesNotMatch(Buffer.from(expected.split(',')[1], 'base64').toString(), /script/)
  } finally {
    view.unmount()
    globalThis.DOMParser = previous
  }
})

test('快捷键提示按平台区分：macOS 只写 ⌘Enter，Windows 写 Ctrl+Enter，不再出现 ⌘/Ctrl 混写', async () => {
  const { modEnterLabel } = await import('../dist/index.js')
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const setNav = value => Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true })
  try {
    setNav({ platform: 'MacIntel', userAgent: '' })
    assert.equal(modEnterLabel(), '⌘Enter')
    const mac = await mount(Command)
    try {
      const md = mac.item('svg-input').props.detail.props.markdown
      assert.match(md, /⌘Enter/); assert.doesNotMatch(md, /Ctrl|⌘\//)
    } finally { mac.unmount() }
    setNav({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0)' })
    assert.equal(modEnterLabel(), 'Ctrl+Enter')
    const win = await mount(Command)
    try { assert.doesNotMatch(win.item('svg-input').props.detail.props.markdown, /⌘/) } finally { win.unmount() }
    setNav(undefined)
    assert.equal(modEnterLabel(), 'Ctrl+Enter')
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original); else delete globalThis.navigator
  }
})
