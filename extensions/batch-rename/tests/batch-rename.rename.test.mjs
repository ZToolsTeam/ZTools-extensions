// 改名闭环集成测试：模拟宿主真实授权模型（select_folder 读写授权、open_dialog 文件只读授权、拖放文件夹只读递归授权），
// 在临时目录中真实改名，覆盖按目录补授权（含取消与选错目录）、多目录混合、按目录独立冲突、部分失败、授权过期、并发、处理中禁清空、撤销与定位。
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

function makeWorkspace(spec) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'batch-rename-op-')))
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

const fail = (code, message) => Object.assign(new Error(message), { code })

/**
 * 贴近真实宿主的按窗口授权模型：
 * - window_show_select_folder_dialog：签发目录递归读写授权（writeAuthorized: true）
 * - window_show_open_dialog：签发选中文件的精确只读授权（不授权目录，也不能写）
 * - drop / paste 文件夹：模拟宿主签发目录只读递归授权（writeAuthorized: false）
 * - filesystem_move_file_no_replace / shell_show_item_in_folder：要求目录写授权，拒绝只有只读或文件精确授权的调用
 */
function setupRenameHost({ folderDialog = [], openDialog = [], readOnlyDirs = [] } = {}) {
  const host = createHost()
  host.reset()
  const grants = []
  for (const d of readOnlyDirs) {
    grants.push({ path: d, recursive: true, write: false })
  }
  const folderQueue = [...folderDialog]
  const openQueue = [...openDialog]
  const revealed = []
  const moveFaults = new Map()

  const covers = (g, p, needWrite) => {
    if (needWrite && !g.write) return false
    return p === g.path || (g.recursive && p.startsWith(g.path + path.sep))
  }
  const hasGrant = (p, needWrite) => grants.some((g) => covers(g, p, needWrite))
  const requireGrant = (needWrite, ...paths) => {
    for (const p of paths) {
      if (!hasGrant(p, needWrite)) throw fail('PERMISSION_DENIED', '路径未由当前窗口授权')
    }
  }

  host.ipc.window_show_select_folder_dialog = async (params) => {
    host.dialogCalls = [...(host.dialogCalls || []), params]
    const next = folderQueue.length > 0 ? folderQueue.shift() : null
    if (!next) return { canceled: true }
    grants.push({ path: next, recursive: true, write: true })
    return { canceled: false, folderPath: next }
  }
  host.ipc.window_show_open_dialog = async (params) => {
    const next = openQueue.length > 0 ? openQueue.shift() : null
    if (!next) return { canceled: true }
    for (const p of next) {
      grants.push({ path: p, recursive: false, write: false })
    }
    return { canceled: false, filePaths: next }
  }
  host.ipc.filesystem_directory_exists = async ({ path: target }) => ({
    success: true,
    exists: fs.existsSync(target) && fs.statSync(target).isDirectory()
  })
  host.ipc.filesystem_get_file_size = async ({ path: target }) => {
    requireGrant(false, target)
    if (!fs.existsSync(target)) throw fail('FILE_NOT_FOUND', '文件不存在')
    return { success: true, size: fs.statSync(target).size }
  }
  host.ipc.filesystem_get_directory_contents = async ({ path: target }) => {
    requireGrant(false, target)
    if (!fs.existsSync(target)) throw fail('FILE_NOT_FOUND', '目录不存在')
    return {
      success: true,
      writeAuthorized: hasGrant(target, true),
      files: fs.readdirSync(target, { withFileTypes: true }).map((ent) => {
        const st = fs.statSync(path.join(target, ent.name))
        return {
          name: ent.name,
          size: ent.isDirectory() ? 0 : st.size,
          isDirectory: ent.isDirectory(),
          lastModified: st.mtime.toLocaleString(),
          attributes: 32
        }
      })
    }
  }
  host.ipc.filesystem_move_file_no_replace = async (params) => {
    const extra = Object.keys(params).filter((k) => k !== 'sourcePath' && k !== 'destPath')
    if (extra.length > 0) throw fail('INVALID_REQUEST', '方法参数包含未知字段')
    requireGrant(true, params.sourcePath, params.destPath)
    const fault = moveFaults.get(path.basename(params.sourcePath))
    if (fault) throw fault
    try {
      fs.linkSync(params.sourcePath, params.destPath)
    } catch (error) {
      if (error.code === 'EEXIST') throw fail('FILE_ALREADY_EXISTS', '目标文件已存在，未覆盖')
      throw error
    }
    fs.unlinkSync(params.sourcePath)
    return { success: true }
  }
  host.ipc.shell_show_item_in_folder = async ({ fullPath }) => {
    requireGrant(true, fullPath)
    revealed.push(fullPath)
    return { success: true }
  }
  host.ipc.shell_open_path = async () => {
    throw new Error('定位不应回退为直接打开文件')
  }

  return {
    host,
    grants,
    revealed,
    moveFaults,
    queueFolderDialog: (p) => folderQueue.push(p),
    queueOpenDialog: (ps) => openQueue.push(ps),
    grantReadOnlyDir: (d) => grants.push({ path: d, recursive: true, write: false }),
    revokeWriteGrants: () => {
      for (let i = grants.length - 1; i >= 0; i--) {
        if (grants[i].write) grants.splice(i, 1)
      }
    },
    moves: () => host.ipcCalls.filter(([m]) => m === 'filesystem_move_file_no_replace').map(([, p]) => p)
  }
}

const summary = (view) => view.tree().props.filterBar.summaryText
const subItems = (view) => view.tree().props.subList.items
const subItem = (view, name) => {
  const found = subItems(view).find((i) => i.props.title === name)
  if (!found) throw new Error(`找不到 ${name}；现有：${subItems(view).map((i) => i.props.title).join(', ')}`)
  return found
}
const tagValues = (item) => (item.props.accessories || []).map((a) => a.tag?.value).filter(Boolean)
const actionTitles = (view, node) => view.actions(node).map((a) => a.props.title)
async function runAction(view, node, prefix) {
  const action = view.actions(node).find((a) => a.props.title.startsWith(prefix))
  if (!action) throw new Error(`找不到动作「${prefix}」；现有：${actionTitles(view, node).join(' | ')}`)
  await action.props.onAction?.()
  await tick(20)
}
async function pickFolderViaTop(view) {
  await view.tree().props.filterBar.actions.find((a) => a.id === 'pick-folder').onAction()
  await tick(20)
}
async function pickFilesViaTop(view) {
  await view.tree().props.filterBar.actions.find((a) => a.id === 'pick-files').onAction()
  await tick(20)
}
const ls = (dir) => fs.readdirSync(dir).sort()

test('通过「选择文件夹」导入已获得写授权，直接以 destPath 真实改名并支持完全撤销', async () => {
  const root = makeWorkspace({ 'Pics/b.txt': 'B', 'Pics/a.txt': 'A' })
  const pics = path.join(root, 'Pics')
  const ctx = setupRenameHost({ folderDialog: [pics] })

  const view = await mount(BatchRenameCommand, ctx.host)
  await pickFolderViaTop(view)
  assert.deepEqual(tagValues(subItem(view, 'a.txt')), ['待改名', '已授权'])
  assert.doesNotMatch(summary(view), /只读预览/)

  ctx.host.dialogCalls = []
  await runAction(view, subItem(view, 'a.txt'), '执行批量重命名')
  assert.equal(ctx.host.dialogCalls.length, 0, '选择文件夹导入已有写授权，改名不应再弹框')
  for (const p of ctx.moves()) assert.deepEqual(Object.keys(p).sort(), ['destPath', 'sourcePath'])
  assert.deepEqual(ls(pics), ['a_01.txt', 'b_02.txt'])
  assert.equal(fs.readFileSync(path.join(pics, 'a_01.txt'), 'utf8'), 'A')
  assert.equal(ctx.host.lastToast().style, 'SUCCESS')
  assert.match(ctx.host.lastToast().title, /已重命名 2 个文件/)
  assert.match(summary(view), /规则: 阿拉伯序号.*可撤销 2 项/)

  const item = subItem(view, 'a_01.txt')
  assert.ok(actionTitles(view, item).some((t) => t.startsWith('撤销上一次重命名')))
  await runAction(view, item, '撤销上一次重命名')
  assert.deepEqual(ls(pics), ['a.txt', 'b.txt'])
  assert.equal(ctx.host.dialogCalls.length, 0)
  assert.match(ctx.host.lastToast().title, /已撤销 2 个/)
  assert.ok(!actionTitles(view, subItem(view, 'a.txt')).some((t) => t.startsWith('撤销')), '撤销后不再提供撤销')
  view.unmount()
})

test('d 项：选择单文件 / 拖入文件夹标为「只读预览」，改名前按目录补授权；取消或选错目录保持只读预览且不改任何文件', async () => {
  const root = makeWorkspace({
    'Pics/a.txt': 'A',
    'Pics/unselected.txt': 'U',
    'Other/x.txt': 'X'
  })
  const dropRoot = makeWorkspace({ 'Dropped/d1.txt': 'D1' })
  const pics = path.join(root, 'Pics')
  const other = path.join(root, 'Other')
  const dropped = path.join(dropRoot, 'Dropped')

  const ctx = setupRenameHost({
    openDialog: [[path.join(pics, 'a.txt')]],
    readOnlyDirs: [dropped]
  })
  const view = await mount(BatchRenameCommand, ctx.host)

  // 1. 选择单文件为只读预览
  await pickFilesViaTop(view)
  assert.deepEqual(tagValues(subItem(view, 'a.txt')), ['待改名', '只读预览'])
  assert.match(summary(view), /只读预览，执行时需授权文件夹/)

  // 取消授权：不执行任何改动，保持只读预览
  await runAction(view, subItem(view, 'a.txt'), '执行批量重命名')
  assert.equal(ctx.host.dialogCalls.length, 1)
  assert.equal(ctx.host.dialogCalls[0].title, '授权文件夹以重命名其中的文件: Pics')
  assert.equal(ctx.host.dialogCalls[0].defaultPath, pics)
  assert.equal(ctx.moves().length, 0)
  assert.deepEqual(ls(pics), ['a.txt', 'unselected.txt'])
  assert.match(ctx.host.lastToast().title, /已取消授权/)
  assert.deepEqual(tagValues(subItem(view, 'a.txt')), ['待改名', '只读预览'])

  // 选错目录（选了兄弟目录 Other 或父目录 root）：严格要求 pathKey(picked) === pathKey(dir)，不切换也不执行
  ctx.queueFolderDialog(other)
  await runAction(view, subItem(view, 'a.txt'), '执行批量重命名')
  assert.equal(ctx.moves().length, 0)
  assert.deepEqual(ls(pics), ['a.txt', 'unselected.txt'])
  assert.deepEqual(subItems(view).map((i) => i.props.title), ['a.txt'], '选错目录不应切换或改变列表')
  assert.match(ctx.host.lastToast().title, /未获得文件夹写授权/)
  assert.match(ctx.host.lastToast().message, /不一致/)
  assert.deepEqual(tagValues(subItem(view, 'a.txt')), ['待改名', '只读预览'])

  ctx.queueFolderDialog(root)
  await runAction(view, subItem(view, 'a.txt'), '执行批量重命名')
  assert.equal(ctx.moves().length, 0)
  assert.match(ctx.host.lastToast().message, /不一致/)

  // 选对目录：只改原本导入列表里的 a.txt，不把同目录未选中的 unselected.txt 拉进列表
  ctx.queueFolderDialog(pics)
  await runAction(view, subItem(view, 'a.txt'), '执行批量重命名')
  assert.deepEqual(ls(pics), ['a_01.txt', 'unselected.txt'])
  assert.deepEqual(subItems(view).map((i) => i.props.title), ['a_01.txt'])
  assert.deepEqual(tagValues(subItem(view, 'a_01.txt')), ['待改名', '已授权'])

  // 2. 拖入只读文件夹同样显示只读预览，授权后正常改名
  await view.dropFiles([dropped], { directories: [dropped] })
  await tick(20)
  assert.deepEqual(tagValues(subItem(view, 'd1.txt')), ['待改名', '只读预览'])
  ctx.queueFolderDialog(dropped)
  await runAction(view, subItem(view, 'd1.txt'), '只改名此文件')
  assert.deepEqual(ls(dropped), ['d1_02.txt'])
  assert.deepEqual(tagValues(subItem(view, 'd1_02.txt')), ['待改名', '已授权'])
  view.unmount()
})

test('d 项多目录混合：已授权目录与选对目录正常改名，取消或选错目录保持只读预览并如实汇报', async () => {
  const root = makeWorkspace({
    'DirA/a.txt': 'A',
    'DirB/b.txt': 'B',
    'DirC/c.txt': 'C',
    'Wrong/w.txt': 'W'
  })
  const dirA = path.join(root, 'DirA')
  const dirB = path.join(root, 'DirB')
  const dirC = path.join(root, 'DirC')
  const wrong = path.join(root, 'Wrong')

  const ctx = setupRenameHost({
    folderDialog: [dirA],
    openDialog: [[path.join(dirB, 'b.txt')]],
    readOnlyDirs: [dirC]
  })
  const view = await mount(BatchRenameCommand, ctx.host)

  await pickFolderViaTop(view) // dirA 已授权
  await pickFilesViaTop(view) // dirB 只读预览
  await view.dropFiles([dirC], { directories: [dirC] }) // dirC 只读预览
  await tick(20)

  ctx.host.dialogCalls = []
  // 依次弹出 dirB 与 dirC 授权框：dirB 选对，dirC 选错
  ctx.queueFolderDialog(dirB)
  ctx.queueFolderDialog(wrong)

  await runAction(view, subItem(view, 'a.txt'), '执行批量重命名')
  assert.equal(ctx.host.dialogCalls.length, 2, '仅对未授权的 dirB、dirC 弹框，已授权的 dirA 不弹')
  assert.equal(ctx.host.dialogCalls[0].defaultPath, dirB)
  assert.equal(ctx.host.dialogCalls[1].defaultPath, dirC)

  assert.deepEqual(ls(dirA), ['a_01.txt'])
  assert.deepEqual(ls(dirB), ['b_02.txt'])
  assert.deepEqual(ls(dirC), ['c.txt'])
  assert.deepEqual(tagValues(subItem(view, 'a_01.txt')), ['待改名', '已授权'])
  assert.deepEqual(tagValues(subItem(view, 'b_02.txt')), ['待改名', '已授权'])
  assert.deepEqual(tagValues(subItem(view, 'c.txt')), ['待改名', '只读预览'])
  assert.equal(ctx.host.lastToast().style, 'FAILURE')
  assert.match(ctx.host.lastToast().title, /已重命名 2\/3 个，1 个未完成/)
  assert.match(ctx.host.lastToast().message, /保持只读预览/)
  view.unmount()
})

test('d 项补授权后检测同目录未导入文件占用冲突：发现同名文件拦截改名并绝不覆盖', async () => {
  const root = makeWorkspace({ 'Pics/a.txt': 'A-src', 'Pics/a_01.txt': 'A01-existing' })
  const pics = path.join(root, 'Pics')
  const ctx = setupRenameHost({
    openDialog: [[path.join(pics, 'a.txt')]],
    folderDialog: [pics]
  })
  const view = await mount(BatchRenameCommand, ctx.host)
  await pickFilesViaTop(view)

  await runAction(view, subItem(view, 'a.txt'), '执行批量重命名')
  assert.equal(ctx.moves().length, 0)
  assert.equal(fs.readFileSync(path.join(pics, 'a_01.txt'), 'utf8'), 'A01-existing')
  assert.equal(fs.readFileSync(path.join(pics, 'a.txt'), 'utf8'), 'A-src')
  assert.deepEqual(tagValues(subItem(view, 'a.txt')), ['同名冲突', '已授权'])
  assert.match(ctx.host.lastToast().message, /与已有文件同名/)
  view.unmount()
})

test('e 项按目录独立冲突检测：不同目录同名文件不算冲突，同目录重复/已有/隐藏/子目录/非法名均拦截', async () => {
  // 1. 纯逻辑多目录冲突隔离
  const entries = [
    { name: 'a.txt', fullPath: '/dir1/a.txt', parentDir: '/dir1', extension: '.txt', sizeBytes: 1, lastModifiedMs: 0 },
    { name: 'a.txt', fullPath: '/dir2/a.txt', parentDir: '/dir2', extension: '.txt', sizeBytes: 1, lastModifiedMs: 0 },
    { name: 'b.txt', fullPath: '/dir1/b.txt', parentDir: '/dir1', extension: '.txt', sizeBytes: 1, lastModifiedMs: 0 }
  ]
  const occupiedMap = new Map([
    ['/dir1', ['a.txt', 'b.txt']],
    ['/dir2', ['a.txt']]
  ])
  // 所有文件都前缀加 target_ -> /dir1 下是 target_a.txt 和 target_b.txt；/dir2 下也是 target_a.txt，跨目录不冲突！
  const multiDir = logic.buildRenamePreview(entries, { type: 'prefix', prefix: 'target_' }, occupiedMap)
  assert.equal(multiDir.every((i) => !i.conflict), true, '不同目录同名新文件不应冲突')

  // 同目录内两个文件改成同名则冲突
  const sameDirDup = logic.buildRenamePreview(
    [
      { name: 'File 1.txt', fullPath: '/d/File 1.txt', parentDir: '/d', extension: '.txt', sizeBytes: 1, lastModifiedMs: 0 },
      { name: 'file-1.txt', fullPath: '/d/file-1.txt', parentDir: '/d', extension: '.txt', sizeBytes: 1, lastModifiedMs: 0 },
      { name: 'other.txt', fullPath: '/d2/file_1.txt', parentDir: '/d2', extension: '.txt', sizeBytes: 1, lastModifiedMs: 0 }
    ],
    { type: 'snake_case' },
    new Map([
      ['/d', ['File 1.txt', 'file-1.txt']],
      ['/d2', ['other.txt']]
    ])
  )
  assert.deepEqual(
    sameDirDup.map((i) => [i.fullPath, i.conflict, i.conflictReason]),
    [
      ['/d/File 1.txt', true, 'duplicate'],
      ['/d/file-1.txt', true, 'duplicate'],
      ['/d2/file_1.txt', false, undefined]
    ]
  )

  // 2. 界面端到端：两个不同目录下的 item.txt 同时通过查找替换改为 same.txt，均成功改名
  const root = makeWorkspace({
    'D1/item.txt': '1',
    'D1/p': 'P',
    'D2/item.txt': '2',
    'D1/sub/keep.txt': 'K'
  })
  const d1 = path.join(root, 'D1')
  const d2 = path.join(root, 'D2')
  const ctx = setupRenameHost({ folderDialog: [d1, d2] })
  const view = await mount(BatchRenameCommand, ctx.host)
  await pickFolderViaTop(view)
  await pickFolderViaTop(view)
  await view.search('item->same')
  assert.match(summary(view), /待改名 2 项/)
  assert.doesNotMatch(summary(view), /同名冲突/)
  await runAction(view, subItems(view)[0], '执行批量重命名')
  assert.deepEqual(ls(d1), ['p', 'same.txt', 'sub'])
  assert.deepEqual(ls(d2), ['same.txt'])

  // 同目录与子目录 sub 同名拦截
  await view.search('p->sub')
  assert.equal(subItem(view, 'p').props.accessories.find((a) => a.tag?.color === 'red')?.tag?.value, '同名冲突')
  assert.match(summary(view), /1 项同名冲突/)
  view.unmount()
})

test('部分失败、授权过期中断、处理中禁止清空列表与并发防重入', async () => {
  const root = makeWorkspace({ 'Pics/a.txt': 'A', 'Pics/b.txt': 'B', 'Pics/c.txt': 'C' })
  const pics = path.join(root, 'Pics')
  const ctx = setupRenameHost({ folderDialog: [pics] })
  ctx.moveFaults.set('b.txt', fail('FILE_ERROR', '文件被占用'))

  const view = await mount(BatchRenameCommand, ctx.host)
  await pickFolderViaTop(view)
  await runAction(view, subItem(view, 'a.txt'), '执行批量重命名')
  assert.deepEqual(ls(pics), ['a_01.txt', 'b.txt', 'c_03.txt'])
  assert.equal(ctx.host.lastToast().style, 'FAILURE')
  assert.match(ctx.host.lastToast().title, /已重命名 2\/3 个，1 个失败/)
  assert.match(ctx.host.lastToast().message, /b\.txt：文件被占用/)
  assert.match(summary(view), /可撤销 2 项/)
  view.unmount()

  // 处理进行中点击清空列表必须被拒绝；执行中授权过期立即对同目录剩余项中断
  const root2 = makeWorkspace({ 'Pics/a.txt': 'A', 'Pics/b.txt': 'B', 'Pics/c.txt': 'C' })
  const pics2 = path.join(root2, 'Pics')
  const ctx2 = setupRenameHost({ folderDialog: [pics2] })
  const view2 = await mount(BatchRenameCommand, ctx2.host)
  await pickFolderViaTop(view2)

  let releaseMove
  const realMove = ctx2.host.ipc.filesystem_move_file_no_replace
  let callCount = 0
  ctx2.host.ipc.filesystem_move_file_no_replace = async (params) => {
    callCount++
    if (callCount === 1) {
      await new Promise((r) => { releaseMove = r })
      const res = await realMove(params)
      ctx2.revokeWriteGrants()
      return res
    }
    return realMove(params)
  }

  const running = view2.actions(subItem(view2, 'a.txt')).find((a) => a.props.title.startsWith('执行批量重命名')).props.onAction()
  await tick(5)
  // 处理进行中条目动作不提供「从列表移除」
  assert.equal(actionTitles(view2, subItem(view2, 'a.txt')).includes('从列表移除'), false)
  // 处理进行中触发清空列表应提示并拒绝清空
  await view2.run(subItem(view2, 'a.txt'), '清空列表')
  assert.match(ctx2.host.lastToast().title, /正在处理，完成后再清空/)
  assert.equal(subItems(view2).length, 3)

  releaseMove()
  await running
  await tick(20)
  assert.equal(ctx2.moves().length, 2)
  assert.deepEqual(ls(pics2), ['a_01.txt', 'b.txt', 'c.txt'])
  assert.match(ctx2.host.lastToast().title, /已重命名 1\/3 个，2 个失败/)

  // 并发连击只执行一轮
  const root3 = makeWorkspace({ 'Pics/a.txt': 'A', 'Pics/b.txt': 'B' })
  const pics3 = path.join(root3, 'Pics')
  const ctx3 = setupRenameHost({ folderDialog: [pics3] })
  const view3 = await mount(BatchRenameCommand, ctx3.host)
  await pickFolderViaTop(view3)
  const batchAct = view3.actions(subItem(view3, 'a.txt')).find((a) => a.props.title.startsWith('执行批量重命名'))
  await Promise.all([batchAct.props.onAction(), batchAct.props.onAction(), batchAct.props.onAction()])
  await tick(20)
  assert.equal(ctx3.moves().length, 2)
  assert.deepEqual(ls(pics3), ['a_01.txt', 'b_02.txt'])
  view2.unmount()
  view3.unmount()
})

test('单条改名、文件管理器定位、确认框取消、前缀/后缀空输入、非客户端环境与规则图标检查', async () => {
  const root = makeWorkspace({ 'Pics/a.txt': 'A', 'Pics/b.txt': 'B', 'Pics/c.txt': 'C' })
  const pics = path.join(root, 'Pics')
  const ctx = setupRenameHost({ openDialog: [[path.join(pics, 'a.txt'), path.join(pics, 'b.txt'), path.join(pics, 'c.txt')]] })
  const view = await mount(BatchRenameCommand, ctx.host)
  await pickFilesViaTop(view)

  // 批量确认取消时不弹授权框也不改文件
  ctx.host.setConfirm(false)
  await runAction(view, subItem(view, 'a.txt'), '执行批量重命名')
  assert.equal(ctx.host.confirms.at(-1).title, '重命名 3 个文件？')
  assert.equal(ctx.host.dialogCalls, undefined)
  assert.deepEqual(ls(pics), ['a.txt', 'b.txt', 'c.txt'])

  // 定位文件次动作未授权先授权再定位
  const revealTitle = `在${logic.fileManagerName(pics)}中显示`
  assert.equal(actionTitles(view, subItem(view, 'a.txt'))[1], revealTitle)
  ctx.host.setConfirm(true)
  ctx.queueFolderDialog(pics)
  await runAction(view, subItem(view, 'a.txt'), revealTitle)
  assert.deepEqual(ctx.revealed, [path.join(pics, 'a.txt')])

  // 单条改名免确认；无变更或冲突直接拒绝
  await view.search('b->a')
  await runAction(view, subItem(view, 'b.txt'), '只改名此文件')
  assert.match(ctx.host.lastToast().title, /无法改名：与已有文件同名/)
  await runAction(view, subItem(view, 'a.txt'), '只改名此文件')
  assert.match(ctx.host.lastToast().title, /不需要改名/)

  await view.search('')
  const confirmsBefore = ctx.host.confirms.length
  await runAction(view, subItem(view, 'c.txt'), '只改名此文件')
  assert.equal(ctx.host.confirms.length, confirmsBefore)
  assert.deepEqual(ls(pics), ['a.txt', 'b.txt', 'c_03.txt'])

  // 前缀 / 后缀空输入提示
  for (const id of ['prefix', 'suffix']) {
    view.items().find((i) => i.props.id === `nav-rule-${id}`).props.onSelect()
    await tick(10)
    assert.match(summary(view), /待改名 0 项/)
    assert.match(summary(view), id === 'prefix' ? /在搜索框输入前缀/ : /在搜索框输入后缀/)
  }

  // 规则行图标与选中标签检查
  const ruleItems = view.items().filter((i) => String(i.props.id).startsWith('nav-rule-'))
  for (const item of ruleItems) assert.equal(item.props.icon, 'pencil')
  assert.equal(ruleItems.filter((i) => (i.props.accessories || []).length > 0).length, 1)
  view.unmount()

  // 非客户端环境只提示需要在 ZTools 客户端中使用
  const hostOff = createHost()
  hostOff.reset()
  const saved = globalThis.__ztoolsElectron
  delete globalThis.__ztoolsElectron
  try {
    const offView = await mount(BatchRenameCommand, hostOff)
    await tick(10)
    assert.equal(offView.items().length, 1)
    assert.equal(offView.items()[0].props.title, '需要在 ZTools 客户端中使用')
    assert.equal(offView.tree().props.subList, undefined)
    offView.unmount()
  } finally {
    globalThis.__ztoolsElectron = saved
  }
})
