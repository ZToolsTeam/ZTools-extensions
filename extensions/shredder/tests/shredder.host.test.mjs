import test from 'node:test'
import assert from 'node:assert/strict'
import { setRuntimeLocale } from '@ztools/declarative-ui'
import * as shredder from '../dist/logic.js'

setRuntimeLocale('zh-CN')

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

test('shredder: 已移除所有自动扫盘与示例数据导出', () => {
  assert.equal(typeof shredder.fetchShredCandidates, 'undefined')
  assert.equal(typeof shredder.createInitialShredderSnapshot, 'undefined')
  assert.equal(typeof shredder.createEmptyShredderSnapshot, 'undefined')
  assert.equal(typeof shredder.SHRED_CATEGORIES, 'undefined')
})

test('shredder: 导入规则拦截 Windows 系统受保护路径，候选转换保留未知大小', () => {
  assert.equal(shredder.SHRED_IMPORT_RULES.forbiddenPath.test('C:\\Windows\\System32\\ntoskrnl.exe'), true)
  assert.equal(shredder.SHRED_IMPORT_RULES.forbiddenPath.test('C:\\Program Files\\App\\app.exe'), true)
  assert.equal(shredder.SHRED_IMPORT_RULES.forbiddenPath.test('D:\\Secret\\report.docx'), false)

  const a = shredder.toShredCandidate(
    {
      path: 'D:\\Secret\\Report.docx',
      name: 'Report.docx',
      parentDir: 'D:\\Secret',
      extension: '.docx',
      sizeBytes: null,
      lastModifiedMs: null
    },
    'manual'
  )
  const b = shredder.toShredCandidate(
    {
      path: 'd:/secret/report.docx',
      name: 'Report.docx',
      parentDir: 'd:/secret',
      extension: '.docx',
      sizeBytes: 2048,
      lastModifiedMs: null
    },
    'folder'
  )
  assert.equal(a.id, b.id)
  assert.equal(a.sizeBytes, null)
  assert.equal(shredder.formatSize(a.sizeBytes), '大小未识别')
  assert.equal(shredder.sumKnownBytes([a, b]), 2048)

  const unknownMsg = shredder.buildShredConfirmMessage([a], 'dod_3pass')
  assert.match(unknownMsg, /大小未识别/)

  const many = Array.from({ length: 12 }, (_, idx) =>
    shredder.toShredCandidate(
      {
        path: `D:\\Temp\\f${idx}.bin`,
        name: `f${idx}.bin`,
        parentDir: 'D:\\Temp',
        extension: '.bin',
        sizeBytes: 1024,
        lastModifiedMs: null
      },
      'folder'
    )
  )
  const manyMsg = shredder.buildShredConfirmMessage(many, 'dod_3pass')
  assert.match(manyMsg, /以及其余 2 个文件/)
})

test('shredder: 受保护系统路径与空目标列表一律拦截，绝不调用粉碎能力', async () => {
  const host = createRealHostStub({
    dllplugin_call: () => {
      throw new Error('不应调用粉碎能力')
    }
  })

  const sysRes = await shredder.executeSecureShred(
    [
      {
        id: 'sys_locked',
        name: 'ntoskrnl.exe',
        path: 'C:\\Windows\\System32\\ntoskrnl.exe',
        source: 'manual',
        sourceName: '手动添加',
        sizeBytes: 1024
      }
    ],
    'dod_3pass',
    host
  )
  assert.equal(sysRes.ok, false)
  assert.equal(sysRes.message, shredder.FORBIDDEN_REASON)
  assert.equal(host.calls.length, 0)

  const empty = await shredder.executeSecureShred([], 'dod_3pass', host)
  assert.equal(empty.ok, false)
  assert.equal(empty.message, '请先勾选要粉碎的文件')
})

test('shredder: 部分文件粉碎失败时 ok 为 false 并列出失败原因，不改用普通删除', async () => {
  const okPath = 'D:\\Scratch\\a.tmp'
  const badPath = 'D:\\Scratch\\b.tmp'
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
    source: 'manual',
    sourceName: '手动添加',
    sizeBytes: 1024
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
})
