// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout1-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchFlowGuardSnapshot,
  terminateNetworkProcess,
  invokeNativeCapability as invokeFlowGuardCapability
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

test('P06 flow-guard: 真实端口五元组聚合、内核进程白名单拦截与真实宿主禁用 simulated:true', async () => {
  const snap = await fetchFlowGuardSnapshot({
    process_list_ports: async () => [
      {
        protocol: 'TCP',
        localAddress: '192.168.1.50',
        localPort: 52100,
        remoteAddress: '1.1.1.1',
        remotePort: 443,
        state: 'ESTABLISHED',
        pid: 4560,
        processName: 'curl.exe'
      }
    ],
    process_list: async () => [
      { pid: 4560, name: 'curl.exe', path: 'C:\\Windows\\System32\\curl.exe', cpuUsage: 1.5, memoryUsage: 12000000 }
    ]
  })
  assert.equal(snap.groups.length, 1)
  assert.equal(snap.groups[0].pid, 4560)
  assert.equal(snap.totalPublic, 1)

  // 异常场景 1：终止内核受保护进程 (csrss.exe / PID 4) 必须被拦截
  const sysKill = await terminateNetworkProcess(4, 'System', {})
  assert.equal(sysKill.ok, false)
  const csrssKill = await terminateNetworkProcess(612, 'csrss.exe', {})
  assert.equal(csrssKill.ok, false)

  // 异常场景 2：在真实 Electron 宿主中调用未实现能力，严禁返回 simulated: true
  await withSimulatedRealElectronWindow(
    {
      dllplugin_call: async () => {
        throw new Error('插件方法未实现')
      }
    },
    async () => {
      const res = await invokeFlowGuardCapability('GetNetworkFlowTable', { includeLoopback: false })
      assert.equal(res.ok, false)
      assert.equal(res.data?.simulated, undefined)
    }
  )
})
