import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const mod = require('../dist/index.js')
const Command = mod.default

test('everything-file-search 声明式视图渲染与文件检索排序集成测试', async () => {
  const view = Command()
  assert.ok(view && view.type === 'List')
  const results = mod.sortAndFilterFiles(mod.SAMPLE_FILES, 'size-desc', 'document')
  assert.ok(Array.isArray(results) && results.length > 0)
  assert.ok(results[0].size >= results[results.length - 1].size)
  assert.equal(mod.formatBytes(1024), '1.0 KB')
  const searched = await mod.searchLocalFiles('md')
  assert.ok(searched.length > 0)
})

test('everything-file-search 空路径、负数大小与无匹配异常边界测试', async () => {
  assert.equal(mod.formatBytes(0), '0 B')
  assert.equal(mod.formatBytes(-100), '0 B')
  assert.equal(mod.truncatePath(''), '')
  const empty = await mod.searchLocalFiles('__NO_SUCH_FILE_999__')
  assert.equal(empty.length, 0)
  const emptyFilter = mod.sortAndFilterFiles([], 'name-asc', 'all')
  assert.equal(emptyFilter.length, 0)
})
