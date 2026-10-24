// 目录读取集成测试：目录不存在 / 为空 / 无权限时不能用全盘搜索结果冒充目录内容；只改名直接子文件；拒绝 macOS 受保护目录
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHost, installDirectoryHost, mount, tick } from '../../shared/test-harness.mjs'
import * as logic from '../dist/logic.js'
import { listRealDirectoryContentsResult, scanRealDirectoryTree } from '../dist/native-ipc.js'
import BatchRenameCommand from '../dist/index.js'

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-rename-dir-'))
const downloads = path.join(home, 'Downloads')
const documents = path.join(home, 'Documents')
fs.mkdirSync(path.join(downloads, 'sub'), { recursive: true })
fs.mkdirSync(documents)
fs.writeFileSync(path.join(downloads, 'a.txt'), 'a')
fs.writeFileSync(path.join(downloads, 'b.jpg'), Buffer.alloc(2048))
fs.writeFileSync(path.join(downloads, 'sub', 'deep-big.bin'), Buffer.alloc(64 * 1024))
// Desktop / Pictures 不存在
const GLOBAL_HITS = ['/Applications/workspace/repo/downloads-service.js', '/Library/Developer/BEDownloads.h']

test.after(() => fs.rmSync(home, { recursive: true, force: true }))

async function setup({ authorized = [], paths = {} } = {}) {
  const host = createHost()
  host.reset()
  await installDirectoryHost(host, { authorized, globalHits: GLOBAL_HITS })
  const map = { home, downloads, documents, desktop: path.join(home, 'Desktop'), pictures: path.join(home, 'Pictures'), ...paths }
  host.ipc.system_get_path = async ({ name }) => map[name] || ''
  return host
}

const keywordSearches = (host) =>
  host.ipcCalls.filter(([m, p]) => m === 'system_search_files' && !String(p?.query || '').startsWith('dir:'))

test('batch-rename: 只加载目录的直接子文件，不把子目录里的深层大文件算进来', async () => {
  const host = await setup()
  const res = await logic.fetchRealBatchRenameFiles('downloads')
  assert.deepEqual(res.files.map((f) => f.name).sort(), ['a.txt', 'b.jpg'])
  for (const f of res.files) assert.equal(path.dirname(f.fullPath), downloads)
  assert.equal(res.error, undefined)
  assert.equal(keywordSearches(host).length, 0)
})

test('batch-rename: 目录不存在且未授权时返回空列表与错误码，绝不回退全盘关键词搜索', async () => {
  const host = await setup()
  const res = await logic.fetchRealBatchRenameFiles('desktop')
  assert.equal(res.files.length, 0)
  assert.ok(res.error, '应返回错误码')
  assert.equal(keywordSearches(host).length, 0, '不应发起 mdfind / MFT 关键词搜索')

  const listing = await listRealDirectoryContentsResult(path.join(home, 'Desktop'))
  assert.deepEqual(listing.entries, [])
  assert.match(listing.error, /未授权|PERMISSION/)
})

test('batch-rename: 已授权的空目录与已授权但不存在的目录都如实为空', async () => {
  const host = await setup({ authorized: [home] })
  const empty = await logic.fetchRealBatchRenameFiles('documents')
  assert.equal(empty.files.length, 0)
  assert.equal(empty.error, 'DIRECTORY_EMPTY_OR_UNREADABLE')
  const missing = await logic.fetchRealBatchRenameFiles('pictures')
  assert.equal(missing.files.length, 0)
  assert.match(missing.error, /目录不存在|FILE_NOT_FOUND/)
  assert.equal(keywordSearches(host).length, 0)
})

test('batch-rename: dir: 扫描不可用时按宿主真实结构 {files:[{name}]} 解析并拼接完整路径，拒绝越界条目', async () => {
  const host = await setup({ authorized: [home] })
  host.ipc.system_search_files = async () => {
    throw Object.assign(new Error('索引服务重启中'), { code: 'SERVICE_UNAVAILABLE' })
  }
  host.ipc.filesystem_get_directory_contents = async () => ({
    success: true,
    files: [
      { name: 'report.docx', size: 10, isDirectory: false, lastModified: '2026/1/1 10:00:00' },
      { name: 'folder', size: 0, isDirectory: true },
      { name: '../escape.txt', size: 1, isDirectory: false },
      { name: '/etc/passwd', size: 1, isDirectory: false },
      { name: '..', size: 0, isDirectory: true },
      { name: '', size: 0, isDirectory: false },
      null,
      42
    ]
  })
  const res = await logic.fetchRealBatchRenameFiles('downloads')
  assert.deepEqual(res.files.map((f) => f.fullPath), [path.join(downloads, 'report.docx')])
  assert.equal(res.files[0].sizeBytes, 10)

  // 畸形载荷：既不是数组也没有 files
  host.ipc.filesystem_get_directory_contents = async () => ({ success: true, items: 'garbage' })
  const bad = await logic.fetchRealBatchRenameFiles('downloads')
  assert.equal(bad.files.length, 0)
  assert.equal(bad.error, 'INVALID_DIRECTORY_PAYLOAD')
})

test('batch-rename: 带后缀过滤的目录扫描不会把目录外的同后缀全盘检索结果混进来', async () => {
  await setup()
  const scan = await scanRealDirectoryTree(downloads, { maxFiles: 50, filterExt: /\.(mp4|mkv)$/i })
  assert.equal(scan.files.length, 0)
})

test('batch-rename: 拒绝 macOS 受保护目录（/System、/Library、/usr、~/Library），其余目录不误伤', async () => {
  for (const p of ['/System/Library/a.txt', '/Library/Developer/x.h', '/usr/share/man/a.1', '/Users/bin/Library/Caches/a.db']) {
    assert.ok(logic.FORBIDDEN_TARGET_PATTERN.test(p), p)
  }
  for (const p of ['/Users/bin/Downloads/a.txt', '/Users/bin/Documents/Library/a.txt', '/private/tmp/x/a.txt', 'LibraryNotes.txt']) {
    assert.ok(!logic.FORBIDDEN_TARGET_PATTERN.test(p), p)
  }
  const host = await setup()
  host.ipc.filesystem_move_file = async () => ({ success: true })
  const res = await logic.executeRealFileRename('/Library/Developer/x.h', 'y.h')
  assert.equal(res.ok, false)
  assert.equal(host.ipcCalls.filter(([m]) => m === 'filesystem_move_file').length, 0)
})

test('batch-rename 界面：Downloads 不存在时显示空态提示，不列出、不勾选任何文件', async () => {
  const host = await setup({ paths: { downloads: path.join(home, 'NoSuchDownloads') } })
  const view = await mount(BatchRenameCommand, host)
  await tick(20)
  const text = view.text()
  assert.match(text, /目录不存在、为空或无权限读取/)
  for (const hit of GLOBAL_HITS) assert.ok(!text.includes(path.basename(hit)), `不应出现 ${hit}`)
  assert.equal(keywordSearches(host).length, 0)
  view.unmount()
})
