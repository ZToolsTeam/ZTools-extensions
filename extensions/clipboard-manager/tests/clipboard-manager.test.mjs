import test from 'node:test'
import assert from 'node:assert/strict'
import {
  detectContentType,
  addClipboardEntry,
  togglePinEntry,
  deleteEntry,
  clearUnpinnedEntries,
  getSampleClipboardEntries
} from '../dist/logic.js'

test('ClipboardManager 内容类型智能探测测试', () => {
  assert.equal(detectContentType('https://ztools.cn'), 'url')
  assert.equal(detectContentType('http://localhost:3000/api'), 'url')
  assert.equal(detectContentType('{"key": "value"}'), 'json')
  assert.equal(detectContentType('[1, 2, 3]'), 'json')
  assert.equal(detectContentType('function test() { return 1 }'), 'code')
  assert.equal(detectContentType('const a = 123;'), 'code')
  assert.equal(detectContentType('这是一段普通中文说明'), 'text')
})

test('ClipboardManager 记录维护与去重提升测试', () => {
  let entries = []

  // 1. 添加条目
  entries = addClipboardEntry(entries, 'First item')
  assert.equal(entries.length, 1)
  assert.equal(entries[0].text, 'First item')

  // 2. 添加第二条
  entries = addClipboardEntry(entries, 'Second item')
  assert.equal(entries.length, 2)
  assert.equal(entries[0].text, 'Second item')

  // 3. 重复添加第一条 -> 去重并提升至顶部
  entries = addClipboardEntry(entries, 'First item')
  assert.equal(entries.length, 2)
  assert.equal(entries[0].text, 'First item')
})

test('ClipboardManager 置顶与批量清理测试', () => {
  let entries = getSampleClipboardEntries()
  const initialCount = entries.length

  // 置顶第一条
  const unpinnedItem = entries.find(e => !e.pinned)
  assert.ok(unpinnedItem)
  entries = togglePinEntry(entries, unpinnedItem.id)
  const toggled = entries.find(e => e.id === unpinnedItem.id)
  assert.equal(toggled.pinned, true)

  // 清除非置顶
  entries = clearUnpinnedEntries(entries)
  assert.ok(entries.length < initialCount)
  assert.ok(entries.every(e => e.pinned))

  // 删除单条
  const targetId = entries[0].id
  entries = deleteEntry(entries, targetId)
  assert.ok(!entries.some(e => e.id === targetId))
})

test('ClipboardManager 破坏性边界异常测试', () => {
  // 1. 空输入不增加条目
  const original = getSampleClipboardEntries()
  assert.equal(addClipboardEntry(original, '').length, original.length)
  assert.equal(addClipboardEntry(original, '   ').length, original.length)

  // 2. 畸形 JSON 优雅降级为 code 或 text
  assert.notEqual(detectContentType('{ invalid json '), 'json')

  // 3. 不存在的 ID 操作无副作用
  assert.equal(deleteEntry(original, 'non-existent').length, original.length)
  assert.equal(togglePinEntry(original, 'non-existent').length, original.length)
})
