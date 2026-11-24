import test from 'node:test'
import assert from 'node:assert/strict'
import { setRuntimeLocale } from '@ztools/declarative-ui'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import { tzWorld, detectLocalTimeZone, getDayDiff, formatDayDiffLabel, searchWorldZones } from '../dist/index.js'

const host = createHost()

test.beforeEach(() => {
  host.reset()
  setRuntimeLocale('zh-CN')
})

test('本机时区自动检测：正常返回系统时区，非法或空值时降级到 Asia/Shanghai', () => {
  const OriginalDateTimeFormat = Intl.DateTimeFormat
  try {
    // 1. 模拟本机系统时区为 America/New_York
    Intl.DateTimeFormat = function MockDateTimeFormat(locale, options) {
      if (!options) {
        return { resolvedOptions: () => ({ timeZone: 'America/New_York' }) }
      }
      return new OriginalDateTimeFormat(locale, options)
    }
    assert.equal(detectLocalTimeZone(), 'America/New_York')

    // 2. 模拟本机返回空时区 -> 降级 Asia/Shanghai
    Intl.DateTimeFormat = function MockEmptyTz(locale, options) {
      if (!options) {
        return { resolvedOptions: () => ({ timeZone: '' }) }
      }
      return new OriginalDateTimeFormat(locale, options)
    }
    assert.equal(detectLocalTimeZone(), 'Asia/Shanghai')

    // 3. 模拟本机返回非法 IANA 时区 -> 降级 Asia/Shanghai
    Intl.DateTimeFormat = function MockInvalidTz(locale, options) {
      if (!options) {
        return { resolvedOptions: () => ({ timeZone: 'Mars/Olympus_Mons' }) }
      }
      return new OriginalDateTimeFormat(locale, options)
    }
    assert.equal(detectLocalTimeZone(), 'Asia/Shanghai')
  } finally {
    Intl.DateTimeFormat = OriginalDateTimeFormat
  }
})

test('世界时钟视图默认参考时区自动使用本机系统时区，而非写死 Asia/Shanghai', async () => {
  const OriginalDateTimeFormat = Intl.DateTimeFormat
  try {
    Intl.DateTimeFormat = function MockTokyoHost(locale, options) {
      if (!options) {
        return { resolvedOptions: () => ({ timeZone: 'America/New_York' }) }
      }
      return new OriginalDateTimeFormat(locale, options)
    }
    const view = await mount(tzWorld)
    try {
      assert.equal(view.tree().props.searchBarAccessory.props.value, 'America/New_York')
      assert.match(view.text(), /相对 纽约 的时差/)
    } finally {
      view.unmount()
    }
  } finally {
    Intl.DateTimeFormat = OriginalDateTimeFormat
  }
})

test('跨日天数标签：正确计算同日、+1/-1 跨日，中英文 i18n 同步输出并在界面展示', async () => {
  // 2026-06-15T18:00:00Z -> Los Angeles: 2026-06-15 11:00, Tokyo: 2026-06-16 03:00 (+1天)
  const utcEvening = new Date('2026-06-15T18:00:00Z')
  assert.equal(getDayDiff(utcEvening, 'America/Los_Angeles', 'America/Los_Angeles'), 0)
  assert.equal(getDayDiff(utcEvening, 'Asia/Tokyo', 'America/Los_Angeles'), 1)
  assert.equal(getDayDiff(utcEvening, 'America/Los_Angeles', 'Asia/Tokyo'), -1)

  setRuntimeLocale('zh-CN')
  assert.equal(formatDayDiffLabel(0), '')
  assert.equal(formatDayDiffLabel(1), '+1天')
  assert.equal(formatDayDiffLabel(-1), '-1天')

  setRuntimeLocale('en-US')
  assert.equal(formatDayDiffLabel(0), '')
  assert.equal(formatDayDiffLabel(1), '+1d')
  assert.equal(formatDayDiffLabel(-1), '-1d')

  // 界面实测：设定固定时刻 2026-06-15T18:00:00Z 并以洛杉矶为参考，东京应显示跨日标签
  setRuntimeLocale('zh-CN')
  const view = await mount(tzWorld)
  try {
    await view.dropdown('America/Los_Angeles')
    await view.run(null, '换算指定时间…')
    const form = await mountPushed(host)
    try {
      await form.fill('time', '2026-06-15T18:00:00Z')
      await form.run(null, '换算时间')
    } finally {
      form.unmount()
    }
    const tokyoZh = view.item('Asia/Tokyo')
    assert.ok(
      tokyoZh.props.accessories.some((acc) => acc.text === '+1天'),
      `中文态东京应显示 +1天，实际: ${JSON.stringify(tokyoZh.props.accessories)}`
    )

    // 热切换至英文态验证 +1d 且无中文残留
    setRuntimeLocale('en-US')
    await tick()
    const tokyoEn = view.item('Asia/Tokyo')
    assert.ok(
      tokyoEn.props.accessories.some((acc) => acc.text === '+1d'),
      `英文态东京应显示 +1d，实际: ${JSON.stringify(tokyoEn.props.accessories)}`
    )
    assert.ok(!/[\u4e00-\u9fa5]/.test(view.text()), `en-US 世界时钟不应含中文: ${view.text()}`)
  } finally {
    view.unmount()
  }
})

test('完整中英文城市/国家/时区检索库：支持 20 常用城市之外的全球多城市检索，英文态零中文残留', async () => {
  const zones = Intl.supportedValuesOf('timeZone')

  // 中文城市名检索（原 20 城市库中不存在的城市）
  const sfZh = searchWorldZones('旧金山', zones, 'zh-CN')
  assert.equal(sfZh.length, 1)
  assert.equal(sfZh[0].zone, 'America/Los_Angeles')
  assert.equal(sfZh[0].title, '旧金山')

  const frankfurtZh = searchWorldZones('法兰克福', zones, 'zh-CN')
  assert.equal(frankfurtZh.length, 1)
  assert.equal(frankfurtZh[0].zone, 'Europe/Berlin')
  assert.equal(frankfurtZh[0].title, '法兰克福')

  const melbourneZh = searchWorldZones('墨尔本', zones, 'zh-CN')
  assert.equal(melbourneZh.length, 1)
  assert.equal(melbourneZh[0].zone, 'Australia/Melbourne')

  const taipeiZh = searchWorldZones('台北', zones, 'zh-CN')
  assert.equal(taipeiZh.length, 1)
  assert.equal(taipeiZh[0].zone, 'Asia/Taipei')

  // 英文城市名检索
  const vancouverEn = searchWorldZones('Vancouver', zones, 'en-US')
  assert.equal(vancouverEn.length, 1)
  assert.equal(vancouverEn[0].zone, 'America/Vancouver')
  assert.equal(vancouverEn[0].title, 'Vancouver')

  const osakaEn = searchWorldZones('Osaka', zones, 'en-US')
  assert.equal(osakaEn.length, 1)
  assert.equal(osakaEn[0].zone, 'Asia/Tokyo')
  assert.equal(osakaEn[0].title, 'Osaka')

  // 国家检索（美国跨越多个时区，按时区去重）
  const usZh = searchWorldZones('美国', zones, 'zh-CN')
  assert.ok(usZh.length >= 6, `美国应匹配至少 6 个时区，实际 ${usZh.length}`)
  assert.equal(new Set(usZh.map((item) => item.zone)).size, usZh.length, '搜索结果应按 IANA 时区去重')

  // 视图中英文检索实测
  setRuntimeLocale('en-US')
  const view = await mount(tzWorld)
  try {
    await view.search('San Francisco')
    assert.equal(view.items().length, 1)
    assert.equal(view.item('America/Los_Angeles').props.title, 'San Francisco')
    assert.ok(!/[\u4e00-\u9fa5]/.test(view.text()), `en-US 搜索结果不应含中文: ${view.text()}`)
  } finally {
    view.unmount()
  }
})
