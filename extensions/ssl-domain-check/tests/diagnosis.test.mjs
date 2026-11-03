import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import Command, { inspectDomainSslCert, evaluateSslCertInfo, resolveDomainDoh, normalizeDomainInput, certificateMarkdown } from '../dist/index.js'
const fingerprint = Array(32).fill('AB').join(':')
const leaf = { subjectCN: 'example.com', issuerName: 'Fixture CA', validFrom: '2020-01-01T00:00:00Z', validTo: '2099-01-01T00:00:00Z', serialNumber: '01', fingerprint256: fingerprint }
const certificate = domain => ({ ...leaf, domain, port: 443, protocol: 'TLSv1.3', subjectAltName: `DNS:${domain}`, authorized: true, authorizationError: '', hostnameMatches: true, chain: [leaf], chainTruncated: false })
const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/dns-json' } })
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
let host, views, requests, originalFetch
beforeEach(() => {
  host = createHost(); views = []; requests = []; originalFetch = globalThis.fetch
  host.ipc.tls_inspect = async p => p.action === 'cancel' ? { success: true, cancelled: true } : { success: true, cert: certificate(p.domain) }
  globalThis.fetch = async url => { const type = new URL(url).searchParams.get('type'); requests.push(type); return json({ Status: 0, Answer: type === 'TXT' ? [{ name: 'example.com.', type: 16, TTL: 0, data: '"verify=literal"' }] : [] }) }
})
afterEach(async () => { for (const view of views) view.unmount(); await tick(); globalThis.fetch = originalFetch })
async function open() { const v = await mount(Command, host); views.push(v); return v }
const calls = action => host.ipcCalls.filter(([m, p]) => m === 'tls_inspect' && p.action === action)
const run = v => v.run(v.item('ssl-probe-trigger'), '查询域名')
test('打开不联网；输入域名后主动作查询，筛选不重复联网并保留 TXT 引号', async () => {
  const v = await open(); assert.equal(requests.length, 0); assert.equal(calls('inspect').length, 0)
  assert.equal(v.item('ssl-probe-trigger').props.title, '输入域名后回车诊断')
  assert.equal(v.tree().props.filterBar.summaryText, '', '初始工具栏摘要留空，回车提示只在空状态条目出现一次')
  assert.equal((JSON.stringify(v.tree().props.searchBarPlaceholder) + v.tree().props.filterBar.summaryText + v.item('ssl-probe-trigger').props.title).match(/回车/g).length, 1)
  await run(v); assert.equal(host.lastToast().style, 'FAILURE'); assert.equal(calls('inspect').length, 0)
  await v.search('https://EXAMPLE.com/path'); assert.equal(v.item('ssl-probe-trigger').props.title, '诊断 https://EXAMPLE.com/path'); await run(v)
  assert.match(v.text(), /查询完成/); assert.match(v.text(), /验证通过/)
  assert.equal(calls('inspect')[0][1].domain, 'example.com'); assert.equal(calls('inspect')[0][1].port, 443)
  assert.equal(v.tree().props.isShowingDetail, true); assert.deepEqual(requests, ['A', 'AAAA', 'CNAME', 'MX', 'TXT'])
  await v.run(v.item('dns-TXT-0'), '复制记录值'); assert.equal(host.clipboard.text, '"verify=literal"')
  await v.dropdown('A'); assert.ok(!v.items().some(i => i.props.id.startsWith('dns-')))
  await v.dropdown('TXT'); assert.equal(requests.length, 5)
  await v.run(v.item('ssl-certificate'), '复制证书诊断'); assert.match(host.clipboard.text, /证书可信：true/)
  assert.ok(!host.ipcCalls.some(([method]) => method === 'dllplugin_call'))
})
test('切换域名立即清空证书和 DNS，取消旧操作，迟到结果不能覆盖新结果', async () => {
  const v = await open(); await v.search('example.com'); await run(v)
  const pending = defer(), normal = host.ipc.tls_inspect
  host.ipc.tls_inspect = p => p.action === 'inspect' && p.domain === 'old.example.com' ? pending.promise : normal(p)
  await v.search('old.example.com'); const older = run(v); await tick(); await run(v)
  assert.equal(calls('inspect').length, 2)
  await v.search('new.example.com'); assert.ok(!v.items().some(i => i.props.id === 'ssl-certificate')); assert.equal(v.tree().props.isLoading, false)
  await run(v); pending.resolve({ success: true, cert: certificate('old.example.com') }); await older
  assert.equal(v.item('ssl-certificate').props.title, 'new.example.com'); assert.equal(calls('cancel').length, 1)
  assert.equal(v.tree().props.isLoading, false)
})
test('手动取消和卸载均取消 TLS，在途结果不回写、不报成功', async () => {
  const pending = defer(); host.ipc.tls_inspect = p => p.action === 'inspect' ? pending.promise : { success: true, cancelled: true }
  const v = await open(); await v.search('example.com'); const work = run(v); await tick()
  v.tree().props.filterBar.actions[0].onAction(); await tick(); assert.match(v.text(), /查询已取消/)
  const second = run(v); await tick(); v.unmount(); pending.resolve({ success: true, cert: certificate('example.com') }); await Promise.all([work, second])
  assert.equal(calls('cancel').length, 2); assert.equal(host.toasts.length, 0)
})
test('TLS 或 DNS 单项失败明确区分，旧证书不能留存；两项失败不能报完成', async () => {
  const v = await open(); await v.search('example.com'); await run(v)
  host.ipc.tls_inspect = async () => { throw Error('证书握手失败') }; await run(v)
  assert.match(v.text(), /部分查询失败/); assert.match(v.item('tls-error').props.subtitle, /握手失败/)
  assert.ok(!v.items().some(i => i.props.id === 'ssl-certificate')); assert.ok(v.item('dns-TXT-0'))
  globalThis.fetch = async () => json({ Status: 2 }); await run(v); assert.match(v.tree().props.filterBar.summaryText, /查询失败/); assert.ok(v.item('dns-error'))
  host.ipc.tls_inspect = async p => ({ success: true, cert: certificate(p.domain) }); await run(v)
  assert.ok(v.item('ssl-certificate')); assert.match(v.text(), /部分查询失败/)
})
test('真实状态评价：不可信、名称不符、过期和未来证书不能标为健康', async () => {
  const clean = certificate('example.com'), now = Date.parse('2026-01-01T00:00:00Z')
  for (const cert of [
    { ...clean, authorized: false, authorizationError: 'SELF_SIGNED_CERT' },
    { ...clean, authorized: false, hostnameMatches: false, authorizationError: 'NAME_MISMATCH' },
    { ...clean, validTo: '2021-01-01T00:00:00Z' },
    { ...clean, validFrom: '2027-01-01T00:00:00Z' },
  ]) assert.equal(evaluateSslCertInfo(cert, now).isHealthy, false)
  host.ipc.tls_inspect = async () => ({ success: true, cert: { ...clean, authorized: false, authorizationError: 'SELF_SIGNED_CERT' } })
  const v = await open(); await v.search('example.com'); await run(v)
  assert.match(v.text(), /信任验证未通过/); assert.ok(!v.text().includes('"value":"验证通过"'))
  const markdown = certificateMarkdown(evaluateSslCertInfo({ ...clean, issuerName: '```\n![bad](https://example.invalid/leak)' }, now))
  assert.ok(markdown.startsWith('````text\n')); assert.ok(markdown.endsWith('\n````')); assert.ok(markdown.includes('![bad]'))
})
test('缺接口、失败回执、错目标以及缺失或畸形证书字段全部拒绝', async () => {
  const good = certificate('example.com')
  for (const change of [{ protocol: '' }, { validTo: 'invalid' }, { chain: [] }, { fingerprint256: '' }, { authorized: true, authorizationError: 'ERROR' }, { hostnameMatches: undefined }, { port: 0 }]) assert.throws(() => evaluateSslCertInfo({ ...good, ...change }))
  host.ipc.tls_inspect = async () => ({ success: true, cert: certificate('different.example.com') }); await assert.rejects(inspectDomainSslCert('example.com'), /其他目标/)
  host.ipc.tls_inspect = async () => ({ success: false }); await assert.rejects(inspectDomainSslCert('example.com'), /未确认/)
  globalThis.__ztoolsElectron = {}; await assert.rejects(inspectDomainSslCert('example.com'), /升级客户端/)
  const abort = new AbortController(); abort.abort(); await assert.rejects(inspectDomainSslCert('example.com', { signal: abort.signal }))
  for (const domain of ['', 'bad host', 'https://u:p@example.com', 'file:///tmp/a', '-bad.example.com', 'https://example.com:8443']) assert.throws(() => normalizeDomainInput(domain))
  assert.equal(normalizeDomainInput('https://例子.测试/'), 'xn--fsqu00a.xn--0zwm56d')
})
test('DNS 真空结果与 NXDOMAIN、服务错误、畸形字段及过大内容区别处理', async () => {
  assert.deepEqual(await resolveDomainDoh('example.com', ['A'], { fetchImpl: async () => json({ Status: 0 }) }), [])
  for (const payload of [{ Status: 3 }, { Status: 2 }, {}, { Status: 0, Answer: {} }, { Status: 0, Answer: [{ name: 'example.com', type: 1, TTL: -1, data: '127.0.0.1' }] }]) await assert.rejects(resolveDomainDoh('example.com', ['A'], { fetchImpl: async () => json(payload) }))
  await assert.rejects(resolveDomainDoh('example.com', ['toString']), /参数无效/)
  for (const Answer of [undefined, [{ name: 'example.com.', type: 1, TTL: 60, data: '127.0.0.1' }]]) await assert.rejects(resolveDomainDoh('example.com', ['A'], { fetchImpl: async () => json({ Status: 0, TC: true, Answer }) }), /截断/)
  await assert.rejects(resolveDomainDoh('example.com', ['A'], { fetchImpl: async () => new Response('x'.repeat(262145)) }), /大小限制/)
  await assert.rejects(resolveDomainDoh('example.com', ['A'], { fetchImpl: async () => new Response('no', { status: 500 }) }), /HTTP 500/)
})
test('DNS 超时与取消会中止网络请求', async () => {
  const abortable = async (_url, { signal }) => new Promise((_, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }) })
  await assert.rejects(resolveDomainDoh('example.com', ['A'], { fetchImpl: abortable, timeoutMs: 1000 }), /超时/)
  const controller = new AbortController(), pending = resolveDomainDoh('example.com', ['A'], { fetchImpl: abortable, signal: controller.signal })
  controller.abort(); await assert.rejects(pending, /取消/)
})
test('失败行回车即重新查询，可复制失败原因；重试成功后失败行消失', async () => {
  host.ipc.tls_inspect = async p => { if (p.action === 'cancel') return { success: true }; throw new Error('TLS 连接失败：ECONNREFUSED') }
  const v = await open(); await v.search('example.com'); await run(v)
  assert.equal(v.actions(v.item('tls-error'))[0].props.title, '重新查询')
  await v.run(v.item('tls-error'), '复制失败原因'); assert.match(host.clipboard.text, /ECONNREFUSED/)
  host.ipc.tls_inspect = async p => p.action === 'cancel' ? { success: true } : { success: true, cert: certificate(p.domain) }
  await v.run(v.item('tls-error'), '重新查询'); await tick()
  assert.ok(v.item('ssl-certificate')); assert.ok(!v.items().some(i => i.props.id === 'tls-error'))
})

test('查询完成后改输入：清掉旧结果与摘要，不回填重复的回车提示', async () => {
  const v = await open(); await v.search('example.com'); await run(v); assert.match(v.tree().props.filterBar.summaryText, /查询完成/)
  await v.search('example.org'); assert.equal(v.tree().props.filterBar.summaryText, ''); assert.deepEqual(v.items().map(i => i.props.id), ['ssl-probe-trigger'])
  assert.equal(v.item('ssl-probe-trigger').props.title, '诊断 example.org')
})
