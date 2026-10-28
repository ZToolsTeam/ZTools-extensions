// 本插件的宿主集成测试（导入本插件编译后的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as cleaner from '../dist/logic.js'

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

test('cleaner：宿主通道不可用时如实返回失败、不模拟数据，非法方法名与系统目录参数被拒绝', async () => {
  const failHost = createRealHostStub({})
  const cleanerCapFail = await cleaner.invokeNativeCapability('ScanSystemJunk', { deep: true }, failHost)
  assert.equal(cleanerCapFail.ok, false)
  assert.equal(cleanerCapFail.data?.simulated, undefined)
  await assert.rejects(() => cleaner.invokeNativeCapability('', {}, failHost), /INVALID_METHOD/)
  await assert.rejects(
    () => cleaner.invokeNativeCapability('CleanPath', { path: 'C:\\Windows\\System32' }, failHost),
    /SECURITY_INTERCEPTED/
  )
})

test('清理勾选的文件按真实成功计数，部分失败与全部失败都不报成功', async () => {
  const files = [{ path: 'C:\\Users\\t\\AppData\\Local\\Temp\\cache-a', sizeBytes: 8 }, { path: 'C:\\Users\\t\\AppData\\Local\\Temp\\cache-b', sizeBytes: 12 }]
  const host = createRealHostStub({
    shell_trash_item: ({ fullPath }) => {
      if (fullPath.endsWith('cache-b')) throw new Error('拒绝访问')
      return true
    }
  })
  const partial = await cleaner.executeCleanFiles(files.map(f => f.path), files, host)
  assert.equal(partial.ok, false)
  assert.equal(partial.deletedCount, 1)
  assert.equal(partial.deletedSizeBytes, 8)
  assert.deepEqual(partial.failedFiles, [files[1].path])
  assert.match(partial.error, /1 个文件未能移入回收站：拒绝访问/)
  assert.equal(cleaner.summarizeCleanResult(partial).success, false)

  const fail = await cleaner.executeCleanFiles(files.map(f => f.path), files, createRealHostStub({}))
  assert.equal(fail.ok, false)
  assert.equal(fail.deletedCount, 0)
  assert.equal(fail.failedCount, 2)
  assert.equal(cleaner.summarizeCleanResult(fail).title, '清理失败')

  const emptyHost = createRealHostStub({})
  const empty = await cleaner.executeCleanFiles([], [], emptyHost)
  assert.equal(empty.ok, false)
  assert.equal(empty.deletedCount, 0)
  assert.deepEqual(emptyHost.calls, [])

  // 命中系统保护规则的路径不交给宿主
  const guardHost = createRealHostStub({ shell_trash_item: () => true })
  const guarded = await cleaner.executeCleanFiles(['C:\\Windows\\System32\\drivers\\etc\\hosts'], [], guardHost)
  assert.equal(guarded.ok, false)
  assert.equal(guarded.skippedProtected, 1)
  assert.deepEqual(guardHost.calls, [])

  const okHost = createRealHostStub({ shell_trash_item: () => true })
  const ok = await cleaner.executeCleanFiles([files[0].path, files[0].path], files, okHost)
  assert.equal(ok.ok, true)
  assert.equal(ok.deletedCount, 1, '重复路径只处理一次')
  assert.equal(cleaner.summarizeCleanResult(ok).success, true)
})

test('不再调用会“什么都不删却报成功”的整类清理接口', () => {
  assert.equal(typeof cleaner.executeCleanGroups, 'undefined')
  assert.equal(typeof cleaner.getMockCleanGroups, 'undefined')
  const src = fs.readFileSync(path.join(__dirname, '../src/logic.ts'), 'utf-8')
  assert.doesNotMatch(src, /StartCleanWithSelection|GetScanSummary/)
})

test('清空回收站：按客户端返回的结果提示，失败如实返回', async () => {
  const okHost = createRealHostStub({
    dllplugin_call: () => ({ ok: true, success: true, removedCount: 3, message: '已清空系统回收站（3 项）' })
  })
  const ok = await cleaner.emptyRecycleBin(okHost)
  assert.equal(ok.ok, true)
  assert.equal(ok.removedCount, 3)
  const failHost = createRealHostStub({
    dllplugin_call: () => ({ ok: false, success: false, error: '回收站仍有 2 项未清空（可能被占用或权限不足）' })
  })
  const fail = await cleaner.emptyRecycleBin(failHost)
  assert.equal(fail.ok, false)
  assert.match(fail.error, /回收站仍有 2 项未清空/)
})
