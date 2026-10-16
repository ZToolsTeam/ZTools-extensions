import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Command = require('../dist/index.js').default
const {
  DLL_PLUGIN_NAME,
  getCapabilityItems,
  filterCapabilityItems,
  validateInvocationPayload,
  invokeNativeCapability
} = require('../dist/logic.js')

test('boost 声明式视图渲染与端到端 Native 调用集成测试', async () => {
  const view = Command()
  assert.ok(view, '应返回声明式视图描述符')
  assert.equal(view.type, 'List')
  assert.ok(Array.isArray(view.children) && view.children.length === 1)

  const section = view.children[0]
  assert.equal(section.type, 'List.Section')
  assert.ok(section.children.length >= 3, '应渲染预设能力项列表')

  const firstItem = section.children[0]
  assert.equal(firstItem.type, 'List.Item')
  assert.ok(firstItem.props.actions, '每个列表项必须挂载 ActionPanel')

  // 验证模拟宿主桥接全链路调用
  const calls = []
  const mockHost = {
    dllplugin: {
      call: async (plugin, fn, payload) => {
        calls.push({ plugin, fn, payload })
        return JSON.stringify({ status: 'ok', executedMethod: fn })
      }
    }
  }

  const preset = getCapabilityItems()[0]
  const res = await invokeNativeCapability(preset.method, preset.params, mockHost)
  assert.equal(res.ok, true)
  assert.equal(res.pluginName, DLL_PLUGIN_NAME)
  assert.equal(res.fromFallback, false)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].plugin, DLL_PLUGIN_NAME)
  assert.equal(calls[0].fn, preset.method)
})

test('boost 搜索过滤与空值/畸形输入防御测试 (Beyond Happy Path)', () => {
  const items = getCapabilityItems()
  assert.equal(filterCapabilityItems(items, '').length, items.length)
  assert.equal(filterCapabilityItems(items, '   ').length, items.length)
  assert.equal(filterCapabilityItems(items, '__NON_EXISTENT_KEYWORD_999__').length, 0)
  assert.deepEqual(filterCapabilityItems(null, 'test'), [])

  // 非法方法名与空参数校验
  assert.equal(validateInvocationPayload('', {}).valid, false)
  assert.equal(validateInvocationPayload('bad method!', {}).valid, false)
  assert.equal(validateInvocationPayload('ValidMethod', null).valid, false)
  assert.equal(validateInvocationPayload('ValidMethod', []).valid, false)
  assert.equal(validateInvocationPayload('ValidMethod', { num: Number.POSITIVE_INFINITY }).valid, false)
  assert.equal(validateInvocationPayload('ValidMethod', { str: 'a'.repeat(5000) }).valid, false)
})

test('boost 安全规则拦截与底层 DLL 崩溃/乱码故障注入测试', async () => {
  // 1. 业务安全边界拦截
  await assert.rejects(
    () => invokeNativeCapability('TestMethod', { target: "Windows Defender" }),
    /SECURITY_INTERCEPTED/
  )

  // 2. 注入 DLL 子进程崩溃异常
  const crashHost = {
    dllplugin: {
      call: async () => {
        throw new Error('NativeHost32 subprocess terminated unexpectedly (exit code -9)')
      }
    }
  }
  const crashRes = await invokeNativeCapability('GetStatus', {}, crashHost)
  assert.equal(crashRes.ok, false)
  assert.match(crashRes.error, /^NATIVE_CALL_FAILED:/)

  // 3. 注入 DLL 业务错误返回
  const errHost = {
    dllplugin: {
      call: async () => ({ error: 'ACCESS_DENIED_BY_SERVICE' })
    }
  }
  const errRes = await invokeNativeCapability('GetStatus', {}, errHost)
  assert.equal(errRes.ok, false)
  assert.match(errRes.error, /^DLL_ERROR: ACCESS_DENIED_BY_SERVICE/)

  // 4. 注入截断/损坏的 JSON 报文
  const corruptHost = {
    dllplugin: {
      call: async () => '{"corrupted_json": true'
    }
  }
  await assert.rejects(
    () => invokeNativeCapability('GetStatus', {}, corruptHost),
    /MALFORMED_DLL_RESPONSE/
  )
})
