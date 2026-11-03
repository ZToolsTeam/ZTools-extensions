import test from 'node:test'
import assert from 'node:assert/strict'
import { createDirectoryScanner } from '../dist/native-ipc.js'

test('宿主子目录读取失败时保留文件并展示原因，不把零文件回执当作完整空目录', async () => {
  let files = [{ name: 'readable.txt', path: 'C:\\fixture\\readable.txt', size: 8 }]
  let scanError = '部分路径读取失败：C:\\fixture\\denied：EACCES'
  const scanner = createDirectoryScanner({
    system_search_files: async () => ({ files, total_matches: files.length, approximate: Boolean(scanError), scan_error: scanError }),
    filesystem_get_directory_contents: async () => { throw new Error('不应丢弃部分结果再发起兜底') }
  })
  assert.equal((await scanner.scan('C:\\fixture')).files.length, 1)
  assert.match(scanner.error, /EACCES/)
  files = []
  assert.equal((await scanner.scan('C:\\fixture')).files.length, 0)
  assert.match(scanner.error, /EACCES/)
  scanError = ''
  await scanner.scan('C:\\fixture')
  assert.equal(scanner.error, undefined)
})
