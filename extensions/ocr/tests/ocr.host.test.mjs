// 图片识字：宿主调用契约（语言代码、失败如实返回、导出授权与不覆盖、剪贴板结果）与界面行为
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import * as ocr from '../dist/index.js'

const host = createHost()
test.beforeEach(() => host.reset())

// 与客户端内置文字识别服务的返回形状一致：结果对象再套一层 data
const hostOk = rec => ({ ...rec, data: { ...rec } })
const hostFail = error => hostOk({ ok: false, success: false, error })

const image = (name, extra = {}) => ({
  id: `id-${name}`,
  name,
  path: `D:\\Pics\\${name}`,
  parentDir: 'D:\\Pics',
  extension: '.png',
  sizeBytes: 1024,
  recognizedText: '',
  status: 'pending',
  ...extra
})

function installScan() {
  host.ipc.system_get_path = ({ name }) => (name === 'pictures' ? 'D:\\Pics' : '')
  host.ipc.system_search_files = ({ query }) =>
    query === 'dir:D:\\Pics'
      ? { files: [{ name: 'invoice.png', path: 'D:\\Pics\\invoice.png', is_dir: false, size: 128000, mtime: 1700000000 }], total_matches: 1 }
      : { files: [] }
}

function ocrCalls() {
  return host.ipcCalls.filter(([m]) => m === 'dllplugin_call').map(([, p]) => p)
}

test('扫描只返回真实图片；拿不到任何文件夹路径时报错，不补示例数据', async () => {
  installScan()
  const snap = await ocr.fetchOcrQueueSnapshot()
  assert.equal(snap.items.length, 1)
  assert.equal(snap.items[0].path, 'D:\\Pics\\invoice.png')
  assert.equal(snap.items[0].status, 'pending')
  assert.equal(snap.error, undefined)

  host.reset()
  host.ipc.system_get_path = () => { throw new Error('不可用') }
  const failed = await ocr.fetchOcrQueueSnapshot()
  assert.deepEqual(failed.items, [])
  assert.match(failed.error, /无法获取/)
  assert.equal(ocr.INITIAL_OCR_QUEUE_ITEMS, undefined)
})

test('识别语言按语言代码传给客户端：默认简体中文不会被当成英文', async () => {
  host.ipc.dllplugin_call = () => hostOk({ ok: true, success: true, text: '你好' })
  host.ipc.clipboard_copy_text = () => true
  for (const [id, code] of [[undefined, 'zh-Hans-CN'], ['zh-hans', 'zh-Hans-CN'], ['en', 'en-US'], ['ja', 'ja-JP'], ['ko', 'ko-KR'], ['不存在', 'zh-Hans-CN']]) {
    host.ipcCalls.length = 0
    const res = await ocr.executeBatchOcr([image('a.png')], { languageModelId: id })
    assert.equal(res.ok, true)
    const [call] = ocrCalls()
    assert.equal(call.plugin, 'OcrPlugin')
    assert.equal(call.func, 'recognizeImage')
    assert.deepEqual(call.params, { path: 'D:\\Pics\\a.png', lang: code })
  }
  // 客户端看到语言里含 “en” 就改用英文识别，中文代码里不能出现 “en”
  assert.ok(!'zh-Hans-CN'.toLowerCase().includes('en'))
  assert.ok(!ocr.OCR_LANGUAGE_MODELS.some(m => /table|latex/i.test(m.engineCode)), '不提供客户端不支持的公式与表格识别')
})

test('部分失败如实统计；结果里没有编造的置信度和耗时', async () => {
  host.ipc.dllplugin_call = ({ params }) =>
    params.path.endsWith('bad.png')
      ? hostFail('未检测到有效文字区域或 OCR 识别失败（Windows.Media.Ocr：没有输出）')
      : hostOk({ ok: true, success: true, text: `第一行\n第二行 ${params.path.slice(-5)}` })
  host.ipc.clipboard_copy_text = ({ text }) => { host.clipboard.text = text; return true }
  const res = await ocr.executeBatchOcr([image('good.png'), image('bad.png')], { layoutStrategy: 'markdown_table' })
  assert.equal(res.ok, true)
  assert.equal(res.recognizedCount, 1)
  assert.equal(res.failedCount, 1)
  assert.equal(res.copied, true)
  assert.equal(res.items[0].status, 'recognized')
  assert.equal(res.items[1].status, 'failed')
  assert.match(res.items[1].error, /Windows\.Media\.Ocr/)
  assert.equal(host.clipboard.text, res.combinedText)
  assert.match(res.combinedText, /^\| 序号 \| 文件名 \| 识别内容 \|/)
  assert.doesNotMatch(res.combinedText, /置信度|bad\.png/)
  assert.equal('averageLatencyMs' in res, false)
  assert.equal('confidencePercent' in res.items[0], false)

  const summary = ocr.describeOcrBatchResult(res)
  assert.equal(summary.failed, true)
  assert.match(summary.message, /1 张失败/)
})

test('全部失败、只有占位文本或过滤后为空时返回失败，不写剪贴板', async () => {
  host.ipc.clipboard_copy_text = () => { throw new Error('不应写入剪贴板') }
  host.ipc.dllplugin_call = () => { throw new Error('ONNX_MODEL_LOAD_FAILED') }
  const thrown = await ocr.executeBatchOcr([image('x.png')], {})
  assert.equal(thrown.ok, false)
  assert.match(thrown.error, /ONNX_MODEL_LOAD_FAILED/)
  assert.equal(thrown.combinedText, '')

  host.ipc.dllplugin_call = () => hostOk({ ok: true, success: true, text: '[图像已加载 1920x1080]' })
  const placeholder = await ocr.executeBatchOcr([image('x.png')], {})
  assert.equal(placeholder.ok, false)
  assert.match(placeholder.error, /没有识别到文字/)

  host.ipc.dllplugin_call = () => hostOk({ ok: true, success: true, text: '第 1 / 3 页\n合同专用章' })
  const filtered = await ocr.executeBatchOcr([image('x.png')], { filterStampNoise: true })
  assert.equal(filtered.ok, false)
  assert.match(filtered.error, /过滤/)

  assert.equal((await ocr.executeBatchOcr([], {})).ok, false)
  assert.ok(!host.ipcCalls.some(([m]) => m === 'clipboard_copy_text'))
})

test('剪贴板写入失败时如实标记，不报已复制', async () => {
  host.ipc.dllplugin_call = () => hostOk({ ok: true, success: true, text: 'abc' })
  host.ipc.clipboard_copy_text = () => { throw new Error('剪贴板被占用') }
  host.ipc.clipboard_write_text = () => { throw new Error('剪贴板被占用') }
  const res = await ocr.executeBatchOcr([image('a.png')], { postAction: 'copy_clipboard' })
  assert.equal(res.ok, true)
  assert.equal(res.copied, false)
  const summary = ocr.describeOcrBatchResult(res)
  assert.equal(summary.failed, true)
  assert.match(summary.message, /剪贴板失败/)
})

test('导出先选文件夹授权；不覆盖已有文件，同批重名自动加序号，失败逐个报告', async () => {
  host.ipc.dllplugin_call = ({ params }) => hostOk({ ok: true, success: true, text: `内容 ${params.path}` })
  const writes = []
  host.ipc.window_show_select_folder_dialog = params => {
    assert.equal(params.defaultPath, 'D:\\Pics')
    return { canceled: false, folderPath: 'E:\\Out\\' }
  }
  host.ipc.filesystem_write_file = params => {
    writes.push(params)
    if (params.path === 'E:\\Out\\exists.txt') throw Object.assign(new Error('输出已存在，未覆盖'), { code: 'FILE_ALREADY_EXISTS' })
    return { success: true, size: Buffer.byteLength(params.content) }
  }
  const items = [image('scan.png'), image('scan.jpg', { path: 'D:\\Other\\scan.jpg' }), image('exists.png')]
  const res = await ocr.executeBatchOcr(items, { postAction: 'export_file' })
  assert.equal(res.ok, true)
  assert.equal(res.copied, undefined)
  assert.deepEqual(writes.map(w => w.path), ['E:\\Out\\scan.txt', 'E:\\Out\\scan (2).txt', 'E:\\Out\\exists.txt'])
  assert.ok(writes.every(w => w.overwrite === false && w.encoding === 'utf8'))
  assert.match(writes[1].content, /D:\\Other\\scan\.jpg/)
  assert.deepEqual(res.exportedFiles, ['E:\\Out\\scan.txt', 'E:\\Out\\scan (2).txt'])
  assert.equal(res.exportFailures.length, 1)
  assert.match(res.exportFailures[0].error, /未覆盖/)
  assert.match(ocr.describeOcrBatchResult(res).message, /1 个文件未导出/)

  // 宿主没有确认写入成功也算失败
  host.ipc.filesystem_write_file = () => ({})
  const unconfirmed = await ocr.executeBatchOcr([image('a.png')], { postAction: 'export_file' })
  assert.deepEqual(unconfirmed.exportedFiles, [])
  assert.equal(unconfirmed.exportFailures.length, 1)
})

test('导出取消或选择窗口失败时不写文件；复制并导出时复制结果独立报告', async () => {
  host.ipc.dllplugin_call = () => hostOk({ ok: true, success: true, text: 'abc' })
  host.ipc.clipboard_copy_text = () => true
  host.ipc.filesystem_write_file = () => { throw new Error('不应写入') }
  host.ipc.window_show_select_folder_dialog = () => ({ canceled: true })
  const canceled = await ocr.executeBatchOcr([image('a.png')], { postAction: 'copy_and_export' })
  assert.equal(canceled.copied, true)
  assert.equal(canceled.exportCanceled, true)
  assert.deepEqual(canceled.exportedFiles, [])
  assert.equal(ocr.describeOcrBatchResult(canceled).failed, false)

  host.ipc.window_show_select_folder_dialog = () => { throw new Error('窗口不可用') }
  const broken = await ocr.executeBatchOcr([image('a.png')], { postAction: 'export_file' })
  assert.match(broken.exportError, /窗口不可用/)
  assert.equal(ocr.describeOcrBatchResult(broken).failed, true)
  assert.ok(!host.ipcCalls.some(([m]) => m === 'filesystem_write_file'))
})

test('截屏识别传入所选语言；失败、无文字、剪贴板失败都如实返回', async () => {
  host.ipc.clipboard_copy_text = ({ text }) => { host.clipboard.text = text; return true }
  host.ipc.dllplugin_call = ({ func, params }) => {
    assert.equal(func, 'captureAndRecognize')
    assert.deepEqual(params, { lang: 'ja-JP' })
    return hostOk({ ok: true, success: true, text: 'こんにちは' })
  }
  const ok = await ocr.captureScreenAreaOcr('ja')
  assert.deepEqual(ok, { ok: true, text: 'こんにちは', copied: true })
  assert.equal(host.clipboard.text, 'こんにちは')

  host.ipc.dllplugin_call = () => hostFail('屏幕截图采样失败，无法执行 OCR 识别')
  const failed = await ocr.captureScreenAreaOcr('zh-hans')
  assert.equal(failed.ok, false)
  assert.match(failed.error, /截图采样失败/)

  host.ipc.dllplugin_call = () => hostOk({ ok: true, success: true, text: '' })
  assert.match((await ocr.captureScreenAreaOcr()).error, /没有识别到文字/)

  host.ipc.dllplugin_call = () => hostOk({ ok: true, success: true, text: 'abc' })
  host.ipc.clipboard_copy_text = () => { throw new Error('占用') }
  host.ipc.clipboard_write_text = () => { throw new Error('占用') }
  const notCopied = await ocr.captureScreenAreaOcr()
  assert.equal(notCopied.copied, false)
  assert.match(notCopied.error, /剪贴板失败/)
  // 不再调用不存在的截图回退通道
  assert.ok(!host.ipcCalls.some(([m]) => m === 'screen_capture' || m === 'screen_capture_ocr'))
})

test('界面：不在客户端时显示空状态，不显示示例图片', async () => {
  const saved = globalThis.__ztoolsElectron
  delete globalThis.__ztoolsElectron
  try {
    const view = await mount(ocr.OcrCommand)
    try {
      assert.equal(view.items().length, 0)
      assert.match(view.text(), /需要在 ZTools 客户端中使用/)
      assert.doesNotMatch(view.text(), /Invoice_Cloud|E:\\\\Captures/)
    } finally { view.unmount() }
  } finally {
    globalThis.__ztoolsElectron = saved
  }
})

test('界面：识别后可复制单张结果；没有写死的耗时、置信度和公式表格档位', async () => {
  installScan()
  host.ipc.dllplugin_call = () => hostOk({ ok: true, success: true, text: '发票号码 12345' })
  host.ipc.clipboard_copy_text = () => true
  const view = await mount(ocr.OcrCommand)
  try {
    const text = view.text()
    assert.doesNotMatch(text, /ms\/图|平均耗时|置信度|公式|LaTeX/)
    const dropdownTitles = view.tree().props.searchBarAccessory.children.map(c => c.props.title)
    assert.deepEqual(dropdownTitles, ['识别语言：简体中文', '识别语言：英文', '识别语言：日文', '识别语言：韩文'])
    const row = () => view.item(i => i.props.title === 'invoice.png')
    assert.ok(!view.actions(row()).some(a => a.props.title === '复制这张图片的识别结果'))

    await view.run(row(), '识别已勾选的 1 张图片')
    assert.equal(host.lastToast().title, '已识别 1 张图片')
    assert.equal(host.lastToast().style, 'SUCCESS')
    assert.match(row().props.subtitle, /发票号码 12345/)

    await view.run(row(), '复制这张图片的识别结果')
    assert.equal(host.clipboard.text, '发票号码 12345')
    assert.equal(host.lastToast().style, 'SUCCESS')
  } finally { view.unmount() }
})

test('界面：识别失败时提示失败原因并标记该图片', async () => {
  installScan()
  host.ipc.dllplugin_call = () => hostFail('未检测到有效文字区域或 OCR 识别失败（Tesseract：退出码 1）')
  const view = await mount(ocr.OcrCommand)
  try {
    const row = () => view.item(i => i.props.title === 'invoice.png')
    await view.run(row(), '识别已勾选的 1 张图片')
    assert.equal(host.lastToast().style, 'FAILURE')
    assert.match(host.lastToast().message, /Tesseract/)
    assert.match(row().props.subtitle, /识别失败/)
    assert.equal(view.tree().props.isLoading, false)
    await tick()
  } finally { view.unmount() }
})
