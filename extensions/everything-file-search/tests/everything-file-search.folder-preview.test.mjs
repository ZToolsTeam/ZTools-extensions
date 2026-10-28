// 文件夹即时预览集成测试：只显示直接子项（不能用深层 Top-N 大文件冒充），按路径去重，扫描到上限时如实标注「仅显示部分」
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHost, installDirectoryHost } from '../../shared/test-harness.mjs'
import { getFileQuickLook } from '../dist/search-service.js'
import { listDirectChildren } from '../dist/native-ipc.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'efs-folder-'))
test.after(() => fs.rmSync(root, { recursive: true, force: true }))

function writeFile(p, size) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, Buffer.alloc(size))
}

// artifacts/ 只有 2 个直接子目录，深层各有多个同名大文件（复现「Electron Framework ×4」）
const artifacts = path.join(root, 'artifacts')
for (const ver of ['1.1.7.1-icon-verify', '1.1.8.1']) {
  for (const arch of ['arm64', 'x64']) {
    writeFile(path.join(artifacts, ver, arch, 'Electron Framework'), 8192)
    writeFile(path.join(artifacts, ver, arch, 'libvk_swiftshader.dylib'), 4096)
  }
}
// 深层文件超过宿主 Top-200 上限，但直接子项只有 2 个子目录：不能误报「仅显示部分」
for (let i = 0; i < 230; i++) writeFile(path.join(artifacts, '1.1.8.1', 'Frameworks', `f-${i}.dylib`), 1024)
const mixed = path.join(root, 'mixed')
writeFile(path.join(mixed, 'readme.md'), 10)
writeFile(path.join(mixed, 'src', 'deep', 'big.bin'), 65536)
// 直接子文件很小、深层有 250 个大文件：dir: Top-200 全是深层文件
const crowded = path.join(root, 'crowded')
writeFile(path.join(crowded, 'tiny.txt'), 1)
for (let i = 0; i < 250; i++) writeFile(path.join(crowded, 'cache', `blob-${i}.bin`), 2048)

async function setup(opts = {}) {
  const host = createHost()
  host.reset()
  await installDirectoryHost(host, { globalHits: ['/Users/test/elsewhere/Electron Framework'], ...opts })
  return host
}

const folder = (p) => ({ name: path.basename(p), path: p, isDir: true, size: 0, mtime: 0 })

test('everything-file-search: 文件夹预览只列直接子项（artifacts 只显示 2 个子目录）', async () => {
  await setup()
  const ql = await getFileQuickLook(folder(artifacts))
  assert.equal(ql.previewType, 'directory')
  assert.deepEqual(ql.dirEntries.map((e) => e.name).sort(), ['1.1.7.1-icon-verify', '1.1.8.1'])
  assert.ok(ql.dirEntries.every((e) => e.isDir))
  assert.equal(ql.totalLines, 2)
  assert.equal(ql.partial, false)
})

test('everything-file-search: 文件与子目录混合时都显示且区分类型，深层文件不出现、无重复', async () => {
  await setup()
  const ql = await getFileQuickLook(folder(mixed))
  const byName = Object.fromEntries(ql.dirEntries.map((e) => [e.name, e.isDir]))
  assert.deepEqual(byName, { src: true, 'readme.md': false })
  assert.equal(new Set(ql.dirEntries.map((e) => e.name)).size, ql.dirEntries.length)
})

test('everything-file-search: 深层大文件挤掉直接子文件时标注 partial，不伪装成完整列表', async () => {
  await setup()
  const res = await listDirectChildren(crowded)
  assert.equal(res.partial, true)
  assert.ok(res.entries.every((e) => path.dirname(e.path) === crowded), '只能包含直接子项')
  assert.ok(res.entries.some((e) => e.name === 'cache' && e.isDir))
  const ql = await getFileQuickLook(folder(crowded))
  assert.equal(ql.partial, true)
})

test('everything-file-search: 文件夹不存在 / 未授权时显示空目录，不拿全盘搜索结果填充', async () => {
  const host = await setup()
  const ql = await getFileQuickLook(folder(path.join(root, 'no-such-folder')))
  assert.equal(ql.previewType, 'directory')
  assert.deepEqual(ql.dirEntries, [])
  const keyword = host.ipcCalls.filter(([m, p]) => m === 'system_search_files' && !String(p?.query).startsWith('dir:'))
  assert.equal(keyword.length, 0)
  const res = await listDirectChildren(path.join(root, 'no-such-folder'))
  assert.deepEqual(res.entries, [])
  assert.match(res.error, /未授权|PERMISSION/)
})

test('everything-file-search: 宿主 dir: 扫描崩溃时退回一级目录读取（已授权），结果仍是直接子项', async () => {
  const host = await setup({ authorized: [root] })
  host.ipc.system_search_files = async () => {
    throw new Error('sidecar crashed')
  }
  const ql = await getFileQuickLook(folder(mixed))
  assert.deepEqual(ql.dirEntries.map((e) => e.name).sort(), ['readme.md', 'src'])
  assert.equal(ql.dirEntries.find((e) => e.name === 'src').isDir, true)
})

test('everything-file-search: 空路径与尾部分隔符边界', async () => {
  await setup()
  const empty = await listDirectChildren('')
  assert.deepEqual(empty, { entries: [], partial: false, error: 'EMPTY_DIRECTORY_PATH' })
  const trailing = await listDirectChildren(artifacts + path.sep)
  assert.equal(trailing.entries.length, 2)
})
