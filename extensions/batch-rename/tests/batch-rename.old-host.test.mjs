// 旧客户端：目录读取结果里没有 writeAuthorized、没有不覆盖改名接口时，明确提示升级
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost } from '../../shared/test-harness.mjs'
import * as logic from '../dist/logic.js'

test('目录结果缺少 writeAuthorized 时标记为旧客户端', async () => {
  const host = createHost()
  host.reset()
  host.ipc.filesystem_get_directory_contents = async () => ({ files: [{ name: 'a.txt', path: '/x/a.txt', isDirectory: false, size: 1 }] })
  const old = await logic.fetchDirectoryFiles('/x')
  assert.equal(old.hostOutdated, true)
  assert.equal(old.authorized, false)
  host.ipc.filesystem_get_directory_contents = async () => ({ files: [{ name: 'a.txt', path: '/x/a.txt', isDirectory: false, size: 1 }], writeAuthorized: false })
  assert.equal((await logic.fetchDirectoryFiles('/x')).hostOutdated, undefined)
})

test('没有不覆盖改名接口时提示升级', async () => {
  const host = createHost()
  host.reset()
  host.ipc.filesystem_move_file_no_replace = async () => { throw Object.assign(new Error('未知方法: filesystem_move_file_no_replace'), { code: 'METHOD_NOT_FOUND' }) }
  const res = await logic.executeRealFileRename('/x/a.txt', 'b.txt')
  assert.equal(res.ok, false)
  assert.match(res.error, /需要新版 ZTools/)
})
