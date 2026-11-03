import test from 'node:test'
import assert from 'node:assert/strict'
import { createDirectoryScanner } from '../dist/native-ipc.js'

test('完整空目录回执不触发兜底；一级读取不能冒充完整树；重扫清除错误', async () => {
  let mode = 'empty'
  let fallbackCalls = 0
  const host = {
    system_search_files: async () => {
      if (mode === 'empty') return { files: [], total_matches: 0 }
      throw new Error('INDEX_UNAVAILABLE')
    },
    filesystem_get_directory_contents: async () => {
      fallbackCalls++
      return { success: true, files: [
        { name: 'nested', isDirectory: true },
        { name: 'readable.txt', size: 20, isDirectory: false }
      ] }
    }
  }
  const scanner = createDirectoryScanner(host)
  assert.equal((await scanner.scan('C:\\fixture')).files.length, 0)
  assert.equal(fallbackCalls, 0)
  assert.equal(scanner.error, undefined)
  mode = 'partial'
  const partial = await scanner.scan('C:\\fixture')
  assert.equal(partial.files.length, 2)
  assert.equal(partial.approximate, true)
  assert.match(scanner.error, /INDEX_UNAVAILABLE/)
  mode = 'empty'
  await scanner.scan('C:\\fixture')
  assert.equal(scanner.error, undefined)
})
