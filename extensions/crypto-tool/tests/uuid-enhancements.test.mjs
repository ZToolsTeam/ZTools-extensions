import test from 'node:test'
import assert from 'node:assert/strict'
import { setRuntimeLocale } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import { genUuid } from '../dist/index.js'
import {
  generateUuidV1,
  generateUuidV4,
  generateUuidV7,
  formatUuid,
  generateUuidBatch
} from '../dist/uuid.js'

const host = createHost()

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const UUID_V1_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-1[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

test.beforeEach(() => {
  host.reset()
  setRuntimeLocale('zh-CN')
})

test('UUID v4 / v7 / v1 算法格式与 RFC 9562 规范校验', () => {
  // v4 随机
  const v4List = generateUuidBatch({ version: 'v4', count: 20 })
  assert.equal(v4List.length, 20)
  assert.equal(new Set(v4List).size, 20)
  for (const id of v4List) assert.match(id, UUID_V4_RE)

  // v7 时间有序（RFC 9562：前 48 位为 Unix 毫秒时间戳，时间递增则字典序严格递增）
  const t1 = 1700000000000
  const t2 = 1700000005000
  const v7Early = generateUuidV7(t1)
  const v7Late = generateUuidV7(t2)
  assert.match(v7Early, UUID_V7_RE)
  assert.match(v7Late, UUID_V7_RE)
  assert.ok(v7Early < v7Late, `v7 应满足时间有序: ${v7Early} < ${v7Late}`)
  const extractedMs = Number(BigInt('0x' + v7Early.replace(/-/g, '').slice(0, 12)))
  assert.equal(extractedMs, t1, 'v7 前 48 位应精确编码 Unix 毫秒时间戳')

  // v1 时间戳 + 随机组播节点（node 首字节最低位为 1）
  const v1 = generateUuidV1(t1)
  assert.match(v1, UUID_V1_RE)
  const nodeFirstByte = parseInt(v1.split('-')[4].slice(0, 2), 16)
  assert.equal(nodeFirstByte & 0x01, 1, 'v1 随机节点首字节应设置组播位')
})

test('UUID 4 种常用格式转换正确（标准小写 / 标准大写 / 无连字符小写 / 无连字符大写）', () => {
  const sample = generateUuidV4()
  assert.equal(formatUuid(sample, 'standard'), sample.toLowerCase())
  assert.equal(formatUuid(sample, 'uppercase'), sample.toUpperCase())
  assert.match(formatUuid(sample, 'uppercase'), /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/)

  const noDash = formatUuid(sample, 'no-dash')
  assert.equal(noDash.length, 32)
  assert.match(noDash, /^[0-9a-f]{32}$/)

  const noDashUpper = formatUuid(sample, 'no-dash-upper')
  assert.equal(noDashUpper.length, 32)
  assert.match(noDashUpper, /^[0-9A-F]{32}$/)
})

test('[异常与边界] 非法数量、非法版本、时间戳越界与缺少安全随机源均 Fail-Fast 抛错', () => {
  for (const badCount of [0, -1, 1.5, 1001, '0', '-5', '1.5', '1001', 'abc', '']) {
    assert.throws(() => generateUuidBatch({ count: badCount }), /整数|integer/i, `count=${String(badCount)}`)
  }
  assert.throws(() => generateUuidBatch({ version: 'v99' }), /不支持|Unsupported/i)
  assert.throws(() => generateUuidV7(-1), /时间戳|Timestamp/i)
  assert.throws(() => generateUuidV7(Number.NaN), /时间戳|Timestamp/i)
  assert.throws(() => generateUuidV1(Number.NaN), /时间戳|Timestamp/i)

  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  try {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} })
    assert.throws(() => generateUuidBatch({ version: 'v7', count: 1 }), /安全随机数/)
  } finally {
    Object.defineProperty(globalThis, 'crypto', descriptor)
  }
})

test('UUID 视图交互闭环：打开即自动生成、Enter 一键复制、重新生成、批量复制、版本与格式切换、中英文 i18n', async () => {
  const view = await mount(genUuid)
  try {
    // 1. 打开即自动生成首批 5 条 v4 UUID
    const initialIds = [0, 1, 2, 3, 4].map((i) => view.item(`uuid-item-${i}`).props.title)
    assert.equal(new Set(initialIds).size, 5)
    initialIds.forEach((id) => assert.match(id, UUID_V4_RE))

    // 2. Enter 主动作一键复制单条 UUID
    await view.run(view.item('uuid-item-0'), '复制此 UUID')
    assert.equal(host.clipboard.text, initialIds[0])

    // 3. 批量复制全部
    await view.run(view.item('uuid-item-0'), '复制全部 UUID')
    assert.equal(host.clipboard.text, initialIds.join('\n'))

    // 4. 一键重新生成更换整批 UUID
    await view.run(view.item('uuid-item-0'), '重新生成')
    const regeneratedFirst = view.item('uuid-item-0').props.title
    assert.notEqual(regeneratedFirst, initialIds[0])
    assert.match(regeneratedFirst, UUID_V4_RE)

    // 5. 切换版本为 v7 -> 自动生成 5 条 v7 UUID
    await view.dropdown('v7')
    const v7Ids = [0, 1, 2, 3, 4].map((i) => view.item(`uuid-item-${i}`).props.title)
    v7Ids.forEach((id) => assert.match(id, UUID_V7_RE))

    // 6. 切换版本为 v1 -> 自动生成 5 条 v1 UUID
    await view.dropdown('v1')
    const v1Ids = [0, 1, 2, 3, 4].map((i) => view.item(`uuid-item-${i}`).props.title)
    v1Ids.forEach((id) => assert.match(id, UUID_V1_RE))

    // 7. 切换格式（标准大写 / 无连字符小写 / 无连字符大写），实时格式化现有批次
    await view.run(view.item('uuid-format-uppercase'), '切换为标准大写')
    assert.equal(view.item('uuid-item-0').props.title, v1Ids[0].toUpperCase())

    await view.run(view.item('uuid-format-no-dash'), '切换为无连字符小写')
    assert.equal(view.item('uuid-item-0').props.title, v1Ids[0].replace(/-/g, ''))

    await view.run(view.item('uuid-format-no-dash-upper'), '切换为无连字符大写')
    assert.equal(view.item('uuid-item-0').props.title, v1Ids[0].replace(/-/g, '').toUpperCase())

    // 8. 热切换至 en-US，检查英文文案与零中文残留
    setRuntimeLocale('en-US')
    await tick()
    assert.equal(view.tree().props.navigationTitle, 'UUID Generator')
    assert.ok(!/[\u4e00-\u9fa5]/.test(view.text()), `en-US UUID 视图不应含中文: ${view.text()}`)
  } finally {
    view.unmount()
  }
})
