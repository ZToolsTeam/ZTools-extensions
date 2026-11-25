// 旧客户端：目录读取结果里没有 writeAuthorized、没有不覆盖改名接口时，明确提示升级
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import * as logic from '../dist/logic.js'
import BatchRenameCommand from '../dist/index.js'

const roots = []
test.after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true })
})

test('目录结果缺少 writeAuthorized 时标记为旧客户端', async () => {
  const host = createHost()
  host.reset()
  host.ipc.filesystem_get_directory_contents = async () => ({
    files: [{ name: 'a.txt', path: '/x/a.txt', isDirectory: false, size: 1 }]
  })
  const old = await logic.inspectDirectoryState('/x')
  assert.equal(old.hostOutdated, true)
  assert.equal(old.writeAuthorized, false)

  host.ipc.filesystem_get_directory_contents = async () => ({
    files: [{ name: 'a.txt', path: '/x/a.txt', isDirectory: false, size: 1 }],
    writeAuthorized: false
  })
  assert.equal((await logic.inspectDirectoryState('/x')).hostOutdated, undefined)
})

test('没有不覆盖改名接口时提示升级', async () => {
  const host = createHost()
  host.reset()
  host.ipc.filesystem_move_file_no_replace = async () => {
    throw Object.assign(new Error('未知方法: filesystem_move_file_no_replace'), { code: 'METHOD_NOT_FOUND' })
  }
  const res = await logic.executeRealFileRename('/x/a.txt', 'b.txt')
  assert.equal(res.ok, false)
  assert.match(res.error, /需要新版 ZTools/)
})

test('界面层遇到旧版客户端缺少 writeAuthorized 时提示需要升级并阻止执行改名', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'batch-rename-old-host-')))
  roots.push(root)
  fs.writeFileSync(path.join(root, 'a.txt'), 'A')

  const host = createHost()
  host.reset()
  host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: root })
  host.ipc.filesystem_get_directory_contents = async () => ({
    success: true,
    files: [{ name: 'a.txt', size: 1, isDirectory: false }]
  })

  const view = await mount(BatchRenameCommand, host)
  await tick(10)
  await view.tree().props.filterBar.actions.find((a) => a.id === 'pick-folder').onAction()
  await tick(20)

  assert.match(view.tree().props.filterBar.summaryText, /改名需要新版 ZTools/)
  const firstItem = view.tree().props.subList.items[0]
  await view.run(firstItem, '执行批量重命名 (1 个已选文件)')
  assert.match(host.lastToast().title, /无法改名/)
  assert.match(host.lastToast().message, /需要新版 ZTools/)
  assert.equal(host.ipcCalls.filter(([m]) => m === 'filesystem_move_file_no_replace').length, 0)
  view.unmount()
})
