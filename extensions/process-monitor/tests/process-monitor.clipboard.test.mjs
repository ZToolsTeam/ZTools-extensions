// 复制 PID / 可执行路径 / 启动命令行的集成测试：真实声明式运行时 + 按 macOS 宿主语义模拟 IPC + 测试宿主剪贴板（可注入写入失败）
// 覆盖：写入成功才提示「已复制…」；宿主拒绝写入时提示「复制失败」与原因，不提示成功、不留下未处理的 rejection
import test from 'node:test'
import assert from 'node:assert/strict'
import { getDeclarativeBridge, Toast } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import ProcessMonitorCommand from '../dist/index.js'

const host = createHost()
const rejections = []
process.on('unhandledRejection', (reason) => rejections.push(reason))

const PROCS = [
  { pid: 5001, name: 'Calculator', path: '/System/Applications/Calculator.app/Contents/MacOS/Calculator', cpuUsage: 0, memoryUsage: 40e6 },
  { pid: 5004, name: 'claude', path: '', cpuUsage: 1, memoryUsage: 60e6 }
]

test.beforeEach(() => {
  host.reset()
  rejections.length = 0
  host.ipc.process_list = async () => PROCS
  host.ipc.system_get_memory_usage = async () => ({ total: 16e9, used: 9e9, available: 7e9, percent: 56 })
  host.ipc.system_get_hardware_summary = async () => ({ logicalCpuCount: 8, totalMemory: 16e9 })
  host.ipc.system_get_cpu_usage = async () => ({ total: 10 })
  host.ipc.process_info = async ({ pid }) => {
    const p = PROCS.find((x) => x.pid === pid)
    if (!p) throw Object.assign(new Error('进程不存在'), { code: 'PROCESS_NOT_FOUND' })
    return { pid, name: p.name, path: p.path, cpuUsage: p.cpuUsage, memoryUsage: p.memoryUsage }
  }
})

const itemByName = (view, name) => view.item((it) => it.props.title.startsWith(`${name} [`))

/** 让宿主剪贴板写入抛错（模拟 HostMethodError：剪贴板被占用 / IPC 断开），返回恢复函数 */
function failClipboard(error) {
  const bridge = getDeclarativeBridge()
  const original = bridge.copyToClipboard
  bridge.copyToClipboard = async () => {
    throw error
  }
  return () => {
    bridge.copyToClipboard = original
  }
}

const CASES = [
  ['复制 PID', '5001', '已复制 PID'],
  ['复制完整可执行路径', '/System/Applications/Calculator.app/Contents/MacOS/Calculator', '已复制可执行路径'],
]

for (const [title, expected, successTitle] of CASES) {
  test(`${title}：写入成功后才提示「${successTitle}」`, async () => {
    const view = await mount(ProcessMonitorCommand, host)
    await tick(10)
    host.toasts.length = 0
    await view.run(itemByName(view, 'Calculator'), title)
    await tick(10)
    assert.equal(host.clipboard.text, expected)
    assert.equal(host.lastToast().style, Toast.Style.Success)
    assert.equal(host.lastToast().title, successTitle)
    assert.deepEqual(rejections, [])
    view.unmount()
  })

  test(`[故障] ${title}：宿主拒绝写入时提示「复制失败」与原因，不提示成功、无未处理 rejection`, async () => {
    const view = await mount(ProcessMonitorCommand, host)
    await tick(10)
    host.clipboard.text = 'SENTINEL'
    host.toasts.length = 0
    const restore = failClipboard(Object.assign(new Error('剪贴板被其他程序占用'), { name: 'HostMethodError', code: 'CLIPBOARD_BUSY' }))
    try {
      await view.run(itemByName(view, 'Calculator'), title)
      await tick(10)
    } finally {
      restore()
    }
    assert.equal(host.clipboard.text, 'SENTINEL')
    assert.equal(host.toasts.length, 1)
    assert.equal(host.lastToast().style, Toast.Style.Failure)
    assert.equal(host.lastToast().title, '复制失败')
    assert.equal(host.lastToast().message, '剪贴板被其他程序占用')
    assert.ok(!host.toasts.some((t) => t.style === Toast.Style.Success))
    assert.deepEqual(rejections, [])
    view.unmount()
  })
}

test('[边界] 无磁盘路径的进程复制可执行路径：提示路径不可用，不写剪贴板', async () => {
  const view = await mount(ProcessMonitorCommand, host)
  await tick(10)
  host.clipboard.text = 'SENTINEL'
  host.toasts.length = 0
  await view.run(itemByName(view, 'claude'), '复制完整可执行路径')
  await tick(10)
  assert.equal(host.clipboard.text, 'SENTINEL')
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.equal(host.lastToast().title, '路径不可用')
  assert.deepEqual(rejections, [])
  view.unmount()
})

test('[故障] 宿主抛出非 Error 值（IPC 管道断开）时同样提示失败并带原因', async () => {
  const view = await mount(ProcessMonitorCommand, host)
  await tick(10)
  host.toasts.length = 0
  const restore = failClipboard('IPC 管道已断开')
  try {
    await view.run(itemByName(view, 'Calculator'), '复制 PID')
    await tick(10)
  } finally {
    restore()
  }
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.equal(host.lastToast().message, 'IPC 管道已断开')
  assert.deepEqual(rejections, [])
  view.unmount()
})

test('复制启动命令行：宿主给了命令行才复制；没给时提示「没有读取到启动命令行」，不拿路径冒充', async () => {
  host.ipc.process_list = async () => [
    { pid: 5001, name: 'Calculator', path: '/System/Applications/Calculator.app/Contents/MacOS/Calculator', cpuUsage: 0, memoryUsage: 40e6 },
    { pid: 5002, name: 'node', path: '/usr/local/bin/node', commandLine: '/usr/local/bin/node server.js --port 3000', cpuUsage: 0, memoryUsage: 50e6 }
  ]
  const view = await mount(ProcessMonitorCommand, host)
  await tick(10)
  host.clipboard.text = 'SENTINEL'
  host.toasts.length = 0
  await view.run(itemByName(view, 'Calculator'), '复制启动命令行 (CommandLine)')
  await tick(10)
  assert.equal(host.clipboard.text, 'SENTINEL')
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.equal(host.lastToast().title, '没有读取到启动命令行')
  await view.run(itemByName(view, 'node'), '复制启动命令行 (CommandLine)')
  await tick(10)
  assert.equal(host.clipboard.text, '/usr/local/bin/node server.js --port 3000')
  assert.equal(host.lastToast().title, '已复制启动命令行')
  view.unmount()
})
