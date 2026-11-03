// 改名闭环集成测试：模拟宿主真实的按窗口授权模型（只认选目录对话框签发的授权）、move 参数校验与「move 会静默覆盖已有文件」的行为，
// 在临时目录里真实改名，覆盖授权、取消、选错目录、部分失败、授权失效、并发、撤销、定位、隐藏文件、排序、截断与同名冲突。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHost, installDirectoryHost, mount, tick } from '../../shared/test-harness.mjs'
import * as logic from '../dist/logic.js'
import BatchRenameCommand from '../dist/index.js'

const roots = []
test.after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true })
})

function makeDir(files, { dirs = [] } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'batch-rename-op-')))
  roots.push(root)
  const pictures = path.join(root, 'Pictures')
  fs.mkdirSync(pictures)
  for (const d of dirs) fs.mkdirSync(path.join(pictures, d), { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(pictures, name)), { recursive: true })
    fs.writeFileSync(path.join(pictures, name), content)
  }
  return { root, pictures }
}

const fail = (code, message) => Object.assign(new Error(message), { code })

/**
 * 按宿主真实行为搭建 IPC：
 * - filesystem_* / shell_show_item_in_folder 只放行选目录对话框授权过的目录（递归）
 * - filesystem_move_file_no_replace 只接受 sourcePath / destPath，多余字段 INVALID_REQUEST；目标已存在时直接覆盖（与宿主 fs.rename 一致）
 */
async function setupHost(dirs, { dialog = [] } = {}) {
  const host = createHost()
  host.reset()
  await installDirectoryHost(host, { authorized: [] })
  const grants = []
  const dialogQueue = [...dialog]
  const revealed = []
  const moveFaults = new Map()
  const isGranted = (p) => grants.some((g) => p === g || p.startsWith(g + path.sep))
  const requireGrant = (...paths) => {
    for (const p of paths) if (!isGranted(p)) throw fail('PERMISSION_DENIED', '路径未由当前窗口授权')
  }
  host.ipc.system_get_path = async ({ name }) => dirs[name] || ''
  host.ipc.window_show_select_folder_dialog = async (params) => {
    host.dialogCalls = [...(host.dialogCalls || []), params]
    const next = dialogQueue.length > 0 ? dialogQueue.shift() : null
    if (!next) return { canceled: true }
    grants.push(next)
    return { canceled: false, folderPath: next }
  }
  host.ipc.filesystem_get_directory_contents = async ({ path: target }) => {
    requireGrant(target)
    if (!fs.existsSync(target)) throw fail('FILE_NOT_FOUND', '目录不存在')
    return {
      success: true,
      writeAuthorized: true,
      files: fs.readdirSync(target, { withFileTypes: true }).map((ent) => {
        const st = fs.statSync(path.join(target, ent.name))
        return { name: ent.name, size: ent.isDirectory() ? 0 : st.size, isDirectory: ent.isDirectory(), lastModified: st.mtime.toLocaleString(), attributes: 32 }
      })
    }
  }
  host.ipc.filesystem_file_exists = async ({ path: target }) => {
    requireGrant(target)
    return { success: true, exists: fs.existsSync(target) && fs.statSync(target).isFile() }
  }
  host.ipc.filesystem_move_file_no_replace = async (params) => {
    const extra = Object.keys(params).filter((k) => k !== 'sourcePath' && k !== 'destPath')
    if (extra.length > 0) throw fail('INVALID_REQUEST', '方法参数包含未知字段')
    requireGrant(params.sourcePath, params.destPath)
    const fault = moveFaults.get(path.basename(params.sourcePath))
    if (fault) throw fault
    try { fs.linkSync(params.sourcePath, params.destPath) } catch (error) {
      if (error.code === 'EEXIST') throw fail('FILE_ALREADY_EXISTS', '目标文件已存在，未覆盖')
      throw error
    }
    fs.unlinkSync(params.sourcePath)
    return { success: true }
  }
  host.ipc.shell_show_item_in_folder = async ({ fullPath }) => {
    requireGrant(fullPath)
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
    queueDialog: (p) => dialogQueue.push(p),
    revokeGrants: () => grants.splice(0, grants.length),
    moves: () => host.ipcCalls.filter(([m]) => m === 'filesystem_move_file_no_replace').map(([, p]) => p)
  }
}

async function openPictures(host) {
  const view = await mount(BatchRenameCommand, host)
  await tick(20)
  await view.dropdown('pictures')
  await tick(20)
  return view
}

const summary = (view) => view.tree().props.filterBar.summaryText
const subItems = (view) => view.tree().props.subList.items
const subItem = (view, name) => {
  const found = subItems(view).find((i) => i.props.title === name)
  if (!found) throw new Error(`找不到 ${name}；现有：${subItems(view).map((i) => i.props.title).join(', ')}`)
  return found
}
const actionTitles = (view, node) => view.actions(node).map((a) => a.props.title)
async function runAction(view, node, prefix) {
  const action = view.actions(node).find((a) => a.props.title.startsWith(prefix))
  if (!action) throw new Error(`找不到动作「${prefix}」；现有：${actionTitles(view, node).join(' | ')}`)
  await action.props.onAction?.()
  await tick(20)
}
const ls = (dir) => fs.readdirSync(dir).sort()

test('改名闭环：未授权时先弹选目录对话框取得授权，再以 destPath 真实改名；撤销后磁盘完全还原', async () => {
  const { root, pictures } = makeDir({ 'b.txt': 'B', 'a.txt': 'A' })
  const ctx = await setupHost({ pictures, home: root }, { dialog: [pictures] })
  const view = await openPictures(ctx.host)
  assert.match(summary(view), /执行时需授权文件夹/)

  await runAction(view, subItem(view, 'a.txt'), '执行批量重命名')
  assert.equal(ctx.host.dialogCalls.length, 1)
  assert.equal(ctx.host.dialogCalls[0].defaultPath, pictures)
  for (const p of ctx.moves()) assert.deepEqual(Object.keys(p).sort(), ['destPath', 'sourcePath'])
  assert.deepEqual(ls(pictures), ['a_01.txt', 'b_02.txt'])
  assert.equal(fs.readFileSync(path.join(pictures, 'a_01.txt'), 'utf8'), 'A')
  assert.equal(ctx.host.lastToast().style, 'SUCCESS')
  assert.match(ctx.host.lastToast().title, /已重命名 2 个文件/)
  // 状态条常驻摘要，不被「已加载…」覆盖；授权后不再提示需授权
  assert.match(summary(view), /规则: 阿拉伯序号.*可撤销 2 项/)
  assert.doesNotMatch(summary(view), /执行时需授权/)

  // 第二次执行不再弹授权框（授权仍有效）
  const item = subItem(view, 'a_01.txt')
  assert.ok(actionTitles(view, item).some((t) => t.startsWith('撤销上一次重命名')))
  await runAction(view, item, '撤销上一次重命名')
  assert.deepEqual(ls(pictures), ['a.txt', 'b.txt'])
  assert.equal(ctx.host.dialogCalls.length, 1)
  assert.match(ctx.host.lastToast().title, /已撤销 2 个/)
  assert.ok(!actionTitles(view, subItem(view, 'a.txt')).some((t) => t.startsWith('撤销')), '撤销后不再提供撤销')
  view.unmount()
})

test('改名闭环：取消授权对话框时不改任何文件并提示；选了别的文件夹时切换过去且不执行', async () => {
  const { root, pictures } = makeDir({ 'a.txt': 'A' })
  const other = path.join(root, 'Other')
  fs.mkdirSync(other)
  fs.writeFileSync(path.join(other, 'x.txt'), 'X')
  const ctx = await setupHost({ pictures, home: root })
  const view = await openPictures(ctx.host)

  await runAction(view, subItem(view, 'a.txt'), '执行批量重命名')
  assert.equal(ctx.moves().length, 0)
  assert.deepEqual(ls(pictures), ['a.txt'])
  assert.equal(ctx.host.lastToast().style, 'FAILURE')
  assert.match(ctx.host.lastToast().title, /已取消授权/)

  ctx.queueDialog(other)
  await runAction(view, subItem(view, 'a.txt'), '执行批量重命名')
  assert.equal(ctx.moves().length, 0)
  assert.deepEqual(ls(pictures), ['a.txt'])
  assert.match(ctx.host.lastToast().title, /已切换到「Other」/)
  assert.deepEqual(subItems(view).map((i) => i.props.title), ['x.txt'])
  assert.equal(view.tree().props.searchBarAccessory.props.value, 'custom')
  view.unmount()
})

test('改名闭环：部分失败逐条给出原因、只为成功项提供撤销；全部失败时不提「可撤销」', async () => {
  const { root, pictures } = makeDir({ 'a.txt': 'A', 'b.txt': 'B', 'c.txt': 'C' })
  const ctx = await setupHost({ pictures, home: root }, { dialog: [pictures] })
  ctx.moveFaults.set('b.txt', fail('FILE_ERROR', '文件被占用'))
  const view = await openPictures(ctx.host)
  await runAction(view, subItem(view, 'a.txt'), '执行批量重命名')
  assert.deepEqual(ls(pictures), ['a_01.txt', 'b.txt', 'c_03.txt'])
  const t = ctx.host.lastToast()
  assert.equal(t.style, 'FAILURE')
  assert.match(t.title, /已重命名 2\/3 个，1 个失败/)
  assert.match(t.message, /b\.txt：文件被占用/)
  assert.match(summary(view), /可撤销 2 项/)

  // 新开一个实例：全部失败
  view.unmount()
  const { root: root2, pictures: pics2 } = makeDir({ 'a.txt': 'A' })
  const ctx2 = await setupHost({ pictures: pics2, home: root2 }, { dialog: [pics2] })
  ctx2.moveFaults.set('a.txt', fail('FILE_ERROR', '磁盘只读'))
  const view2 = await openPictures(ctx2.host)
  await runAction(view2, subItem(view2, 'a.txt'), '执行批量重命名')
  assert.match(ctx2.host.lastToast().title, /重命名失败（0\/1）/)
  assert.doesNotMatch(ctx2.host.lastToast().message, /撤销/)
  assert.doesNotMatch(summary(view2), /可撤销/)
  assert.ok(!actionTitles(view2, subItem(view2, 'a.txt')).some((x) => x.startsWith('撤销')))
  view2.unmount()
})

test('改名闭环：执行中授权失效（超时）立即停止并如实报告剩余未执行项；并发触发只执行一次', async () => {
  const { root, pictures } = makeDir({ 'a.txt': 'A', 'b.txt': 'B', 'c.txt': 'C' })
  const ctx = await setupHost({ pictures, home: root }, { dialog: [pictures] })
  const view = await openPictures(ctx.host)
  const realMove = ctx.host.ipc.filesystem_move_file_no_replace
  ctx.host.ipc.filesystem_move_file_no_replace = async (params) => {
    const res = await realMove(params)
    ctx.revokeGrants() // 第一次成功后授权过期
    return res
  }
  await runAction(view, subItem(view, 'a.txt'), '执行批量重命名')
  assert.equal(ctx.moves().length, 2) // 第二次调用由宿主拒绝，之后停止
  assert.deepEqual(ls(pictures), ['a_01.txt', 'b.txt', 'c.txt'])
  assert.match(ctx.host.lastToast().title, /已重命名 1\/3 个，2 个失败/)

  // 并发：同一帧连续触发两次，只执行一轮
  const { root: r2, pictures: p2 } = makeDir({ 'a.txt': 'A', 'b.txt': 'B' })
  const ctx2 = await setupHost({ pictures: p2, home: r2 }, { dialog: [p2] })
  const view2 = await openPictures(ctx2.host)
  const action = view2.actions(subItem(view2, 'a.txt')).find((a) => a.props.title.startsWith('执行批量重命名'))
  await Promise.all([action.props.onAction(), action.props.onAction(), action.props.onAction()])
  await tick(20)
  assert.equal(ctx2.host.dialogCalls.length, 1)
  assert.equal(ctx2.moves().length, 2)
  assert.deepEqual(ls(p2), ['a_01.txt', 'b_02.txt'])
  view.unmount()
  view2.unmount()
})

test('单条改名：只改当前文件；规则下无需改名或存在冲突时拒绝并说明原因', async () => {
  const { root, pictures } = makeDir({ 'a.txt': 'A', 'b.txt': 'B', 'c.txt': 'C' })
  const ctx = await setupHost({ pictures, home: root }, { dialog: [pictures] })
  const view = await openPictures(ctx.host)
  // b->a：b.txt 会改成已存在的 a.txt，属于冲突；a.txt 本身不需要改名
  await view.search('b->a')
  await runAction(view, subItem(view, 'b.txt'), '只改名此文件')
  assert.match(ctx.host.lastToast().title, /无法改名：与已有文件同名/)
  await runAction(view, subItem(view, 'a.txt'), '只改名此文件')
  assert.match(ctx.host.lastToast().title, /不需要改名/)
  assert.equal(ctx.moves().length, 0)
  assert.equal(ctx.host.dialogCalls, undefined, '被拒绝的改名不应弹授权框')

  await view.search('')
  await runAction(view, subItem(view, 'c.txt'), '只改名此文件')
  assert.deepEqual(ls(pictures), ['a.txt', 'b.txt', 'c_03.txt'])
  assert.match(ctx.host.lastToast().title, /已将 c\.txt 改名为 c_03\.txt/)
  view.unmount()
})

test('定位文件：次动作使用当前平台的文件管理器，未授权时先取得授权再定位；取消或失败时有提示，不回退为打开文件', async () => {
  const { root, pictures } = makeDir({ 'a.txt': 'A' })
  const ctx = await setupHost({ pictures, home: root })
  const view = await openPictures(ctx.host)
  const revealTitle = `在${logic.fileManagerName(pictures)}中显示`
  const titles = actionTitles(view, subItem(view, 'a.txt'))
  assert.equal(titles[1], revealTitle)
  assert.equal(titles.filter((t) => /显示|定位|资源管理器/.test(t)).length, 1, '定位动作只出现一次')
  assert.ok(titles.every((t) => !/Ctrl|Enter/.test(t)))

  await runAction(view, subItem(view, 'a.txt'), revealTitle)
  assert.equal(ctx.revealed.length, 0)
  assert.equal(ctx.host.lastToast().style, 'FAILURE')

  ctx.queueDialog(pictures)
  await runAction(view, subItem(view, 'a.txt'), revealTitle)
  assert.deepEqual(ctx.revealed, [path.join(pictures, 'a.txt')])

  ctx.host.ipc.shell_show_item_in_folder = async () => {
    throw fail('FILE_ERROR', '文件已被移走')
  }
  await runAction(view, subItem(view, 'a.txt'), revealTitle)
  assert.equal(ctx.host.lastToast().title, `无法${revealTitle}`)
  assert.match(ctx.host.lastToast().message, /文件已被移走/)

  // 有撤销记录时次动作仍是定位，撤销进入动作面板
  ctx.queueDialog(pictures)
  await runAction(view, subItem(view, 'a.txt'), '执行批量重命名')
  const after = actionTitles(view, subItem(view, 'a_01.txt'))
  assert.equal(after[1], revealTitle)
  assert.ok(after.slice(2).some((t) => t.startsWith('撤销上一次重命名')))

  assert.equal(logic.fileManagerName('C:\\Users\\a\\Pictures'), '资源管理器')
  assert.equal(logic.fileManagerName('/Users/a/Pictures'), '访达')
  view.unmount()
})

test('列表内容：隐藏与系统元数据文件、子目录不列出；按文件名自然排序编号；超过上限如实提示', async () => {
  const { root, pictures } = makeDir(
    {
      '.DS_Store': Buffer.alloc(6000),
      '.localized': '',
      '._seq_1.txt': 'x',
      ...(process.platform === 'win32' ? {} : { 'Icon\r': '' }),
      'desktop.ini': '',
      'seq_10.txt': 's10',
      'seq_2.txt': 's2',
      'seq_1.txt': 's1',
      'big.bin': Buffer.alloc(30000),
      'sub/nested.txt': 'n'
    }
  )
  const ctx = await setupHost({ pictures, home: root })
  const view = await openPictures(ctx.host)
  const titles = subItems(view).map((i) => i.props.title)
  assert.deepEqual(titles, ['big.bin', 'seq_1.txt', 'seq_2.txt', 'seq_10.txt'])
  assert.deepEqual(
    subItems(view).map((i) => i.props.subtitle),
    ['-> big_01.bin', '-> seq_1_02.txt', '-> seq_2_03.txt', '-> seq_10_04.txt']
  )
  assert.ok(logic.isHiddenOrSystemFile('Icon\r'))
  assert.ok(logic.isHiddenOrSystemFile('Thumbs.db'))
  assert.ok(!logic.isHiddenOrSystemFile('photo.jpg'))
  view.unmount()

  // 超过上限：如实提示「仅显示前 N 个（共 M 个）」
  const many = {}
  for (let i = 0; i < logic.MAX_RENAME_FILES + 3; i++) many[`f${i}.txt`] = ''
  const { root: r2, pictures: p2 } = makeDir(many)
  const ctx2 = await setupHost({ pictures: p2, home: r2 }, { dialog: [p2] })
  const listing = await logic.fetchDirectoryFiles(p2)
  assert.equal(listing.authorized, false)
  await ctx2.host.ipc.window_show_select_folder_dialog({})
  const full = await logic.fetchDirectoryFiles(p2)
  assert.equal(full.authorized, true)
  assert.equal(full.files.length, logic.MAX_RENAME_FILES)
  assert.equal(full.totalFiles, logic.MAX_RENAME_FILES + 3)
  assert.equal(full.truncated, true)
  assert.equal(full.files[0].name, 'f0.txt')
  assert.equal(full.files[2].name, 'f2.txt', '自然排序：f2 在 f10 之前')
  const view2 = await openPictures(ctx2.host)
  assert.match(summary(view2), new RegExp(`仅显示前 ${logic.MAX_RENAME_FILES} 个（共 ${logic.MAX_RENAME_FILES + 3} 个）`))
  view2.unmount()
})

test('只读预览不完整时：授权后读到的完整清单与预览不同则不执行，先让用户确认', async () => {
  const { root, pictures } = makeDir({ 'b.txt': 'B' })
  const ctx = await setupHost({ pictures, home: root }, { dialog: [pictures] })
  const view = await openPictures(ctx.host)
  assert.deepEqual(subItems(view).map((i) => i.props.title), ['b.txt'])
  // 宿主扫描漏掉的文件（例如被 Top-N 截掉）在授权后出现，序号会变
  fs.writeFileSync(path.join(pictures, 'a.txt'), 'A')
  await runAction(view, subItem(view, 'b.txt'), '执行批量重命名')
  assert.equal(ctx.moves().length, 0)
  assert.deepEqual(ls(pictures), ['a.txt', 'b.txt'])
  assert.match(ctx.host.lastToast().title, /预览有变化/)
  assert.deepEqual(subItems(view).map((i) => i.props.subtitle), ['-> a_01.txt', '-> b_02.txt'])
  // 用户确认后再次执行：已授权，直接改名
  await runAction(view, subItem(view, 'b.txt'), '执行批量重命名')
  assert.deepEqual(ls(pictures), ['a_01.txt', 'b_02.txt'])
  view.unmount()
})

test('同名冲突：冲突标在会改名的一方且与列表顺序无关；目录与重复新名同样拦截；执行前磁盘复查绝不覆盖已有文件', async () => {
  const files = (names) => names.map((name) => ({ name, fullPath: `/d/${name}`, parentDir: '/d', extension: '', sizeBytes: 0, lastModifiedMs: 0 }))
  const rule = { type: 'replace', find: 'a_01', replace: 'a' }
  for (const order of [['a.txt', 'a_01.txt'], ['a_01.txt', 'a.txt']]) {
    const preview = logic.buildRenamePreview(files(order), rule, order)
    const byName = Object.fromEntries(preview.map((p) => [p.name, p]))
    assert.equal(byName['a_01.txt'].conflict, true, `顺序 ${order}`)
    assert.equal(byName['a_01.txt'].conflictReason, 'exists')
    assert.equal(byName['a.txt'].conflict, false)
    assert.equal(byName['a.txt'].changed, false)
  }
  // 大小写不敏感：A.TXT 已存在
  const ci = logic.buildRenamePreview(files(['x.txt']), { type: 'replace', find: 'x', replace: 'A' }, ['x.txt', 'A.TXT'])
  assert.equal(ci[0].conflict, true)
  // 与子目录同名
  const dir = logic.buildRenamePreview(files(['p']), { type: 'replace', find: 'p', replace: 'sub' }, ['p', 'sub'])
  assert.equal(dir[0].newName, 'sub')
  assert.equal(dir[0].conflict, true)
  // 多个文件改成同一个新名：全部标冲突
  const dup = logic.buildRenamePreview(files(['File 1.txt', 'file-1.txt', 'ok.txt']), { type: 'snake_case' }, ['File 1.txt', 'file-1.txt', 'ok.txt'])
  assert.deepEqual(dup.map((d) => [d.name, d.conflict, d.conflictReason]), [
    ['File 1.txt', true, 'duplicate'],
    ['file-1.txt', true, 'duplicate'],
    ['ok.txt', false, undefined]
  ])
  // 仅大小写变化不算冲突
  const caseOnly = logic.buildRenamePreview(files(['Photo.JPG']), { type: 'case', caseMode: 'lower' }, ['Photo.JPG'])
  assert.equal(caseOnly[0].conflict, false)
  // 非法新名
  const bad = logic.buildRenamePreview(files(['a.txt']), { type: 'replace', find: 'a', replace: '../x' }, ['a.txt'])
  assert.equal(bad[0].conflictReason, 'invalid-name')

  // 界面：冲突项红色标签，未改名的已有文件保持不变；冲突项不执行
  const { root, pictures } = makeDir({ 'a.txt': 'A-original', 'a_01.txt': 'A01', 'c.txt': 'C' })
  const ctx = await setupHost({ pictures, home: root }, { dialog: [pictures] })
  await ctx.host.ipc.window_show_select_folder_dialog({}) // 先授权，下面的竞态用例才会走到执行前的磁盘复查
  const view = await openPictures(ctx.host)
  await view.search('a_01->a')
  const conflictTag = subItem(view, 'a_01.txt').props.accessories.find((a) => a.tag)?.tag
  assert.deepEqual(conflictTag, { value: '同名冲突', color: 'red' })
  assert.equal(subItem(view, 'a.txt').props.accessories.find((a) => a.tag).tag.value, '保持不变')
  assert.match(summary(view), /待改名 0 项 · 1 项同名冲突（不会执行）/)
  await runAction(view, subItem(view, 'a.txt'), '执行批量重命名')
  assert.equal(ctx.moves().length, 0)
  assert.equal(fs.readFileSync(path.join(pictures, 'a.txt'), 'utf8'), 'A-original')

  // 预览之后磁盘上冒出同名文件（竞态）：执行前复查，跳过而不覆盖
  await view.search('c->d')
  fs.writeFileSync(path.join(pictures, 'd.txt'), 'D-created-later')
  await runAction(view, subItem(view, 'c.txt'), '执行批量重命名')
  assert.equal(fs.readFileSync(path.join(pictures, 'd.txt'), 'utf8'), 'D-created-later')
  assert.ok(fs.existsSync(path.join(pictures, 'c.txt')))
  assert.match(ctx.host.lastToast().message, /目标文件已存在/)

  // 旧宿主没有安全接口时拒绝改名，不回退到可能覆盖目标的旧接口
  ctx.host.ipc.filesystem_move_file_no_replace = async () => {
    throw fail('UNKNOWN_METHOD', '请更新客户端')
  }
  ctx.host.ipc.filesystem_move_file = async () => { throw new Error('不应调用旧移动接口') }
  const res = await logic.executeRealFileRename(path.join(pictures, 'c.txt'), 'e.txt')
  assert.equal(res.ok, false)
  assert.ok(fs.existsSync(path.join(pictures, 'c.txt')))
  view.unmount()
})

test('撤销：原文件名已被占用时跳过并保留在撤销栈，不覆盖新文件', async () => {
  const { root, pictures } = makeDir({ 'a.txt': 'A' })
  const ctx = await setupHost({ pictures, home: root }, { dialog: [pictures] })
  const view = await openPictures(ctx.host)
  await runAction(view, subItem(view, 'a.txt'), '执行批量重命名')
  assert.deepEqual(ls(pictures), ['a_01.txt'])
  fs.writeFileSync(path.join(pictures, 'a.txt'), 'NEW')
  await runAction(view, subItem(view, 'a_01.txt'), '撤销上一次重命名')
  assert.equal(fs.readFileSync(path.join(pictures, 'a.txt'), 'utf8'), 'NEW')
  assert.match(ctx.host.lastToast().title, /已撤销 0 个，1 个未能还原/)
  assert.match(summary(view), /可撤销 1 项/)
  view.unmount()
})

test('批量改名前必须确认：确认框写明数量与示例，取消时不弹授权框、不改任何文件', async () => {
  const { root, pictures } = makeDir({ 'a.txt': 'A', 'b.txt': 'B' })
  const ctx = await setupHost({ pictures, home: root }, { dialog: [pictures] })
  const view = await openPictures(ctx.host)
  ctx.host.setConfirm(false)
  await runAction(view, subItem(view, 'a.txt'), '执行批量重命名')
  const confirm = ctx.host.confirms.at(-1)
  assert.equal(confirm.title, '重命名 2 个文件？')
  assert.match(confirm.message, /a\.txt -> a_01\.txt/)
  assert.match(confirm.message, /不会覆盖已有文件/)
  assert.equal(ctx.host.dialogCalls, undefined)
  assert.equal(ctx.moves().length, 0)
  assert.deepEqual(ls(pictures), ['a.txt', 'b.txt'])

  // 单条改名是明确选择的动作，不再弹确认
  ctx.host.setConfirm(true)
  const before = ctx.host.confirms.length
  await runAction(view, subItem(view, 'b.txt'), '只改名此文件')
  assert.equal(ctx.host.confirms.length, before)
  assert.deepEqual(ls(pictures), ['a.txt', 'b_02.txt'])
  view.unmount()
})

test('[边界] 前缀 / 后缀规则没输入内容时不改名，不使用内置示例值', async () => {
  const { root, pictures } = makeDir({ 'a.txt': 'A' })
  const ctx = await setupHost({ pictures, home: root }, { dialog: [pictures] })
  const view = await openPictures(ctx.host)
  for (const id of ['prefix', 'suffix']) {
    view.items().find((i) => i.props.id === `nav-rule-${id}`).props.onSelect()
    await tick(10)
    const item = subItem(view, 'a.txt')
    assert.equal(item.props.subtitle, '-> a.txt')
    assert.match(summary(view), /待改名 0 项/)
    assert.match(summary(view), id === 'prefix' ? /在搜索框输入前缀/ : /在搜索框输入后缀/)
    assert.equal(view.text().includes('ZTools_'), false)
  }
  await view.search('2026_')
  view.items().find((i) => i.props.id === 'nav-rule-prefix').props.onSelect()
  await tick(10)
  assert.equal(subItem(view, 'a.txt').props.subtitle, '-> 2026_a.txt')
  view.unmount()
})

test('不在客户端里运行：只显示“需要在 ZTools 客户端中使用”，不显示示例文件', async () => {
  const host = createHost()
  host.reset()
  const saved = globalThis.__ztoolsElectron
  delete globalThis.__ztoolsElectron
  try {
    const view = await mount(BatchRenameCommand, host)
    await tick(10)
    const items = view.items()
    assert.equal(items.length, 1)
    assert.equal(items[0].props.title, '需要在 ZTools 客户端中使用')
    assert.equal(view.tree().props.subList, undefined)
    assert.equal(view.text().includes('IMG_2026'), false)
    view.unmount()
  } finally {
    globalThis.__ztoolsElectron = saved
  }
})

test('规则行只给当前生效的规则加标签，图标用编辑语义而非文件', async () => {
  const { root, pictures } = makeDir({ 'a.txt': 'A' })
  const ctx = await setupHost({ pictures, home: root }, { dialog: [pictures] })
  const view = await openPictures(ctx.host)
  const ruleItems = () => view.items().filter((i) => String(i.props.id).startsWith('nav-rule-'))
  const tagged = () => ruleItems().filter((i) => (i.props.accessories || []).length > 0)
  assert.ok(ruleItems().length > 1)
  assert.equal(tagged().length, 1)
  assert.equal(tagged()[0].props.accessories[0].tag.value, '当前生效')
  assert.equal(view.text().includes('规则预设'), false)
  for (const item of ruleItems()) assert.equal(item.props.icon, 'pencil')
  view.items().find((i) => i.props.id === 'nav-rule-suffix').props.onSelect()
  await tick(10)
  assert.equal(tagged().length, 1)
  assert.equal(tagged()[0].props.id, 'nav-rule-suffix')
  view.unmount()
})
