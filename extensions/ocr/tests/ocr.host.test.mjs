// 文字识别：宿主调用契约（语言、超时、取消与失败如实返回）、无界面命令与工作台交互
import test from 'node:test'
import assert from 'node:assert/strict'
import { Cache } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import * as ocr from '../dist/index.js'

const host = createHost()
// 识别结果放在 useCachedState 的内存缓存里（重新打开插件仍可看到），每个用例前清空
test.beforeEach(() => { host.reset(); new Cache({ namespace: '@raycast/utils.useCachedPromise' }).clear() })

// 客户端 image_ocr 直接返回识别服务的结果对象
const hostResult = rec => ({ ...rec })
const recognized = text => hostResult({ ok: true, success: true, text, lines: text.split('\n'), engine: 'Apple Vision' })
const failed = (error, extra = {}) => hostResult({ ok: false, success: false, error, ...extra })

function ocrCalls() {
  return host.ipcCalls.filter(([method]) => method === 'image_ocr').map(([, params]) => params)
}

/** 记录每次调用携带的超时（测试宿主只记录 params） */
function captureTimeouts() {
  const methods = globalThis.__ztoolsElectron.transport.methods
  const timeouts = []
  globalThis.__ztoolsElectron = { transport: { methods: new Proxy({}, { get: (_t, name) => req => { timeouts.push([name, req.timeoutMs]); return methods[name](req) } }) } }
  return { timeouts, restore: () => { globalThis.__ztoolsElectron = { transport: { methods } } } }
}

test('截图识别：识别成功后复制并发系统通知，按保存的语言识别，等待时长足够用户框选', async () => {
  host.storage.set('language', JSON.stringify('ja'))
  host.ipc.image_ocr = () => recognized('第一行\n第二行')
  host.ipc.system_notify = () => ({ success: true })
  const probe = captureTimeouts()
  try {
    const message = await ocr.ocrRegion()
    assert.equal(message, '已复制 6 个字')
    assert.equal(host.clipboard.text, '第一行\n第二行')
    assert.deepEqual(ocrCalls(), [{ action: 'captureRegion', lang: 'ja-JP', restoreWindow: false }])
    const notice = host.ipcCalls.find(([method]) => method === 'system_notify')[1]
    assert.equal(notice.title, '已复制识别的文字')
    assert.equal(notice.message, '第一行')
    const [, timeout] = probe.timeouts.find(([name]) => name === 'image_ocr')
    assert.ok(timeout >= 120_000, `框选超时 ${timeout} 太短`)
  } finally { probe.restore() }
})

test('截图识别：用户取消不报错也不改剪贴板；识别失败抛出宿主原因；通知失败不影响结果', async () => {
  host.clipboard.text = '原有内容'
  host.ipc.image_ocr = () => failed('已取消框选', { canceled: true })
  assert.equal(await ocr.ocrRegion(), '已取消框选')
  assert.equal(host.clipboard.text, '原有内容')

  host.ipc.image_ocr = () => failed('没有屏幕录制权限，请在系统设置的「隐私与安全性」中允许 ZTools 录制屏幕')
  await assert.rejects(ocr.ocrRegion(), /没有屏幕录制权限/)
  assert.equal(host.clipboard.text, '原有内容')

  host.ipc.image_ocr = () => failed('没有识别到文字', { empty: true })
  await assert.rejects(ocr.ocrRegion(), /没有识别到文字/)

  host.ipc.image_ocr = () => recognized('ABC')
  host.ipc.system_notify = () => { throw new Error('通知被系统关闭') }
  assert.equal(await ocr.ocrRegion(), '已复制 3 个字')
  assert.equal(host.clipboard.text, 'ABC')
})

test('识别剪贴板图片：没有图片、宿主异常都如实报错；成功复制结果', async () => {
  host.ipc.image_ocr = () => failed('剪贴板里没有图片')
  await assert.rejects(ocr.ocrClipboard(), /剪贴板里没有图片/)
  host.ipc.image_ocr = () => { throw Object.assign(new Error('请求超时'), { code: 'REQUEST_TIMEOUT' }) }
  await assert.rejects(ocr.ocrClipboard(), /请求超时/)
  host.ipc.image_ocr = () => recognized('Invoice 2026')
  assert.equal(await ocr.ocrClipboard(), '已复制 11 个字')
  assert.deepEqual(ocrCalls().at(-1), { action: 'recognizeClipboard', lang: 'zh-Hans-CN' })
})

test('不在客户端中运行时明确报错，不返回示例数据', async () => {
  const saved = globalThis.__ztoolsElectron
  delete globalThis.__ztoolsElectron
  try {
    await assert.rejects(ocr.ocrRegion(), /需要在 ZTools 客户端中使用/)
    const view = await mount(ocr.OcrCommand)
    assert.equal(view.tree().props.filterBar.summaryText, '需要在 ZTools 客户端中使用')
    assert.equal(view.tree().props.filterBar.actions.length, 0)
    assert.equal(view.items().length, 0)
    view.unmount()
  } finally { globalThis.__ztoolsElectron = saved }
})

test('工作台：添加多张图片逐张识别，失败的标出原因，结果可看全文、复制、搜索', async () => {
  host.ipc.window_show_open_dialog = () => ({ canceled: false, filePaths: [{ path: '/Users/me/a.png' }, { path: '/Users/me/b.heic' }] })
  host.ipc.image_ocr = params => params.path === '/Users/me/a.png' ? recognized('合同编号 A-17\n金额 300 元') : failed('无法读取图片')
  const view = await mount(ocr.OcrCommand)
  assert.equal(view.items().length, 0)
  await view.run(null, '添加图片')
  await tick(10)

  const dialog = host.ipcCalls.find(([method]) => method === 'window_show_open_dialog')[1]
  assert.deepEqual(dialog.properties, ['openFile', 'multiSelections'])
  assert.match(dialog.filters, /\*\.heic/)
  assert.deepEqual(ocrCalls().map(call => call.path), ['/Users/me/a.png', '/Users/me/b.heic'])

  const ok = view.item(item => item.props.title === 'a.png')
  assert.equal(ok.props.subtitle, '合同编号 A-17')
  assert.deepEqual(ok.props.accessories, [{ text: '14 字' }])
  assert.match(ok.props.detail.props.markdown, /^```text\n合同编号 A-17\n金额 300 元\n```$/)
  const bad = view.item(item => item.props.title === 'b.heic')
  assert.equal(bad.props.subtitle, '无法读取图片')
  assert.deepEqual(bad.props.accessories, [{ tag: '失败' }])
  assert.match(view.tree().props.filterBar.summaryText, /^1 条识别结果/)
  assert.equal(host.lastToast().title, '1 张识别成功，1 张失败')

  await view.run(ok, '复制文字')
  assert.equal(host.clipboard.text, '合同编号 A-17\n金额 300 元')
  assert.ok(!view.actions(bad).some(action => action.props.title === '复制文字'), '失败的条目不能提供复制')

  await view.search('300 元')
  assert.deepEqual(view.items().map(item => item.props.title), ['a.png'])
  view.unmount()
})

test('工作台：取消选择图片不调用识别；对话框打不开如实提示', async () => {
  host.ipc.window_show_open_dialog = () => ({ canceled: true })
  host.ipc.image_ocr = () => recognized('不该被调用')
  const view = await mount(ocr.OcrCommand)
  await view.run(null, '添加图片')
  assert.equal(ocrCalls().length, 0)
  assert.equal(view.items().length, 0)

  host.ipc.window_show_open_dialog = () => { throw new Error('对话框被系统拒绝') }
  await view.run(null, '添加图片')
  assert.equal(host.lastToast().title, '无法打开选择图片窗口')
  assert.equal(host.lastToast().message, '对话框被系统拒绝')
  view.unmount()
})

test('工作台：切换语言会保存，下次识别和无界面命令都用新语言；重新识别失败的图片', async () => {
  let attempts = 0
  host.ipc.window_show_open_dialog = () => ({ canceled: false, filePath: '/Users/me/scan.jpg' })
  host.ipc.image_ocr = () => (++attempts === 1 ? failed('本地OCR执行失败') : recognized('Hello'))
  const view = await mount(ocr.OcrCommand)
  await view.dropdown('en')
  await tick()
  assert.equal(host.storage.get('language'), JSON.stringify('en'))
  await view.run(null, '添加图片')
  await tick(10)
  const entry = view.item(item => item.props.title === 'scan.jpg')
  assert.equal(entry.props.subtitle, '本地OCR执行失败')
  await view.run(entry, '重新识别')
  await tick(10)
  assert.equal(view.item(item => item.props.title === 'scan.jpg').props.subtitle, 'Hello')
  assert.deepEqual(ocrCalls().map(call => call.lang), ['en-US', 'en-US'])

  host.ipc.image_ocr = () => recognized('x')
  await ocr.ocrClipboard()
  assert.equal(ocrCalls().at(-1).lang, 'en-US')
  view.unmount()
})

test('工作台：截图识别成功加入列表并复制，取消不留下空条目；处理中重复触发被忽略', async () => {
  let release
  host.ipc.image_ocr = () => new Promise(resolve => { release = resolve })
  const view = await mount(ocr.OcrCommand)
  const first = view.run(null, '截图识别')
  await tick()
  await view.run(null, '截图识别')
  assert.equal(ocrCalls().length, 1, '框选进行中不能再开第二个')
  release(failed('已取消框选', { canceled: true }))
  await first
  await tick()
  assert.equal(view.items().length, 0)

  host.ipc.image_ocr = () => recognized('框选出的文字')
  await view.run(null, '截图识别')
  await tick()
  assert.equal(view.items().length, 1)
  assert.equal(ocrCalls().at(-1).restoreWindow, true, '工作台框选后要重新显示窗口查看结果')
  assert.equal(host.clipboard.text, '框选出的文字')
  assert.equal(host.lastToast().title, '已识别并复制')
  view.unmount()
})

test('结果解析：多层 data、空文字、宿主报错与围栏里的反引号', () => {
  assert.deepEqual(ocr.toOutcome(ocr.unwrapHostResponse({ success: true, data: recognized('  A  ') })), { ok: true, text: 'A' })
  assert.deepEqual(ocr.toOutcome({ ok: true, success: true, text: '   ' }), { ok: false, empty: true, error: '没有识别到文字' })
  assert.throws(() => ocr.unwrapHostResponse({ success: false, error: { code: 'PERMISSION_DENIED', message: '插件只能访问自身对应的能力' } }), /插件只能访问/)
  assert.throws(() => ocr.unwrapHostResponse(null), /无效结果/)
  const markdown = ocr.textAsMarkdown('a ``` b')
  assert.ok(markdown.startsWith('````text\n') && markdown.endsWith('\n````'))
  assert.equal(ocr.resolveLanguage('不存在').id, 'zh-hans')
})
