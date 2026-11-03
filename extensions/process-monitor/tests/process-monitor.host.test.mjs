// 本插件的宿主集成测试（导入本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchProcesses,
  fetchProcessDetail,
  terminateProcess,
  validateInvocationPayload,
  invokeNativeCapability as invokeProcessMonitorCapability
} from '../dist/logic.js'

test('公共参数校验保留方法、对象、字符串、数值边界和关键进程保护', () => {
  for (const number of [-1000, 0, 100_000_000]) {
    assert.deepEqual(validateInvocationPayload(' GetProcessList ', { number }), { valid: true })
  }
  for (const params of [null, undefined, [], 0, 'text']) {
    assert.match(validateInvocationPayload('GetProcessList', params).error, /INVALID_PARAMS/)
  }
  for (const method of ['', '  ', null]) {
    assert.match(validateInvocationPayload(method, {}).error, /INVALID_METHOD/)
  }
  for (const method of ['bad/method', 'A'.repeat(129)]) {
    assert.match(validateInvocationPayload(method, {}).error, /INVALID_METHOD_FORMAT/)
  }
  assert.equal(validateInvocationPayload('GetProcessList', { value: 'a'.repeat(4096) }).valid, true)
  assert.match(validateInvocationPayload('GetProcessList', { value: 'a'.repeat(4097) }).error, /PARAM_TOO_LONG/)
  for (const number of [-1001, 100_000_001, NaN, Infinity]) {
    assert.match(validateInvocationPayload('GetProcessList', { number }).error, /PARAM_OUT_OF_RANGE/)
  }
  assert.match(validateInvocationPayload('GetProcessList', { name: 'csrss.exe' }).error, /SECURITY_INTERCEPTED/)
  assert.equal(validateInvocationPayload('GetProcessList', { name: 'notepad.exe' }).valid, true)
})

test('公共调用回执保留零值、失败原因和空数据语义，并在非法参数时阻止宿主调用', async () => {
  const calls = []
  let reply = { ok: true, data: null }
  const host = {
    invokeNative: async (pluginName, method, params) => {
      calls.push({ pluginName, method, params })
      return reply
    }
  }
  for (const data of [null, 0, false]) {
    reply = { ok: true, data }
    const result = await invokeProcessMonitorCapability(' GetProcessList ', {}, host)
    assert.equal(result.ok, true)
    assert.equal(result.pluginName, 'ProcessMonitorPlugin')
    assert.equal(result.method, 'GetProcessList')
    assert.equal(result.data, data ?? undefined)
    assert.equal(result.fromFallback, false)
  }
  reply = { ok: false, error: 'ACCESS_DENIED' }
  const denied = await invokeProcessMonitorCapability('GetProcessList', {}, host)
  assert.equal(denied.ok, false)
  assert.match(denied.error, /ACCESS_DENIED/)
  assert.equal(denied.data, undefined)
  await assert.rejects(invokeProcessMonitorCapability('bad/method', {}, host), /INVALID_METHOD_FORMAT/)
  assert.equal(calls.length, 4)
  assert.ok(calls.every(({ pluginName, method }) => pluginName === 'ProcessMonitorPlugin' && method === 'GetProcessList'))
})

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
