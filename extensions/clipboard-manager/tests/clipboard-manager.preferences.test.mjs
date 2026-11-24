import test from 'node:test'
import assert from 'node:assert/strict'
import { setRuntimeLocale } from '@ztools/declarative-ui'
import { createHost } from '../../shared/test-harness.mjs'
import { getClipboardPreferences, getNotInClientMessage, saveClipboardPreferences, syncCurrentSystemClipboard } from '../dist/clipboard-storage.js'

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

test('i18n 热切换：未在客户端提示、剪贴板读取失败与偏好读取告警随语言即时更新', async () => {
  const prevWarn = console.warn
  const warns = []
  console.warn = (...args) => warns.push(args.map(String).join(' '))
  try {
    setRuntimeLocale('zh-CN')
    const zhMsg = getNotInClientMessage()
    assert.match(zhMsg, /[\u4e00-\u9fa5]/)
    host.faults.storageRead = new Error('boom')
    await getClipboardPreferences()
    const zhWarn = warns.at(-1) || ''
    assert.match(zhWarn, /[\u4e00-\u9fa5]/)
    await assert.rejects(
      syncCurrentSystemClipboard([], { clipboard_read_text: async () => ({ ok: false, success: false, error: '' }) }),
      /IPC 调用返回失败|读取系统剪贴板失败/
    )

    setRuntimeLocale('en-US')
    const enMsg = getNotInClientMessage()
    assert.notEqual(enMsg, zhMsg)
    assert.doesNotMatch(enMsg, /[\u4e00-\u9fa5]/)
    await getClipboardPreferences()
    const enWarn = warns.at(-1) || ''
    assert.notEqual(enWarn, zhWarn)
    assert.doesNotMatch(enWarn, /[\u4e00-\u9fa5]/)
    await assert.rejects(
      syncCurrentSystemClipboard([], { clipboard_read_text: async () => ({ ok: false, success: false, error: '' }) }),
      /IPC call failed|Failed to read system clipboard/
    )
  } finally {
    console.warn = prevWarn
    setRuntimeLocale('zh-CN')
  }
})
