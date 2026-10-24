// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout1-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchNetworkDiagnostics,
  executeNetworkRepair,
  batchExecuteNetworkRepairs
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

test('P03 network-rescue: 真实诊断联动与修复失败时严禁伪造 ok:true 断言', async () => {
  const mockHost = {
    dllplugin_call: async ({ func, params }) => {
      if (func === 'diagnose') {
        return {
          ok: true,
          latencyMs: 22,
          items: [
            {
              id: 'clear-proxy',
              status: 'warning',
              statusText: '检测到系统代理 127.0.0.1:10809 但端口未监听',
              healthScore: 40
            },
            {
              id: 'check-hosts',
              status: 'healthy',
              statusText: 'Hosts 文件干净',
              healthScore: 100
            }
          ]
        }
      }
      if (func === 'repair') {
        if (params.checkId === 'reset-winsock') {
          return { ok: false, error: '请求的操作需要提升(管理员权限)' }
        }
        return { ok: true, message: `已修复 ${params.checkId}` }
      }
      return { ok: false, error: '未知调用' }
    }
  }

  const diag = await fetchNetworkDiagnostics(mockHost)
  assert.equal(diag.latencyMs, 22)
  assert.equal(diag.proxyInterceptDetected, true)
  const hostsItem = diag.items.find((i) => i.id === 'check-hosts')
  assert.equal(hostsItem?.status, 'healthy')

  // 正常修复无需提权的代理残留项
  const okRepair = await executeNetworkRepair('clear-proxy', mockHost)
  assert.equal(okRepair.ok, true)

  // 异常场景 1：不存在的修复项 ID
  const unknownRepair = await executeNetworkRepair('non-existent-id', mockHost)
  assert.equal(unknownRepair.ok, false)

  // 异常场景 2：需要管理员权限的 Winsock 重置失败时，严禁返回 ok: true
  const failRepair = await executeNetworkRepair('reset-winsock', {
    ...mockHost,
    shell_exec: async () => {
      throw new Error('需要管理员权限')
    }
  })
  assert.equal(failRepair.ok, false)
  assert.match(failRepair.message, /管理员权限/)

  // 异常场景 3：批量修复全部失败时返回 ok: false
  const batchFail = await batchExecuteNetworkRepairs(['reset-winsock'], {
    dllplugin_call: async () => ({ ok: false, error: '权限不足' }),
    shell_exec: async () => {
      throw new Error('权限不足')
    }
  })
  assert.equal(batchFail.ok, false)
  assert.equal(batchFail.repairedCount, 0)
})
