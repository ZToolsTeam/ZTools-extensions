import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, mountPushed } from '../../shared/test-harness.mjs'
import { parseTimeInput } from '../dist/logic.js'
import { tzWorld } from '../dist/index.js'
import { worldTime } from '../dist/world-clock.js'
const host = createHost()

test('北京时间不随宿主 DST 改变；epoch 与日期范围按 UTC 判定', () => {
  const old = process.env.TZ
  try {
    for (const zone of ['America/New_York', 'UTC', 'Asia/Shanghai']) {
      process.env.TZ = zone
      for (const date of ['2026-03-08', '2026-11-01']) assert.equal(parseTimeInput(date + 'T00:00:00Z').beijingDateTime, date + ' 08:00:00')
      assert.equal(parseTimeInput('0').unixMilliseconds, 0)
      assert.equal(parseTimeInput('1969-12-31T23:59:59Z').valid, false)
    }
  } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old }
})

test('世界时钟使用 IANA 当时的 DST 偏移、支持半小时区并拒绝非法区', () => {
  assert.equal(worldTime(new Date('2026-01-01Z'), 'America/New_York').offsetMinutes, -300)
  assert.equal(worldTime(new Date('2026-07-01Z'), 'America/New_York').offsetMinutes, -240)
  assert.equal(worldTime(new Date('2026-07-01Z'), 'Asia/Kolkata').offsetMinutes, 330)
  assert.throws(() => worldTime(new Date(), 'Not/AZone'), RangeError)
})

test('世界时钟子命令可搜索城市、换算指定时刻并复制；错误输入不提交', async () => {
  host.reset()
  const view = await mount(tzWorld)
  try {
    await view.search('纽约')
    assert.equal(view.items().length, 1)
    await view.run(null, '换算指定时间…')
    const form = await mountPushed(host)
    try {
      await form.fill('time', 'bad'); await form.run(null, '换算时间')
      assert.ok(form.field('time').props.error)
      assert.equal(host.pushed.length, 1)
      await form.fill('time', '2026-03-08T00:00:00Z'); await form.run(null, '换算时间')
    } finally { form.unmount() }
    await view.run(view.item('America/New_York'), '复制当地时间')
    assert.equal(host.clipboard.text, '2026-03-07 19:00:00 UTC−05:00 (America/New_York)')
  } finally { view.unmount() }
})
