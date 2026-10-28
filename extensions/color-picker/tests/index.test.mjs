import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import ColorPickerCommand from '../dist/index.js'
import { parseColor, rgbToOklch, calculateContrast } from '../dist/converter.js'

const host = createHost()
test.beforeEach(() => host.reset())

test('OKLCH 与 CSS Color 4 参考值一致', () => {
  const ref = { '#FF0000': 'oklch(62.8% 0.2577 29.23)', '#00FF00': 'oklch(86.64% 0.2948 142.5)', '#0000FF': 'oklch(45.2% 0.3132 264.05)', '#FFFFFF': 'oklch(100% 0 none)', '#808080': 'oklch(59.99% 0 none)' }
  for (const [hex, css] of Object.entries(ref)) assert.equal(rgbToOklch(parseColor(hex).rgb).css, css)
})

test('多种输入写法得到同一颜色；非法输入标记为无效', () => {
  for (const input of ['#0A84FF', '0a84ff', 'rgb(10, 132, 255)']) assert.equal(parseColor(input).hex, '#0A84FF')
  assert.equal(parseColor('#abc').hex, '#AABBCC')
  assert.equal(parseColor('orange').hex, '#FFA500')
  for (const bad of ['', 'nonsense', '#12345', 'rgb(300,0,0,0,0)']) assert.equal(parseColor(bad).isValid, false, bad)
  assert.equal(Math.round(calculateContrast({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })), 21)
})

test('界面：没有示例调色板与屏幕吸色按钮；输入颜色后可复制各种写法', async () => {
  const view = await mount(ColorPickerCommand)
  assert.ok(!view.text().includes('ZTools Accent Blue'))
  assert.ok(!view.text().includes('吸色') && !view.text().includes('Eyedropper'))
  await view.search('#FF0000')
  await view.run(view.item('fmt-oklch'), '复制')
  assert.equal(host.clipboard.text, 'oklch(62.8% 0.2577 29.23)')
})

test('收藏到调色板会持久化；清空需要确认', async () => {
  let view = await mount(ColorPickerCommand)
  await view.search('#0A84FF')
  await view.run(view.item('fmt-hex'), '收藏到调色板')
  view.unmount()
  view = await mount(ColorPickerCommand)
  const saved = view.items().find((i) => i.props.title === '#0A84FF' && i.props.icon === 'star')
  assert.ok(saved, '重新打开后仍在调色板里')
  host.setConfirm(false)
  await view.run(saved, '清空调色板')
  assert.equal(JSON.parse(host.storage.get('color_picker_palette')).length, 1)
})

test('[故障注入] 读取调色板失败时提示；此时收藏不会用空列表覆盖已有数据', async () => {
  host.storage.set('color_picker_palette', JSON.stringify([{ id: 'c1', name: '#111111', hex: '#111111', savedAt: '' }]))
  host.faults.storageRead = new Error('数据库被占用')
  const view = await mount(ColorPickerCommand)
  assert.ok(host.toasts.some((t) => /读取调色板失败/.test(String(t.title))))
  await view.search('#222222')
  await view.run(view.item('fmt-hex'), '收藏到调色板')
  assert.match(String(host.lastToast().title), /收藏失败/)
  assert.equal(JSON.parse(host.storage.get('color_picker_palette')).length, 1)
})

test('从调色板移除单个颜色需要确认：取消不删，确认后才删', async () => {
  host.storage.set('color_picker_palette', JSON.stringify([
    { id: 'c1', name: '#111111', hex: '#111111', savedAt: '' },
    { id: 'c2', name: '#222222', hex: '#222222', savedAt: '' }
  ]))
  const view = await mount(ColorPickerCommand)
  await tick(5)
  host.setConfirm(false)
  await view.run(view.item('c1'), '从调色板移除')
  assert.equal(host.confirms.at(-1).title, '从调色板移除 #111111？')
  assert.equal(JSON.parse(host.storage.get('color_picker_palette')).length, 2)
  host.setConfirm(true)
  await view.run(view.item('c1'), '从调色板移除')
  assert.deepEqual(JSON.parse(host.storage.get('color_picker_palette')).map((c) => c.id), ['c2'])
  assert.equal(host.lastToast().title, '已移除 #111111')
})
