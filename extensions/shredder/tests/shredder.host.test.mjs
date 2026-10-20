// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout2-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as shredder from '../dist/logic.js'

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

test('P16 shredder: 真实宿主下移除虚构机密文件并在粉碎失败时返回真实错误', async () => {
  const host = createRealHostStub({
    system_get_path: () => 'C:\\Users\\RealUser\\AppData\\Local\\Temp',
    system_search_files: (payload) => {
      if (String(payload.query).includes('Temp')) {
        return {
          files: [
            {
              name: 'real_trace.log',
              path: 'C:\\Users\\RealUser\\AppData\\Local\\Temp\\real_trace.log',
              is_dir: false,
              size: 2048,
              mtime: Math.floor(Date.now() / 1000)
            }
          ],
          total_matches: 1,
          total_bytes: 2048
        }
      }
      return { files: [], total_matches: 0, total_bytes: 0 }
    }
  })

  const snap = await shredder.fetchShredCandidates(host)
  assert.equal(snap.candidates.some(f => f.name === 'decrypted_token_session_dump.tmp'), false)
  assert.equal(snap.candidates.some(f => f.name === 'real_trace.log'), true)

  // 异常边界：系统核心目录拦截与底层擦除失败时返回 ok: false
  const sysRes = await shredder.executeSecureShred(
    [
      {
        id: 'sys_locked',
        name: 'ntoskrnl.exe',
        path: 'C:\\Windows\\System32\\ntoskrnl.exe',
        category: 'system_locked',
        categoryName: '系统保护锁定',
        sizeBytes: 1024,
        isSystemLocked: true
      }
    ],
    'dod_3pass',
    host
  )
  assert.equal(sysRes.ok, false)

  const realTarget = snap.candidates.find(f => f.name === 'real_trace.log')
  const failShred = await shredder.executeSecureShred([realTarget], 'dod_3pass', host)
  assert.equal(failShred.ok, false)
  assert.equal(failShred.shreddedCount, 0)
})
