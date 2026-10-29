// 路径授权收紧后「定位文件目录」的集成测试：真实声明式运行时 + 按宿主结果授权语义模拟的 macOS 宿主
// 宿主规则：process_list（及 GetProcessList 兜底）返回的可执行文件路径只读授权给本窗口，process_info 给的路径不授权；
// shell_show_item_in_folder / shell_open_path 只放行已授权路径
// 覆盖：定位用列表里的原始路径（即使详情接口给了另一个路径）、授权过期 / 文件被删时提示刷新、没有路径时不调用宿主
import test from 'node:test'
import assert from 'node:assert/strict'
import { getDeclarativeBridge } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import ProcessMonitorCommand from '../dist/index.js'

const host = createHost()
const rejections = []
process.on('unhandledRejection', (reason) => rejections.push(reason))

const APP = '/Applications/Sample Tool.app/Contents/MacOS/Sample Tool'
// 详情接口给的是另一种写法（例如解析了符号链接的真实路径），没有被授权
const APP_REAL = '/private/var/folders/xx/AppTranslocation/Sample Tool.app/Contents/MacOS/Sample Tool'
const LIST = [
  { pid: 5101, name: 'Sample Tool', path: APP, cpuUsage: 3, memoryUsage: 80e6 },
  { pid: 5102, name: 'kernel_task', path: '', cpuUsage: 1, memoryUsage: 10e6 }
]

function installGrantHost() {
  const grants = new Set()
  const missing = new Set()
  const calls = { revealed: [], opened: [] }
  host.ipc.process_list = async () => {
    for (const p of LIST) if (p.path) grants.add(p.path)
    return LIST
  }
  host.ipc.process_info = async ({ pid }) => {
    const p = LIST.find((x) => x.pid === pid)
    if (!p) throw Object.assign(new Error('进程不存在'), { code: 'PROCESS_NOT_FOUND' })
    return { pid, name: p.name, path: p.path ? APP_REAL : '', cpuUsage: p.cpuUsage, memoryUsage: p.memoryUsage }
  }
  host.ipc.system_get_memory_usage = async () => ({ total: 16e9, used: 9e9, available: 7e9, percent: 56 })
  host.ipc.system_get_hardware_summary = async () => ({ logicalCpuCount: 8, totalMemory: 16e9 })
  host.ipc.system_get_cpu_usage = async () => ({ total: 20 })
  const authorize = (p) => {
    if (!grants.has(p)) throw Object.assign(new Error('路径未由当前窗口授权'), { code: 'PERMISSION_DENIED' })
    if (missing.has(p)) throw Object.assign(new Error('文件不存在'), { code: 'FILE_ERROR' })
  }
  host.ipc.shell_show_item_in_folder = async ({ fullPath }) => { authorize(fullPath); calls.revealed.push(fullPath); return { success: true } }
  host.ipc.shell_open_path = async ({ fullPath }) => { authorize(fullPath); calls.opened.push(fullPath); return { success: true } }
  getDeclarativeBridge().terminateProcess = async () => { throw new Error('本用例不应结束进程') }
  return { grants, missing, calls }
}

const itemByName = (view, name) => view.item((it) => it.props.title === name)

async function mountLoaded() {
  const view = await mount(ProcessMonitorCommand)
  await tick(30)
  return view
}

test.beforeEach(() => {
  host.reset()
  rejections.length = 0
})

test('定位文件目录：用进程列表里的原始路径（已授权），不用详情接口给的另一种路径', async () => {
  const { calls } = installGrantHost()
  const view = await mountLoaded()
  // 先读取详情，让 details[pid].path 变成未授权的 APP_REAL
  await view.run(itemByName(view, 'Sample Tool'), '查看数字签名与托管服务')
  await tick(10)
  assert.ok(host.ipcCalls.some(([m]) => m === 'process_info'), '应读取过详情')
  await view.run(itemByName(view, 'Sample Tool'), '定位文件目录')
  await tick(10)
  assert.deepEqual(calls.revealed, [APP])
  assert.deepEqual(calls.opened, [], '定位成功时不能退回去“打开”可执行文件')
  assert.equal(host.lastToast().title, '已在访达中定位')
  assert.equal(host.lastToast().message, APP)
  view.unmount()
  assert.equal(rejections.length, 0)
})

test('异常：授权过期后定位被拒，提示刷新列表后再试，不显示成功', async () => {
  const { grants, calls } = installGrantHost()
  const view = await mountLoaded()
  grants.clear()
  await view.run(itemByName(view, 'Sample Tool'), '定位文件目录')
  await tick(10)
  const t = host.lastToast()
  assert.equal(t.style, 'FAILURE')
  assert.equal(t.title, '打开路径失败')
  assert.match(t.message, /^\/Applications\/Sample Tool\.app\/Contents\/MacOS\/Sample Tool\n.*请刷新进程列表后再试$/)
  assert.deepEqual(calls.revealed, [])

  // 刷新列表后授权恢复
  await view.run(itemByName(view, 'Sample Tool'), '刷新列表')
  await tick(30)
  await view.run(itemByName(view, 'Sample Tool'), '定位文件目录')
  await tick(10)
  assert.deepEqual(calls.revealed, [APP])
  view.unmount()
})

test('异常：显示失败时绝不退回 shell_open_path（对可执行文件“打开”等于运行它）', async () => {
  const { calls } = installGrantHost()
  host.ipc.shell_show_item_in_folder = async () => { throw Object.assign(new Error('访达拒绝'), { code: 'SHELL_ERROR' }) }
  const view = await mountLoaded()
  await view.run(itemByName(view, 'Sample Tool'), '定位文件目录')
  await tick(10)
  assert.equal(host.ipcCalls.some(([m]) => m === 'shell_open_path'), false)
  assert.deepEqual(calls.opened, [])
  assert.equal(host.lastToast().style, 'FAILURE')
  assert.equal(host.lastToast().title, '打开路径失败')
  view.unmount()
})

test('异常：可执行文件已被删除（FILE_ERROR）时同样提示失败', async () => {
  const { missing } = installGrantHost()
  const view = await mountLoaded()
  missing.add(APP)
  await view.run(itemByName(view, 'Sample Tool'), '定位文件目录')
  await tick(10)
  assert.equal(host.lastToast().title, '打开路径失败')
  view.unmount()
})

test('边界：进程没有可执行路径（内核进程）时直接提示无法定位，不调用宿主', async () => {
  const { calls } = installGrantHost()
  const view = await mountLoaded()
  await view.run(itemByName(view, 'kernel_task'), '定位文件目录')
  await tick(10)
  assert.equal(host.lastToast().title, '无法定位路径')
  assert.equal(host.ipcCalls.some(([m]) => m === 'shell_show_item_in_folder' || m === 'shell_open_path'), false)
  assert.deepEqual(calls.revealed, [])
  view.unmount()
})
