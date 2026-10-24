// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout1-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchContextMenuEntries,
  toggleContextMenuEntry,
  cleanOrphanedContextMenuEntries,
  switchWin11ClassicMenu
} from '../dist/logic.js'

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

test('P04 context-menu: 真实注册表扫描不混入假数据、切换启用状态与孤立项清理异常测试', async () => {
  const mockHost = {
    dllplugin_call: async ({ func, params }) => {
      if (func === 'scanEntries') {
        return {
          ok: true,
          win11ClassicEnabled: true,
          entries: [
            {
              id: 'ctx-real-code',
              title: 'Open with VS Code',
              publisher: 'Microsoft',
              scope: 'file',
              registryKey: 'HKCU\\Software\\Classes\\*\\shell\\VSCode',
              command: 'Code.exe "%1"',
              enabled: true
            }
          ]
        }
      }
      if (func === 'toggleEntry') {
        if (String(params.regPath).startsWith('HKCR\\')) {
          return { ok: false, error: '写入 HKCR 被拒绝：需要管理员权限' }
        }
        return { ok: true, enabled: params.enabled, message: '已更新注册表 LegacyDisable 键值' }
      }
      if (func === 'cleanOrphans') {
        return { ok: true, cleanedCount: params.regPaths.length, message: '清理完成' }
      }
      return { ok: false, error: '不支持的操作' }
    }
  }

  const snap = await fetchContextMenuEntries(mockHost)
  assert.equal(snap.entries.length, 1)
  assert.equal(snap.entries[0].id, 'ctx-real-code')
  // 严禁在真实扫描结果中混入虚构的百度网盘/WPS
  assert.equal(snap.entries.some((e) => e.id === 'ctx-baidupan'), false)

  // 成功禁用 HKCU 右键菜单项
  const toggleOk = await toggleContextMenuEntry(
    'ctx-real-code',
    false,
    mockHost,
    'HKCU\\Software\\Classes\\*\\shell\\VSCode'
  )
  assert.equal(toggleOk.ok, true)
  assert.equal(toggleOk.enabled, false)

  // 异常场景 1：修改 HKCR 无权限时必须返回 ok: false
  const toggleDenied = await toggleContextMenuEntry(
    'ctx-7zip',
    false,
    {
      ...mockHost,
      context_menu_toggle: async () => {
        throw new Error('写入 HKCR 被拒绝')
      }
    },
    'HKCR\\*\\shellex\\ContextMenuHandlers\\7-Zip'
  )
  assert.equal(toggleDenied.ok, false)
  assert.match(toggleDenied.message, /拒绝|失败/)

  // 异常场景 2：尝试篡改系统安全注册表分支 HKLM\SAM 被安全拦截
  const samIntercept = await cleanOrphanedContextMenuEntries(['HKLM\\SAM'], mockHost)
  assert.equal(samIntercept.ok, false)
  assert.match(samIntercept.message, /禁止/)
})
