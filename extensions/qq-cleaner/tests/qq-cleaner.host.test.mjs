// 本插件的宿主集成测试（导入本插件编译后的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as qqCleaner from '../dist/logic.js'

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

test('qq-cleaner：源码只用系统默认目录作兜底路径，宿主通道不可用时如实返回失败、不模拟数据，聊天数据库清理被拦截', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/logic.ts'), 'utf-8')
  // 源码里写死的 Windows 绝对路径只能是系统默认目录兜底（C:\Users\Default\...、C:\Windows\...），真实目录一律运行时向宿主查询
  const driveLiterals = src.match(/'[A-Za-z]:\\\\[^']*'/g) || []
  assert.ok(driveLiterals.length > 0)
  for (const literal of driveLiterals) {
    assert.match(literal, /^'C:\\\\(?:Users\\\\Default|Windows)\\\\/, `写死了非系统默认目录：${literal}`)
  }
  const failHost = createRealHostStub({})
  const qqRes = await qqCleaner.invokeNativeCapability('ScanQQStorage', { mode: 'fast' }, failHost)
  assert.equal(qqRes.ok, false)
  assert.equal(qqRes.data?.simulated, undefined)
  await assert.rejects(
    () => qqCleaner.invokeNativeCapability('CleanStorage', { path: 'C:\\Tencent Files\\10001\\Msg3.0.db' }, failHost),
    /SECURITY_INTERCEPTED/
  )
})
