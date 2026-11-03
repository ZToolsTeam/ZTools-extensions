import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import QrCodeCommand, { commands, WifiQrForm, buildWifiPayload, generateQrPngBase64 } from '../dist/index.js'
const host = createHost()
test('Wi-Fi 表单保留名称所有字节，特殊字符仅由编码器转义；空名称仍不保存', async () => {
  for (const ssid of [' Cafe ', ' ', '中文;: \\ 网络', '']) {
    host.reset()
    let saved
    host.pushed.push(() => WifiQrForm({ onCreated: async item => { saved = item; return true } }))
    const form = await mountPushed(host)
    try {
      await form.fill('ssid', ssid); await form.fill('password', 'test-only'); await form.run(null, '生成并保存')
      if (ssid) assert.equal(saved.content, buildWifiPayload(ssid, 'test-only', 'WPA'))
      else { assert.equal(saved, undefined); assert.match(form.field('ssid').props.error, /不能为空/) }
    } finally { form.unmount() }
  }
})

test('从旧文本新建Wi-Fi后显示并复制新图；保存失败时保持原内容和表单', async () => {
  for (const failure of [false, true]) {
    host.reset()
    let copied
    host.ipc.clipboard_copy_image = async params => { copied = params.image; return { success: true } }
    const view = await mount(QrCodeCommand)
    await view.search('旧文本不能被误复制')
    await view.run(view.item('live'), '生成 Wi-Fi 二维码…')
    const form = await mountPushed(host)
    try {
      await form.fill('ssid', 'MAC-AUDIT;测试')
      await form.fill('password', 'test-only:12345678')
      if (failure) host.faults.storageWrite = new Error('磁盘不可写')
      await form.run(null, '生成并保存')
      await tick()
      if (failure) {
        assert.equal(view.tree().props.searchText, '旧文本不能被误复制')
        assert.equal(host.pushed.length, 1)
        assert.match(String(host.lastToast().title), /保存失败/)
        assert.equal(host.storage.has('ztools_qr_history'), false)
      } else {
        const expected = buildWifiPayload('MAC-AUDIT;测试', 'test-only:12345678', 'WPA')
        assert.equal(view.tree().props.searchText, expected)
        assert.equal(host.pushed.length, 0)
        await view.run(view.item('live'), '复制二维码图片')
        assert.equal(copied, `data:image/png;base64,${generateQrPngBase64(expected, 'M')}`)
      }
    } finally { form.unmount(); view.unmount() }
  }
})

test('Wi-Fi快捷入口只打开一次表单，文字入口保持普通页面', async () => {
  host.reset()
  const wifi = await mount(commands['qr-wifi'])
  try {
    assert.equal(host.pushed.length, 1)
    wifi.tree()
    await tick()
    assert.equal(host.pushed.length, 1)
    const form = await mountPushed(host)
    try { assert.equal(form.field('ssid').props.title, 'Wi-Fi 名称') }
    finally { form.unmount() }
  } finally { wifi.unmount() }
  host.reset()
  const text = await mount(commands['qr-text'])
  try { assert.equal(host.pushed.length, 0); assert.ok(text.item('hint')) }
  finally { text.unmount() }
})

test('[边界] Wi-Fi 密码长度不合规：错误显示在密码框下，不保存', async () => {
  host.reset()
  let saved
  host.pushed.push(() => WifiQrForm({ onCreated: async item => { saved = item; return true } }))
  const form = await mountPushed(host)
  try {
    await form.fill('ssid', 'Home'); await form.fill('password', 'short'); await form.run(null, '生成并保存')
    assert.equal(saved, undefined)
    assert.match(form.field('password').props.error, /8–63/)
    assert.equal(form.field('ssid').props.error, undefined)
    await form.fill('password', 'long-enough'); await form.run(null, '生成并保存')
    assert.equal(saved.content, buildWifiPayload('Home', 'long-enough', 'WPA'))
  } finally { form.unmount() }
})

test('首屏无历史时不显示空白详情栏，引导副标题与回车主动作一致；输入后才显示预览', async () => {
  host.reset()
  host.clipboard.text = 'https://example.com/from-clipboard'
  const view = await mount(commands['qr-text'])
  try {
    assert.equal(view.tree().props.isShowingDetail, false)
    const hint = view.item('hint')
    assert.equal(hint.props.detail, undefined)
    assert.match(hint.props.subtitle, /剪贴板/)
    assert.equal(view.actions(hint)[0].props.title, '用剪贴板内容生成')
    await view.run(hint, '用剪贴板内容生成')
    assert.equal(view.tree().props.isShowingDetail, true)
    assert.ok(view.item('live').props.detail)
  } finally { view.unmount() }
})

test('Wi-Fi 表单的隐藏网络复选框有标题，且不再提供与 Esc 重复的返回动作', async () => {
  host.reset()
  host.pushed.push(() => WifiQrForm({ onCreated: async () => true }))
  const form = await mountPushed(host)
  try {
    assert.equal(form.field('hidden').props.title, '隐藏网络')
    assert.deepEqual(form.actions(null).map(a => a.props.title), ['生成并保存'])
  } finally { form.unmount() }
})
