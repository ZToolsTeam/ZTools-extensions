import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import FontManager, { commands, PreviewTextForm } from '../dist/index.js'
import { cssFontFamily, filterFonts, licenseUrl, previewMarkdown, validatePreviewText } from '../dist/font-service.js'
const host = createHost(), views = []
const fonts = [
  { id: 'Winter', family: 'Winter', style: 'Regular', filePath: '/tmp/font.ttf', hasLicense: false, system: false },
  { id: 'Example', family: 'Example', style: 'Bold', filePath: '/tmp/font2.ttf', hasLicense: true, system: true }
]
const preview = id => ({ id, png: 'fixture', fallbacks: [], license: '仅测试许可元数据', licenseUrl: '', copyright: '', manufacturer: '' })
const delay = () => new Promise(resolve => setTimeout(resolve, 200))
async function open(command = FontManager, props) { const view = await mount(command, props); views.push(view); await tick(); return view }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { resolve, promise } }
test.beforeEach(() => { host.reset(); host.ipc.font_manager = async p => p.action === 'list' ? { success: true, fonts } : p.action === 'preview' ? { success: true, preview: preview(p.id) } : { success: true, revealRequested: true }; host.ipc.font_manager_cancel = async () => ({ success: true, cancelRequested: true }) })
test.afterEach(() => views.splice(0).forEach(v => v.unmount()))
test('名称相似不推断免费商用；真实字体列表与三个入口一致', async () => {
  const view = await open(); assert.equal(view.items().length, 2); assert.doesNotMatch(view.text(), /免费商用|安全合规|侵权|0 款/)
  assert.equal(filterFonts(fonts, 'with-license', '').length, 1); assert.equal(filterFonts(fonts, 'without-license', '')[0].id, 'Winter')
  assert.equal(filterFonts(fonts, 'all', 'bold')[0].id, 'Example')
  const manifest = JSON.parse(fs.readFileSync(new URL('../plugin.json', import.meta.url)))
  assert.deepEqual(Object.keys(commands).sort(), manifest.features.map(f => f.code).sort())
})
test('刷新失败保留列表并显示失败，不清空成 0 字体', async () => {
  const v = await open(); host.ipc.font_manager = async () => { throw new Error('系统字体读取失败') }
  await v.tree().props.filterBar.actions[1].onAction(); await tick()
  assert.equal(v.items().length, 2); assert.match(v.text(), /系统字体读取失败/)
})
test('选中样式和自定义文字实际送往预览接口，过期结果不能覆盖新选择', async () => {
  const v = await open(), old = deferred(); host.ipc.font_manager = async p => p.id === 'Winter' ? old.promise : { success: true, preview: preview(p.id) }
  await delay(); v.tree().props.onSelectionChange('Example'); await tick(); await delay()
  old.resolve({ success: true, preview: preview('Winter') }); await tick()
  assert.equal(v.tree().props.selectedItemId, 'Example')
  assert.match(v.item('Example').props.detail.props.markdown, /data:image\/png/)
  assert.ok(host.ipcCalls.some(([method]) => method === 'font_manager_cancel'))
})
test('预览错误明确显示，卸载取消在途任务', async () => {
  const v = await open(); host.ipc.font_manager = async () => { throw new Error('字体已失效') }; await delay(); await tick()
  assert.match(v.item('Winter').props.detail.props.markdown, /字体已失效/)
  const pending = deferred(); host.ipc.font_manager = () => pending.promise
  v.tree().props.onSelectionChange('Example'); await tick(); await delay(); v.unmount(); pending.resolve({ success: true, preview: preview('Example') }); await tick()
  assert.ok(host.ipcCalls.some(([m]) => m === 'font_manager_cancel')); assert.equal(host.toasts.length, 0)
})
test('预览文案校验、CSS 转义、许可链接限制与缺字提示', () => {
  assert.equal(validatePreviewText('中文 ABC'), '中文 ABC'); assert.throws(() => validatePreviewText(' ')); assert.throws(() => validatePreviewText('a'.repeat(161)))
  assert.equal(cssFontFamily('A"B'), 'font-family: "A\\"B", sans-serif;')
  assert.equal(licenseUrl('javascript:alert(1)'), undefined); assert.equal(licenseUrl('file:///tmp/font'), undefined)
  assert.match(previewMarkdown({ ...preview('Winter'), fallbacks: ['PingFangSC-Regular'] }), /PingFangSC/)
  assert.match(previewMarkdown({ ...preview('Winter'), coverageWarning: '缺少字符，可能显示方框' }), /可能显示方框/)
})
test('旧宿主提示升级，不调用 DLL 或伪造字体', async () => {
  globalThis.__ztoolsElectron.transport.methods = {}; const v = await open()
  assert.equal(v.items().length, 0); assert.match(v.text(), /升级/); assert.equal(host.ipcCalls.length, 0)
})

test('自定义预览表单传回实际输入，并拒绝空白内容', async () => {
  let saved = ''
  const v = await open(() => PreviewTextForm({ initial: '初始文字', save: text => { saved = text } }))
  const field = () => v.tree().children.find(node => node.type === 'Form.TextArea')
  field().props.onChange(' '); await tick(); await v.actions()[0].props.onSubmit(); assert.equal(saved, ''); assert.match(host.lastToast().title, /请输入/)
  field().props.onChange('ZTools 字体 123'); await tick(); await v.actions()[0].props.onSubmit(); assert.equal(saved, 'ZTools 字体 123')
})
