import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost } from '../../shared/test-harness.mjs'
import { clearUnpinnedClipboardHistory, getClipboardHistory, pasteSequenceManager, restoreClipboardItem, syncCurrentSystemClipboard } from '../dist/clipboard-storage.js'

const host = createHost()
const key = 'ztools:clipboard:history'

test('文件和图片历史保留原类型，复制粘贴按 ID 调用宿主', async () => {
  const rows = [
    { id: 'file-history', format_type: 'files', content: JSON.stringify(['/tmp/有 空格.txt', '/tmp/second.txt']) },
    { id: 'image-history', format_type: 'image', content: 'data:image/png;base64,aGVsbG8=' }
  ]
  const restored = []
  host.ipc.clipboard_history_query = async () => rows
  host.ipc.clipboard_history_restore = async (params) => { restored.push(params); return { success: true } }
  const list = await getClipboardHistory()
  assert.deepEqual(list[0].filePaths, ['/tmp/有 空格.txt', '/tmp/second.txt'])
  await restoreClipboardItem(list[0], false)
  await restoreClipboardItem(list[1], true)
  assert.deepEqual(restored, [{ id: 'file-history', paste: false }, { id: 'image-history', paste: true }])
  host.ipc.clipboard_history_restore = async () => ({ success: false, error: 'record missing' })
  await assert.rejects(restoreClipboardItem(list[0]), /record missing/)
})

test('清空宿主失败不删本地；本地写入失败向调用方报错', async () => {
  const local = [{ id: 'clip-local', content: 'retain', type: 'text', pinned: false }]
  host.storage.set(key, JSON.stringify(JSON.stringify(local)))
  const before = host.storage.get(key)
  host.ipc.clipboard_history_clear_unpinned = async () => ({ success: false, error: 'database locked' })
  await assert.rejects(clearUnpinnedClipboardHistory(), /清空失败/)
  assert.equal(host.storage.get(key), before)
  host.ipc.clipboard_history_clear_unpinned = async () => ({ success: true, count: 0 })
  const storageSet = host.storage.set.bind(host.storage)
  host.storage.set = () => { throw new Error('storage denied') }
  try { await assert.rejects(clearUnpinnedClipboardHistory(), /storage denied/) }
  finally { host.storage.set = storageSet }
})

test('旧客户端没有按 ID 恢复的接口：文本退回 SDK 复制，图片和文件提示升级', async () => {
  const missing = async () => { throw Object.assign(new Error('未知方法: clipboard_history_restore'), { code: 'METHOD_NOT_FOUND' }) }
  host.ipc.clipboard_history_query = async () => [
    { id: 'text-history', format_type: 'text', content: '旧客户端文本' },
    { id: 'image-history', format_type: 'image', content: 'data:image/png;base64,aGVsbG8=' }
  ]
  host.ipc.clipboard_history_restore = missing
  const list = await getClipboardHistory()
  const text = list.find((item) => item.id === 'text-history')
  const image = list.find((item) => item.id === 'image-history')
  await restoreClipboardItem(text, false)
  assert.equal(host.clipboard.text, '旧客户端文本')
  await assert.rejects(restoreClipboardItem(image, false), /需要新版 ZTools/)
})

test('同步剪贴板失败时向调用方报错；本地流水粘贴在顶部插入新条目后不重复粘贴同一条', async () => {
  await assert.rejects(
    syncCurrentSystemClipboard([], { clipboard_read_text: async () => { throw new Error('clipboard read failed') } }),
    /clipboard read failed/
  )
  pasteSequenceManager.reset()
  const items = [
    { id: 'a', content: 'A', type: 'text', preview: 'A', copiedAt: 2, pinned: false, charCount: 1, lineCount: 1 },
    { id: 'b', content: 'B', type: 'text', preview: 'B', copiedAt: 1, pinned: false, charCount: 1, lineCount: 1 }
  ]
  const first = pasteSequenceManager.pasteNext(items)
  assert.equal(first.item?.id, 'a')
  const updated = [
    { id: 'new-top', content: 'N', type: 'text', preview: 'N', copiedAt: 3, pinned: false, charCount: 1, lineCount: 1 },
    ...items
  ]
  const second = pasteSequenceManager.pasteNext(updated)
  assert.equal(second.item?.id, 'b')
})

test('像路径的文本仍是文本，只有宿主标记为 files 的记录才是文件', async () => {
  const { detectClipboardContentType } = await import('../dist/clipboard-storage.js')
  for (const text of ['C:\\Users\\someone\\Downloads\\a.zip', '/Users/someone/Desktop/a.txt', '\\\\server\\share\\x']) {
    assert.equal(detectClipboardContentType(text), 'text', text)
    assert.equal(detectClipboardContentType(text, 'text'), 'text', text)
  }
  assert.equal(detectClipboardContentType('/Users/someone/a.txt', 'files'), 'files')
})
