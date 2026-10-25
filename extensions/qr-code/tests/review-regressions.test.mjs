import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mountPushed } from '../../shared/test-harness.mjs'
import { WifiQrForm, buildWifiPayload } from '../dist/index.js'
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
