// 路径授权收紧后的集成测试：真实声明式运行时 + 按宿主结果授权语义模拟的 macOS 宿主
// 宿主规则（electron-client FileSystemService 结果授权）：
// - dir: 扫描结果授权给发起扫描的窗口：普通文件可由同一插件（声明 fs）移入回收站；子目录只读
// - system_get_path 返回的目录只读；分区根目录不在任何结果里，不授权
// - shell_open_path / shell_show_item_in_folder 只放行已授权路径；shell_trash_item 只放行可回收的结果
// 覆盖：扫描到的文件可定位 / 打开 / 回收；授权过期、文件被删、分区根目录、批量部分失败都给出明确提示，不再静默失败
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import DiskAnalyzerCommand from '../dist/index.js'
import { describeHostPathError, deleteDiskFileItem, driveRoot, fileManagerName, openDriveRoot } from '../dist/logic.js'

const host = createHost()
const MB = 1024 * 1024
const HOME = '/Users/tester'
const DOWNLOADS = `${HOME}/Downloads`
const BIG = `${DOWNLOADS}/big-video.mp4`
const ZIP = `${DOWNLOADS}/archive.zip`
const SUBDIR = `${DOWNLOADS}/projects`

const rejections = []
process.on('unhandledRejection', (reason) => rejections.push(reason))

const deny = (message, code = 'PERMISSION_DENIED') => Object.assign(new Error(message), { code })

function installGrantHost() {
  const grants = new Map() // path -> { trash }
  const existing = new Set([BIG, ZIP, SUBDIR, DOWNLOADS])
  const calls = { trash: [], revealed: [], opened: [] }
  host.ipc.system_list_volumes = async () => ({ volumes: [{ path: '/', label: 'Macintosh HD', fileSystem: 'APFS', totalBytes: 500 * 1024 ** 3, usedBytes: 100 * 1024 ** 3, availableBytes: 400 * 1024 ** 3, capacityGroup: 'disk3' }], partial: false, errors: [] })
  host.ipc.system_get_disk_usage = async ({ drive, path }) => {
    if ((drive || path) === '/') return { total: 500 * 1024 * MB, used: 100 * 1024 * MB, available: 400 * 1024 * MB, percent: 20 }
    throw deny('NOT_A_DRIVE', 'FILE_ERROR')
  }
  host.ipc.system_get_path = async ({ name }) => {
    const map = { home: HOME, downloads: DOWNLOADS, documents: `${HOME}/Documents`, desktop: `${HOME}/Desktop`, videos: `${HOME}/Movies`, temp: '/ztools-cache/Temp' }
    const p = map[name] || `${HOME}/${name}`
    grants.set(p, { trash: false })
    return { success: true, path: p }
  }
  host.ipc.system_search_files = async ({ query }) => {
    const dir = String(query).slice(4)
    let files = []
    let subdirs = []
    if (dir === DOWNLOADS) {
      files = [
        { name: 'big-video.mp4', path: BIG, size: 900 * MB, is_dir: false, mtime: 1_700_000_000 },
        { name: 'archive.zip', path: ZIP, size: 300 * MB, is_dir: false, mtime: 1_700_000_000 }
      ]
      subdirs = [{ name: 'projects', path: SUBDIR, file_count: 3, total_bytes: 200 * MB, mtime: 1 }]
    }
    for (const f of files) grants.set(f.path, { trash: true })
    for (const d of subdirs) grants.set(d.path, { trash: false })
    return { files, subdirs, count: files.length, total_matches: files.length, total_bytes: files.reduce((s, f) => s + f.size, 0), truncated: false, visited_entries: files.length }
  }
  const authorize = (p) => {
    if (!grants.has(p)) throw deny('路径未由当前窗口授权')
    if (!existing.has(p)) throw deny('文件不存在', 'FILE_ERROR')
  }
  host.ipc.shell_show_item_in_folder = async ({ fullPath }) => { authorize(fullPath); calls.revealed.push(fullPath); return { success: true } }
  host.ipc.shell_open_path = async ({ fullPath }) => { authorize(fullPath); calls.opened.push(fullPath); return { success: true } }
  host.ipc.shell_trash_item = async ({ fullPath }) => {
    if (!grants.get(fullPath)?.trash) throw deny('路径未由当前窗口授权')
    if (!existing.has(fullPath)) throw deny('文件不存在', 'FILE_ERROR')
    calls.trash.push(fullPath)
    existing.delete(fullPath)
    grants.delete(fullPath)
    return { success: true }
  }
  return { grants, existing, calls }
}

async function mountLoaded() {
  const view = await mount(DiskAnalyzerCommand)
  await tick(30)
  return view
}
const subRows = (view) => view.tree().props.subList.items
const row = (view, name) => {
  const found = subRows(view).find((it) => it.props.title === name)
  if (!found) throw new Error(`找不到文件行 ${name}；现有 ${subRows(view).map((r) => r.props.title).join(', ')}`)
  return found
}

test.beforeEach(() => {
  host.reset()
  rejections.length = 0
})

test('扫描到的文件：定位、默认程序打开、确认后移入回收站都成功，不出现失败提示', async () => {
  const { calls } = installGrantHost()
  const view = await mountLoaded()
  await view.run(row(view, 'big-video.mp4'), '在访达中定位')
  await view.run(row(view, 'big-video.mp4'), '使用默认程序打开文件')
  await tick(5)
  assert.deepEqual(calls.revealed, [BIG])
  assert.deepEqual(calls.opened, [BIG])
  assert.ok(!host.toasts.some((t) => t.style === 'FAILURE'))

  host.setConfirm(true)
  await view.run(row(view, 'archive.zip'), '移入废纸篓清理')
  await tick(5)
  assert.deepEqual(calls.trash, [ZIP])
  assert.equal(host.lastToast().style, 'SUCCESS')
  assert.equal(subRows(view).some((r) => r.props.title === 'archive.zip'), false)
  assert.match(host.confirms.at(-1).message, /系统回收站（废纸篓）/, '确认文案不能再写死 Windows')
  view.unmount()
  assert.equal(rejections.length, 0)
})

test('扫描到的子目录可以在文件管理器中打开（只读授权）', async () => {
  const { calls } = installGrantHost()
  const view = await mountLoaded()
  const dirItem = view.item((it) => it.props.subtitle === SUBDIR)
  await view.run(dirItem, '在访达中打开此目录')
  await tick(5)
  assert.deepEqual(calls.revealed, [SUBDIR])
  assert.ok(!host.toasts.some((t) => t.style === 'FAILURE'))
  view.unmount()
})

test('异常：旧版客户端（1.1.8.6 及更早）不授权分区根目录——提示升级，不说「可能已被移动或删除」', async () => {
  const { calls } = installGrantHost()
  const view = await mountLoaded()
  await view.run(view.item('drive-/'), '在访达中打开此分区')
  await tick(5)
  const t = host.lastToast()
  assert.equal(t.style, 'FAILURE')
  assert.equal(t.title, '无法打开此分区')
  assert.match(t.message, /^\/\nZTools 1\.1\.8\.6 及更早版本不允许插件打开分区根目录，请升级 ZTools/)
  assert.doesNotMatch(t.message, /移动或删除/)
  assert.deepEqual(calls.opened, [])
  view.unmount()
})

test('新版客户端：列出挂载卷时卷根只读授权，「在访达中打开此分区」直接打开；卷被推出后提示重新扫描', async () => {
  const { grants, existing, calls } = installGrantHost()
  const EXT = '/Volumes/外置盘'
  existing.add('/')
  existing.add(EXT)
  // 与宿主 grantVolumeRootsForCaller 一致：system_list_volumes 返回的卷根登记为只读结果授权
  host.ipc.system_list_volumes = async () => {
    for (const p of ['/', EXT]) grants.set(p, { trash: false })
    return { volumes: [
      { path: '/', label: 'Macintosh HD', fileSystem: 'APFS', totalBytes: 500 * 1024 ** 3, usedBytes: 100 * 1024 ** 3, availableBytes: 400 * 1024 ** 3, capacityGroup: 'disk3' },
      { path: EXT, label: '外置盘', fileSystem: 'ExFAT', totalBytes: 100 * 1024 ** 3, usedBytes: 10 * 1024 ** 3, availableBytes: 90 * 1024 ** 3, capacityGroup: 'disk9' }
    ], partial: false, errors: [] }
  }
  const view = await mountLoaded()
  await view.run(view.item('drive-/'), '在访达中打开此分区')
  await view.run(view.item(`drive-${EXT}`), '在访达中打开此分区')
  await tick(5)
  assert.deepEqual(calls.opened, ['/', EXT], '分区用打开（shell_open_path），路径不多拼分隔符')
  assert.deepEqual(calls.revealed, [])
  assert.ok(!host.toasts.some((t) => t.style === 'FAILURE'))

  // 卷在扫描后被推出：宿主报文件错误
  existing.delete(EXT)
  await view.run(view.item(`drive-${EXT}`), '在访达中打开此分区')
  await tick(5)
  assert.equal(host.lastToast().title, '无法打开此分区')
  assert.equal(host.lastToast().message, `${EXT}\n分区可能已被推出或卸载，请重新扫描`)
  view.unmount()
})

test('分区路径与文件管理器名称：Windows 裸盘符补分隔符、目录挂载点不重复补；宿主异常原样说明', async () => {
  assert.equal(driveRoot('C:'), 'C:\\')
  assert.equal(driveRoot('C:\\mount\\'), 'C:\\mount\\')
  assert.equal(driveRoot('/'), '/')
  assert.equal(driveRoot('/Volumes/X'), '/Volumes/X')
  assert.equal(fileManagerName('C:'), '资源管理器')
  assert.equal(fileManagerName('D:\\Downloads\\a.iso'), '资源管理器')
  assert.equal(fileManagerName('\\\\nas\\share\\a.iso'), '资源管理器')
  assert.equal(fileManagerName('/Users/tester/a.iso'), '访达')

  const opened = []
  const ok = await openDriveRoot('D:', { shell_open_path: ({ fullPath }) => { opened.push(fullPath); return { success: true } } })
  assert.deepEqual(ok, { ok: true })
  assert.deepEqual(opened, ['D:\\'])
  const missing = await openDriveRoot('D:', {})
  assert.equal(missing.ok, false)
  assert.match(missing.error, /METHOD_NOT_AVAILABLE|版本过低/)
  const weird = await openDriveRoot('D:', { shell_open_path: () => { throw new Error('磁盘未就绪') } })
  assert.deepEqual(weird, { ok: false, error: '磁盘未就绪' })
  assert.deepEqual(await openDriveRoot('', {}), { ok: false, error: '分区路径为空' })
})

test('异常：授权过期后回收被拒——保留条目并说明只能回收本次扫描到的普通文件', async () => {
  const { grants, calls } = installGrantHost()
  const view = await mountLoaded()
  grants.clear()
  host.setConfirm(true)
  await view.run(row(view, 'big-video.mp4'), '移入废纸篓清理')
  await tick(5)
  const t = host.lastToast()
  assert.equal(t.style, 'FAILURE')
  assert.equal(t.title, '移除失败')
  assert.match(t.message, /^路径未由当前窗口授权（只能回收本次扫描到的普通文件（文件夹、链接与系统目录除外），授权可能已过期，请重新扫描后再试）$/)
  assert.ok(subRows(view).some((r) => r.props.title === 'big-video.mp4'))
  assert.deepEqual(calls.trash, [])

  // 定位同样被拒时也要提示
  await view.run(row(view, 'big-video.mp4'), '在访达中定位')
  await tick(5)
  assert.equal(host.lastToast().title, '无法在文件管理器中定位')

  // 重新扫描后授权恢复
  await view.tree().props.filterBar.actions.find((a) => a.id === 'act-rescan').onAction()
  await tick(30)
  await view.run(row(view, 'big-video.mp4'), '移入废纸篓清理')
  await tick(5)
  assert.deepEqual(calls.trash, [BIG])
  view.unmount()
})

test('异常：扫描后文件被删，打开与回收都提示文件可能已被移动或删除', async () => {
  const { existing } = installGrantHost()
  const view = await mountLoaded()
  existing.delete(BIG)
  await view.run(row(view, 'big-video.mp4'), '使用默认程序打开文件')
  await tick(5)
  assert.equal(host.lastToast().title, '无法打开文件')
  host.setConfirm(true)
  await view.run(row(view, 'big-video.mp4'), '移入废纸篓清理')
  await tick(5)
  assert.match(host.lastToast().message, /文件不存在（文件可能已被移动或删除，请重新扫描）/)
  view.unmount()
})

test('批量清理部分被拒：成功的移除，失败项数量与原因写进提示（不再一律说“被占用”）', async () => {
  const { grants, calls } = installGrantHost()
  const view = await mountLoaded()
  row(view, 'big-video.mp4').props.onCheckChange(true)
  row(view, 'archive.zip').props.onCheckChange(true)
  await tick()
  grants.delete(ZIP)
  host.setConfirm(true)
  const batch = view.actions(row(view, 'big-video.mp4')).find((a) => a.props.title.startsWith('批量清理'))
  await batch.props.onAction()
  await tick(10)
  assert.deepEqual(calls.trash, [BIG])
  const t = host.lastToast()
  assert.equal(t.style, 'SUCCESS')
  assert.match(t.message, /1 项未能移除：路径未由当前窗口授权（只能回收本次扫描到的普通文件/)
  assert.ok(subRows(view).some((r) => r.props.title === 'archive.zip'))
  view.unmount()
})

test('错误说明边界：只有错误码时不显示码；未知错误原样；空值有兜底；系统保护路径在插件侧直接拦截', async () => {
  assert.equal(describeHostPathError('PERMISSION_DENIED'), '只能回收本次扫描到的普通文件（文件夹、链接与系统目录除外），授权可能已过期，请重新扫描后再试')
  assert.equal(describeHostPathError('FILE_ERROR'), '文件可能已被移动或删除，请重新扫描')
  assert.equal(describeHostPathError('文件正被占用'), '文件正被占用')
  assert.equal(describeHostPathError(undefined), '移除失败')
  host.ipc.shell_trash_item = async () => { throw new Error('不应调用宿主') }
  const res = await deleteDiskFileItem('/System/Library/Kernels/kernel')
  assert.equal(res.ok, false)
  assert.equal(host.ipcCalls.some(([m]) => m === 'shell_trash_item'), false)
})
