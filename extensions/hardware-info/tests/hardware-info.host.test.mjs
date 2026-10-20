// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout1-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchHardwareTelemetrySnapshot,
  invokeNativeCapability as invokeHardwareInfoCapability
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

test("P09 & P10 process-monitor / hardware-info: 真实宿主下严禁返回 simulated:true 或假进程详情（hardware-info 部分）", async () => {
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
    const hwCap = await invokeHardwareInfoCapability('GetHardwareSummary', {})
    assert.equal(hwCap.ok, false)
    assert.equal(hwCap.data?.simulated, undefined)
}
  )
  const hwSnap = await fetchHardwareTelemetrySnapshot({
    system_get_hardware_summary: async () => ({
      cpuModel: 'AMD Ryzen 9 7950X',
      logicalCpuCount: 32,
      totalMemory: 64 * 1024 * 1024 * 1024,
      osVersion: '10.0.26100'
    }),
    get_system_info: async () => ({
      osName: 'Windows 11 Pro',
      osVersion: '24H2',
      osBuild: 26100,
      osArch: 'x64',
      platform: 'win32',
      appVersion: '2.0.0'
    }),
    system_get_cpu_usage: async () => ({ total: 18, perCore: [18] }),
    system_get_memory_usage: async () => ({
      total: 64 * 1024 * 1024 * 1024,
      used: 20 * 1024 * 1024 * 1024,
      available: 44 * 1024 * 1024 * 1024,
      percent: 31
    }),
    system_get_battery_status: async () => ({ percent: 100, isCharging: true, timeRemaining: 0 }),
    screen_get_all_displays: async () => [{ id: 1, label: '4K Primary', bounds: { x: 0, y: 0, width: 3840, height: 2160 }, scaleFactor: 1.5, displayFrequency: 144 }],
    fs_stat: async () => ({ size: 0, isDirectory: true })
  })
  assert.equal(hwSnap.cpuModel, 'AMD Ryzen 9 7950X')
  assert.equal(hwSnap.logicalCpuCount, 32)
})
