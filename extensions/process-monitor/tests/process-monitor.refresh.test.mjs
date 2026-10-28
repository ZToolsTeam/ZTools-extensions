import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import Command, { portLookup } from '../dist/index.js'

const process = pid => ({ pid, name: `worker-${pid}`, memoryBytes: 30 })
const port = (pid, localPort = 8080) => ({ pid, localPort, protocol: 'TCP', localAddress: '127.0.0.1' })
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function fixture() {
  const host = createHost()
  const reads = { processes: () => [process(100), process(200)], ports: () => [port(100)] }
  const calls = { processes: 0, ports: 0 }
  host.ipc.dllplugin_call = async ({ func }) => {
    if (func === 'GetSystemInfo') return { totalMemoryBytes: 100, availableMemoryBytes: 40, cpuUsagePercent: 7 }
    if (func === 'GetProcessList') { calls.processes++; return { processes: await reads.processes() } }
    return { error: 'unavailable' }
  }
  host.ipc.process_list_ports = async () => { calls.ports++; return { data: await reads.ports() } }
  return { host, reads, calls }
}
async function action(view, id) {
  await view.tree().props.filterBar.actions.find(action => action.id === id).onAction()
  await tick()
}
async function advance(ms = 2000) { mock.timers.tick(ms); await tick() }
const ids = view => view.items().map(item => item.props.id)
test.beforeEach(() => mock.timers.enable({ apis: ['setInterval'] }))
test.afterEach(() => mock.timers.reset())

test('暂停冻结端口和进程的在途快照，手动刷新与恢复仍可更新', async () => {
  const { host, reads, calls } = fixture()
  const view = await mount(portLookup, host)
  try {
    assert.deepEqual(ids(view), ['100'])
    const oldProcesses = deferred(), oldPorts = deferred()
    reads.processes = () => oldProcesses.promise
    reads.ports = () => oldPorts.promise
    await advance()
    await action(view, 'toggle-auto-refresh')
    const pausedCalls = { ...calls }
    await advance(6000)
    assert.deepEqual(calls, pausedCalls)
    oldProcesses.resolve([process(200)])
    oldPorts.resolve([port(200)])
    await tick()
    assert.deepEqual(ids(view), ['100'])
    reads.processes = () => [process(200)]
    reads.ports = () => [port(200)]
    await action(view, 'refresh-list')
    assert.deepEqual(ids(view), ['200'])
    reads.processes = () => [process(100)]
    reads.ports = () => [port(100)]
    await action(view, 'toggle-auto-refresh')
    assert.deepEqual(ids(view), ['100'])
    const resumedCalls = { ...calls }
    await advance()
    assert.equal(calls.ports, resumedCalls.ports + 1)
    assert.equal(calls.processes, resumedCalls.processes + 1)
  } finally { view.unmount() }
})

test('慢端口轮询保持单请求；手动刷新完成后旧请求失败不能清空新结果', async () => {
  const { host, reads, calls } = fixture()
  const view = await mount(portLookup, host)
  try {
    const oldPorts = deferred()
    reads.ports = () => oldPorts.promise
    await advance()
    const pendingCalls = calls.ports
    await advance(6000)
    assert.equal(calls.ports, pendingCalls)
    reads.ports = () => [port(200)]
    await action(view, 'refresh-list')
    assert.deepEqual(ids(view), ['200'])
    oldPorts.reject(new Error('旧请求失败'))
    await tick()
    assert.deepEqual(ids(view), ['200'])
    assert.doesNotMatch(view.tree().props.filterBar.summaryText, /失败/)
  } finally { view.unmount() }
})

test('查询与功能切换废弃旧端口响应，旧成功或失败均不污染新查询', async () => {
  const { host, reads } = fixture()
  const first = deferred()
  reads.ports = () => first.promise
  const view = await mount(portLookup, host)
  try {
    reads.ports = () => [port(200)]
    await view.search('8080')
    assert.deepEqual(ids(view), ['200'])
    first.resolve([port(100)])
    await tick()
    assert.deepEqual(ids(view), ['200'])
    const leaving = deferred()
    reads.ports = () => leaving.promise
    await advance()
    await view.dropdown('memory')
    await view.search('')
    leaving.reject(new Error('已退出端口功能'))
    await tick()
    assert.doesNotMatch(view.text(), /已退出端口功能/)
    reads.ports = () => [port(100)]
    await view.dropdown('port')
    assert.deepEqual(ids(view), ['100'])
  } finally { view.unmount() }
})

test('暂停时首次进入端口和输入变化各读取一次，Ctrl+R仍刷新端口', async () => {
  const { host, reads, calls } = fixture()
  const view = await mount(Command, host)
  try {
    await action(view, 'toggle-auto-refresh')
    await view.dropdown('port')
    assert.deepEqual(ids(view), ['100'])
    assert.equal(calls.ports, 1)
    await view.search('8080')
    assert.equal(calls.ports, 2)
    await advance(6000)
    assert.equal(calls.ports, 2)
    reads.ports = () => [port(200)]
    await view.run(view.item('100'), '刷新列表')
    assert.deepEqual(ids(view), ['200'])
    assert.equal(calls.ports, 3)
  } finally { view.unmount() }
})

test('卸载后停止轮询，手动在途失败不再提示或启动额外详情请求', async () => {
  const { host, reads, calls } = fixture()
  const view = await mount(portLookup, host)
  const pendingProcesses = deferred(), pendingPorts = deferred()
  reads.processes = () => pendingProcesses.promise
  reads.ports = () => pendingPorts.promise
  await action(view, 'refresh-list')
  view.unmount()
  const stoppedCalls = { ...calls }, toastCount = host.toasts.length
  pendingProcesses.reject(new Error('页面已经卸载'))
  pendingPorts.reject(new Error('页面已经卸载'))
  await tick()
  await advance(6000)
  assert.deepEqual(calls, stoppedCalls)
  assert.equal(host.toasts.length, toastCount)
})

test('暂停后手动刷新得到新进程快照，旧进程请求失败不覆盖新状态', async () => {
  const { host, reads } = fixture()
  const view = await mount(Command, host)
  try {
    const oldProcesses = deferred()
    reads.processes = () => oldProcesses.promise
    await action(view, 'refresh-list')
    await action(view, 'toggle-auto-refresh')
    reads.processes = () => [process(200)]
    await action(view, 'refresh-list')
    assert.deepEqual(ids(view), ['200'])
    const toastCount = host.toasts.length
    oldProcesses.reject(new Error('旧进程请求失败'))
    await tick()
    assert.deepEqual(ids(view), ['200'])
    assert.doesNotMatch(view.tree().props.filterBar.summaryText, /不可用|过期/)
    assert.equal(host.toasts.length, toastCount)
  } finally { view.unmount() }
})
