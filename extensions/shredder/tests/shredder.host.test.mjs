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

test('shredder: 真实宿主下移除虚构机密文件并在粉碎失败时返回真实错误', async () => {
  const host = createRealHostStub({
    system_list_common_folders: () => ({ folders: [{ id: 'temp', path: 'C:\\Users\\RealUser\\AppData\\Local\\Temp', exists: true }] }),
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

test('shredder: 不在客户端里运行时不返回示例文件，只给出需要在客户端中使用的提示', async () => {
  const snap = await shredder.fetchShredCandidates()
  assert.equal(snap.candidates.length, 0)
  assert.equal(snap.error, shredder.NOT_IN_CLIENT_MESSAGE)
  assert.equal(typeof shredder.createInitialShredderSnapshot, 'undefined')
})

test('shredder: 拿不到临时文件夹路径时如实报错，不扫描猜测的目录', async () => {
  const host = createRealHostStub({
    system_get_path: () => {
      throw new Error('PATH_UNAVAILABLE')
    },
    system_search_files: () => {
      throw new Error('不应扫描任何目录')
    }
  })
  const snap = await shredder.fetchShredCandidates(host)
  assert.equal(snap.candidates.length, 0)
  assert.match(snap.error, /无法获取临时文件夹路径/)
  assert.equal(host.calls.some((c) => c.channel === 'system_search_files'), false)
})

test('shredder: 部分文件粉碎失败时 ok 为 false 并列出失败原因，不改用普通删除', async () => {
  const okPath = 'C:\\Users\\RealUser\\AppData\\Local\\Temp\\a.tmp'
  const badPath = 'C:\\Users\\RealUser\\AppData\\Local\\Temp\\b.tmp'
  const host = createRealHostStub({
    dllplugin_call: (payload) => {
      if (payload.params.path === badPath) return { ok: false, success: false, error: '拒绝访问' }
      return { ok: true, success: true, shreddedCount: 1 }
    },
    filesystem_delete_file: () => {
      throw new Error('不能用普通删除顶替粉碎')
    }
  })
  const items = [okPath, badPath].map((p, i) => ({
    id: `t${i}`,
    name: p.split('\\').pop(),
    path: p,
    category: 'temp_zone',
    categoryName: '临时文件夹',
    sizeBytes: 1024,
    isSystemLocked: false
  }))
  const res = await shredder.executeSecureShred(items, 'zero_1pass', host)
  assert.equal(res.ok, false)
  assert.equal(res.shreddedCount, 1)
  assert.deepEqual(res.shreddedPaths, [okPath])
  assert.deepEqual(res.failedPaths, [badPath])
  assert.match(res.message, /1 个失败/)
  assert.match(res.message, /拒绝访问/)
  assert.equal(host.calls.some((c) => c.channel === 'filesystem_delete_file'), false)
  const wipe = host.calls.find((c) => c.channel === 'dllplugin_call')
  assert.equal(wipe.payload.params.passes, 1)

  const empty = await shredder.executeSecureShred([], 'dod_3pass', host)
  assert.equal(empty.ok, false)
  assert.equal(empty.message, '请先勾选要粉碎的文件')
})
