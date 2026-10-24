// 独立窗口带状态：目录来源、所选文件夹、规则与勾选随弹出带走，旧窗口已有的文件夹授权转交给新窗口；
// 按宿主真实的按窗口授权模型（选目录对话框签发递归授权，转交只给已有授权、以该路径为根）在临时目录里真实改名。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { renderDeclarativeRoot } from '@ztools/declarative-ui'
import { createHost, installDirectoryHost, tick } from '../../shared/test-harness.mjs'
import BatchRenameCommand from '../dist/index.js'

const roots = []
test.after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true })
})

// ---- 模拟宿主的「弹出独立窗口」交接（与 frontend popoutHandoff 一致：只收纯 JSON，路径另行转交授权）----

function descriptors(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => descriptors(n, out))
  else if (node && typeof node === 'object') {
    if (typeof node.type === 'string') out.push(node)
    for (const v of [node.children, ...Object.values(node.props || {})]) if (v && typeof v === 'object') descriptors(Array.isArray(v) ? v : v.type ? v : v.items, out)
  }
  return out
}

/** 按宿主方式挂载根页面；handoffSeed 是独立窗口交接来的初值 */
async function openWindow(Command, handoffSeed) {
  const root = renderDeclarativeRoot(() => Command(), handoffSeed === undefined ? undefined : { handoffSeed })
  await tick(20)
  const win = {
    tree: () => root.forceRender(),
    all: (type) => descriptors(win.tree()).filter((n) => n.type === type),
    async act(title) {
      const a = descriptors(win.tree()).find((n) => n.type.startsWith('Action') && !n.type.startsWith('ActionPanel') && typeof n.props?.title === 'string' && n.props.title.startsWith(title))
      if (!a) throw new Error(`找不到动作「${title}」`)
      await a.props.onAction?.()
      await a.props.onSubmit?.({})
      await tick(20)
    },
    /** 收集根页面状态并按 JSON 往返，返回新窗口的初值、要转交授权的路径与被拒绝的 key */
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

function makeDir(files) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'batch-rename-popout-')))
  roots.push(root)
  const dir = path.join(root, 'Photos')
  fs.mkdirSync(dir)
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content)
  return { root, dir }
}

const fail = (code, message) => Object.assign(new Error(message), { code })
const ls = (dir) => fs.readdirSync(dir).sort()

/**
 * 宿主模拟：grants 是「当前窗口」的授权表；popoutTo() 模拟 FileSystemService.transferGrants，
 * 把旧窗口对这些路径已有的授权（不会更多）交给新窗口：目录且源授权递归 → 以该目录为根递归，其余只给精确路径；
 * 没有授权、已不存在、相对路径一律丢弃。
 */
async function setupHost(dirs, { dialog = [] } = {}) {
  const host = createHost()
  host.reset()
  await installDirectoryHost(host, { authorized: [] })
  let grants = []
  const dialogQueue = [...dialog]
  const covers = (g, p) => p === g.path || (g.recursive && p.startsWith(g.path + path.sep))
  const requireGrant = (...ps) => {
    for (const p of ps) if (!grants.some((g) => covers(g, p))) throw fail('PERMISSION_DENIED', '路径未由当前窗口授权')
  }
  host.ipc.system_get_path = async ({ name }) => dirs[name] || ''
  host.ipc.window_show_select_folder_dialog = async (params) => {
    host.dialogCalls = [...(host.dialogCalls || []), params]
    const next = dialogQueue.shift()
    if (!next) return { canceled: true }
    grants.push({ path: next, recursive: true })
    return { canceled: false, folderPath: next }
  }
  host.ipc.filesystem_get_directory_contents = async ({ path: target }) => {
    requireGrant(target)
    return {
      success: true,
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
  host.ipc.filesystem_move_file = async ({ sourcePath, destPath }) => {
    requireGrant(sourcePath, destPath)
    fs.renameSync(sourcePath, destPath)
    return { success: true }
  }
  return {
    host,
    grants: () => grants,
    queueDialog: (p) => dialogQueue.push(p),
    popoutTo(paths) {
      const next = []
      for (const p of paths) {
        if (typeof p !== 'string' || !path.isAbsolute(p) || !fs.existsSync(p)) continue
        const real = fs.realpathSync(p)
        for (const g of grants.filter((g) => covers(g, real))) {
          next.push({ path: real, recursive: g.recursive && fs.statSync(real).isDirectory() })
        }
      }
      grants = next
      host.dialogCalls = undefined
      host.ipcCalls.length = 0
    },
    moves: () => host.ipcCalls.filter(([m]) => m === 'filesystem_move_file').map(([, p]) => p)
  }
}

const subItems = (win) => win.tree().props.subList.items
const subItem = (win, name) => {
  const found = subItems(win).find((i) => i.props.title === name)
  if (!found) throw new Error(`找不到 ${name}；现有：${subItems(win).map((i) => i.props.title).join(', ')}`)
  return found
}
const checkedNames = (win) => subItems(win).filter((i) => i.props.checked).map((i) => i.props.title).sort()
const summary = (win) => win.tree().props.filterBar.summaryText
async function runOn(win, node, prefix) {
  const action = descriptors(node.props.actions).find((n) => n.type === 'Action' && n.props.title.startsWith(prefix))
  if (!action) throw new Error(`找不到动作「${prefix}」`)
  await action.props.onAction()
  await tick(20)
}
async function pickFolder(win) {
  win.tree().props.filterBar.actions.find((a) => a.id === 'pick-folder').onAction()
  await tick(20)
}
async function selectRule(win, id) {
  win.all('List.Item').find((i) => i.props.id === `nav-rule-${id}`).props.onSelect()
  await tick(20)
}

test('弹出闭环：所选文件夹、规则与勾选带到新窗口，授权随之转交，新窗口直接执行改名不再弹授权框', async () => {
  const { root, dir } = makeDir({ 'a.txt': 'A', 'b.txt': 'B', 'c.txt': 'C' })
  const ctx = await setupHost({ downloads: root }, { dialog: [dir] })
  const old = await openWindow(BatchRenameCommand)
  await pickFolder(old)
  assert.equal(old.tree().props.searchBarAccessory.props.value, 'custom')
  await selectRule(old, 'snake_case')
  await selectRule(old, 'number_roman')
  subItem(old, 'c.txt').props.onToggleCheck()
  await tick()
  assert.deepEqual(checkedNames(old), ['a.txt', 'b.txt'])

  const { seed, rejected, paths } = old.popout()
  assert.deepEqual(seed, {
    sourceScope: 'custom',
    customDir: dir,
    ruleType: 'number_roman',
    checkedPaths: [path.join(dir, 'a.txt'), path.join(dir, 'b.txt')]
  })
  assert.deepEqual(rejected, [])
  assert.ok(!('undoStack' in seed) && !('listing' in seed), '撤销记录与目录清单不带')
  assert.deepEqual([...new Set(paths)].sort(), [dir, path.join(dir, 'a.txt'), path.join(dir, 'b.txt')])
  old.unmount()

  ctx.popoutTo(paths)
  assert.deepEqual(ctx.grants().find((g) => g.path === dir), { path: dir, recursive: true })
  const win = await openWindow(BatchRenameCommand, seed)
  assert.equal(win.tree().props.searchBarAccessory.props.value, 'custom')
  assert.match(summary(win), /目录: Photos/)
  assert.match(summary(win), /规则: 罗马序号/)
  assert.doesNotMatch(summary(win), /需授权/, '转交来的授权让新窗口读到完整目录')
  assert.deepEqual(checkedNames(win), ['a.txt', 'b.txt'], '勾选与旧窗口一致，c.txt 仍未勾选')

  await runOn(win, subItem(win, 'a.txt'), '执行批量重命名')
  assert.equal(ctx.host.dialogCalls, undefined, '新窗口不用重新授权')
  assert.equal(ctx.moves().length, 2)
  assert.deepEqual(ls(dir), ['a_I.txt', 'b_II.txt', 'c.txt'])
  assert.match(ctx.host.lastToast().title, /已重命名 2 个文件/)
  win.unmount()
})

test('[异常] 旧窗口没有授权（默认目录、未授权）：路径一律不转交；新窗口执行时先弹授权框，取消则不改任何文件', async () => {
  const { root, dir } = makeDir({ 'a.txt': 'A', 'b.txt': 'B' })
  const ctx = await setupHost({ pictures: dir, downloads: root })
  const old = await openWindow(BatchRenameCommand)
  old.tree().props.searchBarAccessory.props.onChange('pictures')
  await tick(20)
  assert.match(summary(old), /执行时需授权文件夹/)
  const { seed, paths } = old.popout()
  assert.equal(seed.sourceScope, 'pictures')
  assert.equal(seed.customDir, '')
  old.unmount()

  ctx.popoutTo(paths)
  assert.deepEqual(ctx.grants(), [], '没有已有授权就不会凭空多出授权')
  const win = await openWindow(BatchRenameCommand, seed)
  assert.equal(win.tree().props.searchBarAccessory.props.value, 'pictures')
  assert.deepEqual(checkedNames(win), ['a.txt', 'b.txt'])
  await runOn(win, subItem(win, 'a.txt'), '执行批量重命名')
  assert.equal(ctx.host.dialogCalls.length, 1)
  assert.equal(ctx.moves().length, 0)
  assert.deepEqual(ls(dir), ['a.txt', 'b.txt'])
  assert.match(ctx.host.lastToast().title, /已取消授权/)

  ctx.queueDialog(dir)
  await runOn(win, subItem(win, 'a.txt'), '执行批量重命名')
  assert.deepEqual(ls(dir), ['a_01.txt', 'b_02.txt'])
  win.unmount()
})

test('[异常] 弹出后勾选的文件被删除、目录里新增了文件：只保留仍存在的勾选，新文件不自动勾选，不会改名不存在的文件', async () => {
  const { root, dir } = makeDir({ 'a.txt': 'A', 'b.txt': 'B' })
  const ctx = await setupHost({ downloads: root }, { dialog: [dir] })
  const old = await openWindow(BatchRenameCommand)
  await pickFolder(old)
  const { seed, paths } = old.popout()
  assert.equal(seed.checkedPaths.length, 2)
  old.unmount()
  ctx.popoutTo(paths)
  fs.rmSync(path.join(dir, 'b.txt'))
  fs.writeFileSync(path.join(dir, 'new.txt'), 'N')

  const win = await openWindow(BatchRenameCommand, seed)
  assert.deepEqual(checkedNames(win), ['a.txt'])
  await runOn(win, subItem(win, 'a.txt'), '执行批量重命名')
  assert.equal(ctx.moves().length, 1)
  assert.deepEqual(ls(dir), ['a_01.txt', 'new.txt'])
  // 之后的重新读取按原规则：改名结果默认勾选
  assert.deepEqual(checkedNames(win), ['a_01.txt'])
  win.unmount()
})

test('[异常] 交接来的值不合法（旧版本、篡改）时逐项回落到默认值，不崩溃、不转交非法路径', async () => {
  const { dir } = makeDir({ 'a.txt': 'A' })
  const seeds = [
    { sourceScope: 'evil', customDir: 5, ruleType: 'rm -rf', checkedPaths: [1, 'x'] },
    { sourceScope: 'custom', customDir: '', ruleType: 'replace', checkedPaths: 'x' },
    { sourceScope: ['downloads'], customDir: null, ruleType: null, checkedPaths: null }
  ]
  for (const seed of seeds) {
    const ctx = await setupHost({ downloads: dir }, { dialog: [] })
    const win = await openWindow(BatchRenameCommand, seed)
    assert.equal(win.tree().props.searchBarAccessory.props.value, 'downloads', JSON.stringify(seed))
    assert.match(summary(win), /规则: 阿拉伯序号/)
    assert.deepEqual(checkedNames(win), ['a.txt'], '没有合法的勾选时按新开处理')
    const { paths } = win.popout()
    assert.ok(paths.every((p) => typeof p === 'string'))
    assert.ok(!paths.includes('x'))
    win.unmount()
    ctx.host.reset()
  }
})

test('[边界] 带来的勾选为空（旧窗口还没读完目录就弹出）：按新开处理，全部勾选', async () => {
  const { root, dir } = makeDir({ 'a.txt': 'A', 'b.txt': 'B' })
  await setupHost({ pictures: dir, downloads: root })
  const win = await openWindow(BatchRenameCommand, { sourceScope: 'pictures', customDir: '', ruleType: 'number', checkedPaths: [] })
  assert.deepEqual(checkedNames(win), ['a.txt', 'b.txt'])
  win.unmount()
})
