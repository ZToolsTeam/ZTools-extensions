import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHost, installDirectoryHost, mount, tick } from '../../shared/test-harness.mjs'
import BatchImageCommand from '../dist/index.js'

const POSTER = 'D:\\TestMedia\\pictures\\design_poster_4k.png'
const RECEIPT = 'D:\\TestMedia\\pictures\\receipt_scan.jpg'

function makeTempTree(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-batch-image-'))
  for (const [rel, content] of Object.entries(spec)) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return root
}

/** 与宿主单张成功时的返回结构一致（路由层会再包一层 data） */
function hostSuccess(params, { outputBytes = 380000, originalBytes = 1048576, width = 1920, height = 1080 } = {}) {
  const record = {
    ok: true,
    success: true,
    processedCount: 1,
    outputPath: params.outputPath,
    outputBytes,
    results: [
      {
        sourcePath: params.files[0],
        outputPath: params.outputPath,
        width,
        height,
        originalBytes,
        sizeBytes: outputBytes,
        outputBytes,
        savedBytes: Math.max(0, originalBytes - outputBytes)
      }
    ],
    errors: []
  }
  return { ...record, data: { ...record } }
}

function hostFailure(params, message) {
  return { ok: false, success: false, processedCount: 0, results: [], errors: [{ file: params.files[0], error: message }], error: message }
}

function tagOf(item) {
  return item.props.accessories.find((a) => a.tag)?.tag?.value
}

function filterBarActions(view) {
  const fb = view.tree().props.filterBar
  return fb?.props?.actions ?? fb?.actions ?? []
}

function summaryTextOf(view) {
  const fb = view.tree().props.filterBar
  return String(fb?.props?.summaryText ?? fb?.summaryText ?? '')
}

function subItems(view) {
  return view.tree().props.subList?.items ?? []
}

test('batch-image UI 挂载零扫盘：初始为空列表、顶栏恰为 2 个按钮、空状态动作顺序正确', async () => {
  const host = createHost()
  const view = await mount(BatchImageCommand, host)
  await tick(10)

  const bannedMethods = new Set([
    'system_get_path',
    'system_list_common_folders',
    'system_search_files',
    'filesystem_get_directory_contents',
    'dllplugin_call'
  ])
  assert.deepEqual(
    host.ipcCalls.filter(([m]) => bannedMethods.has(m)),
    [],
    '挂载时绝不能触发任何扫盘或原生处理调用'
  )
  assert.equal(subItems(view).length, 0)
  const actions = filterBarActions(view)
  assert.deepEqual(
    actions.map((a) => ({ id: a.id, label: a.label })),
    [
      { id: 'pick-files', label: '选择文件' },
      { id: 'pick-folder', label: '选择文件夹' }
    ]
  )
  assert.match(summaryTextOf(view), /尚未添加图片/)
  assert.deepEqual(
    view.actions().map((a) => a.props.title),
    ['选择文件…', '选择文件夹…', '从剪贴板添加']
  )
  assert.equal(/[\u{1F300}-\u{1FAFF}]/u.test(view.text()), false, 'UI 文本严禁包含彩色 Emoji')
  view.unmount()

  // 不在 ZTools 客户端中时如实提示
  const prevWin = globalThis.window
  delete globalThis.window
  try {
    const outOfClient = BatchImageCommand()
    assert.match(outOfClient.props.subList.emptyText, /需要在 ZTools 客户端中使用/)
  } finally {
    globalThis.window = prevWin
  }
})

test('batch-image UI 选择文件与选择文件夹：覆盖多选、取消、报错翻译、递归过滤、排除 _opt、整盘确认与截断提示', async () => {
  const root = makeTempTree({
    'a.png': 'aa',
    'b.avif': 'bb',
    'c.tiff': 'cc',
    'nested/d.webp': 'dd',
    'nested/a_opt.png': 'opt',
    'nested/a_opt_20261116120000.jpg': 'opt2',
    'readme.txt': 'txt'
  })

  try {
    const host = createHost()
    await installDirectoryHost(host, { authorized: [root] })
    host.ipc.filesystem_get_file_size = async ({ path: p }) => ({
      success: true,
      size: fs.existsSync(p) ? fs.statSync(p).size : 4096
    })

    const view = await mount(BatchImageCommand, host)
    await tick(5)

    // 1. 选择文件取消不弹提示
    host.ipc.window_show_open_dialog = async () => ({ canceled: true })
    await filterBarActions(view).find((a) => a.id === 'pick-files').onAction()
    await tick(10)
    assert.equal(host.toasts.length, 0)

    // 2. 选择文件报错翻译
    host.ipc.window_show_open_dialog = async () => {
      throw new Error('当前窗口的文件 capability 数量超过上限')
    }
    await filterBarActions(view).find((a) => a.id === 'pick-files').onAction()
    await tick(10)
    assert.equal(host.lastToast()?.title, '导入失败')
    assert.match(String(host.lastToast()?.message), /改用「选择文件夹」/)

    // 3. 选择文件成功（同时验证向宿主传递全部 8 种扩展名过滤串）
    const singleFile = path.join(root, 'a.png')
    let openDialogParams = null
    host.ipc.window_show_open_dialog = async (params) => {
      openDialogParams = params
      return { canceled: false, filePaths: [singleFile] }
    }
    await filterBarActions(view).find((a) => a.id === 'pick-files').onAction()
    await tick(10)
    assert.equal(
      openDialogParams.filters,
      '图片文件|png;jpg;jpeg;webp;bmp;gif;tiff;avif'
    )
    assert.equal(host.lastToast()?.title, '已添加 1 个文件')
    assert.equal(subItems(view).length, 1)

    // 4. 选择整个磁盘根目录时触发确认弹窗；取消不遍历
    host.setConfirm(false)
    host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: 'D:\\' })
    await filterBarActions(view).find((a) => a.id === 'pick-folder').onAction()
    await tick(10)
    assert.equal(host.confirms.length, 1)
    assert.match(host.confirms[0].title, /导入整个磁盘/)

    // 5. 选择真实临时文件夹：去重 a.png、收集 avif/tiff/webp、排除 *_opt 输出和 txt
    host.setConfirm(true)
    host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: root })
    await filterBarActions(view).find((a) => a.id === 'pick-folder').onAction()
    await tick(15)
    assert.equal(host.lastToast()?.title, '已添加 3 个文件')
    assert.match(String(host.lastToast()?.message), /1 个已在列表中/)
    assert.match(String(host.lastToast()?.message), /忽略 3 个不支持的文件/)
    assert.deepEqual(
      subItems(view).map((i) => i.props.title),
      ['a.png', 'b.avif', 'c.tiff', 'd.webp']
    )
    assert.ok(subItems(view).every((i) => i.props.checked === true))
    assert.match(summaryTextOf(view), /清空列表 Ctrl\+Shift\+Backspace/)

    view.unmount()

    // 6. 超过 500 个文件时的数量截断提示
    const bigDir = 'D:\\BigImages'
    const hostBig = createHost()
    hostBig.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: bigDir })
    hostBig.ipc.filesystem_get_directory_contents = async () => ({
      success: true,
      files: Array.from({ length: 505 }, (_, i) => ({
        name: `img_${i}.png`,
        size: 1024,
        isDirectory: false
      }))
    })
    const bigView = await mount(BatchImageCommand, hostBig)
    await filterBarActions(bigView).find((a) => a.id === 'pick-folder').onAction()
    await tick(20)
    assert.equal(hostBig.lastToast()?.title, '已添加 500 个文件')
    assert.match(String(hostBig.lastToast()?.message), /只导入了一部分/)
    bigView.unmount()
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('batch-image UI 拖入文件夹（新旧客户端回退）、粘贴去重与从剪贴板添加', async () => {
  const root = makeTempTree({
    'v1.2_assets/drop1.png': '11',
    'v1.2_assets/drop1_opt.png': 'ignored',
    'single.gif': '22'
  })
  const dottedDir = path.join(root, 'v1.2_assets')
  const singleFile = path.join(root, 'single.gif')

  try {
    // 1. 新版宿主：fileInput 带 directories 展开，且不把扩展名交给宿主过滤
    const host = createHost()
    await installDirectoryHost(host, { authorized: [root] })
    const view = await mount(BatchImageCommand, host)
    await tick(5)
    const fileInput = view.tree().props.fileInput
    assert.equal(fileInput.allowDirectories, true)
    assert.equal('extensions' in fileInput, false)

    await view.dropFiles([dottedDir, singleFile], { directories: [dottedDir] })
    await tick(15)
    assert.deepEqual(subItems(view).map((i) => i.props.title), ['drop1.png', 'single.gif'])
    assert.equal(
      host.ipcCalls.some(([m]) => m === 'filesystem_directory_exists'),
      false,
      '有 directories 列表时不再逐个探测'
    )

    // 2. 旧版不带 directories 的 dropFiles 路径（经 filesystem_directory_exists 探测文件夹）
    host.ipc.filesystem_directory_exists = async ({ path: p }) => ({
      success: true,
      exists: p.toLowerCase() === dottedDir.toLowerCase()
    })
    await view.dropFiles([dottedDir])
    await tick(15)
    assert.equal(host.lastToast()?.title, '这些文件已在列表中')

    // 3. 从剪贴板添加（空路径提示、未授权大小标为未识别、已存在提示）
    host.clipboard.text = '一段普通文字'
    await view.run(undefined, '从剪贴板添加')
    await tick(10)
    assert.equal(host.lastToast()?.title, '剪贴板中没有图片文件路径')

    host.clipboard.text = '"D:\\Shots\\new_shot.png"\r\nD:\\Shots\\readme.txt'
    await view.run(undefined, '从剪贴板添加')
    await tick(15)
    assert.equal(host.lastToast()?.title, '已添加 1 个文件')
    const added = view.item((it) => it.props.title === 'new_shot.png')
    assert.equal(added.props.checked, true)
    assert.ok(added.props.accessories.some((a) => a.text === '大小未识别'))

    // clipboard_read_files 兜底
    host.clipboard.text = ''
    host.ipc.clipboard_read_files = async () => ({ files: ['D:\\Shots\\clip_file.bmp'] })
    host.ipc.filesystem_get_file_size = async () => ({ success: true, size: 2048 })
    await view.run(added, '从剪贴板添加')
    await tick(15)
    const clipFile = view.item((it) => it.props.title === 'clip_file.bmp')
    assert.ok(clipFile.props.accessories.some((a) => a.text === '2.0 KB'))

    view.unmount()

    // 4. 旧版宿主 plugin_files_dropped 事件回退（含文件夹展开）与卸载清理
    const legacyHost = createHost()
    await installDirectoryHost(legacyHost, { authorized: [root] })
    legacyHost.ipc.filesystem_directory_exists = async ({ path: p }) => ({
      success: true,
      exists: p.toLowerCase() === dottedDir.toLowerCase()
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
    const legacyView = await mount(BatchImageCommand, legacyHost)
    try {
      assert.equal(typeof droppedListener, 'function')
      droppedListener({ payload: { files: [dottedDir] } })
      await tick(20)
      assert.deepEqual(subItems(legacyView).map((i) => i.props.title), ['drop1.png'])
    } finally {
      legacyView.unmount()
      globalThis.window.__ztoolsDeclarativeFeatures = { fileInput: true }
    }
    assert.equal(droppedListener, null)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('batch-image UI 布局三渲染、逐张处理与失败路径', async () => {
  const host = createHost()
  host.ipc.filesystem_get_file_size = async ({ path: p }) => ({
    success: true,
    size: p === POSTER ? 3145728 : 1048576
  })
  const existing = new Set([POSTER.replace('.png', '_opt.png').toLowerCase()])
  host.ipc.filesystem_file_exists = async ({ path: p }) => ({ success: true, exists: existing.has(p.toLowerCase()) })
  const dllCalls = []
  host.ipc.dllplugin_call = async ({ plugin, func, params }) => {
    dllCalls.push({ plugin, func, params })
    await new Promise((r) => setTimeout(r, 10))
    return hostSuccess(params)
  }

  const view = await mount(BatchImageCommand, host)
  await view.dropFiles([POSTER, RECEIPT])
  await tick(15)

  const tree = view.tree()
  assert.equal(tree.type, 'List')
  assert.equal(tree.props.isShowingDetail, false)
  assert.ok(tree.props.workbenchPanel)
  assert.ok(tree.props.subList)
  assert.equal(/PDF|预计/.test(view.text()), false)
  assert.equal(tree.props.workbenchPanel.previewCard.badge, '未处理')

  const poster = view.item((it) => it.props.title === 'design_poster_4k.png')
  assert.equal(tagOf(poster), '待处理')

  // 并发锁：连续触发两次只执行一批
  await Promise.all([
    view.run(poster, '开始处理已选图片 (2 张)'),
    view.run(poster, '开始处理已选图片 (2 张)')
  ])
  await tick(10)
  assert.equal(dllCalls.length, 2)
  const byFile = new Map(dllCalls.map((c) => [c.params.files[0], c.params.outputPath]))
  assert.equal(byFile.get(POSTER), 'D:\\TestMedia\\pictures\\design_poster_4k_opt_2.png')
  assert.equal(byFile.get(RECEIPT), 'D:\\TestMedia\\pictures\\receipt_scan_opt.jpg')
  assert.equal(host.lastToast()?.title, '已处理 2 张图片')

  const posterDone = view.item((it) => it.props.title === 'design_poster_4k.png')
  await view.run(posterDone, '复制输出文件路径')
  assert.equal(host.clipboard.text, 'D:\\TestMedia\\pictures\\design_poster_4k_opt_2.png')

  // 全部失败、部分失败、超过 300KB
  host.ipc.dllplugin_call = async ({ params }) => hostFailure(params, 'DECODE_FAILED: 图片文件头损坏')
  await view.run(view.item((it) => it.props.title === 'design_poster_4k.png'), '开始处理已选图片 (2 张)')
  assert.equal(host.lastToast()?.title, '2 张图片全部处理失败')

  host.ipc.dllplugin_call = async ({ params }) =>
    params.files[0] === POSTER ? hostSuccess(params) : hostFailure(params, '图片编码转换失败: receipt_scan.jpg')
  await view.run(view.item((it) => it.props.title === 'design_poster_4k.png'), '开始处理已选图片 (2 张)')
  assert.equal(host.lastToast()?.title, '已处理 1 张，1 张失败')

  host.ipc.filesystem_file_exists = async () => ({ success: true, exists: false })
  host.ipc.dllplugin_call = async ({ params }) =>
    hostSuccess(params, { outputBytes: params.files[0] === POSTER ? 400 * 1024 : 200 * 1024, originalBytes: 3145728 })
  await view.dropdown('preset-extreme-300k')
  await view.run(view.item((it) => it.props.title === 'design_poster_4k.png'), '开始处理已选图片 (2 张)')
  assert.equal(host.lastToast()?.title, '已处理 2 张，1 张仍超过 300 KB')
  assert.equal(tagOf(view.item((it) => it.props.title === 'design_poster_4k.png')), '超过 300 KB')

  view.unmount()
})

test('batch-image UI 移除、清空、处理中防护（忽略已移除回执与拒绝清空）与导入中清空丢弃', async () => {
  const host = createHost()
  host.ipc.filesystem_get_file_size = async () => ({ success: true, size: 4096 })
  host.ipc.filesystem_file_exists = async () => ({ success: true, exists: false })

  let releaseFirst
  const firstGate = new Promise((r) => (releaseFirst = r))
  const calledFiles = []
  host.ipc.dllplugin_call = async ({ params }) => {
    calledFiles.push(params.files[0])
    if (params.files[0] === POSTER) await firstGate
    return hostSuccess(params)
  }

  const view = await mount(BatchImageCommand, host)
  await view.dropFiles([POSTER, RECEIPT, 'D:\\TestMedia\\pictures\\extra.png'])
  await tick(10)

  // 从列表移除不删磁盘文件（无 recycle/delete IPC）
  await view.run(view.item((it) => it.props.title === 'extra.png'), '从列表移除')
  assert.equal(subItems(view).length, 2)
  assert.equal(host.ipcCalls.some(([m]) => /trash|delete|unlink/i.test(m)), false)

  // 启动批处理 [POSTER, RECEIPT]，在 POSTER 处理中时：
  const posterNode = view.item((it) => it.props.title === 'design_poster_4k.png')
  const runPromise = view.run(posterNode, '开始处理已选图片 (2 张)')
  await tick(5)

  // 正在处理中的 POSTER 不提供「从列表移除」与「移入回收站」
  const processingActions = view.actions(view.item((it) => it.props.title === 'design_poster_4k.png')).map((a) => a.props.title)
  assert.equal(processingActions.includes('从列表移除'), false)
  assert.equal(processingActions.includes('将原图移入系统回收站'), false)

  // 处理中点「清空列表」被拒绝并不清空
  const receiptNode = view.item((it) => it.props.title === 'receipt_scan.jpg')
  await view.run(receiptNode, '清空列表')
  assert.equal(host.lastToast()?.title, '正在处理，完成后再清空')
  assert.equal(subItems(view).length, 2)

  // 处理中移除尚未开始的 RECEIPT，随后放行 POSTER：RECEIPT 应被跳过不调用宿主
  await view.run(view.item((it) => it.props.title === 'receipt_scan.jpg'), '从列表移除')
  assert.equal(subItems(view).length, 1)

  releaseFirst()
  await runPromise
  await tick(10)
  assert.deepEqual(calledFiles, [POSTER], '处理中已移出列表的条目不能再调用宿主')
  assert.equal(subItems(view).length, 1, '已移除的条目绝不能在回调里重新写回列表')

  // 空闲后清空列表
  await view.run(view.item((it) => it.props.title === 'design_poster_4k.png'), '清空列表')
  assert.equal(subItems(view).length, 0)

  // 导入进行中清空列表：进行中的导入结果被丢弃且不弹提示
  let releaseImport
  const importGate = new Promise((r) => (releaseImport = r))
  host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: 'D:\\PendingFolder' })
  host.ipc.filesystem_get_directory_contents = async () => {
    await importGate
    return { success: true, files: [{ name: 'late.png', size: 1024, isDirectory: false }] }
  }
  await view.dropFiles([POSTER])
  await tick(10)
  const toastCountBefore = host.toasts.length
  const folderTask = filterBarActions(view).find((a) => a.id === 'pick-folder').onAction()
  await tick(5)
  await view.run(view.item((it) => it.props.title === 'design_poster_4k.png'), '清空列表')
  assert.equal(subItems(view).length, 0)
  releaseImport()
  await folderTask
  await tick(10)
  assert.equal(view.items().length, 0, '导入进行中被清空后，后续结果必须丢弃')
  assert.equal(host.toasts.length, toastCountBefore, '已作废的导入不能弹提示')

  view.unmount()
})
