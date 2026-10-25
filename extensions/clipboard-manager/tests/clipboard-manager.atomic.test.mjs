import test from 'node:test'
import assert from 'node:assert/strict'
import { getDeclarativeBridge } from '@ztools/declarative-ui'
import { createHost } from '../../shared/test-harness.mjs'
import { clearUnpinnedClipboardHistory, toggleClipboardItemPin, deleteClipboardItem, saveEditedClipboardItem, syncCurrentSystemClipboard } from '../dist/clipboard-storage.js'
const host = createHost()
const key = 'ztools:clipboard:history'
const fast = { attempts: 1, intervalMs: 0 }
const record = (id, content, pinned = false) => ({ id, content, type: 'text', pinned, preview: content, copiedAt: 1 })
const write = items => host.storage.set(key, JSON.stringify(JSON.stringify(items)))
const read = () => JSON.parse(JSON.parse(host.storage.get(key)))
function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
// 暂停真实 SDK 的一次 CAS，让另一个公开操作先提交后再验证冲突重读。
function pauseFirstCas() {
  const bridge = getDeclarativeBridge(), original = bridge.storageCompareAndSet
  const entered = deferred(), release = deferred()
  let first = true
  bridge.storageCompareAndSet = async (...args) => {
    if (first) { first = false; entered.resolve(); await release.promise }
    return original(...args)
  }
  return { entered: entered.promise, release: release.resolve, restore: () => { bridge.storageCompareAndSet = original } }
}
test.beforeEach(() => {
  host.reset()
  host.ipc.clipboard_history_query = async () => []
  host.ipc.clipboard_history_clear_unpinned = async () => ({ success: true, count: 0 })
})

test('清空等待宿主期间另一窗口刚置顶的条目必须保留', async () => {
  const item = record('clip-preserve', '保留我'); write([item])
  const entered = deferred(), release = deferred()
  host.ipc.clipboard_history_clear_unpinned = async () => { entered.resolve(); await release.promise; return { success: true, count: 0 } }
  const clearing = clearUnpinnedClipboardHistory(); await entered.promise
  assert.equal(await toggleClipboardItemPin(item.id), true)
  release.resolve(); assert.equal(await clearing, 0)
  assert.equal(read()[0].pinned, true)
})

test('清空 CAS 冲突重读最新置顶状态，清理数量按成功提交计算', async () => {
  write([record('clip-race', '保留我'), record('clip-remove', '删除我')])
  const gate = pauseFirstCas()
  try {
    const clearing = clearUnpinnedClipboardHistory(); await gate.entered
    assert.equal(await toggleClipboardItemPin('clip-race'), true)
    gate.release(); assert.equal(await clearing, 1)
    assert.deepEqual(read().map(item => [item.id, item.pinned]), [['clip-race', true]])
  } finally { gate.release(); gate.restore() }
})

test('置顶和删除的旧快照都不能覆盖另一个窗口保存的记录', async () => {
  for (const change of [toggleClipboardItemPin, deleteClipboardItem]) {
    host.reset(); host.ipc.clipboard_history_query = async () => []
    write([record('clip-old', '原记录')])
    const gate = pauseFirstCas()
    try {
      const changing = change('clip-old'); await gate.entered
      const saved = await saveEditedClipboardItem({ content: '新记录', pinned: true }, undefined, undefined, fast)
      assert.equal(saved.persisted, true)
      gate.release(); assert.equal(await changing, true)
      assert.ok(read().some(item => item.content === '新记录' && item.pinned))
    } finally { gate.release(); gate.restore() }
  }
})

test('编辑冲突保留当前置顶；记录已删除或内容已变时明确失败，不复活旧记录', async () => {
  for (const mutation of ['pin', 'delete', 'edit']) {
    write([record('clip-edit', '原内容')]); const original = read()[0]
    const gate = pauseFirstCas()
    try {
      const saving = saveEditedClipboardItem({ content: '窗口 A 内容', pinned: false }, original, undefined, fast); await gate.entered
      if (mutation === 'pin') assert.equal(await toggleClipboardItemPin(original.id), true)
      if (mutation === 'delete') assert.equal(await deleteClipboardItem(original.id), true)
      if (mutation === 'edit') assert.equal((await saveEditedClipboardItem({ content: '窗口 B 内容', pinned: true }, original, undefined, fast)).persisted, true)
      gate.release(); const result = await saving
      if (mutation === 'pin') {
        assert.equal(result.persisted, true)
        assert.deepEqual(read().map(item => [item.content, item.pinned]), [['窗口 A 内容', true]])
      } else {
        assert.equal(result.persisted, false); assert.match(result.message, /修改或删除/)
        assert.equal(read().some(item => item.content === '窗口 A 内容'), false)
      }
    } finally { gate.release(); gate.restore() }
  }
})

test('并发新建使用不同 ID，补记当前文本不会覆盖已有置顶', async () => {
  const [a, b] = await Promise.all([
    saveEditedClipboardItem({ content: '并发 A', pinned: true }, undefined, undefined, fast),
    saveEditedClipboardItem({ content: '并发 B', pinned: true }, undefined, undefined, fast)
  ])
  assert.equal(a.persisted, true); assert.equal(b.persisted, true)
  assert.notEqual(a.item.id, b.item.id); assert.equal(read().length, 2)
  host.clipboard.text = '采集补记'
  host.ipc.clipboard_read_text = async () => ({ text: host.clipboard.text })
  const gate = pauseFirstCas()
  try {
    const syncing = syncCurrentSystemClipboard([], undefined, fast); await gate.entered
    assert.equal(await toggleClipboardItemPin(a.item.id), true)
    gate.release(); await syncing
    assert.equal(read().find(item => item.id === a.item.id).pinned, false)
    assert.equal(read().find(item => item.id === b.item.id).pinned, true)
    assert.ok(read().some(item => item.content === '采集补记'))
  } finally { gate.release(); gate.restore() }
})

test('读错在宿主清理前失败；二次读错、坏数据与持续冲突不覆写', async () => {
  write([record('clip-safe', '不能覆盖')]); const before = host.storage.get(key)
  let hostCalls = 0
  host.ipc.clipboard_history_clear_unpinned = async () => { hostCalls++; return { success: true, count: 0 } }
  host.faults.storageRead = new Error('读取失败')
  await assert.rejects(clearUnpinnedClipboardHistory(), /读取失败/); assert.equal(hostCalls, 0)
  host.faults.storageRead = null
  host.ipc.clipboard_history_clear_unpinned = async () => { host.faults.storageRead = new Error('二次读取失败'); return { success: true, count: 0 } }
  await assert.rejects(clearUnpinnedClipboardHistory(), /二次读取失败/); assert.equal(host.storage.get(key), before)
  host.faults.storageRead = null
  for (const corrupt of ['{bad', JSON.stringify([null]), JSON.stringify([{ id: 'clip-bad' }]), JSON.stringify([{ id: 'clip-bad', content: 'text', pinned: 'yes' }])]) {
    host.storage.set(key, JSON.stringify(corrupt)); const malformed = host.storage.get(key)
    await assert.rejects(clearUnpinnedClipboardHistory())
    assert.equal((await saveEditedClipboardItem({ content: '不能写', pinned: true }, undefined, undefined, fast)).persisted, false)
    assert.equal(host.storage.get(key), malformed)
  }
  write([record('clip-safe', '不能覆盖')]); host.ipc.clipboard_history_clear_unpinned = async () => ({ success: true, count: 0 })
  const bridge = getDeclarativeBridge(), original = bridge.storageCompareAndSet; let attempts = 0
  bridge.storageCompareAndSet = async () => { attempts++; return false }
  try {
    await assert.rejects(clearUnpinnedClipboardHistory(), /其他窗口修改/)
    assert.equal(attempts, 8); assert.equal(host.storage.get(key), before)
  } finally { bridge.storageCompareAndSet = original }
})


test('宿主采集编辑结果期间，本地原记录被改动时不得删除或假报完整保存', async () => {
  const original = record('clip-edit-native', '原内容')
  write([original])
  const entered = deferred(), release = deferred()
  host.ipc.clipboard_history_query = async () => {
    entered.resolve(); await release.promise
    return [{ id: 'native-new', content: '窗口 A 内容', format_type: 'text', is_pinned: 0 }]
  }
  const saving = saveEditedClipboardItem({ content: '窗口 A 内容', pinned: false }, original, undefined, fast)
  await entered.promise
  assert.equal(await toggleClipboardItemPin(original.id), true)
  release.resolve()
  const result = await saving
  assert.equal(result.persisted, false)
  assert.match(result.message, /新内容已保存.*旧记录已变化/)
  assert.deepEqual(read().map(item => [item.id, item.pinned]), [[original.id, true]])
})
