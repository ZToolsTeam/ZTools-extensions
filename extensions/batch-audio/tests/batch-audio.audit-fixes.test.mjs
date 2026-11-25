import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { processAudioSelection, invokeNativeCapability, getCapabilityItems } from '../dist/logic.js'
import { createHost, installDirectoryHost, mount, tick } from '../../shared/test-harness.mjs'
import { getDeclarativeBridge, setDeclarativeBridge } from '@ztools/declarative-ui'
import { BatchAudioCommand } from '../dist/index.js'

const files = [
  { id: 'a', name: 'a.wav', path: 'C:\\a.wav', parentDir: 'C:\\', extension: '.wav', sizeBytes: 1024 },
  { id: 'b', name: 'b.wav', path: 'C:\\b.wav', parentDir: 'C:\\', extension: '.wav', sizeBytes: 2048 }
]

function makeTempTree(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-batch-audio-'))
  for (const [rel, content] of Object.entries(spec)) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return root
}

function filterBarActions(ui) {
  const fb = ui.tree().props.filterBar
  return fb?.props?.actions ?? fb?.actions ?? []
}

function subItems(ui) {
  return ui.tree().props.subList?.items ?? []
}

test('合并一次提交两输入，独立处理保留部分失败，空回执不算成功', async () => {
  const calls = []
  const host = {
    dllplugin_call: async ({ params }) => {
      calls.push(params)
      return { ok: true, results: [{ outputPath: 'C:\\out.wav', sizeBytes: 1234 }] }
    }
  }
  const merged = await processAudioSelection('BatchMergeAudio', { format: 'wav' }, files, host)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].files, files.map(f => f.path))
  assert.equal(merged.completed, 2)
  let n = 0
  const partial = await processAudioSelection('BatchLoudnorm', {}, files, {
    dllplugin_call: async () => (++n === 1 ? { ok: true, results: [{ outputPath: 'C:\\out.mp3', sizeBytes: 12 }] } : { ok: false, error: 'failed' })
  })
  assert.equal(partial.completed, 1)
  assert.equal(partial.failed, 1)
  const empty = await processAudioSelection('BatchLoudnorm', {}, files.slice(0, 1), { dllplugin_call: async () => ({ ok: true }) })
  assert.equal(empty.failed, 1)
})

test('真实SDK音频调用使用长任务超时，并拒绝没有业务确认的回执', async () => {
  createHost()
  const bridge = getDeclarativeBridge()
  const calls = []
  setDeclarativeBridge({
    ...bridge,
    hostTransport: {
      call: async (method, params, options) => {
        calls.push({ method, params, options })
        return { success: true, data: { ok: true, success: true, results: [{ outputPath: 'C:\\out.mp3', sizeBytes: 100 }] } }
      }
    }
  })
  const result = await invokeNativeCapability('BatchLoudnorm', { files: ['C:\\in.wav'] })
  assert.equal(result.ok, true)
  assert.equal(calls[0].options.timeoutMs, 300000)
  setDeclarativeBridge({ ...bridge, hostTransport: { call: async () => ({}) } })
  assert.equal((await invokeNativeCapability('BatchLoudnorm', { files: ['C:\\in.wav'] })).ok, false)
  setDeclarativeBridge(bridge)
})

test('音频方法和文件参数在调用宿主前校验，数组中的无效路径不能被忽略', async () => {
  let called = 0
  const host = {
    dllplugin_call: async () => {
      called++
      return { ok: true }
    }
  }
  for (const params of [
    {},
    { files: [] },
    { files: 'C:\\in.wav' },
    { files: new Array(1) },
    { files: ['C:\\in.wav', 123] },
    { files: ['C:\\in.wav', ''] },
    { files: ['relative.wav'] },
    { files: ['C:\\music\\..\\in.wav'] },
    { files: ['C:\\in\0.wav'] },
    { files: [['C:\\in.wav']] },
    { files: ['C:\\in.wav'], outputDir: false },
    { files: ['C:\\in.wav'], outputPath: 'C:\\Windows\\System32\\out.wav' },
    { files: ['C:\\a.wav', 'C:\\b.wav'], outputPath: 'C:\\out.wav' }
  ]) {
    await assert.rejects(invokeNativeCapability('BatchLoudnorm', params, host), /INVALID_|SECURITY_INTERCEPTED/)
  }
  await assert.rejects(invokeNativeCapability('UnknownMethod', { files: ['C:\\in.wav'] }, host), /INVALID_METHOD/)
  await assert.rejects(invokeNativeCapability('BatchMergeAudio', { files: ['C:\\in.wav'] }, host), /合并需要/)
  const tooMany = Array.from({ length: 101 }, (_, i) => `C:\\a_${i}.wav`)
  await assert.rejects(invokeNativeCapability('BatchMergeAudio', { files: tooMany }, host), /最多支持 100 个/)
  assert.equal(called, 0)
  for (const mode of getCapabilityItems()) {
    await invokeNativeCapability(mode.method, { ...mode.params, files: ['C:\\音乐\\a.wav', '\\\\server\\music\\b.wav'] }, host)
  }
  await invokeNativeCapability('BatchLoudnorm', { inputPath: 'D:\\Media\\song.flac' }, host)
  assert.equal(called, 13)
})

test('batch-audio UI 挂载零扫盘：任何环境初始均为空列表，顶栏恰为 2 个按钮', async () => {
  const h = createHost()
  const ui = await mount(BatchAudioCommand, h)
  await tick(10)
  const banned = new Set([
    'system_get_path',
    'system_list_common_folders',
    'system_search_files',
    'filesystem_get_directory_contents',
    'dllplugin_call'
  ])
  assert.deepEqual(h.ipcCalls.filter(([m]) => banned.has(m)), [])
  assert.equal(subItems(ui).length, 0)
  assert.deepEqual(
    filterBarActions(ui).map(a => ({ id: a.id, label: a.label })),
    [
      { id: 'pick-files', label: '选择文件' },
      { id: 'pick-folder', label: '选择文件夹' }
    ]
  )
  assert.deepEqual(
    ui.actions().map(a => a.props.title),
    ['选择文件…', '选择文件夹…']
  )
  ui.unmount()

  const prevWin = globalThis.window
  delete globalThis.window
  try {
    const offClient = BatchAudioCommand()
    assert.equal(offClient.props.subList.items.length, 0, '非客户端下也严禁展示假样例')
    assert.match(offClient.props.subList.emptyText, /需要在 ZTools 客户端中使用/)
  } finally {
    globalThis.window = prevWin
  }
})

test('batch-audio 支持选择文件、选择文件夹、拖入文件夹（新旧客户端回退）与粘贴去重', async () => {
  const root = makeTempTree({
    'track_a.flac': 'aa',
    'sub/voice.opus': 'bb',
    'sub/extra.aiff': 'cc',
    'readme.txt': 'tt'
  })
  const subDir = path.join(root, 'sub')

  try {
    const h = createHost()
    await installDirectoryHost(h, { authorized: [root] })
    h.ipc.filesystem_get_file_size = async ({ path: p }) => ({
      success: true,
      size: fs.existsSync(p) ? fs.statSync(p).size : 8192
    })
    h.ipc.window_show_open_dialog = async () => ({
      canceled: false,
      filePaths: [{ path: path.join(root, 'track_a.flac') }, { path: path.join(root, 'readme.txt') }]
    })

    const ui = await mount(BatchAudioCommand, h)
    await filterBarActions(ui).find(a => a.id === 'pick-files').onAction()
    await tick(10)
    assert.equal(subItems(ui).length, 1)
    assert.equal(subItems(ui)[0].props.checked, true)
    assert.equal(h.lastToast()?.title, '已添加 1 个文件')

    // 选择文件夹：整盘先弹窗确认；临时目录递归导入、去重 track_a.flac
    h.setConfirm(false)
    h.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: 'E:\\' })
    await filterBarActions(ui).find(a => a.id === 'pick-folder').onAction()
    await tick(10)
    assert.equal(h.confirms.length, 1)

    h.setConfirm(true)
    h.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: root })
    await filterBarActions(ui).find(a => a.id === 'pick-folder').onAction()
    await tick(15)
    assert.deepEqual(subItems(ui).map(i => i.props.title), ['track_a.flac', 'extra.aiff', 'voice.opus'])
    assert.equal(h.lastToast()?.title, '已添加 2 个文件')

    // 新版宿主带 directories 拖入文件夹（不再重复添加）
    await ui.dropFiles([subDir], { directories: [subDir] })
    await tick(15)
    assert.equal(h.lastToast()?.title, '这些文件已在列表中')

    // 粘贴音频并去重；读不到大小时显示「大小未识别」
    h.ipc.filesystem_get_file_size = async () => {
      throw new Error('路径未由当前窗口授权')
    }
    await ui.pasteFiles([
      'D:\\Pasted\\podcast_intro.mp3',
      'D:\\Pasted\\podcast_intro.mp3',
      'D:\\Pasted\\episode_main.wav'
    ])
    await tick(15)
    assert.equal(h.lastToast()?.title, '已添加 2 个文件')
    const intro = ui.item(it => it.props.title === 'podcast_intro.mp3')
    assert.ok(intro.props.accessories.some(a => a.text === '大小未识别'))
    ui.unmount()

    // 旧版客户端 plugin_files_dropped 回退（含文件夹展开）
    const legacyHost = createHost()
    await installDirectoryHost(legacyHost, { authorized: [root] })
    legacyHost.ipc.filesystem_directory_exists = async ({ path: p }) => ({
      success: true,
      exists: p.toLowerCase() === subDir.toLowerCase()
    })
    let droppedListener = null
    globalThis.window.__ztoolsDeclarativeFeatures = { fileInput: false }
    globalThis.window.ztools = {
      ...(globalThis.window.ztools || {}),
      events: {
        on(event, cb) {
          if (event === 'plugin_files_dropped') droppedListener = cb
          return () => {
            if (droppedListener === cb) droppedListener = null
          }
        }
      }
    }
    const legacyUi = await mount(BatchAudioCommand, legacyHost)
    try {
      assert.equal(typeof droppedListener, 'function')
      droppedListener({ payload: { files: [subDir] } })
      await tick(20)
      assert.deepEqual(subItems(legacyUi).map(i => i.props.title), ['extra.aiff', 'voice.opus'])
    } finally {
      legacyUi.unmount()
      globalThis.window.__ztoolsDeclarativeFeatures = { fileInput: true }
    }
    assert.equal(droppedListener, null)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('batch-audio UI 合并超限预检、移除、清空与处理中防护', async () => {
  const GIB = 1024 * 1024 * 1024
  const h = createHost()
  h.ipc.filesystem_get_file_size = async ({ path: p }) => ({
    success: true,
    size: p.includes('big') ? GIB + 1 : 4096
  })
  let releaseDll
  const dllGate = new Promise(r => (releaseDll = r))
  const dllCalls = []
  h.ipc.dllplugin_call = async ({ func, params }) => {
    dllCalls.push({ func, params })
    await dllGate
    return { ok: true, results: [{ outputPath: 'D:\\Audio\\out.mp3', sizeBytes: 1024 }] }
  }

  const ui = await mount(BatchAudioCommand, h)
  await ui.pasteFiles(['D:\\Audio\\big1.wav', 'D:\\Audio\\big2.wav', 'D:\\Audio\\small.mp3'])
  await tick(15)

  // 切换到合并模式（total = 2 * (1 GiB + 1) > 2 GiB）：直接提示超限，不弹确认框、不调宿主
  await ui.dropdown('audio-merge')
  const first = subItems(ui)[0]
  await ui.run(first, '开始批量处理 (3项)')
  assert.equal(h.lastToast()?.title, '合并最多支持 100 个文件、总大小 2 GiB，请减少勾选')
  assert.equal(h.confirms.length, 0)
  assert.equal(dllCalls.length, 0)

  // 从列表移除一个大文件后再试（剩下 1 GiB + 1 + 4096 <= 2 GiB）：允许进入处理流程
  await ui.run(ui.item(it => it.props.title === 'big2.wav'), '从列表移除')
  assert.equal(subItems(ui).length, 2)
  assert.equal(h.ipcCalls.some(([m]) => /trash|delete|unlink/i.test(m)), false)

  // 切回普通模式测处理中防护（处理中禁止移除、拒绝清空）
  await ui.dropdown('audio-convert-mp3')
  const runPromise = ui.run(subItems(ui)[0], '开始批量处理 (2项)')
  await tick(5)
  assert.equal(ui.actions(subItems(ui)[0]).some(a => a.props.title === '从列表移除'), false)
  await ui.run(subItems(ui)[1], '清空列表')
  assert.equal(h.lastToast()?.title, '正在处理，完成后再清空')
  assert.equal(subItems(ui).length, 2)

  releaseDll()
  await runPromise
  await tick(10)

  // 空闲后清空列表与导入进行中清空丢弃
  await ui.run(subItems(ui)[0], '清空列表')
  assert.equal(subItems(ui).length, 0)

  let releaseImport
  const importGate = new Promise(r => (releaseImport = r))
  h.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: 'D:\\PendingAudio' })
  h.ipc.filesystem_get_directory_contents = async () => {
    await importGate
    return { success: true, files: [{ name: 'late.mp3', size: 1024, isDirectory: false }] }
  }
  await ui.pasteFiles(['D:\\Audio\\one.mp3'])
  await tick(10)
  const toastBefore = h.toasts.length
  const folderTask = filterBarActions(ui).find(a => a.id === 'pick-folder').onAction()
  await tick(5)
  await ui.run(subItems(ui)[0], '清空列表')
  releaseImport()
  await folderTask
  await tick(10)
  assert.equal(subItems(ui).length, 0)
  assert.equal(h.toasts.length, toastBefore)
  ui.unmount()
})
