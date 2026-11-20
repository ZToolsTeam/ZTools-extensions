// 独立窗口带状态与写授权交接测试（g 项）：
// 交接 paths 时除列表文件路径外，必须把已获得写授权的文件夹路径一并列入交接 paths，
// 确保弹出独立窗口后仍能拿到目录读写授权以重命名产生新文件名；未授权文件夹保持只读预览并在执行前按目录补授权。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { renderDeclarativeRoot } from '@ztools/declarative-ui'
import { createHost, tick } from '../../shared/test-harness.mjs'
import BatchRenameCommand from '../dist/index.js'

const roots = []
test.after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true })
})

function descriptors(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => descriptors(n, out))
  else if (node && typeof node === 'object') {
    if (typeof node.type === 'string') out.push(node)
    for (const v of [node.children, ...Object.values(node.props || {})]) {
      if (v && typeof v === 'object') descriptors(Array.isArray(v) ? v : v.type ? v : v.items, out)
    }
  }
  return out
}

async function openWindow(Command, handoffSeed) {
  const root = renderDeclarativeRoot(() => Command(), handoffSeed === undefined ? undefined : { handoffSeed })
  await tick(20)
  const win = {
    tree: () => root.forceRender(),
    all: (type) => descriptors(win.tree()).filter((n) => n.type === type),
    popout() {
      const { entries, rejected } = root.collectPopoutState()
      const values = Object.fromEntries(entries.map((e) => [e.key, e.value]))
      const seed = JSON.parse(JSON.stringify(values))
      assert.deepEqual(seed, values, '交接的值必须是纯 JSON，否则宿主会整项拒绝')
      return { seed, rejected, paths: entries.flatMap((e) => e.paths) }
    },
    unmount: () => root.unmount()
  }
  return win
}

function makeDirs(spec) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'batch-rename-popout-')))
  roots.push(root)
  for (const [rel, content] of Object.entries(spec)) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return root
}

const fail = (code, message) => Object.assign(new Error(message), { code })
const ls = (dir) => fs.readdirSync(dir).sort()

/**
 * 模拟宿主 FileSystemService.transferGrants：
 * - select_folder_dialog 签发 { path, recursive: true, write: true }
 * - open_dialog 签发精确只读 { path, recursive: false, write: false }
 * - drop 文件夹可签发 { path, recursive: true, write: false }
 * - popoutTo(paths) 只把旧窗口对 paths 已有授权按递归与写属性复制给新窗口，绝对不会凭空扩大范围！
 */
function setupPopoutHost({ folderDialog = [], openDialog = [], readOnlyDirs = [] } = {}) {
  const host = createHost()
  host.reset()
  let grants = readOnlyDirs.map((d) => ({ path: d, recursive: true, write: false }))
  const folderQueue = [...folderDialog]
  const openQueue = [...openDialog]

  const covers = (g, p, needWrite) => {
    if (needWrite && !g.write) return false
    return p === g.path || (g.recursive && p.startsWith(g.path + path.sep))
  }
  const hasGrant = (p, needWrite) => grants.some((g) => covers(g, p, needWrite))
  const requireGrant = (needWrite, ...ps) => {
    for (const p of ps) if (!hasGrant(p, needWrite)) throw fail('PERMISSION_DENIED', '路径未由当前窗口授权')
  }

  host.ipc.window_show_select_folder_dialog = async (params) => {
    host.dialogCalls = [...(host.dialogCalls || []), params]
    const next = folderQueue.shift()
    if (!next) return { canceled: true }
    grants.push({ path: next, recursive: true, write: true })
    return { canceled: false, folderPath: next }
  }
  host.ipc.window_show_open_dialog = async () => {
    const next = openQueue.shift()
    if (!next) return { canceled: true }
    for (const p of next) grants.push({ path: p, recursive: false, write: false })
    return { canceled: false, filePaths: next }
  }
  host.ipc.filesystem_get_file_size = async ({ path: target }) => {
    requireGrant(false, target)
    return { success: true, size: fs.statSync(target).size }
  }
  host.ipc.filesystem_get_directory_contents = async ({ path: target }) => {
    requireGrant(false, target)
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
  host.ipc.filesystem_move_file_no_replace = async ({ sourcePath, destPath }) => {
    requireGrant(true, sourcePath, destPath)
    fs.linkSync(sourcePath, destPath)
    fs.unlinkSync(sourcePath)
    return { success: true }
  }

  return {
    host,
    grants: () => grants,
    queueFolderDialog: (p) => folderQueue.push(p),
    popoutTo(paths) {
      const next = []
      for (const p of paths) {
        if (typeof p !== 'string' || !path.isAbsolute(p) || !fs.existsSync(p)) continue
        const real = fs.realpathSync(p)
        const isDir = fs.statSync(real).isDirectory()
        for (const g of grants.filter((g) => covers(g, real, false))) {
          next.push({
            path: real,
            recursive: g.recursive && isDir,
            write: g.write
          })
        }
      }
      grants = next
      host.dialogCalls = undefined
      host.ipcCalls.length = 0
    },
    moves: () => host.ipcCalls.filter(([m]) => m === 'filesystem_move_file_no_replace').map(([, p]) => p)
  }
}

const subItems = (win) => win.tree().props.subList.items
const subItem = (win, name) => {
  const found = subItems(win).find((i) => i.props.title === name)
  if (!found) throw new Error(`找不到 ${name}；现有：${subItems(win).map((i) => i.props.title).join(', ')}`)
  return found
}
const tagValues = (item) => (item.props.accessories || []).map((a) => a.tag?.value).filter(Boolean)
const checkedNames = (win) => subItems(win).filter((i) => i.props.checked).map((i) => i.props.title).sort()
const summary = (win) => win.tree().props.filterBar.summaryText
async function runOn(win, node, prefix) {
  const action = descriptors(node.props.actions).find((n) => n.type === 'Action' && n.props.title.startsWith(prefix))
  if (!action) throw new Error(`找不到动作「${prefix}」`)
  await action.props.onAction()
  await tick(20)
}
async function pickFolder(win) {
  await win.tree().props.filterBar.actions.find((a) => a.id === 'pick-folder').onAction()
  await tick(20)
}
async function pickFiles(win) {
  await win.tree().props.filterBar.actions.find((a) => a.id === 'pick-files').onAction()
  await tick(20)
}
async function selectRule(win, id) {
  win.all('List.Item').find((i) => i.props.id === `nav-rule-${id}`).props.onSelect()
  await tick(20)
}

test('g 项弹出闭环：交接 paths 同时包含列表文件与已获写授权的文件夹，新窗口免授权直接改名新文件名', async () => {
  const root = makeDirs({
    'Photos/a.txt': 'A',
    'Photos/b.txt': 'B',
    'Photos/c.txt': 'C',
    'Extra/doc.txt': 'D'
  })
  const photos = path.join(root, 'Photos')
  const extra = path.join(root, 'Extra')
  const ctx = setupPopoutHost({
    folderDialog: [photos],
    openDialog: [[path.join(extra, 'doc.txt')]]
  })

  const old = await openWindow(BatchRenameCommand)
  await pickFolder(old)
  await pickFiles(old)
  await selectRule(old, 'number_roman')
  subItem(old, 'c.txt').props.onToggleCheck()
  subItem(old, 'doc.txt').props.onToggleCheck()
  await tick(10)
  assert.deepEqual(checkedNames(old), ['a.txt', 'b.txt'])

  const { seed, rejected, paths } = old.popout()
  assert.deepEqual(rejected, [])
  assert.equal(seed.ruleType, 'number_roman')
  assert.deepEqual(seed.authorizedDirs, [photos])
  assert.equal(seed.files.length, 4)
  assert.deepEqual(seed.checkedPaths, [path.join(photos, 'a.txt'), path.join(photos, 'b.txt')])
  assert.ok(!('undoStack' in seed), '撤销记录不带')

  // 关键断言：交接 paths 必须包含 photos 文件夹本身以及所有列表文件
  assert.ok(paths.includes(photos), 'paths 必须包含已获写授权的文件夹路径')
  for (const f of seed.files) assert.ok(paths.includes(f.fullPath), `paths 应包含 ${f.fullPath}`)
  old.unmount()

  ctx.popoutTo(paths)
  assert.deepEqual(ctx.grants().find((g) => g.path === photos), { path: photos, recursive: true, write: true })

  const win = await openWindow(BatchRenameCommand, seed)
  assert.match(summary(win), /规则: 罗马序号/)
  assert.deepEqual(checkedNames(win), ['a.txt', 'b.txt'])
  assert.deepEqual(tagValues(subItem(win, 'a.txt')), ['待改名', '已授权'])
  assert.deepEqual(tagValues(subItem(win, 'doc.txt')), ['待改名', '只读预览'])

  // 执行改名：Photos 目录的写授权已转交过来，直接改出新文件名 a_I.txt / b_II.txt，不再弹授权框
  await runOn(win, subItem(win, 'a.txt'), '执行批量重命名')
  assert.equal(ctx.host.dialogCalls, undefined, '已获写授权的文件夹弹出后不应再弹授权框')
  assert.equal(ctx.moves().length, 2)
  assert.deepEqual(ls(photos), ['a_I.txt', 'b_II.txt', 'c.txt'])
  assert.match(ctx.host.lastToast().title, /已重命名 2 个文件/)

  // 对未曾授权的 Extra/doc.txt 单条改名时，才会弹出按目录补授权对话框
  ctx.queueFolderDialog(extra)
  await runOn(win, subItem(win, 'doc.txt'), '只改名此文件')
  assert.equal(ctx.host.dialogCalls.length, 1)
  assert.equal(ctx.host.dialogCalls[0].defaultPath, extra)
  assert.deepEqual(ls(extra), ['doc_IV.txt'])
  win.unmount()
})

test('未授权拖入文件夹弹出后仍保持只读预览，执行改名前弹授权框，取消不改任何文件', async () => {
  const root = makeDirs({ 'DropDir/a.txt': 'A', 'DropDir/b.txt': 'B' })
  const dropDir = path.join(root, 'DropDir')
  const ctx = setupPopoutHost({ readOnlyDirs: [dropDir] })

  const old = await openWindow(BatchRenameCommand)
  await old.tree().props.onFileInput({ files: [dropDir], directories: [dropDir], source: 'drop' })
  await tick(20)
  assert.deepEqual(tagValues(subItem(old, 'a.txt')), ['待改名', '只读预览'])

  const { seed, paths } = old.popout()
  assert.deepEqual(seed.authorizedDirs, [])
  old.unmount()

  ctx.popoutTo(paths)
  assert.equal(ctx.grants().some((g) => g.write), false, '未获得写授权的目录不会凭空变成写授权')

  const win = await openWindow(BatchRenameCommand, seed)
  assert.deepEqual(tagValues(subItem(win, 'a.txt')), ['待改名', '只读预览'])
  await runOn(win, subItem(win, 'a.txt'), '执行批量重命名')
  assert.equal(ctx.host.dialogCalls.length, 1)
  assert.equal(ctx.moves().length, 0)
  assert.deepEqual(ls(dropDir), ['a.txt', 'b.txt'])
  assert.match(ctx.host.lastToast().title, /已取消授权/)

  ctx.queueFolderDialog(dropDir)
  await runOn(win, subItem(win, 'a.txt'), '执行批量重命名')
  assert.deepEqual(ls(dropDir), ['a_01.txt', 'b_02.txt'])
  win.unmount()
})

test('弹出后已授权目录中勾选文件被磁盘删除且目录新增文件：剔除已删文件，不自动加入或勾选新增文件', async () => {
  const root = makeDirs({ 'Photos/a.txt': 'A', 'Photos/b.txt': 'B' })
  const photos = path.join(root, 'Photos')
  const ctx = setupPopoutHost({ folderDialog: [photos] })

  const old = await openWindow(BatchRenameCommand)
  await pickFolder(old)
  const { seed, paths } = old.popout()
  old.unmount()

  ctx.popoutTo(paths)
  fs.rmSync(path.join(photos, 'b.txt'))
  fs.writeFileSync(path.join(photos, 'new.txt'), 'N')

  const win = await openWindow(BatchRenameCommand, seed)
  assert.deepEqual(subItems(win).map((i) => i.props.title), ['a.txt'])
  assert.deepEqual(checkedNames(win), ['a.txt'])

  await runOn(win, subItem(win, 'a.txt'), '执行批量重命名')
  assert.equal(ctx.moves().length, 1)
  assert.deepEqual(ls(photos), ['a_01.txt', 'new.txt'])
  assert.deepEqual(checkedNames(win), ['a_01.txt'])
  win.unmount()
})

test('交接来的值不合法（旧版本、篡改）时逐项回落到默认值，不崩溃、不转交非法路径', async () => {
  const seeds = [
    { files: 'bad', authorizedDirs: 5, ruleType: 'rm -rf', checkedPaths: [1, 'x'] },
    { files: [{ name: 123 }], authorizedDirs: [''], ruleType: 'replace', checkedPaths: 'x' },
    { files: null, authorizedDirs: null, ruleType: null, checkedPaths: null }
  ]
  for (const seed of seeds) {
    const ctx = setupPopoutHost()
    const win = await openWindow(BatchRenameCommand, seed)
    assert.deepEqual(subItems(win), [])
    assert.equal(summary(win), '尚未添加文件 · 可选择文件、文件夹，或直接拖入')
    const { paths } = win.popout()
    assert.deepEqual(paths, [])
    win.unmount()
    ctx.host.reset()
  }
})
