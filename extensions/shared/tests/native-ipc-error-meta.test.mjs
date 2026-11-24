import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  callHostTransport,
  trashRealItem,
  invokeDllPluginCapability,
  invokeHostCapability,
  invokePluginService
} from '../native-ipc.ts'

const originalZtools = globalThis.ztools

afterEach(() => {
  if (originalZtools === undefined) {
    delete globalThis.ztools
  } else {
    globalThis.ztools = originalZtools
  }
})

test('unwrapTransportResponse 外层通用错误码不得覆盖内层精确错误码与详情', async () => {
  // 单层失败信封：外层 INTERNAL_ERROR，内层 error 为精确 PERMISSION_DENIED
  const outerAndInner = await callHostTransport(
    'shell_trash_item',
    { fullPath: '/protected' },
    {
      shell_trash_item: async () => ({
        success: false,
        code: 'INTERNAL_ERROR',
        details: { hostCode: 'GENERIC_FAIL', source: 'outer' },
        error: {
          code: 'PERMISSION_DENIED',
          message: '无权删除受保护文件',
          details: { hostCode: 'PATH_NOT_AUTHORIZED', source: 'inner' }
        }
      })
    }
  )
  assert.equal(outerAndInner.ok, false)
  assert.equal(outerAndInner.error, '无权删除受保护文件')
  assert.equal(outerAndInner.errorCode, 'PERMISSION_DENIED')
  assert.deepEqual(outerAndInner.errorDetails, { hostCode: 'PATH_NOT_AUTHORIZED', source: 'inner' })

  // 单层失败信封：内层无 details，仅覆盖 code，保留外层 details
  const partialInner = await callHostTransport(
    'shell_trash_item',
    { fullPath: '/protected' },
    {
      shell_trash_item: async () => ({
        success: false,
        code: 'INTERNAL_ERROR',
        details: { hostCode: 'OUTER_ONLY' },
        error: {
          code: 'FILE_NOT_FOUND',
          message: '目标不存在'
        }
      })
    }
  )
  assert.equal(partialInner.ok, false)
  assert.equal(partialInner.errorCode, 'FILE_NOT_FOUND')
  assert.deepEqual(partialInner.errorDetails, { hostCode: 'OUTER_ONLY' })

  // 双层失败信封：firstLayer 含外层通用 code，firstLayer.error 含内层精确 code 与 details
  const nestedLayer = await callHostTransport(
    'system_get_disk_usage',
    { drive: 'C:\\' },
    {
      system_get_disk_usage: async () => ({
        success: true,
        data: {
          success: false,
          code: 'INTERNAL_ERROR',
          details: { hostCode: 'WRAPPER_CODE' },
          error: {
            code: 'DISK_FULL',
            message: '磁盘空间不足',
            details: { hostCode: 'ENOSPC' }
          }
        }
      })
    }
  )
  assert.equal(nestedLayer.ok, false)
  assert.equal(nestedLayer.error, '磁盘空间不足')
  assert.equal(nestedLayer.errorCode, 'DISK_FULL')
  assert.deepEqual(nestedLayer.errorDetails, { hostCode: 'ENOSPC' })

  // 成功响应不污染 errorCode / errorDetails
  const okRes = await callHostTransport(
    'shell_open_path',
    { fullPath: '/tmp/a.txt' },
    {
      shell_open_path: async () => ({ success: true, data: { opened: true } })
    }
  )
  assert.equal(okRes.ok, true)
  assert.equal('errorCode' in okRes, false)
  assert.equal('errorDetails' in okRes, false)
})

test('trashRealItem 透传 errorCode 与 errorDetails 且不污染成功态', async () => {
  const failRes = await trashRealItem('/Users/demo/locked.txt', {
    shell_trash_item: async () => ({
      success: false,
      error: {
        code: 'PERMISSION_DENIED',
        message: '拒绝访问',
        details: { hostCode: 'EACCES' }
      }
    })
  })
  assert.equal(failRes.ok, false)
  assert.equal(failRes.error, '拒绝访问')
  assert.equal(failRes.errorCode, 'PERMISSION_DENIED')
  assert.deepEqual(failRes.errorDetails, { hostCode: 'EACCES' })

  const okRes = await trashRealItem('/Users/demo/ok.txt', {
    shell_trash_item: async () => ({ success: true, data: true })
  })
  assert.equal(okRes.ok, true)
  assert.equal('errorCode' in okRes, false)
  assert.equal('errorDetails' in okRes, false)
})

test('invokeDllPluginCapability 全部失败分支透传 errorCode 与 errorDetails', async () => {
  // 1. unwrapDllRawPayload: parsed.error 分支
  const dllErrRes = await invokeDllPluginCapability(
    'DemoPlugin',
    'run',
    {},
    {
      invokeNative: async () => ({
        code: -1,
        error: '原生执行失败',
        errorCode: 'DLL_ERROR',
        errorDetails: { hostCode: 'WIN32_ERR_5' }
      })
    }
  )
  assert.equal(dllErrRes.ok, false)
  assert.equal(dllErrRes.errorCode, 'DLL_ERROR')
  assert.deepEqual(dllErrRes.errorDetails, { hostCode: 'WIN32_ERR_5' })

  // 2. unwrapDllRawPayload: parsed.ok === false 分支（string code + details）
  const dllOkFalseRes = await invokeDllPluginCapability(
    'DemoPlugin',
    'run',
    {},
    {
      invokeNative: async () => ({
        ok: false,
        code: 'PERMISSION_DENIED',
        message: '需要管理员权限',
        details: { hostCode: 'ELEVATION_REQUIRED' }
      })
    }
  )
  assert.equal(dllOkFalseRes.ok, false)
  assert.equal(dllOkFalseRes.errorCode, 'PERMISSION_DENIED')
  assert.deepEqual(dllOkFalseRes.errorDetails, { hostCode: 'ELEVATION_REQUIRED' })

  // 3. wrapCaughtDllError: 异常对象带 code 与 details
  const caughtErr = Object.assign(new Error('管道已断开'), {
    code: 'NATIVE_HOST_ERROR',
    details: { hostCode: 'EPIPE' }
  })
  const caughtRes = await invokeDllPluginCapability(
    'DemoPlugin',
    'run',
    {},
    {
      invokeNative: async () => {
        throw caughtErr
      }
    }
  )
  assert.equal(caughtRes.ok, false)
  assert.equal(caughtRes.errorCode, 'NATIVE_HOST_ERROR')
  assert.deepEqual(caughtRes.errorDetails, { hostCode: 'EPIPE' })

  // 4. ipcRes 显式传输失败分支
  const ipcFailRes = await invokeDllPluginCapability(
    'DemoPlugin',
    'run',
    {},
    {
      dllplugin_call: async () => ({
        success: false,
        error: {
          code: 'REQUEST_TIMEOUT',
          message: '调用超时',
          details: { hostCode: 'ETIMEDOUT' }
        }
      })
    }
  )
  assert.equal(ipcFailRes.ok, false)
  assert.equal(ipcFailRes.errorCode, 'REQUEST_TIMEOUT')
  assert.deepEqual(ipcFailRes.errorDetails, { hostCode: 'ETIMEDOUT' })

  // 5. 成功态不污染 errorCode / errorDetails
  const okRes = await invokeDllPluginCapability(
    'DemoPlugin',
    'run',
    {},
    {
      invokeNative: async () => ({ code: 0, data: { value: 42 } })
    }
  )
  assert.equal(okRes.ok, true)
  assert.equal('errorCode' in okRes, false)
  assert.equal('errorDetails' in okRes, false)
})

test('invokeHostCapability 与 invokePluginService 全部失败分支透传 errorCode 与 errorDetails', async () => {
  // 1. hostOverride[normalizedMethod] mock 分支
  const mockCapFail = await invokeHostCapability(
    'custom.action',
    {},
    {
      custom_action: async () => ({
        success: false,
        error: { code: 'PLUGIN_BUSY', message: '忙碌', details: { hostCode: 'BUSY_1' } }
      })
    }
  )
  assert.equal(mockCapFail.ok, false)
  assert.equal(mockCapFail.errorCode, 'PLUGIN_BUSY')
  assert.deepEqual(mockCapFail.errorDetails, { hostCode: 'BUSY_1' })

  // 2. filesystem.deleteItem 经 trashRealItem 透传
  const delFail = await invokeHostCapability(
    'filesystem.deleteItem',
    { path: '/locked' },
    {
      shell_trash_item: async () => ({
        success: false,
        error: { code: 'PERMISSION_DENIED', message: '无权删除', details: { hostCode: 'EPERM' } }
      })
    }
  )
  assert.equal(delFail.ok, false)
  assert.equal(delFail.errorCode, 'PERMISSION_DENIED')
  assert.deepEqual(delFail.errorDetails, { hostCode: 'EPERM' })

  // 3. system.showItemInFolder 透传
  const revealFail = await invokeHostCapability(
    'system.showItemInFolder',
    { path: '/missing' },
    {
      shell_show_item_in_folder: async () => ({
        success: false,
        error: { code: 'FILE_NOT_FOUND', message: '路径不存在', details: { hostCode: 'ENOENT' } }
      })
    }
  )
  assert.equal(revealFail.ok, false)
  assert.equal(revealFail.errorCode, 'FILE_NOT_FOUND')
  assert.deepEqual(revealFail.errorDetails, { hostCode: 'ENOENT' })

  // 4. filesystem.openItem / system.openUrl 透传
  const openFail = await invokeHostCapability(
    'system.openUrl',
    { url: 'https://example.com' },
    {
      shell_open_external: async () => ({
        success: false,
        error: { code: 'SHELL_ERROR', message: '无法打开链接', details: { hostCode: 'OPEN_FAIL' } }
      })
    }
  )
  assert.equal(openFail.ok, false)
  assert.equal(openFail.errorCode, 'SHELL_ERROR')
  assert.deepEqual(openFail.errorDetails, { hostCode: 'OPEN_FAIL' })

  // 5. 默认 callHostTransport 通道失败透传
  const defaultCapFail = await invokeHostCapability(
    'screen.capture',
    {},
    {
      transport: {
        call: async () => ({
          success: false,
          error: { code: 'SCREEN_ERROR', message: '截屏失败', details: { hostCode: 'NO_DISPLAY' } }
        })
      }
    }
  )
  assert.equal(defaultCapFail.ok, false)
  assert.equal(defaultCapFail.errorCode, 'SCREEN_ERROR')
  assert.deepEqual(defaultCapFail.errorDetails, { hostCode: 'NO_DISPLAY' })

  // 6. invokePluginService: hostOverride.plugin_invoke 失败透传
  const pluginInvokeFail = await invokePluginService(
    'SqlitePlugin',
    'execute',
    {},
    {
      plugin_invoke: async () => ({
        success: false,
        error: { code: 'DATABASE_LOCKED', message: '数据库锁死', details: { hostCode: 'SQLITE_BUSY' } }
      })
    }
  )
  assert.equal(pluginInvokeFail.ok, false)
  assert.equal(pluginInvokeFail.errorCode, 'DATABASE_LOCKED')
  assert.deepEqual(pluginInvokeFail.errorDetails, { hostCode: 'SQLITE_BUSY' })

  // 7. invokePluginService: 旧版 globalThis.ztools.dllplugin.call 返回 ok: false 透传
  globalThis.ztools = {
    dllplugin: {
      call: async () => ({
        ok: false,
        error: '权限受限',
        code: 'PERMISSION_DENIED',
        details: { hostCode: 'LEGACY_DENY' }
      })
    }
  }
  const legacyReturnFail = await invokePluginService('LegacyPlugin', 'exec', {})
  assert.equal(legacyReturnFail.ok, false)
  assert.equal(legacyReturnFail.errorCode, 'PERMISSION_DENIED')
  assert.deepEqual(legacyReturnFail.errorDetails, { hostCode: 'LEGACY_DENY' })

  // 8. invokePluginService: 旧版 globalThis.ztools.dllplugin.call 抛错透传
  globalThis.ztools = {
    dllplugin: {
      call: async () => {
        throw Object.assign(new Error('服务不可用'), {
          errorCode: 'SERVICE_UNAVAILABLE',
          errorDetails: { hostCode: 'SVC_DOWN' }
        })
      }
    }
  }
  const legacyThrowFail = await invokePluginService('LegacyPlugin', 'exec', {})
  assert.equal(legacyThrowFail.ok, false)
  assert.equal(legacyThrowFail.errorCode, 'SERVICE_UNAVAILABLE')
  assert.deepEqual(legacyThrowFail.errorDetails, { hostCode: 'SVC_DOWN' })
})
