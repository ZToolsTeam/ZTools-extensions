import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount } from '../../shared/test-harness.mjs'
import TimestampCommand from '../dist/index.js'
import { parseTimeInput } from '../dist/logic.js'

const host = createHost()
test.beforeEach(() => host.reset())

test('秒、毫秒时间戳与 ISO 日期互转结果一致', () => {
  const s = parseTimeInput('1700000000')
  const ms = parseTimeInput('1700000000000')
  const iso = parseTimeInput('2023-11-14T22:13:20Z')
  for (const r of [s, ms, iso]) {
    assert.equal(r.valid, true)
    assert.equal(r.unixSeconds, 1700000000)
    assert.equal(r.unixMilliseconds, 1700000000000)
    assert.equal(r.utcIso, '2023-11-14T22:13:20.000Z')
  }
})

test('[边界] 非法内容、超长数字给出错误；空输入表示当前时间', () => {
  for (const bad of ['abc', '17000000000000000', '2023-13-45', '2023-02-30', '2023-02-28 25:00:00', '2023-01-01 12:60']) {
    assert.equal(parseTimeInput(bad).valid, false, bad)
  }
  // 只写日期时按本地零点，而不是 UTC 零点
  const d = parseTimeInput('2024-02-29')
  assert.equal(d.localDateTime, '2024-02-29 00:00:00')
  assert.equal(parseTimeInput('2024年2月29日 8:05').localDateTime, '2024-02-29 08:05:00')
  const now = new Date('2026-10-19T04:00:00Z')
  assert.equal(parseTimeInput('', now).unixSeconds, Math.floor(now.getTime() / 1000))
})

test('界面：输入时间戳后可复制毫秒值', async () => {
  const view = await mount(TimestampCommand)
  await view.search('1700000000')
  await view.run(view.item('item-ms'), '复制毫秒级时间戳')
  assert.equal(host.clipboard.text, '1700000000000')
})
