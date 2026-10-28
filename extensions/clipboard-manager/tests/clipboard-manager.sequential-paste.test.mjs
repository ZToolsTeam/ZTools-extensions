// 流水粘贴：宿主已取到条目但粘贴失败（如 macOS 未授权辅助功能）时必须如实报告失败，不能走本地回退报成功
import test from 'node:test'
import assert from 'node:assert/strict'
import { setDeclarativeBridge } from '@ztools/declarative-ui'
import { pasteSequentialClipboard, resetPasteSequence } from '../dist/clipboard-storage.js'

const items = [
  { id: 'a', content: 'alpha', pinned: false, createdAt: 2 },
  { id: 'b', content: 'beta', pinned: false, createdAt: 1 }
]

function installBridge(pasteSequential) {
  const pasted = []
  const copied = []
  setDeclarativeBridge({
    showToast() { return { id: '1', update() {}, hide() {} } },
    async copyToClipboard(text) { copied.push(String(text)) },
    async readClipboardText() { return '' },
    async pasteToActive(text) { pasted.push(String(text)) },
    clipboardHistory: { pasteSequential }
  })
  return { pasted, copied }
}

test('宿主粘贴失败（PERMISSION_DENIED）时返回 pasteFailed，不再本地回退粘贴', async () => {
  const hostItem = { id: 'h1', content: 'gamma' }
  const { pasted } = installBridge(async () => ({
    success: false,
    item: hostItem,
    sequenceIndex: 0,
    total: 3,
    message: '已复制，但无法自动粘贴：请在系统设置 -> 隐私与安全性 -> 辅助功能中授权 ZTools',
    errorCode: 'PERMISSION_DENIED'
  }))
  const res = await pasteSequentialClipboard(items, { addNewLine: true })
  assert.equal(res.success, false)
  assert.equal(res.pasteFailed, true)
  assert.equal(res.item.id, 'h1')
  assert.equal(res.remaining, 3)
  assert.match(res.message, /辅助功能/)
  assert.deepEqual(pasted, [], '失败后不能再通过本地回退粘贴并报成功')
})

test('宿主粘贴成功时如实返回序号与剩余条数', async () => {
  const { pasted } = installBridge(async () => ({ success: true, item: { id: 'h2', content: 'x' }, sequenceIndex: 1, total: 3 }))
  const res = await pasteSequentialClipboard(items)
  assert.equal(res.success, true)
  assert.equal(res.offset, 1)
  assert.equal(res.remaining, 2)
  assert.equal(res.pasteFailed, undefined)
  assert.deepEqual(pasted, [])
})

test('宿主没有可用条目（无 item）或调用抛错时，仍按本地列表回退流水粘贴', async () => {
  const empty = installBridge(async () => ({ success: false }))
  const res = await pasteSequentialClipboard(items)
  assert.equal(res.success, true)
  assert.equal(res.pasteFailed, undefined)
  assert.equal(empty.pasted.length, 1)

  const broken = installBridge(async () => { throw new Error('IPC 管道断开') })
  const res2 = await pasteSequentialClipboard(items)
  assert.equal(res2.success, true)
  assert.equal(broken.pasted.length, 1)

  // 畸形宿主返回（message 不是字符串）不能被当作粘贴失败
  await resetPasteSequence()
  const malformed = installBridge(async () => ({ success: false, item: { id: 'z' }, message: { code: 1 } }))
  const res3 = await pasteSequentialClipboard(items)
  assert.equal(res3.pasteFailed, undefined)
  assert.equal(malformed.pasted.length, 1)
})
