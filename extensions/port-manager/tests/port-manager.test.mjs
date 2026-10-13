import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseNetstatOutput,
  isProtectedPid,
  getCommonProcessName
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
  assert.equal(isProtectedPid(1000), false, '普通 PID 不受保护')
  assert.equal(isProtectedPid(-1), false)
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
