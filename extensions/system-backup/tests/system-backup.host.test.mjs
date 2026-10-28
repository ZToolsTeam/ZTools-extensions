// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout2-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as systemBackup from '../dist/logic.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
function createRealHostStub(handlers = {}) {
  const calls = []
  const dispatch = async (method, params) => {
    calls.push({ channel: method, payload: params })
    if (typeof handlers[method] === 'function') {
      return await handlers[method](params)
    }
    if (method in handlers) {
      return handlers[method]
    }
    throw new Error(`CHANNEL_NOT_IMPLEMENTED: ${method}`)
  }

  const stub = {
    __isRealHost: true,
    calls,
    transport: {
      call: dispatch
    }
  }

  for (const key of Object.keys(handlers)) {
    stub[key] = (params) => dispatch(key, params)
  }

  return stub
}

test('system-backup: 真实探测备份文件与归档创建/还原失败拦截验证', async () => {
  const host = createRealHostStub({
    system_get_path: (p) => `C:\\Users\\RealUser\\${p.name}`,
    filesystem_get_file_size: () => 16384,
    system_search_files: () => ({
      files: [
        {
          name: 'ZTools_Backup_Real.zip',
          path: 'C:\\Users\\RealUser\\documents\\ZToolsBackups\\ZTools_Backup_Real.zip',
          is_dir: false,
          size: 65536,
          mtime: Math.floor(Date.now() / 1000)
        }
      ],
      total_matches: 1,
      total_bytes: 65536
    })
  })

  const snap = await systemBackup.fetchSystemBackupSnapshot(host)
  assert.equal(snap.items.some(i => i.name === 'ZTools_SystemBackup_20261018_Full.zip'), false)
  assert.equal(snap.items.some(i => i.name === 'ZTools_Backup_Real.zip'), true)

  // 异常边界：未挂载备份服务时创建归档与还原必须返回 ok: false，绝不返回写死 19.6MB 假成功
  const createFail = await systemBackup.createBackupArchive(
    snap.items.filter(i => i.category !== 'snapshot_archives'),
    'full',
    'C:\\Users\\RealUser\\documents\\ZToolsBackups',
    host
  )
  assert.equal(createFail.ok, false)
  assert.equal(createFail.sizeBytes || 0, 0)

  const archiveItem = snap.items.find(i => i.name === 'ZTools_Backup_Real.zip')
  const restoreFail = await systemBackup.restoreBackupSnapshot(archiveItem, host)
  assert.equal(restoreFail.ok, false)
})
