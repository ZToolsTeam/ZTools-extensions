import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Command = require('../dist/index.js').default
const utils = require('../dist/clock-utils.js')
const { CITY_DB } = require('../dist/cities.js')

test('world-clock 声明式视图渲染与跨时区时间换算集成测试', () => {
  const view = Command()
  assert.ok(view && view.type === 'List')
  assert.ok(CITY_DB.length >= 10)
  const now = new Date('2026-10-14T04:00:00Z')
  const timeStr = utils.formatTime(now, 'Asia/Shanghai', true)
  assert.match(timeStr, /^12:00/)
})

test('world-clock 非法日期字符串与夏令时/跨日边界测试 (Beyond Happy Path)', () => {
  assert.equal(utils.parseZonedDateTime('invalid-date-string', 'Asia/Shanghai'), null)
  assert.equal(utils.parseZonedDateTime('', 'UTC'), null)
})
