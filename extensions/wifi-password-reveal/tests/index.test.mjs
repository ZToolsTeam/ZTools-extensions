import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import Command from '../dist/index.js'
import { fetchSavedWifiProfiles, generateWifiQrString, generateWifiQrSvgDataUrl, parseNetshWlanProfiles, parseWindowsWlanProfileDetail } from '../dist/wifi-service.js'

const host = createHost()
const views = []
const track = view => { views.push(view); return view }
const open = async () => track(await mount(Command))
const child = async () => track(await mountPushed(host))
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const saved = [{ ssid: ' test network ', current: true, security: 'WPA2-Personal' }]
test.beforeEach(() => { host.reset(); host.ipc.wifi_get_profiles = async () => saved; host.ipc.wifi_get_password = async () => ({ password: ' synthetic password ' }) })
test.afterEach(() => { for (const view of views.splice(0)) view.unmount() })

const passwordCalls = () => host.ipcCalls.filter(([method]) => method === 'wifi_get_password').length

test('打开与刷新只列网络，不预读密码，不伪造信号与加密类型', async () => {
  host.ipc.wifi_get_profiles = async () => [{ ssid: ' 含空格网络 ', current: true }]
  const view = await open()
  assert.equal(view.items()[0].props.title, ' 含空格网络 ')
  assert.ok(view.text().includes('当前连接'))
  assert.doesNotMatch(view.text(), /WPA2|Dual-Band|85%|98%|synthetic/)
  await view.tree().props.filterBar.actions[0].onAction()
  assert.equal(passwordCalls(), 0)
  const profiles = await fetchSavedWifiProfiles()
  assert.equal(profiles[0].authType, 'Unknown')
  assert.equal(profiles[0].signalPercent, undefined)
})

test('Enter 主动作真实读取、保留密码与 SSID 首尾空格，成功后才提示', async () => {
  const view = await open()
  assert.equal(view.actions(view.items()[0])[0].props.title, '复制 Wi-Fi 密码')
  await view.run(view.items()[0], '复制 Wi-Fi 密码')
  assert.equal(host.clipboard.text, ' synthetic password ')
  assert.deepEqual(host.ipcCalls.find(([method]) => method === 'wifi_get_password')[1], { ssid: ' test network ' })
  assert.match(host.lastToast().title, /已复制/)
  assert.equal(passwordCalls(), 1)
})

for (const [label, failure] of [['拒绝授权', () => { throw new Error('用户取消授权') }], ['超时', () => { throw new Error('REQUEST_TIMEOUT') }], ['空密码', () => ({ password: '' })], ['内层错误', () => ({ error: '无权限' })]]) {
  test(`密码${label}：不复制，不报成功，不生成二维码`, async () => {
    host.ipc.wifi_get_password = failure
    const view = await open()
    await view.run(view.items()[0], '复制 Wi-Fi 密码')
    assert.equal(host.clipboard.text, '')
    assert.equal(host.pushed.length, 0)
    assert.match(host.lastToast().title, /失败/)
    assert.equal(view.tree().props.isLoading, false)
  })
}

test('列表读取失败显示错误；重试成功后恢复真实空列表', async () => {
  host.ipc.wifi_get_profiles = () => { throw new Error('无线接口不可用') }
  const view = await open()
  assert.equal(view.items()[0].props.id, 'load-error')
  assert.ok(view.text().includes('无线接口不可用'))
  assert.equal(host.toasts.some(t => t.title.includes('已读取')), false)
  host.ipc.wifi_get_profiles = async () => []
  await view.tree().props.filterBar.actions[0].onAction()
  await tick()
  assert.equal(view.items()[0].props.id, 'empty')
  assert.equal(passwordCalls(), 0)
})

test('宿主返回无效列表时拒绝冒充空列表', async () => {
  host.ipc.wifi_get_profiles = async () => ({ error: 'invalid' })
  const view = await open()
  assert.equal(view.items()[0].props.id, 'load-error')
})

test('连续按 Enter 仅发起一次密码读取', async () => {
  const pending = deferred()
  host.ipc.wifi_get_password = () => pending.promise
  const view = await open()
  const action = view.actions(view.items()[0])[0].props.onAction
  const first = action(); const second = action()
  assert.equal(passwordCalls(), 1)
  pending.resolve({ password: 'test1234' })
  await Promise.all([first, second])
  assert.equal(host.toasts.filter(t => t.title.includes('已复制')).length, 1)
})

for (const operation of ['刷新', '退出']) {
  test(`密码等待期间${operation}：迟到结果不会复制或打开详情`, async () => {
    const pending = deferred()
    host.ipc.wifi_get_password = () => pending.promise
    const view = await open()
    const request = view.actions(view.items()[0])[0].props.onAction()
    if (operation === '刷新') await view.tree().props.filterBar.actions[0].onAction()
    else view.unmount()
    pending.resolve({ password: 'late-secret' })
    await request
    assert.equal(host.clipboard.text, '')
    assert.equal(host.pushed.length, 0)
    assert.equal(host.toasts.some(t => t.title.includes('已复制')), false)
  })
}

test('多次刷新只采用最新列表，旧请求的失败也不能覆盖成功', async () => {
  const pending = deferred()
  host.ipc.wifi_get_profiles = () => pending.promise
  const view = await open()
  host.ipc.wifi_get_profiles = async () => [{ ssid: 'new' }]
  await view.tree().props.filterBar.actions[0].onAction()
  pending.resolve([{ ssid: 'old' }]); await tick()
  assert.equal(view.items()[0].props.title, 'new')
})

test('未知加密类型必须明确选择；开放网络生成二维码无需读取密码', async () => {
  host.ipc.wifi_get_profiles = async () => [{ ssid: 'guest' }]
  const view = await open()
  await view.run(view.items()[0], '生成连网二维码')
  const form = await child()
  assert.equal(form.field('security').props.value, '')
  await form.run(null, '生成连网二维码')
  assert.equal(host.pushed.length, 1)
  await form.fill('security', 'Open')
  await form.run(null, '生成连网二维码')
  assert.equal(passwordCalls(), 0)
  const detail = await child()
  assert.ok(detail.text().includes('WIFI:T:nopass;S:guest;;'))
})

test('选择加密类型后读取密码生成二维码；读取期间改变类型使旧结果失效', async () => {
  host.ipc.wifi_get_profiles = async () => [{ ssid: 'wifi' }]
  const view = await open()
  await view.run(view.items()[0], '生成连网二维码')
  const form = await child()
  await form.fill('security', 'WPA2-Personal')
  const pending = deferred(); host.ipc.wifi_get_password = () => pending.promise
  const request = form.actions(null)[0].props.onSubmit({})
  await form.fill('security', 'Open')
  pending.resolve({ password: 'stale-password' }); await request
  assert.equal(host.pushed.length, 1)
  await form.run(null, '生成连网二维码')
  const detail = await child()
  assert.ok(detail.text().includes('WIFI:T:nopass;S:wifi;;'))
  assert.ok(!detail.text().includes('stale-password'))
})

test('已知网络详情正常展示与复制 QR；企业认证不读密码或生成 QR', async () => {
  const view = await open()
  assert.equal(view.actions(view.items()[0]).filter(a => a.props.title === '生成连网二维码').length, 0)
  await view.run(view.items()[0], '查看密码与二维码')
  const detail = await child()
  assert.ok(detail.text().includes('data:image/svg+xml'))
  await detail.run(null, '复制连网协议串')
  assert.equal(host.clipboard.text, 'WIFI:T:WPA;S: test network ;P: synthetic password ;;')
  host.ipc.wifi_get_profiles = async () => [{ ssid: 'corp', security: 'WPA2-Enterprise' }]
  const enterprise = await open()
  await enterprise.run(enterprise.items()[0], '查看密码与二维码')
  assert.equal(passwordCalls(), 1)
  const enterpriseDetail = await child()
  assert.ok(!enterpriseDetail.text().includes('data:image/svg+xml'))
})

test('密码与 SSID Markdown 代码围栏不能注入图片或链接', async () => {
  host.ipc.wifi_get_password = async () => ({ password: '```\n![x](https://invalid.test)\n```' })
  const view = await open(); await view.run(view.items()[0], '查看密码与二维码')
  const detail = await child()
  assert.ok(detail.tree().props.markdown.includes('````text\n```\n![x]'))
})

test('netsh 解析保留网络及密码空格，不将未知认证伪装成企业网络', () => {
  assert.deepEqual(parseNetshWlanProfiles('    All User Profile :  wifi  \r\n    所有用户配置文件 : 中文\r\n'), [' wifi  ', '中文'])
  const detail = parseWindowsWlanProfileDetail(' wifi ', '    Authentication : WPA2-Personal\r\n    Key Content :  pass  \r\n')
  assert.equal(detail.ssid, ' wifi '); assert.equal(detail.password, ' pass  ')
  assert.equal(detail.cipher, 'Unknown')
})

test('二维码协议拒绝未知认证、企业认证、缺少密码；保留空格和转义字符', () => {
  for (const auth of ['Unknown', 'WPA2-Enterprise']) assert.throws(() => generateWifiQrString('net', 'password', auth))
  assert.throws(() => generateWifiQrString('net', '', 'WPA2-Personal'))
  assert.equal(generateWifiQrString(' net; ', ' p:"\\ ', 'WPA2-Personal'), String.raw`WIFI:T:WPA;S: net\; ;P: p\:\"\\ ;;`)
})

test('[macOS] 系统独立解码实际 SVG：长中文网络名、63 字符密码和特殊字符', { skip: process.platform !== 'darwin' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wifi-qr-test-'))
  try {
    const source = `import AppKit\nimport CoreImage\nlet detector = CIDetector(ofType: CIDetectorTypeQRCode, context: nil, options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])!\nfor file in CommandLine.arguments.dropFirst() {\n let image = NSImage(contentsOfFile: file)!\n let input = CIImage(data: image.tiffRepresentation!)!\n let decoded = detector.features(in: input).compactMap { ($0 as? CIQRCodeFeature)?.messageString }.first ?? "NONE"\n print(decoded.data(using: .utf8)!.base64EncodedString())\n}\n`
    const swiftFile = path.join(dir, 'decode.swift'); fs.writeFileSync(swiftFile, source)
    const binary = path.join(dir, 'decode'); execFileSync('swiftc', ['-O', swiftFile, '-o', binary])
    const profiles = [
      { ssid: '家庭无线网络测试 ;"', password: 'p'.repeat(63), authType: 'WPA2-Personal' },
      { ssid: ' a;\\:" ', password: ' p;\\:" ', authType: 'WEP' },
      { ssid: 'guest', password: '', authType: 'Open' }
    ]
    const files = profiles.map((profile, index) => {
      const file = path.join(dir, `${index}.svg`)
      fs.writeFileSync(file, decodeURIComponent(generateWifiQrSvgDataUrl(profile).split(',').slice(1).join(',')))
      return file
    })
    const actual = execFileSync(binary, files).toString().trim().split('\n').map(value => Buffer.from(value, 'base64').toString())
    assert.deepEqual(actual, profiles.map(profile => generateWifiQrString(profile.ssid, profile.password, profile.authType)))
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('[Windows 宿主数据] 只显示宿主真实给出的认证方式；WPA 不冒充 WPA2，企业网不读密码，不走旧 dllplugin_call', async () => {
  host.ipc.dllplugin_call = async () => ({ ok: true, success: true, profiles: [{ ssid: '旧接口网络', password: 'leak' }] })
  host.ipc.wifi_get_profiles = async () => ({ profiles: [
    { ssid: 'home', current: true, security: 'WPA2-Personal' },
    { ssid: 'legacy', current: false, security: 'WPA-Personal' },
    { ssid: 'corp', current: false, security: 'WPA-Enterprise' },
    { ssid: 'unknown-net' }
  ] })
  const view = await open()
  const titles = view.items().map(item => item.props.title)
  assert.deepEqual(titles.sort(), ['corp', 'home', 'legacy', 'unknown-net'])
  const accessories = Object.fromEntries(view.items().map(item => [item.props.title, item.props.accessories.map(a => a.text)]))
  assert.deepEqual(accessories.home, ['当前连接', 'WPA2-Personal'])
  assert.deepEqual(accessories.legacy, ['WPA-Personal'])
  assert.deepEqual(accessories.corp, ['WPA-Enterprise'])
  assert.deepEqual(accessories['unknown-net'], [])
  const corp = view.items().find(item => item.props.title === 'corp')
  assert.ok(!view.actions(corp).some(action => action.props.title === '复制 Wi-Fi 密码'))
  assert.equal(passwordCalls(), 0)
  assert.ok(!host.ipcCalls.some(([method]) => method === 'dllplugin_call'))
  assert.doesNotMatch(view.text(), /leak|旧接口网络/)
})

test('不在客户端里运行：如实提示需要客户端，不返回示例网络或假密码，也不冒充空列表', async () => {
  const saved = globalThis.__ztoolsElectron
  delete globalThis.__ztoolsElectron
  try {
    await assert.rejects(fetchSavedWifiProfiles(), /需要在 ZTools 客户端中使用/)
    const view = await open()
    await tick(10)
    const items = view.items()
    assert.equal(items.length, 1)
    assert.equal(items[0].props.id, 'load-error')
    assert.equal(items[0].props.title, '需要在 ZTools 客户端中使用')
    assert.doesNotMatch(view.text(), /没有已保存的无线网络|ZTools-Office|Xiaomi|Guest123456/)
  } finally {
    globalThis.__ztoolsElectron = saved
  }
})

test('插件不再导出示例网络', async () => {
  const mod = await import('../dist/wifi-service.js')
  assert.equal(mod.SAMPLE_WIFI_PROFILES, undefined)
})

test('plugin.json 只声明实际用到的权限：读取密码需要 system，复制需要 clipboard，不联网也不执行命令', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../plugin.json', import.meta.url), 'utf8'))
  assert.deepEqual([...manifest.permissions].sort(), ['clipboard', 'system'])
})
