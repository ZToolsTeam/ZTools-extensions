// 本插件的宿主集成测试（导入本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import { setDeclarativeBridge } from '@ztools/declarative-ui'
import FlowGuardCommand, {
  NOT_IN_CLIENT_MESSAGE,
  fetchFlowGuardSnapshot,
  terminateNetworkProcess,
  openNetworkProcessLocation
} from '../dist/index.js'

function withBridge(bridge, fn) {
  setDeclarativeBridge(bridge)
  return Promise.resolve()
    .then(fn)
    .finally(() => setDeclarativeBridge(null))
}

function hostError(code, message) {
  return Object.assign(new Error(message), { name: 'ZToolsHostError', code })
}

const CURL_PORT = {
  protocol: 'TCP',
  localAddress: '192.168.1.50',
  localPort: 52100,
  remoteAddress: '1.1.1.1',
  remotePort: 443,
  state: 'ESTABLISHED',
  pid: 4560,
  processName: 'curl.exe'
}

test('flow-guard: 连接按进程聚合，程序路径取自完整进程快照', async () => {
  const snap = await fetchFlowGuardSnapshot({
    process_list_ports: async () => ({ success: true, data: [CURL_PORT], source: 'windows-netstat' }),
    dllplugin_call: async (p) => {
      assert.equal(p.func, 'GetProcessList')
      return { success: true, data: { processes: [{ pid: 4560, name: 'curl.exe', path: 'C:\\Windows\\System32\\curl.exe' }] } }
    }
  })
  assert.equal(snap.error, undefined)
  assert.equal(snap.groups.length, 1)
  assert.equal(snap.groups[0].pid, 4560)
  assert.equal(snap.groups[0].processPath, 'C:\\Windows\\System32\\curl.exe')
  assert.equal(snap.totalPublic, 1)
})

test('flow-guard: 完整快照不可用时用基础列表，路径不可用就留空', async () => {
  const snap = await fetchFlowGuardSnapshot({
    process_list_ports: async () => [CURL_PORT],
    dllplugin_call: async () => { throw new Error('UNSUPPORTED') },
    process_list: async () => [{ pid: 4560, name: 'curl.exe', path: '', fieldAvailability: { path: false } }]
  })
  assert.equal(snap.groups[0].processPath, '')
})

test('flow-guard: 读取连接失败或不在客户端里时如实报错，不显示示例连接', async () => {
  const failed = await fetchFlowGuardSnapshot({
    process_list_ports: async () => ({ success: false, error: { code: 'PROCESS_ERROR', message: '端口列表无效或未完整返回' } }),
    dllplugin_call: async () => ({ success: true, data: { processes: [] } }),
    process_list: async () => []
  })
  assert.deepEqual(failed.groups, [])
  assert.match(failed.error, /读取连接列表失败/)
  assert.match(failed.error, /端口列表无效/)

  const outside = await fetchFlowGuardSnapshot()
  assert.deepEqual(outside.groups, [])
  assert.equal(outside.error, NOT_IN_CLIENT_MESSAGE)

  const view = FlowGuardCommand()
  assert.equal(view.type, 'List')
  assert.equal(view.props.filterBar.summaryText, NOT_IN_CLIENT_MESSAGE)
})

test('flow-guard: 系统核心进程不能结束，且不调用客户端', async () => {
  let called = 0
  await withBridge({ terminateProcess: async () => { called += 1 } }, async () => {
    assert.equal((await terminateNetworkProcess(4, 'System')).ok, false)
    assert.equal((await terminateNetworkProcess(612, 'csrss.exe')).ok, false)
    assert.equal((await terminateNetworkProcess(900, 'svchost')).ok, false)
  })
  assert.equal(called, 0)
})

test('flow-guard: 结束进程走客户端接口，强制结束并校验进程名', async () => {
  const seen = []
  await withBridge({
    terminateProcess: async (pid, options) => {
      seen.push({ pid, options })
      return { pid, mode: 'force', tree: false, terminated: [pid] }
    }
  }, async () => {
    const res = await terminateNetworkProcess(4560, 'curl.exe')
    assert.equal(res.ok, true)
    const unnamed = await terminateNetworkProcess(4561, 'PID-4561')
    assert.equal(unnamed.ok, true)
  })
  assert.deepEqual(seen[0], { pid: 4560, options: { mode: 'force', expectedName: 'curl.exe' } })
  assert.deepEqual(seen[1].options, { mode: 'force' })
})

test('flow-guard: 结束失败如实报错，进程已退出单独说明', async () => {
  await withBridge({ terminateProcess: async () => { throw hostError('PROCESS_ACCESS_DENIED', 'denied') } }, async () => {
    const res = await terminateNetworkProcess(4560, 'curl.exe')
    assert.equal(res.ok, false)
    assert.match(res.error, /管理员/)
  })
  await withBridge({ terminateProcess: async () => { throw hostError('PROCESS_IDENTITY_MISMATCH', 'mismatch') } }, async () => {
    const res = await terminateNetworkProcess(4560, 'curl.exe')
    assert.equal(res.ok, false)
    assert.match(res.error, /复用/)
  })
  await withBridge({ terminateProcess: async () => { throw hostError('PROCESS_NOT_FOUND', 'gone') } }, async () => {
    const res = await terminateNetworkProcess(4560, 'curl.exe')
    assert.equal(res.ok, true)
    assert.equal(res.alreadyExited, true)
  })
})

test('flow-guard: 旧版客户端接口失败时返回成功外壳也要识别为失败', async () => {
  const legacyFail = { dllplugin_call: async () => ({ success: true, data: { error: 'PROCESS_ACCESS_DENIED: 没有权限' } }) }
  const failed = await terminateNetworkProcess(4560, 'curl.exe', legacyFail)
  assert.equal(failed.ok, false)
  assert.match(failed.error, /没有权限/)

  const legacyOk = { dllplugin_call: async () => ({ success: true, data: { terminated: true, pid: 4560, mode: 'force' } }) }
  assert.equal((await terminateNetworkProcess(4560, 'curl.exe', legacyOk)).ok, true)

  const legacyUnknown = { dllplugin_call: async () => ({ success: true, data: {} }) }
  const unknown = await terminateNetworkProcess(4560, 'curl.exe', legacyUnknown)
  assert.equal(unknown.ok, false, '客户端没有确认结束时不能报成功')

  const outside = await terminateNetworkProcess(4560, 'curl.exe')
  assert.equal(outside.ok, false)
  assert.equal(outside.error, NOT_IN_CLIENT_MESSAGE)
})

test('flow-guard: 定位程序失败或不在客户端里时返回 false', async () => {
  assert.equal(await openNetworkProcessLocation('C:\\Tools\\curl.exe'), false)
  const failing = {
    shell_show_item_in_folder: async () => ({ success: false, error: { message: '未授权' } }),
    shell_open_path: async () => ({ success: false, error: { message: '未授权' } })
  }
  assert.equal(await openNetworkProcessLocation('C:\\Tools\\curl.exe', failing), false)
})
