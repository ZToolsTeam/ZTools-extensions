// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout2-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as softwareManager from '../dist/logic.js'

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

test("P21 ~ P25 boost, software-manager, disk-analyzer, cleaner, batch-rename: 真实传输层与异常边界验证（software-manager 部分）", async () => {
  const failHost = createRealHostStub({})
  const dllKillHost = createRealHostStub({
    dllplugin_call: (payload) => {
      assert.equal(payload.plugin, 'ProcessMonitorPlugin')
      assert.equal(payload.func, 'TerminateProcessByPID')
      return { success: true }
    }
  })
  const swCapFail = await softwareManager.invokeNativeCapability('GetAllSoftware', {}, failHost)
  assert.equal(swCapFail.ok, false)
  const uninstallFail = await softwareManager.uninstallSoftware(
    {
      id: 'app-1',
      name: 'DemoApp',
      publisher: 'Demo',
      version: '1.0',
      installDate: '2026-01-01',
      estimatedSize: 1024,
      installLocation: 'C:\\Program Files\\DemoApp',
      uninstallString: 'C:\\Program Files\\DemoApp\\uninstall.exe',
      category: 'desktop'
    },
    false,
    failHost
  )
  assert.equal(uninstallFail.ok, false)
  const dllOkHost = createRealHostStub({
    dllplugin_call: (payload) => ({
      executed: true,
      plugin: payload.plugin,
      func: payload.func
    })
  })
})
