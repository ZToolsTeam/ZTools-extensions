import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatTimeAgo,
  getSampleHistoryItems
} from '../dist/logic.js'

test('BrowserHistory 相对时间格式化测试', () => {
  const now = 1700000000000

  // 1. 刚刚 (< 60秒)
  assert.equal(formatTimeAgo(now - 10 * 1000, now), '刚刚')
  assert.equal(formatTimeAgo(now, now), '刚刚')

  // 2. 分钟前
  assert.equal(formatTimeAgo(now - 5 * 60 * 1000, now), '5 分钟前')
  assert.equal(formatTimeAgo(now - 59 * 60 * 1000, now), '59 分钟前')

  // 3. 小时前
  assert.equal(formatTimeAgo(now - 2 * 3600 * 1000, now), '2 小时前')
  assert.equal(formatTimeAgo(now - 23 * 3600 * 1000, now), '23 小时前')

  // 4. 天前
  assert.equal(formatTimeAgo(now - 3 * 86400 * 1000, now), '3 天前')
})

test('BrowserHistory 边界与异常时间测试', () => {
  const now = 1700000000000

  // 未来时间兜底为刚刚
  assert.equal(formatTimeAgo(now + 10000, now), '刚刚')

  // 极大过去时间
  const oldStr = formatTimeAgo(1000000, now)
  assert.ok(oldStr.length > 0)
})

test('BrowserHistory 历史数据结构与完整性测试', () => {
  const items = getSampleHistoryItems()
  assert.ok(items.length >= 5)
  for (const item of items) {
    assert.ok(item.id)
    assert.ok(item.title)
    assert.ok(item.url.startsWith('https://'))
    assert.ok(item.visitTime > 0)
  }
})
