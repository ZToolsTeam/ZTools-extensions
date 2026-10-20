// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout1-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchWeChatMultiSnapshot,
  launchNewWeChatInstance,
  terminateWechatInstance
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

test('P05 wechat-multi: 无微信运行时零假进程断言与未安装微信时启动失败断言', async () => {
  // 场景 1：本机未运行任何微信进程时，绝不能注入 wxid_geek_primary (PID 18420) 等假进程
  const emptyHost = {
    dllplugin_call: async ({ func }) => {
      if (func === 'getStatus') {
        return {
          ok: true,
          installed: false,
          installPath: '',
          instances: []
        }
      }
      return { ok: false, error: '未安装微信' }
    }
  }

  const snap = await fetchWeChatMultiSnapshot(emptyHost)
  assert.equal(snap.mainInstanceCount, 0)
  assert.equal(snap.appletCount, 0)
  assert.equal(snap.items.some((i) => i.pid === 18420 || i.dataDir.includes('wxid_geek_primary')), false)

  // 场景 2：本机未安装微信时调用 launchNewWeChatInstance 必须返回 ok: false，绝不伪造成功或随机 PID
  const failLaunch = await launchNewWeChatInstance(1, {
    dllplugin_call: async () => ({ ok: false, error: '未检测到 WeChat.exe 或 Weixin.exe 安装路径' }),
    process_start: async () => {
      throw new Error('文件不存在')
    },
    shell_open_path: async () => {
      throw new Error('文件不存在')
    }
  })
  assert.equal(failLaunch.ok, false)
  assert.equal(failLaunch.launchedCount, 0)
  assert.match(failLaunch.message, /未检测到|文件不存在/)

  // 场景 3：无效 PID 终止进程拦截
  const badKill = await terminateWechatInstance(-10, emptyHost)
  assert.equal(badKill.ok, false)
})
