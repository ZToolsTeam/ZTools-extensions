import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost } from '../../shared/test-harness.mjs'
import { DEFAULT_WINDOW_PREFERENCES, getWindowPreferences, saveWindowPreferences } from '../dist/window-actions.js'

const host = createHost()
const key = 'ztools-window-management-preferences-v1'
test.beforeEach(() => host.reset())

test('窗口偏好设置正常保存、读取，部分更新保留已有值', async () => {
  await saveWindowPreferences({ innerGap: 8, outerGap: 12, cycleMode: 'disabled', percentage: 0.8 })
  await saveWindowPreferences({ outerGap: 0 })
  assert.deepEqual(await getWindowPreferences(), { innerGap: 8, outerGap: 0, cycleMode: 'disabled', percentage: 0.8 })
})

test('无设置或存储类型错误时使用默认值，负边距归零', async () => {
  assert.deepEqual(await getWindowPreferences(), DEFAULT_WINDOW_PREFERENCES)
  for (const value of [null, [], 'invalid', { innerGap: '8', outerGap: false }]) {
    host.storage.set(key, JSON.stringify(value))
    assert.deepEqual(await getWindowPreferences(), DEFAULT_WINDOW_PREFERENCES)
  }
  host.storage.set(key, JSON.stringify({ innerGap: -5, outerGap: -8 }))
  assert.deepEqual(await getWindowPreferences(), DEFAULT_WINDOW_PREFERENCES)
})

test('保存失败不冒充成功', async () => {
  host.faults.storageWrite = new Error('设置写入失败')
  await assert.rejects(saveWindowPreferences({ innerGap: 10 }), /设置写入失败/)
  assert.equal(host.storage.has(key), false)
})
