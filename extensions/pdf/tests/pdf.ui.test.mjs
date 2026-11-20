// 界面集成：挂载零扫盘、选择文件/文件夹、拖入文件夹、移除与清空列表、竞态保护及导出流程
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHost, installDirectoryHost, mount, tick } from '../../shared/test-harness.mjs'
import PdfCommand from '../dist/index.js'

const subItems = view => view.tree().props.subList.items

function makeTempTree(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-pdf-ui-'))
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

const FORBIDDEN_MOUNT_METHODS = new Set([
  'system_get_path',
  'system_list_common_folders',
  'system_search_files',
  'filesystem_get_directory_contents',
  'dllplugin_call'
])

test('挂载零扫盘：不调用任何目录扫描或系统路径接口，顶栏恰为 2 个按钮，空状态支持选择文件与文件夹', async () => {
  const host = createHost()
  const view = await mount(PdfCommand, host)
  await tick(10)

  const mountCalls = host.ipcCalls.map(([m]) => m)
  assert.equal(mountCalls.some(m => FORBIDDEN_MOUNT_METHODS.has(m)), false, `挂载不应调用扫盘接口，实际：${mountCalls.join(', ')}`)
  assert.equal(subItems(view).length, 0)

  const tree = view.tree()
  const fbActions = tree.props.filterBar.props.actions
  assert.deepEqual(
    fbActions.map(a => a.id),
    ['pick-files', 'pick-folder']
  )
  assert.deepEqual(
    fbActions.map(a => a.label),
    ['选择文件', '选择文件夹']
  )
  assert.match(tree.props.filterBar.props.summaryText, /尚未添加 PDF/)
  assert.match(tree.props.subList.emptyText, /尚未添加 PDF/)

  // 空状态动作依次为「选择文件…」「选择文件夹…」
  assert.deepEqual(
    view.actions().map(a => a.props.title),
    ['选择文件…', '选择文件夹…']
  )
  assert.equal('extensions' in (tree.props.fileInput || {}), false, '不把扩展名交给宿主过滤')
  assert.equal(tree.props.fileInput?.allowDirectories, true)

  // 只展示可用格式且无彩色 Emoji
  const dd = tree.props.searchBarAccessory
  const dropdownValues = (dd.children ?? dd.props.children).map(c => c.props.value)
  assert.deepEqual(dropdownValues, ['pdf-to-txt', 'pdf-to-html'])
  const fieldIds = tree.props.workbenchPanel.fields.map(f => f.id)
  assert.deepEqual(fieldIds, ['wb-format', 'wb-outdir', 'wb-limit', 'wb-unavailable'])
  assert.equal(/[\u{1F300}-\u{1FAFF}]/u.test(view.text()), false)

  view.unmount()

  // 非 ZTools 客户端环境中如实提示
  const prevElectron = globalThis.__ztoolsElectron
  const prevWindow = globalThis.window
  try {
    delete globalThis.__ztoolsElectron
    if (globalThis.window) delete globalThis.window.ztools
    const bareView = await mount(PdfCommand)
    await tick(5)
    assert.match(bareView.tree().props.filterBar.props.summaryText, /需要在 ZTools 客户端中使用/)
    assert.match(bareView.tree().props.subList.emptyText, /需要在 ZTools 客户端中使用/)
    bareView.unmount()
  } finally {
    globalThis.__ztoolsElectron = prevElectron
    globalThis.window = prevWindow
  }
})

test('选择文件：过滤非 PDF、去重并默认勾选；取消不报错；读取令牌超限提示改用选择文件夹', async () => {
  const host = createHost()
  host.ipc.filesystem_get_file_size = async ({ path: p }) => ({
    success: true,
    size: p.endsWith('empty.pdf') ? 0 : 128000
  })
  host.ipc.window_show_open_dialog = async () => ({
    canceled: false,
    filePaths: ['D:\\Docs\\report.pdf', 'D:\\Docs\\notes.txt', 'D:\\Docs\\empty.pdf']
  })

  const view = await mount(PdfCommand, host)
  await tick(10)

  const fbActions = view.tree().props.filterBar.props.actions
  await fbActions[0].onAction()
  await tick(10)

  const dialogCall = host.ipcCalls.find(([m]) => m === 'window_show_open_dialog')
  assert.equal(dialogCall[1].filters, 'PDF 文件|pdf')
  assert.deepEqual(subItems(view).map(i => i.props.title), ['report.pdf'])
  assert.equal(subItems(view)[0].props.checked, true)
  assert.equal(host.lastToast().style, 'SUCCESS')
  assert.equal(host.lastToast().title, '已添加 1 个文件')
  assert.match(host.lastToast().message, /忽略 2 个不支持的文件/)
  assert.match(view.tree().props.filterBar.props.summaryText, /清空列表 Ctrl\+Shift\+Backspace/)

  // 取消选择不弹错误
  const toastCountBefore = host.toasts.length
  host.ipc.window_show_open_dialog = async () => ({ canceled: true })
  await fbActions[0].onAction()
  await tick(5)
  assert.equal(host.toasts.length, toastCountBefore)

  // 宿主令牌超限如实给出改用选择文件夹的提示
  host.ipc.window_show_open_dialog = async () => {
    throw new Error('当前窗口的文件 capability 数量超过上限')
  }
  await fbActions[0].onAction()
  await tick(5)
  assert.equal(host.lastToast().style, 'FAILURE')
  assert.equal(host.lastToast().title, '导入失败')
  assert.match(host.lastToast().message, /改用「选择文件夹」/)

  view.unmount()
})

test('选择文件夹：递归收集 .pdf、跳过无关与受保护目录、整盘确认与上限截断', async () => {
  const root = makeTempTree({
    'a.pdf': 'pdf-a',
    'sub/b.PDF': 'pdf-b',
    'sub/notes.docx': 'doc',
    'empty.pdf': '',
    '.hidden.pdf': 'hidden',
    'node_modules/x.pdf': 'nm',
    // 受保护规则匹配 Windows 的 \Windows\System32；macOS 上同名文件夹只是普通目录，不在这里断言跳过
    ...(process.platform === 'win32' ? { 'Windows/System32/sys.pdf': 'sys' } : {})
  })
  try {
    const host = createHost()
    await installDirectoryHost(host, { authorized: [root] })
    host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: root })

    const view = await mount(PdfCommand, host)
    await tick(10)

    const fbActions = view.tree().props.filterBar.props.actions
    await fbActions[1].onAction()
    await tick(15)

    assert.deepEqual(subItems(view).map(i => i.props.title), ['a.pdf', 'b.PDF'])
    assert.equal(subItems(view)[1].props.subtitle, path.join(root, 'sub'))
    assert.equal(host.lastToast().style, 'SUCCESS')
    assert.equal(host.lastToast().title, '已添加 2 个文件')

    // 重复选择同一文件夹去重不重复添加
    await fbActions[1].onAction()
    await tick(15)
    assert.equal(subItems(view).length, 2)
    assert.equal(host.lastToast().style, 'FAILURE')
    assert.equal(host.lastToast().title, '这些文件已在列表中')

    // 选中盘符根目录先确认：取消则不读取目录
    host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: 'Z:\\' })
    host.setConfirm(false)
    const beforeDirCalls = host.ipcCalls.filter(([m]) => m === 'filesystem_get_directory_contents').length
    await fbActions[1].onAction()
    await tick(10)
    assert.equal(host.confirms.length, 1)
    assert.match(host.confirms[0].title, /导入整个磁盘 Z:\\/)
    assert.equal(host.ipcCalls.filter(([m]) => m === 'filesystem_get_directory_contents').length, beforeDirCalls)

    // 超过 500 个文件触发截断提示
    host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: 'D:\\BigPdfDir' })
    host.ipc.filesystem_get_directory_contents = async () => ({
      success: true,
      files: Array.from({ length: 505 }, (_, i) => ({
        name: `doc_${i + 1}.pdf`,
        size: 1024,
        isDirectory: false,
        lastModified: '2026-10-01T00:00:00Z'
      }))
    })
    await fbActions[1].onAction()
    await tick(15)
    assert.equal(subItems(view).length, 502)
    assert.equal(host.lastToast().style, 'SUCCESS')
    assert.match(host.lastToast().message, /文件较多，只导入了一部分/)

    // 子目录读取失败只记录不中断、根目录失败整体报错
    const lockedDir = path.join(root, 'sub')
    await installDirectoryHost(host, { authorized: [root] })
    const origList = host.ipc.filesystem_get_directory_contents
    host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: root })
    host.ipc.filesystem_get_directory_contents = async params => {
      if (params.path === lockedDir) throw new Error('PERMISSION_DENIED')
      return origList(params)
    }
    await fbActions[1].onAction()
    await tick(15)
    // a.pdf 和 sub/b.PDF 之前已经在了，sub 失败应给出子文件夹无法读取或已有提示
    assert.ok(host.lastToast().message.includes('无法读取') || host.lastToast().title === '这些文件已在列表中')

    host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: 'D:\\UnauthorizedDir' })
    host.ipc.filesystem_get_directory_contents = async () => {
      throw new Error('路径未由当前窗口授权')
    }
    await fbActions[1].onAction()
    await tick(10)
    assert.equal(host.lastToast().style, 'FAILURE')
    assert.equal(host.lastToast().title, '导入失败')
    assert.match(host.lastToast().message, /文件授权已过期或未授权/)

    view.unmount()
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('拖入文件夹（含新旧客户端路径与旧版 plugin_files_dropped 回退）并去重', async () => {
  const root = makeTempTree({
    'v1.2_reports/inner.pdf': 'pdf-inner',
    'v1.2_reports/pic.png': 'png',
    'direct.pdf': 'pdf-direct'
  })
  const dottedDir = path.join(root, 'v1.2_reports')
  const directPdf = path.join(root, 'direct.pdf')

  try {
    // 1. 新版宿主：传入 directories 集合（名称带点的文件夹也能展开）
    const host = createHost()
    await installDirectoryHost(host, { authorized: [root] })
    host.ipc.filesystem_get_file_size = async ({ path: p }) => ({
      success: true,
      size: fs.statSync(p).size
    })

    const view = await mount(PdfCommand, host)
    await tick(10)
    await view.dropFiles([dottedDir, directPdf], { directories: [dottedDir] })
    await tick(15)
    assert.deepEqual(subItems(view).map(i => i.props.title), ['inner.pdf', 'direct.pdf'])
    assert.equal(host.ipcCalls.some(([m]) => m === 'filesystem_directory_exists'), false)
    view.unmount()

    // 2. 旧版客户端（不带 directories）：通过 filesystem_directory_exists 探测展开
    const legacyHost = createHost()
    await installDirectoryHost(legacyHost, { authorized: [root] })
    legacyHost.ipc.filesystem_directory_exists = async ({ path: p }) => ({
      success: true,
      exists: fs.existsSync(p) && fs.statSync(p).isDirectory()
    })
    legacyHost.ipc.filesystem_get_file_size = async ({ path: p }) => ({
      success: true,
      size: fs.statSync(p).size
    })
    const legacyView = await mount(PdfCommand, legacyHost)
    await tick(10)
    await legacyView.dropFiles([dottedDir, directPdf])
    await tick(15)
    assert.deepEqual(subItems(legacyView).map(i => i.props.title), ['inner.pdf', 'direct.pdf'])
    assert.equal(legacyHost.ipcCalls.some(([m]) => m === 'filesystem_directory_exists'), true)
    legacyView.unmount()

    // 3. 更旧客户端（fileInput: false）：走 plugin_files_dropped 事件回退
    const oldHost = createHost()
    await installDirectoryHost(oldHost, { authorized: [root] })
    oldHost.ipc.filesystem_directory_exists = async ({ path: p }) => ({
      success: true,
      exists: fs.existsSync(p) && fs.statSync(p).isDirectory()
    })
    oldHost.ipc.filesystem_get_file_size = async ({ path: p }) => ({
      success: true,
      size: fs.statSync(p).size
    })
    globalThis.window.__ztoolsDeclarativeFeatures = { fileInput: false }
    const oldView = await mount(PdfCommand, oldHost)
    await tick(10)
    oldHost.emitEvent('plugin_files_dropped', { payload: { files: [dottedDir] } })
    await tick(15)
    assert.deepEqual(subItems(oldView).map(i => i.props.title), ['inner.pdf'])
    oldView.unmount()
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('从列表移除（不删磁盘文件）、清空列表、导出中禁止清空与导入中清空丢弃过期结果', async () => {
  const root = makeTempTree({
    'one.pdf': 'pdf-1',
    'two.pdf': 'pdf-2'
  })
  const onePath = path.join(root, 'one.pdf')
  const twoPath = path.join(root, 'two.pdf')

  try {
    const host = createHost()
    await installDirectoryHost(host, { authorized: [root] })
    host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: root })
    host.ipc.filesystem_file_exists = async () => ({ success: true, exists: false })

    let releaseExport
    const exportGate = new Promise(r => (releaseExport = r))
    host.ipc.dllplugin_call = async ({ params }) => {
      await exportGate
      return { ok: true, success: true, outputPath: params.outputPath, text: 'ok text' }
    }

    const view = await mount(PdfCommand, host)
    await tick(10)

    // 导入 2 个文件
    await view.tree().props.filterBar.props.actions[1].onAction()
    await tick(15)
    assert.deepEqual(subItems(view).map(i => i.props.title), ['one.pdf', 'two.pdf'])

    // 从列表移除 one.pdf，磁盘文件必须保留
    await view.run(subItems(view)[0], '从列表移除')
    await tick(5)
    assert.deepEqual(subItems(view).map(i => i.props.title), ['two.pdf'])
    assert.equal(fs.existsSync(onePath), true, '从列表移除绝不能删除磁盘文件')

    // 导出进行中：不显示「从列表移除」，点击「清空列表」被拒绝
    const runAction = view.actions(subItems(view)[0]).find(a => a.props.title.startsWith('导出已勾选'))
    const runningPromise = runAction.props.onAction()
    await tick(5)
    assert.equal(view.actions(subItems(view)[0]).some(a => a.props.title === '从列表移除'), false)
    await view.run(subItems(view)[0], '清空列表')
    assert.equal(host.lastToast().style, 'FAILURE')
    assert.equal(host.lastToast().title, '正在处理，完成后再清空')
    assert.equal(subItems(view).length, 1)

    releaseExport()
    await runningPromise
    await tick(10)

    // 空闲后清空列表：清空列表与上次结果，不碰磁盘文件
    await view.run(subItems(view)[0], '清空列表')
    await tick(5)
    assert.equal(subItems(view).length, 0)
    assert.equal(view.tree().props.workbenchPanel.previewCard.subtitle, '尚未导出')
    assert.equal(fs.existsSync(twoPath), true)

    // 导入进行中清空列表：异步导入返回后结果被丢弃，不加入列表也不弹 Toast
    let releaseDir
    const dirGate = new Promise(r => (releaseDir = r))
    host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: 'D:\\SlowDir' })
    host.ipc.filesystem_get_directory_contents = async () => {
      await dirGate
      return {
        success: true,
        files: [{ name: 'late.pdf', size: 2048, isDirectory: false, lastModified: '2026-10-01T00:00:00Z' }]
      }
    }
    const importPromise = view.tree().props.filterBar.props.actions[1].onAction()
    await tick(5)
    assert.match(view.tree().props.filterBar.props.summaryText, /正在导入/)

    // 提前模拟先有一项在列表中或直接触发清空（把清空动作从临时再加项或直接检查未加项——先放入 one.pdf 以便拿到动作面板的清空列表）
    releaseDir()
    await importPromise
    await tick(10)
    assert.equal(subItems(view).length, 1)

    // 真正构造「列表有项时发起异步导入 -> 导入途中点清空 -> 导入完成结果被丢弃」
    let releaseSlow
    const slowGate = new Promise(r => (releaseSlow = r))
    host.ipc.filesystem_get_directory_contents = async () => {
      await slowGate
      return {
        success: true,
        files: [{ name: 'stale.pdf', size: 2048, isDirectory: false, lastModified: '2026-10-01T00:00:00Z' }]
      }
    }
    const slowPromise = view.tree().props.filterBar.props.actions[1].onAction()
    await tick(5)
    const toastCountAtImportStart = host.toasts.length
    await view.run(subItems(view)[0], '清空列表')
    await tick(5)
    assert.equal(subItems(view).length, 0)
    releaseSlow()
    await slowPromise
    await tick(10)
    assert.equal(subItems(view).length, 0, '导入途中清空后，过期导入结果必须丢弃')
    assert.equal(host.toasts.length, toastCountAtImportStart, '过期导入结果不应弹 Toast')

    view.unmount()
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('导出核心业务：未勾选导出当前 PDF 重名加序号、批量部分失败如实提示、重复触发防护与打开失败提示', async () => {
  const host = createHost()
  host.ipc.filesystem_get_file_size = async () => ({ success: true, size: 400000 })
  host.ipc.window_show_open_dialog = async () => ({
    canceled: false,
    filePaths: ['D:\\Docs\\report.pdf', 'D:\\Docs\\Scans\\scan.pdf']
  })
  host.ipc.filesystem_file_exists = async ({ path: p }) => ({
    success: true,
    exists: p === 'D:\\Docs\\report.txt'
  })

  let releaseSlow
  const slowGate = new Promise(r => (releaseSlow = r))
  let blockSlow = false
  host.ipc.dllplugin_call = async ({ params }) => {
    if (blockSlow) await slowGate
    if (params.inputPath.endsWith('scan.pdf')) {
      return { ok: false, success: false, error: '未能从 PDF 中提取到文字：可能是扫描件' }
    }
    return { ok: true, success: true, outputPath: params.outputPath, text: 'Annual report text' }
  }

  const view = await mount(PdfCommand, host)
  await tick(10)
  await view.tree().props.filterBar.props.actions[0].onAction()
  await tick(10)

  // 取消全选，测试未勾选时主动作「导出当前 PDF」
  view.tree().props.subList.onCheckChange(false)
  await tick()
  await view.run(subItems(view)[0], '导出当前 PDF')
  await tick(10)

  const dll = host.ipcCalls.filter(([m]) => m === 'dllplugin_call')
  assert.equal(dll.length, 1)
  assert.equal(dll[0][1].params.outputPath, 'D:\\Docs\\report (1).txt')
  assert.equal(host.lastToast().style, 'SUCCESS')
  assert.equal(host.lastToast().title, '已导出 1 个文件')
  assert.ok(subItems(view)[0].props.accessories.some(a => a.tag?.value === '已导出'))
  assert.ok(view.actions(subItems(view)[0]).some(a => a.props.title === '在文件夹中显示上次输出'))

  // 打开文件失败提示
  await view.run(subItems(view)[0], '用默认程序打开 PDF')
  assert.equal(host.lastToast().title, '无法打开文件')
  assert.equal(host.lastToast().style, 'FAILURE')

  // 全部勾选批量导出：部分失败按失败提示并给出原因
  view.tree().props.subList.onCheckChange(true)
  await tick()
  await view.run(subItems(view)[0], '导出已勾选的 2 个 PDF')
  await tick(10)
  assert.equal(host.lastToast().style, 'FAILURE')
  assert.equal(host.lastToast().title, '1 个已导出，1 个失败')
  assert.match(host.lastToast().message, /scan\.pdf：.*扫描件/)
  assert.ok(subItems(view).find(i => i.props.title === 'scan.pdf').props.accessories.some(a => a.tag?.value === '导出失败'))

  // 导出进行中再次触发：提示稍候，不重复调用客户端
  blockSlow = true
  const action = view.actions(subItems(view)[0]).find(a => a.props.title.startsWith('导出已勾选'))
  const beforeDll = host.ipcCalls.filter(([m]) => m === 'dllplugin_call').length
  const p1 = action.props.onAction()
  await tick(5)
  await action.props.onAction()
  assert.equal(host.lastToast().title, '上一批还在导出，请稍候')
  releaseSlow()
  await p1
  await tick(10)
  // 第二个文件 scan.pdf 也会在 p1 内串行调用一次
  assert.equal(host.ipcCalls.filter(([m]) => m === 'dllplugin_call').length, beforeDll + 2)

  // 授权过期时输出检查失败友好提示
  host.ipc.filesystem_file_exists = async () => {
    throw new Error('路径未由当前窗口授权')
  }
  await view.run(subItems(view)[0], '仅导出当前 PDF')
  await tick(10)
  assert.equal(host.lastToast().style, 'FAILURE')
  assert.match(host.lastToast().message, /文件授权已过期或未授权/)

  view.unmount()
})
