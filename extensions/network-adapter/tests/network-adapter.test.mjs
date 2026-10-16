import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
  parseIpconfigAll,
  getSampleAdapters
} from '../dist/logic.js'

const require = createRequire(import.meta.url)
const Command = require('../dist/index.js').default

test('NetworkAdapter 声明式视图渲染与 Shell 故障注入测试', async () => {
  // 注入模拟宿主故障 (shell.exec 抛出异常)
  globalThis.ztools = {
    shell: {
      exec: async () => {
        throw new Error('SHELL_EXEC_TIMEOUT_OR_CRASH')
      }
    }
  }
  try {
    const view = Command()
    assert.ok(view, '应返回声明式视图描述符')
    assert.equal(view.type, 'List')
    const section = view.children[0]
    assert.equal(section.type, 'List.Section')
    assert.ok(section.children.length >= 3, '故障回退下仍应渲染预设网卡列表项')
    const firstItem = section.children[0]
    assert.equal(firstItem.type, 'List.Item')
    assert.ok(firstItem.props.actions, '每个列表项必须挂载 ActionPanel')
  } finally {
    delete globalThis.ztools
  }
})

test('NetworkAdapter 集成解析测试 - 中文 ipconfig 输出', () => {
  const sample = `
Windows IP 配置

无线局域网适配器 WLAN:

   连接特定的 DNS 后缀 . . . . . . . : 
   描述. . . . . . . . . . . . . . . : Intel(R) Wi-Fi 6 AX201 160MHz
   物理地址. . . . . . . . . . . . . : B4-2E-99-88-77-66
   DHCP 已启用 . . . . . . . . . . . : 是
   IPv4 地址 . . . . . . . . . . . . : 192.168.1.108(首选) 
   子网掩码  . . . . . . . . . . . . : 255.255.255.0
   默认网关. . . . . . . . . . . . . : 192.168.1.1

以太网适配器 以太网:

   媒体状态  . . . . . . . . . . . . : 媒体已断开
   连接特定的 DNS 后缀 . . . . . . . : 
   描述. . . . . . . . . . . . . . . : Realtek Gaming 2.5GbE Family Controller
   物理地址. . . . . . . . . . . . . : 58-11-22-33-44-55
`

  const adapters = parseIpconfigAll(sample)
  assert.equal(adapters.length, 2, '应解析出2个网卡适配器')

  const wlan = adapters.find(a => a.name.includes('WLAN'))
  assert.ok(wlan)
  assert.equal(wlan.ipv4, '192.168.1.108')
  assert.equal(wlan.gateway, '192.168.1.1')
  assert.equal(wlan.status, 'connected')
  assert.equal(wlan.mac, 'B4-2E-99-88-77-66')

  const eth = adapters.find(a => a.name.includes('以太网'))
  assert.ok(eth)
  assert.equal(eth.status, 'disconnected')
  assert.equal(eth.ipv4, '已断开')
})

test('NetworkAdapter 破坏性与异常边界测试', () => {
  // 1. 空输入
  assert.deepEqual(parseIpconfigAll(''), [])
  // @ts-ignore
  assert.deepEqual(parseIpconfigAll(null), [])

  // 2. 无网卡无关文本
  assert.deepEqual(parseIpconfigAll('hello world\nsome error occurred'), [])

  // 3. 样例数据验证
  const samples = getSampleAdapters()
  assert.ok(samples.length >= 3)
  assert.ok(samples.some(s => s.status === 'connected'))
  assert.ok(samples.some(s => s.status === 'disconnected'))
})
