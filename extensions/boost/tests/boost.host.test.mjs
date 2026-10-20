// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout2-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as boost from '../dist/logic.js'

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

test("P21 ~ P25 boost, software-manager, disk-analyzer, cleaner, batch-rename: 真实传输层与异常边界验证（boost 部分）", async () => {
  const failHost = createRealHostStub({})
  const boostCapFail = await boost.invokeNativeCapability('OptimizeMemory', { level: 1 }, failHost)
  assert.equal(boostCapFail.ok, false)
  assert.equal(boostCapFail.data?.simulated, undefined)
  const sysKill = await boost.terminateBoostProcess(4, 'System', failHost)
  assert.equal(sysKill.ok, false)
  const dllKillHost = createRealHostStub({
    dllplugin_call: (payload) => {
      assert.equal(payload.plugin, 'ProcessMonitorPlugin')
      assert.equal(payload.func, 'TerminateProcessByPID')
      return { success: true }
    }
  })
  const procKillOk = await boost.terminateBoostProcess(8888, 'chrome.exe', dllKillHost)
  assert.equal(procKillOk.ok, true)
  const dllOkHost = createRealHostStub({
    dllplugin_call: (payload) => ({
      executed: true,
      plugin: payload.plugin,
      func: payload.func
    })
  })
})
