// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout2-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as wechatCleaner from '../dist/logic.js'

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

test("P19 & P20 wechat-cleaner & qq-cleaner: 彻底消除 D:\\Local\\Roaming\\Tencent 私人硬编码路径与真实传输验证（wechat-cleaner 部分）", async () => {
  const wechatSrc = fs.readFileSync(
    path.join(__dirname, '../src/logic.ts'),
    'utf-8'
  )
  const qqSrc = fs.readFileSync(
    path.join(__dirname, '../src/logic.ts'),
    'utf-8'
  )
  assert.equal(wechatSrc.includes('D:\\Local\\Roaming\\Tencent'), false)
  assert.equal(wechatSrc.includes('D:\\\\Local\\\\Roaming\\\\Tencent'), false)
  assert.equal(qqSrc.includes('D:\\Local\\Roaming\\Tencent'), false)
  assert.equal(qqSrc.includes('D:\\\\Local\\\\Roaming\\\\Tencent'), false)
  const failHost = createRealHostStub({})
  const wxRes = await wechatCleaner.invokeNativeCapability('ScanWeChatStorage', { mode: 'fast' }, failHost)
  assert.equal(wxRes.ok, false)
  assert.equal(wxRes.data?.simulated, undefined)
  await assert.rejects(
    () => wechatCleaner.invokeNativeCapability('', {}, failHost),
    /INVALID_METHOD/
  )
})
