// 结束进程改用宿主 process_terminate_pid 的集成测试：真实声明式运行时 + 真实 SDK terminateProcess（参数校验、宿主注入）
// + 按宿主语义模拟的进程表（保护名单、pid 复用、超时不自动升级、无权限、进程已退出），含故障注入与旧宿主回落。
import test from 'node:test'
import assert from 'node:assert/strict'
import { getDeclarativeBridge, ZToolsHostError } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import ProcessMonitorCommand, { terminateProcess, describeTerminateError } from '../dist/index.js'

const host = createHost()
const bridge = getDeclarativeBridge()
const originalConfirm = bridge.confirmAlert

const BASE = [
  { pid: 5003, name: 'Google Chrome', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', cpuUsage: 80, memoryUsage: 400e6 },
  { pid: 6100, name: 'stubborn', path: '/usr/local/bin/stubborn', cpuUsage: 1, memoryUsage: 10e6 },
  { pid: 6200, name: 'ZTools Helper (GPU)', path: '/Applications/ZTools.app/Contents/Frameworks/ZTools Helper (GPU).app', cpuUsage: 2, memoryUsage: 80e6 },
  { pid: 6300, name: 'sshd', path: '/usr/sbin/sshd', cpuUsage: 0, memoryUsage: 5e6 },
  { pid: 6400, path: '', cpuUsage: 0, memoryUsage: 1e6 }
]

test.beforeEach(() => {
  bridge.confirmAlert = originalConfirm
  delete bridge.terminateProcess
})

/**
 * 进程表 + 宿主结束进程替身（与前端注入的插件实现同形，失败抛 ZToolsHostError）：
 * ignoreTerm 中的 pid 对正常退出不响应；protectedPids 命中保护名单；denied 无权限；renamed 表示 pid 已被别的程序复用
 */
function installHost({ ignoreTerm = [], protectedPids = {}, denied = [], renamed = {}, fail = null } = {}) {
  host.reset()
  const procs = BASE.map((p) => ({ ...p }))
  const calls = []
  host.ipc.process_list = async () => procs
  host.ipc.system_get_memory_usage = async () => ({ total: 16e9, used: 9e9, available: 7e9, percent: 56 })
  host.ipc.system_get_hardware_summary = async () => ({ logicalCpuCount: 8, totalMemory: 16e9 })
  host.ipc.system_get_cpu_usage = async () => ({ total: 20 })
  host.ipc.process_kill = async () => {
    throw Object.assign(new Error('只能管理当前窗口启动的进程'), { code: 'PERMISSION_DENIED' })
  }
  bridge.terminateProcess = async (pid, options) => {
    calls.push({ pid, ...options })
    if (fail) throw fail
    const idx = procs.findIndex((p) => p.pid === pid)
    if (idx < 0) throw new ZToolsHostError('PROCESS_NOT_FOUND', '进程不存在')
    if (protectedPids[pid]) throw new ZToolsHostError('PROCESS_PROTECTED', '受保护', { reason: protectedPids[pid], pid })
    if (denied.includes(pid)) throw new ZToolsHostError('PROCESS_ACCESS_DENIED', 'EPERM')
    const current = renamed[pid] || procs[idx].name || ''
    if (options.expectedName !== undefined && options.expectedName.toLowerCase() !== current.toLowerCase()) {
      throw new ZToolsHostError('PROCESS_IDENTITY_MISMATCH', '进程已变化')
    }
    if (options.mode === 'graceful' && ignoreTerm.includes(pid)) {
      throw new ZToolsHostError('PROCESS_TERMINATE_TIMEOUT', '超时', { stillRunning: [pid] })
    }
    procs.splice(idx, 1)
    return { pid, mode: options.mode, tree: !!options.tree, terminated: [pid] }
  }
  return { procs, calls }
}

function answerConfirms(...answers) {
  bridge.confirmAlert = async (options) => {
    host.confirms.push(options)
    return answers.length ? answers.shift() : false
  }
}

const itemByPid = (view, pid) => view.item(String(pid))
const hasItem = (view, pid) => view.items().some((it) => it.props.id === String(pid))
const legacyIpc = () => host.ipcCalls.filter(([m]) => m === 'process_kill' || m === 'dllplugin_call').map(([m]) => m)
const settle = () => tick(20)

test('三种结束方式分别映射为 force / force+tree / graceful，并带列表里的进程名防 pid 复用；不再调用 process_kill 与 DLL', async () => {
  for (const [action, expected] of [
    ['结束进程', { mode: 'force', tree: false }],
    ['强制结束进程树', { mode: 'force', tree: true }],
    ['平缓关闭进程 (Graceful)', { mode: 'graceful', tree: false }]
  ]) {
    const { calls } = installHost()
    const view = await mount(ProcessMonitorCommand, host)
    await settle()
    await view.run(itemByPid(view, 5003), action)
    await settle()
    assert.equal(host.confirms.length, 1, `${action} 必须先确认`)
    assert.doesNotMatch(host.confirms[0].title, /taskkill/, '确认文案不再写死 Windows 命令')
    assert.deepEqual(calls, [{ pid: 5003, ...expected, expectedName: 'Google Chrome' }], action)
    assert.equal(host.lastToast().title, '进程已成功终止')
    assert.equal(hasItem(view, 5003), false, '结束后从列表移除')
    assert.deepEqual(legacyIpc().filter((m) => m === 'process_kill'), [])
    view.unmount()
  }
})

test('取消确认：不调用宿主结束进程', async () => {
  const { calls } = installHost()
  host.setConfirm(false)
  const view = await mount(ProcessMonitorCommand, host)
  await settle()
  await view.run(itemByPid(view, 5003), '结束进程')
  await settle()
  assert.deepEqual(calls, [])
  assert.ok(hasItem(view, 5003))
  view.unmount()
})

test('平缓关闭超时：不自动强制；再次确认取消 → 提示进程仍在运行；确认 → 才发 force', async () => {
  {
    const { calls } = installHost({ ignoreTerm: [6100] })
    answerConfirms(true, false)
    const view = await mount(ProcessMonitorCommand, host)
    await settle()
    await view.run(itemByPid(view, 6100), '平缓关闭进程 (Graceful)')
    await settle()
    assert.equal(host.confirms.length, 2)
    assert.match(host.confirms[1].title, /stubborn \(PID: 6100\) 没有响应平缓关闭/)
    assert.match(host.confirms[1].message, /仍在运行：PID 6100/)
    assert.deepEqual(calls.map((c) => c.mode), ['graceful'])
    assert.equal(host.lastToast().title, '进程仍在运行')
    assert.ok(hasItem(view, 6100))
    view.unmount()
  }
  {
    const { calls } = installHost({ ignoreTerm: [6100] })
    answerConfirms(true, true)
    const view = await mount(ProcessMonitorCommand, host)
    await settle()
    await view.run(itemByPid(view, 6100), '平缓关闭进程 (Graceful)')
    await settle()
    assert.deepEqual(calls.map((c) => `${c.mode}:${c.tree}`), ['graceful:false', 'force:false'])
    assert.equal(host.lastToast().title, '进程已成功终止')
    assert.equal(hasItem(view, 6100), false)
    view.unmount()
  }
})

test('[故障注入] 宿主拒绝：ZTools 内部进程 / 无权限 / pid 已被复用 / 缺少权限声明 / IPC 异常 —— 如实提示，列表不变，不弹强制确认', async () => {
  const cases = [
    [{ protectedPids: { 6200: 'host-child' } }, 6200, /ZTools 的内部进程/],
    [{ denied: [6300] }, 6300, /没有权限结束该进程/],
    [{ renamed: { 5003: 'evil' } }, 5003, /被复用/],
    [{ fail: new ZToolsHostError('PLUGIN_PERMISSION_REQUIRED', 'x', { permission: 'process' }) }, 5003, /没有声明结束进程权限/],
    [{ fail: new ZToolsHostError('PLUGIN_IDENTITY_REQUIRED', 'x') }, 5003, /无法确认插件身份/],
    [{ fail: new Error('IPC 管道已断开') }, 5003, /^IPC 管道已断开$/]
  ]
  for (const [options, pid, expected] of cases) {
    const { calls } = installHost(options)
    const view = await mount(ProcessMonitorCommand, host)
    await settle()
    await view.run(itemByPid(view, pid), '结束进程')
    await settle()
    assert.equal(calls.length, 1)
    assert.equal(host.confirms.length, 1)
    assert.equal(host.lastToast().title, '终止失败')
    assert.match(host.lastToast().message, expected)
    assert.ok(hasItem(view, pid))
    view.unmount()
  }
})

test('确认期间进程已自行退出（PROCESS_NOT_FOUND）：提示已经退出并移出列表，不报失败', async () => {
  const { procs, calls } = installHost()
  bridge.confirmAlert = async (options) => {
    host.confirms.push(options)
    procs.splice(procs.findIndex((p) => p.pid === 5003), 1)
    return true
  }
  const view = await mount(ProcessMonitorCommand, host)
  await settle()
  await view.run(itemByPid(view, 5003), '结束进程')
  await settle()
  assert.equal(calls.length, 1)
  assert.equal(host.lastToast().title, '进程已经退出')
  assert.equal(hasItem(view, 5003), false)
  view.unmount()
})

test('列表里没有进程名的进程（显示为 PID-<pid>）不传 expectedName，避免误拒', async () => {
  const { calls } = installHost()
  const view = await mount(ProcessMonitorCommand, host)
  await settle()
  await view.run(itemByPid(view, 6400), '结束进程')
  await settle()
  assert.deepEqual(calls, [{ pid: 6400, mode: 'force', tree: false }])
  view.unmount()
})

test('[时序] 连按结束：确认框未关闭前不会重复弹出或重复结束', async () => {
  const { calls } = installHost()
  let release
  bridge.confirmAlert = (options) => {
    host.confirms.push(options)
    return new Promise((resolve) => (release = () => resolve(true)))
  }
  const view = await mount(ProcessMonitorCommand, host)
  await settle()
  const action = view.actions(itemByPid(view, 5003)).find((a) => a.props.title === '结束进程')
  const first = action.props.onAction()
  await action.props.onAction()
  await tick(5)
  assert.equal(host.confirms.length, 1)
  release()
  await first
  await settle()
  assert.equal(calls.length, 1)
  view.unmount()
})

test('宿主过旧（没有结束进程接口）：回落到旧的 DLL / process_kill 路径，失败如实提示，不假装成功', async () => {
  installHost()
  delete bridge.terminateProcess
  const view = await mount(ProcessMonitorCommand, host)
  await settle()
  await view.run(itemByPid(view, 5003), '结束进程')
  await settle()
  assert.ok(legacyIpc().includes('process_kill'), '老宿主仍尝试旧路径')
  assert.equal(host.lastToast().title, '终止失败')
  // 旧路径先试 DLL（测试宿主与 macOS 老宿主都不支持），再试 process_kill（只能结束自身子进程）：都失败时报 DLL 的原因
  assert.match(host.lastToast().message, /dllplugin_call/)
  assert.ok(!host.toasts.some((t) => t.title === '进程已成功终止'))
  assert.ok(hasItem(view, 5003))
  view.unmount()
})

test('terminateProcess 直接调用：经真实 SDK 校验非法 pid；错误码说明覆盖未知原因与非 Error 值', async () => {
  installHost()
  bridge.terminateProcess = async () => assert.fail('非法 pid 不应到达宿主')
  const res = await terminateProcess(1.5, 'x', 'force')
  assert.equal(res.ok, false)
  const huge = await terminateProcess(2 ** 33, 'x', 'graceful')
  assert.equal(huge.ok, false)
  assert.equal(huge.code, 'INVALID_REQUEST')
  assert.equal(huge.canForce, false)
  assert.deepEqual(describeTerminateError(new ZToolsHostError('PROCESS_PROTECTED', 'x', { reason: '??' })), {
    code: 'PROCESS_PROTECTED',
    message: '该进程受保护，不能结束'
  })
  assert.deepEqual(describeTerminateError(42), { code: 'PROCESS_ERROR', message: '42' })
  assert.match(describeTerminateError(new ZToolsHostError('HOST_FEATURE_UNAVAILABLE', 'x')).message, /请升级 ZTools/)
})
