import assert from 'node:assert/strict'
import test from 'node:test'
import { createHost, mount } from '../../shared/test-harness.mjs'
import { commands, MockDataCommand, generateMockBatchUsers } from '../dist/index.js'

test('生日前后按周岁计算，年份和生成时间来自当前时钟', t => {
  const before = new Date(2030, 3, 3, 12)
  t.mock.timers.enable({ apis: ['Date'], now: before.getTime() })
  const first = generateMockBatchUsers(1, 20261025)[0]
  assert.equal(first.idCard.slice(6, 14), '19920404')
  assert.equal(first.age, 37)
  assert.equal(first.createdAt, before.toISOString())
  const birthday = new Date(2030, 3, 4, 12)
  t.mock.timers.setTime(birthday.getTime())
  const next = generateMockBatchUsers(1, 20261025)[0]
  assert.equal(next.idCard, first.idCard)
  assert.equal(next.age, 38)
  assert.equal(next.createdAt, birthday.toISOString())
  t.mock.timers.setTime(new Date(2031, 0, 1, 12).getTime())
  assert.equal(generateMockBatchUsers(1, 20261025)[0].age, 38)
})

test('批量快捷入口直接生成JSON，数量输入和重新生成后的复制内容一致', async () => {
  const host = createHost()
  const view = await mount(commands['mock-batch-json'])
  try {
    assert.equal(view.tree().props.searchBarAccessory.props.value, 'batch')
    await view.search('3')
    await view.run(view.item('batch-users-json'), '复制完整 JSON 数组')
    const before = JSON.parse(host.clipboard.text)
    assert.equal(before.length, 3)
    await view.run(view.item('batch-users-json'), '重新随机生成一批')
    await view.run(view.item('batch-users-json'), '复制完整 JSON 数组')
    const after = JSON.parse(host.clipboard.text)
    assert.equal(after.length, 3)
    assert.notEqual(after[0].idCard, before[0].idCard)
    for (const input of ['abc', '-1', '1.5', '501', 'Infinity']) {
      await view.search(input)
      await view.run(view.item('batch-users-json'), '复制完整 JSON 数组')
      const rows = JSON.parse(host.clipboard.text)
      assert.ok(rows.length >= 1 && rows.length <= 500)
    }
    await view.dropdown('single')
    assert.equal(view.tree().props.searchText, '')
    assert.equal(view.items().length, 5)
  } finally { view.unmount() }
})

test('单项快捷入口和普通入口可用，重新打开不再重复固定样例', async t => {
  createHost()
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2030, 0, 1).getTime() })
  const first = await mount(commands['mock-quick'])
  const original = first.items()[0].props.subtitle
  assert.equal(first.tree().props.searchBarAccessory.props.value, 'single')
  first.unmount()
  t.mock.timers.tick(1000)
  const second = await mount(MockDataCommand)
  try { assert.notEqual(second.items()[0].props.subtitle, original) }
  finally { second.unmount() }
})

test('[异常] 批量条数无效时如实提示已按 10 条生成，有效条数不提示', async () => {
  createHost()
  const view = await mount(commands['mock-batch-json'])
  try {
    for (const input of ['abc', '0', '501', '1.5', '-3', '1e2']) {
      await view.search(input)
      const item = view.item('batch-users-json')
      assert.match(item.props.subtitle, /已按默认 10 条生成/, input)
      assert.equal(item.props.accessories[0].tag.value, '条数无效')
      assert.match(item.props.title, /10 条/)
    }
    await view.search('500')
    assert.doesNotMatch(view.item('batch-users-json').props.subtitle, /条数须为/)
    await view.search('')
    assert.doesNotMatch(view.item('batch-users-json').props.subtitle, /条数须为/)
  } finally { view.unmount() }
})

test('单项：无校验位的数据不宣称算法合规，声明不否认与真实信息重合；姓名企业 JSON 分字段', async () => {
  const host = createHost()
  const view = await mount(() => MockDataCommand({ initialTab: 'single', initialSeed: 42 }))
  try {
    const status = id => JSON.stringify(view.item(id), (k, v) => (typeof v === 'function' ? undefined : v))
      .match(/"title":"校验状态","text":"([^"]+)"/)?.[1]
    assert.equal(status('mock-id-card'), '校验位按标准算法计算')
    assert.equal(status('mock-mobile-phone'), '无校验位，仅保证格式')
    assert.equal(status('mock-person-company'), '无校验位，仅保证格式')
    assert.doesNotMatch(view.text(), /不对应任何真实|100%/)
    assert.match(view.item('mock-mobile-phone').props.detail.props.markdown, /可能与真实号码/)
    await view.run(view.item('mock-person-company'), '复制键值对 JSON')
    const json = JSON.parse(host.clipboard.text)
    assert.deepEqual(Object.keys(json), ['name', 'companyName'])
    assert.ok(!json.companyName.includes(json.name))
  } finally { view.unmount() }
})

test('批量邮箱使用 RFC 2606 保留域名，不会投递到真实域名', () => {
  for (const row of generateMockBatchUsers(20, 7)) assert.match(row.email, /@example\.com$/)
})

test('界面文案统一使用全角括号，不出现半角括号', async () => {
  createHost()
  const view = await mount(commands['mock-batch-json'])
  try {
    await view.search('3')
    const batch = view.item('batch-users-json')
    assert.equal(batch.props.title, '批量模拟用户列表 JSON（3 条完整记录）')
    assert.match(batch.props.detail.props.markdown, /预览（3 条）/)
    await view.dropdown('single')
    for (const item of view.items()) {
      assert.doesNotMatch(item.props.title, /[()]/, item.props.title)
      const md = item.props.detail?.props?.markdown ?? ''
      assert.doesNotMatch(md.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, ''), /[()]/, md)
    }
  } finally { view.unmount() }
})
