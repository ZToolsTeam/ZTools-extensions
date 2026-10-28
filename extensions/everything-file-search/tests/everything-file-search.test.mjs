import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const mod = require('../dist/index.js')
const Command = mod.default

// 只在测试里使用的样本，插件本身不再携带任何示例文件
const FIXTURE = [
  { name: 'report.docx', path: 'C:\\Users\\User\\Documents\\report.docx', isDir: false, size: 4520192, mtime: 3, category: 'document' },
  { name: 'notes.md', path: 'C:\\Users\\User\\Documents\\notes.md', isDir: false, size: 25451, mtime: 2, category: 'document' },
  { name: 'photo.png', path: 'C:\\Users\\User\\Pictures\\photo.png', isDir: false, size: 382910, mtime: 1, category: 'image' },
  { name: 'Projects', path: 'D:\\Projects', isDir: true, size: 0, mtime: 4, category: 'folder' }
]

test('everything-file-search 声明式视图渲染与排序筛选', () => {
  const view = Command()
  assert.ok(view && view.type === 'List')
  const results = mod.sortAndFilterFiles(FIXTURE, 'size-desc', 'document')
  assert.deepEqual(results.map((f) => f.name), ['report.docx', 'notes.md'])
  assert.deepEqual(mod.sortAndFilterFiles(FIXTURE, 'all', 'folder').map((f) => f.name), ['Projects'])
  assert.equal(mod.formatBytes(1024), '1.0 KB')
})

test('不在客户端里运行时：不返回示例数据，搜索直接报「需要在 ZTools 客户端中使用」', async () => {
  assert.equal(mod.SAMPLE_FILES, undefined, '插件不能再导出示例文件')
  await assert.rejects(mod.searchLocalFiles('md'), new RegExp(mod.NOT_IN_CLIENT_MESSAGE))
  await assert.rejects(mod.searchLocalFiles(''), new RegExp(mod.NOT_IN_CLIENT_MESSAGE))
})

test('everything-file-search 空路径、负数大小与空列表边界', () => {
  assert.equal(mod.formatBytes(0), '0 B')
  assert.equal(mod.formatBytes(-100), '0 B')
  assert.equal(mod.truncatePath(''), '')
  assert.equal(mod.sortAndFilterFiles([], 'name-asc', 'all').length, 0)
})

test('系统快速预览只在 macOS 上提供', () => {
  assert.equal(mod.supportsSystemQuickLook('MacIntel'), true)
  assert.equal(mod.supportsSystemQuickLook('darwin'), true)
  assert.equal(mod.supportsSystemQuickLook('Win32'), false)
  assert.equal(mod.supportsSystemQuickLook(''), false)
})
