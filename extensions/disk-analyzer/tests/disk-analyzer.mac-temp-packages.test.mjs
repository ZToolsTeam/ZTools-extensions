// 临时目录取系统临时目录（不扫描插件自己的隔离临时目录）；macOS 图库 / 虚拟机等包内部文件受保护；未知修改时间不冒充当前时间
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost } from '../../shared/test-harness.mjs'
import { fetchDiskAnalysisSnapshot, getSystemTempDir, FORBIDDEN_TARGET_PATTERN, formatDateTime, trashName } from '../dist/logic.js'

const host = createHost()
const MB = 1024 * 1024
const HOME = '/Users/tester'
const SCOPED_TEMP = `${HOME}/Library/Application Support/ZTools/Cache/main/Temp`
const SYSTEM_TEMP = '/private/var/folders/ab/xyz/T'

function installHost({ commonFolders = true } = {}) {
  host.reset()
  const scanned = []
  host.ipc.system_list_volumes = async () => ({ volumes: [
    { path: '/', label: 'Macintosh HD', fileSystem: 'APFS', totalBytes: 500 * 1024 ** 3, usedBytes: 100 * 1024 ** 3, availableBytes: 400 * 1024 ** 3, capacityGroup: 'disk3' }
  ], partial: false, errors: [] })
  host.ipc.system_get_path = async ({ name }) => {
    const map = { home: HOME, downloads: `${HOME}/Downloads`, documents: `${HOME}/Documents`, desktop: `${HOME}/Desktop`, videos: `${HOME}/Movies`, temp: SCOPED_TEMP }
    return { success: true, path: map[name] || `${HOME}/${name}` }
  }
  if (commonFolders) {
    host.ipc.system_list_common_folders = async () => ({ success: true, data: { folders: [
      { id: 'home', path: HOME, exists: true }, { id: 'temp', path: SYSTEM_TEMP, exists: true }
    ] } })
  } else {
    host.ipc.system_list_common_folders = async () => { throw Object.assign(new Error('未知方法'), { code: 'METHOD_NOT_FOUND' }) }
  }
  host.ipc.system_search_files = async ({ query }) => {
    const dir = String(query).slice(4)
    scanned.push(dir)
    const files = dir === `${HOME}/Movies`
      ? [
          { name: 'clip.mov', path: `${HOME}/Movies/iMovie Library.imovielibrary/2026/Original Media/clip.mov`, size: 900 * MB, is_dir: false, mtime: 1_700_000_000 },
          { name: 'final.mp4', path: `${HOME}/Movies/final.mp4`, size: 500 * MB, is_dir: false, mtime: 0 }
        ]
      : []
    return { files, subdirs: [], count: files.length, total_matches: files.length, truncated: false, visited_entries: files.length }
  }
  return { scanned }
}

test('临时目录用宿主 system_list_common_folders 的系统临时目录，不扫描插件自己的隔离临时目录', async () => {
  const { scanned } = installHost()
  await fetchDiskAnalysisSnapshot()
  assert.ok(scanned.includes(SYSTEM_TEMP))
  assert.ok(!scanned.includes(SCOPED_TEMP))
})

test('旧宿主没有常用目录接口时不扫描临时目录，也不拿插件隔离目录冒充', async () => {
  const { scanned } = installHost({ commonFolders: false })
  assert.equal(await getSystemTempDir(), '')
  await fetchDiskAnalysisSnapshot()
  assert.ok(!scanned.includes(SCOPED_TEMP))
  assert.ok(scanned.includes(`${HOME}/Downloads`))
})

test('iMovie / 照片图库、虚拟机等包内部文件受保护，包外同目录文件可清理；未知修改时间显示为未知', async () => {
  installHost()
  const snap = await fetchDiskAnalysisSnapshot()
  const inLibrary = snap.files.find(f => f.name === 'clip.mov')
  const outside = snap.files.find(f => f.name === 'final.mp4')
  assert.equal(inLibrary.isProtected, true)
  assert.equal(outside.isProtected, false)
  assert.equal(outside.mtime, 0)
  assert.equal(formatDateTime(outside.mtime), '未知时间')
  for (const p of [
    `${HOME}/Pictures/Photos Library.photoslibrary/originals/A/IMG.heic`,
    `${HOME}/Parallels/Win.pvm/disk.hdd`,
    '/Applications/Foo.app/Contents/Frameworks/x.dylib'
  ]) assert.ok(FORBIDDEN_TARGET_PATTERN.test(p), p)
  assert.ok(!FORBIDDEN_TARGET_PATTERN.test(`${HOME}/Downloads/Foo.app.zip`))
  assert.equal(trashName(`${HOME}/a`), '废纸篓')
  assert.equal(trashName('D:\\a'), '回收站')
})

test('个别卷读不到容量时其余分区照常分析，读不到的卷如实列入未能扫描；全部卷失败才报错', async () => {
  installHost()
  host.ipc.system_list_volumes = async () => ({ volumes: [
    { path: '/', label: 'Macintosh HD', fileSystem: 'APFS', totalBytes: 500 * 1024 ** 3, usedBytes: 100 * 1024 ** 3, availableBytes: 400 * 1024 ** 3, capacityGroup: 'disk3' }
  ], partial: true, errors: ['/Volumes/网络盘: 卷容量无效'] })
  const snap = await fetchDiskAnalysisSnapshot()
  assert.deepEqual(snap.drives.map(d => d.drive), ['/'])
  assert.deepEqual(snap.failedScans.find(f => f.path === '/Volumes/网络盘'), { path: '/Volumes/网络盘', reason: '卷容量读取失败：卷容量无效' })
  assert.ok(snap.files.some(f => f.name === 'final.mp4'))
  host.ipc.system_list_volumes = async () => ({ volumes: [], partial: true, errors: ['/: 卷容量无效'] })
  await assert.rejects(fetchDiskAnalysisSnapshot(), /没有读取到已挂载卷：\/: 卷容量无效/)
})
