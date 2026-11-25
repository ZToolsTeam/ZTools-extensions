import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { Clipboard } from '@ztools/declarative-ui'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import { JwtUrlCodecCommand, parseAndInspectUrl, rebuildUrlWithQueryParams, decodeJwtToken, signJwtHmacSha256, verifyJwtHmacSha256, verifyJwtHmac, decodeBase64UrlToUtf8, encodeUtf8ToBase64Url, fencedBlock } from '../dist/index.js'

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

test('[边界] 空输入显示中性提示而非红色解析错误，且可从剪贴板读取', async () => {
  const host = createHost(), view = await mount(JwtUrlCodecCommand, host)
  try {
    await view.search('')
    assert.equal(view.item('empty').props.title, '在上方粘贴 JWT Token')
    assert.equal(view.tree().props.isShowingDetail, false)
    assert.doesNotMatch(view.text(), /解析失败|EMPTY_JWT_TOKEN/)
    await view.dropdown('url')
    assert.equal(view.item('empty').props.title, '在上方粘贴 URL 或 Query 字符串')
    host.clipboard.text = token()
    await view.run(view.item('empty'), '从剪贴板读取')
    await tick(20)
    assert.ok(view.item('jwt-overview'))
  } finally { view.unmount() }
})

test('[异常] 解析错误只向用户显示中文原因，不暴露机器错误码', async () => {
  const host = createHost(), view = await mount(JwtUrlCodecCommand, host)
  try {
    await view.search('a.b')
    const subtitle = view.item('jwt-error').props.subtitle
    assert.match(subtitle, /^标准 JWT 必须包含 3 段/)
    assert.doesNotMatch(view.text(), /INVALID_JWT_STRUCTURE/)
  } finally { view.unmount() }
})

test('[边界] 毫秒时间戳的 exp 判为时间声明异常，不误报尚未过期', () => {
  const ms = Date.UTC(2020, 0, 1)
  const result = decodeJwtToken(token({ exp: ms }), Date.UTC(2026, 0, 1))
  assert.equal(result.timeStatus, '时间声明异常')
  assert.match(result.expiryCountdownText, /exp.*毫秒/)
  const ok = decodeJwtToken(token({ exp: ms / 1000 }), Date.UTC(2026, 0, 1))
  assert.equal(ok.timeStatus, '已过期')
})

test('verifyJwtHmac 支持 HS256 / HS384 / HS512 验签，拒绝非 HMAC 算法与 crit/b64 扩展', async () => {
  const makeHmacToken = (alg, hashName, payload = { sub: 'u1' }) => {
    const data = [{ alg, typ: 'JWT' }, payload]
      .map((v) => Buffer.from(JSON.stringify(v)).toString('base64url'))
      .join('.')
    return `${data}.${createHmac(hashName, secret).update(data).digest('base64url')}`
  }

  for (const [alg, hashName] of [['HS256', 'sha256'], ['HS384', 'sha384'], ['HS512', 'sha512']]) {
    const t = makeHmacToken(alg, hashName)
    const pass = await verifyJwtHmac(t, secret)
    assert.equal(pass.verified, true, `${alg} 正确密钥应验签通过`)
    assert.equal(pass.algorithm, alg)
    const fail = await verifyJwtHmac(t, 'wrong-secret')
    assert.equal(fail.verified, false, `${alg} 错误密钥应验签失败`)
  }
  assert.equal((await verifyJwtHmac(token({}, { alg: 'RS256' }), secret)).verified, false)
  assert.equal((await verifyJwtHmac(token({}, { alg: 'HS512', crit: ['x'] }), secret)).verified, false)
})

test('JWT 输入 Secret 验签二级表单：支持 HS512 验签、更新状态且不落盘', async () => {
  const host = createHost()
  const view = await mount(JwtUrlCodecCommand, host)
  try {
    const data = [{ alg: 'HS512', typ: 'JWT' }, { sub: 'admin' }]
      .map((v) => Buffer.from(JSON.stringify(v)).toString('base64url'))
      .join('.')
    const hs512Token = `${data}.${createHmac('sha512', secret).update(data).digest('base64url')}`
    await view.search(hs512Token)
    await view.run(view.item('jwt-overview'), '输入 Secret 验签 (HS256/384/512)')
    await tick()
    const form = await mountPushed(host)
    try {
      assert.equal(form.field('secret').type, 'Form.PasswordField')
      await form.fill('secret', 'bad-secret')
      await form.run(null, '立即验签')
      await tick(20)
      assert.equal(host.lastToast().style, 'FAILURE')
      assert.equal(host.pushed.length, 1, '失败时保留表单供修改重试')

      await form.fill('secret', secret)
      await form.run(null, '立即验签')
      await tick(20)
      assert.equal(host.lastToast().style, 'SUCCESS')
      assert.equal(host.pushed.length, 0, '通过后自动返回主页面')
      assert.equal(host.storage.size, 0)
      assert.match(view.text(), /验签通过 \(HS512\)/)
    } finally {
      form.unmount()
    }
  } finally {
    view.unmount()
  }
})

test('URL 模式支持新增、编辑、删除 Query 参数并实时重组复制完整 URL', async () => {
  const inspected = parseAndInspectUrl('https://example.test/api?a=1&b=2#sec')
  assert.equal(
    rebuildUrlWithQueryParams(inspected, [{ key: 'a', value: '10' }, { key: 'c', value: 'x y' }]),
    'https://example.test/api?a=10&c=x+y#sec'
  )

  const host = createHost()
  const view = await mount(JwtUrlCodecCommand, host)
  try {
    await view.dropdown('url')
    await view.search('https://example.test/search?q=old&page=1#top')

    // 1. 编辑参数 q -> new value
    await view.run(view.item('param-q-0'), '编辑此参数')
    await tick()
    const editForm = await mountPushed(host)
    try {
      await editForm.fill('value', 'ztools')
      await editForm.run(null, '保存并重组复制 URL')
      await tick(10)
      assert.equal(host.clipboard.text, 'https://example.test/search?q=ztools&page=1#top')
      assert.equal(view.tree().props.searchText, 'https://example.test/search?q=ztools&page=1#top')
    } finally {
      editForm.unmount()
    }

    // 2. 新增参数 lang=zh
    await view.run(view.item('url-overview'), '新增 Query 参数')
    await tick()
    const addForm = await mountPushed(host)
    try {
      await addForm.fill('key', 'lang')
      await addForm.fill('value', 'zh')
      await addForm.run(null, '保存并重组复制 URL')
      await tick(10)
      assert.equal(host.clipboard.text, 'https://example.test/search?q=ztools&page=1&lang=zh#top')
    } finally {
      addForm.unmount()
    }

    // 3. 删除参数 page
    await view.run(view.item('param-page-1'), '删除此参数')
    await tick(10)
    assert.equal(host.clipboard.text, 'https://example.test/search?q=ztools&lang=zh#top')
    assert.equal(view.tree().props.searchText, 'https://example.test/search?q=ztools&lang=zh#top')
  } finally {
    view.unmount()
  }
})
