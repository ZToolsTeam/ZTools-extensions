// 本插件的宿主集成测试（导入本插件的 dist/）
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

test('window-management: executeWindowAction 真实 IPC 桥接与失败时返回 success:false', async () => {
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
  assert.deepEqual(invokedPayload, { action: 'left-half' }, '不得向只接受动作名的宿主传递插件窗口句柄或估算矩形')
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

test('窗口动作：旧四角 ID 统一提交规范名，宿主缺回执不成功，不伪造坐标', async () => {
  for (const value of [undefined, {}, { ok: false }, { success: false }, { ok: true, success: false }]) {
    const result = await executeWindowAction('left-half', { hostBridge: { window_manage_action: async () => value } })
    assert.equal(result.success, false)
    assert.equal(result.rect, undefined)
  }
  const calls = []
  const result = await executeWindowAction('top-left-quarter', { hostBridge: { window_manage_action: async payload => { calls.push(payload); return { success: true } } } })
  assert.equal(result.success, true)
  assert.equal(result.rect, undefined)
  assert.deepEqual(calls, [{ action: 'top-left' }])
  for (const action of ['center-half', 'top-left-sixth', 'almost-maximize-80', 'minimize']) {
    assert.equal((await executeWindowAction(action, { hostBridge: { window_manage_action: async () => { throw new Error('不能调用'); } } })).success, false)
  }
})

test('窗口动作按真实平台能力取交集：Windows 20项，Mac保留还原、四角与合理尺寸', async () => {
  const { loadSupportedWindowActions, WINDOW_ACTIONS } = await import('../dist/window-actions.js')
  const names = WINDOW_ACTIONS.map(action => action.id)
  const windowsNames = names.filter(name => name !== 'restore')
  const macNames = names.filter(name => name !== 'next-display' && name !== 'previous-display')
  const windows = await loadSupportedWindowActions({ window_manage_list_actions: async () => windowsNames.map(name => ({ name })) })
  const mac = await loadSupportedWindowActions({ window_manage_list_actions: async () => macNames.map(name => ({ name })) })
  assert.equal(windows.length, 20)
  assert.deepEqual(windows.map(action => action.id), windowsNames)
  assert.equal(mac.length, 19)
  assert.deepEqual(mac.map(action => action.id), macNames)
  assert.ok(['restore', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'reasonable-size'].every(name => mac.some(action => action.id === name)))
  const calls = []
  assert.equal((await executeWindowAction('restore', { hostBridge: { window_manage_action: async payload => { calls.push(payload); return { success: true } } } })).success, true)
  assert.deepEqual(calls, [{ action: 'restore' }])
  await assert.rejects(loadSupportedWindowActions({ window_manage_list_actions: async () => ({ success: true }) }), /无法读取/)
  await assert.rejects(loadSupportedWindowActions({ window_manage_list_actions: async () => { throw new Error('接口不可用') } }), /接口不可用/)
})
