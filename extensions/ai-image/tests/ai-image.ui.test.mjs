import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHost, installDirectoryHost, mount, tick } from '../../shared/test-harness.mjs'
import AiImageCommand from '../dist/index.js'

const COLORFUL_EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u

// 与客户端一致：dllplugin_call 走内置图片处理时，结果对象会再带一份 data 副本（外层 { success, data } 由测试宿主包装）
function hostResult(record) {
  return { ...record, data: { ...record } }
}

function installProcessHost(host) {
  host.ipc.filesystem_file_exists = async () => ({ success: true, exists: false })
  host.ipc.dllplugin_call = async ({ params }) =>
    hostResult({
      ok: true,
      success: true,
      processedCount: 1,
      outputPath: params.outputPath,
      outputBytes: 2048000,
      sizeBytes: 2048000,
      width: 2400,
      height: 1600,
      results: [
        { sourcePath: params.inputPath, outputPath: params.outputPath, width: 2400, height: 1600, outputBytes: 2048000 }
      ],
      errors: []
    })
}

function makeTempDir(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-ai-image-ui-'))
  for (const [rel, content] of Object.entries(spec)) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return root
}

const dllCalls = host => host.ipcCalls.filter(([method]) => method === 'dllplugin_call')
const summary = view => view.tree().props.filterBar.props.summaryText
const metric = (view, label) => view.tree().props.workbenchPanel.previewCard.metrics.find(m => m.label === label).value

test('ai-image UI: 挂载零扫描，初始空列表且顶栏恰为 2 个导入按钮，无彩色 Emoji 与虚构模型', async () => {
  const host = createHost()
  const view = await mount(AiImageCommand, host)

  assert.equal(host.ipcCalls.length, 0, '挂载时严禁调用任何目录扫描或系统路径接口')
  const tree = view.tree()
  assert.deepEqual(tree.props.subList.items, [])
  assert.equal(summary(view), '尚未添加文件 · 可选择文件、文件夹，或直接拖入')

  const topActions = tree.props.filterBar.props.actions
  assert.equal(topActions.length, 2)
  assert.deepEqual(
    topActions.map(a => a.title),
    ['选择文件', '选择文件夹']
  )

  const emptyActions = view.actions().map(a => a.props.title)
  assert.deepEqual(emptyActions, ['选择文件…', '选择文件夹…'])

  const text = view.text()
  assert.ok(!COLORFUL_EMOJI.test(text), '界面不能有彩色 Emoji')
  for (const fake of ['Real-ESRGAN', 'ONNX', 'Vulkan', 'CUDA', 'RMBG', 'CodeFormer', 'WebP', '无损', '1x']) {
    assert.ok(!text.includes(fake), `界面不应出现客户端做不到的说法：${fake}`)
  }
  const dropdownTitles = tree.props.searchBarAccessory.children.map(c => c.props.title)
  assert.deepEqual(dropdownTitles, [
    '普通放大（非 AI）',
    'AI 超分辨率（暂不可用）',
    'AI 去背景（暂不可用）',
    'AI 人像修复（暂不可用）'
  ])
  const fieldIds = tree.props.workbenchPanel.fields.map(f => f.id)
  assert.deepEqual(fieldIds, ['wb-scale-factor', 'wb-output-format', 'wb-outdir'])
  assert.equal(metric(view, '输出分辨率'), '原尺寸 ×2')
  assert.equal(metric(view, '上次处理'), '尚未处理')
  view.unmount()
})

test('ai-image UI: 选择文件支持取消、宿主报错翻译、统一过滤 WebP，且大小未知时显示大小未识别', async () => {
  const host = createHost()
  const view = await mount(AiImageCommand, host)

  // 1. 取消不弹提示
  host.ipc.window_show_open_dialog = async () => ({ canceled: true })
  await view.run(undefined, '选择文件…')
  assert.equal(host.toasts.length, 0)
  assert.equal(view.tree().props.subList.items.length, 0)

  // 2. 宿主报错如实翻译
  host.ipc.window_show_open_dialog = async () => {
    throw new Error('当前窗口的文件 capability 数量超过上限')
  }
  await view.run(undefined, '选择文件…')
  assert.equal(host.lastToast().style, 'FAILURE')
  assert.match(host.lastToast().message, /改用「选择文件夹」/)

  // 3. 选中文件（不提供 filesystem_get_file_size -> 大小未识别，同时过滤 .webp）
  host.ipc.window_show_open_dialog = async params => {
    assert.equal(params.filters, '图片文件|png;jpg;jpeg;bmp')
    return {
      canceled: false,
      filePaths: ['D:\\Pics\\photo.png', 'D:\\Pics\\ignore.webp']
    }
  }
  await view.run(undefined, '选择文件…')
  await tick(10)
  const items = view.tree().props.subList.items
  assert.deepEqual(
    items.map(i => i.props.title),
    ['photo.png']
  )
  assert.equal(items[0].props.checked, true)
  assert.ok(items[0].props.accessories.some(a => a.text === '大小未识别'))
  assert.match(summary(view), /清空列表 Ctrl\+Shift\+Backspace/)
  assert.equal(host.lastToast().style, 'SUCCESS')
  assert.match(host.lastToast().message, /忽略 1 个不支持的文件/)
  view.unmount()
})

test('ai-image UI: 选择文件夹支持递归收集、过滤不支持格式与输出文件、数量截断提示，以及磁盘根目录确认', async () => {
  const tmpDir = makeTempDir({
    'a.png': 'aa',
    'sub/b.jpg': 'bb',
    'skip.webp': 'ww',
    'empty.png': '',
    'a_2x_20261028-153012.png': 'out'
  })
  const manyDir = makeTempDir(
    Object.fromEntries(Array.from({ length: 505 }, (_, idx) => [`img_${String(idx + 1).padStart(3, '0')}.png`, 'x']))
  )

  try {
    const host = createHost()
    await installDirectoryHost(host, { authorized: [tmpDir, manyDir] })
    const view = await mount(AiImageCommand, host)

    // 1. 选择磁盘根目录取消确认时不遍历
    host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: 'D:\\' })
    host.setConfirm(false)
    await view.tree().props.filterBar.props.actions[1].onAction()
    await tick(10)
    assert.equal(host.confirms.length, 1)
    assert.equal(host.ipcCalls.some(([m]) => m === 'filesystem_get_directory_contents'), false)

    // 2. 选择普通目录递归导入
    host.setConfirm(true)
    host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: tmpDir })
    await view.tree().props.filterBar.props.actions[1].onAction()
    await tick(15)
    assert.equal(host.ipcCalls.some(([m]) => m === 'window_show_open_dialog'), false, '选择文件夹不走 open_dialog')
    assert.deepEqual(
      view.tree().props.subList.items.map(i => i.props.title),
      ['a.png', 'b.jpg']
    )
    assert.equal(host.lastToast().style, 'SUCCESS')
    assert.match(host.lastToast().message, /忽略 3 个不支持的文件/)

    // 3. 超过 500 个文件时截断并提示
    await view.run(view.item(`ai-img-${path.join(tmpDir, 'a.png')}`), '清空列表')
    host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: manyDir })
    await view.tree().props.filterBar.props.actions[1].onAction()
    await tick(20)
    assert.equal(view.tree().props.subList.items.length, 500)
    assert.match(host.lastToast().message, /文件较多，只导入了一部分/)
    view.unmount()
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    fs.rmSync(manyDir, { recursive: true, force: true })
  }
})

test('ai-image UI: 拖入文件夹（含新版 directories 与旧版探测路径）及重复导入去重', async () => {
  const tmpDir = makeTempDir({
    '2026.11_照片/inner.png': 'ii',
    'single.bmp': 'bb',
    'skip.webp': 'ww'
  })
  try {
    const dottedDir = path.join(tmpDir, '2026.11_照片')
    const singleBmp = path.join(tmpDir, 'single.bmp')
    const skipWebp = path.join(tmpDir, 'skip.webp')

    const host = createHost()
    await installDirectoryHost(host, { authorized: [tmpDir] })
    host.ipc.filesystem_get_file_size = async ({ path: p }) => ({ success: true, size: fs.statSync(p).size })
    host.ipc.filesystem_directory_exists = async ({ path: p }) => ({
      success: true,
      exists: fs.existsSync(p) && fs.statSync(p).isDirectory()
    })

    const view = await mount(AiImageCommand, host)

    // 新版宿主透传 directories，不应逐个调用 filesystem_directory_exists
    await view.dropFiles([dottedDir, singleBmp, skipWebp], { directories: [dottedDir] })
    await tick(15)
    assert.equal(host.ipcCalls.some(([m]) => m === 'filesystem_directory_exists'), false)
    assert.deepEqual(
      view.tree().props.subList.items.map(i => i.props.title),
      ['inner.png', 'single.bmp']
    )

    // 重复导入去重（不重复追加）
    // Windows 路径不区分大小写，换成大写仍算同一个文件；macOS / Linux 区分大小写，用原路径验证去重
    await view.dropFiles([process.platform === 'win32' ? singleBmp.toUpperCase() : singleBmp])
    await tick(10)
    assert.equal(view.tree().props.subList.items.length, 2)
    assert.equal(host.lastToast().title, '这些文件已在列表中')

    // 清空后测试不带 directories 的旧版客户端路径
    await view.run(view.item(`ai-img-${singleBmp}`), '清空列表')
    await view.dropFiles([dottedDir])
    await tick(15)
    assert.equal(host.ipcCalls.some(([m]) => m === 'filesystem_directory_exists'), true)
    assert.deepEqual(
      view.tree().props.subList.items.map(i => i.props.title),
      ['inner.png']
    )
    view.unmount()
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('ai-image UI: 处理成功后行内显示真实输出，失败显示错误状态，批量处理需确认且不可用引擎禁止调用', async () => {
  const host = createHost()
  installProcessHost(host)
  host.ipc.filesystem_get_file_size = async () => ({ success: true, size: 600000 })
  const view = await mount(AiImageCommand, host)

  await view.pasteFiles(['D:\\Pics\\photo.png', 'D:\\Pics\\Docs\\scan.jpg'])
  await tick(15)

  await view.run(view.item('ai-img-D:\\Pics\\photo.png'), '仅处理这张图片')
  await tick()
  const calls = dllCalls(host)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][1].params.mode, 'upscale')
  assert.match(calls[0][1].params.outputPath, /^D:\\Pics\\photo_2x_\d{8}-\d{6}\.png$/)
  assert.equal(host.lastToast().style, 'SUCCESS')
  assert.equal(host.lastToast().title, '已放大 1 张图片')
  assert.match(host.lastToast().message, /2400×1600/)
  const okItem = view.item('ai-img-D:\\Pics\\photo.png')
  assert.ok(okItem.props.accessories.some(a => a.tag?.value === '已输出 2400×1600'))
  assert.match(okItem.props.subtitle, /photo_2x_\d{8}-\d{6}\.png$/)

  host.ipc.dllplugin_call = async () => {
    throw Object.assign(new Error('图像处理失败: scan.jpg'), { code: 'FAILED' })
  }
  await view.run(view.item('ai-img-D:\\Pics\\Docs\\scan.jpg'), '仅处理这张图片')
  await tick()
  assert.equal(host.lastToast().style, 'FAILURE')
  assert.equal(host.lastToast().title, '1 张图片处理失败')
  const failItem = view.item('ai-img-D:\\Pics\\Docs\\scan.jpg')
  assert.ok(failItem.props.accessories.some(a => a.tag?.value === '处理失败'))
  assert.equal(metric(view, '上次处理'), '1 张全部失败')

  // 批量确认取消与部分失败
  host.setConfirm(false)
  await view.run(view.item('ai-img-D:\\Pics\\photo.png'), '开始处理已勾选的 2 张')
  assert.equal(host.confirms.length, 1)
  assert.equal(dllCalls(host).length, 2)

  host.setConfirm(true)
  installProcessHost(host)
  const okHandler = host.ipc.dllplugin_call
  host.ipc.dllplugin_call = async req => {
    if (req.params.inputPath.endsWith('scan.jpg')) throw new Error('文件被占用')
    return okHandler(req)
  }
  await view.run(view.item('ai-img-D:\\Pics\\photo.png'), '开始处理已勾选的 2 张')
  await tick()
  assert.equal(host.lastToast().title, '完成 1 张，失败 1 张')
  assert.equal(metric(view, '上次处理'), '成功 1 张，失败 1 张')

  // 不可用引擎
  await view.dropdown('ai-background-removal')
  assert.match(summary(view), /AI 去背景暂不可用/)
  assert.equal(view.tree().props.workbenchPanel.previewCard.badge, '暂不可用')
  const prevDllCount = dllCalls(host).length
  await view.run(view.item('ai-img-D:\\Pics\\photo.png'), '仅处理这张图片')
  assert.equal(host.lastToast().title, 'AI 去背景暂不可用')
  assert.equal(dllCalls(host).length, prevDllCount)

  // 定位失败
  await view.run(view.item('ai-img-D:\\Pics\\photo.png'), '在资源管理器中显示')
  assert.equal(host.lastToast().title, '无法在资源管理器中显示')
  view.unmount()
})

test('ai-image UI: 从列表移除、全选切换、清空列表、处理中清空被拒绝与处理中移除不写回', async () => {
  const host = createHost()
  installProcessHost(host)
  host.ipc.filesystem_get_file_size = async () => ({ success: true, size: 500000 })
  const view = await mount(AiImageCommand, host)

  await view.pasteFiles(['D:\\Pics\\a.png', 'D:\\Pics\\b.png'])
  await tick(15)

  // 全选 / 取消全选
  await view.run(view.item('ai-img-D:\\Pics\\a.png'), '取消全选')
  assert.equal(view.item('ai-img-D:\\Pics\\a.png').props.checked, false)
  await view.run(view.item('ai-img-D:\\Pics\\a.png'), '全选')
  assert.equal(view.item('ai-img-D:\\Pics\\b.png').props.checked, true)

  // 处理进行中：正在处理的条目不提供「从列表移除」，清空列表被拒绝，未在处理的条目可移除且不影响结果
  let release
  const okHandler = host.ipc.dllplugin_call
  host.ipc.dllplugin_call = req =>
    new Promise(resolve => {
      release = () => resolve(okHandler(req))
    })

  const runAction = (itemId, title) => {
    const found = view.actions(view.item(itemId)).find(a => a.props.title === title)
    return found.props.onAction()
  }

  const pending = runAction('ai-img-D:\\Pics\\a.png', '仅处理这张图片')
  await tick()
  assert.equal(
    view.actions(view.item('ai-img-D:\\Pics\\a.png')).some(a => a.props.title === '从列表移除'),
    false,
    '正在处理中的条目不提供从列表移除'
  )
  assert.equal(
    view.actions(view.item('ai-img-D:\\Pics\\b.png')).some(a => a.props.title === '从列表移除'),
    true,
    '未在处理中的条目仍可移除'
  )

  await runAction('ai-img-D:\\Pics\\a.png', '清空列表')
  assert.equal(host.lastToast().title, '正在处理，完成后再清空')
  assert.equal(view.tree().props.subList.items.length, 2)

  // 处理中移除未锁定项 B，确认不删除磁盘文件，且 A 回调回来时不会把 B 写回
  await runAction('ai-img-D:\\Pics\\b.png', '从列表移除')
  assert.deepEqual(
    view.tree().props.subList.items.map(i => i.props.title),
    ['a.png']
  )
  assert.equal(host.ipcCalls.some(([m]) => m === 'shell_trash_item'), false)

  // 处理中重复提交也应拦截
  await runAction('ai-img-D:\\Pics\\a.png', '仅处理这张图片')
  assert.equal(host.lastToast().title, '正在处理，请等当前任务完成')

  release()
  await pending
  await tick()
  assert.deepEqual(
    view.tree().props.subList.items.map(i => i.props.title),
    ['a.png']
  )
  assert.ok(view.item('ai-img-D:\\Pics\\a.png').props.accessories.some(a => a.tag?.value === '已输出 2400×1600'))

  // 非处理中清空列表
  await view.run(view.item('ai-img-D:\\Pics\\a.png'), '清空列表')
  assert.equal(view.tree().props.subList.items.length, 0)
  assert.equal(metric(view, '上次处理'), '尚未处理')
  view.unmount()
})

test('ai-image UI: 导入中清空后结果被丢弃且不弹导入成功提示', async () => {
  const host = createHost()
  const view = await mount(AiImageCommand, host)

  await view.pasteFiles(['D:\\Pics\\existing.png'])
  await tick(10)

  let releaseDir
  host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: 'D:\\Folder' })
  host.ipc.filesystem_get_directory_contents = () =>
    new Promise(resolve => {
      releaseDir = () =>
        resolve({
          success: true,
          files: [{ name: 'late.png', size: 1234, isDirectory: false, lastModified: new Date().toISOString() }]
        })
    })

  const importPromise = view.tree().props.filterBar.props.actions[1].onAction()
  await tick()
  assert.match(summary(view), /正在导入/)

  host.toasts.length = 0
  await view.run(view.item('ai-img-D:\\Pics\\existing.png'), '清空列表')
  assert.equal(view.tree().props.subList.items.length, 0)

  releaseDir()
  await importPromise
  await tick(10)
  assert.equal(view.tree().props.subList.items.length, 0, '过期导入批次的结果必须丢弃')
  assert.equal(host.toasts.length, 0, '被清空中断的过期导入不应弹出成功提示')
  view.unmount()
})

test('ai-image UI: 非客户端环境下明确提示需要在 ZTools 客户端中使用', async () => {
  const host = createHost()
  delete globalThis.window
  const view = await mount(AiImageCommand, host)
  assert.equal(view.tree().props.subList.emptyText, '需要在 ZTools 客户端中使用')
  await view.run(undefined, '选择文件…')
  assert.equal(host.lastToast().style, 'FAILURE')
  assert.equal(host.lastToast().message, '需要在 ZTools 客户端中使用')
  view.unmount()
})

test('ai-image UI: 旧版客户端走 plugin_files_dropped 回退导入，组件卸载后处理回调不再写回', async () => {
  const host = createHost()
  installProcessHost(host)
  globalThis.window.__ztoolsDeclarativeFeatures = {}
  const view = await mount(AiImageCommand, host)
  host.emitEvent('plugin_files_dropped', { payload: { files: ['D:\\Pics\\legacy.png'] } })
  await tick(15)
  assert.deepEqual(
    view.tree().props.subList.items.map(i => i.props.title),
    ['legacy.png']
  )

  let release
  const okHandler = host.ipc.dllplugin_call
  host.ipc.dllplugin_call = req =>
    new Promise(resolve => {
      release = () => resolve(okHandler(req))
    })
  const pending = view.actions(view.item('ai-img-D:\\Pics\\legacy.png')).find(a => a.props.title === '仅处理这张图片').props.onAction()
  await tick()
  host.toasts.length = 0
  view.unmount()
  release()
  await pending
  await tick()
  assert.equal(host.toasts.length, 0, '组件卸载后处理回调不得继续弹 Toast 或写回状态')
})
