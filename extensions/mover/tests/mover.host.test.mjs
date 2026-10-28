// C 盘搬家：扫描只用真实数据；迁移前检查、确认与授权；失败时只在确认安全时回滚，并如实报告
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import * as mover from '../dist/logic.js'
import { MoverCommand } from '../dist/index.js'

const host = createHost()
test.beforeEach(() => host.reset())

const GB = 1024 ** 3
const lower = p => String(p).toLowerCase()
// 与客户端内置处理器的返回形状一致：结果对象再套一层 data
const hostOk = rec => ({ ...rec, data: { ...rec } })
const hostFail = error => hostOk({ ok: false, success: false, error })
const internalError = () => Object.assign(new Error('宿主内部错误'), { code: 'INTERNAL_ERROR' })

const folder = (id, sourcePath, sizeBytes = GB) => ({
  id,
  name: id,
  sourcePath,
  category: 'user_profile',
  categoryName: '个人文件夹',
  sizeBytes,
  fileCount: 10
})

/** 模拟客户端：原目录状态、目标位置已有内容、迁移行为与目录授权窗口 */
function installMoverHost({ sources = [], destDirs = [], destFiles = [], relocate, folderPick } = {}) {
  const state = {
    sources: new Map(sources.map(p => [lower(p), { isJunction: false }])),
    destDirs: new Set(destDirs.map(lower)),
    destFiles: new Set(destFiles.map(lower)),
    deleted: [],
    relocated: [],
    scanError: null,
    existsError: null,
    deleteError: null
  }
  host.ipc.dllplugin_call = ({ plugin, func, params }) => {
    assert.equal(plugin, 'MoverPlugin')
    if (func === 'scanCandidates') {
      if (state.scanError) throw state.scanError
      const items = params.customPaths
        .filter(p => state.sources.has(lower(p)))
        .map(p => ({ sourcePath: p, isJunction: state.sources.get(lower(p)).isJunction }))
      return hostOk({ ok: true, success: true, items, candidates: items })
    }
    if (func === 'relocateWithJunction') {
      state.relocated.push(params)
      const dest = mover.destinationPathFor(params.sourcePath, params.targetRoot)
      if (relocate) return relocate(params, dest, state)
      state.destDirs.add(lower(dest))
      state.sources.set(lower(params.sourcePath), { isJunction: true })
      return hostOk({ ok: true, success: true, targetPath: dest })
    }
    throw new Error(`unexpected ${func}`)
  }
  host.ipc.filesystem_directory_exists = ({ path }) => {
    if (state.existsError) throw state.existsError
    return { success: true, exists: state.destDirs.has(lower(path)) }
  }
  host.ipc.filesystem_file_exists = ({ path }) => ({ success: true, exists: state.destFiles.has(lower(path)) })
  host.ipc.filesystem_delete_directory = ({ path }) => {
    if (state.deleteError) throw state.deleteError
    state.deleted.push(path)
    state.destDirs.delete(lower(path))
    return { success: true }
  }
  host.ipc.window_show_select_folder_dialog = folderPick || (params => ({ canceled: false, folderPath: params.defaultPath }))
  return state
}

function installScanHost() {
  const paths = {
    home: 'C:\\Users\\U',
    documents: 'C:\\Users\\U\\Documents',
    downloads: 'C:\\Users\\U\\Downloads',
    videos: 'D:\\Videos',
    appData: 'C:\\Users\\U\\AppData\\Roaming',
    temp: 'C:\\Users\\U\\AppData\\Local\\Temp'
  }
  host.ipc.system_get_path = ({ name }) => paths[name] || ''
  host.ipc.system_get_disk_usage = ({ drive }) => {
    if (drive.startsWith('C:')) return { total: 256 * GB, used: 236 * GB, available: 20 * GB, percent: 92 }
    if (drive.startsWith('D:')) return { total: 1024 * GB, used: 424 * GB, available: 600 * GB, percent: 41 }
    return { total: 0, used: 0, available: 0, percent: 0 }
  }
  const tree = {
    'dir:C:\\Users\\U\\Downloads': 3 * GB,
    'dir:C:\\Users\\U\\Documents\\WeChat Files': 5 * GB,
    'dir:D:\\Videos': 9 * GB,
    'dir:C:\\Users\\U\\AppData\\Local\\Temp': 2 * GB,
    'dir:C:\\Users\\U\\AppData\\Local': 7 * GB
  }
  host.ipc.system_search_files = ({ query }) => {
    const size = tree[query]
    if (!size) return { files: [], total_matches: 0, total_bytes: 0 }
    const dir = query.slice(4)
    return {
      files: [{ name: 'big.bin', path: `${dir}\\big.bin`, is_dir: false, size, mtime: 1 }],
      subdirs: [{ name: 'Sub', path: `${dir}\\Sub`, file_count: 1, total_bytes: 1 }],
      total_matches: 1,
      total_bytes: size
    }
  }
}

test('扫描：只列 C 盘上真实存在的目录，不含示例数据、System32 占位、AppData 与 Temp', async () => {
  installScanHost()
  const snap = await mover.fetchMoverSnapshot()
  assert.equal(snap.error, undefined)
  assert.deepEqual(snap.folders.map(f => f.sourcePath).sort(), ['C:\\Users\\U\\Documents\\WeChat Files', 'C:\\Users\\U\\Downloads'])
  assert.equal(snap.folders.find(f => f.id === 'mover_downloads').sizeBytes, 3 * GB)
  assert.equal(snap.totalMovableBytes, 8 * GB)
  assert.deepEqual(snap.targetDrives.map(d => d.targetRoot), ['D:\\ZToolsMoved'])
  assert.equal(snap.targetDrives[0].freeBytes, 600 * GB)
  assert.equal(snap.cDriveFreeBytes, 20 * GB)
})

test('扫描：拿不到用户目录时报错，不退回默认用户目录；不在客户端时显示空状态', async () => {
  host.ipc.system_get_path = () => { throw new Error('不可用') }
  host.ipc.system_get_disk_usage = () => ({ total: 0 })
  const snap = await mover.fetchMoverSnapshot()
  assert.deepEqual(snap.folders, [])
  assert.match(snap.error, /无法获取用户目录/)
  assert.ok(!host.ipcCalls.some(([m, p]) => m === 'system_search_files' && String(p.query).includes('Default')))

  const saved = globalThis.__ztoolsElectron
  delete globalThis.__ztoolsElectron
  try {
    const offline = await mover.fetchMoverSnapshot()
    assert.equal(offline.error, mover.NOT_IN_CLIENT_MESSAGE)
    assert.deepEqual(offline.folders, [])
  } finally {
    globalThis.__ztoolsElectron = saved
  }
})

test('迁移前检查：未勾选、目标在 C 盘、目录互相包含、迁移后重名、空间不足都拒绝', () => {
  const docs = folder('文档', 'C:\\Users\\U\\Documents', 2 * GB)
  const wechat = folder('微信', 'C:\\Users\\U\\Documents\\WeChat Files', GB)
  const cacheA = folder('缓存A', 'C:\\Users\\U\\AppData\\Local\\pip\\Cache')
  const cacheB = folder('缓存B', 'C:\\Users\\U\\Other\\Cache')
  assert.match(mover.validateMoveSelection([], 'D:\\ZToolsMoved'), /请先勾选/)
  assert.match(mover.validateMoveSelection([docs], 'C:\\Moved'), /不能在 C 盘/)
  assert.match(mover.validateMoveSelection([docs], 'D:'), /禁止/)
  assert.match(mover.validateMoveSelection([docs], 'D:\\Windows\\X'), /禁止/)
  assert.match(mover.validateMoveSelection([docs, wechat], 'D:\\ZToolsMoved'), /里面/)
  assert.match(mover.validateMoveSelection([cacheA, cacheB], 'D:\\ZToolsMoved'), /同名/)
  assert.match(mover.validateMoveSelection([docs], 'D:\\ZToolsMoved', GB), /超过目标分区可用空间/)
  assert.equal(mover.validateMoveSelection([docs], 'D:\\ZToolsMoved', 10 * GB), null)
  assert.equal(mover.validateMoveSelection([docs, cacheA], 'D:\\ZToolsMoved\\'), null)
})

test('目标授权：只接受目标分区根目录或目标文件夹本身', async () => {
  installMoverHost({ folderPick: () => ({ canceled: true }) })
  assert.deepEqual(await mover.authorizeMoveTarget('D:\\ZToolsMoved'), { ok: false, canceled: true })
  host.ipc.window_show_select_folder_dialog = () => ({ canceled: false, folderPath: 'E:\\' })
  assert.match((await mover.authorizeMoveTarget('D:\\ZToolsMoved')).error, /请选择 D:\\/)
  host.ipc.window_show_select_folder_dialog = () => ({ canceled: false, folderPath: 'D:\\ZToolsMoved\\Sub' })
  assert.equal((await mover.authorizeMoveTarget('D:\\ZToolsMoved')).ok, false)
  host.ipc.window_show_select_folder_dialog = () => ({ canceled: false, folderPath: 'd:\\ztoolsmoved\\' })
  assert.equal((await mover.authorizeMoveTarget('D:\\ZToolsMoved')).ok, true)
  host.ipc.window_show_select_folder_dialog = params => {
    assert.equal(params.defaultPath, 'D:\\')
    return { canceled: false, folderPath: 'D:\\' }
  }
  assert.equal((await mover.authorizeMoveTarget('D:\\ZToolsMoved')).ok, true)
  host.ipc.window_show_select_folder_dialog = () => { throw new Error('窗口不可用') }
  assert.match((await mover.authorizeMoveTarget('D:\\ZToolsMoved')).error, /窗口不可用/)
})

test('迁移成功：先查原目录状态和目标位置，再按目录调用客户端迁移', async () => {
  const a = folder('下载', 'C:\\Users\\U\\Downloads', 3 * GB)
  const b = folder('微信', 'C:\\Users\\U\\Documents\\WeChat Files', 2 * GB)
  const state = installMoverHost({ sources: [a.sourcePath, b.sourcePath] })
  const res = await mover.executeDirectoryMove([a, b], 'D:\\ZToolsMoved')
  assert.equal(res.ok, true)
  assert.equal(res.movedCount, 2)
  assert.equal(res.freedBytes, 5 * GB)
  assert.deepEqual(state.relocated, [
    { sourcePath: a.sourcePath, targetRoot: 'D:\\ZToolsMoved' },
    { sourcePath: b.sourcePath, targetRoot: 'D:\\ZToolsMoved' }
  ])
  assert.deepEqual(state.deleted, [])
  const checked = host.ipcCalls.filter(([m]) => m === 'filesystem_directory_exists').map(([, p]) => p.path)
  assert.deepEqual(checked, ['D:\\ZToolsMoved\\Downloads', 'D:\\ZToolsMoved\\WeChat Files'])
  assert.match(res.message, /已把 2 个目录迁移到 D:\\ZToolsMoved/)
})

test('目标位置已有同名文件夹或文件、原目录已是联接或不存在时跳过，不调用迁移', async () => {
  const a = folder('下载', 'C:\\Users\\U\\Downloads')
  const b = folder('视频', 'C:\\Users\\U\\Videos')
  const c = folder('文档', 'C:\\Users\\U\\Documents')
  const d = folder('不存在', 'C:\\Users\\U\\Gone')
  const e = folder('缓存', 'C:\\Users\\U\\npm-cache')
  const state = installMoverHost({
    sources: [a.sourcePath, b.sourcePath, c.sourcePath, e.sourcePath],
    destDirs: ['D:\\ZToolsMoved\\Downloads'],
    destFiles: ['D:\\ZToolsMoved\\Videos']
  })
  state.sources.set(lower(c.sourcePath), { isJunction: true })
  const res = await mover.executeDirectoryMove([a, b, c, d, e], 'D:\\ZToolsMoved')
  assert.equal(res.ok, false)
  assert.deepEqual(res.results.map(r => r.status), ['skipped', 'skipped', 'skipped', 'skipped', 'moved'])
  assert.match(res.results[0].detail, /已有同名文件夹/)
  assert.match(res.results[1].detail, /已有同名文件/)
  assert.match(res.results[2].detail, /联接/)
  assert.match(res.results[3].detail, /不存在/)
  assert.deepEqual(state.relocated.map(p => p.sourcePath), [e.sourcePath])
  assert.deepEqual(state.deleted, [])
  assert.match(res.message, /跳过 4 个/)
})

test('无法读取原目录状态或无法确认目标位置时不迁移', async () => {
  const a = folder('下载', 'C:\\Users\\U\\Downloads')
  const state = installMoverHost({ sources: [a.sourcePath] })
  state.scanError = internalError()
  const res = await mover.executeDirectoryMove([a], 'D:\\ZToolsMoved')
  assert.equal(res.ok, false)
  assert.match(res.message, /无法确认原目录状态/)
  assert.deepEqual(state.relocated, [])

  state.scanError = null
  state.existsError = Object.assign(new Error('路径未由当前窗口授权'), { code: 'PERMISSION_DENIED' })
  const denied = await mover.executeDirectoryMove([a], 'D:\\ZToolsMoved')
  assert.equal(denied.results[0].status, 'skipped')
  assert.match(denied.results[0].detail, /未由当前窗口授权/)
  assert.deepEqual(state.relocated, [])
})

test('迁移失败且原目录完好：删除本次复制到目标位置的内容，其余目录不再执行', async () => {
  const a = folder('下载', 'C:\\Users\\U\\Downloads')
  const b = folder('文档', 'C:\\Users\\U\\Documents')
  const state = installMoverHost({
    sources: [a.sourcePath, b.sourcePath],
    relocate: (params, dest, s) => {
      s.destDirs.add(lower(dest)) // 复制了一部分后改名失败（目录正被占用）
      throw internalError()
    }
  })
  const res = await mover.executeDirectoryMove([a, b], 'D:\\ZToolsMoved')
  assert.equal(res.ok, false)
  assert.equal(res.movedCount, 0)
  assert.deepEqual(res.results.map(r => r.status), ['failed', 'not_attempted'])
  assert.deepEqual(state.deleted, ['D:\\ZToolsMoved\\Downloads'])
  assert.equal(state.relocated.length, 1)
  assert.match(res.results[0].detail, /宿主内部错误。已删除复制到 D:\\ZToolsMoved\\Downloads 的文件，原目录未改动/)
  assert.match(res.message, /其余 1 个没有执行/)
})

test('迁移失败且目标位置没有留下文件：不删除任何东西', async () => {
  const a = folder('下载', 'C:\\Users\\U\\Downloads')
  const state = installMoverHost({ sources: [a.sourcePath], relocate: () => hostFail('源目录与目标目录均不能为空') })
  const res = await mover.executeDirectoryMove([a], 'D:\\ZToolsMoved')
  assert.equal(res.results[0].status, 'failed')
  assert.match(res.results[0].detail, /源目录与目标目录均不能为空。目标位置没有留下文件/)
  assert.deepEqual(state.deleted, [])
})

test('迁移失败但原位置已是联接、原目录不见了或状态读不到：不删除目标位置，提示手动检查', async () => {
  const a = folder('下载', 'C:\\Users\\U\\Downloads')
  for (const [mutate, pattern] of [
    [(s, src) => s.sources.set(lower(src), { isJunction: true }), /已建立指向.*联接/],
    [(s, src) => s.sources.delete(lower(src)), /\.ztools-mover-bak-/],
    [s => { s.scanError = internalError() }, /无法确认原目录状态/]
  ]) {
    host.reset()
    const state = installMoverHost({
      sources: [a.sourcePath],
      relocate: (params, dest, s) => {
        s.destDirs.add(lower(dest))
        mutate(s, params.sourcePath)
        throw internalError()
      }
    })
    const res = await mover.executeDirectoryMove([a], 'D:\\ZToolsMoved')
    assert.equal(res.results[0].status, 'needs_check')
    assert.match(res.results[0].detail, pattern)
    assert.deepEqual(state.deleted, [])
    assert.ok(!host.ipcCalls.some(([m]) => m === 'filesystem_delete_directory'))
  }
})

test('回滚时删除失败或目标状态读不到：如实提示手动处理', async () => {
  const a = folder('下载', 'C:\\Users\\U\\Downloads')
  const state = installMoverHost({
    sources: [a.sourcePath],
    relocate: (params, dest, s) => {
      s.destDirs.add(lower(dest))
      throw internalError()
    }
  })
  state.deleteError = Object.assign(new Error('文件操作权限不足'), { code: 'PERMISSION_DENIED' })
  const res = await mover.executeDirectoryMove([a], 'D:\\ZToolsMoved')
  assert.equal(res.results[0].status, 'needs_check')
  assert.match(res.results[0].detail, /清理目标位置失败（文件操作权限不足），请手动删除 D:\\ZToolsMoved\\Downloads/)

  host.reset()
  const s2 = installMoverHost({
    sources: [a.sourcePath],
    relocate: (params, dest, s) => {
      s.existsError = internalError()
      throw internalError()
    }
  })
  const res2 = await mover.executeDirectoryMove([a], 'D:\\ZToolsMoved')
  assert.equal(res2.results[0].status, 'needs_check')
  assert.match(res2.results[0].detail, /无法确认目标位置/)
  assert.deepEqual(s2.deleted, [])
})

test('界面：默认不勾选；左侧分类按 Enter 只筛选，不迁移', async () => {
  installScanHost()
  installMoverHost()
  const view = await mount(MoverCommand)
  try {
    const rows = view.items().filter(i => i.props.id.startsWith('mover-item-'))
    assert.equal(rows.length, 2)
    assert.ok(rows.every(r => r.props.checked === false))
    for (const nav of view.items().filter(i => i.props.id.startsWith('nav-mover-'))) {
      const titles = view.actions(nav).map(a => a.props.title)
      assert.ok(titles.every(t => !t.includes('迁移')), titles.join(','))
    }
    await view.run(view.item('nav-mover-all'), '查看全部目录')
    assert.equal(host.confirms.length, 0)
    assert.ok(!host.ipcCalls.some(([, p]) => p?.func === 'relocateWithJunction'))
  } finally { view.unmount() }
})

test('界面：未勾选时按 Enter 只提示；勾选后需确认并授权，取消任一步都不迁移', async () => {
  installScanHost()
  const state = installMoverHost({ sources: ['C:\\Users\\U\\Downloads'] })
  const view = await mount(MoverCommand)
  try {
    const row = () => view.item('mover-item-mover_downloads')
    await view.run(row(), '迁移已勾选的 0 个目录')
    assert.equal(host.lastToast().style, 'FAILURE')
    assert.match(host.lastToast().message, /请先勾选/)
    assert.equal(host.confirms.length, 0)

    row().props.onCheckChange(true)
    await tick()
    host.setConfirm(false)
    await view.run(row(), '迁移已勾选的 1 个目录')
    assert.equal(host.confirms.length, 1)
    assert.equal(host.confirms[0].primaryAction.style, 'destructive')
    assert.match(host.confirms[0].message, /C:\\Users\\U\\Downloads/)
    assert.ok(!host.ipcCalls.some(([m]) => m === 'window_show_select_folder_dialog'))
    assert.deepEqual(state.relocated, [])

    host.setConfirm(true)
    host.ipc.window_show_select_folder_dialog = () => ({ canceled: true })
    await view.run(row(), '迁移已勾选的 1 个目录')
    assert.deepEqual(state.relocated, [])
    assert.match(view.tree().props.filterBar.summaryText, /已取消/)

    host.ipc.window_show_select_folder_dialog = () => ({ canceled: false, folderPath: 'D:\\' })
    await view.run(row(), '迁移已勾选的 1 个目录')
    assert.deepEqual(state.relocated, [{ sourcePath: 'C:\\Users\\U\\Downloads', targetRoot: 'D:\\ZToolsMoved' }])
    assert.equal(host.lastToast().style, 'SUCCESS')
    assert.equal(host.lastToast().title, '已迁移 1 个目录')
    assert.equal(view.tree().props.isLoading, false)
  } finally { view.unmount() }
})

test('界面：迁移失败时提示失败与清理结果', async () => {
  installScanHost()
  const state = installMoverHost({
    sources: ['C:\\Users\\U\\Downloads'],
    relocate: (params, dest, s) => {
      s.destDirs.add(lower(dest))
      throw internalError()
    }
  })
  const view = await mount(MoverCommand)
  try {
    const row = () => view.item('mover-item-mover_downloads')
    row().props.onCheckChange(true)
    await tick()
    await view.run(row(), '迁移已勾选的 1 个目录')
    assert.equal(host.lastToast().style, 'FAILURE')
    assert.equal(host.lastToast().title, '迁移失败')
    assert.match(host.lastToast().message, /已删除复制到/)
    assert.deepEqual(state.deleted, ['D:\\ZToolsMoved\\Downloads'])
  } finally { view.unmount() }
})

test('界面：不在客户端时显示空状态，不显示示例目录', async () => {
  const saved = globalThis.__ztoolsElectron
  delete globalThis.__ztoolsElectron
  try {
    const view = await mount(MoverCommand)
    try {
      assert.equal(view.items().filter(i => i.props.id.startsWith('mover-item-')).length, 0)
      assert.match(view.text(), /需要在 ZTools 客户端中使用/)
      assert.doesNotMatch(view.text(), /C:\\\\Users\\\\Default|System32/)
    } finally { view.unmount() }
  } finally {
    globalThis.__ztoolsElectron = saved
  }
})
