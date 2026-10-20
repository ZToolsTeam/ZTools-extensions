// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout2-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as mover from '../dist/logic.js'

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

test('P14 mover: 消除 7.5GB 虚增体积、真实扫描目录与迁移失败如实报错验证', async () => {
  const host = createRealHostStub({
    system_get_path: (p) => `C:\\Users\\RealUser\\${p.name}`,
    system_get_disk_usage: (p) => {
      if (String(p.drive).startsWith('C:')) {
        return { total: 256 * 1024 ** 3, used: 216 * 1024 ** 3, available: 40 * 1024 ** 3, percent: 84 }
      }
      if (String(p.drive).startsWith('D:')) {
        return { total: 1024 * 1024 ** 3, used: 424 * 1024 ** 3, available: 600 * 1024 ** 3, percent: 41 }
      }
      return { total: 0, used: 0, available: 0, percent: 0 }
    },
    system_search_files: (payload) => {
      if (String(payload.query).includes('downloads')) {
        return {
          files: [
            {
              name: 'archive.zip',
              path: 'C:\\Users\\RealUser\\downloads\\archive.zip',
              is_dir: false,
              size: 10485760,
              mtime: 1710000000
            }
          ],
          total_matches: 1,
          total_bytes: 10485760
        }
      }
      return { files: [], total_matches: 0, total_bytes: 0 }
    }
  })

  const snap = await mover.fetchMoverSnapshot(host)
  const dlFolder = snap.folders.find(f => f.sourcePath.toLowerCase().includes('downloads'))
  assert.ok(dlFolder)
  // 真实体积必须严格等于扫描出的 10MB，绝不叠加 7.5GB 静态假体积
  assert.equal(dlFolder.sizeBytes, 10485760)
  // 空目录在真实宿主下不应混入可迁移列表
  const nonLocked = snap.folders.filter(f => !f.isSystemLocked)
  assert.equal(nonLocked.length, 1)

  // 异常边界：系统锁定目录拦截与真实宿主未挂载迁移服务时返回 ok: false
  const lockedFolder = snap.folders.find(f => f.isSystemLocked)
  const lockedRes = await mover.executeDirectoryMove([lockedFolder], 'D:', host)
  assert.equal(lockedRes.ok, false)

  const moveFailRes = await mover.executeDirectoryMove([dlFolder], 'D:', host)
  assert.equal(moveFailRes.ok, false)
})
