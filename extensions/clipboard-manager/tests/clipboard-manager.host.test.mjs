// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout1-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost } from '../../shared/test-harness.mjs'
import {
  getClipboardHistory,
  syncCurrentSystemClipboard,
  toggleClipboardItemPin,
  deleteClipboardItem,
  clearUnpinnedClipboardHistory,
  maskSensitiveContent
} from '../dist/clipboard-store.js'

async function withSimulatedRealElectronWindow(methodsMap, fn) {
  const prevWindow = globalThis.window
  globalThis.window = {
    __ztoolsElectron: {
      transport: {
        methods: Object.keys(methodsMap),
        call: async (method, payload) => {
          const handler = methodsMap[method]
          if (!handler) {
            throw new Error(`IPC method not registered: ${method}`)
          }
          return await handler(payload)
        }
      }
    }
  }
  try {
    return await fn()
  } finally {
    if (prevWindow === undefined) {
      delete globalThis.window
    } else {
      globalThis.window = prevWindow
    }
  }
}

test('P11 clipboard-history: 真实 SQLite 查询、系统剪贴板同步与空参数/敏感凭据防御测试', async () => {
  createHost()
  const mockHost = {
    clipboard_history_query: async () => ({
      items: [
        {
          id: 'sql-clip-101',
          content: 'SELECT * FROM clipboard_items WHERE is_pinned = 1;',
          format_type: 'text',
          created_at: Date.now() - 5000,
          is_pinned: 1
        }
      ]
    }),
    clipboard_read_text: async () => 'npm run test:real-layout1',
    clipboard_history_add: async () => ({ ok: true }),
    clipboard_history_toggle_pin: async ({ id }) => (id === 'sql-clip-101' ? true : { ok: false }),
    clipboard_history_delete: async ({ id }) => (id === 'sql-clip-101' ? true : { ok: false }),
    clipboard_history_clear_unpinned: async () => ({ clearedCount: 3 })
  }

  const history = await getClipboardHistory(mockHost)
  assert.equal(history.length, 1)
  assert.equal(history[0].id, 'sql-clip-101')
  assert.equal(history[0].pinned, true)
  // 严禁混入 SAMPLE_CLIPBOARD_ITEMS (clip-1 ~ clip-5)
  assert.equal(history.some((i) => i.id === 'clip-1'), false)

  // 同步当前系统剪贴板真实文本
  // 宿主历史库没有记下这条（模拟宿主采集未命中），插件存进自己的存储，不丢
  const synced = await syncCurrentSystemClipboard(history, mockHost, { attempts: 1 })
  assert.equal(synced.added, true)
  assert.equal(synced.item?.content, 'npm run test:real-layout1')
  assert.ok(synced.items.some((i) => i.id === 'sql-clip-101'), '宿主记录仍在列表里')

  // 正常切换置顶、删除与清空非置顶
  assert.equal(await toggleClipboardItemPin('sql-clip-101', mockHost), true)
  assert.equal(await deleteClipboardItem('sql-clip-101', mockHost), true)
  // 宿主清掉 3 条 + 插件存储里刚同步的 1 条未置顶记录
  assert.equal(await clearUnpinnedClipboardHistory(mockHost), 4)

  // 异常场景 1：空 ID 置顶或删除返回 false
  assert.equal(await toggleClipboardItemPin('', mockHost), false)
  assert.equal(await deleteClipboardItem('   ', mockHost), false)

  // 异常场景 2：空剪贴板同步不污染现有列表
  const emptySync = await syncCurrentSystemClipboard(history, {
    clipboard_read_text: async () => '   '
  })
  assert.equal(emptySync.added, false)
  assert.equal(emptySync.items.length, 1)

  // 异常场景 3：敏感 API Key 自动脱敏遮罩验证
  const maskRes = maskSensitiveContent('OPENAI_API_KEY=sk-proj1234567890abcdefghijklmnop9876')
  assert.equal(maskRes.isSensitive, true)
  assert.ok(maskRes.masked.includes('••••••••'))
})
