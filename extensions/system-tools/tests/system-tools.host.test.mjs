// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout1-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SYSTEM_ACTIONS,
  executeSystemAction
} from '../dist/system-actions.js'

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

test('P08 system: executeSystemAction 真实调用 system_execute_action 与失败时禁止静默成功', async () => {
  const lockItem = SYSTEM_ACTIONS.find((a) => a.id === 'lock-screen')
  assert.ok(lockItem)

  let calledKey = ''
  const okRes = await executeSystemAction(lockItem, {
    hostOverride: {
      system_execute_action: async (payload) => {
        calledKey = payload.actionKey
        return { ok: true, message: '已调用 LockWorkStation 锁屏' }
      }
    }
  })
  assert.equal(okRes.success, true)
  assert.equal(okRes.executed, true)
  assert.equal(calledKey, 'lockScreen')

  // 异常场景 1：传入未知指令字符串
  const invalidRes = await executeSystemAction('non-existent-system-cmd', {})
  assert.equal(invalidRes.success, false)
  assert.equal(invalidRes.executed, false)

  // 异常场景 2：宿主执行系统指令失败时，严禁落入假成功分支返回 success: true
  const failRes = await executeSystemAction('toggle-desktop-icons', {
    hostOverride: {
      system_execute_action: async () => ({ ok: false, error: 'Explorer 句柄未响应' }),
      dllplugin_call: async () => ({ ok: false, error: 'Explorer 句柄未响应' })
    }
  })
  assert.equal(failRes.success, false)
  assert.equal(failRes.executed, false)
  assert.match(failRes.message, /Explorer 句柄未响应/)
})
