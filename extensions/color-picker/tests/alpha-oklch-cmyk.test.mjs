import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount } from '../../shared/test-harness.mjs'
import ColorPickerCommand from '../dist/index.js'
import { parseColor, rgbToOklch, generateColorSwatchSvg } from '../dist/converter.js'

const host = createHost()
test.beforeEach(() => host.reset())

const titleOf = (view, id) => view.item(id).props.title
// 只解码色块的 data URL，正文里的「50%」等不是 URI 编码
const markdownOf = (view, id) =>
  view.item(id).props.detail.props.markdown.replace(/data:image\/svg\+xml;utf8,([^)]+)/, (_m, svg) => decodeURIComponent(svg))

// ---------- color-picker-5：透明度不能丢 ----------

test('透明度：rgba / hsla / #RRGGBBAA 输入时，各行都保留透明度，复制得到带透明度的写法', async () => {
  const view = await mount(ColorPickerCommand)
  for (const input of ['rgba(255, 0, 0, 0.5)', 'hsla(0, 100%, 50%, 0.5)', '#FF000080', '#ff000080']) {
    await view.search(input)
    assert.equal(titleOf(view, 'fmt-hex8'), '#FF000080', input)
    assert.equal(titleOf(view, 'fmt-rgb'), 'rgba(255, 0, 0, 0.5)', input)
    assert.equal(titleOf(view, 'fmt-hsl'), 'hsla(0, 100%, 50%, 0.5)', input)
    assert.equal(titleOf(view, 'fmt-oklch'), 'oklch(62.8% 0.2577 29.23 / 0.5)', input)
    assert.equal(titleOf(view, 'fmt-tailwind'), 'bg-[#FF000080]', input)
    assert.equal(titleOf(view, 'fmt-css-var'), '--color-primary: #FF000080;', input)
    assert.ok(view.text().includes('#FF000080 的各种写法'), input)
    // 色块按半透明绘制，并提示透明度
    const md = markdownOf(view, 'fmt-hex')
    assert.match(md, /fill-opacity="0\.502"/, input)
    assert.match(md, /透明度\*\* 50%/, input)
  }
  await view.run(view.item('fmt-rgb'), '复制')
  assert.equal(host.clipboard.text, 'rgba(255, 0, 0, 0.5)')
  await view.run(view.item('fmt-tailwind'), '复制')
  assert.equal(host.clipboard.text, 'bg-[#FF000080]')
})

test('透明度：不透明颜色的写法保持不变（不出现 rgba / 8 位 HEX）', async () => {
  const view = await mount(ColorPickerCommand)
  for (const input of ['#FF0000', 'rgb(255, 0, 0)', 'rgba(255, 0, 0, 1)', '#FF0000FF', 'hsl(0, 100%, 50%)']) {
    await view.search(input)
    assert.equal(titleOf(view, 'fmt-rgb'), 'rgb(255, 0, 0)', input)
    assert.equal(titleOf(view, 'fmt-hsl'), 'hsl(0, 100%, 50%)', input)
    assert.equal(titleOf(view, 'fmt-oklch'), 'oklch(62.8% 0.2577 29.23)', input)
    assert.equal(titleOf(view, 'fmt-hex8'), '#FF0000FF', input)
    assert.equal(titleOf(view, 'fmt-tailwind'), 'bg-[#FF0000]', input)
    assert.equal(titleOf(view, 'fmt-css-var'), '--color-primary: #FF0000;', input)
    assert.ok(!markdownOf(view, 'fmt-hex').includes('透明度**'), input)
  }
})

test('[边界] 透明度越界、为 0、为空时的处理', () => {
  // 大于 1 裁剪为不透明，负号不被接受
  assert.equal(parseColor('rgba(255, 0, 0, 5)').hex8, '#FF0000FF')
  assert.equal(parseColor('rgba(255, 0, 0, 5)').hasAlpha, false)
  assert.equal(parseColor('rgba(255, 0, 0, -0.5)').isValid, false)
  // 完全透明
  const zero = parseColor('rgba(255, 0, 0, 0)')
  assert.equal(zero.hex8, '#FF000000')
  assert.equal(zero.cssRgba, 'rgba(255, 0, 0, 0)')
  assert.equal(zero.cssVar, '--color-primary: #FF000000;')
  // 写成 "." 之类无法解析的透明度按不透明处理，不产生 NaN
  const dot = parseColor('rgba(1, 2, 3, .)')
  assert.equal(dot.hex8, '#010203FF')
  assert.ok(!/NaN/.test(JSON.stringify(dot)))
  // 8 位字节换成能还原同一字节的最短小数
  assert.equal(parseColor('#FF000081').cssRgba, 'rgba(255, 0, 0, 0.506)')
  assert.equal(parseColor(parseColor('#FF000081').cssRgba).hex8, '#FF000081')
  assert.equal(parseColor('#F008').hex8, '#FF000088')
  // 非法 HEX 不被当成颜色
  assert.equal(parseColor('#FF00008G').isValid, false)
  // 色块：不透明时没有棋盘格
  assert.ok(!decodeURIComponent(generateColorSwatchSvg('#FF0000')).includes('checker'))
  assert.ok(decodeURIComponent(generateColorSwatchSvg('#FF000080')).includes('checker'))
  // data URL 里不能有原始括号，否则会提前结束 Markdown 图片链接 ![](...)
  for (const hex of ['#FF0000', '#FF000080']) assert.ok(!/[()]/.test(generateColorSwatchSvg(hex)), hex)
})

test('透明度：半透明颜色收藏到调色板后保留 8 位 HEX；损坏的条目被丢弃', async () => {
  host.storage.set(
    'color_picker_palette',
    JSON.stringify([
      { id: 'old', name: '#111111', hex: '#111111', savedAt: '' },
      { id: 'broken', name: 'x', hex: '#FF00008', savedAt: '' }
    ])
  )
  let view = await mount(ColorPickerCommand)
  await view.search('rgba(255, 0, 0, 0.5)')
  await view.run(view.item('fmt-hex'), '收藏到调色板')
  assert.match(String(host.lastToast().title), /已收藏 #FF000080/)
  const stored = JSON.parse(host.storage.get('color_picker_palette'))
  assert.deepEqual(stored.map((c) => c.hex), ['#FF000080', '#111111'])
  view.unmount()

  view = await mount(ColorPickerCommand)
  const saved = view.items().find((i) => i.props.title === '#FF000080')
  assert.ok(saved, '重新打开后半透明颜色仍在调色板里')
  assert.equal(saved.props.subtitle, 'rgba(255, 0, 0, 0.5)')
  assert.ok(!view.items().some((i) => i.props.id === 'broken'), '损坏的条目不显示')
  await view.run(saved, '查看各种写法')
  assert.equal(titleOf(view, 'fmt-rgb'), 'rgba(255, 0, 0, 0.5)')
})

test('[故障注入] 收藏半透明颜色时存储写入失败，提示失败且不改动已有数据', async () => {
  host.storage.set('color_picker_palette', JSON.stringify([{ id: 'old', name: '#111111', hex: '#111111', savedAt: '' }]))
  const view = await mount(ColorPickerCommand)
  host.faults.storageWrite = new Error('磁盘已满')
  await view.search('#FF000080')
  await view.run(view.item('fmt-hex'), '收藏到调色板')
  assert.match(String(host.lastToast().title), /收藏失败/)
  assert.deepEqual(JSON.parse(host.storage.get('color_picker_palette')).map((c) => c.hex), ['#111111'])
})

// ---------- color-picker-6：OKLCH / CMYK 能输入 ----------

test('OKLCH / CMYK：插件自己输出的写法粘回去能识别，并换算回同一颜色', async () => {
  const view = await mount(ColorPickerCommand)
  for (const hex of ['#FF0000', '#00FF00', '#0000FF', '#0A84FF', '#FFA500', '#808080', '#000000', '#FFFFFF', '#123456']) {
    await view.search(hex)
    const oklch = titleOf(view, 'fmt-oklch')
    const cmyk = titleOf(view, 'fmt-cmyk')
    await view.search(oklch)
    assert.ok(!view.text().includes('无法识别'), oklch)
    assert.equal(titleOf(view, 'fmt-hex'), hex, `${hex} → ${oklch}`)
    // CMYK 输出按整数百分比取整（1% ≈ 2.55 个色阶），换算回来每个通道最多差 2
    await view.search(cmyk)
    assert.ok(!view.text().includes('无法识别'), cmyk)
    const a = parseColor(hex).rgb
    const b = parseColor(titleOf(view, 'fmt-hex')).rgb
    for (const ch of ['r', 'g', 'b']) assert.ok(Math.abs(a[ch] - b[ch]) <= 2, `${hex} → ${cmyk} 通道 ${ch}`)
  }
  // 识别后可直接复制换算结果
  await view.search('oklch(62.8% 0.2577 29.23)')
  await view.run(view.item('fmt-hex'), '复制')
  assert.equal(host.clipboard.text, '#FF0000')
  await view.search('cmyk(0%, 100%, 100%, 0%)')
  await view.run(view.item('fmt-rgb'), '复制')
  assert.equal(host.clipboard.text, 'rgb(255, 0, 0)')
})

test('OKLCH / CMYK：CSS Color 4 的其他常见写法', () => {
  for (const input of ['oklch(0.628 0.2577 29.23)', 'OKLCH(62.8% 0.2577 29.23deg)', 'oklch(62.8%, 0.2577, 29.23)', 'oklch(62.8% 64.425% 29.23)']) {
    assert.equal(parseColor(input).hex, '#FF0000', input)
  }
  assert.equal(parseColor('oklch(100% 0 none)').hex, '#FFFFFF')
  assert.equal(parseColor('oklch(62.8% 0.2577 29.23 / 50%)').hex8, '#FF000080')
  assert.equal(parseColor('oklch(62.8% 0.2577 29.23 / 0.5)').hex8, '#FF000080')
  assert.equal(parseColor('oklch(62.8% 0.2577 389.23)').hex, '#FF0000', '色相按 360° 取模')
  for (const input of ['cmyk(0, 100, 100, 0)', 'cmyk(0 100 100 0)', 'CMYK(0%,100%,100%,0%)', 'cmyk(0.0%, 100.0%, 100%, 0%)']) {
    assert.equal(parseColor(input).hex, '#FF0000', input)
  }
  assert.equal(rgbToOklch(parseColor('oklch(59.99% 0 none)').rgb).css, 'oklch(59.99% 0 none)')
})

test('[边界] OKLCH 超出 sRGB 色域时裁剪并在标题提示；数值越界裁剪', async () => {
  const wide = parseColor('oklch(70% 0.4 150)')
  assert.equal(wide.isValid, true)
  assert.equal(wide.outOfGamut, true)
  assert.ok(/^#[0-9A-F]{6}$/.test(wide.hex))
  assert.equal(parseColor('oklch(62.8% 0.2577 29.23)').outOfGamut, false)
  // L 超过 100% 按 100% 处理，负的色度按 0 处理
  assert.equal(parseColor('oklch(150% 0 0)').hex, '#FFFFFF')
  assert.equal(parseColor('oklch(50% -0.3 0)').hex, parseColor('oklch(50% 0 0)').hex)
  // CMYK 分量裁剪到 0..100
  assert.equal(parseColor('cmyk(-10%, 150%, 100%, 0%)').hex, '#FF0000')

  const view = await mount(ColorPickerCommand)
  await view.search('oklch(70% 0.4 150)')
  assert.ok(view.text().includes('超出 sRGB 色域'))
  await view.search('oklch(62.8% 0.2577 29.23)')
  assert.ok(!view.text().includes('超出 sRGB 色域'))
})

test('[异常输入] 不完整或畸形的 OKLCH / CMYK 显示无法识别，不抛错', async () => {
  const view = await mount(ColorPickerCommand)
  for (const bad of [
    'oklch(62.8% 0.2577)',
    'oklch(a b c)',
    'oklch(62.8% 0.2577 29.23 / )',
    'oklch(62.8% 0.2577 29.23',
    'oklch()',
    'cmyk(0%, 100%, 100%)',
    'cmyk(0%, 100%, 100%, 0%, 5%)',
    'cmyk(x, y, z, k)',
    'cmyk(1e999, 0, 0, 0)'
  ]) {
    assert.equal(parseColor(bad).isValid, false, bad)
    await view.search(bad)
    assert.ok(view.text().includes('无法识别'), bad)
    assert.throws(() => view.item('fmt-hex'), undefined, bad)
  }
})
