// 释放端口（结束占用进程）的集成测试：真实声明式运行时 + 真实 SDK terminateProcess（参数校验、宿主注入）
// + 按宿主 process_terminate_pid 语义模拟的进程表（保护名单、超时、无权限、进程已退出等错误码），含故障注入。
// 覆盖：不绑剪切键、必须确认、只发正常结束、超时后再次确认才强制、宿主错误如实提示、宿主过旧、连按不重复执行
import test from 'node:test'
import assert from 'node:assert/strict'
import { getDeclarativeBridge, ZToolsHostError } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import PortManagerCommand from '../dist/index.js'
import { terminatePid, getTerminateBlockReason, describeTerminateError } from '../dist/logic.js'

const host = createHost()
const bridge = getDeclarativeBridge()
const originalConfirm = bridge.confirmAlert
const KILL_TITLE = '终止占用进程 (释放端口)'

test.beforeEach(() => {
  host.reset()
  bridge.confirmAlert = originalConfirm
  delete bridge.terminateProcess
})

/**
 * 按宿主语义模拟：process_list_ports 读进程表；terminateProcess 与前端注入的插件实现同形（宿主错误抛 ZToolsHostError）。
 * ignoreTerm：对正常结束不响应（宿主超时返回 PROCESS_TERMINATE_TIMEOUT，不自动升级 force）；fail：注入宿主错误
 */
function installProcessHost(procs, { ignoreTerm = new Set(), fail = null, gate = null } = {}) {
  const calls = []
  host.ipc.process_list_ports = async () =>
    procs.map((p) => ({ protocol: 'TCP', localAddress: '127.0.0.1', localPort: p.port, state: 'LISTEN', pid: p.pid, processName: p.name }))
  bridge.terminateProcess = async (pid, options) => {
    calls.push({ pid, ...options })
    if (gate) await gate
    if (fail) throw typeof fail === 'function' ? fail(pid, options) : fail
    const idx = procs.findIndex((p) => p.pid === pid)
    if (idx < 0) throw new ZToolsHostError('PROCESS_NOT_FOUND', '进程不存在')
    if (options.mode === 'graceful' && ignoreTerm.has(pid)) {
      throw new ZToolsHostError('PROCESS_TERMINATE_TIMEOUT', '进程未在 3000ms 内退出', { stillRunning: [pid] })
    }
    procs.splice(idx, 1)
    return { pid, mode: options.mode, tree: false, terminated: [pid] }
  }
  return calls
}

/** 依次回答确认框（第一次结束确认、第二次强制结束确认） */
function answerConfirms(...answers) {
  bridge.confirmAlert = async (options) => {
    host.confirms.push(options)
    return answers.length ? answers.shift() : false
  }
}

const legacyIpc = () => host.ipcCalls.filter(([m]) => m === 'process_kill' || m === 'process_exists')

test('结束进程动作不绑定 ⌘X / Ctrl+X 等任何快捷键，且标为破坏性动作', async () => {
  installProcessHost([{ pid: 4321, port: 3000, name: 'node' }])
  const view = await mount(PortManagerCommand)
  const action = view.actions(view.item(() => true)).find((a) => a.props.title === KILL_TITLE)
  assert.ok(action, '动作面板里仍可选择结束进程')
  assert.equal(action.props.shortcut, undefined, '破坏性动作不能绑在剪切键上')
  assert.equal(action.props.style, 'destructive')
  view.unmount()
})

test('确认后只请求正常结束（graceful），退出即成功并刷新列表；不再走只能结束自身子进程的 process_kill', async () => {
  const procs = [{ pid: 4321, port: 3000, name: 'node' }]
  const calls = installProcessHost(procs)
  const view = await mount(PortManagerCommand)
  await view.run(view.item(() => true), KILL_TITLE)
  await tick(20)
  assert.equal(host.confirms.length, 1, '必须先弹确认')
  assert.match(host.confirms[0].title, /node \(PID 4321\)/)
  assert.equal(host.confirms[0].primaryAction.style, 'destructive')
  assert.deepEqual(calls, [{ pid: 4321, mode: 'graceful' }], '只发正常结束，不传 expectedName（netstat 进程名会截断）')
  assert.equal(host.lastToast().title, '已结束占用 :3000 的进程')
  assert.doesNotMatch(host.lastToast().message, /强制/)
  assert.equal(view.items().length, 0, '刷新后端口消失')
  assert.deepEqual(legacyIpc(), [])
  view.unmount()
})

test('用户取消确认：不调用宿主结束进程，列表保持不变', async () => {
  const calls = installProcessHost([{ pid: 4321, port: 3000, name: 'node' }])
  host.setConfirm(false)
  const view = await mount(PortManagerCommand)
  await view.run(view.item(() => true), KILL_TITLE)
  await tick(20)
  assert.equal(host.confirms.length, 1)
  assert.deepEqual(calls, [])
  assert.equal(view.items().length, 1)
  view.unmount()
})

test('进程不响应正常结束：不自动强制，再次确认时取消 → 只发过一次 graceful，提示端口未释放', async () => {
  const procs = [{ pid: 777, port: 8080, name: 'stubborn' }]
  const calls = installProcessHost(procs, { ignoreTerm: new Set([777]) })
  answerConfirms(true, false)
  const view = await mount(PortManagerCommand)
  await view.run(view.item(() => true), KILL_TITLE)
  await tick(20)
  assert.equal(host.confirms.length, 2, '超时后再次询问是否强制结束')
  assert.match(host.confirms[1].title, /stubborn \(PID 777\) 没有响应/)
  assert.match(host.confirms[1].message, /仍在运行：PID 777/)
  assert.equal(host.confirms[1].primaryAction.title, '强制结束')
  assert.deepEqual(calls.map((c) => c.mode), ['graceful'])
  assert.equal(host.lastToast().title, '端口未释放')
  assert.equal(view.items().length, 1, '进程仍在，列表不变')
  view.unmount()
})

test('进程不响应正常结束：再次确认后才强制结束（force），成功提示「强制」', async () => {
  const procs = [{ pid: 777, port: 8080, name: 'stubborn' }]
  const calls = installProcessHost(procs, { ignoreTerm: new Set([777]) })
  answerConfirms(true, true)
  const view = await mount(PortManagerCommand)
  await view.run(view.item(() => true), KILL_TITLE)
  await tick(20)
  assert.deepEqual(calls, [{ pid: 777, mode: 'graceful' }, { pid: 777, mode: 'force' }])
  assert.match(host.lastToast().message, /已强制结束 stubborn/)
  assert.equal(view.items().length, 0)
  view.unmount()
})

test('[故障注入] 强制结束仍超时：如实提示仍在运行的 PID，不提示成功', async () => {
  const calls = installProcessHost([{ pid: 778, port: 8081, name: 'zombie-ish' }], {
    fail: (pid) => new ZToolsHostError('PROCESS_TERMINATE_TIMEOUT', '超时', { stillRunning: [pid, 'x', 9001] })
  })
  answerConfirms(true, true)
  const view = await mount(PortManagerCommand)
  await view.run(view.item(() => true), KILL_TITLE)
  await tick(20)
  assert.deepEqual(calls.map((c) => c.mode), ['graceful', 'force'])
  assert.equal(host.lastToast().title, '释放端口失败')
  assert.equal(host.lastToast().message, '进程没有在限定时间内退出（仍在运行：PID 778, 9001）', '只展示合法 pid')
  assert.equal(view.items().length, 1)
  view.unmount()
})

test('[故障注入] 宿主拒绝（受保护 / 无权限 / 缺少权限声明 / 身份未确认 / pid 复用 / 普通异常）：如实提示，只调用一次，不强制重试', async () => {
  const cases = [
    [new ZToolsHostError('PROCESS_PROTECTED', 'x', { reason: 'host-ancestor', pid: 4321 }), /启动 ZTools 的上级进程/],
    [new ZToolsHostError('PROCESS_PROTECTED', 'x', { reason: 'host-child', pid: 4321 }), /ZTools 的内部进程/],
    [new ZToolsHostError('PROCESS_PROTECTED', 'x', { reason: 'host-self', pid: 4321 }), /ZTools 自身的进程/],
    [new ZToolsHostError('PROCESS_PROTECTED', 'x', { reason: 'system', pid: 4321 }), /系统关键进程/],
    [new ZToolsHostError('PROCESS_PROTECTED', 'x', { reason: '??' }), /该进程受保护/],
    [new ZToolsHostError('PROCESS_ACCESS_DENIED', 'EPERM'), /没有权限结束该进程/],
    [new ZToolsHostError('PLUGIN_PERMISSION_REQUIRED', 'x', { permission: 'process' }), /没有声明结束进程权限/],
    [new ZToolsHostError('PLUGIN_IDENTITY_REQUIRED', 'x'), /无法确认插件身份/],
    [new ZToolsHostError('PROCESS_IDENTITY_MISMATCH', 'x'), /被复用/],
    [new ZToolsHostError('REQUEST_TIMEOUT', '调用超时'), /^调用超时$/],
    [new Error('IPC 管道已断开'), /^IPC 管道已断开$/]
  ]
  for (const [error, expected] of cases) {
    host.reset()
    const calls = installProcessHost([{ pid: 4321, port: 3000, name: 'node' }], { fail: error })
    const view = await mount(PortManagerCommand)
    await view.run(view.item(() => true), KILL_TITLE)
    await tick(20)
    assert.equal(calls.length, 1, `${error.code || error.message} 只调用一次`)
    assert.equal(host.confirms.length, 1, '不弹强制结束确认')
    assert.equal(host.lastToast().title, '释放端口失败')
    assert.match(host.lastToast().message, expected)
    assert.equal(view.items().length, 1)
    view.unmount()
  }
})

test('确认期间进程已自行退出（PROCESS_NOT_FOUND）：按已退出提示并刷新，不报失败', async () => {
  const procs = [{ pid: 4321, port: 3000, name: 'node' }]
  const calls = installProcessHost(procs)
  bridge.confirmAlert = async (options) => {
    host.confirms.push(options)
    procs.length = 0
    return true
  }
  const view = await mount(PortManagerCommand)
  await view.run(view.item(() => true), KILL_TITLE)
  await tick(20)
  assert.equal(calls.length, 1)
  assert.equal(host.lastToast().title, 'node 已经退出')
  assert.equal(view.items().length, 0)
  view.unmount()
})

test('宿主过旧（没有结束进程接口）：提示升级 ZTools，不回落到 process_kill', async () => {
  installProcessHost([{ pid: 4321, port: 3000, name: 'node' }])
  delete bridge.terminateProcess
  const view = await mount(PortManagerCommand)
  await view.run(view.item(() => true), KILL_TITLE)
  await tick(20)
  assert.equal(host.lastToast().title, '释放端口失败')
  assert.match(host.lastToast().message, /请升级 ZTools/)
  assert.deepEqual(legacyIpc(), [])
  view.unmount()
})

test('系统关键进程（launchd PID 1、Windows System PID 4、PID 0）与 ZTools 自身：不弹确认、不调用宿主', async () => {
  for (const proc of [
    { pid: 1, port: 49152, name: 'launchd' },
    { pid: 4, port: 445, name: 'System' },
    { pid: 0, port: 137, name: 'kernel' },
    { pid: 52111, port: 9222, name: 'ZTools' },
    { pid: 52112, port: 19343, name: 'ZTools Helper (Renderer)' },
    { pid: 8800, port: 47000, name: 'ZTools.exe' }
  ]) {
    host.reset()
    const calls = installProcessHost([proc])
    const view = await mount(PortManagerCommand)
    await view.run(view.item(() => true), KILL_TITLE)
    await tick(10)
    assert.equal(host.confirms.length, 0, `${proc.name} 不应弹确认`)
    assert.deepEqual(calls, [], `${proc.name} 不应被结束`)
    assert.equal(host.lastToast().title, '不能结束该进程')
    view.unmount()
  }
  assert.equal(getTerminateBlockReason({ pid: 3000, processName: 'node' }), null)
  assert.equal(getTerminateBlockReason({ pid: 3000, processName: 'ZToolsLike' }), null, '只匹配 ZTools 本身的进程名')
})

test('[时序] 连按两次、以及等待宿主结束期间再按：都不会重复确认或重复结束', async () => {
  let release
  const gate = new Promise((resolve) => (release = resolve))
  const calls = installProcessHost([{ pid: 4321, port: 3000, name: 'node' }], { gate })
  const view = await mount(PortManagerCommand)
  const action = view.actions(view.item(() => true)).find((a) => a.props.title === KILL_TITLE)
  const first = action.props.onAction()
  await action.props.onAction()
  await tick(10)
  // 宿主仍在等待进程退出时再按一次
  await action.props.onAction()
  assert.equal(host.confirms.length, 1)
  assert.equal(calls.length, 1)
  release()
  await first
  await tick(20)
  assert.equal(calls.length, 1)
  assert.equal(view.items().length, 0)
  // 流程结束后可以再次发起
  await action.props.onAction()
  assert.equal(host.confirms.length, 2)
  view.unmount()
})

test('terminatePid 直接调用：注入的结束函数决定结果；非法 pid 经真实 SDK 校验被拒', async () => {
  assert.deepEqual(await terminatePid(9, 'graceful', async () => ({ pid: 9, mode: 'graceful', tree: false, terminated: [9] })), {
    ok: true,
    forced: false,
    alreadyExited: false
  })
  const timeout = await terminatePid(9, 'force', async () => {
    throw new ZToolsHostError('PROCESS_TERMINATE_TIMEOUT', 't')
  })
  assert.equal(timeout.ok, false)
  assert.equal(timeout.canForce, false, '强制结束超时不再提供强制选项')
  // 使用默认的 SDK terminateProcess：pid 校验在宿主调用之前
  bridge.terminateProcess = async () => assert.fail('非法 pid 不应到达宿主')
  const invalid = await terminatePid(1.5, 'graceful')
  assert.equal(invalid.ok, false)
  assert.equal(invalid.code, 'INVALID_REQUEST')
  assert.deepEqual(describeTerminateError('字符串错误'), { code: 'PROCESS_ERROR', message: '字符串错误' })
})
