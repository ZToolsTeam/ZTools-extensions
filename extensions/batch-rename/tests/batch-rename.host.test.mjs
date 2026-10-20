// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout2-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as batchRename from '../dist/logic.js'

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

test("P21 ~ P25 boost, software-manager, disk-analyzer, cleaner, batch-rename: 真实传输层与异常边界验证（batch-rename 部分）", async () => {
  const failHost = createRealHostStub({})
  const dllKillHost = createRealHostStub({
    dllplugin_call: (payload) => {
      assert.equal(payload.plugin, 'ProcessMonitorPlugin')
      assert.equal(payload.func, 'TerminateProcessByPID')
      return { success: true }
    }
  })
  const renameCapFail = await batchRename.invokeNativeCapability('BatchRenameByRule', { type: 'number' }, failHost)
  assert.equal(renameCapFail.ok, false)
  assert.equal(renameCapFail.data?.simulated, undefined)
  const dllOkHost = createRealHostStub({
    dllplugin_call: (payload) => ({
      executed: true,
      plugin: payload.plugin,
      func: payload.func
    })
  })
  const renameCapOk = await batchRename.invokeNativeCapability('BatchRenameByRule', { type: 'number' }, dllOkHost)
  assert.equal(renameCapOk.ok, true)
  assert.equal(renameCapOk.fromFallback, false)
  assert.equal(renameCapOk.data.plugin, 'BatchRenamePlugin')
})
