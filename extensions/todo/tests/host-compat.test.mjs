// 旧客户端兼容：插件里的 SDK 由客户端在运行时提供，旧客户端的 LocalStorage 没有 updateItem
import test from 'node:test'
import assert from 'node:assert/strict'
import { updateStorageItem, isHostMethodMissing } from '../dist/host-compat.js'

test('旧客户端没有 updateItem 时退回读后写', async () => {
  const data = new Map([['k', [1]]])
  const oldStorage = {
    async getItem(key) { return data.get(key) },
    async setItem(key, value) { data.set(key, value) }
  }
  assert.deepEqual(await updateStorageItem(oldStorage, 'k', (cur) => [...cur, 2]), [1, 2])
  assert.deepEqual(data.get('k'), [1, 2])
})

test('客户端提供 updateItem 时只走 updateItem', async () => {
  const calls = []
  const storage = {
    async getItem() { throw new Error('不应直接读') },
    async setItem() { throw new Error('不应直接写') },
    async updateItem(key, fn) { calls.push(key); return fn([]) }
  }
  assert.deepEqual(await updateStorageItem(storage, 'k', (cur) => [...cur, 1]), [1])
  assert.deepEqual(calls, ['k'])
})

test('只把「宿主不认识接口」识别为旧客户端', () => {
  assert.equal(isHostMethodMissing('未知方法: system_list_volumes'), true)
  assert.equal(isHostMethodMissing(new Error('METHOD_NOT_FOUND')), true)
  assert.equal(isHostMethodMissing('LocalStorage.updateItem is not a function'), true)
  assert.equal(isHostMethodMissing('权限不足'), false)
  assert.equal(isHostMethodMissing(undefined), false)
})
