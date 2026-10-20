// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout1-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchProcesses,
  fetchProcessDetail,
  terminateProcess,
  invokeNativeCapability as invokeProcessMonitorCapability
} from '../dist/logic.js'

async function withSimulatedRealElectronWindow(methodsMap, fn) {
  const prevWindow = globalThis.window
  globalThis.window = {
    __ztoolsElectron: {
      transport: {
        methods: Object.keys(methodsMap),
        call: async (method, payload) => {
          const handler = methodsMap[method]
          if (!handler) {
            throw new Error(`IPC method not registered: ${method}`)
          }
          return await handler(payload)
        }
      }
    }
  }
  try {
    return await fn()
  } finally {
    if (prevWindow === undefined) {
      delete globalThis.window
    } else {
      globalThis.window = prevWindow
    }
  }
}

test("P09 & P10 process-monitor / hardware-info: 真实宿主下严禁返回 simulated:true 或假进程详情（process-monitor 部分）", async () => {
  await withSimulatedRealElectronWindow(
    {
      dllplugin_call: async () => {
        throw new Error('Native DLL 调用失败')
      },
      process_list: async () => [],
      process_info: async () => {
        throw new Error('PID 不存在')
      }
    },
    async () => {
    const pmCap = await invokeProcessMonitorCapability('GetProcessList', {})
    assert.equal(pmCap.ok, false)
    assert.equal(pmCap.data?.simulated, undefined)
    const detail = await fetchProcessDetail(99999)
    assert.equal(detail, null)
}
  )
  const procs = await fetchProcesses({
    process_list: async () => [
      { pid: 8848, name: 'node.exe', path: 'C:\\Program Files\\nodejs\\node.exe', cpuUsage: 3.5, memoryUsage: 104857600 }
    ]
  })
  assert.equal(procs.length, 1)
  assert.equal(procs[0].pid, 8848)
  const killSys = await terminateProcess(4, 'System')
  assert.equal(killSys.ok, false)
})
