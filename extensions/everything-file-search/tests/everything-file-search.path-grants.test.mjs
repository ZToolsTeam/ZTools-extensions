// 路径授权收紧后的集成测试：真实声明式运行时 + 按宿主结果授权语义模拟的 IPC
// 宿主规则（electron-client FileSystemService 结果授权）：
// - filesearch_query 的结果只授权给发起查询的窗口；普通文件可由同一插件（声明 fs）移入回收站，文件夹只读
// - filesearch_open / reveal / sha256 / quick_look 只接受已授权路径：未授权 PERMISSION_DENIED，文件已不在 FILE_ERROR
// - __ztoolsLauncher.searchFiles 不带插件身份，结果不能回收，所以插件有宿主通道时不能用它检索
// 覆盖：检索走插件通道、文件夹不提供回收、授权内的打开 / 定位 / 哈希 / 回收成功、授权过期 / 文件被删 / 仅错误码 / 回收被拒的提示
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import * as mod from '../dist/index.js'
import { moveToTrash, calculateFileSha256, searchLocalFiles, classifyHostFileError, describeHostFileError } from '../dist/search-service.js'

const Command = mod.default
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'efs-grants-'))
test.after(() => fs.rmSync(root, { recursive: true, force: true }))

const rejections = []
process.on('unhandledRejection', (reason) => rejections.push(reason))

function put(name, data) {
  const p = path.join(root, name)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, data)
  return p
}
const reportTxt = put('report.txt', 'quarterly report\n')
const photoPng = put('photo.png', Buffer.alloc(64, 7))
const folder = path.join(root, 'projects')
fs.mkdirSync(path.join(folder, 'inner'), { recursive: true })
const unlisted = put('secret/unlisted.txt', 'not in results')

const host = createHost()
const deny = (message, code = 'PERMISSION_DENIED') => Object.assign(new Error(message), { code })

/**
 * 模拟宿主：查询结果登记进本窗口授权表（文件可回收、文件夹只读），filesearch_* 与 shell_trash_item 逐条核对。
 * 返回授权表与调用记录，用例可清空授权（模拟 30 分钟过期 / 换窗口）或给回收站加保护路径。
 */
function installGrantHost(results = [reportTxt, photoPng, folder]) {
  const grants = new Map() // path -> { trash }
  const protectedPaths = new Set()
  const calls = { opened: [], revealed: [], trashed: [], launcher: 0 }
  const record = (p) => {
    const isDir = fs.statSync(p).isDirectory()
    return { name: path.basename(p), path: p, is_dir: isDir, size: isDir ? 0 : fs.statSync(p).size, mtime: 1 }
  }
  host.ipc.filesearch_query = async () => {
    const files = results.filter((p) => fs.existsSync(p)).map(record)
    for (const f of files) grants.set(f.path, { trash: f.is_dir === false })
    return { files, total_matches: files.length }
  }
  const authorize = (p) => {
    if (!grants.has(p)) throw deny('路径未由当前窗口授权')
    if (!fs.existsSync(p)) throw deny('文件不存在', 'FILE_ERROR')
    return p
  }
  host.ipc.filesearch_open = async ({ path: p }) => { calls.opened.push(authorize(p)); return { success: true, path: p } }
  host.ipc.filesearch_reveal = async ({ path: p }) => { calls.revealed.push(authorize(p)); return { success: true, path: p } }
  host.ipc.filesearch_quick_look = async ({ path: p }) => { authorize(p); return { success: true, path: p } }
  host.ipc.filesearch_sha256 = async ({ path: p }) => {
    authorize(p)
    return { success: true, path: p, sha256: crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') }
  }
  host.ipc.shell_trash_item = async ({ fullPath }) => {
    const grant = grants.get(fullPath)
    if (!grant || !grant.trash || protectedPaths.has(fullPath)) throw deny('路径未由当前窗口授权')
    calls.trashed.push(fullPath)
    grants.delete(fullPath)
    return { success: true }
  }
  globalThis.__ztoolsLauncher = {
    async searchFiles() {
      calls.launcher++
      return { files: [record(unlisted)] }
    }
  }
  return { grants, protectedPaths, calls }
}

const waitSearch = async () => {
  await new Promise((r) => setTimeout(r, mod.SEARCH_DEBOUNCE_MS + 30))
  await tick(10)
}

async function mountList() {
  const view = await mount(Command, host)
  await waitSearch()
  return view
}

test.beforeEach(() => {
  host.reset()
  rejections.length = 0
})
test.afterEach(() => {
  delete globalThis.__ztoolsLauncher
})

test('检索走插件自己的 filesearch_query（带插件身份），有宿主通道时不调用 __ztoolsLauncher.searchFiles', async () => {
  const { calls } = installGrantHost()
  const view = await mountList()
  assert.deepEqual(view.items().map((i) => i.props.id).sort(), [folder, photoPng, reportTxt].sort())
  assert.equal(calls.launcher, 0, '不能走不带插件身份的悬浮条检索')
  assert.ok(host.ipcCalls.some(([m]) => m === 'filesearch_query'))
  await view.search('report')
  await waitSearch()
  assert.equal(calls.launcher, 0)
  view.unmount()
})

test('文件夹结果不提供「移入回收站」，普通文件保留；直接调用也不会把文件夹交给宿主回收', async () => {
  const { calls } = installGrantHost()
  const view = await mountList()
  const titles = (id) => view.actions(view.item(id)).map((a) => a.props.title)
  assert.ok(!titles(folder).includes('移入回收站 (Move to Trash)'))
  assert.ok(titles(folder).includes('打开文件夹'))
  assert.ok(titles(reportTxt).includes('移入回收站 (Move to Trash)'))
  view.unmount()

  const res = await moveToTrash(folder, undefined, true)
  assert.equal(res.success, false)
  assert.equal(res.error, 'TRASH_DIRECTORY')
  assert.equal(host.ipcCalls.some(([m]) => m === 'shell_trash_item'), false)
  assert.deepEqual(calls.trashed, [])
})

test('授权内：打开 / 定位 / 计算哈希 / 确认后移入回收站都成功，哈希与真实文件字节一致', async () => {
  const { calls } = installGrantHost()
  const view = await mountList()
  await view.run(view.item(reportTxt), '打开文件')
  assert.equal(host.lastToast().style, 'SUCCESS')
  await view.run(view.item(folder), '打开文件夹')
  await view.run(view.item(photoPng), '在 Finder / 资源管理器中定位 (Show in Finder)')
  assert.deepEqual(calls.opened, [reportTxt, folder])
  assert.deepEqual(calls.revealed, [photoPng])

  await view.run(view.item(reportTxt), '计算并复制 SHA-256')
  await tick(10)
  const expected = crypto.createHash('sha256').update(fs.readFileSync(reportTxt)).digest('hex')
  assert.equal(host.clipboard.text, expected)
  assert.equal(host.ipcCalls.filter(([m]) => m === 'filesearch_sha256').length, 1, '成功时只向宿主要一次哈希')

  host.setConfirm(true)
  await view.run(view.item(photoPng), '移入回收站 (Move to Trash)')
  assert.deepEqual(calls.trashed, [photoPng])
  assert.equal(host.lastToast().style, 'SUCCESS')
  assert.equal(view.items().some((i) => i.props.id === photoPng), false)
  view.unmount()
  assert.equal(rejections.length, 0)
})

test('异常：授权过期（或换了窗口）后打开 / 定位 / 哈希 / 快速预览都提示重新搜索，不提示成功', async () => {
  const { grants, calls } = installGrantHost()
  const view = await mountList()
  grants.clear()
  for (const action of ['打开文件', '在 Finder / 资源管理器中定位 (Show in Finder)', 'Quick Look 快速预览']) {
    await view.run(view.item(reportTxt), action)
    const t = host.lastToast()
    assert.equal(t.style, 'FAILURE', action)
    assert.match(t.title, /路径未由当前窗口授权（只能操作本次搜索到的文件，授权可能已过期，请重新搜索后再试）/, action)
  }
  await view.run(view.item(reportTxt), '计算并复制 SHA-256')
  await tick(10)
  assert.equal(host.lastToast().style, 'FAILURE')
  assert.match(host.lastToast().title, /计算 SHA-256 失败: .*请重新搜索后再试/)
  assert.equal(host.clipboard.text, '')
  assert.deepEqual(calls.opened, [])

  // 重新搜索后授权恢复，可以再打开
  await view.search('report')
  await waitSearch()
  await view.run(view.item(reportTxt), '打开文件')
  assert.equal(host.lastToast().style, 'SUCCESS')
  view.unmount()
})

test('异常：搜索后文件被删 → FILE_ERROR，提示文件可能已被移动或删除', async () => {
  const gone = put('gone.txt', 'bye')
  installGrantHost([gone, reportTxt])
  const view = await mountList()
  fs.rmSync(gone)
  await view.run(view.item(gone), '打开文件')
  assert.equal(host.lastToast().style, 'FAILURE')
  assert.match(host.lastToast().title, /打开失败: 文件不存在（文件可能已被移动或删除，请重新搜索）/)
  await assert.rejects(calculateFileSha256(gone), /文件可能已被移动或删除/)
  view.unmount()
})

test('异常：宿主拒绝回收（系统目录 / 链接 / 授权过期）时保留条目并说明只能回收本次搜索到的普通文件', async () => {
  const { protectedPaths, calls } = installGrantHost()
  const view = await mountList()
  protectedPaths.add(reportTxt)
  host.setConfirm(true)
  await view.run(view.item(reportTxt), '移入回收站 (Move to Trash)')
  assert.equal(host.lastToast().style, 'FAILURE')
  assert.match(host.lastToast().title, /移入废纸篓失败: 路径未由当前窗口授权（只能回收本次搜索到的普通文件，系统目录与链接除外/)
  assert.ok(view.items().some((i) => i.props.id === reportTxt), '失败时条目不能从列表消失')
  assert.deepEqual(calls.trashed, [])
  view.unmount()
})

test('异常：宿主只回错误码（没有说明文字）时不把错误码直接展示给用户', async () => {
  installGrantHost()
  host.ipc.filesearch_open = async () => { throw Object.assign(new Error(''), { code: 'PERMISSION_DENIED' }) }
  const view = await mountList()
  await view.run(view.item(reportTxt), '打开文件')
  assert.equal(host.lastToast().title, '打开失败: 只能操作本次搜索到的文件，授权可能已过期，请重新搜索后再试')
  view.unmount()
})

test('没有宿主通道（非 Electron 环境）时才回落到 __ztoolsLauncher.searchFiles', async () => {
  const { calls } = installGrantHost()
  const saved = globalThis.__ztoolsElectron
  delete globalThis.__ztoolsElectron
  try {
    const files = await searchLocalFiles('unlisted', 10)
    assert.deepEqual(files.map((f) => f.path), [unlisted])
    assert.equal(calls.launcher, 1)
  } finally {
    globalThis.__ztoolsElectron = saved
  }
})

test('错误分类边界：空值、未知错误原样保留，权限与文件不存在分别识别', () => {
  assert.equal(classifyHostFileError(undefined), null)
  assert.equal(classifyHostFileError('qlmanage missing'), null)
  assert.equal(classifyHostFileError('PERMISSION_DENIED'), 'permission')
  assert.equal(classifyHostFileError('文件操作权限不足'), 'permission')
  assert.equal(classifyHostFileError('FILE_ERROR'), 'missing')
  assert.equal(classifyHostFileError('文件或目录不存在'), 'missing')
  assert.equal(describeHostFileError('', '/x'), '/x')
  assert.equal(describeHostFileError('service crashed', '/x'), 'service crashed')
  assert.equal(describeHostFileError('FILE_ERROR', '/x'), '文件可能已被移动或删除，请重新搜索')
})
