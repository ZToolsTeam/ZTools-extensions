import assert from 'node:assert/strict'
import { test } from 'node:test'

const plugins = ['batch-rename', 'calendar', 'disk-analyzer', 'downloads-manager', 'hardware-info', 'process-monitor', 'quick-folders', 'screenshot']

for (const id of plugins) {
  test(`${id} 的实际构建产物遵守宿主参数与失败契约`, async () => {
    const api = await import(`../../${id}/dist/native-ipc.js`)
    const calls = [], sha256 = 'a'.repeat(64)
    const host = {
      clipboard_copy_text: async params => { calls.push(['copy', params]); return { success: true } },
      filesearch_sha256: async params => { calls.push(['hash', params]); return { success: true, sha256 } },
      dllplugin_call: async params => { calls.push(['dll', params]); return { success: false, error: { code: 'NOT_SUPPORTED', message: '测试宿主不提供此能力' } } }
    }
    assert.equal(await api.writeRealClipboardText('隔离测试文本', host), true)
    assert.deepEqual(calls.shift(), ['copy', { text: '隔离测试文本' }])
    assert.equal(await api.computeRealFileSha256('/isolated/fixture.txt', host), sha256)
    assert.deepEqual(calls.shift(), ['hash', { fullPath: '/isolated/fixture.txt' }])
    const refused = await api.invokeDllPluginCapability('TestFixture', 'inspect', { value: 1 }, host)
    assert.equal(refused.ok, false)
    assert.deepEqual(calls.shift(), ['dll', { plugin: 'TestFixture', func: 'inspect', params: { value: 1 } }])
    const unavailable = await api.invokeDllPluginCapability('TestFixture', 'inspect')
    assert.equal(unavailable.ok, false)
    assert.equal(unavailable.data, null)
  })
}
