import test from 'node:test'
import assert from 'node:assert/strict'
import { getDeclarativeBridge } from '@ztools/declarative-ui'
import { createHost } from './test-harness.mjs'

/** 固定两个读取先于任一写入，避免“先后保存”掩盖跨窗口丢更新。仅使用测试宿主内存。 */
export async function raceStorageReads(key, run) {
  const bridge = getDeclarativeBridge()
  const get = bridge.storageGetItem, compare = bridge.storageCompareAndSet
  let readCount = 0, conflictCount = 0, release
  const bothRead = new Promise(resolve => { release = resolve })
  bridge.storageGetItem = async value => {
    const result = await get(value)
    if (value === key && ++readCount <= 2) {
      if (readCount === 2) release()
      await bothRead
    }
    return result
  }
  bridge.storageCompareAndSet = async (...args) => {
    const saved = await compare(...args)
    if (!saved) conflictCount++
    return saved
  }
  try { await run(); return conflictCount }
  finally { bridge.storageGetItem = get; bridge.storageCompareAndSet = compare }
}

/** 三款历史/收藏插件共用同一异常契约，传入的函数仍来自真实构建产物与 SDK。 */
export function registerStorageSafety({ key, sample, create, load, remove, clear, toggle, toggleField }) {
  const host = createHost()
  const seed = value => host.storage.set(key, JSON.stringify(value))
  const read = () => JSON.parse(host.storage.get(key))
  test.beforeEach(() => host.reset())

  test('原子存储：两个窗口同时新增不同记录，CAS 冲突重试后均保留', async () => {
    seed([])
    const conflicts = await raceStorageReads(key, () => Promise.all([create('a'), create('b')]))
    assert.ok(conflicts >= 1, '必须实际经过 CAS 冲突重试')
    assert.equal(read().length, 2)
    assert.equal(new Set(read().map(item => item.id)).size, 2)
  })

  test('原子存储：删除与新增交错，不复活已删除记录或丢失新增记录', async () => {
    seed([sample])
    await raceStorageReads(key, () => Promise.all([remove(sample.id), create('c')]))
    assert.equal(read().length, 1)
    assert.notEqual(read()[0].id, sample.id)
  })

  if (toggle) test('原子存储：并发切换收藏使用最新状态，不丢第二次切换', async () => {
    seed([sample])
    await raceStorageReads(key, () => Promise.all([toggle(sample.id), toggle(sample.id)]))
    assert.equal(read()[0][toggleField], Boolean(sample[toggleField]))
  })

  test('损坏原值和部分损坏条目：读取/新增/删除/清空均拒绝，字节不变', async () => {
    for (const bad of [null, '{截断的数据', { broken: true }, [sample, null], [sample, sample]]) {
      seed(bad)
      const before = host.storage.get(key)
      for (const action of [load, () => create('d'), () => remove(sample.id), clear, ...(toggle ? [() => toggle(sample.id)] : [])]) {
        await assert.rejects(action(), /数据损坏/)
        assert.equal(host.storage.get(key), before)
      }
    }
  })

  test('读取和写入失败保留原记录，失败不是成功空列表', async () => {
    seed([sample])
    const before = host.storage.get(key)
    host.faults.storageRead = new Error('读取故障')
    await assert.rejects(load(), /读取故障/)
    await assert.rejects(create('e'), /读取故障/)
    host.faults.storageRead = null
    host.faults.storageWrite = new Error('写入故障')
    await assert.rejects(create('f'), /写入故障/)
    assert.equal(host.storage.get(key), before)
  })

  test('旧宿主缺少 CAS 时拒绝写入，不退回读后覆盖', async () => {
    seed([sample])
    const bridge = getDeclarativeBridge(), compare = bridge.storageCompareAndSet
    const before = host.storage.get(key)
    delete bridge.storageCompareAndSet
    try { await assert.rejects(create('g'), /原子存储|升级/) }
    finally { bridge.storageCompareAndSet = compare }
    assert.equal(host.storage.get(key), before)
  })

  test('正常清空写入空列表，重新保存可用', async () => {
    seed([sample])
    await clear()
    assert.deepEqual(read(), [])
    await create('h')
    assert.equal(read().length, 1)
  })
  return host
}
