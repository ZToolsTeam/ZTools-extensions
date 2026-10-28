import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import { CurlHttpCommand } from '../dist/index.js'

const host = createHost()
test.beforeEach(() => host.reset())
const reply = { success: true, data: { statusCode: 200, statusText: 'OK', body: '{"verified":true}' } }
const send = (view) => view.run(view.item(n => n.props.id === 'curl-overview'), '立即发起 HTTP 请求')

test('真实宿主初始请求为空，不预填或发送示例请求', async () => {
  const view = await mount(CurlHttpCommand)
  try {
    assert.equal(view.tree().props.searchText, '')
    assert.doesNotMatch(view.text(), /httpbin\.org/)
    assert.equal(host.ipcCalls.length, 0)
    await view.search('http://localhost/audit')
    assert.equal(view.item(n => n.props.id === 'curl-overview').props.id, 'curl-overview')
  } finally { view.unmount() }
})

test('修改请求后清除旧响应，下一次请求失败不保留旧成功结果', async () => {
  host.ipc.network_http_request = async () => reply
  const view = await mount(CurlHttpCommand)
  try {
    await view.search('http://localhost/audit')
    await send(view)
    assert.match(view.text(), /verified/)
    await view.search('http://localhost/new')
    assert.doesNotMatch(view.text(), /verified|HTTP 200/)
    host.ipc.network_http_request = async () => { throw new Error('连接被拒绝') }
    await send(view)
    assert.equal(host.lastToast().style, 'FAILURE')
    assert.doesNotMatch(view.text(), /verified|HTTP 200/)
  } finally { view.unmount() }
})

test('请求途中修改输入或离开页面，迟到响应不覆盖新请求也不弹成功提示', async () => {
  for (const leave of [false, true]) {
    host.reset()
    let resolveRequest
    host.ipc.network_http_request = () => new Promise(resolve => { resolveRequest = resolve })
    const view = await mount(CurlHttpCommand)
    await view.search('http://localhost/audit')
    await send(view)
    assert.equal(view.tree().props.isLoading, true)
    if (leave) view.unmount()
    else await view.search('http://localhost/changed')
    resolveRequest(reply)
    await tick()
    assert.equal(host.toasts.length, 0)
    if (!leave) {
      assert.doesNotMatch(view.text(), /verified|HTTP 200/)
      assert.equal(view.tree().props.isLoading, false)
      view.unmount()
    }
  }
})

test('不在客户端里运行时同样不预填示例请求', async () => {
  const saved = globalThis.__ztoolsElectron
  delete globalThis.__ztoolsElectron
  try {
    const view = await mount(CurlHttpCommand)
    await tick()
    assert.doesNotMatch(view.text(), /httpbin\.org|declarative-ui/)
    assert.equal(view.items()[0].props.id, 'curl-parse-error')
    view.unmount()
  } finally {
    globalThis.__ztoolsElectron = saved
  }
})

test('DELETE / PUT 请求发送前必须确认，取消时不发请求；GET 不需要确认', async () => {
  host.ipc.network_http_request = async () => reply
  const view = await mount(CurlHttpCommand)
  await view.search('curl -X DELETE "https://example.test/items/1"')
  host.setConfirm(false)
  await send(view)
  await tick()
  assert.equal(host.confirms.length, 1)
  assert.match(host.confirms[0].title, /DELETE/)
  assert.equal(host.ipcCalls.filter(([m]) => m === 'network_http_request').length, 0)
  host.setConfirm(true)
  await send(view)
  await tick()
  assert.equal(host.ipcCalls.filter(([m]) => m === 'network_http_request').length, 1)
  await view.search('curl -X PUT "https://example.test/items/1" -d "a=1"')
  host.setConfirm(false)
  await send(view)
  await tick()
  assert.equal(host.confirms.length, 3)
  assert.equal(host.ipcCalls.filter(([m]) => m === 'network_http_request').length, 1)
  await view.search('https://example.test/items')
  await send(view)
  await tick()
  assert.equal(host.confirms.length, 3)
  assert.equal(host.ipcCalls.filter(([m]) => m === 'network_http_request').length, 2)
  view.unmount()
})
