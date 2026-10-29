// bash 写法 cURL 的解析：$'...'、双引号内的反斜杠、选项参数不被误当网址、无法如实发出的选项明确报错
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost } from '../../shared/test-harness.mjs'
import { executeCurlRequest, parseCurlCommand, prepareRequestHeaders, tokenizeShellCommand } from '../dist/curl-service.js'

const host = createHost()
test.beforeEach(() => host.reset())

test("Chrome「Copy as cURL (bash)」的 $'...' 正文按 bash 规则解码", () => {
  // Chrome 在内容含单引号、换行或 ! 时用 $'...'，! 写成 !
  const raw = "curl 'https://api.example.test/x' \\\n  -H 'content-type: application/json' \\\n  --data-raw $'{\"note\":\"it\\'s\\\\n ok\\u0021\",\"line\":\"a\\nb\"}'"
  const parsed = parseCurlCommand(raw)
  assert.equal(parsed.body, '{"note":"it\'s\\n ok!","line":"a\nb"}')
  assert.equal(parsed.method, 'POST')
})

test('双引号内只有 $ ` " \\ 会被反斜杠转义，其他反斜杠保留', () => {
  assert.deepEqual(tokenizeShellCommand('curl "a\\nb\\"c\\\\d\\$e"'), ['curl', 'a\\nb"c\\d$e'])
  assert.deepEqual(tokenizeShellCommand("curl 'https://e.test' -d '' -H 'x: 1'"), ['curl', 'https://e.test', '-d', '', '-H', 'x: 1'])
})

test('-e 来源网址、-x 代理地址等选项参数不会被当成目标网址，未生效的选项如实列出', () => {
  const parsed = parseCurlCommand("curl 'https://target.test/a' -e 'https://ref.test/' -x http://proxy.test:8080 -k --compressed -sSL")
  assert.equal(parsed.url, 'https://target.test/a')
  assert.equal(parsed.headers.Referer, 'https://ref.test/')
  assert.ok(parsed.ignoredOptions.includes('-x'))
  assert.ok(parsed.ignoredOptions.some((item) => item.startsWith('-k')))
  assert.ok(!parsed.ignoredOptions.includes('--compressed'))
})

test('合写短选项、-I、-G、-A、--json 与 --data-urlencode', () => {
  assert.equal(parseCurlCommand('curl -XPUT https://e.test -d a=1').method, 'PUT')
  assert.equal(parseCurlCommand('curl -sX DELETE https://e.test').method, 'DELETE')
  assert.equal(parseCurlCommand('curl -I https://e.test').method, 'HEAD')
  const get = parseCurlCommand('curl -G https://e.test/s?x=1 -d q=a --data-urlencode "w=a b!"')
  assert.equal(get.method, 'GET')
  assert.equal(get.body, undefined)
  assert.equal(get.url, 'https://e.test/s?x=1&q=a&w=a%20b%21')
  const json = parseCurlCommand('curl --json \'{"a":1}\' https://e.test -A "UA/1"')
  assert.equal(json.method, 'POST')
  assert.equal(json.headers['Content-Type'], 'application/json')
  assert.equal(json.headers.Accept, 'application/json')
  assert.equal(json.headers['User-Agent'], 'UA/1')
})

test('-u 支持中文用户名，-H "Name;" 发送空值、"Name:" 去掉请求头', () => {
  const parsed = parseCurlCommand('curl -u "用户:密码" -H "X-A: 1" -H "X-A:" -H "X-Empty;" https://e.test')
  assert.equal(parsed.headers.Authorization, `Basic ${Buffer.from('用户:密码').toString('base64')}`)
  assert.equal(parsed.headers['X-A'], undefined)
  assert.equal(parsed.headers['X-Empty'], '')
})

test('[异常] 需要读取本地文件或无法如实发出的选项直接报错，不发出不同的请求', () => {
  assert.throws(() => parseCurlCommand('curl -d @body.json https://e.test'), /本地文件/)
  assert.throws(() => parseCurlCommand('curl --data-urlencode name@file.txt https://e.test'), /本地文件/)
  assert.throws(() => parseCurlCommand('curl -F file=@a.png https://e.test'), /不支持表单上传/)
  assert.throws(() => parseCurlCommand('curl -T a.bin https://e.test'), /不支持上传文件/)
  assert.throws(() => parseCurlCommand('curl -b cookies.txt https://e.test'), /Cookie 文件/)
  assert.throws(() => parseCurlCommand('curl -H "bad header" https://e.test'), /无法识别请求头/)
  assert.throws(() => parseCurlCommand('curl ftp://e.test/file'), /只支持 http/)
  assert.throws(() => parseCurlCommand("curl $'https://e.test"), /未闭合引号/)
  assert.throws(() => parseCurlCommand('curl https://e.test -H'), /缺少内容/)
})

test('没写协议的网址按 http 处理（与 curl 一致）', () => {
  assert.equal(parseCurlCommand('curl example.test/path').url, 'http://example.test/path')
})

test('Firefox 复制的 Connection / TE 请求头发送前去掉并告知，Host 等无法自定义的请求头明确报错', async () => {
  const parsed = parseCurlCommand("curl 'https://e.test/' -H 'Connection: keep-alive' -H 'TE: trailers' -H 'Accept: */*'")
  host.ipc.network_http_request = async (params) => {
    assert.deepEqual(params.headers, { Accept: '*/*' })
    return { success: true, data: { statusCode: 200, statusText: 'OK', body: 'x' } }
  }
  const snap = await executeCurlRequest(parsed)
  assert.deepEqual(snap.ignoredHeaders, ['Connection', 'TE'])
  assert.equal(snap.isJson, false)
  assert.throws(() => prepareRequestHeaders({ Host: 'other.test' }), /不能自定义 Host/)
  await assert.rejects(executeCurlRequest(parseCurlCommand("curl https://e.test -H 'Host: x'")), /不能自定义 Host/)
  await assert.rejects(executeCurlRequest({ ...parsed, method: 'POST', body: 'x'.repeat(768 * 1024 + 1) }), /请求体超过/)
  assert.equal(host.ipcCalls.filter(([m]) => m === 'network_http_request').length, 1)
})
