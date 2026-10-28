// 真实 XML/CSS 解析、Vue/React 编译与渲染测试；依赖及命令见 README。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import { getDeclarativeBridge } from '@ztools/declarative-ui'
import Command, { optimizeSvgSource } from '../dist/index.js'
const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')
const tsc = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin/tsc')
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
const { parse, compileTemplate } = require('@vue/compiler-sfc')
const { createSSRApp } = require('vue'), { renderToString } = require('vue/server-renderer')
const browser = new JSDOM('')
globalThis.DOMParser = browser.window.DOMParser
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'svg-components-'))
fs.mkdirSync(path.join(root, 'node_modules'))
for (const name of ['react', 'vue']) fs.symlinkSync(path.dirname(require.resolve(name + '/package.json')), path.join(root, 'node_modules', name), 'junction')
const host = createHost(), views = []
const svg = body => `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`
const xml = source => new DOMParser().parseFromString(source, 'image/svg+xml')
let seq = 0
function loadCompiled(source, check = false) {
  const filename = path.join(root, `${seq++}.tsx`), config = filename + '.json'
  fs.writeFileSync(filename, source)
  fs.writeFileSync(config, JSON.stringify({ compilerOptions: { strict: true, noCheck: !check, noEmitOnError: true, jsx: 'react', target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', esModuleInterop: true, skipLibCheck: true, types: [], paths: { react: [path.join(path.dirname(require.resolve('@types/react/package.json')), 'index.d.ts')] } }, files: [filename] }))
  try { execFileSync(process.execPath, [tsc, '-p', config], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  catch (error) { throw new Error(`组件编译失败：${error.stdout || error.message}`) }
  return require(filename.replace(/\.tsx$/, '.js'))
}
async function renderComponents(result) {
  const react = renderToStaticMarkup(React.createElement(loadCompiled(result.reactTsxCode, true).default))
  const sfc = parse(result.vueSfcCode); assert.deepEqual(sfc.errors, [])
  const compiled = compileTemplate({ source: sfc.descriptor.template.content, filename: 'SvgIcon.vue', id: 'svg', ssr: true, ssrCssVars: [] })
  assert.deepEqual(compiled.errors, [])
  const vue = await renderToString(createSSRApp({ ssrRender: loadCompiled(compiled.code).ssrRender }))
  return [react, vue].map(xml)
}
test.afterEach(() => { views.splice(0).forEach(view => view.unmount()); host.reset() })
test.after(() => { browser.window.close(); fs.rmSync(root, { recursive: true, force: true }) })

test('真实编译及 SSR：文字、实体、花括号、换行和数值精度在三个格式一致', async () => {
  const source = svg('<a fill="red" transform="translate(1 2)"><title fill="red">标题</title><text>link</text></a><g id="p1.23456" stroke-width="1.23456"><text xml:space="preserve">  余额 123.4567 元 {1+1} {{7*7}} &amp;quot; &lt; &gt;\n换行  <tspan>中间</tspan> 尾部  </text><path d="M1.23456 2.34567L4 5"/></g>')
  const result = optimizeSvgSource(source), original = xml(source)
  for (const rendered of [xml(result.optimizedSvg), ...await renderComponents(result)]) {
    assert.equal(rendered.getElementsByTagName('parsererror').length, 0)
    assert.equal(rendered.getElementsByTagName('text')[1].textContent, original.getElementsByTagName('text')[1].textContent)
    assert.equal(rendered.getElementsByTagName('a')[0].getAttribute('fill'), 'red')
    assert.equal(rendered.getElementsByTagName('a')[0].getAttribute('transform'), 'translate(1 2)')
    assert.equal(rendered.getElementsByTagName('title')[0].textContent, '标题')
    assert.equal(rendered.getElementsByTagName('g')[0].getAttribute('id'), 'p1.23456')
    assert.equal(rendered.getElementsByTagName('g')[0].getAttribute('stroke-width'), '1.23456')
    assert.equal(rendered.getElementsByTagName('path')[0].getAttribute('d'), 'M1.23456 2.34567L4 5')
  }
  assert.equal(result.metrics.originalBytes, Buffer.byteLength(source))
  assert.equal(Buffer.from(result.base64DataUri.split(',')[1], 'base64').toString(), result.optimizedSvg)
  assert.equal(decodeURIComponent(result.dataUri.split(',')[1]), result.optimizedSvg)
})

test('样式使用真实 CSSOM，重复无效声明不覆盖有效值；React 属性类型正确', async () => {
  const result = optimizeSvgSource(svg('<g tabindex="-1" class="icon" style="fill:red;fill:not-a-color;stroke-width:1.23456"><filter><feConvolveMatrix preserveAlpha="true"/></filter><path d="M0 0h2"/></g>'))
  for (const rendered of [xml(result.optimizedSvg), ...await renderComponents(result)]) {
    const group = rendered.getElementsByTagName('g')[0]
    assert.equal(group.style.fill, 'red')
    assert.equal(group.style.strokeWidth, '1.23456')
  }
  for (const style of ['fill:not-a-color', 'fill:red!important', "font-family:'a;b'", 'background:url(https://example.invalid/x)', 'fill:u\\72l(x)']) assert.throws(() => optimizeSvgSource(svg(`<g style="${style}"/>`)), /STYLE/)
})

test('实体解码后移除可执行属性、外部链接、动画和外来命名空间，并明确提示', () => {
  const result = optimizeSvgSource(svg('<script>throw 1</script><foreignObject/><animate attributeName="href"/><a href="jav&#x61;script:alert(1)"><text>保留文字</text></a><g onload="alert(1)" xml:base="https://example.invalid/" fill="url(https://example.invalid/fill)" v-html="bad"/><path xmlns="urn:foreign" d="M0 0"/><?xml-stylesheet href="https://example.invalid/style"?>'))
  assert.doesNotMatch(result.optimizedSvg, /script|foreignObject|animate|onload|xml:base|v-html|example.invalid|urn:foreign/)
  assert.match(result.optimizedSvg, /保留文字/)
  assert.ok(result.metrics.removedItems >= 8); assert.ok(result.warnings.length)
  assert.throws(() => optimizeSvgSource(svg('<g style="fill:url(https://example.invalid/x)"/>')), /UNSAFE_STYLE/)
})

test('静态本地引用可用，重复 ID、缺失目标、引用循环和指数展开停止', async () => {
  const result = optimizeSvgSource(svg('<defs><path id="shape" d="M0 0h1"/><linearGradient id="grad"><stop offset="0" stop-color="red"/></linearGradient></defs><use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="#shape" fill="url(#grad)"/>'))
  assert.match(result.optimizedSvg, /href="#shape"/); await renderComponents(result)
  for (const body of ['<g id="same"/><g id="same"/>', '<use href="#missing"/>', '<g id="self"><use href="#self"/></g>', '<defs><use id="a" href="#b"/><use id="b" href="#a"/></defs>']) assert.throws(() => optimizeSvgSource(svg(body)), /ID|REFERENCE/)
  let expansion = '<g id="n0"><path/></g>'
  for (let i = 1; i < 16; i++) expansion += `<g id="n${i}"><use href="#n${i - 1}"/><use href="#n${i - 1}"/></g>`
  assert.throws(() => optimizeSvgSource(svg(expansion)), /SVG_COMPLEXITY_LIMIT/)
  const chain = ['<g id="c0"><path/></g>']
  for (let i = 1; i < 130; i++) chain.push(`<g id="c${i}"><use href="#c${i - 1}"/></g>`)
  for (const ordered of [chain, [...chain].reverse()]) assert.throws(() => optimizeSvgSource(svg(`<defs>${ordered.join('')}</defs>`)), /SVG_COMPLEXITY_LIMIT/)
})

test('XML 畸形与输入上限拒绝，自闭合 SVG 与体积增长如实显示', () => {
  for (const input of ['<svg><rect></svg>', '<svg/>garbage', '<svg/><svg/>', '<svg x="1" x="2"/>', '<svg xmlns="urn:fake"/>', '<svg>&unknown;</svg>', '<svg><parsererror xmlns="http://www.w3.org/1999/xhtml">解析错误</parsererror><rect/></svg>']) assert.throws(() => optimizeSvgSource(input), /INVALID_SVG_DOCUMENT/)
  assert.throws(() => optimizeSvgSource('<!DOCTYPE svg [<!ENTITY e "x">]><svg>&e;</svg>'), /UNSUPPORTED_DTD/)
  assert.throws(() => optimizeSvgSource(svg('x'.repeat(256 * 1024))), /SVG_SIZE_LIMIT/)
  assert.throws(() => optimizeSvgSource(svg('<g>'.repeat(65) + '</g>'.repeat(65))), /SVG_COMPLEXITY_LIMIT/)
  assert.throws(() => optimizeSvgSource(svg('<path/>'.repeat(5001))), /SVG_COMPLEXITY_LIMIT/)
  const empty = optimizeSvgSource('<svg/>')
  assert.equal(empty.metrics.viewBox, '未设置'); assert.ok(empty.metrics.savedBytes < 0)
  assert.match(empty.optimizedSvg, /xmlns=/)
})

test('声明式真实链路：四项结果分别复制；异常新输入清除旧结果；剪贴板校验后才报成功', async () => {
  const view = await mount(Command); views.push(view)
  host.clipboard.text = svg('<text>余额123.4567 ``` {{7*7}}</text>')
  const result = optimizeSvgSource(host.clipboard.text)
  await view.run(view.item('svg-input'), '从剪贴板载入 SVG')
  assert.match(host.lastToast().title, /已载入并校验/)
  assert.equal(view.items().length, 4); assert.equal(view.tree().props.searchBarAccessory, undefined)
  const expected = { svg: result.optimizedSvg, react: result.reactTsxCode, vue: result.vueSfcCode, uri: result.dataUri }
  for (const item of view.items()) {
    const action = view.actions(item)[0]
    await view.run(item, action.props.title)
    assert.equal(host.clipboard.text, expected[item.props.id])
  }
  await view.run(view.item('uri'), '复制 Base64 Data URI')
  assert.equal(host.clipboard.text, result.base64DataUri)
  assert.match(view.item('svg').props.detail.props.markdown, /^````xml/)
  host.clipboard.text = '<svg><g></svg>'
  await view.tree().props.filterBar.actions[0].onAction(); await tick()
  assert.match(host.lastToast().title, /未能载入/)
  assert.deepEqual(view.items().map(item => item.props.id), ['svg-input'])
  assert.match(view.text(), /INVALID_SVG_DOCUMENT/)
})


test('多行源码表单提交保留换行，格式筛选不修改源码，错误编辑不能替换已有结果', async () => {
  const view = await mount(Command); views.push(view)
  await view.run(view.item('svg-input'), '编辑源码')
  const form = await mountPushed(host); views.push(form)
  const source = svg('<text xml:space="preserve">第一行\n  第二行</text>')
  await form.fill('source', source)
  await form.run(null, '校验并生成')
  assert.match(view.item('svg').props.detail.props.markdown, /第一行\n  第二行/)
  await view.search('vue'); assert.deepEqual(view.items().map(item => item.props.id), ['vue'])
  await view.search(''); await view.tree().props.filterBar.actions[1].onAction(); await tick()
  const badForm = await mountPushed(host); views.push(badForm)
  assert.equal(badForm.field('source').props.value, source)
  await badForm.fill('source', '<svg><path></svg>')
  await badForm.run(null, '校验并生成')
  assert.match(host.lastToast().title, /校验未通过/)
  assert.equal(host.pushed.length, 1)
  assert.match(view.item('svg').props.detail.props.markdown, /第一行\n  第二行/)
})

test('延迟剪贴板读取不能覆盖新编辑；卸载丢弃回包；读取失败不假报成功', async () => {
  const bridge = getDeclarativeBridge(), read = bridge.readClipboardText
  let resolve
  try {
    bridge.readClipboardText = () => new Promise(done => { resolve = done })
    const view = await mount(Command); views.push(view)
    await view.run(view.item('svg-input'), '从剪贴板载入 SVG')
    await view.run(view.item('svg-input'), '编辑源码')
    const form = await mountPushed(host); views.push(form)
    await form.fill('source', svg('<text>新的编辑</text>')); await form.run(null, '校验并生成')
    resolve(svg('<text>过期剪贴板</text>')); await tick()
    assert.match(view.text(), /新的编辑/); assert.doesNotMatch(view.text(), /过期剪贴板/)
    assert.equal(host.toasts.length, 0)
    await view.tree().props.filterBar.actions[0].onAction(); await tick()
    view.unmount(); resolve(svg('<text>卸载后返回</text>')); await tick()
    assert.equal(host.toasts.length, 0)
    bridge.readClipboardText = async () => { throw new Error('读取失败测试') }
    const failed = await mount(Command); views.push(failed)
    await failed.run(failed.item('svg-input'), '从剪贴板载入 SVG')
    assert.match(host.lastToast().title, /未能载入/)
    assert.match(host.lastToast().message, /读取失败测试/)
  } finally { bridge.readClipboardText = read }
})
