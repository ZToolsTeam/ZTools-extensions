// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout1-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  executeWindowAction
} from '../dist/window-actions.js'

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

test('P07 window-management: executeWindowAction 真实 IPC 桥接与失败时返回 success:false', async () => {
  let invokedPayload = null
  const okRes = await executeWindowAction('left-half', {
    windowId: 'hwnd-1001',
    hostBridge: {
      window_manage_action: async (payload) => {
        invokedPayload = payload
        return { ok: true, rect: { x: 0, y: 0, width: 960, height: 1040 } }
      }
    }
  })
  assert.equal(okRes.success, true)
  assert.equal(invokedPayload?.action, 'left-half')
  assert.equal(okRes.rect?.width, 960)

  // 异常场景 1：空 actionId 校验失败
  const emptyRes = await executeWindowAction('', {})
  assert.equal(emptyRes.success, false)
  assert.ok(emptyRes.error)

  // 异常场景 2：宿主无活动外部窗口或拒绝移动时，必须返回 success: false
  const failRes = await executeWindowAction('maximize', {
    hostBridge: {
      window_manage_action: async () => {
        throw new Error('当前无可用前台窗口句柄')
      }
    }
  })
  assert.equal(failRes.success, false)
  assert.match(failRes.error || '', /无可用前台窗口句柄/)
})
