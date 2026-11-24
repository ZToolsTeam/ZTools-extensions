// 公式识别：宿主调用契约（模型下载状态、超时、取消与失败如实返回）、无界面命令与工作台交互
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Cache, setRuntimeLocale } from '@ztools/declarative-ui'
import { createHost, installDirectoryHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'

setRuntimeLocale('zh-CN')
const formula = await import('../dist/index.js')

const host = createHost()
test.beforeEach(() => { host.reset(); new Cache({ namespace: '@raycast/utils.useCachedPromise' }).clear() })

const TOTAL = 119_650_191
const ready = { ok: true, success: true, state: 'ready', totalBytes: TOTAL }
const recognized = (latex, lowConfidence = false) => ({ ok: true, success: true, latex, score: lowConfidence ? 0.6 : 0.99, lowConfidence, engine: 'Pix2Text-MFR 1.5' })
const failed = (error, extra = {}) => ({ ok: false, success: false, error, ...extra })

/** 模型已下载时的宿主：识别动作交给 recognize，模型状态返回 ready */
function readyHost(recognize) {
  host.ipc.formula_ocr = params => (params.action === 'modelStatus' ? ready : recognize(params))
}

function formulaCalls(action) {
  return host.ipcCalls.filter(([method, params]) => method === 'formula_ocr' && (!action || params.action === action)).map(([, params]) => params)
}

function captureTimeouts() {
  const methods = globalThis.__ztoolsElectron.transport.methods
  const timeouts = []
  globalThis.__ztoolsElectron = { transport: { methods: new Proxy({}, { get: (_t, name) => req => { timeouts.push([name, req.params.action, req.timeoutMs]); return methods[name](req) } }) } }
  return { timeouts, restore: () => { globalThis.__ztoolsElectron = { transport: { methods } } } }
}

test('截图识别公式：按保存的格式复制并发通知，框选等待时间足够；取消不改剪贴板', async () => {
  host.storage.set('copyFormat', JSON.stringify('display'))
  readyHost(() => recognized('\\frac{a}{b}'))
  host.ipc.system_notify = () => ({ success: true })
  const probe = captureTimeouts()
  try {
    assert.equal(await formula.formulaRegion(), '已复制公式，请核对')
    assert.equal(host.clipboard.text, '$$\\frac{a}{b}$$')
    assert.deepEqual(formulaCalls('captureRegion'), [{ action: 'captureRegion', restoreWindow: false }])
    const notice = host.ipcCalls.find(([method]) => method === 'system_notify')[1]
    assert.equal(notice.title, '已复制公式，请核对')
    assert.equal(notice.message, '\\frac{a}{b}')
    const [, , timeout] = probe.timeouts.find(([name, action]) => name === 'formula_ocr' && action === 'captureRegion')
    assert.ok(timeout >= 120_000, `框选超时 ${timeout} 太短`)
  } finally { probe.restore() }

  host.clipboard.text = '原有内容'
  readyHost(() => failed('已取消框选', { canceled: true }))
  assert.equal(await formula.formulaRegion(), '已取消框选')
  assert.equal(host.clipboard.text, '原有内容')
})

test('无界面命令：模型没下载、没识别到公式、权限不足都如实报错；把握不大时提示核对', async () => {
  readyHost(() => failed('公式识别模型还没有下载', { modelMissing: true }))
  await assert.rejects(formula.formulaRegion(), /请先打开「公式识别」下载模型/)
  readyHost(() => failed('没有识别到公式', { empty: true }))
  await assert.rejects(formula.formulaClipboard(), /没有识别到公式/)
  readyHost(() => failed('没有屏幕录制权限，请在系统设置的「隐私与安全性」中允许 ZTools 录制屏幕'))
  await assert.rejects(formula.formulaRegion(), /没有屏幕录制权限/)
  readyHost(() => ({ ok: true, success: true, latex: '   ' }))
  await assert.rejects(formula.formulaClipboard(), /没有识别到公式/)

  readyHost(() => recognized('x^{2}', true))
  assert.equal(await formula.formulaClipboard(), '已复制公式，识别结果可能不准确，请核对')
  assert.equal(host.clipboard.text, '$x^{2}$', '默认复制为行内公式')
  assert.deepEqual(formulaCalls('recognizeClipboard').at(-1), { action: 'recognizeClipboard' })
})

test('不在客户端或客户端版本太旧时明确报错，不显示识别入口', async () => {
  const saved = globalThis.__ztoolsElectron
  delete globalThis.__ztoolsElectron
  try {
    await assert.rejects(formula.formulaRegion(), /需要在 ZTools 客户端中使用/)
    const view = await mount(formula.FormulaCommand)
    assert.deepEqual(view.items().map(item => item.props.title), ['需要在 ZTools 客户端中使用'])
    assert.equal(view.tree().props.filterBar, undefined)
    view.unmount()
  } finally { globalThis.__ztoolsElectron = saved }

  const methods = globalThis.__ztoolsElectron.transport.methods
  globalThis.__ztoolsElectron = { transport: { methods: new Proxy({}, { get: (_t, name) => (name === 'formula_ocr' ? undefined : methods[name]) }) } }
  try {
    const view = await mount(formula.FormulaCommand)
    const item = view.items()[0]
    assert.equal(item.props.title, '公式识别不可用')
    assert.equal(item.props.subtitle, '当前客户端版本不支持公式识别，请更新 ZTools')
    view.unmount()
  } finally { globalThis.__ztoolsElectron = { transport: { methods } } }
})

test('模型下载：没有模型时只显示下载入口；下载中显示进度并轮询，完成后进入工作台', async () => {
  let state = { ok: true, success: true, state: 'missing', totalBytes: TOTAL }
  host.ipc.formula_ocr = params => {
    if (params.action === 'downloadModel') state = { ok: true, success: true, state: 'downloading', receivedBytes: 0, totalBytes: TOTAL }
    return state
  }
  const view = await mount(formula.FormulaCommand)
  const download = view.item('model-download')
  assert.equal(download.props.title, '下载公式识别模型')
  assert.equal(download.props.subtitle, '约 114 MB，只需下载一次')
  assert.match(download.props.detail.props.markdown, /图片不会上传/)
  assert.equal(view.actions(download)[0].props.title, '下载模型')
  assert.ok(!view.text().includes('截图识别'), '没有模型时不显示识别入口')

  await view.run(download, '下载模型')
  assert.equal(formulaCalls('downloadModel').length, 1)
  const progress = view.item('model-downloading')
  assert.deepEqual(progress.props.accessories, [{ text: '0%' }])
  assert.equal(view.actions(progress)[0].props.title, '取消下载')

  state = { ok: true, success: true, state: 'downloading', receivedBytes: TOTAL / 2, totalBytes: TOTAL }
  await new Promise(resolve => setTimeout(resolve, 650))
  await tick()
  assert.deepEqual(view.item('model-downloading').props.accessories, [{ text: '50%' }])
  assert.equal(view.item('model-downloading').props.subtitle, '57.1 MB / 114 MB')

  state = ready
  await new Promise(resolve => setTimeout(resolve, 650))
  await tick()
  assert.equal(view.items().length, 0)
  assert.deepEqual(view.tree().props.filterBar.actions.map(action => action.title), ['截图识别', '添加图片'])
  const polls = formulaCalls('modelStatus').length
  await new Promise(resolve => setTimeout(resolve, 650))
  assert.equal(formulaCalls('modelStatus').length, polls, '下载完成后不再轮询')
  view.unmount()
})

test('模型下载：取消回到下载入口；失败显示原因并可重试；查询状态出错可重试', async () => {
  let state = { ok: true, success: true, state: 'downloading', receivedBytes: 1024, totalBytes: TOTAL }
  host.ipc.formula_ocr = params => {
    if (params.action === 'cancelDownload') state = { ok: true, success: true, state: 'missing', totalBytes: TOTAL }
    if (params.action === 'downloadModel') state = { ok: true, success: true, state: 'failed', error: '下载 encoder_model.onnx 失败（cdn.ztools.cn：HTTP 404；huggingface.co：校验值不一致）', totalBytes: TOTAL }
    return state
  }
  const view = await mount(formula.FormulaCommand)
  await view.run(view.item('model-downloading'), '取消下载')
  assert.equal(view.item('model-download').props.title, '下载公式识别模型')
  await view.run(view.item('model-download'), '下载模型')
  const failedItem = view.item('model-download')
  assert.equal(failedItem.props.title, '下载失败，按 Enter 重试')
  assert.match(failedItem.props.subtitle, /校验值不一致/)
  assert.match(failedItem.props.detail.props.markdown, /重试时只补下缺少的部分/)
  assert.equal(view.actions(failedItem)[0].props.title, '重新下载')
  view.unmount()

  host.ipc.formula_ocr = () => { throw new Error('公式识别请求无效') }
  const broken = await mount(formula.FormulaCommand)
  assert.equal(broken.items()[0].props.subtitle, '公式识别请求无效')
  host.ipc.formula_ocr = () => ready
  await broken.run(broken.items()[0], '重试')
  assert.equal(broken.items().length, 0)
  assert.ok(broken.tree().props.filterBar)
  broken.unmount()
})

test('工作台：截图识别成功后按格式复制，右侧显示排版公式与源码，复制格式可切换并保存', async () => {
  readyHost(() => recognized('x=\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}'))
  const view = await mount(formula.FormulaCommand)
  await view.run(null, '截图识别')
  await tick()
  const entry = view.items()[0]
  assert.match(entry.props.title, /^框选截图 /)
  assert.equal(host.clipboard.text, '$x=\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}$')
  assert.equal(host.lastToast().title, '已识别并复制')
  assert.equal(formulaCalls('captureRegion').at(-1).restoreWindow, true, '工作台框选后要重新显示窗口')
  assert.match(entry.props.detail.props.markdown, /请核对符号、上下标和分组/)
  assert.match(entry.props.detail.props.markdown, /当前结果未保留原图预览/)
  assert.match(entry.props.detail.props.markdown, /```math\nx=\\frac/)
  assert.deepEqual(entry.props.accessories, [])
  assert.deepEqual(view.actions(entry).slice(0, 4).map(action => action.props.title), ['复制为行内公式 $…$', '编辑公式', '复制为独立公式 $$…$$', '复制 LaTeX'])

  await view.dropdown('latex')
  await tick()
  assert.equal(host.storage.get('copyFormat'), JSON.stringify('latex'))
  const reordered = view.items()[0]
  assert.equal(view.actions(reordered)[0].props.title, '复制 LaTeX', 'Enter 用当前格式')
  await view.run(reordered, '复制为独立公式 $$…$$')
  assert.equal(host.clipboard.text, '$$x=\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}$$')
  view.unmount()
})

test('工作台：把握不大的结果标「请核对」并在详情提示；公式里的反引号不破坏围栏；搜索按 LaTeX 过滤', async () => {
  readyHost(() => recognized('a`b', true))
  const view = await mount(formula.FormulaCommand)
  await view.run(null, '识别剪贴板图片')
  await tick()
  const entry = view.items()[0]
  assert.deepEqual(entry.props.accessories, [{ tag: '请核对' }])
  assert.equal(host.lastToast().title, '已复制，结果可能不准确')
  assert.match(entry.props.detail.props.markdown, /^> \[!WARNING\]\n> 识别结果可能不准确/)
  assert.match(entry.props.detail.props.markdown, /```math\na`b\n```/)
  await view.search('zzz')
  assert.equal(view.items().length, 0)
  await view.search('a`b')
  assert.equal(view.items().length, 1)
  view.unmount()
})

test('工作台：批量识别中途发现模型不可用，剩余图片标失败并回到下载入口；处理中重复触发被忽略', async () => {
  let modelReady = true
  host.ipc.window_show_open_dialog = () => ({ canceled: false, filePaths: ['/Users/me/a.png', '/Users/me/b.png', '/Users/me/c.png', '/Users/me/a.png'] })
  host.ipc.formula_ocr = params => {
    if (params.action === 'modelStatus') return modelReady ? ready : { ok: true, success: true, state: 'missing', totalBytes: TOTAL }
    if (params.path === '/Users/me/a.png') return recognized('E=mc^{2}')
    modelReady = false
    return failed('公式识别模型还没有下载', { modelMissing: true })
  }
  const view = await mount(formula.FormulaCommand)
  await view.run(null, '添加图片')
  await tick(10)
  assert.deepEqual(formulaCalls('recognizeImage').map(call => call.path), ['/Users/me/a.png', '/Users/me/b.png'], '重复的图片只识别一次，模型不可用后停止')
  assert.equal(host.lastToast().title, '1 张识别成功，2 张失败')
  assert.equal(view.items()[0].props.id, 'model-download')
  view.unmount()

  let release
  modelReady = true
  host.ipc.formula_ocr = params => (params.action === 'modelStatus' ? ready : new Promise(resolve => { release = resolve }))
  const busy = await mount(formula.FormulaCommand)
  const first = busy.run(null, '截图识别')
  await tick()
  await busy.run(null, '截图识别')
  assert.equal(formulaCalls('captureRegion').length, 1)
  assert.equal(host.lastToast().title, '正在识别，请等当前任务完成')
  release(recognized('1+1=2'))
  await first
  busy.unmount()
})

test('工作台：失败的截图条目 Enter 重新截图，成功后替换；清空保留进行中的条目', async () => {
  readyHost(() => failed('截取所选区域失败'))
  const view = await mount(formula.FormulaCommand)
  await view.run(null, '截图识别')
  await tick()
  const bad = view.items()[0]
  assert.deepEqual(bad.props.accessories, [{ tag: '失败' }])
  assert.equal(view.actions(bad)[0].props.title, '重新截图识别')
  readyHost(() => recognized('\\sin x'))
  await view.run(bad, '重新截图识别')
  await tick()
  assert.equal(view.items().length, 1)
  assert.equal(view.items()[0].props.subtitle, '\\sin x')
  await view.run(view.items()[0], '清空识别结果')
  assert.equal(view.items().length, 0)
  view.unmount()
})

const preview = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='

test('核对与编辑：原图来自宿主；高分也提示核对，修改实时预览，保存后所有复制格式使用新结果', async () => {
  readyHost(() => ({ ...recognized('\\boldsymbol{x}'), previewDataUrl: preview }))
  const view = await mount(formula.FormulaCommand)
  await view.run(null, '识别剪贴板图片')
  let entry = view.items()[0]
  assert.equal(formulaCalls('recognizeClipboard').at(-1).includePreview, true)
  assert.ok(entry.props.detail.props.markdown.includes(`![公式原图](${preview})`))
  assert.match(entry.props.detail.props.markdown, /请核对符号/)
  assert.equal(host.clipboard.text, '$\\boldsymbol{x}$')
  await view.run(entry, '编辑公式')
  const editor = await mountPushed(host)
  await editor.fill('latex', '\\boldsymbol{y}+\\text{if x > 0}')
  assert.ok(editor.text().includes('boldsymbol{y}'), '预览随输入更新')
  await editor.run(null, '保存修改')
  assert.equal(host.pushed.length, 0)
  entry = view.items()[0]
  assert.equal(entry.props.subtitle, '\\boldsymbol{y}+\\text{if x > 0}')
  assert.deepEqual(entry.props.accessories, [{ tag: '已修改' }])
  assert.ok(entry.props.detail.props.markdown.includes(preview))
  await view.run(entry, '复制 LaTeX')
  assert.equal(host.clipboard.text, '\\boldsymbol{y}+\\text{if x > 0}')
  editor.unmount()
  view.unmount()
  const reopened = await mount(formula.FormulaCommand)
  assert.equal(reopened.items()[0].props.subtitle, '\\boldsymbol{y}+\\text{if x > 0}', '同一会话重开保留修改')
  reopened.unmount()
})

test('编辑边界：空值或超长内容不保存，取消保留原结果，结果被移除后禁止保存', async () => {
  readyHost(() => recognized('x^{2}'))
  const view = await mount(formula.FormulaCommand)
  await view.run(null, '截图识别')
  const entry = view.items()[0]
  await view.run(entry, '编辑公式')
  const editor = await mountPushed(host)
  await editor.fill('latex', '  ')
  await editor.run(null, '保存修改')
  assert.equal(editor.field('latex').props.error, '请输入 LaTeX 公式')
  assert.equal(host.pushed.length, 1)
  await editor.fill('latex', 'x'.repeat(16_385))
  await editor.run(null, '保存修改')
  assert.match(editor.field('latex').props.error, /16384/)
  assert.equal(view.items()[0].props.subtitle, 'x^{2}')
  await editor.fill('latex', 'y')
  editor.unmount()
  host.pushed.pop()
  assert.equal(view.items()[0].props.subtitle, 'x^{2}', 'Esc 取消不写回草稿')
  await view.run(entry, '编辑公式')
  const removedEditor = await mountPushed(host)
  await removedEditor.fill('latex', 'z')
  await view.run(entry, '从列表移除')
  await removedEditor.run(null, '保存修改')
  assert.equal(view.items().length, 0)
  assert.equal(host.pushed.length, 1)
  assert.match(host.lastToast().title, /结果已移除/)
  removedEditor.unmount()
  view.unmount()
})

test('隐私与内存：远程/畸形预览不插入 Markdown；无界面命令不请求原图；预览和已结束结果有界', async () => {
  for (const image of ['https://example.com/image.png', preview + ')\n![x](https://example.com)', 'data:image/png;base64,' + 'a'.repeat(525_000)]) {
    const result = formula.toOutcome({ ok: true, latex: 'x', previewDataUrl: image })
    assert.equal(result.previewDataUrl, undefined)
  }
  readyHost(() => recognized('x'))
  await formula.formulaClipboard()
  assert.equal(formulaCalls('recognizeClipboard').at(-1).includePreview, undefined)
  const entries = Array.from({ length: 60 }, (_, i) => ({ id: `entry-${i}`, source: 'file', title: `${i}`, status: 'done', latex: 'x', previewDataUrl: 'a'.repeat(512_000) }))
  entries.push({ id: 'pending', source: 'file', title: 'pending', status: 'running', latex: '' })
  const kept = formula.retainFormulaEntries(entries)
  assert.equal(kept.length, 51)
  assert.ok(kept.some(entry => entry.id === 'pending'))
  assert.ok(kept.reduce((sum, entry) => sum + (entry.previewDataUrl?.length ?? 0), 0) <= 4 * 1024 * 1024)
  assert.ok(kept[0].previewDataUrl)
})


test('工作台：支持通过 plugin_files_dropped 拖入图片批量识别公式，非图片或模型未就绪提示失败', async () => {
  globalThis.window.__ztoolsDeclarativeFeatures = { fileInput: false }
  const listeners = new Map()
  globalThis.window.ztools = {
    events: {
      on(event, cb) {
        listeners.set(event, cb)
        return () => listeners.delete(event)
      }
    }
  }
  try {
    readyHost(params => recognized(`\\mathrm{${params.path?.split('/').pop()}}`))
    const view = await mount(formula.FormulaCommand)
    await tick()
    assert.equal(typeof listeners.get('plugin_files_dropped'), 'function')

    listeners.get('plugin_files_dropped')({ payload: { files: ['/Users/me/doc.pdf'] } })
    await tick(5)
    assert.equal(host.lastToast().title, '请拖入支持的图片文件')
    assert.equal(view.items().length, 0)

    listeners.get('plugin_files_dropped')({ payload: { files: ['/Users/me/eq1.png', '/Users/me/note.txt', '/Users/me/eq2.jpg'] } })
    await tick(10)
    assert.deepEqual(view.items().map(item => item.props.title), ['eq1.png', 'eq2.jpg'])
    assert.equal(host.lastToast().title, '已识别 2 张图片')
    view.unmount()
    assert.equal(listeners.has('plugin_files_dropped'), false)
  } finally {
    globalThis.window.__ztoolsDeclarativeFeatures = { fileInput: true }
    delete globalThis.window.ztools
  }
})

test('工作台与剪贴板：支持 Ctrl+V 粘贴公式图片识别，且剪贴板为复制的图片文件时也可识别公式', async () => {
  readyHost(params => recognized(`\\mathrm{${params.path?.split('/').pop()}}`))
  const view = await mount(formula.FormulaCommand)
  await tick()
  await view.pasteFiles(['/Users/me/eq_paste1.png', '/Users/me/eq_paste2.webp'])
  await tick(10)
  assert.deepEqual(view.items().map(item => item.props.title), ['eq_paste1.png', 'eq_paste2.webp'])
  assert.equal(host.lastToast().title, '已识别 2 张图片')

  host.clipboard.files = ['/Users/me/eq_clip.png']
  await view.run(null, '识别剪贴板图片')
  await tick(5)
  assert.equal(host.clipboard.text, '$\\mathrm{eq_clip.png}$')
  view.unmount()
})

function createTempFormulaTree(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-formula-import-'))
  for (const [rel, content] of Object.entries(spec)) {
    const full = path.join(root, rel)
    if (rel.endsWith('/')) {
      fs.mkdirSync(full, { recursive: true })
      continue
    }
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return root
}

test('工作台初始化与模型门禁：挂载零目录扫描；模型未就绪时不暴露选择文件夹或拖入入口', async () => {
  host.ipc.formula_ocr = () => ({ ok: true, success: true, state: 'missing', totalBytes: TOTAL })
  const missingView = await mount(formula.FormulaCommand)
  await tick()
  assert.equal('fileInput' in missingView.tree().props, false)
  assert.equal(missingView.tree().props.filterBar, undefined)
  assert.equal(missingView.text().includes('选择文件夹'), false)
  assert.equal(missingView.text().includes('添加图片'), false)
  missingView.unmount()

  // 旧版 plugin_files_dropped 在模型未就绪时拦截且不扫描目录
  const prevFeatures = globalThis.window.__ztoolsDeclarativeFeatures
  const prevZtools = globalThis.window.ztools
  globalThis.window.__ztoolsDeclarativeFeatures = { fileInput: false }
  const listeners = new Map()
  globalThis.window.ztools = {
    events: {
      on(event, cb) {
        listeners.set(event, cb)
        return () => listeners.delete(event)
      }
    }
  }
  try {
    const gatedView = await mount(formula.FormulaCommand)
    await tick()
    listeners.get('plugin_files_dropped')({ payload: { files: ['/Users/me/dir'] } })
    await tick(10)
    assert.equal(host.lastToast().title, formula.getModelMissingMessage())
    assert.equal(host.ipcCalls.some(([m]) => m === 'filesystem_get_directory_contents' || m === 'filesystem_directory_exists'), false)
    assert.equal(formulaCalls('recognizeImage').length, 0)
    gatedView.unmount()
  } finally {
    globalThis.window.__ztoolsDeclarativeFeatures = prevFeatures
    globalThis.window.ztools = prevZtools
  }

  host.reset()
  readyHost(() => recognized('x'))
  const readyView = await mount(formula.FormulaCommand)
  await tick()
  const forbidden = new Set(['system_get_path', 'system_list_common_folders', 'system_search_files', 'filesystem_get_directory_contents', 'dllplugin_call'])
  assert.equal(host.ipcCalls.some(([method]) => forbidden.has(method)), false)
  assert.deepEqual(readyView.tree().props.filterBar.actions.map(action => action.title), ['截图识别', '添加图片'])
  const folderAction = readyView.actions(null).find(action => action.props.title === '选择文件夹…')
  assert.ok(folderAction)
  assert.deepEqual(folderAction.props.shortcut, { modifiers: ['cmd', 'shift'], key: 'o' })
  assert.deepEqual(readyView.tree().props.fileInput.allowDirectories, true)
  assert.deepEqual(readyView.tree().props.fileInput.allowClipboardImage, true)
  assert.equal('extensions' in readyView.tree().props.fileInput, false)
  readyView.unmount()
})

test('选择文件夹：仅导入 5 种支持的图片格式并识别，跳过不支持与空文件；支持移除、清空与取消/缺接口提示', async () => {
  const tmpDir = createTempFormulaTree({
    'eq1.png': 'img1',
    'v1.2_公式/eq2.jpg': 'img2',
    'v1.2_公式/eq3.jpeg': 'img3',
    'v1.2_公式/eq4.webp': 'img4',
    'v1.2_公式/eq5.bmp': 'img5',
    'v1.2_公式/skip.gif': 'img6',
    'v1.2_公式/skip.tiff': 'img7',
    'note.txt': 'txt',
    'empty.png': '',
    '.hidden.png': 'hidden',
    'node_modules/pkg/a.png': 'skip'
  })
  try {
    await installDirectoryHost(host, { authorized: [tmpDir] })
    host.ipc.window_show_select_folder_dialog = () => ({ canceled: false, folderPath: tmpDir })
    readyHost(params => recognized(`\\mathrm{${path.basename(params.path)}}`))

    const view = await mount(formula.FormulaCommand)
    await tick()
    await view.run(null, '选择文件夹…')
    await tick(30)

    const recognizedFiles = formulaCalls('recognizeImage').map(call => path.basename(call.path))
    assert.equal(recognizedFiles.length, 5)
    assert.deepEqual(new Set(recognizedFiles), new Set(['eq1.png', 'eq2.jpg', 'eq3.jpeg', 'eq4.webp', 'eq5.bmp']))
    assert.equal(host.lastToast().title, '已识别 5 张图片')

    const first = view.items()[0]
    assert.ok(view.actions(first).some(action => action.props.title === '选择文件夹…'))
    await view.run(first, '从列表移除')
    assert.equal(view.items().length, 4)
    assert.equal(fs.existsSync(path.join(tmpDir, 'eq1.png')), true, '移除不得删磁盘文件')

    await view.run(view.items()[0], '清空识别结果')
    assert.equal(view.items().length, 0)

    // 取消选择
    const prevCalls = host.ipcCalls.length
    host.ipc.window_show_select_folder_dialog = () => ({ canceled: true })
    await view.run(null, '选择文件夹…')
    await tick(5)
    assert.equal(host.ipcCalls.length, prevCalls + 1)

    // 旧版缺少 select_folder_dialog（preload 无此方法）时明确提示升级
    const savedMethods = globalThis.__ztoolsElectron.transport.methods
    globalThis.__ztoolsElectron = {
      ...globalThis.__ztoolsElectron,
      transport: {
        methods: new Proxy({}, {
          get: (_t, name) => (name === 'window_show_select_folder_dialog' ? undefined : savedMethods[name])
        })
      }
    }
    try {
      await view.run(null, '选择文件夹…')
      await tick(5)
      assert.equal(host.lastToast().title, '导入失败')
      assert.match(host.lastToast().message, /请升级/)
    } finally {
      globalThis.__ztoolsElectron = { ...globalThis.__ztoolsElectron, transport: { methods: savedMethods } }
    }
    view.unmount()
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('选择文件夹：盘符根目录（isVolumeRoot）先经 confirmAlert 确认再遍历', async () => {
  host.ipc.window_show_select_folder_dialog = () => ({ canceled: false, folderPath: 'D:\\' })
  host.ipc.filesystem_get_directory_contents = () => ({
    success: true,
    files: [{ name: 'root_eq.png', size: 120, isDirectory: false, lastModified: '2026-11-16T00:00:00Z' }]
  })
  readyHost(params => recognized(`\\text{${params.path}}`))

  const view = await mount(formula.FormulaCommand)
  await tick()
  host.setConfirm(false)
  await view.run(null, '选择文件夹…')
  await tick(10)
  assert.equal(host.confirms.length, 1)
  assert.equal(host.ipcCalls.some(([method]) => method === 'filesystem_get_directory_contents'), false)
  assert.equal(formulaCalls('recognizeImage').length, 0)

  host.setConfirm(true)
  await view.run(null, '选择文件夹…')
  await tick(10)
  assert.equal(host.confirms.length, 2)
  assert.equal(formulaCalls('recognizeImage').length, 1)
  assert.equal(view.items()[0].props.title, 'root_eq.png')
  view.unmount()
})

test('拖入文件夹自动展开：支持名称带点的文件夹、旧版不传 directories 探测与 plugin_files_dropped 回退', async () => {
  const tmpDir = createTempFormulaTree({
    'v2.0_formulas/f1.png': 'img1',
    'v2.0_formulas/ignore.gif': 'gif',
    'single.bmp': 'img2'
  })
  const dottedDir = path.join(tmpDir, 'v2.0_formulas')
  const singleFile = path.join(tmpDir, 'single.bmp')
  try {
    await installDirectoryHost(host, { authorized: [tmpDir] })
    host.ipc.filesystem_directory_exists = ({ path: target }) => ({ success: true, exists: fs.existsSync(target) && fs.statSync(target).isDirectory() })
    host.ipc.filesystem_get_file_size = ({ path: target }) => ({ success: true, size: fs.statSync(target).size })
    readyHost(params => recognized(`\\mathrm{${path.basename(params.path)}}`))

    const view = await mount(formula.FormulaCommand)
    await tick()
    await view.dropFiles([dottedDir, singleFile], { directories: [dottedDir] })
    await tick(20)
    assert.equal(host.ipcCalls.some(([method]) => method === 'filesystem_directory_exists'), false)
    assert.deepEqual(new Set(view.items().map(item => item.props.title)), new Set(['f1.png', 'single.bmp']))

    host.ipcCalls.length = 0
    await view.run(view.items()[0], '清空识别结果')
    await view.dropFiles([dottedDir])
    await tick(20)
    assert.equal(host.ipcCalls.some(([method]) => method === 'filesystem_directory_exists'), true)
    assert.deepEqual(view.items().map(item => item.props.title), ['f1.png'])
    view.unmount()

    const prevFeatures = globalThis.window.__ztoolsDeclarativeFeatures
    const prevZtools = globalThis.window.ztools
    globalThis.window.__ztoolsDeclarativeFeatures = { fileInput: false }
    const listeners = new Map()
    globalThis.window.ztools = {
      events: {
        on(event, cb) {
          listeners.set(event, cb)
          return () => listeners.delete(event)
        }
      }
    }
    try {
      const fallbackView = await mount(formula.FormulaCommand)
      await tick()
      listeners.get('plugin_files_dropped')({ payload: { files: [dottedDir] } })
      await tick(20)
      assert.deepEqual(fallbackView.items().map(item => item.props.title), ['f1.png'])
      fallbackView.unmount()
    } finally {
      globalThis.window.__ztoolsDeclarativeFeatures = prevFeatures
      globalThis.window.ztools = prevZtools
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('截断上限 100：超过 100 张图片时只导入并识别前 100 张，且明确提示只导入前 100 张', async () => {
  const spec = {}
  for (let i = 1; i <= 105; i++) {
    spec[`eq-${String(i).padStart(3, '0')}.png`] = `img-${i}`
  }
  const tmpDir = createTempFormulaTree(spec)
  try {
    await installDirectoryHost(host, { authorized: [tmpDir] })
    host.ipc.window_show_select_folder_dialog = () => ({ canceled: false, folderPath: tmpDir })
    readyHost(params => recognized(`x_{${path.basename(params.path)}}`))

    const view = await mount(formula.FormulaCommand)
    await tick()
    await view.run(null, '选择文件夹…')
    await tick(120)

    assert.equal(formulaCalls('recognizeImage').length, 100)
    assert.ok(
      host.toasts.some(t => t.style === 'SUCCESS' && /只导入前\s*100\s*张/.test(`${t.title}${t.message || ''}`)),
      `期望存在截断提示 Toast，实际：${JSON.stringify(host.toasts)}`
    )
    assert.equal(host.lastToast().title, '已识别 100 张图片')
    view.unmount()
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('并发竞态与适配器：导入中清空结果被丢弃；识别中拒绝新导入；适配各类宿主返回', async () => {
  readyHost(() => recognized('y=x'))
  host.ipc.window_show_open_dialog = () => ({ canceled: false, filePath: '/Users/me/init.png' })
  const view = await mount(formula.FormulaCommand)
  await tick()
  await view.run(null, '添加图片')
  await tick(10)
  assert.equal(view.items().length, 1)

  let releaseDir
  host.ipc.window_show_select_folder_dialog = () => ({ canceled: false, folderPath: '/Users/me/slow-dir' })
  host.ipc.filesystem_get_directory_contents = () => new Promise(resolve => { releaseDir = resolve })
  const importRun = view.run(null, '选择文件夹…')
  await tick(5)
  assert.equal(view.tree().props.isLoading, true)
  const callsBeforeClear = formulaCalls('recognizeImage').length
  await view.run(view.items()[0], '清空识别结果')
  assert.equal(view.items().length, 0)
  releaseDir({ success: true, files: [{ name: 'late.png', size: 100, isDirectory: false, lastModified: '2026-11-16T00:00:00Z' }] })
  await importRun
  await tick(10)
  assert.equal(formulaCalls('recognizeImage').length, callsBeforeClear, '清空后滞后返回的导入结果不得入队识别')
  assert.equal(view.items().length, 0)

  // 连续两次触发导入时取消上一次，只保留最后一次结果
  let resolveFirstDrop
  host.ipc.filesystem_get_directory_contents = ({ path: dir }) => {
    if (dir === '/Users/me/dir-first') return new Promise(resolve => { resolveFirstDrop = resolve })
    return { success: true, files: [{ name: 'second_eq.png', size: 100, isDirectory: false, lastModified: '2026-11-16T00:00:00Z' }] }
  }
  const drop1 = view.dropFiles(['/Users/me/dir-first'], { directories: ['/Users/me/dir-first'] })
  await tick(5)
  const drop2 = view.dropFiles(['/Users/me/dir-second'], { directories: ['/Users/me/dir-second'] })
  await tick(10)
  resolveFirstDrop({ success: true, files: [{ name: 'first_eq.png', size: 100, isDirectory: false, lastModified: '2026-11-16T00:00:00Z' }] })
  await Promise.all([drop1, drop2])
  await tick(10)
  assert.deepEqual(view.items().map(item => item.props.title), ['second_eq.png'])

  let releaseRecognize
  host.ipc.formula_ocr = params => (params.action === 'modelStatus' ? ready : new Promise(resolve => { releaseRecognize = resolve }))
  host.ipc.window_show_open_dialog = () => ({ canceled: false, filePath: '/Users/me/busy.png' })
  const busyRun = view.run(null, '添加图片')
  await tick(5)
  await view.run(null, '选择文件夹…')
  assert.equal(host.lastToast().title, '正在识别，请等当前任务完成')
  releaseRecognize(recognized('z=1'))
  await busyRun
  view.unmount()

  const missingTransport = formula.createFileImportTransport(undefined)
  assert.deepEqual(await missingTransport('filesystem_get_directory_contents', {}), { ok: false, error: formula.getNotInClientMessage() })

  const mockTransport = async (method) => {
    if (method === 'filesystem_get_file_size') return { success: true, data: 4096 }
    if (method === 'filesystem_directory_exists') return { success: true, data: false }
    if (method === 'ok_false') return { ok: false, success: false, error: '执行失败' }
    throw new Error(`客户端不支持 ${method}`)
  }
  const adapted = formula.createFileImportTransport(mockTransport)
  assert.deepEqual(await adapted('filesystem_get_file_size', {}), { ok: true, data: 4096 })
  assert.deepEqual(await adapted('filesystem_directory_exists', {}), { ok: true, data: false })
  assert.deepEqual(await adapted('ok_false', {}), { ok: false, error: '执行失败' })
  assert.deepEqual(await adapted('unknown_op', {}), { ok: false, error: 'METHOD_NOT_AVAILABLE: unknown_op' })
})

test('i18n 回归：CLIPBOARD_NO_IMAGE 按结构化错误码识别，识别失败不露出幽灵键 statusFailed 与裸占位符', async () => {
  try {
    setRuntimeLocale('en-US')
    readyHost(() => failed('剪贴板里没有图片', { errorCode: 'CLIPBOARD_NO_IMAGE' }))
    const view = await mount(formula.FormulaCommand)
    await view.run(null, 'OCR Clipboard')
    await tick()
    assert.equal(view.items().length, 0, '剪贴板无图片时不生成失败条目')
    assert.equal(host.lastToast().title, 'No image in clipboard')

    // 剪贴板识别其它失败场景：Toast 标题为真实译文而非幽灵键 statusFailed，且无 {error} 裸占位符
    readyHost(() => failed('Decoder error', { errorCode: 'DECODE_FAILED' }))
    await view.run(null, 'OCR Clipboard')
    await tick()
    assert.equal(host.lastToast().title, 'Recognition failed')
    assert.doesNotMatch(host.lastToast().title, /statusFailed|\{error\}/)
    assert.equal(view.items().length, 1)
    assert.doesNotMatch(String(view.items()[0].props.subtitle), /statusFailed|\{error\}/)

    // 中文模式下亦无幽灵键与裸占位符
    setRuntimeLocale('zh-CN')
    await tick()
    assert.equal(view.items()[0].props.subtitle, '识别失败')
    view.unmount()
  } finally {
    setRuntimeLocale('zh-CN')
  }
})
