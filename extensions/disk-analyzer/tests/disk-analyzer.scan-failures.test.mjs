// 逐目录降级：某些目录扫描失败（macOS 用户拒绝访问「文稿 / 桌面 / 下载」、外接卷不可读、宿主返回 degraded / partial）
// 时，可读目录照常展示，失败目录连同原因如实列出；全部失败才算扫描失败。真实声明式运行时 + 模拟 macOS 宿主。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import DiskAnalyzerCommand from '../dist/index.js'
import { fetchDiskAnalysisSnapshot, describeScanFailure } from '../dist/logic.js'

const host = createHost()
const MB = 1024 * 1024
const HOME = '/Users/tester'
const DOWNLOADS = `${HOME}/Downloads`
const DOCUMENTS = `${HOME}/Documents`
const DESKTOP = `${HOME}/Desktop`
const EXT = '/Volumes/外置盘'

const rejections = []
process.on('unhandledRejection', (reason) => rejections.push(reason))

const fail = (message, code = 'PERMISSION_DENIED') => Object.assign(new Error(message), { code })

/**
 * failures: 目录 → 'denied'（宿主报权限不足）| 'degraded'（宿主返回 degraded）| 'partial' | 'throw'（普通异常）
 */
function installHost(failures = {}) {
  const scanned = []
  host.ipc.system_list_volumes = async () => ({ volumes: [
    { path: '/', label: 'Macintosh HD', fileSystem: 'APFS', totalBytes: 500 * 1024 ** 3, usedBytes: 100 * 1024 ** 3, availableBytes: 400 * 1024 ** 3, capacityGroup: 'disk3' },
    { path: EXT, label: '外置盘', fileSystem: 'ExFAT', totalBytes: 100 * 1024 ** 3, usedBytes: 10 * 1024 ** 3, availableBytes: 90 * 1024 ** 3, capacityGroup: 'disk9' }
  ], partial: false, errors: [] })
  host.ipc.system_get_path = async ({ name }) => {
    const map = { home: HOME, downloads: DOWNLOADS, documents: DOCUMENTS, desktop: DESKTOP, videos: `${HOME}/Movies`, temp: '/private/var/folders/ab/T' }
    return { success: true, path: map[name] || `${HOME}/${name}` }
  }
  host.ipc.system_search_files = async ({ query }) => {
    const dir = String(query).slice(4)
    scanned.push(dir)
    const mode = failures[dir]
    if (mode === 'denied') throw fail('文件操作权限不足')
    if (mode === 'throw') throw fail('设备未就绪', 'FILE_ERROR')
    const files = dir === DOWNLOADS
      ? [{ name: 'movie.mp4', path: `${DOWNLOADS}/movie.mp4`, size: 700 * MB, is_dir: false, mtime: 1_700_000_000 }]
      : dir === EXT
      ? [{ name: 'backup.zip', path: `${EXT}/backup.zip`, size: 300 * MB, is_dir: false, mtime: 1_700_000_000 }]
      : []
    return {
      files, subdirs: [], count: files.length, total_matches: files.length, total_bytes: files.reduce((s, f) => s + f.size, 0),
      truncated: false, visited_entries: files.length,
      ...(mode === 'degraded' ? { degraded: true } : {}),
      ...(mode === 'partial' ? { partial: true } : {})
    }
  }
  return { scanned }
}

async function mountLoaded() {
  const view = await mount(DiskAnalyzerCommand)
  await tick(30)
  return view
}
const failSection = (view) => (view.tree().children || []).find((c) => c?.type === 'List.Section' && String(c.props.title).startsWith('未能扫描的目录'))
const fileTitles = (view) => view.tree().props.subList.items.map((it) => it.props.title)
const rescan = (view) => view.tree().props.filterBar.actions.find((a) => a.id === 'act-rescan').onAction()

test.beforeEach(() => {
  host.reset()
  rejections.length = 0
})

test('部分目录失败：其余目录照常返回，失败目录与原因逐一列出（权限类附带系统设置指引），不编造数据', async () => {
  const { scanned } = installHost({ [DOCUMENTS]: 'denied', [DESKTOP]: 'degraded', [EXT]: 'partial' })
  const snap = await fetchDiskAnalysisSnapshot()
  assert.ok(scanned.includes(DOWNLOADS) && scanned.includes(EXT) && scanned.includes('/'))
  assert.deepEqual(snap.files.map((f) => f.path), [`${DOWNLOADS}/movie.mp4`], '失败与不完整目录的内容不进入结果')
  assert.deepEqual(snap.failedScans.map((f) => f.path).sort(), [DESKTOP, DOCUMENTS, EXT].sort())
  const byPath = Object.fromEntries(snap.failedScans.map((f) => [f.path, f.reason]))
  assert.equal(byPath[DOCUMENTS], '文件操作权限不足（可在「系统设置 › 隐私与安全性 › 文件与文件夹」中允许 ZTools 访问后重新扫描）')
  // degraded / partial：宿主没给完整结果，去掉重复的目录前缀，macOS 补上去哪里授权
  const incomplete = '目录扫描未完整返回，请检查访问权限后重试（可在「系统设置 › 隐私与安全性 › 文件与文件夹」中允许 ZTools 访问后重新扫描）'
  assert.equal(byPath[DESKTOP], incomplete)
  assert.equal(byPath[EXT], incomplete)
  assert.equal(snap.drives.length, 2, '分区容量照常')
})

test('全部目录失败：整体报失败，错误里列出每个目录的原因', async () => {
  installHost(Object.fromEntries([DOWNLOADS, DOCUMENTS, DESKTOP, `${HOME}/Movies`, '/private/var/folders/ab/T', `${HOME}/Library/Caches`, '/', EXT].map((d) => [d, 'throw'])))
  await assert.rejects(fetchDiskAnalysisSnapshot(), (error) => {
    assert.match(error.message, /^所有目录都未能扫描：/)
    assert.ok(error.message.includes(`${DOWNLOADS}：设备未就绪`))
    assert.ok(error.message.includes(`${EXT}：设备未就绪`))
    return true
  })
})

test('全部成功：failedScans 为空数组', async () => {
  installHost()
  const snap = await fetchDiskAnalysisSnapshot()
  assert.deepEqual(snap.failedScans, [])
  assert.deepEqual(snap.files.map((f) => f.path).sort(), [`${DOWNLOADS}/movie.mp4`, `${EXT}/backup.zip`].sort())
})

test('界面：部分失败时列表照常展示，左侧列出未能扫描的目录，状态条与重新扫描提示如实说明；恢复后失败列表清空', async () => {
  installHost({ [DOCUMENTS]: 'denied', [EXT]: 'throw' })
  const view = await mountLoaded()
  assert.deepEqual(fileTitles(view), ['movie.mp4'])
  const summary = view.tree().props.filterBar.summaryText
  assert.match(summary, /2 个目录未能扫描（见左侧列表）/)
  assert.doesNotMatch(summary, /扫描失败/)
  const section = failSection(view)
  assert.ok(section, '有「未能扫描的目录」分组')
  assert.equal(section.props.title, '未能扫描的目录 (2)')
  const docs = view.item(`scanfail-${DOCUMENTS}`)
  assert.equal(docs.props.title, 'Documents')
  assert.match(docs.props.subtitle, /文件操作权限不足（可在「系统设置/)
  assert.equal(view.item(`scanfail-${EXT}`).props.subtitle, '设备未就绪')
  // 同一功能只出现一次：重新扫描只在顶部状态条
  const titles = view.actions(docs).map((a) => a.props.title)
  assert.deepEqual(titles, ['复制目录路径', '复制失败原因'])
  // 自动首次扫描不弹成功提示
  assert.ok(!host.toasts.some((t) => t.style === 'SUCCESS'))

  // 手动重新扫描仍部分失败：失败提示，不报「完成」
  await rescan(view)
  await tick(30)
  const t = host.toasts.filter((x) => x.style !== 'ANIMATED').at(-1)
  assert.equal(t.style, 'FAILURE')
  assert.equal(t.title, '扫描部分完成：2 个目录未能读取')
  assert.ok(t.message.includes(`${EXT}（设备未就绪）`))

  // 用户授权后重新扫描：失败分组消失，提示成功
  installHost()
  await rescan(view)
  await tick(30)
  assert.equal(failSection(view), undefined)
  assert.doesNotMatch(view.tree().props.filterBar.summaryText, /未能扫描/)
  assert.equal(host.toasts.filter((x) => x.style !== 'ANIMATED').at(-1).style, 'SUCCESS')
  assert.deepEqual(fileTitles(view).sort(), ['backup.zip', 'movie.mp4'])
  view.unmount()
  assert.equal(rejections.length, 0)
})

test('界面：全部目录失败时报扫描失败，不显示空的「完成」结果', async () => {
  installHost(Object.fromEntries([DOWNLOADS, DOCUMENTS, DESKTOP, `${HOME}/Movies`, '/private/var/folders/ab/T', `${HOME}/Library/Caches`, '/', EXT].map((d) => [d, 'denied'])))
  const view = await mountLoaded()
  assert.match(view.tree().props.filterBar.summaryText, /^扫描失败，显示内容可能已过期：所有目录都未能扫描/)
  const t = host.lastToast()
  assert.equal(t.style, 'FAILURE')
  assert.equal(t.title, '磁盘扫描失败')
  assert.ok(!host.toasts.some((x) => x.style === 'SUCCESS'))
  view.unmount()
})

test('失败原因整理：去掉目录前缀、空值兜底、Windows 路径给通用权限提示、非权限错误原样', () => {
  assert.equal(describeScanFailure('/a', new Error('/a: 目录扫描结果无效')), '目录扫描结果无效')
  assert.equal(describeScanFailure('/a', new Error('')), '目录扫描失败')
  assert.equal(describeScanFailure('/a', undefined), '目录扫描失败')
  assert.equal(describeScanFailure('D:\\', new Error('PERMISSION_DENIED')), 'PERMISSION_DENIED（请确认当前账户有权读取该目录后重新扫描）')
  assert.equal(describeScanFailure('/a', 'EPERM: operation not permitted'), 'EPERM: operation not permitted（可在「系统设置 › 隐私与安全性 › 文件与文件夹」中允许 ZTools 访问后重新扫描）')
  assert.equal(describeScanFailure('/a', new Error('设备未就绪')), '设备未就绪')
})
