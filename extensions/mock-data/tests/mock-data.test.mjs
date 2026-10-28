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
