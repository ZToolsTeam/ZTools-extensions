import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHost, installDirectoryHost, mount, tick } from '../../shared/test-harness.mjs'
import SqlitePluginCommand from '../dist/index.js'

const DB_PATH = 'D:\\TestDatabases\\SomeApp\\data.db'
const DB_PATH_2 = 'D:\\TestDatabases\\OtherApp\\archive.db3'

function installHost(host, { queryError, inspectByPath } = {}) {
  const dllCalls = []
  host.ipc.filesystem_directory_exists = async () => ({ success: true, exists: false })
  host.ipc.filesystem_get_file_size = async ({ path: p }) => {
    if (String(p).includes('unknown_size')) throw new Error('路径未由当前窗口授权')
    return { success: true, size: 40960 }
  }
  host.ipc.dllplugin_call = async ({ plugin, func, params }) => {
    assert.equal(plugin, 'SqlitePlugin')
    dllCalls.push({ func, params })
    if (func === 'inspectWorkspace') {
      if (inspectByPath && inspectByPath[params.dbPath]) {
        return inspectByPath[params.dbPath]
      }
      const isSecond = String(params.dbPath).toLowerCase().includes('archive.db3')
      return {
        ok: true,
        success: true,
        sizeBytes: 40960,
        tables: isSecond
          ? [{ name: 'events', type: 'table', rowCount: 1, columns: [{ name: 'id', type: 'INTEGER', pk: true }] }]
          : [
              { name: 'accounts', type: 'table', rowCount: 2, columns: [{ name: 'id', type: 'INTEGER', pk: true }, { name: 'name', type: 'TEXT', pk: false }] },
              { name: 'logs', type: 'table', rowCount: 1, columns: [{ name: 'msg', type: 'TEXT', pk: false }] }
            ],
        rows: isSecond ? [{ id: 99 }] : [{ id: 1, name: 'alice' }, { id: 2, name: 'bob' }]
      }
    }
    if (func === 'executeQuery') {
      if (queryError) return { ok: false, success: false, error: queryError }
      return { ok: true, success: true, rows: [{ msg: 'hello' }] }
    }
    throw new Error(`unexpected ${func}`)
  }
  return dllCalls
}

function makeTempTree(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-sqlite-test-'))
  for (const [rel, content] of Object.entries(spec)) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return root
}

function rowItems(view) {
  return view.items().filter((it) => String(it.props.id).startsWith('sql-row-'))
}

function dropdownItems(tree) {
  const dd = tree.props.searchBarAccessory
  return dd?.children ?? dd?.props?.children ?? []
}

async function importViaPaste(view, paths = [DB_PATH]) {
  await view.pasteFiles(paths, { directories: [] })
  await tick(15)
}

test('启动零扫盘：挂载不调用任何扫盘或读取 IPC，顶栏恰为 2 个按钮且空状态动作顺序正确', async () => {
  const host = createHost()
  installHost(host)
  const view = await mount(SqlitePluginCommand, host)
  await tick(10)

  const forbidden = new Set([
    'system_get_path',
    'system_list_common_folders',
    'system_search_files',
    'filesystem_get_directory_contents',
    'dllplugin_call'
  ])
  assert.equal(host.ipcCalls.some(([m]) => forbidden.has(m)), false, `挂载不应扫盘：${JSON.stringify(host.ipcCalls)}`)

  const tree = view.tree()
  assert.equal(tree.props.isLoading, false)
  assert.equal(dropdownItems(tree).length, 0)
  assert.equal(rowItems(view).length, 0)
  assert.match(tree.props.filterBar.props.summaryText, /尚未添加数据库/)
  assert.match(tree.props.subList.emptyText, /尚未添加 SQLite 数据库/)

  assert.deepEqual(
    tree.props.filterBar.props.actions.map((a) => ({ id: a.id, label: a.label })),
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

test('选择文件多选导入：取消/报错不改列表，多选含 .db3 自动打开第 1 个，再导入只追加不切库', async () => {
  const host = createHost()
  const dllCalls = installHost(host)
  const view = await mount(SqlitePluginCommand, host)
  try {
    const pickFilesBtn = () => view.tree().props.filterBar.props.actions.find((a) => a.id === 'pick-files')

    host.ipc.window_show_open_dialog = async () => ({ canceled: true })
    await pickFilesBtn().onAction()
    await tick()
    assert.equal(dllCalls.length, 0)
    assert.equal(host.toasts.length, 0)

    host.ipc.window_show_open_dialog = async () => {
      throw new Error('对话框不可用')
    }
    await pickFilesBtn().onAction()
    await tick()
    assert.equal(host.lastToast().style, 'FAILURE')
    assert.equal(dllCalls.length, 0)

    // 多选导入含 .db 与 .db3：过滤串包含 db3，properties 含 multiSelections
    host.ipc.window_show_open_dialog = async (params) => {
      assert.equal(params.filters, 'SQLite 数据库|db;sqlite;sqlite3;db3')
      assert.deepEqual(params.properties, ['openFile', 'multiSelections'])
      return { canceled: false, filePaths: [DB_PATH, DB_PATH_2] }
    }
    await pickFilesBtn().onAction()
    await tick(15)
    assert.equal(view.tree().props.searchBarAccessory.props.value, DB_PATH)
    assert.deepEqual(dropdownItems(view.tree()).map((i) => i.props.value), [DB_PATH, DB_PATH_2])
    assert.equal(dllCalls.length, 1)
    assert.equal(dllCalls[0].params.dbPath, DB_PATH)
    assert.match(view.tree().props.filterBar.props.summaryText, /data\.db/)

    // 已有打开数据库时再导入第 3 个，只追加候选、不切走当前库
    const DB_PATH_3 = 'D:\\TestDatabases\\third.sqlite'
    host.ipc.window_show_open_dialog = async () => ({ canceled: false, filePaths: [DB_PATH_3] })
    await pickFilesBtn().onAction()
    await tick(15)
    assert.equal(view.tree().props.searchBarAccessory.props.value, DB_PATH)
    assert.deepEqual(dropdownItems(view.tree()).map((i) => i.props.value), [DB_PATH, DB_PATH_2, DB_PATH_3])
    assert.equal(dllCalls.length, 1, '已打开数据库时新增导入不应重新读取别的库')
  } finally {
    view.unmount()
  }
})

test('选择文件夹：递归收集四种 SQLite 扩展名、过滤与截断、整盘确认与旧客户端报错', async () => {
  const root = makeTempTree({
    'app.db': 'sqlite',
    'nested/store.sqlite': 'sqlite',
    'nested/deep/v3.sqlite3': 'sqlite',
    'nested/deep/legacy.db3': 'sqlite',
    'nested/empty.db': '',
    'nested/note.txt': 'text'
  })
  try {
    const host = createHost()
    installHost(host)
    await installDirectoryHost(host, { authorized: [root] })
    const view = await mount(SqlitePluginCommand, host)
    await tick(10)

    const pickFolderBtn = () => view.tree().props.filterBar.props.actions.find((a) => a.id === 'pick-folder')

    // 1. 选盘符根目录先确认，取消则不读目录
    host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: 'C:\\' })
    host.setConfirm(false)
    await pickFolderBtn().onAction()
    await tick()
    assert.match(host.confirms.at(-1).title, /整个磁盘/)
    assert.equal(host.ipcCalls.some(([m]) => m === 'filesystem_get_directory_contents'), false)

    // 2. 选择文件夹并递归导入
    host.setConfirm(true)
    host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: root })
    await pickFolderBtn().onAction()
    await tick(20)

    const vals = dropdownItems(view.tree()).map((i) => i.props.value)
    assert.equal(vals.length, 4)
    assert.ok(vals.some((p) => p.endsWith('.db')))
    assert.ok(vals.some((p) => p.endsWith('.sqlite')))
    assert.ok(vals.some((p) => p.endsWith('.sqlite3')))
    assert.ok(vals.some((p) => p.endsWith('.db3')))
    assert.equal(host.lastToast().title, '已添加 4 个文件')
    assert.match(host.lastToast().message, /忽略 2 个不支持的文件/)
    view.unmount()
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }

  // 3. 超过 500 个时截断并提示；旧客户端缺接口提示升级
  const bigSpec = {}
  for (let i = 0; i < 502; i++) {
    bigSpec[`db_${String(i).padStart(3, '0')}.db`] = 'x'
  }
  const bigRoot = makeTempTree(bigSpec)
  try {
    const host = createHost()
    installHost(host)
    await installDirectoryHost(host, { authorized: [bigRoot] })
    const view = await mount(SqlitePluginCommand, host)
    await tick(10)
    const pickFolderBtn = () => view.tree().props.filterBar.props.actions.find((a) => a.id === 'pick-folder')

    host.ipc.window_show_select_folder_dialog = async () => {
      throw new Error('未知方法: window_show_select_folder_dialog')
    }
    await pickFolderBtn().onAction()
    await tick()
    assert.match(host.lastToast().message, /ZTools 版本过低/)

    host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: bigRoot })
    await pickFolderBtn().onAction()
    await tick(30)
    assert.equal(dropdownItems(view.tree()).length, 500)
    assert.match(host.lastToast().message, /文件较多，只导入了一部分/)
    view.unmount()
  } finally {
    fs.rmSync(bigRoot, { recursive: true, force: true })
  }
})

test('拖入文件夹与旧版事件兼容：支持带 directories、不带 directories 与去重；大小未知不填 0 B', async () => {
  const root = makeTempTree({
    'sub/main.sqlite3': 'x',
    'sub/backup.db': 'x'
  })
  try {
    const host = createHost()
    installHost(host)
    await installDirectoryHost(host, { authorized: [root] })
    host.ipc.filesystem_directory_exists = async ({ path: target }) => ({
      success: true,
      exists: fs.existsSync(target) && fs.statSync(target).isDirectory()
    })

    // 1. 新版宿主带 directories 拖入文件夹
    const view = await mount(SqlitePluginCommand, host)
    await view.dropFiles([root], { directories: [root] })
    await tick(20)
    assert.equal(host.ipcCalls.some(([m]) => m === 'filesystem_directory_exists'), false)
    assert.equal(dropdownItems(view.tree()).length, 2)

    // 2. 重复拖入同一文件（大小写不同）去重
    // Windows 路径不区分大小写，换成大写仍算同一个文件；macOS / Linux 区分大小写，用原路径验证去重
    const dupDb = path.join(root, 'sub', 'main.sqlite3')
    await view.dropFiles([process.platform === 'win32' ? dupDb.toUpperCase() : dupDb], { directories: [] })
    await tick(15)
    assert.equal(host.lastToast().title, '这些文件已在列表中')
    assert.equal(dropdownItems(view.tree()).length, 2)

    // 3. 大小未知文件导入后下拉框显示“大小未识别”
    await view.pasteFiles(['D:\\TestDatabases\\unknown_size.db3'], { directories: [] })
    await tick(15)
    const unknownItem = dropdownItems(view.tree()).find((i) => i.props.value.includes('unknown_size.db3'))
    assert.ok(unknownItem)
    assert.match(unknownItem.props.title, /大小未识别/)
    view.unmount()

    // 4. 旧版客户端 plugin_files_dropped 传入文件夹路径（不带 directories）也能展开
    const host2 = createHost()
    installHost(host2)
    await installDirectoryHost(host2, { authorized: [root] })
    host2.ipc.filesystem_directory_exists = async ({ path: target }) => ({
      success: true,
      exists: fs.existsSync(target) && fs.statSync(target).isDirectory()
    })
    const dropListeners = []
    const prevFeatures = globalThis.window.__ztoolsDeclarativeFeatures
    globalThis.window.__ztoolsDeclarativeFeatures = { fileInput: false }
    globalThis.window.ztools = {
      ...(globalThis.window.ztools || {}),
      events: {
        on(event, cb) {
          if (event === 'plugin_files_dropped') dropListeners.push(cb)
          return () => {}
        }
      }
    }
    const legacyView = await mount(SqlitePluginCommand, host2)
    try {
      assert.equal(dropListeners.length, 1)
      dropListeners[0]({ payload: { files: [root] } })
      await tick(25)
      assert.equal(host2.ipcCalls.some(([m]) => m === 'filesystem_directory_exists'), true)
      assert.equal(dropdownItems(legacyView.tree()).length, 2)
    } finally {
      legacyView.unmount()
      globalThis.window.__ztoolsDeclarativeFeatures = prevFeatures
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('下拉切换数据库只读所选库不扫盘，从列表移除自动切到下一个，清空列表回到空状态', async () => {
  const host = createHost()
  const dllCalls = installHost(host)
  const view = await mount(SqlitePluginCommand, host)
  await importViaPaste(view, [DB_PATH, DB_PATH_2])

  assert.equal(view.tree().props.searchBarAccessory.props.value, DB_PATH)
  assert.equal(dllCalls.length, 1)

  // 1. 下拉切换数据库：只调用 inspectWorkspace，零扫盘
  const callsBeforeSwitch = host.ipcCalls.length
  await view.dropdown(DB_PATH_2)
  await tick(15)
  assert.equal(view.tree().props.searchBarAccessory.props.value, DB_PATH_2)
  assert.equal(dllCalls.length, 2)
  assert.equal(dllCalls[1].params.dbPath, DB_PATH_2)
  assert.deepEqual(
    host.ipcCalls.slice(callsBeforeSwitch).map(([m]) => m),
    ['dllplugin_call']
  )
  assert.ok(view.items().some((it) => it.props.id === 'nav-sql-events'))

  // 2. 从列表移除当前库（DB_PATH_2）：切回 DB_PATH，不调用删除磁盘接口
  await view.run(rowItems(view)[0], '从列表移除')
  await tick(15)
  assert.equal(view.tree().props.searchBarAccessory.props.value, DB_PATH)
  assert.deepEqual(dropdownItems(view.tree()).map((i) => i.props.value), [DB_PATH])
  assert.equal(host.ipcCalls.some(([m]) => m === 'shell_trash_item'), false)

  // 3. 清空列表：候选列表、表、行全清空回到空状态
  const clearAction = view.actions(rowItems(view)[0]).find((a) => a.props.title === '清空列表')
  assert.equal(clearAction.props.style, 'destructive')
  await clearAction.props.onAction()
  await tick(10)
  assert.equal(dropdownItems(view.tree()).length, 0)
  assert.equal(rowItems(view).length, 0)
  assert.match(view.tree().props.filterBar.props.summaryText, /尚未添加数据库/)

  // 4. 仅剩 1 个库时「从列表移除」回到空状态
  await importViaPaste(view, [DB_PATH])
  await view.run(rowItems(view)[0], '从列表移除')
  await tick(10)
  assert.equal(dropdownItems(view.tree()).length, 0)
  assert.equal(rowItems(view).length, 0)
  view.unmount()
})

test('[竞态] 导入进行中清空列表，异步返回结果被丢弃且不弹导入提示', async () => {
  const host = createHost()
  installHost(host)
  const view = await mount(SqlitePluginCommand, host)
  await importViaPaste(view, [DB_PATH])
  const toastCountBefore = host.toasts.length

  let releaseSlow
  const slowGate = new Promise((resolve) => (releaseSlow = resolve))
  host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: 'D:\\SlowDbDir' })
  host.ipc.filesystem_get_directory_contents = async () => {
    await slowGate
    return { success: true, files: [{ name: 'late.sqlite', size: 4096, isDirectory: false }] }
  }
  const importPromise = view.tree().props.filterBar.props.actions.find((a) => a.id === 'pick-folder').onAction()
  await tick(10)
  assert.match(view.tree().props.filterBar.props.summaryText, /正在导入：/)

  await view.run(rowItems(view)[0], '清空列表')
  await tick(5)
  assert.equal(dropdownItems(view.tree()).length, 0)

  releaseSlow()
  await importPromise
  await tick(15)
  assert.equal(dropdownItems(view.tree()).length, 0)
  assert.equal(host.toasts.length, toastCountBefore)
  view.unmount()
})

test('sqlite-plugin UI: 打开后显示第一张表的真实记录，不默认勾选，没有 VACUUM 等写入动作，支持导出', async () => {
  const host = createHost()
  const dllCalls = installHost(host)
  const view = await mount(SqlitePluginCommand, host)
  await importViaPaste(view, [DB_PATH])

  const rows = rowItems(view)
  assert.equal(rows.length, 2)
  assert.ok(rows.every((r) => r.props.checked === false))
  assert.match(rows[0].props.title, /id=1 · name=alice/)
  assert.match(view.tree().props.filterBar.props.summaryText, /data\.db/)
  assert.match(view.tree().props.filterBar.props.summaryText, /已勾选 0 行/)
  assert.match(view.tree().props.filterBar.props.summaryText, /清空列表 Ctrl\+Shift\+Backspace/)

  const text = view.text()
  assert.doesNotMatch(text, /VACUUM|Checkpoint|WAL/i)
  const allActionTitles = view.items().flatMap((it) => view.actions(it).map((a) => a.props.title))
  assert.ok(!allActionTitles.some((t) => /VACUUM|整理|压缩/.test(t)))
  assert.deepEqual(dllCalls.map((c) => c.func), ['inspectWorkspace'])

  // 未勾选时导出当前列表，内容是真实字段值
  await view.run(rows[0], '导出当前列表的 2 行为 JSON')
  assert.deepEqual(JSON.parse(host.clipboard.text), [{ id: 1, name: 'alice' }, { id: 2, name: 'bob' }])
  assert.equal(host.lastToast().style, 'SUCCESS')

  // 勾选一行后只导出勾选的行
  rows[1].props.onCheckChange(true)
  await tick()
  await view.run(rowItems(view)[1], '导出已勾选的 1 行为 SQL INSERT 语句')
  assert.equal(host.clipboard.text, `INSERT INTO "accounts" ("id", "name") VALUES (2, 'bob');`)
  view.unmount()
})

test('sqlite-plugin UI: 选中其他表时只读读取该表记录，失败时如实显示原因', async () => {
  const host = createHost()
  const dllCalls = installHost(host)
  const view = await mount(SqlitePluginCommand, host)
  await importViaPaste(view, [DB_PATH])

  view.item('nav-sql-logs').props.onSelect()
  await tick(10)
  const query = dllCalls.find((c) => c.func === 'executeQuery')
  assert.ok(query, '选中表后应读取该表')
  assert.equal(query.params.tableName, 'logs')
  assert.equal('sql' in query.params, false)
  assert.deepEqual(rowItems(view).map((r) => r.props.title), ['msg=hello'])

  // 再次选中同一张表不重复读取
  view.item('nav-sql-logs').props.onSelect()
  await tick(10)
  assert.equal(dllCalls.filter((c) => c.func === 'executeQuery').length, 1)
  view.unmount()

  const failHost = createHost()
  installHost(failHost, { queryError: 'database is locked' })
  const failView = await mount(SqlitePluginCommand, failHost)
  await importViaPaste(failView, [DB_PATH])
  failView.item('nav-sql-logs').props.onSelect()
  await tick(10)
  assert.equal(rowItems(failView).length, 0)
  assert.match(failView.tree().props.subList.emptyText, /读取失败：database is locked/)
  assert.match(failView.tree().props.filterBar.props.summaryText, /读取表「logs」失败/)
  failView.unmount()
})

test('sqlite-plugin UI: 读取数据库失败时显示原因且不经旧 SDK 重试，支持从列表移除', async () => {
  const host = createHost()
  installHost(host)
  const previous = globalThis.ztools
  let legacyCalls = 0
  globalThis.ztools = { dllplugin: { call: async () => { legacyCalls++; throw new Error('旧 SDK 错误') } } }
  host.ipc.dllplugin_call = async () => ({ success: false, error: 'file is not a database' })
  const view = await mount(SqlitePluginCommand, host)
  try {
    await importViaPaste(view, [DB_PATH])
    assert.equal(rowItems(view).length, 0)
    assert.equal(view.items().filter((it) => String(it.props.id).startsWith('nav-sql-')).length, 0)
    assert.match(view.tree().props.filterBar.props.summaryText, /file is not a database/)
    assert.match(view.tree().props.subList.emptyText, /file is not a database/)
    assert.equal(legacyCalls, 0)

    await view.run(undefined, '从列表移除')
    await tick()
    assert.equal(dropdownItems(view.tree()).length, 0)
  } finally {
    view.unmount()
    globalThis.ztools = previous
  }
})

test('不在客户端里运行时只显示“需要在 ZTools 客户端中使用”', async () => {
  const host = createHost()
  const saved = globalThis.__ztoolsElectron
  delete globalThis.__ztoolsElectron
  try {
    const view = await mount(SqlitePluginCommand, host)
    await tick(5)
    const items = view.items()
    assert.equal(items.length, 1)
    assert.equal(items[0].props.title, '需要在 ZTools 客户端中使用')
    assert.equal(host.ipcCalls.length, 0)
    view.unmount()
  } finally {
    globalThis.__ztoolsElectron = saved
  }
})
