import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost } from '../../shared/test-harness.mjs'
import { executeCurlRequest, parseCurlCommand } from '../dist/curl-service.js'

const host = createHost()
test.beforeEach(() => host.reset())
const response = (body, statusCode = 200, statusText = 'OK') => ({ success: true, data: { body, statusCode, statusText } })

test('请求走宿主网络通道，保留方法、请求头、正文和 UTF-8 字节数', async () => {
  const parsed = parseCurlCommand('curl -X POST "http://127.0.0.1:53159/ok" -H "Content-Type: application/json" -d \'{"name":"测试"}\'')
  host.ipc.network_http_request = async (params) => {
    assert.deepEqual(params, { method: 'POST', url: parsed.url, headers: parsed.headers, body: parsed.body, timeout: 10000 })
    return response('{"message":"中文"}', 201, 'Created')
  }
  const result = await executeCurlRequest(parsed)
  assert.equal(result.ok, true)
  assert.equal(result.status, 201)
  assert.deepEqual(result.responseHeaders, {}, '宿主未提供响应头时，不伪造 Content-Type')
  assert.equal(result.sizeBytes, Buffer.byteLength('{"message":"中文"}'))
  assert.deepEqual(JSON.parse(result.bodyText), { message: '中文' })
  assert.equal(host.ipcCalls.length, 1)
})

test('HTTP 错误状态保留响应正文，不冒充成功', async () => {
  host.ipc.network_http_request = async () => response('service unavailable', 503, 'Service Unavailable')
  const result = await executeCurlRequest(parseCurlCommand('https://example.test/failed'))
  assert.equal(result.ok, false)
  assert.equal(result.status, 503)
  assert.equal(result.bodyText, 'service unavailable')
})

test('HEAD 和无正文响应能正常显示，GET 不转发正文', async () => {
  for (const method of ['HEAD', 'GET']) {
    host.ipc.network_http_request = async (params) => {
      assert.equal(params.body, undefined)
      return response('', 204, 'No Content')
    }
    const result = await executeCurlRequest({ method, url: 'https://example.test/empty', headers: {}, body: 'ignored' })
    assert.equal(result.status, 204)
    assert.equal(result.bodyText, '')
  }
})

test('宿主拒绝、超时、断网和畸形响应都向界面报错', async () => {
  const parsed = parseCurlCommand('https://example.test/')
  for (const result of [undefined, {}, { success: true, data: {} }, response('', 0), response('', 200.5)]) {
    host.ipc.network_http_request = async () => result
    await assert.rejects(executeCurlRequest(parsed), /响应/)
  }
  host.ipc.network_http_request = async () => { throw new Error('DNS 解析失败') }
  await assert.rejects(executeCurlRequest(parsed), /DNS 解析失败/)
  host.ipc.network_http_request = async () => { throw Object.assign(new Error('超时'), { code: 'REQUEST_TIMEOUT' }) }
  await assert.rejects(executeCurlRequest(parsed, { timeoutMs: 100 }), /HTTP_TIMEOUT.*100ms/)
})

test('不支持的方法、DELETE 正文和无效超时在发请求前明确拒绝', async () => {
  const parsed = parseCurlCommand('https://example.test/')
  await assert.rejects(executeCurlRequest({ ...parsed, method: 'PATCH' }), /不支持 PATCH/)
  await assert.rejects(executeCurlRequest({ ...parsed, method: 'DELETE', body: 'body' }), /不支持带请求体/)
  for (const timeoutMs of [0, -1, NaN, 1.5, 300001]) {
    await assert.rejects(executeCurlRequest(parsed, { timeoutMs }), /超时必须/)
  }
  assert.equal(host.ipcCalls.length, 0)
})

test('宿主通道缺失时不回退到有 CORS 限制的页面 fetch', async () => {
  const previousWindow = globalThis.window
  globalThis.window = {}
  try {
    await assert.rejects(executeCurlRequest(parseCurlCommand('https://example.test/')), /不支持网络请求/)
  } finally {
    globalThis.window = previousWindow
  }
})
