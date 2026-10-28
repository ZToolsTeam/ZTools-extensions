import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { Clipboard } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import { JwtUrlCodecCommand, parseAndInspectUrl, decodeJwtToken, signJwtHmacSha256, verifyJwtHmacSha256, decodeBase64UrlToUtf8, encodeUtf8ToBase64Url, fencedBlock } from '../dist/index.js'

const secret = '  本地测试密钥  '
const token = (payload = { sub: '测试' }, header = { alg: 'HS256', typ: 'JWT' }) => {
  const data = [header, payload].map(v => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.')
  return `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}`
}

test('URL查询只解码一次，保留原始编码、重复键和等号', () => {
  const result = parseAndInspectUrl('https://example.test/a+b?language=C%2B%2B&literal=%252F&a=1&a=2&x=a=b&space=a+b&%E9%94%AE=%E5%80%BC')
  assert.deepEqual(result.queryParams.map(v => v.decodedValue), ['C++', '%2F', '1', '2', 'a=b', 'a b', '值'])
  assert.equal(result.queryParams[0].rawValue, 'C%2B%2B')
  assert.equal(result.queryParams.at(-1).rawKey, '%E9%94%AE')
  assert.match(result.decodedFullUrl, /\/a\+b\?/)
  assert.equal(new URL(result.encodedFullUrl).searchParams.get('language'), 'C++')
  assert.deepEqual(parseAndInspectUrl('https://example.test/??x=1&?y=2').queryParams.map(v => v.key), ['?x', '?y'])
})

test('域名与裸查询分别识别，协议和端口不伪造', () => {
  for (const input of ['example.test/path?a=1', '//example.test/path?a=1']) {
    const value = parseAndInspectUrl(input)
    assert.equal(value.host, 'example.test')
    assert.equal(value.pathname, '/path')
    assert.equal(value.protocol, 'https')
  }
  assert.equal(parseAndInspectUrl('localhost:3000/a?b=1').port, '3000')
  assert.equal(parseAndInspectUrl('a=1&b=https%3A%2F%2Fexample.test').protocol, 'query-only')
  assert.equal(parseAndInspectUrl('?a=1').queryParams[0].decodedValue, '1')
  assert.equal(parseAndInspectUrl('flag&=value&a=1').queryParams.length, 3)
  assert.equal(parseAndInspectUrl('mailto:test@example.test?subject=hello').port, '-')
})

test('浏览器无Buffer分支仍能严格处理中文UTF8与Base64URL', () => {
  const previous = globalThis.Buffer
  const encoded = Buffer.from('中文 + /').toString('base64url')
  try {
    globalThis.Buffer = undefined
    assert.equal(decodeBase64UrlToUtf8(encoded), '中文 + /')
    assert.equal(encodeUtf8ToBase64Url('中文 + /'), encoded)
    assert.throws(() => decodeBase64UrlToUtf8('_w'))
    assert.throws(() => decodeBase64UrlToUtf8('a'))
  } finally { globalThis.Buffer = previous }
})

test('验签等待剪贴板时改输入、切换模式或卸载，迟到结果均不回写', async () => {
  for (const action of ['input', 'mode', 'unmount']) {
    const host = createHost(), view = await mount(JwtUrlCodecCommand, host)
    const originalRead = Clipboard.readText
    let resolveRead
    try {
      await view.search(token())
      Clipboard.readText = () => new Promise(resolve => { resolveRead = resolve })
      const pending = view.run(view.item('jwt-overview'), '使用剪贴板密钥校验 HS256 签名')
      await tick(2)
      if (action === 'input') await view.search(token({ sub: '另一个' }))
      if (action === 'mode') await view.dropdown('url')
      if (action === 'unmount') view.unmount()
      resolveRead(secret)
      await pending; await tick(20)
      assert.equal(host.toasts.length, 0)
      if (action !== 'unmount') assert.doesNotMatch(view.text(), /验签通过/)
    } finally { Clipboard.readText = originalRead; if (action !== 'unmount') view.unmount() }
  }
})

test('倒计时随时钟推进更新，越过exp后显示已过期', async context => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1_000_000 })
  const host = createHost(), view = await mount(JwtUrlCodecCommand, host)
  try {
    await view.search(token({ exp: 1001 }))
    assert.match(JSON.stringify(view.item('jwt-overview').props.accessories), /尚未过期/)
    context.mock.timers.tick(1000)
    await tick(20)
    assert.match(JSON.stringify(view.item('jwt-overview').props.accessories), /已过期/)
  } finally { view.unmount() }
})

test('HS256签发与独立Node HMAC结果一致，算法覆盖和未知关键扩展必须拒绝', async () => {
  const value = await signJwtHmacSha256({ sub: '测试' }, secret)
  assert.equal(value, token())
  assert.equal((await verifyJwtHmacSha256(value, secret)).verified, true)
  assert.equal((await verifyJwtHmacSha256(value, 'wrong')).verified, false)
  for (const alg of ['none', 'RS256', 'hs256', 'HS384']) {
    await assert.rejects(signJwtHmacSha256({}, secret, { alg }), /HS256/)
    assert.equal((await verifyJwtHmacSha256(token({}, { alg }), secret)).verified, false)
  }
  for (const header of [{ alg: 'HS256', crit: ['unknown'], unknown: true }, { alg: 'HS256', b64: false }]) {
    await assert.rejects(signJwtHmacSha256({}, secret, header))
    assert.equal((await verifyJwtHmacSha256(token({}, header), secret)).verified, false)
  }
})

test('JWT时间声明不是授权结论，零时刻、未生效和非法exp均明确区分', () => {
  const now = 1_000_000
  assert.equal(decodeJwtToken(token({ exp: 0 }), now).isExpired, true)
  assert.ok(decodeJwtToken(token({ exp: 0 }), now).expiresAtText)
  assert.equal(decodeJwtToken(token({ nbf: 1100, exp: 1200 }), now).timeStatus, '尚未生效')
  assert.equal(decodeJwtToken(token({ exp: 1100 }), now).timeStatus, '尚未过期')
  assert.equal(decodeJwtToken(token({ exp: '1100' }), now).timeStatus, '时间声明异常')
  assert.equal(decodeJwtToken(token({}), now).timeStatus, '未声明到期')
  assert.doesNotMatch(decodeJwtToken(token({}), now).expiryCountdownText, /永不过期/)
})

test('非法UTF8与带填充的JWT不能被静默改写后当作正确载荷', () => {
  const header = Buffer.from('{"alg":"HS256"}').toString('base64url')
  const invalid = Buffer.concat([Buffer.from('{"x":"'), Buffer.from([0xff]), Buffer.from('"}')]).toString('base64url')
  assert.throws(() => decodeJwtToken(`${header}.${invalid}.signature`), /INVALID_JWT_PAYLOAD/)
  assert.throws(() => decodeJwtToken(`${header}=.e30.signature`), /INVALID_JWT_HEADER/)
  assert.throws(() => decodeJwtToken(`${header} .e30.signature`), /INVALID_JWT_HEADER/)
})

test('用户提供的反引号、换行与Markdown只能作为代码块原文', async () => {
  const payload = '\r```\r![probe](https://example.invalid/private)\r```\r'
  assert.equal(fencedBlock(payload), '````text\n\n```\n![probe](https://example.invalid/private)\n```\n\n````')
  const host = createHost(), view = await mount(JwtUrlCodecCommand, host)
  try {
    await view.dropdown('url')
    await view.search(`https://example.test/?${encodeURIComponent(payload)}=${encodeURIComponent(payload)}`)
    const detail = view.items().find(item => item.props.id !== 'url-overview').props.detail.props.markdown
    assert.ok(detail.startsWith('### 参数名称\n' + fencedBlock(payload)))
    assert.ok(detail.includes('#### 解码值\n' + fencedBlock(payload)))
  } finally { view.unmount() }
})

test('真实SDK动作保留密钥空格；换Token后清除旧验签结果，不复用上次密钥', async () => {
  const host = createHost(), view = await mount(JwtUrlCodecCommand, host)
  try {
    await view.search(token())
    host.clipboard.text = secret
    await view.run(view.item('jwt-overview'), '使用剪贴板密钥校验 HS256 签名')
    await tick(20); await new Promise(resolve => setTimeout(resolve, 20)); await tick(20)
    assert.equal(host.lastToast().style, 'SUCCESS')
    await view.search(token({ sub: '另一个' }))
    assert.doesNotMatch(view.text(), /验签通过/)
    host.clipboard.text = ''
    await view.run(view.item('jwt-overview'), '使用剪贴板密钥校验 HS256 签名')
    await tick(20)
    assert.equal(host.lastToast().title, '缺少验签密钥')
  } finally { view.unmount() }
})

test('URL列表复制保留重复参数与特殊键，完整URL复制不改变请求参数', async () => {
  const host = createHost(), view = await mount(JwtUrlCodecCommand, host)
  try {
    await view.dropdown('url')
    await view.search('https://example.test/?a=1&a=2&__proto__=safe&lang=C%2B%2B')
    await view.run(view.item('url-overview'), '复制 Query 参数 JSON')
    assert.deepEqual(JSON.parse(host.clipboard.text), { a: ['1', '2'], ['__proto__']: 'safe', lang: 'C++' })
    await view.run(view.item('url-overview'), '复制完整 URL（保留编码）')
    assert.equal(new URL(host.clipboard.text).searchParams.get('lang'), 'C++')
  } finally { view.unmount() }
})
