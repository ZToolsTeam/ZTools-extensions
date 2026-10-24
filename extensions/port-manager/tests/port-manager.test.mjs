import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseNetstatOutput,
  isProtectedPid,
  getCommonProcessName,
  normalizeHostPorts
} from '../dist/logic.js'

test('PortManager 集成与解析测试 - 正常 TCP 与 UDP 条目', () => {
  const sample = `
  活动连接

  协议  本地地址          外部地址        状态           PID
  TCP    0.0.0.0:80             0.0.0.0:0              LISTENING       1000
  TCP    127.0.0.1:3000         0.0.0.0:0              LISTENING       2000
  TCP    192.168.1.5:5432       10.0.0.1:49152        ESTABLISHED     3000
  UDP    0.0.0.0:5353           *:*                                    4000
`
  const records = parseNetstatOutput(sample)
  assert.equal(records.length, 4, '应解析出4条端口记录')

  const port80 = records.find(r => r.localPort === 80)
  assert.ok(port80)
  assert.equal(port80.protocol, 'TCP')
  assert.equal(port80.state, 'LISTENING')
  assert.equal(port80.pid, 1000)
  assert.equal(port80.processName, 'HTTP / Web Service')

  const port3000 = records.find(r => r.localPort === 3000)
  assert.ok(port3000)
  assert.equal(port3000.processName, 'Node.js / React / Next.js')

  const udp = records.find(r => r.protocol === 'UDP')
  assert.ok(udp)
  assert.equal(udp.localPort, 5353)
  assert.equal(udp.pid, 4000)
})

test('PortManager 系统安全保护测试', () => {
  assert.equal(isProtectedPid(0), true, 'PID 0 必须受保护')
  assert.equal(isProtectedPid(4), true, 'PID 4 (System) 必须受保护')
  assert.equal(isProtectedPid(1), true, 'PID 1 (macOS launchd) 必须受保护')
  assert.equal(isProtectedPid(1000), false, '普通 PID 不受保护')
  assert.equal(isProtectedPid(-1), true, '非法 PID 不能当成可结束的进程')
  assert.equal(isProtectedPid(1.5), true)
})

test('PortManager 破坏性与边界异常测试', () => {
  // 1. 空输入
  assert.deepEqual(parseNetstatOutput(''), [])
  // @ts-ignore
  assert.deepEqual(parseNetstatOutput(null), [])
  // @ts-ignore
  assert.deepEqual(parseNetstatOutput(undefined), [])

  // 2. 纯脏数据与乱码
  const dirty = 'some random invalid text\n1234 5678\nTCP invalid:port'
  assert.deepEqual(parseNetstatOutput(dirty), [])

  // 3. 常见端口未知端口映射
  assert.equal(getCommonProcessName(99999), '')
  assert.equal(getCommonProcessName(9222), 'Chrome / Electron CDP')
})

test('PortManager 宿主端口数据整理：只留监听/绑定端口，兼容 Windows 与 macOS 写法', () => {
  const records = normalizeHostPorts([
    { protocol: 'TCP', localAddress: '127.0.0.1', localPort: 5179, state: 'LISTEN', pid: 1344, processName: 'node' },
    { protocol: 'tcp', localAddress: '0.0.0.0', localPort: 80, state: 'LISTENING', pid: 4 },
    { protocol: 'TCP', localAddress: '192.168.1.5', localPort: 49172, remoteAddress: '1.2.3.4', state: 'ESTABLISHED', pid: 1344 },
    { protocol: 'TCP', localAddress: '::1', localPort: 3000, state: 'CLOSE_WAIT', pid: 9 },
    { protocol: 'UDP', localAddress: '*', localPort: 5353, state: 'BOUND', pid: 300, processName: 'mDNSResponder' },
    // 同一端口重复上报只留一条
    { protocol: 'TCP', localAddress: '127.0.0.1', localPort: 5179, state: 'LISTEN', pid: 1344, processName: 'node' }
  ])
  assert.equal(records.length, 3, '已建立连接与 CLOSE_WAIT 不算端口占用，重复项去重')
  const node = records.find(r => r.localPort === 5179)
  assert.equal(node.processName, 'node', '优先用宿主给的进程名')
  assert.equal(node.state, 'LISTENING')
  const http = records.find(r => r.localPort === 80)
  assert.equal(http.processName, 'HTTP / Web Service', '宿主没给进程名时按常见端口推断')
  assert.equal(records.find(r => r.protocol === 'UDP').state, 'BOUND')
})

test('PortManager 宿主端口数据破坏性输入：畸形条目全部丢弃，不抛异常', () => {
  assert.deepEqual(normalizeHostPorts(null), [])
  assert.deepEqual(normalizeHostPorts({ data: [] }), [])
  assert.deepEqual(normalizeHostPorts('TCP 0.0.0.0:80'), [])
  const records = normalizeHostPorts([
    null,
    42,
    'TCP',
    { protocol: 'ICMP', localPort: 1, state: 'LISTEN' },
    { protocol: 'TCP', localPort: 0, state: 'LISTEN' },
    { protocol: 'TCP', localPort: 70000, state: 'LISTEN' },
    { protocol: 'TCP', localPort: '8080abc', state: 'LISTEN' },
    { protocol: 'TCP', localPort: 8080, state: 'LISTEN', pid: -5, processName: { evil: true } }
  ])
  assert.equal(records.length, 1)
  assert.equal(records[0].pid, 0, '非法 PID 归零，不会被当成可结束的进程')
  assert.equal(records[0].processName, 'HTTP / Web Service')
})
