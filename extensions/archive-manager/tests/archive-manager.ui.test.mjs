import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Toast } from '@ztools/declarative-ui'
import { createHost, installDirectoryHost, mount, tick } from '../../shared/test-harness.mjs'
import ArchiveManagerCommand from '../dist/index.js'

const host = createHost()
const ARCHIVE = 'D:\\TestArchives\\downloads\\bid_package.zip'
const ARCHIVE_B = 'D:\\TestArchives\\downloads\\extra_bundle.zip'
const SHA = 'ab'.repeat(32)

function entry(entryName, extra = {}) {
  return {
    entryName,
    name: entryName.split('/').pop(),
    uncompressedSize: 6291456,
    compressedSize: 4194304,
    compressionRatio: 33,
    crc32: '11223344',
    isDirectory: false,
    isEncrypted: false,
    hasPathTraversalRisk: false,
    ...extra
  }
}

/**
 * 模拟真实宿主文件能力与 ArchiveManagerPlugin 原生调用
 */
function installArchiveHost({ listing = {}, listError = null, extract = null, verify = null, sizes = {} } = {}) {
  const calls = { extract: [], verify: 0, trash: [], inspect: [] }
  host.ipc.filesystem_directory_exists = async () => ({ success: true, exists: false })
  host.ipc.filesystem_get_file_size = async ({ path: filePath }) => {
    if (filePath in sizes) return { success: true, size: sizes[filePath] }
    return { success: true, size: 5242880 }
  }
  host.ipc.dllplugin_call = async ({ func, params }) => {
    if (func === 'ListArchiveEntries') {
      calls.inspect.push(params.archivePath)
      if (typeof listError === 'function') {
        const err = listError(params.archivePath)
        if (err) return { ok: false, error: err }
      } else if (listError) {
        return { ok: false, error: listError }
      }
      const extraListing = typeof listing === 'function' ? listing(params.archivePath) : listing
      const fileName = String(params.archivePath || '').split(/[\\/]/).pop() || 'bid_package.zip'
      return {
        ok: true,
        archivePath: params.archivePath,
        archiveName: fileName,
        archiveSizeBytes: 5242880,
        totalEntries: 2,
        fileCount: 2,
        totalUncompressedBytes: 8388608,
        totalCompressedBytes: 5242880,
        compressionRatio: 37,
        encryptedCount: 0,
        isEncrypted: false,
        traversalRiskCount: 1,
        hasSingleRootFolder: false,
        singleRootFolderName: null,
        entries: [
          entry('标书正本.pdf', { category: '办公文档' }),
          entry('../../evil_autorun.exe', { name: 'evil_autorun.exe', category: '可执行程序', uncompressedSize: 2097152, hasPathTraversalRisk: true })
        ],
        ...extraListing
      }
    }
    if (func === 'ExtractArchiveEntries') {
      calls.extract.push(params)
      if (extract) return extract(params)
      return {
        ok: true,
        targetDir: 'D:\\TestArchives\\downloads\\bid_package',
        extractedCount: Array.isArray(params.entryNames) ? params.entryNames.length : 1,
        extractedFiles: ['D:\\TestArchives\\downloads\\bid_package\\标书正本.pdf'],
        blockedEntries: Array.isArray(params.entryNames) ? [] : ['../../evil_autorun.exe']
      }
    }
    if (func === 'VerifyArchive') {
      calls.verify++
      if (verify) return verify(params)
      return { ok: true, sha256: SHA, totalEntries: 2, fileCount: 2, traversalRiskCount: 0, isEncrypted: false, verified: true }
    }
    return { ok: false, error: `未模拟 ${func}` }
  }
  host.ipc.shell_trash_item = async ({ fullPath }) => {
    calls.trash.push(fullPath)
    return { success: true }
  }
  return calls
}

function makeTempTree(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-archive-test-'))
  for (const [rel, content] of Object.entries(spec)) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return root
}

async function importArchiveViaPaste(view, paths = [ARCHIVE]) {
  await view.pasteFiles(paths, { directories: [] })
  await tick(15)
}

const pdfItem = (view) => view.item((it) => it.props.title === '标书正本.pdf')
const dropdownItems = (tree) => {
  const dd = tree.props.searchBarAccessory
  return dd?.children ?? dd?.props?.children ?? []
}

test.beforeEach(() => {
  host.reset()
  delete globalThis.__ztoolsLaunchContext
})

test('启动零扫盘：初始为空状态、顶栏恰为 2 个按钮且无扫盘/读包 IPC 调用', async () => {
  installArchiveHost()
  const view = await mount(ArchiveManagerCommand, host)
  await tick(10)

  const forbiddenMethods = new Set([
    'system_get_path',
    'system_list_common_folders',
    'system_search_files',
    'filesystem_get_directory_contents',
    'dllplugin_call'
  ])
  assert.equal(
    host.ipcCalls.some(([method]) => forbiddenMethods.has(method)),
    false,
    `挂载时不应调用扫描或读包 IPC，实际调用：${JSON.stringify(host.ipcCalls)}`
  )

  const tree = view.tree()
  assert.equal(dropdownItems(tree).length, 0)
  assert.equal(tree.props.subList.items.length, 0)
  assert.match(tree.props.filterBar.props.summaryText, /尚未添加压缩包/)
  assert.match(tree.props.subList.emptyText, /尚未添加 ZIP 压缩包/)

  const barActions = tree.props.filterBar.props.actions
  assert.deepEqual(
    barActions.map((a) => ({ id: a.id, label: a.label })),
    [
      { id: 'pick-files', label: '选择文件' },
      { id: 'pick-folder', label: '选择文件夹' }
    ]
  )

  const rootActions = view.actions()
  assert.equal(rootActions[0].props.title, '选择文件…')
  assert.deepEqual(rootActions[0].props.shortcut, { modifiers: ['ctrl'], key: 'o' })
  assert.equal(rootActions[1].props.title, '选择文件夹…')
  assert.deepEqual(rootActions[1].props.shortcut, { modifiers: ['ctrl', 'shift'], key: 'o' })
  view.unmount()
})

test('选择文件：取消不改变列表、宿主报错如实提示、多选导入自动选中第 1 个且再次导入不切换当前包', async () => {
  const calls = installArchiveHost()
  const view = await mount(ArchiveManagerCommand, host)
  await tick(10)

  const pickFilesBtn = () => view.tree().props.filterBar.props.actions.find((a) => a.id === 'pick-files')

  // 1. 取消选择
  host.ipc.window_show_open_dialog = async () => ({ canceled: true })
  await pickFilesBtn().onAction()
  await tick(10)
  assert.equal(dropdownItems(view.tree()).length, 0)
  assert.equal(host.toasts.length, 0)

  // 2. 宿主报 capability 超限错误时翻译为友好提示
  host.ipc.window_show_open_dialog = async () => {
    throw new Error('当前窗口的文件 capability 数量超过上限')
  }
  await pickFilesBtn().onAction()
  await tick(10)
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.match(host.lastToast().message, /改用「选择文件夹」/)

  // 3. 选择多个 ZIP + 1 个不支持文件：过滤不支持格式，只导入第 1 个前无选中包时自动选中并预览第 1 个
  host.ipc.window_show_open_dialog = async (params) => {
    assert.equal(params.filters, 'ZIP 压缩包|zip')
    assert.deepEqual(params.properties, ['openFile', 'multiSelections'])
    return {
      canceled: false,
      filePaths: [{ path: ARCHIVE }, { path: ARCHIVE_B }, { path: 'D:\\TestArchives\\downloads\\notes.txt' }]
    }
  }
  await pickFilesBtn().onAction()
  await tick(15)
  assert.equal(view.tree().props.searchBarAccessory.props.value, ARCHIVE)
  assert.deepEqual(
    dropdownItems(view.tree()).map((i) => i.props.value),
    [ARCHIVE, ARCHIVE_B]
  )
  assert.equal(calls.inspect.length, 1)
  assert.equal(calls.inspect[0], ARCHIVE)
  assert.equal(host.lastToast().title, '已添加 2 个文件')

  // 4. 已有选中压缩包时再导入新包，只追加候选、不切走当前包
  const ARCHIVE_C = 'D:\\TestArchives\\downloads\\third.zip'
  host.ipc.window_show_open_dialog = async () => ({ canceled: false, filePaths: [ARCHIVE_C] })
  await pickFilesBtn().onAction()
  await tick(15)
  assert.equal(view.tree().props.searchBarAccessory.props.value, ARCHIVE)
  assert.deepEqual(
    dropdownItems(view.tree()).map((i) => i.props.value),
    [ARCHIVE, ARCHIVE_B, ARCHIVE_C]
  )
  assert.equal(calls.inspect.length, 1, '已有当前压缩包时新增导入不应切换当前包')

  view.unmount()
})

test('选择文件夹：递归收集 .zip、过滤非 ZIP 与空文件、整盘确认与数量截断提示', async () => {
  const root = makeTempTree({
    'a.zip': 'zip-a',
    'sub/deep/b.ZIP': 'zip-b',
    'sub/readme.txt': 'text',
    'empty.zip': '',
    'archive.rar': 'rar'
  })
  try {
    installArchiveHost()
    await installDirectoryHost(host, { authorized: [root] })
    const view = await mount(ArchiveManagerCommand, host)
    await tick(10)

    const pickFolderBtn = () => view.tree().props.filterBar.props.actions.find((a) => a.id === 'pick-folder')

    // 1. 选整盘根目录时先弹确认框，取消则不读目录
    host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: 'D:\\' })
    host.setConfirm(false)
    await pickFolderBtn().onAction()
    await tick(10)
    assert.match(host.confirms.at(-1).title, /整个磁盘/)
    assert.equal(host.ipcCalls.some(([m]) => m === 'filesystem_get_directory_contents'), false)

    // 2. 选择普通目录：递归收集 .zip 并自动打开第 1 个
    host.setConfirm(true)
    host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: root })
    await pickFolderBtn().onAction()
    await tick(20)

    const values = dropdownItems(view.tree()).map((i) => i.props.value)
    assert.deepEqual(values, [path.join(root, 'a.zip'), path.join(root, 'sub', 'deep', 'b.ZIP')])
    assert.equal(view.tree().props.searchBarAccessory.props.value, path.join(root, 'a.zip'))
    assert.equal(host.lastToast().title, '已添加 2 个文件')
    assert.match(host.lastToast().message, /忽略 3 个不支持的文件/)
    view.unmount()
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }

  // 3. 超过 500 个 .zip 时触发截断提示
  const bigSpec = {}
  for (let i = 0; i < 502; i++) {
    bigSpec[`item_${String(i).padStart(3, '0')}.zip`] = 'x'
  }
  const bigRoot = makeTempTree(bigSpec)
  try {
    host.reset()
    installArchiveHost()
    await installDirectoryHost(host, { authorized: [bigRoot] })
    host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: bigRoot })
    const view = await mount(ArchiveManagerCommand, host)
    await tick(10)
    await view.tree().props.filterBar.props.actions.find((a) => a.id === 'pick-folder').onAction()
    await tick(30)
    assert.equal(dropdownItems(view.tree()).length, 500)
    assert.equal(host.lastToast().title, '已添加 500 个文件')
    assert.match(host.lastToast().message, /文件较多，只导入了一部分/)
    view.unmount()
  } finally {
    fs.rmSync(bigRoot, { recursive: true, force: true })
  }
})

test('拖入文件夹与旧版客户端兼容：支持带 directories、不带 directories 以及 plugin_files_dropped 展开文件夹', async () => {
  const root = makeTempTree({
    'v1.0_release/app.zip': 'zip1',
    'nested/pack.zip': 'zip2',
    'nested/ignore.7z': '7z'
  })
  try {
    installArchiveHost()
    await installDirectoryHost(host, { authorized: [root] })
    host.ipc.filesystem_directory_exists = async ({ path: target }) => ({
      success: true,
      exists: fs.existsSync(target) && fs.statSync(target).isDirectory()
    })

    // 1. 新版宿主带 directories 拖入文件夹（无需调 directory_exists）
    const view = await mount(ArchiveManagerCommand, host)
    await tick(10)
    await view.dropFiles([root], { directories: [root] })
    await tick(20)
    assert.equal(host.ipcCalls.some(([m]) => m === 'filesystem_directory_exists'), false)
    assert.deepEqual(
      dropdownItems(view.tree()).map((i) => i.props.value),
      [path.join(root, 'nested', 'pack.zip'), path.join(root, 'v1.0_release', 'app.zip')]
    )

    // 2. 重复拖入大小写不同的相同文件（按路径去重，不重复添加）
    // Windows 路径不区分大小写，换成大写仍算同一个文件；macOS / Linux 区分大小写，用原路径验证去重
    const dupZip = path.join(root, 'nested', 'pack.zip')
    await view.dropFiles([process.platform === 'win32' ? dupZip.toUpperCase() : dupZip], { directories: [] })
    await tick(15)
    assert.equal(host.lastToast().title, '这些文件已在列表中')
    assert.equal(dropdownItems(view.tree()).length, 2)
    view.unmount()

    // 3. 旧版客户端不带 directories，通过 plugin_files_dropped 拖入文件夹也能展开
    host.reset()
    installArchiveHost()
    await installDirectoryHost(host, { authorized: [root] })
    host.ipc.filesystem_directory_exists = async ({ path: target }) => ({
      success: true,
      exists: fs.existsSync(target) && fs.statSync(target).isDirectory()
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
    const legacyView = await mount(ArchiveManagerCommand, host)
    await tick(10)
    assert.equal(typeof droppedListener, 'function')
    droppedListener({ payload: { files: [root] } })
    await tick(25)
    assert.equal(host.ipcCalls.some(([m]) => m === 'filesystem_directory_exists'), true)
    assert.equal(dropdownItems(legacyView.tree()).length, 2)
    legacyView.unmount()
    globalThis.window.__ztoolsDeclarativeFeatures = { fileInput: true }
    assert.equal(droppedListener, null)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('从列表移除与清空列表：不删磁盘文件，移除自动切到下一个；清空重置空态；解压中清空被拒绝', async () => {
  const calls = installArchiveHost()
  const view = await mount(ArchiveManagerCommand, host)
  await tick(10)

  await importArchiveViaPaste(view, [ARCHIVE, ARCHIVE_B])
  assert.equal(view.tree().props.searchBarAccessory.props.value, ARCHIVE)
  assert.equal(dropdownItems(view.tree()).length, 2)
  assert.match(view.tree().props.filterBar.props.summaryText, /清空列表 Ctrl\+Shift\+Backspace/)

  // 1. 从列表移除第 1 个压缩包：不删除磁盘文件，自动切到第 2 个
  await view.run(pdfItem(view), '从列表移除')
  await tick(15)
  assert.equal(calls.trash.length, 0, '从列表移除不得删除磁盘文件')
  assert.equal(view.tree().props.searchBarAccessory.props.value, ARCHIVE_B)
  assert.deepEqual(dropdownItems(view.tree()).map((i) => i.props.value), [ARCHIVE_B])

  // 2. 解压进行中时清空列表被拒绝，不清空也不丢进度
  let releaseExtract
  const gate = new Promise((resolve) => (releaseExtract = resolve))
  installArchiveHost({
    extract: async () => {
      await gate
      return { ok: true, targetDir: 'D:\\out', extractedCount: 1, extractedFiles: ['D:\\out\\a.pdf'], blockedEntries: [] }
    }
  })
  host.setConfirm(true)
  const extractAction = view.actions(pdfItem(view)).find((a) => a.props.title === '解压全部')
  const extractPromise = extractAction.props.onAction()
  await tick(10)
  const clearAction = view.actions(pdfItem(view)).find((a) => a.props.title === '清空列表')
  assert.equal(clearAction.props.style, 'destructive')
  await clearAction.props.onAction()
  await tick(5)
  assert.equal(host.lastToast().title, '正在处理，完成后再清空')
  assert.equal(dropdownItems(view.tree()).length, 1)
  releaseExtract()
  await extractPromise
  await tick(10)

  // 3. 非处理中点清空列表：彻底回到空态
  await view.run(pdfItem(view), '清空列表')
  await tick(10)
  assert.equal(dropdownItems(view.tree()).length, 0)
  assert.equal(view.tree().props.subList.items.length, 0)
  assert.match(view.tree().props.filterBar.props.summaryText, /尚未添加压缩包/)
  assert.equal(calls.trash.length, 0)

  // 4. 仅剩 1 个时「从列表移除」回到空态
  await importArchiveViaPaste(view, [ARCHIVE])
  assert.equal(dropdownItems(view.tree()).length, 1)
  await view.run(pdfItem(view), '从列表移除')
  await tick(10)
  assert.equal(dropdownItems(view.tree()).length, 0)
  assert.equal(view.tree().props.subList.items.length, 0)

  view.unmount()
})

test('[竞态] 导入文件夹进行中清空列表，异步返回结果被丢弃且不弹导入提示', async () => {
  installArchiveHost()
  let releaseSlow
  const slowGate = new Promise((resolve) => (releaseSlow = resolve))
  const view2 = await mount(ArchiveManagerCommand, host)
  await importArchiveViaPaste(view2, [ARCHIVE])
  const toastCountBefore = host.toasts.length

  host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: 'D:\\SlowFolder' })
  host.ipc.filesystem_get_directory_contents = async () => {
    await slowGate
    return { success: true, files: [{ name: 'ghost.zip', size: 2048, isDirectory: false }] }
  }
  const slowImport = view2.tree().props.filterBar.props.actions.find((a) => a.id === 'pick-folder').onAction()
  await tick(10)
  assert.match(view2.tree().props.filterBar.props.summaryText, /正在导入：/)

  await view2.run(pdfItem(view2), '清空列表')
  await tick(5)
  assert.equal(dropdownItems(view2.tree()).length, 0)

  releaseSlow()
  await slowImport
  await tick(15)
  assert.equal(dropdownItems(view2.tree()).length, 0, '清空后过期导入的结果必须丢弃')
  assert.equal(host.toasts.length, toastCountBefore, '过期导入不应弹出提示')
  view2.unmount()
})

test('布局二：左侧分类 + 右侧包内文件，越界条目标红且不可勾选；没有示例数据', async () => {
  installArchiveHost()
  const view = await mount(ArchiveManagerCommand, host)
  await importArchiveViaPaste(view, [ARCHIVE])

  const tree = view.tree()
  assert.equal(tree.type, 'List')
  assert.equal(tree.props.isShowingDetail, false)
  assert.ok(tree.props.subList)
  assert.equal(/[\u{1F300}-\u{1FAFF}]/u.test(view.text()), false)
  assert.equal(view.text().includes('华东区'), false, '不再出现内置的示例压缩包')

  const evil = view.item((it) => it.props.title === 'evil_autorun.exe')
  assert.equal(evil.props.checkable, false)
  assert.ok(view.text().includes('越界路径，不提取'))
  assert.match(view.item('diag-security').props.subtitle, /1 个条目含 \.\.\/ 或绝对路径，不会被提取/)
  view.unmount()
})

test('勾选后提取：先确认目标文件夹并提示会覆盖同名文件，确认后才调用；取消则不解压', async () => {
  const calls = installArchiveHost()
  const view = await mount(ArchiveManagerCommand, host)
  await importArchiveViaPaste(view, [ARCHIVE])

  assert.equal(view.actions(pdfItem(view))[0].props.title, '解压全部')
  pdfItem(view).props.onCheckChange(true)
  await tick(5)
  assert.equal(view.actions(pdfItem(view))[0].props.title, '提取已勾选的 1 个文件')

  host.setConfirm(false)
  await view.run(pdfItem(view), '提取已勾选的 1 个文件')
  assert.equal(calls.extract.length, 0, '取消确认不解压')
  const confirm = host.confirms.at(-1)
  assert.equal(confirm.title, '提取 1 个文件？')
  assert.match(confirm.message, /解压到：D:\\TestArchives\\downloads\\bid_package/)
  assert.match(confirm.message, /同名文件会被覆盖/)

  host.setConfirm(true)
  await view.run(pdfItem(view), '提取已勾选的 1 个文件')
  assert.equal(calls.extract.length, 1)
  assert.deepEqual(calls.extract[0].entryNames, ['标书正本.pdf'])
  assert.equal(calls.extract[0].smartUnwrap, false)
  assert.equal(host.lastToast().title, '已解压 1 个文件')
  view.unmount()
})

test('整包解压：单个顶层文件夹时确认框写明实际落点；越界条目未提取时如实写出', async () => {
  const calls = installArchiveHost({ listing: { hasSingleRootFolder: true, singleRootFolderName: '标书', traversalRiskCount: 0 } })
  const view = await mount(ArchiveManagerCommand, host)
  await importArchiveViaPaste(view, [ARCHIVE])
  await view.run(pdfItem(view), '解压全部')
  assert.match(host.confirms.at(-1).message, /解压到：D:\\TestArchives\\downloads\\标书\n/)
  assert.equal(calls.extract[0].smartUnwrap, true)
  assert.equal(calls.extract[0].entryNames, undefined)
  assert.equal(host.lastToast().title, '已解压 1 个文件 · 1 个越界条目未提取')
  view.unmount()
})

test('[故障注入] 客户端报告解压 0 个文件或失败时提示失败，不用勾选数量冒充结果', async () => {
  installArchiveHost({ extract: () => ({ ok: true, targetDir: 'D:\\x', extractedCount: 0, extractedFiles: [], blockedEntries: [] }) })
  const view = await mount(ArchiveManagerCommand, host)
  await importArchiveViaPaste(view, [ARCHIVE])
  await view.run(pdfItem(view), '只提取这个文件（标书正本.pdf）')
  assert.equal(host.lastToast().title, '没有解压出任何文件')
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  view.unmount()

  host.reset()
  installArchiveHost({ extract: () => ({ ok: false, error: 'EPERM: operation not permitted' }) })
  const view2 = await mount(ArchiveManagerCommand, host)
  await importArchiveViaPaste(view2, [ARCHIVE])
  await view2.run(pdfItem(view2), '解压全部')
  assert.equal(host.lastToast().title, '解压失败')
  assert.match(host.lastToast().message, /解压提取失败/)
  view2.unmount()
})

test('[边界] 含加密条目的压缩包：直接提示不支持解压，不弹确认、不调用解压', async () => {
  const calls = installArchiveHost({ listing: { isEncrypted: true, encryptedCount: 1, traversalRiskCount: 0, entries: [entry('a.pdf', { isEncrypted: true })] } })
  const view = await mount(ArchiveManagerCommand, host)
  await importArchiveViaPaste(view, [ARCHIVE])
  assert.match(view.item('diag-security').props.subtitle, /含加密条目，暂不支持解压/)
  await view.run(view.item((it) => it.props.title === 'a.pdf'), '解压全部')
  assert.equal(host.confirms.length, 0)
  assert.equal(calls.extract.length, 0)
  assert.equal(host.lastToast().title, '暂不支持解压加密的压缩包')
  view.unmount()
})

test('校验保留在 ActionPanel 中：如实说明只读目录、查越界与算 SHA-256；故障时分别如实提示', async () => {
  installArchiveHost()
  const view = await mount(ArchiveManagerCommand, host)
  await importArchiveViaPaste(view, [ARCHIVE])

  await view.run(pdfItem(view), '校验压缩包（目录、越界路径与 SHA-256）')
  const t = host.lastToast()
  assert.equal(t.style, Toast.Style.Success)
  assert.equal(t.title, '已读取压缩包目录，没有越界路径')
  assert.match(t.message, /SHA-256：abababababababab…/)
  assert.match(t.message, /未逐个校验文件 CRC32/)
  assert.equal(host.toasts.some((x) => /CRC32 与安全校验通过/.test(x.title)), false)
  view.unmount()

  const cases = [
    [() => ({ ok: true, sha256: SHA, fileCount: 2, traversalRiskCount: 3 }), '发现 3 个越界条目'],
    [() => ({ ok: true, fileCount: 2, traversalRiskCount: 0 }), '校验结果无法识别'],
    [() => ({ ok: false, error: '压缩包损坏或格式不受支持: invalid central directory' }), '校验失败']
  ]
  for (const [verify, title] of cases) {
    host.reset()
    installArchiveHost({ verify })
    const v = await mount(ArchiveManagerCommand, host)
    await importArchiveViaPaste(v, [ARCHIVE])
    await v.run(pdfItem(v), '校验压缩包（目录、越界路径与 SHA-256）')
    assert.equal(host.lastToast().title, title)
    assert.equal(host.lastToast().style, Toast.Style.Failure)
    v.unmount()
  }
})

test('[故障注入] 读取压缩包失败：清空包内列表，状态条与空状态写明原因，可通过动作移除/清空', async () => {
  const calls = installArchiveHost({ listError: '压缩包损坏或格式不受支持: end of central directory record signature not found' })
  const view = await mount(ArchiveManagerCommand, host)
  await importArchiveViaPaste(view, [ARCHIVE])

  const tree = view.tree()
  assert.equal(tree.props.subList.items.length, 0)
  assert.match(tree.props.subList.emptyText, /读取压缩包失败：.*central directory/)
  assert.match(tree.props.filterBar.props.summaryText, /读取失败/)
  assert.equal(host.toasts.some((t) => t.title === '读取压缩包失败'), true)

  await view.run(view.item('nav-cat-ALL'), '解压全部')
  assert.equal(calls.extract.length, 0)
  assert.equal(host.lastToast().title, '没有可解压的压缩包')

  // 损坏包也可直接从列表移除回到空态
  await view.run(undefined, '从列表移除')
  await tick(10)
  assert.equal(dropdownItems(view.tree()).length, 0)
  view.unmount()
})

test('移入回收站：必须确认，取消不执行；确认后从列表移除；失败如实提示', async () => {
  const calls = installArchiveHost()
  const view = await mount(ArchiveManagerCommand, host)
  await importArchiveViaPaste(view, [ARCHIVE, ARCHIVE_B])

  host.setConfirm(false)
  await view.run(pdfItem(view), '将原压缩包移入回收站')
  assert.equal(calls.trash.length, 0)
  assert.equal(host.confirms.at(-1).primaryAction.style, 'destructive')

  host.setConfirm(true)
  await view.run(pdfItem(view), '将原压缩包移入回收站')
  await tick(10)
  assert.deepEqual(calls.trash, [ARCHIVE])
  assert.equal(view.tree().props.searchBarAccessory.props.value, ARCHIVE_B)

  host.ipc.shell_trash_item = async () => {
    throw Object.assign(new Error('文件正被另一个程序使用'), { code: 'EBUSY' })
  }
  await view.run(pdfItem(view), '将原压缩包移入回收站')
  assert.equal(host.lastToast().title, '移入回收站失败')
  assert.match(host.lastToast().message, /正被另一个程序使用/)
  view.unmount()
})

test('[故障注入] 在资源管理器中定位失败时提示，不静默', async () => {
  installArchiveHost()
  const view = await mount(ArchiveManagerCommand, host)
  await importArchiveViaPaste(view, [ARCHIVE])
  await view.run(pdfItem(view), '在资源管理器中定位压缩包')
  assert.equal(host.lastToast().title, '无法在资源管理器中定位')
  view.unmount()
})

test('“提取压缩包内办公文档”命令默认筛选办公文档', async () => {
  installArchiveHost()
  globalThis.__ztoolsLaunchContext = { pluginId: 'archive-manager', featureCode: 'archive-docs' }
  const view = await mount(ArchiveManagerCommand, host)
  await importArchiveViaPaste(view, [ARCHIVE])
  const titles = view.tree().props.subList.items.map((i) => i.props.title)
  assert.deepEqual(titles, ['标书正本.pdf'])
  view.unmount()
})

test('不在客户端里运行：只显示“需要在 ZTools 客户端中使用”，不扫描、不显示示例', async () => {
  const saved = globalThis.__ztoolsElectron
  delete globalThis.__ztoolsElectron
  try {
    const view = await mount(ArchiveManagerCommand, host)
    await tick(5)
    const items = view.items()
    assert.equal(items.length, 1)
    assert.equal(items[0].props.title, '需要在 ZTools 客户端中使用')
    view.unmount()
  } finally {
    globalThis.__ztoolsElectron = saved
  }
})
