// 目录导入与列表交互测试：启动零扫描、只用 select_folder_dialog 读写授权、仅一级目录导入、多次去重追加、拖入/粘贴文件夹、移除与清空、导入竞态防护
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import * as logic from '../dist/logic.js'
import BatchRenameCommand from '../dist/index.js'

const roots = []
test.after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true })
})

function makeTree(spec) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'batch-rename-dir-')))
  roots.push(root)
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

function setupImportHost(host, { authorizedDirs = [], folderDialogQueue = [], openDialogQueue = [] } = {}) {
  const authSet = new Set(authorizedDirs)
  host.ipc.window_show_select_folder_dialog = async (params) => {
    host.dialogCalls = [...(host.dialogCalls || []), ['select_folder', params]]
    const next = folderDialogQueue.shift()
    if (!next) return { canceled: true }
    if (next instanceof Error) throw next
    authSet.add(next)
    return { canceled: false, folderPath: next }
  }
  host.ipc.window_show_open_dialog = async (params) => {
    host.dialogCalls = [...(host.dialogCalls || []), ['open_dialog', params]]
    const next = openDialogQueue.shift()
    if (!next) return { canceled: true }
    if (next instanceof Error) throw next
    return { canceled: false, filePaths: next }
  }
  host.ipc.filesystem_directory_exists = async ({ path: target }) => ({
    success: true,
    exists: fs.existsSync(target) && fs.statSync(target).isDirectory()
  })
  host.ipc.filesystem_get_file_size = async ({ path: target }) => {
    if (!fs.existsSync(target)) throw Object.assign(new Error('文件不存在'), { code: 'FILE_NOT_FOUND' })
    return { success: true, size: fs.statSync(target).size }
  }
  host.ipc.filesystem_get_directory_contents = async ({ path: target }) => {
    if (!fs.existsSync(target)) throw Object.assign(new Error('目录不存在'), { code: 'FILE_NOT_FOUND' })
    const files = fs.readdirSync(target, { withFileTypes: true }).map((ent) => {
      const st = fs.statSync(path.join(target, ent.name))
      return {
        name: ent.name,
        size: ent.isDirectory() ? 0 : st.size,
        isDirectory: ent.isDirectory(),
        lastModified: st.mtime.toISOString()
      }
    })
    return { success: true, writeAuthorized: authSet.has(target), files }
  }
}

const subItems = (view) => view.tree().props.subList.items
const summary = (view) => view.tree().props.filterBar.summaryText
const topActions = (view) => view.tree().props.filterBar.actions

test('启动零扫描：挂载后不调用任何系统路径/目录/索引接口，初始右栏为空且顶栏恰有 2 个按钮', async () => {
  const host = createHost()
  host.reset()
  const view = await mount(BatchRenameCommand, host)
  await tick(20)

  assert.equal(host.ipcCalls.length, 0, `挂载时不应发起任何 IPC 调用，实际：${JSON.stringify(host.ipcCalls)}`)
  assert.equal(view.tree().props.searchBarAccessory, undefined, '不应再保留系统目录下拉框')
  assert.deepEqual(subItems(view), [])
  assert.equal(summary(view), '尚未添加文件 · 可选择文件、文件夹，或直接拖入')

  const buttons = topActions(view)
  assert.equal(buttons.length, 2)
  assert.deepEqual(
    buttons.map((b) => [b.id, b.title]),
    [['pick-files', '选择文件'], ['pick-folder', '选择文件夹']]
  )

  const listActions = view.actions(null)
  assert.equal(listActions[0].props.title, '选择文件…')
  assert.equal(listActions[1].props.title, '选择文件夹…')

  for (const preset of logic.getRenameRulePresets()) {
    assert.doesNotMatch(preset.label, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
  }
  view.unmount()
})

test('选择文件夹（b & c 项）：只调用 select_folder_dialog（读写授权）、仅导入一级直接子文件、不跳过 0 字节文件并过滤系统元数据', async () => {
  const root = makeTree({
    'a.txt': 'a',
    'empty.txt': '',
    'b.jpg': 'bb',
    '.DS_Store': 'meta',
    '.hidden.txt': 'h',
    'desktop.ini': 'ini',
    'Thumbs.db': 'db',
    '~$temp.docx': 'tmp',
    'sub/deep-big.bin': 'nested'
  })
  const host = createHost()
  host.reset()
  setupImportHost(host, { folderDialogQueue: [root] })

  const view = await mount(BatchRenameCommand, host)
  await topActions(view).find((a) => a.id === 'pick-folder').onAction()
  await tick(20)

  assert.equal(host.ipcCalls.filter(([m]) => m === 'window_show_open_dialog').length, 0, '选择文件夹严禁调用只读的 open_dialog')
  assert.equal(host.ipcCalls.filter(([m]) => m === 'window_show_select_folder_dialog').length, 1)
  assert.deepEqual(
    subItems(view).map((i) => i.props.title),
    ['a.txt', 'b.jpg', 'empty.txt']
  )
  assert.ok(subItems(view).every((i) => i.props.checked === true), '新导入文件默认全部勾选')
  assert.ok(
    subItems(view).every((i) => i.props.accessories.some((a) => a.tag?.value === '已授权')),
    'select_folder_dialog 签发读写授权后条目标记已授权'
  )
  assert.match(summary(view), /清空列表 ⌘\/Ctrl\+Shift\+Backspace$/)
  view.unmount()
})

test('多次导入去重追加：选择文件夹后再选择部分重复与新文件，使用 mergeByPath 去重追加且保留已有勾选状态', async () => {
  const dirA = makeTree({ 'a.txt': 'A', 'b.txt': 'B' })
  const dirB = makeTree({ 'c.txt': 'C' })
  const host = createHost()
  host.reset()
  setupImportHost(host, {
    folderDialogQueue: [dirA],
    openDialogQueue: [[path.join(dirA, 'a.txt'), path.join(dirB, 'c.txt')]]
  })

  const view = await mount(BatchRenameCommand, host)
  await topActions(view).find((a) => a.id === 'pick-folder').onAction()
  await tick(20)

  // 取消勾选 b.txt，验证后续追加不会改动 b.txt 的勾选
  subItems(view).find((i) => i.props.title === 'b.txt').props.onToggleCheck()
  await tick(10)

  await topActions(view).find((a) => a.id === 'pick-files').onAction()
  await tick(20)

  assert.deepEqual(
    subItems(view).map((i) => [i.props.title, i.props.checked]),
    [['a.txt', true], ['b.txt', false], ['c.txt', true]]
  )
  assert.equal(host.lastToast().style, 'SUCCESS')
  assert.match(host.lastToast().title, /已添加 1 个文件/)
  assert.match(host.lastToast().message, /1 个已在列表中/)
  view.unmount()
})

test('拖入/粘贴文件夹（f 项）：带点文件夹名正常展开一级子文件，兼容新版 directories 与旧版回退路径', async () => {
  const root = makeTree({
    'v1.2_assets/photo.png': 'p',
    'v1.2_assets/nested/inner.png': 'n',
    'plain.txt': 't'
  })
  const dottedDir = path.join(root, 'v1.2_assets')
  const host = createHost()
  host.reset()
  setupImportHost(host)

  const view = await mount(BatchRenameCommand, host)
  await view.dropFiles([dottedDir, path.join(root, 'plain.txt')], { directories: [dottedDir] })
  await tick(20)

  assert.deepEqual(
    subItems(view).map((i) => i.props.title),
    ['photo.png', 'plain.txt']
  )
  assert.equal(host.ipcCalls.filter(([m]) => m === 'filesystem_directory_exists').length, 0, '新版宿主有 directories 时不应逐个探测')

  // 清空后再验证旧版宿主不传 directories，以及旧版 plugin_files_dropped 事件回退
  await view.run(subItems(view)[0], '清空列表')
  await tick(10)
  assert.deepEqual(subItems(view), [])

  const savedFeatures = globalThis.window.__ztoolsDeclarativeFeatures
  delete globalThis.window.__ztoolsDeclarativeFeatures
  try {
    const legacyView = await mount(BatchRenameCommand, host)
    await tick(10)
    host.emitEvent('plugin_files_dropped', { files: [dottedDir], source: 'drop' })
    await tick(20)
    assert.deepEqual(
      subItems(legacyView).map((i) => i.props.title),
      ['photo.png']
    )
    legacyView.unmount()
  } finally {
    globalThis.window.__ztoolsDeclarativeFeatures = savedFeatures
  }
  view.unmount()
})

test('选择磁盘根目录先确认；上限截断如实提示；受保护目录拒绝导入；畸形目录载荷如实报错', async () => {
  const host = createHost()
  host.reset()
  const driveRoot = process.platform === 'win32' ? 'D:\\' : '/'
  setupImportHost(host, { folderDialogQueue: [driveRoot] })
  host.ipc.filesystem_get_directory_contents = async () => ({
    success: true,
    writeAuthorized: true,
    files: [{ name: 'root-doc.txt', size: 5, isDirectory: false }]
  })

  const view = await mount(BatchRenameCommand, host)
  host.setConfirm(false)
  await topActions(view).find((a) => a.id === 'pick-folder').onAction()
  await tick(20)
  assert.equal(host.confirms.at(-1).title, '确认从磁盘根目录导入？')
  assert.equal(subItems(view).length, 0, '取消盘符根目录确认后不应读取目录')

  // 确认盘符根目录后正常导入
  host.setConfirm(true)
  setupImportHost(host, { folderDialogQueue: [driveRoot] })
  host.ipc.filesystem_get_directory_contents = async () => ({
    success: true,
    writeAuthorized: true,
    files: Array.from({ length: logic.MAX_RENAME_FILES + 4 }, (_, idx) => ({
      name: `f${idx}.txt`,
      size: 1,
      isDirectory: false
    }))
  })
  await topActions(view).find((a) => a.id === 'pick-folder').onAction()
  await tick(20)
  assert.equal(subItems(view).length, logic.MAX_RENAME_FILES)
  assert.match(host.lastToast().message, /只导入了一部分/)
  assert.match(summary(view), new RegExp(`仅显示前 ${logic.MAX_RENAME_FILES} 个`))

  // 畸形目录载荷如实报错
  await view.run(subItems(view)[0], '清空列表')
  setupImportHost(host, { folderDialogQueue: ['/safe/dir'] })
  host.ipc.filesystem_get_directory_contents = async () => ({ success: true, items: 'garbage' })
  await topActions(view).find((a) => a.id === 'pick-folder').onAction()
  await tick(20)
  assert.equal(host.lastToast().style, 'FAILURE')
  assert.equal(host.lastToast().title, '导入失败')

  // 受保护路径拦截
  for (const p of ['/System/Library/a.txt', '/Library/Developer/x.h', '/usr/share/man/a.1', '/Users/alice/Library/Caches/a.db',
    'C:\\Windows\\System32\\a.dll', 'D:/Program Files/app/a.txt', 'C:\\ProgramData\\x.ini', '\\\\?\\C:\\Windows\\a.txt', '/Users/alice/../bob/a.txt']) {
    assert.ok(logic.FORBIDDEN_TARGET_PATTERN.test(p), p)
  }
  view.unmount()
})

test('从列表移除与清空列表不删除磁盘文件；导入进行中清空会丢弃过期结果；连续导入中止上一次；卸载不崩溃', async () => {
  const root = makeTree({ 'a.txt': 'A', 'b.txt': 'B' })
  const host = createHost()
  host.reset()
  setupImportHost(host, { folderDialogQueue: [root] })

  const view = await mount(BatchRenameCommand, host)
  await topActions(view).find((a) => a.id === 'pick-folder').onAction()
  await tick(20)
  assert.deepEqual(subItems(view).map((i) => i.props.title), ['a.txt', 'b.txt'])

  // 全选 / 取消全选
  await view.run(subItems(view)[0], '取消全选')
  assert.equal(subItems(view).every((i) => !i.props.checked), true)
  await view.run(subItems(view)[0], '全选')
  assert.equal(subItems(view).every((i) => i.props.checked), true)

  // 从列表移除仅移出视图，不碰磁盘文件
  await view.run(subItems(view)[0], '从列表移除')
  assert.deepEqual(subItems(view).map((i) => i.props.title), ['b.txt'])
  assert.equal(fs.existsSync(path.join(root, 'a.txt')), true)

  // 清空列表不碰磁盘文件
  await view.run(subItems(view)[0], '清空列表')
  assert.deepEqual(subItems(view), [])
  assert.equal(fs.existsSync(path.join(root, 'b.txt')), true)

  // 导入进行中再次触发新导入：前一次被 AbortController 中止并丢弃，只保留最后一次导入结果
  const extraDir = makeTree({ 'fresh.txt': 'F' })
  let resolveSlowDir
  const slowPromise = new Promise((r) => {
    resolveSlowDir = r
  })
  setupImportHost(host, {
    folderDialogQueue: [root],
    openDialogQueue: [[path.join(extraDir, 'fresh.txt')]]
  })
  host.ipc.filesystem_get_directory_contents = async () => slowPromise
  const importing = topActions(view).find((a) => a.id === 'pick-folder').onAction()
  await tick(5)
  assert.match(summary(view), /正在导入：已读取 \d+ 个文件夹/)
  await topActions(view).find((a) => a.id === 'pick-files').onAction()
  resolveSlowDir({ success: true, writeAuthorized: true, files: [{ name: 'stale.txt', size: 1, isDirectory: false }] })
  await importing
  await tick(20)
  assert.deepEqual(subItems(view).map((i) => i.props.title), ['fresh.txt'], '被中止的前一次导入不能覆盖新导入结果')
  view.unmount()

  const host2 = createHost()
  host2.reset()
  setupImportHost(host2, { folderDialogQueue: [root, root] })
  const view2 = await mount(BatchRenameCommand, host2)
  await topActions(view2).find((a) => a.id === 'pick-folder').onAction()
  await tick(20)
  assert.equal(subItems(view2).length, 2)

  let releaseSecond
  const secondGate = new Promise((r) => {
    releaseSecond = r
  })
  host2.ipc.filesystem_get_directory_contents = async () => secondGate
  const toastCountBefore = host2.toasts.length
  const p2 = topActions(view2).find((a) => a.id === 'pick-folder').onAction()
  await tick(5)
  await view2.run(subItems(view2)[0], '清空列表')
  assert.deepEqual(subItems(view2), [])
  releaseSecond({ success: true, writeAuthorized: true, files: [{ name: 'late.txt', size: 1, isDirectory: false }] })
  await p2
  await tick(20)
  assert.deepEqual(subItems(view2), [], '导入中清空后过期结果必须被丢弃')
  assert.equal(host2.toasts.length, toastCountBefore, '丢弃过期导入结果时不应弹 Toast')

  // 组件卸载时中止进行中的导入
  setupImportHost(host2, { folderDialogQueue: [root] })
  let releaseUnmount
  host2.ipc.filesystem_get_directory_contents = async () => new Promise((r) => { releaseUnmount = r })
  const p3 = topActions(view2).find((a) => a.id === 'pick-folder').onAction()
  await tick(5)
  view2.unmount()
  releaseUnmount({ success: true, writeAuthorized: true, files: [{ name: 'ghost.txt', size: 1, isDirectory: false }] })
  await p3
})
