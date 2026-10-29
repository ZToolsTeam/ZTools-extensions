// 界面级集成测试：扫描默认勾选、清理范围、失败提示、扫描失败与非客户端空状态
import test from 'node:test'
import assert from 'node:assert/strict'
import { Toast } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import CleanerCommand from '../dist/index.js'
import * as logic from '../dist/logic.js'

const HOME = 'C:\\Users\\tester'
const LOCAL = `${HOME}\\AppData\\Local`
const TEMP = `${LOCAL}\\Temp`
const WPS = `${LOCAL}\\Kingsoft\\WPS Office\\backup`
const DOWNLOADS = `${HOME}\\Downloads`

const entry = (path, size) => ({ name: path.split('\\').pop(), path, is_dir: false, size, mtime: 1725000000 })

function installCleanerHost(host, { homeOk = true } = {}) {
  host.ipc.system_get_path = async ({ name }) => {
    if (!homeOk) throw new Error('读取失败')
    const map = { home: HOME, temp: `${HOME}\\PluginTemp`, downloads: DOWNLOADS, appData: `${HOME}\\AppData\\Roaming` }
    if (!map[name]) throw new Error(`未知目录 ${name}`)
    return { path: map[name] }
  }
  host.ipc.system_list_common_folders = async () => ({ folders: [{ id: 'temp', path: TEMP, exists: true }] })
  host.ipc.system_get_disk_usage = async () => ({ total: 500e9, used: 400e9, available: 100e9, percent: 80 })
  const tree = {
    [TEMP]: [entry(`${TEMP}\\a.tmp`, 3000), entry(`${TEMP}\\b.tmp`, 2000)],
    [WPS]: [entry(`${WPS}\\report.docx.bak`, 5000)],
    [DOWNLOADS]: [entry(`${DOWNLOADS}\\setup.exe`, 9000)]
  }
  host.ipc.system_search_files = async ({ query }) => {
    const files = tree[String(query).slice(4)] || []
    return { files, subdirs: [], total_matches: files.length, total_bytes: files.reduce((s, f) => s + f.size, 0) }
  }
  host.dllCalls = []
  host.ipc.dllplugin_call = async payload => {
    host.dllCalls.push(payload)
    throw new Error('测试宿主不提供原生组件')
  }
}

async function waitFor(view, predicate, rounds = 200) {
  for (let i = 0; i < rounds; i++) {
    if (predicate(view.tree())) return
    await tick(2)
  }
  throw new Error('等待界面状态超时')
}

const subItems = view => view.tree().props.subList.items
const loaded = t => t.props.isLoading === false && t.props.subList.items.length > 0
const cleanAction = (view, item) => view.actions(item).find(a => a.props.title.startsWith('清理已勾选'))

test('默认勾选安全缓存，WPS 备份与“下载”里的文件默认不勾选；清理只处理勾选的样本文件，不调用整类清理接口', async () => {
  const host = createHost()
  installCleanerHost(host)
  const view = await mount(CleanerCommand)
  await waitFor(view, loaded)

  const temp = subItems(view).find(it => it.props.id === 'group-sys-temp')
  const wps = subItems(view).find(it => it.props.id === 'group-wps-backup')
  const downloads = subItems(view).find(it => it.props.id === 'group-downloads-installers')
  assert.equal(temp.props.checked, true)
  assert.equal(wps.props.checked, false)
  assert.equal(downloads.props.checked, false)
  assert.match(temp.props.subtitle, /可清理最大的 2 个/)
  assert.match(view.tree().props.filterBar.summaryText, /C 盘可用 \d/)

  const trashed = []
  host.ipc.shell_trash_item = async ({ fullPath }) => {
    trashed.push(fullPath)
    return { success: true }
  }
  await cleanAction(view, temp).props.onAction()
  await tick(20)
  assert.equal(host.confirms.length, 1)
  assert.match(host.confirms[0].title, /把 2 个文件移入回收站/)
  assert.deepEqual(trashed.sort(), [`${TEMP}\\a.tmp`, `${TEMP}\\b.tmp`])
  assert.equal(host.dllCalls.length, 0, '清理不能走整类清理接口')
  const done = host.toasts.find(t => /回收站/.test(t.title))
  assert.equal(done.style, Toast.Style.Success)
  assert.equal(done.title, '已移入回收站 2 个文件')
})

test('勾选的项目没有样本文件时不弹确认、不调用宿主，提示没有勾选', async () => {
  const host = createHost()
  installCleanerHost(host)
  const view = await mount(CleanerCommand)
  await waitFor(view, loaded)
  const temp = subItems(view).find(it => it.props.id === 'group-sys-temp')
  temp.props.onCheckChange(false)
  await tick(5)
  // 浏览器缓存等规则没有扫描到文件，不能勾选
  const edge = subItems(view).find(it => it.props.id === 'group-browser-edge')
  assert.equal(edge.props.checkable, false)
  // 重新取最新渲染的条目（动作闭包随渲染更新）
  await cleanAction(view, subItems(view)[0]).props.onAction()
  await tick(10)
  assert.equal(host.confirms.length, 0)
  assert.equal(host.lastToast().title, '没有勾选任何文件')
  assert.equal(host.dllCalls.length, 0)
})

test('部分文件移入回收站失败时提示失败数量与原因', async () => {
  const host = createHost()
  installCleanerHost(host)
  const view = await mount(CleanerCommand)
  await waitFor(view, loaded)
  host.ipc.shell_trash_item = async ({ fullPath }) => {
    if (fullPath.endsWith('b.tmp')) throw Object.assign(new Error('文件被占用'), { code: 'SHELL_ERROR' })
    return { success: true }
  }
  await cleanAction(view, subItems(view)[0]).props.onAction()
  await tick(20)
  const toast = host.toasts.find(t => /回收站|失败/.test(t.title) && t.style !== Toast.Style.Animated)
  assert.equal(toast.style, Toast.Style.Failure)
  assert.equal(toast.title, '1 个文件未能移入回收站')
  assert.match(toast.message, /文件被占用/)
})

test('取消确认不删除任何文件；样本文件明细里可逐个勾选', async () => {
  const host = createHost()
  installCleanerHost(host)
  const view = await mount(CleanerCommand)
  await waitFor(view, loaded)
  const trashed = []
  host.ipc.shell_trash_item = async ({ fullPath }) => {
    trashed.push(fullPath)
    return { success: true }
  }
  host.setConfirm(false)
  await cleanAction(view, subItems(view)[0]).props.onAction()
  await tick(10)
  assert.deepEqual(trashed, [])

  view.item('nav-clean-files').props.onSelect()
  await tick(5)
  const wpsFile = subItems(view).find(it => it.props.title === 'report.docx.bak')
  assert.equal(wpsFile.props.checked, false)
  wpsFile.props.onCheckChange(true)
  await tick(5)
  host.setConfirm(true)
  await cleanAction(view, subItems(view)[0]).props.onAction()
  await tick(20)
  assert.match(host.confirms.at(-1).message, /需要核对的项目/)
  assert.ok(trashed.includes(`${WPS}\\report.docx.bak`))
  assert.equal(trashed.includes(`${DOWNLOADS}\\setup.exe`), false, '没勾选的文件不能被清理')
})

test('读取不到用户目录时提示扫描失败，不扫描默认用户目录、不显示示例数据', async () => {
  const host = createHost()
  installCleanerHost(host, { homeOk: false })
  const view = await mount(CleanerCommand)
  await waitFor(view, t => t.props.isLoading === false)
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.equal(host.lastToast().title, '扫描失败')
  assert.match(view.tree().props.filterBar.summaryText, /扫描失败/)
  assert.equal(subItems(view).length, 0)
  assert.equal(host.ipcCalls.some(([m, p]) => m === 'system_search_files' && /Default/.test(p.query)), false)
})

test('清空回收站：确认后调用客户端，失败如实提示', async () => {
  const host = createHost()
  installCleanerHost(host)
  const view = await mount(CleanerCommand)
  await waitFor(view, loaded)
  await view.run(subItems(view)[0], '清空系统回收站')
  assert.match(host.confirms.at(-1).message, /永久删除/)
  assert.equal(host.lastToast().title, '清空回收站失败')

  host.ipc.dllplugin_call = async () => ({ ok: true, success: true, removedCount: 4, message: '已清空系统回收站（4 项）' })
  await view.run(subItems(view)[0], '清空系统回收站')
  await tick(10)
  const okToast = host.toasts.filter(t => t.title === '回收站已清空').at(-1)
  assert.equal(okToast.message, '已清空系统回收站（4 项）')
})

test('不在客户端中运行时只显示空状态，不显示示例数据', async () => {
  createHost()
  const saved = globalThis.__ztoolsElectron
  delete globalThis.__ztoolsElectron
  try {
    const view = await mount(CleanerCommand)
    assert.match(view.text(), /需要在 ZTools 客户端中使用/)
    assert.doesNotMatch(view.text(), /GB|Admin|msedge/)
    assert.equal(view.items().length, 1)
  } finally {
    globalThis.__ztoolsElectron = saved
  }
})

test('目录读取兜底结果里的子目录不会成为样本文件', async () => {
  const hostOverride = {
    system_list_common_folders: async () => ({ folders: [{ id: 'temp', path: TEMP, exists: true }] }),
    system_get_path: async ({ name }) => ({ path: name === 'home' ? HOME : name === 'temp' ? TEMP : `${HOME}\\${name}` }),
    system_search_files: async () => ({ files: [], subdirs: [], total_matches: 0 }),
    filesystem_get_directory_contents: async ({ path }) =>
      path === TEMP
        ? { success: true, files: [{ name: 'sub', size: 0, isDirectory: true }, { name: 'x.tmp', size: 10, isDirectory: false }] }
        : { success: true, files: [] }
  }
  const { groups } = await logic.fetchCleanRulesAndScan(hostOverride)
  const temp = groups.find(g => g.id === 'group-sys-temp')
  assert.deepEqual(temp.sampleFiles.map(f => f.path), [`${TEMP}\\x.tmp`])
})


test('TEMP 读取失败时显示错误，不退回插件隔离目录', async () => {
  const host = createHost(); installCleanerHost(host);
  host.ipc.system_list_common_folders = async () => { throw new Error('读取用户 TEMP 失败') };
  await assert.rejects(() => logic.fetchCleanRulesAndScan(), /读取用户 TEMP 失败/);
  assert.equal(host.ipcCalls.some(([m]) => m === 'system_search_files'), false);
});
