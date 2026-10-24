// world-clock 时差对比与指定时间换算：真实声明式运行时 + 模拟宿主（剪贴板 / Toast / 页面导航）
// 本机时区固定为 Asia/Singapore（与真机测试实例一致），必须在加载插件之前设置
process.env.TZ = 'Asia/Singapore'

import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'

const { default: WorldClockCommand, getLocalTimeZone } = await import('../dist/index.js')
const utils = await import('../dist/clock-utils.js')

const host = createHost()
test.beforeEach(() => host.reset())

const accText = (item) => item.props.accessories.map((a) => a.text ?? a.tag?.value)
const byName = (view, name) => view.item((it) => it.props.title.startsWith(`${name}  `))

async function convertFrom(view, cityName, input) {
  await view.run(byName(view, cityName), `以${cityName}时间为基准换算`)
  assert.equal(host.pushed.length, 1, '推入了换算表单')
  const form = await mountPushed(host)
  await form.fill('datetime', input)
  await form.run(undefined, '换算到各城市')
  return form
}

test('实时模式：每个城市显示与本机时区的时差标签，顶栏说明时差基准并提供「换算时间」入口', async () => {
  const view = await mount(WorldClockCommand)
  const fb = view.tree().props.filterBar
  assert.match(fb.summaryText, /^实时 · 时差相对本机时区 Asia\/Singapore（GMT\+8）$/)
  assert.deepEqual(fb.actions.map((a) => a.title), ['换算时间'])

  assert.ok(accText(byName(view, '北京')).includes('与本地相同'))
  assert.ok(accText(byName(view, '东京')).includes('早1小时'))
  assert.ok(accText(byName(view, '新加坡')).includes('与本地相同'))
  // 每个城市的时差标签都是不带颜色的中性标签
  for (const item of view.items()) {
    const tag = item.props.accessories.find((a) => a.tag)
    assert.ok(tag && !tag.tag.color && !tag.color, `${item.props.title} 时差标签无彩色`)
  }
  // 动作面板第 4 项是换算入口（前两项仍是 Enter / ⌘Enter 的复制动作）
  const titles = view.actions(byName(view, '北京')).map((a) => a.props.title)
  assert.deepEqual(titles.slice(0, 2), ['复制完整时间信息', '仅复制当前时间 HH:MM:SS'])
  assert.equal(titles[3], '以北京时间为基准换算')
  view.unmount()
})

test('以北京时间换算：列表切换到该时刻，纽约跨到前一天并标出 -1天、晚12小时，复制的是换算后的时间', async () => {
  const view = await mount(WorldClockCommand)
  await convertFrom(view, '北京', '2026-10-22 09:30')
  assert.equal(host.pushed.length, 0, '提交成功后表单出栈')
  assert.equal(host.toasts.length, 0)

  const fb = view.tree().props.filterBar
  assert.equal(fb.summaryText, '换算：北京 2026-10-22 09:30（GMT+8）时各城市的当地时间')
  assert.deepEqual(fb.actions.map((a) => a.title), ['修改换算时间', '回到实时'])

  const ny = byName(view, '纽约')
  assert.equal(ny.props.title, '纽约  21:30:00')
  assert.match(ny.props.subtitle, /10\/21/)
  assert.deepEqual(accText(ny), ['-1天', '晚12小时', 'GMT-4'])
  assert.deepEqual(accText(byName(view, '北京')), ['与基准相同', 'GMT+8'])
  assert.deepEqual(accText(byName(view, '东京')), ['早1小时', 'GMT+9'])
  // 伦敦 10 月 22 日仍是夏令时 BST（GMT+1）
  assert.deepEqual(accText(byName(view, '伦敦')), ['晚7小时', 'GMT+1'])

  await view.run(ny, '复制完整时间信息')
  assert.match(host.clipboard.text, /^纽约 \(美国\): 10\/21周三 21:30:00 \(GMT-4\)$/)
  await view.run(byName(view, '东京'), '仅复制换算后时间 HH:MM:SS')
  assert.equal(host.clipboard.text, '10:30:00')

  // 定时器继续跳动也不会把换算时间刷回当前时间
  await new Promise((r) => setTimeout(r, 1100))
  assert.equal(byName(view, '纽约').props.title, '纽约  21:30:00')

  // 搜索在换算模式下照常可用，结果也按换算时刻显示
  await view.search('Sydney')
  assert.equal(byName(view, '悉尼').props.title, '悉尼  12:30:00')
  await view.search('')

  await view.tree().props.filterBar.actions.find((a) => a.title === '回到实时').onAction()
  await tick()
  assert.match(view.tree().props.filterBar.summaryText, /^实时/)
  assert.notEqual(byName(view, '纽约').props.title, '纽约  21:30:00')
  view.unmount()
})

test('顶栏「换算时间」以本机时区为基准；只写时分时按本机当地今天解释；「修改换算时间」保留基准时区', async () => {
  const view = await mount(WorldClockCommand)
  await view.tree().props.filterBar.actions[0].onAction()
  const form = await mountPushed(host)
  const intro = form.tree().children.find((n) => n.type === 'Form.Description')
  assert.match(intro.props.text, /^本机（Asia\/Singapore，GMT\+8）$/)
  // 表单预填本机当前时间（到分钟）
  assert.match(form.field('datetime').props.value, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)

  await form.fill('datetime', '9:05')
  await form.run(undefined, '换算到各城市')
  const today = utils.formatDateTimeInput(new Date(), 'Asia/Singapore').slice(0, 10)
  assert.equal(view.tree().props.filterBar.summaryText, `换算：本机 ${today} 09:05（GMT+8）时各城市的当地时间`)
  assert.equal(byName(view, '北京').props.title, '北京  09:05:00')

  await view.tree().props.filterBar.actions.find((a) => a.title === '修改换算时间').onAction()
  const again = await mountPushed(host)
  assert.equal(again.field('datetime').props.value, `${today} 09:05`, '修改时预填当前换算时间')
  assert.match(again.tree().props.navigationTitle, /本机/)
  view.unmount()
})

test('异常输入：格式错误、日期越界、夏令时跳过的时间都拒绝换算，表单留在原处并提示，列表保持实时', async () => {
  const view = await mount(WorldClockCommand)
  const cases = [
    ['北京', '明天九点', /格式应为/],
    ['北京', '', /请输入要换算的时间/],
    ['北京', '2026-02-30 10:00', /不存在/],
    ['北京', '2026-10-22 24:00', /不存在/],
    // 纽约 2026-03-08 02:00 起跳到 03:00，02:30 不存在
    ['纽约', '2026-03-08 02:30', /夏令时/]
  ]
  for (const [city, input, pattern] of cases) {
    host.reset()
    const form = await convertFrom(view, city, input)
    assert.equal(host.pushed.length, 1, `「${input}」不出栈`)
    assert.equal(host.lastToast().style, 'FAILURE')
    assert.match(host.lastToast().message, pattern)
    assert.match(form.field('datetime').props.error, pattern, '字段上显示错误')
    assert.match(view.tree().props.filterBar.summaryText, /^实时/, '主列表仍是实时模式')
    // 改正输入后错误清除
    await form.fill('datetime', '2026-10-22 08:00')
    assert.equal(form.field('datetime').props.error, undefined)
    form.unmount()
  }
  view.unmount()
})

test('夏令时回拨的重复时段取较早一次；跨年换算的天数差正确', async () => {
  // 伦敦 2026-10-25 01:30 出现两次（BST 与 GMT），取较早的 BST，即 00:30Z
  const amb = utils.parseConversionInput('2026-10-25 01:30', 'Europe/London', new Date())
  assert.ok(amb.ok)
  assert.equal(amb.date.toISOString(), '2026-10-25T00:30:00.000Z')

  const view = await mount(WorldClockCommand)
  await convertFrom(view, '旧金山', '2026/12/31 20:00')
  const bj = byName(view, '北京')
  assert.equal(bj.props.title, '北京  12:00:00')
  assert.match(bj.props.subtitle, /1\/1/)
  assert.deepEqual(accText(bj), ['+1天', '早16小时', 'GMT+8'])
  view.unmount()
})

test('本机时区读取失败或不合法时退回 UTC，插件照常渲染', async () => {
  const original = Intl.DateTimeFormat.prototype.resolvedOptions
  try {
    Intl.DateTimeFormat.prototype.resolvedOptions = function () {
      return { ...original.call(this), timeZone: 'Bad/Zone' }
    }
    assert.equal(getLocalTimeZone(), 'UTC')
    const view = await mount(WorldClockCommand)
    assert.match(view.tree().props.filterBar.summaryText, /本机时区 UTC（GMT(\+0)?）/)
    assert.ok(accText(byName(view, '伦敦')).includes('早1小时'))
    view.unmount()

    Intl.DateTimeFormat.prototype.resolvedOptions = function () {
      throw new Error('ICU 不可用')
    }
    assert.equal(getLocalTimeZone(), 'UTC')
  } finally {
    Intl.DateTimeFormat.prototype.resolvedOptions = original
  }
  // 非法时区的换算请求返回错误而不是抛异常
  const bad = utils.parseConversionInput('09:30', 'Bad/Zone', new Date())
  assert.equal(bad.ok, false)
  const bad2 = utils.parseConversionInput('2026-10-22 09:30', 'Bad/Zone', new Date())
  assert.equal(bad2.ok, false)
})
