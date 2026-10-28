// Windows cmd 写法的 cURL（浏览器开发者工具「Copy as cURL (cmd)」）：^" 转义、^ 续行、^% 与 \" 的还原
import test from 'node:test'
import assert from 'node:assert/strict'
import { isCmdStyleCurl, parseCurlCommand, tokenizeCmdCommand } from '../dist/curl-service.js'

// 与 Chromium 开发者工具生成 cmd 版 cURL 时的转义规则一致，用来构造真实格式的输入
function escapeForCmd(str) {
  return '^"' +
    str.replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/[^a-zA-Z0-9\s_\-:=+~'\/.',?;()*`]/g, '^$&')
      .replace(/%(?=[a-zA-Z0-9_])/g, '%^')
      .replace(/\r?\n/g, '^\n\n') +
    '^"'
}
const asCmd = (...parts) => parts.join(' ^\n  ')

test('浏览器复制的 cmd 版 cURL：网址、请求头、Cookie 与 JSON 正文按原文还原', () => {
  const url = 'https://api.example.test/v1/items?q=a%20b&page=2'
  const body = '{"name":"ZTools","tags":["a","b"],"note":"50% off & <new>"}'
  const raw = asCmd(
    `curl ${escapeForCmd(url)}`,
    `-H ${escapeForCmd('accept: application/json')}`,
    `-H ${escapeForCmd('content-type: application/json')}`,
    `-b ${escapeForCmd('sid=abc; theme=dark')}`,
    `--data-raw ${escapeForCmd(body)}`,
    '--compressed'
  )
  assert.ok(isCmdStyleCurl(raw))
  const parsed = parseCurlCommand(raw)
  assert.equal(parsed.url, url)
  assert.equal(parsed.method, 'POST')
  assert.equal(parsed.headers.accept, 'application/json')
  assert.equal(parsed.headers['content-type'], 'application/json')
  assert.equal(parsed.headers.Cookie, 'sid=abc; theme=dark')
  assert.equal(parsed.body, body)
  assert.deepEqual(JSON.parse(parsed.body), { name: 'ZTools', tags: ['a', 'b'], note: '50% off & <new>' })
})

test('cmd 版正文里的换行、引号前的反斜杠和中文都不丢', () => {
  const body = '第一行\n第二行 "引号" \\"已转义\\"'
  const raw = asCmd(`curl ${escapeForCmd('https://example.test/post')}`, `-X ${escapeForCmd('PUT')}`, `--data-raw ${escapeForCmd(body)}`)
  const parsed = parseCurlCommand(raw)
  assert.equal(parsed.method, 'PUT')
  assert.equal(parsed.body, body)
})

test('手写的 cmd 命令：真引号与行尾 ^ 续行，引号内的 ^ 按字面保留', () => {
  const raw = 'curl "https://example.test/a" ^\n  -H "X-Pattern: ^abc$" ^\n  -d "k=v"'
  assert.deepEqual(tokenizeCmdCommand(raw), ['curl', 'https://example.test/a', '-H', 'X-Pattern: ^abc$', '-d', 'k=v'])
  const parsed = parseCurlCommand(raw)
  assert.equal(parsed.headers['X-Pattern'], '^abc$')
  assert.equal(parsed.body, 'k=v')
})

test('空参数与引号内的连续双引号', () => {
  assert.deepEqual(tokenizeCmdCommand('curl "https://e.test/" -d ""'), ['curl', 'https://e.test/', '-d', ''])
  assert.deepEqual(tokenizeCmdCommand('curl "a""b"'), ['curl', 'a"b'])
})

test('[异常] cmd 版命令引号未闭合时明确报错，不猜测内容', () => {
  assert.throws(() => parseCurlCommand('curl ^"https://example.test/ok^" -H "broken ^\n'), /未闭合引号/)
})

test('bash 写法不受影响：单引号、\\ 续行仍按原规则解析', () => {
  const parsed = parseCurlCommand("curl 'https://example.test/x' \\\n  -H 'a: b' \\\n  --data-raw '{\"k\":\"^v\"}'")
  assert.equal(isCmdStyleCurl("curl 'https://example.test/x' -H 'a: b'"), false)
  assert.equal(parsed.headers.a, 'b')
  assert.equal(parsed.body, '{"k":"^v"}')
})
