import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHost, installDirectoryHost, mount, tick } from '../../shared/test-harness.mjs'
import ShredderCommand from '../dist/index.js'

function makeTempTree(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-shredder-'))
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

function installShredHost(host, { failPaths = [] } = {}) {
  const wipeCalls = []
  host.ipc.dllplugin_call = async ({ plugin, func, params }) => {
    assert.equal(plugin, 'ShredderPlugin')
    assert.equal(func, 'secureWipeFile')
    wipeCalls.push(params)
    if (failPaths.includes(params.path)) {
      return { ok: false, success: false, error: '文件正被其他程序占用' }
    }
    return { ok: true, success: true, shreddedCount: 1, shredded: [params.path], errors: [] }
  }
  return wipeCalls
}

function fileRows(view) {
  return view.items().filter((it) => String(it.props.id).startsWith('shred-item-'))
}

function rowByPath(view, p) {
  return fileRows(view).find((it) => it.props.subtitle === p)
}

test('shredder UI: 挂载时不扫描任何目录、列表为空、顶栏恰为 2 个按钮且空状态提供选择动作', async () => {
  const host = createHost()
  const view = await mount(ShredderCommand, host)

  assert.equal(fileRows(view).length, 0)
  const forbiddenStartupMethods = new Set([
    'system_get_path',
    'system_list_common_folders',
    'system_search_files',
    'filesystem_get_directory_contents',
    'dllplugin_call'
  ])
  assert.equal(
    host.ipcCalls.some(([method]) => forbiddenStartupMethods.has(method)),
    false,
    `挂载时不应调用扫盘或原生能力，实际调用：${JSON.stringify(host.ipcCalls)}`
  )

  const tree = view.tree()
  assert.equal(tree.props.isShowingDetail, false)
  assert.equal(tree.props.filterBar.actions.length, 2)
  assert.deepEqual(
    tree.props.filterBar.actions.map((a) => [a.id, a.title]),
    [
      ['pick-files', '选择文件'],
      ['pick-folder', '选择文件夹']
    ]
  )
  assert.match(tree.props.filterBar.summaryText, /尚未添加文件/)

  const rootActionTitles = view.actions(null).map((a) => a.props.title)
  assert.equal(rootActionTitles[0], '选择文件…')
  assert.equal(rootActionTitles[1], '选择文件夹…')

  view.unmount()
})

test('shredder UI: 选择文件支持取消、宿主报错、系统路径拦截，且新导入文件默认不勾选', async () => {
  const host = createHost()
  const view = await mount(ShredderCommand, host)

  // 1. 取消选择不改变列表也不弹 Toast
  host.ipc.window_show_open_dialog = async () => ({ canceled: true })
  await view.tree().props.filterBar.actions[0].onAction()
  await tick(10)
  assert.equal(fileRows(view).length, 0)
  assert.equal(host.toasts.length, 0)

  // 2. 宿主报错如实提示
  host.ipc.window_show_open_dialog = async () => {
    throw new Error('当前窗口的文件 capability 数量超过上限')
  }
  await view.tree().props.filterBar.actions[0].onAction()
  await tick(10)
  assert.equal(host.lastToast().style, 'FAILURE')
  assert.match(host.lastToast().message, /改用「选择文件夹」/)

  // 3. 多选普通文件 + 系统受保护路径 + 未知大小文件：系统路径被拦截，普通文件默认未勾选
  const normalFile = 'D:\\Scratch\\secret.docx'
  const unknownSizeFile = 'D:\\Scratch\\unknown.bin'
  const systemFile = 'C:\\Windows\\System32\\drivers\\etc\\hosts'
  host.ipc.window_show_open_dialog = async (params) => {
    assert.deepEqual(params.properties, ['openFile', 'multiSelections'])
    return { canceled: false, filePaths: [normalFile, systemFile, unknownSizeFile] }
  }
  host.ipc.filesystem_get_file_size = async ({ path: p }) => {
    if (p === normalFile) return 16384
    throw new Error('未授权')
  }
  await view.run(null, '选择文件…')
  await tick(10)

  const rows = fileRows(view)
  assert.equal(rows.length, 2)
  assert.ok(rows.every((r) => r.props.checked === false), '新导入文件必须默认不勾选')
  assert.equal(rowByPath(view, systemFile), undefined, 'Windows 系统目录文件必须被拦截')
  assert.equal(rowByPath(view, normalFile).props.accessories[2].text, '16.0 KB')
  assert.equal(rowByPath(view, unknownSizeFile).props.accessories[2].text, '大小未识别')

  view.unmount()
})

test('shredder UI: 选择文件夹递归导入非空文件（跳过空文件与系统子目录）、磁盘根目录二次确认及数量截断提示', async () => {
  const tmpDir = makeTempTree({
    'note.txt': 'hello',
    'sub/dump.dmp': 'binary-data',
    'empty.tmp': '',
    'System32/kernel.dll': 'sys',
    '.hidden.dat': 'hidden'
  })
  try {
    const host = createHost()
    await installDirectoryHost(host, { authorized: [tmpDir] })
    const view = await mount(ShredderCommand, host)

    // 1. 选磁盘根目录时先弹出 confirmAlert，取消则不读目录
    host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: 'D:\\' })
    host.setConfirm(false)
    await view.tree().props.filterBar.actions[1].onAction()
    await tick(10)
    assert.equal(host.confirms.length, 1)
    assert.match(host.confirms[0].title, /导入整个磁盘/)
    assert.equal(host.ipcCalls.some(([m]) => m === 'filesystem_get_directory_contents'), false)

    // 2. 选择受保护系统目录直接报错
    host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: 'C:\\Windows\\System32' })
    await view.tree().props.filterBar.actions[1].onAction()
    await tick(10)
    assert.equal(host.lastToast().style, 'FAILURE')
    assert.match(host.lastToast().message, /受保护/)

    // 3. 正常选择临时目录：递归导入，跳过空文件和受保护子目录，全部默认不勾选
    host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: tmpDir })
    await view.run(null, '选择文件夹…')
    await tick(15)

    const rows = fileRows(view)
    assert.equal(rows.length, 2)
    assert.ok(rows.every((r) => r.props.checked === false), '文件夹导入的文件必须默认不勾选')
    const noteRow = rowByPath(view, path.join(tmpDir, 'note.txt'))
    const dumpRow = rowByPath(view, path.join(tmpDir, 'sub', 'dump.dmp'))
    assert.ok(noteRow)
    assert.ok(dumpRow)
    assert.equal(noteRow.props.accessories[1].tag.value, '文件夹导入')

    // 4. 文件数超过 500 时标记截断并提示「只导入了一部分」
    const bulkHost = createHost()
    const bulkDir = 'D:\\BulkLogs'
    bulkHost.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: bulkDir })
    bulkHost.ipc.filesystem_get_directory_contents = async () => ({
      success: true,
      files: Array.from({ length: 505 }, (_, i) => ({
        name: `log_${i}.txt`,
        size: 128,
        isDirectory: false,
        lastModified: '2026-01-01T00:00:00Z'
      }))
    })
    const bulkView = await mount(ShredderCommand, bulkHost)
    await bulkView.tree().props.filterBar.actions[1].onAction()
    await tick(15)
    assert.equal(fileRows(bulkView).length, 500)
    assert.match(bulkHost.lastToast().message, /只导入了一部分/)

    bulkView.unmount()
    view.unmount()
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('shredder UI: 拖入文件夹（新版含 directories 与旧版回退）、粘贴去重且不丢失原有勾选', async () => {
  const tmpDir = makeTempTree({
    'a.bin': 'aaa',
    'nested/b.log': 'bbb'
  })
  try {
    const host = createHost()
    await installDirectoryHost(host, { authorized: [tmpDir] })
    const pastedFile = path.join(tmpDir, 'a.bin')
    const extraFile = 'D:\\Secret\\extra.dat'
    host.ipc.filesystem_get_file_size = async ({ path: p }) => (p === extraFile ? 4096 : 3)
    host.ipc.filesystem_directory_exists = async ({ path: p }) => path.resolve(p) === path.resolve(tmpDir)

    const view = await mount(ShredderCommand, host)

    // 1. 新版拖入文件夹（携带 directories）不调 filesystem_directory_exists
    await view.dropFiles([tmpDir], { directories: [tmpDir] })
    await tick(15)
    assert.equal(fileRows(view).length, 2)
    assert.equal(host.ipcCalls.some(([m]) => m === 'filesystem_directory_exists'), false)
    assert.ok(fileRows(view).every((r) => r.props.checked === false))

    // 勾选一个已有文件，随后旧版拖入（不带 directories）与粘贴重复文件
    await view.run(rowByPath(view, pastedFile), '勾选此文件')
    assert.equal(rowByPath(view, pastedFile).props.checked, true)

    await view.dropFiles([tmpDir, extraFile])
    await tick(15)
    assert.equal(host.ipcCalls.some(([m]) => m === 'filesystem_directory_exists'), true)
    assert.equal(fileRows(view).length, 3)
    assert.equal(rowByPath(view, pastedFile).props.checked, true, '重复导入不能覆盖原有勾选')
    assert.equal(rowByPath(view, extraFile).props.checked, false, '新导入文件必须保持未勾选')

    // 全部重复时给出提示
    await view.pasteFiles([extraFile.toUpperCase()])
    await tick(10)
    assert.equal(fileRows(view).length, 3)
    assert.equal(host.lastToast().title, '这些文件已在列表中')

    view.unmount()

    // 旧版客户端不提供 onFileInput 时通过 plugin_files_dropped 回退入口导入，且默认不勾选
    globalThis.window.__ztoolsDeclarativeFeatures = { fileInput: false }
    const legacyView = await mount(ShredderCommand, host)
    host.emitEvent('plugin_files_dropped', { payload: { files: [extraFile] } })
    await tick(15)
    assert.equal(fileRows(legacyView).length, 1)
    assert.equal(rowByPath(legacyView, extraFile).props.checked, false)
    legacyView.unmount()
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('shredder UI: 确认框逐个列出并支持取消、部分失败保留勾选且不改用普通删除、下拉切换覆写次数', async () => {
  const host = createHost()
  const FILE_A = 'D:\\Scratch\\a.tmp'
  const FILE_B = 'D:\\Scratch\\b.log'
  const FILE_C = 'D:\\Scratch\\c.dmp'
  const wipeCalls = installShredHost(host, { failPaths: [FILE_C] })
  host.ipc.window_show_open_dialog = async () => ({ canceled: false, filePaths: [FILE_A, FILE_B, FILE_C] })
  host.ipc.filesystem_get_file_size = async ({ path: p }) => (p === FILE_A ? 4096 : p === FILE_B ? 2048 : 8192)

  const view = await mount(ShredderCommand, host)
  await view.run(null, '选择文件…')
  await tick(10)

  // 未勾选时不弹确认也不调用粉碎
  await view.run(rowByPath(view, FILE_A), '粉碎已勾选文件 (0 项 / 0 B)')
  assert.equal(host.confirms.length, 0)
  assert.equal(wipeCalls.length, 0)
  assert.equal(host.lastToast().title, '请先勾选要粉碎的文件')

  // 勾选 FILE_A 和 FILE_C，取消确认
  await view.run(rowByPath(view, FILE_A), '勾选此文件')
  await view.run(rowByPath(view, FILE_C), '勾选此文件')
  host.setConfirm(false)
  await view.run(rowByPath(view, FILE_A), '粉碎已勾选文件 (2 项 / 12.0 KB)')

  assert.equal(host.confirms.length, 1)
  assert.equal(host.confirms[0].title, '确认粉碎 2 个文件？')
  assert.match(host.confirms[0].message, /a\.tmp/)
  assert.match(host.confirms[0].message, /c\.dmp/)
  assert.match(host.confirms[0].message, /磨损均衡/)
  assert.match(host.confirms[0].message, /TRIM/)
  assert.doesNotMatch(host.confirms[0].message, /b\.log/)
  assert.equal(wipeCalls.length, 0)

  // 文件清单项与导航项的 Enter 主动作必须是安全操作，粉碎动作退至次动作并带快捷键
  const rowActions = view.actions(rowByPath(view, FILE_A))
  assert.equal(rowActions[0].props.title, '在资源管理器中定位此文件')
  const shredAct = rowActions.find((a) => a.props.title.startsWith('粉碎已勾选文件'))
  assert.ok(shredAct && shredAct.props.shortcut, '粉碎动作应配置快捷键并位于次动作')
  const navAllActions = view.actions(view.item('nav-shred-all'))
  assert.notEqual(navAllActions[0].props.title.startsWith('粉碎已勾选文件'), true)

  // 切换为 7 次覆写并执行粉碎（FILE_C 模拟占用失败）
  await view.dropdown('seven_pass')
  host.setConfirm(true)
  await view.run(rowByPath(view, FILE_A), '粉碎已勾选文件 (2 项 / 12.0 KB)')

  assert.deepEqual(wipeCalls.map((c) => c.path).sort(), [FILE_A, FILE_C].sort())
  assert.equal(wipeCalls[0].passes, 7)
  assert.ok(!wipeCalls.some((c) => c.path === FILE_B), '未勾选的文件不能被粉碎')
  assert.ok(!host.ipcCalls.some(([m]) => m === 'filesystem_delete_file' || m === 'shell_trash_item'))

  const toast = host.lastToast()
  assert.equal(toast.style, 'FAILURE')
  assert.equal(toast.title, '部分文件粉碎失败')
  assert.match(toast.message, /已粉碎 1 个文件/)
  assert.match(toast.message, /1 个失败/)
  assert.match(toast.message, /文件正被其他程序占用/)

  assert.equal(rowByPath(view, FILE_A), undefined)
  assert.equal(rowByPath(view, FILE_C).props.checked, true)
  assert.equal(rowByPath(view, FILE_B).props.checked, false)

  // 定位文件失败如实提示
  await view.run(rowByPath(view, FILE_B), '在资源管理器中定位此文件')
  assert.equal(host.lastToast().title, '无法在资源管理器中定位此文件')

  view.unmount()
})

test('shredder UI: 从列表移除、全选/取消全选、清空列表、处理中拒绝清空、导入中清空丢弃结果', async () => {
  const host = createHost()
  const FILE_A = 'D:\\Scratch\\a.bin'
  const FILE_B = 'D:\\Scratch\\b.bin'
  host.ipc.window_show_open_dialog = async () => ({ canceled: false, filePaths: [FILE_A, FILE_B] })
  host.ipc.filesystem_get_file_size = async () => 1024

  let releaseWipe
  host.ipc.dllplugin_call = async ({ params }) => {
    if (params.path === FILE_A) {
      await new Promise((resolve) => {
        releaseWipe = resolve
      })
    }
    return { ok: true, success: true, shreddedCount: 1 }
  }

  const view = await mount(ShredderCommand, host)
  await view.run(null, '选择文件…')
  await tick(10)

  // 全选与取消全选
  await view.run(rowByPath(view, FILE_A), '全选')
  assert.ok(fileRows(view).every((r) => r.props.checked === true))
  await view.run(rowByPath(view, FILE_A), '取消全选')
  assert.ok(fileRows(view).every((r) => r.props.checked === false))

  // 只勾选 FILE_A 并开始粉碎（挂起），验证处理中状态
  await view.run(rowByPath(view, FILE_A), '勾选此文件')
  host.setConfirm(true)
  const shredding = view.run(rowByPath(view, FILE_A), '粉碎已勾选文件 (1 项 / 1.0 KB)')
  await tick(5)

  // 正在粉碎的条目不提供「从列表移除」
  assert.equal(
    view.actions(rowByPath(view, FILE_A)).some((a) => a.props.title === '从列表移除'),
    false
  )

  // 处理中点击「清空列表」必须被拒绝
  await view.run(rowByPath(view, FILE_B), '清空列表')
  assert.equal(host.lastToast().style, 'FAILURE')
  assert.equal(host.lastToast().title, '正在处理，完成后再清空')
  assert.equal(fileRows(view).length, 2)

  // 处理过程中将未处理的 FILE_B 从列表移除，完成后不能加回
  await view.run(rowByPath(view, FILE_B), '从列表移除')
  assert.equal(rowByPath(view, FILE_B), undefined)
  assert.equal(host.ipcCalls.some(([m]) => m === 'filesystem_delete_file'), false)

  releaseWipe()
  await shredding
  assert.equal(fileRows(view).length, 0)

  // 导入进行中清空列表：迟到的目录结果应被丢弃
  let releaseDir
  host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: 'D:\\SlowDir' })
  host.ipc.filesystem_get_directory_contents = async () =>
    await new Promise((resolve) => {
      releaseDir = resolve
    })
  const importing = view.tree().props.filterBar.actions[1].onAction()
  await tick(5)
  assert.match(view.tree().props.filterBar.summaryText, /正在导入/)

  // 通过左侧分类条目触发清空列表
  await view.run(view.item('nav-shred-all'), '清空列表')
  assert.equal(fileRows(view).length, 0)

  const toastCountBeforeResolve = host.toasts.length
  releaseDir({
    success: true,
    files: [{ name: 'late.txt', size: 512, isDirectory: false, lastModified: '2026-01-01T00:00:00Z' }]
  })
  await importing
  await tick(10)
  assert.equal(fileRows(view).length, 0, '导入中清空后，迟到的结果必须被丢弃')
  assert.equal(host.toasts.length, toastCountBeforeResolve)

  // 重新导入后空闲清空列表
  host.ipc.filesystem_get_directory_contents = async () => ({
    success: true,
    files: [{ name: 'fresh.txt', size: 512, isDirectory: false, lastModified: '2026-01-01T00:00:00Z' }]
  })
  await view.tree().props.filterBar.actions[1].onAction()
  await tick(10)
  assert.equal(fileRows(view).length, 1)
  await view.run(rowByPath(view, 'D:\\SlowDir\\fresh.txt'), '清空列表')
  assert.equal(fileRows(view).length, 0)

  view.unmount()
})
