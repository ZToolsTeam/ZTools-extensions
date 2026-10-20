// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout1-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchNetworkAdapters,
  applyDnsPreset,
  flushSystemDnsCache,
  invokeNativeCapability as invokeNetworkAdapterCapability
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

test('P02 network-adapter: 真实网卡列表聚合、DNS 预设切换与无管理员权限异常断言', async () => {
  const mockHost = {
    dllplugin_call: async ({ func, params }) => {
      if (func === 'getAdapters') {
        return {
          ok: true,
          adapters: [
            {
              id: 'nic-real-eth0',
              name: 'Ethernet 2',
              description: 'Intel I225-V',
              status: 'up',
              ipv4: '192.168.50.10',
              netmask: '255.255.255.0',
              gateway: '192.168.50.1',
              mac: 'AA-BB-CC-DD-EE-FF',
              dnsServers: ['192.168.50.1'],
              speedMbps: 2500
            }
          ]
        }
      }
      if (func === 'applyDnsPreset') {
        if (params.name === 'Restricted-NIC') {
          return { ok: false, error: '拒绝访问：需要管理员权限执行 netsh' }
        }
        return { ok: true, message: 'DNS 已更新' }
      }
      if (func === 'flushDns') {
        return { ok: true, message: '已成功刷新 DNS 解析缓存' }
      }
      return { ok: false, error: '未知方法' }
    }
  }

  const snap = await fetchNetworkAdapters(mockHost)
  assert.equal(snap.adapters.length, 1)
  assert.equal(snap.adapters[0].name, 'Ethernet 2')
  assert.equal(snap.primaryIpv4, '192.168.50.10')

  // 正常切换 DNS 预设
  const okDns = await applyDnsPreset('Ethernet 2', '223.5.5.5', '119.29.29.29', mockHost)
  assert.equal(okDns.ok, true)
  assert.deepEqual(okDns.dnsServers, ['223.5.5.5', '119.29.29.29'])

  // 异常场景 1：非法 DNS IPv4 格式拦截
  const badIp = await applyDnsPreset('Ethernet 2', '999.999.1.1', '', mockHost)
  assert.equal(badIp.ok, false)
  assert.match(badIp.message, /格式不合法/)

  // 异常场景 2：空网卡名称拦截
  const emptyNic = await applyDnsPreset('', '223.5.5.5', '', mockHost)
  assert.equal(emptyNic.ok, false)

  // 异常场景 3：无管理员权限时宿主返回失败，严禁伪造 ok: true
  const deniedDns = await applyDnsPreset('Restricted-NIC', '223.5.5.5', '1.1.1.1', mockHost)
  assert.equal(deniedDns.ok, false)
  assert.match(deniedDns.message, /管理员权限/)

  // 异常场景 4：flushSystemDnsCache 当宿主失败时返回 ok: false
  const failFlush = await flushSystemDnsCache({
    dllplugin_call: async () => ({ ok: false, error: 'DNS Client 服务未运行' }),
    shell_exec: async () => {
      throw new Error('DNS Client 服务未运行')
    }
  })
  assert.equal(failFlush.ok, false)
  assert.match(failFlush.message, /DNS Client 服务未运行/)
})
