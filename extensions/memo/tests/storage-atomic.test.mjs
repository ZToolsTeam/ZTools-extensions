import test from 'node:test'
import assert from 'node:assert/strict'
import { getDeclarativeBridge } from '@ztools/declarative-ui'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import { raceStorageReads } from '../../shared/storage-safety-cases.mjs'
import MemoCommand from '../dist/index.js'
import { MEMOS_STORAGE_KEY as key, LEGACY_LOCALSTORAGE_KEY } from '../dist/logic.js'

const host = createHost()
const memo = (id, content = id) => ({ id, title: id, content, tag: '', createTime: 1, updateTime: 1 })
const seed = value => host.storage.set(key, JSON.stringify(value))
const stored = () => JSON.parse(host.storage.get(key))
const edit = async (view, id) => { await view.run(view.item(id), '编辑便签'); return mountPushed(host) }
const create = async (view, title) => {
  await view.run(null, '新建便签')
  const form = await mountPushed(host)
  await form.fill('title', title)
  return form
}
test.beforeEach(() => { host.reset(); delete globalThis.localStorage })

test('两独立模块窗口同时保存：真实经过 CAS 冲突重试，两条新增均保留', async () => {
  seed([memo('old')])
  const OtherCommand = (await import('../dist/index.js?independent-window')).default
  const a = await mount(MemoCommand), b = await mount(OtherCommand)
  const fa = await create(a, '窗口 A'), fb = await create(b, '窗口 B')
  try {
    const conflicts = await raceStorageReads(key, () => Promise.all([fa.run(null, '保存'), fb.run(null, '保存')]))
    assert.ok(conflicts >= 1)
    assert.deepEqual(stored().map(item => item.title).sort(), ['old', '窗口 A', '窗口 B'])
    assert.equal(host.toasts.filter(toast => toast.title === '已保存便签').length, 2)
  } finally { fa.unmount(); fb.unmount(); a.unmount(); b.unmount() }
})

test('旧表单只改标签也不能覆盖另一窗口新正文；失败后输入和表单保留', async () => {
  seed([memo('shared', '旧正文')])
  const a = await mount(MemoCommand), b = await mount(MemoCommand)
  const fa = await edit(a, 'shared'), fb = await edit(b, 'shared')
  try {
    await fb.fill('content', '另一窗口保存的新正文'); await fb.run(null, '保存')
    const before = host.storage.get(key)
    await fa.fill('tag', '我编辑的标签'); await fa.run(null, '保存')
    assert.equal(host.storage.get(key), before)
    assert.equal(fa.field('tag').props.value, '我编辑的标签')
    assert.equal(host.pushed.length, 1)
    assert.match(host.lastToast().message, /修改或删除/)
  } finally { fa.unmount(); fb.unmount(); a.unmount(); b.unmount() }
})

test('旧列表删除不能移除另一窗口已编辑的便签', async () => {
  seed([memo('shared')])
  const a = await mount(MemoCommand), b = await mount(MemoCommand)
  const form = await edit(b, 'shared')
  try {
    await form.fill('content', '重要的新正文'); await form.run(null, '保存')
    const before = host.storage.get(key)
    await a.run(a.item('shared'), '删除便签')
    assert.equal(host.storage.get(key), before)
    assert.match(host.lastToast().message, /修改或删除/)
  } finally { form.unmount(); a.unmount(); b.unmount() }
})

test('旧损坏页面重置时发现另一窗口已恢复，拒绝清空且不伪造备份成功', async () => {
  seed('{旧损坏数据')
  const view = await mount(MemoCommand)
  try {
    seed([memo('new', '另一窗口恢复后新增')])
    const before = host.storage.get(key)
    await view.run(view.item('load-error'), '备份原数据并重新开始')
    assert.equal(host.storage.get(key), before)
    assert.equal(host.storage.size, 1)
    assert.match(host.lastToast().message, /数据已变化/)
  } finally { view.unmount() }
})

test('备份读回不一致时保留损坏原值，不执行重置', async () => {
  seed('{需要恢复的原值')
  const before = host.storage.get(key), view = await mount(MemoCommand)
  const bridge = getDeclarativeBridge(), get = bridge.storageGetItem
  bridge.storageGetItem = async value => value.startsWith(`${key}.backup-`) ? '错误备份' : get(value)
  try {
    await view.run(view.item('load-error'), '备份原数据并重新开始')
    assert.equal(host.storage.get(key), before)
    assert.match(host.lastToast().message, /备份读回核验失败/)
  } finally { bridge.storageGetItem = get; view.unmount() }
})

test('备份完成后另一窗口写入：重置 CAS 冲突保留新数据，旧损坏值已有独立备份', async () => {
  seed('{旧损坏数据')
  const view = await mount(MemoCommand), bridge = getDeclarativeBridge(), compare = bridge.storageCompareAndSet
  bridge.storageCompareAndSet = async (value, expected, next) => {
    if (value === key) seed([memo('new', '备份期间写入')])
    return compare(value, expected, next)
  }
  try {
    await view.run(view.item('load-error'), '备份原数据并重新开始')
    assert.deepEqual(stored(), [memo('new', '备份期间写入')])
    const backups = [...host.storage.entries()].filter(([value]) => value.startsWith(`${key}.backup-`))
    assert.equal(backups.length, 1)
    assert.equal(JSON.parse(backups[0][1]), '{旧损坏数据')
    assert.match(host.lastToast().message, /数据已变化/)
  } finally { bridge.storageCompareAndSet = compare; view.unmount() }
})

test('首次迁移与另一窗口新增竞争：CAS 失败后读取新列表，旧浏览器数据保留', async () => {
  const legacy = JSON.stringify([memo('legacy')])
  globalThis.localStorage = { getItem: value => value === LEGACY_LOCALSTORAGE_KEY ? legacy : null }
  const bridge = getDeclarativeBridge(), compare = bridge.storageCompareAndSet
  bridge.storageCompareAndSet = async (value, expected, next) => {
    if (value === key && expected === undefined) seed([memo('new')])
    return compare(value, expected, next)
  }
  let view
  try {
    view = await mount(MemoCommand); await tick()
    assert.deepEqual(stored(), [memo('new')])
    assert.equal(view.item('new').props.title, 'new')
    assert.equal(globalThis.localStorage.getItem(LEGACY_LOCALSTORAGE_KEY), legacy)
    assert.ok(!host.toasts.some(toast => /已迁移/.test(toast.title)))
  } finally { bridge.storageCompareAndSet = compare; view?.unmount(); delete globalThis.localStorage }
})

test('旧宿主没有 CAS：保存失败并保留原数据和表单', async () => {
  seed([memo('keep')])
  const view = await mount(MemoCommand), form = await create(view, '不能丢数据')
  const bridge = getDeclarativeBridge(), compare = bridge.storageCompareAndSet, before = host.storage.get(key)
  delete bridge.storageCompareAndSet
  try {
    await form.run(null, '保存')
    assert.equal(host.storage.get(key), before)
    assert.equal(host.pushed.length, 1)
    assert.match(host.lastToast().message, /原子存储|升级/)
  } finally { bridge.storageCompareAndSet = compare; form.unmount(); view.unmount() }
})
