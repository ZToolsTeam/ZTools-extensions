import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost } from './test-harness.mjs'

/** 用真实插件扫描入口验证目录全失败、部分失败和下一次恢复；仅宿主边界使用替身。 */
export function directoryScanContract(load, count) {
  test('目录扫描：权限失败不能冒充空列表，部分结果保留，重新扫描后错误清除', async () => {
    const host = createHost()
    let mode = 'denied'
    host.ipc.system_get_path = async ({ name }) => `C:\\ScanFixture\\${name}`
    host.ipc.system_list_common_folders = async () => ({ folders: [{ id: 'temp', path: 'C:\\ScanFixture\\temp', exists: true }] })
    host.ipc.system_get_disk_usage = async () => ({ total: 100000, used: 50000, available: 50000, percent: 50 })
    host.ipc.filesystem_get_directory_contents = async ({ path }) => {
      if (mode === 'empty' || (mode === 'partial' && path.toLowerCase().includes('desktop'))) return { success: true, files: [] }
      throw new Error('PERMISSION_DENIED: fixture directory')
    }
    host.ipc.system_search_files = async ({ query }) => {
      if (mode === 'partial' && /downloads|temp|tencent files|xwechat_files/i.test(query)) {
        const dir = query.replace(/^dir:/, '')
        const files = ['fixture.zip', 'fixture.png', 'fixture.tmp', '发票.pdf'].map(name => ({ name, path: `${dir}\\${name}`, size: 128, mtime: 1700000000 }))
        return { files, total_matches: files.length, total_bytes: 128 * files.length }
      }
      if (mode === 'empty') return { files: [], total_matches: 0 }
      throw new Error('PERMISSION_DENIED: fixture directory')
    }
    host.ipc.dllplugin_call = async ({ func, params }) => {
      assert.equal(func, 'ParseInvoices')
      return { ok: true, invoices: params.files.map((path, i) => ({ id: String(i), path, fileName: '发票.pdf', sizeBytes: 128, totalAmount: 1 })) }
    }
    const denied = await load()
    assert.match(denied.error || '', /PERMISSION_DENIED/)
    assert.equal(count(denied), 0)
    mode = 'partial'
    const partial = await load()
    assert.match(partial.error || '', /PERMISSION_DENIED/)
    assert.ok(count(partial) > 0, '部分目录可读时必须保留有效结果')
    mode = 'empty'
    const recovered = await load()
    assert.equal(recovered.error, undefined)
    assert.equal(count(recovered), 0)
  })
}
