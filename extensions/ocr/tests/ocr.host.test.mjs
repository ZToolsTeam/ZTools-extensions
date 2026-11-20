// 文字识别：宿主调用契约（语言、超时、取消与失败如实返回）、无界面命令与工作台交互
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Cache } from '@ztools/declarative-ui'
import { createHost, installDirectoryHost, mount, tick } from '../../shared/test-harness.mjs'
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

test('工作台：截图识别处理中立即显示识别中，成功更新结果并复制，取消不留下空条目；处理中重复触发被忽略', async () => {
  let release
  host.ipc.image_ocr = () => new Promise(resolve => { release = resolve })
  const view = await mount(ocr.OcrCommand)
  const first = view.run(null, '截图识别')
  await tick()
  assert.equal(view.items().length, 1, '截图识别进行中列表立即显示识别中条目')
  assert.equal(view.items()[0].props.subtitle, '正在识别')
  assert.deepEqual(view.items()[0].props.accessories, [{ tag: '识别中' }])
  assert.equal(view.items()[0].props.detail.props.markdown, '正在识别…')
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

test('工作台：失败条目的主动作是重新识别而不是移除；重新截图成功后替换失败条目', async () => {
  host.ipc.image_ocr = () => failed('没有屏幕录制权限')
  const view = await mount(ocr.OcrCommand)
  await view.run(null, '截图识别')
  await tick()
  const bad = view.item(item => item.props.title.startsWith('框选截图'))
  assert.equal(view.actions(bad)[0].props.title, '重新截图识别')

  host.ipc.image_ocr = () => failed('已取消框选', { canceled: true })
  await view.run(bad, '重新截图识别')
  await tick()
  assert.equal(view.items().length, 1, '重新截图取消时保留原有失败条目')
  assert.equal(view.items()[0].props.id, bad.props.id)

  host.ipc.image_ocr = () => recognized('权限已打开')
  await view.run(bad, '重新截图识别')
  await tick()
  assert.equal(view.items().length, 1, '重新识别成功后不留下失败的旧条目')
  assert.equal(view.items()[0].props.subtitle, '权限已打开')
  assert.equal(view.actions(view.items()[0])[0].props.title, '复制文字')

  host.ipc.image_ocr = () => failed('剪贴板图片无法解码')
  await view.run(null, '识别剪贴板图片')
  await tick()
  const clip = view.item(item => item.props.title.startsWith('剪贴板图片'))
  assert.equal(view.actions(clip)[0].props.title, '重新识别剪贴板图片')
  view.unmount()
})

test('工作台：批量识别显示进度，排队和识别中的条目不能移除；重复添加同一张图不重复列出', async () => {
  const releases = []
  host.ipc.window_show_open_dialog = () => ({ canceled: false, filePaths: ['/p/a.png', '/p/b.png', '/p/a.png'] })
  host.ipc.image_ocr = () => new Promise(resolve => releases.push(resolve))
  const view = await mount(ocr.OcrCommand)
  const run = view.run(null, '添加图片')
  await tick(5)
  assert.deepEqual(view.items().map(item => item.props.title), ['a.png', 'b.png'], '同一次选择里的重复路径只识别一次')
  assert.equal(view.tree().props.filterBar.summaryText, '正在识别第 1 / 2 张')
  const waiting = view.item(item => item.props.title === 'b.png')
  assert.deepEqual(waiting.props.accessories, [{ tag: '等待' }])
  assert.ok(!view.actions(waiting).some(action => action.props.title === '从列表移除'))
  assert.equal(view.actions(waiting)[0].props.title, '截图识别', '没有针对这一条的动作时，主动作是开始新的识别')

  await view.run(waiting, '截图识别')
  assert.equal(host.lastToast().title, '正在识别，请等当前任务完成')

  releases.shift()(recognized('A'))
  await tick(5)
  assert.equal(view.tree().props.filterBar.summaryText, '正在识别第 2 / 2 张')
  releases.shift()(recognized('B'))
  await run
  await tick()
  assert.match(view.tree().props.filterBar.summaryText, /^2 条识别结果$/)

  host.ipc.window_show_open_dialog = () => ({ canceled: false, filePath: '/p/b.png' })
  host.ipc.image_ocr = () => recognized('B2')
  await view.run(null, '添加图片')
  await tick(5)
  assert.deepEqual(view.items().map(item => item.props.title), ['b.png', 'a.png'], '再次添加已有图片时移到最前面重新识别')
  assert.equal(view.items()[0].props.subtitle, 'B2')
  view.unmount()
})

test('工作台：识别剪贴板图片成功后复制；清空只移除已结束的结果；上次没识别完的条目标为中断', async () => {
  host.ipc.image_ocr = () => recognized('剪贴板里的字')
  const view = await mount(ocr.OcrCommand)
  await view.run(null, '识别剪贴板图片')
  await tick()
  assert.equal(host.clipboard.text, '剪贴板里的字')
  assert.equal(host.lastToast().title, '已识别并复制')
  assert.deepEqual(view.actions(view.items()[0]).slice(0, 2).map(action => action.props.title), ['复制文字', '截图识别'], '次动作不能是移除')

  await view.run(view.items()[0], '清空识别结果')
  await tick()
  assert.equal(view.items().length, 0)

  // 识别到一半关掉插件：重新打开时那一条不会再有结果
  host.ipc.window_show_open_dialog = () => ({ canceled: false, filePath: '/p/slow.png' })
  host.ipc.image_ocr = () => new Promise(() => {})
  void view.run(null, '添加图片')
  await tick(5)
  view.unmount()
  const reopened = await mount(ocr.OcrCommand)
  await tick()
  const stale = reopened.item(item => item.props.title === 'slow.png')
  assert.equal(stale.props.subtitle, '识别被中断')
  assert.equal(reopened.actions(stale)[0].props.title, '重新识别')
  reopened.unmount()
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


test('工作台：支持通过 plugin_files_dropped 拖入图片批量识别，非图片提示失败', async () => {
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
    host.ipc.image_ocr = params => recognized(`识别：${params.path}`)
    const view = await mount(ocr.OcrCommand)
    assert.equal(typeof listeners.get('plugin_files_dropped'), 'function')

    listeners.get('plugin_files_dropped')({ payload: { files: ['/Users/me/readme.pdf'] } })
    await tick(5)
    assert.equal(host.lastToast().title, '请拖入支持的图片文件')
    assert.equal(view.items().length, 0)

    listeners.get('plugin_files_dropped')({ payload: { files: ['/Users/me/drop1.png', '/Users/me/ignore.txt', '/Users/me/drop2.webp'] } })
    await tick(10)
    assert.deepEqual(view.items().map(item => item.props.title), ['drop1.png', 'drop2.webp'])
    assert.equal(host.lastToast().title, '已识别 2 张图片')
    view.unmount()
    assert.equal(listeners.has('plugin_files_dropped'), false)
  } finally {
    globalThis.window.__ztoolsDeclarativeFeatures = { fileInput: true }
    delete globalThis.window.ztools
  }
})

test('工作台与剪贴板：支持 Ctrl+V 粘贴图片文件识别，且剪贴板为复制的图片文件时也可直接识别', async () => {
  host.ipc.image_ocr = params => recognized(`识别文件：${params.path}`)
  const view = await mount(ocr.OcrCommand)
  await view.pasteFiles(['/Users/me/paste1.png', '/Users/me/paste2.webp'])
  await tick(10)
  assert.deepEqual(view.items().map(item => item.props.title), ['paste1.png', 'paste2.webp'])
  assert.equal(host.lastToast().title, '已识别 2 张图片')

  host.clipboard.files = ['/Users/me/copied-from-finder.png']
  await view.run(null, '识别剪贴板图片')
  await tick(5)
  assert.equal(host.clipboard.text, '识别文件：/Users/me/copied-from-finder.png')
  view.unmount()
})

function createTempImageTree(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-ocr-import-'))
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

test('工作台初始化：不扫描任何目录或文件，顶栏保持 2 个按钮且入口包含选择文件夹', async () => {
  const view = await mount(ocr.OcrCommand)
  assert.equal(view.items().length, 0)
  assert.equal(host.ipcCalls.length, 0)
  const forbidden = new Set(['system_get_path', 'system_list_common_folders', 'system_search_files', 'filesystem_get_directory_contents', 'dllplugin_call'])
  assert.equal(host.ipcCalls.some(([method]) => forbidden.has(method)), false)
  assert.deepEqual(view.tree().props.filterBar.actions.map(action => action.title), ['截图识别', '添加图片'])
  const emptyActions = view.actions(null)
  assert.ok(emptyActions.some(action => action.props.title === '选择文件夹…'))
  const folderAction = emptyActions.find(action => action.props.title === '选择文件夹…')
  assert.deepEqual(folderAction.props.shortcut, { modifiers: ['cmd', 'shift'], key: 'o' })
  assert.deepEqual(view.tree().props.fileInput.allowDirectories, true)
  assert.deepEqual(view.tree().props.fileInput.allowClipboardImage, true)
  assert.equal('extensions' in view.tree().props.fileInput, false)
  view.unmount()
})

test('选择文件夹：递归收集支持格式，跳过空文件与依赖目录；支持移除、清空与取消/缺接口提示', async () => {
  const tmpDir = createTempImageTree({
    '1.png': 'img1',
    'v1.2_截图/2.jpg': 'img2',
    'v1.2_截图/3.jpeg': 'img3',
    'v1.2_截图/4.webp': 'img4',
    'v1.2_截图/5.bmp': 'img5',
    'v1.2_截图/6.gif': 'img6',
    'v1.2_截图/7.tiff': 'img7',
    'note.txt': 'text',
    'doc.pdf': 'pdf',
    'empty.png': '',
    '.hidden.png': 'hidden',
    'node_modules/pkg/a.png': 'skip',
    '.git/b.png': 'skip'
  })
  try {
    await installDirectoryHost(host, { authorized: [tmpDir] })
    host.ipc.window_show_select_folder_dialog = () => ({ canceled: false, folderPath: tmpDir })
    host.ipc.image_ocr = params => recognized(`文字:${path.basename(params.path)}`)

    const view = await mount(ocr.OcrCommand)
    await view.run(null, '选择文件夹…')
    await tick(30)

    const recognizedFiles = ocrCalls().map(call => path.basename(call.path))
    assert.equal(recognizedFiles.length, 7)
    assert.deepEqual(new Set(recognizedFiles), new Set(['1.png', '2.jpg', '3.jpeg', '4.webp', '5.bmp', '6.gif', '7.tiff']))
    assert.equal(host.lastToast().title, '已识别 7 张图片')

    const firstItem = view.items()[0]
    assert.ok(view.actions(firstItem).some(action => action.props.title === '选择文件夹…'))
    await view.run(firstItem, '从列表移除')
    assert.equal(view.items().length, 6)
    assert.equal(fs.existsSync(path.join(tmpDir, '1.png')), true, '从列表移除不得删除磁盘文件')

    await view.run(view.items()[0], '清空识别结果')
    assert.equal(view.items().length, 0)

    // 取消选择不触发目录读取或识别
    const prevCalls = host.ipcCalls.length
    host.ipc.window_show_select_folder_dialog = () => ({ canceled: true })
    await view.run(null, '选择文件夹…')
    await tick(5)
    assert.equal(host.ipcCalls.length, prevCalls + 1)

    // 空文件夹提示支持格式
    const emptyDir = createTempImageTree({ 'readme.txt': 'x' })
    try {
      await installDirectoryHost(host, { authorized: [emptyDir] })
      host.ipc.window_show_select_folder_dialog = () => ({ canceled: false, folderPath: emptyDir })
      await view.run(null, '选择文件夹…')
      await tick(10)
      assert.equal(host.lastToast().style, 'FAILURE')
      assert.equal(host.lastToast().title, '没有找到可导入的文件')
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true })
    }

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
    files: [{ name: 'root.png', size: 100, isDirectory: false, lastModified: '2026-11-16T00:00:00Z' }]
  })
  host.ipc.image_ocr = params => recognized(`识别:${params.path}`)

  const view = await mount(ocr.OcrCommand)
  host.setConfirm(false)
  await view.run(null, '选择文件夹…')
  await tick(10)
  assert.equal(host.confirms.length, 1)
  assert.equal(host.ipcCalls.some(([method]) => method === 'filesystem_get_directory_contents'), false)
  assert.equal(ocrCalls().length, 0)

  host.setConfirm(true)
  await view.run(null, '选择文件夹…')
  await tick(10)
  assert.equal(host.confirms.length, 2)
  assert.equal(ocrCalls().length, 1)
  assert.equal(view.items()[0].props.title, 'root.png')
  view.unmount()
})

test('拖入文件夹自动展开：支持名称带点的文件夹、旧版不传 directories 探测与 plugin_files_dropped 回退', async () => {
  const tmpDir = createTempImageTree({
    '2026.11_截图/shot1.png': 'img1',
    '2026.11_截图/ignore.txt': 'txt',
    'single.webp': 'img2'
  })
  const dottedDir = path.join(tmpDir, '2026.11_截图')
  const singleFile = path.join(tmpDir, 'single.webp')
  try {
    await installDirectoryHost(host, { authorized: [tmpDir] })
    host.ipc.filesystem_directory_exists = ({ path: target }) => ({ success: true, exists: fs.existsSync(target) && fs.statSync(target).isDirectory() })
    host.ipc.filesystem_get_file_size = ({ path: target }) => ({ success: true, size: fs.statSync(target).size })
    host.ipc.image_ocr = params => recognized(`识别:${path.basename(params.path)}`)

    // 1. 新版宿主带 directories 时无需调用 directory_exists
    const view = await mount(ocr.OcrCommand)
    await view.dropFiles([dottedDir, singleFile], { directories: [dottedDir] })
    await tick(20)
    assert.equal(host.ipcCalls.some(([method]) => method === 'filesystem_directory_exists'), false)
    assert.deepEqual(new Set(view.items().map(item => item.props.title)), new Set(['shot1.png', 'single.webp']))

    // 2. 旧版宿主不带 directories 时探测文件夹展开带点目录
    host.ipcCalls.length = 0
    await view.run(view.items()[0], '清空识别结果')
    await view.dropFiles([dottedDir])
    await tick(20)
    assert.equal(host.ipcCalls.some(([method]) => method === 'filesystem_directory_exists'), true)
    assert.deepEqual(view.items().map(item => item.props.title), ['shot1.png'])
    view.unmount()

    // 3. 旧版 plugin_files_dropped 回退事件也能展开文件夹
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
      const fallbackView = await mount(ocr.OcrCommand)
      listeners.get('plugin_files_dropped')({ payload: { files: [dottedDir] } })
      await tick(20)
      assert.deepEqual(fallbackView.items().map(item => item.props.title), ['shot1.png'])
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
    spec[`img-${String(i).padStart(3, '0')}.png`] = `img-${i}`
  }
  const tmpDir = createTempImageTree(spec)
  try {
    await installDirectoryHost(host, { authorized: [tmpDir] })
    host.ipc.window_show_select_folder_dialog = () => ({ canceled: false, folderPath: tmpDir })
    host.ipc.image_ocr = params => recognized(`OCR:${path.basename(params.path)}`)

    const view = await mount(ocr.OcrCommand)
    await view.run(null, '选择文件夹…')
    await tick(120)

    assert.equal(ocrCalls().length, 100)
    assert.equal(view.items().length, 100)
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

test('并发竞态与适配器：导入中清空结果被丢弃；连续导入取消上一次；识别中拒绝新导入；适配各类宿主返回', async () => {
  // 1. 导入中清空结果被丢弃 & 识别中拒绝新导入
  host.ipc.image_ocr = () => recognized('初始条目')
  host.ipc.window_show_open_dialog = () => ({ canceled: false, filePath: '/Users/me/init.png' })
  const view = await mount(ocr.OcrCommand)
  await view.run(null, '添加图片')
  await tick(10)
  assert.equal(view.items().length, 1)

  let releaseDir
  host.ipc.window_show_select_folder_dialog = () => ({ canceled: false, folderPath: '/Users/me/slow-dir' })
  host.ipc.filesystem_get_directory_contents = () => new Promise(resolve => { releaseDir = resolve })
  const importRun = view.run(null, '选择文件夹…')
  await tick(5)
  assert.equal(view.tree().props.isLoading, true)
  const callsBeforeClear = ocrCalls().length
  await view.run(view.items()[0], '清空识别结果')
  assert.equal(view.items().length, 0)
  releaseDir({ success: true, files: [{ name: 'late.png', size: 100, isDirectory: false, lastModified: '2026-11-16T00:00:00Z' }] })
  await importRun
  await tick(10)
  assert.equal(ocrCalls().length, callsBeforeClear, '清空后滞后返回的导入结果不得入队识别')
  assert.equal(view.items().length, 0)

  // 1.5 连续两次触发导入时取消上一次，只保留最后一次结果
  let resolveFirstDrop
  host.ipc.filesystem_get_directory_contents = ({ path: dir }) => {
    if (dir === '/Users/me/dir-first') return new Promise(resolve => { resolveFirstDrop = resolve })
    return { success: true, files: [{ name: 'second.png', size: 100, isDirectory: false, lastModified: '2026-11-16T00:00:00Z' }] }
  }
  const drop1 = view.dropFiles(['/Users/me/dir-first'], { directories: ['/Users/me/dir-first'] })
  await tick(5)
  const drop2 = view.dropFiles(['/Users/me/dir-second'], { directories: ['/Users/me/dir-second'] })
  await tick(10)
  resolveFirstDrop({ success: true, files: [{ name: 'first.png', size: 100, isDirectory: false, lastModified: '2026-11-16T00:00:00Z' }] })
  await Promise.all([drop1, drop2])
  await tick(10)
  assert.deepEqual(view.items().map(item => item.props.title), ['second.png'])

  // 2. 识别中点选择文件夹提示正在识别
  let releaseOcr
  host.ipc.image_ocr = () => new Promise(resolve => { releaseOcr = resolve })
  host.ipc.window_show_open_dialog = () => ({ canceled: false, filePath: '/Users/me/busy.png' })
  const busyRun = view.run(null, '添加图片')
  await tick(5)
  const dialogCountBefore = host.ipcCalls.filter(([m]) => m === 'window_show_select_folder_dialog').length
  await view.run(null, '选择文件夹…')
  assert.equal(host.lastToast().title, '正在识别，请等当前任务完成')
  assert.equal(host.ipcCalls.filter(([m]) => m === 'window_show_select_folder_dialog').length, dialogCountBefore)
  releaseOcr(recognized('完成'))
  await busyRun
  view.unmount()

  // 3. FileImportTransport 适配器边界测试
  const missingTransport = ocr.createFileImportTransport(undefined)
  assert.deepEqual(await missingTransport('filesystem_get_directory_contents', {}), { ok: false, error: ocr.NOT_IN_CLIENT_MESSAGE })

  const mockTransport = async (method) => {
    if (method === 'filesystem_get_file_size') return { success: true, data: 2048 }
    if (method === 'filesystem_directory_exists') return { success: true, data: true }
    if (method === 'filesystem_get_directory_contents') return { success: true, data: [{ name: 'a.png', size: 10, isDirectory: false }] }
    if (method === 'inner_fail') return { success: true, data: { success: false, error: '权限不足' } }
    throw new Error(`客户端不支持 ${method}`)
  }
  const adapted = ocr.createFileImportTransport(mockTransport)
  assert.deepEqual(await adapted('filesystem_get_file_size', {}), { ok: true, data: 2048 })
  assert.deepEqual(await adapted('filesystem_directory_exists', {}), { ok: true, data: true })
  assert.deepEqual(await adapted('filesystem_get_directory_contents', {}), { ok: true, data: [{ name: 'a.png', size: 10, isDirectory: false }] })
  assert.deepEqual(await adapted('inner_fail', {}), { ok: false, error: '权限不足' })
  assert.deepEqual(await adapted('unknown_op', {}), { ok: false, error: 'METHOD_NOT_AVAILABLE: unknown_op' })
})
