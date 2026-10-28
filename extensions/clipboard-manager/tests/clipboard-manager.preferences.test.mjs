import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost } from '../../shared/test-harness.mjs'
import { getClipboardPreferences, saveClipboardPreferences } from '../dist/clipboard-storage.js'

const host = createHost()
const key = 'ztools:clipboard:preferences'
const defaults = {
  historyDuration: 'P1W',
  preferPastingAsPlainText: false, updateHistoryAfterAction: true
}
test.beforeEach(() => host.reset())

test('偏好设置保存后能重新读取，兼容已存的 JSON 字符串与对象', async () => {
  const prefs = { historyDuration: 'never', preferPastingAsPlainText: true, updateHistoryAfterAction: false }
  await saveClipboardPreferences(prefs)
  assert.deepEqual(await getClipboardPreferences(), prefs)
  host.storage.set(key, JSON.stringify(prefs))
  assert.deepEqual(await getClipboardPreferences(), prefs)
})

test('缺失、损坏或类型错误的设置不会令剪贴板页面崩溃', async () => {
  assert.deepEqual(await getClipboardPreferences(), defaults)
  for (const value of ['{broken', 'null', '[]', '123', [], { historyDuration: 'invalid', preferPastingAsPlainText: 'yes' }]) {
    host.storage.set(key, JSON.stringify(value))
    assert.deepEqual(await getClipboardPreferences(), defaults)
  }
  host.faults.storageRead = new Error('存储读取失败')
  assert.deepEqual(await getClipboardPreferences(), defaults)
})

test('保存失败向调用方报错，不把未保存的设置当作成功', async () => {
  host.faults.storageWrite = new Error('磁盘空间不足')
  await assert.rejects(saveClipboardPreferences(defaults), /磁盘空间不足/)
  assert.equal(host.storage.has(key), false)
})

test('偏好里不再有没有生效的 primaryAction（旧数据里的该字段被忽略）', async () => {
  host.storage.set(key, JSON.stringify({ historyDuration: 'P1D', primaryAction: 'copy' }))
  const prefs = await getClipboardPreferences()
  assert.equal('primaryAction' in prefs, false)
  assert.equal(prefs.historyDuration, 'P1D')
})
