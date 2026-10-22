// process-monitor macOS 修复集成测试：真实声明式运行时 + 按 macOS 宿主语义模拟 IPC
// （process_list 只给 pid/name/path/cpuUsage/memoryUsage；dllplugin_call 在 macOS 上不受支持）
import test from 'node:test'
import assert from 'node:assert/strict'
import { getDeclarativeBridge } from '@ztools/declarative-ui'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import ProcessMonitorCommand, {
  getTerminationRisk,
  resolveCpuLoadPercent,
  describeProcessProfile,
  normalizeProcessItem,
  terminateProcess,
  FORBIDDEN_REASON
} from '../dist/index.js'

const host = createHost()

const MAC_PROCESSES = [
  { pid: 1, name: 'launchd', path: '/sbin/launchd', cpuUsage: 0.1, memoryUsage: 20e6 },
  { pid: 98, name: 'WindowServer', path: '/System/Library/PrivateFrameworks/SkyLight.framework/Resources/WindowServer', cpuUsage: 12, memoryUsage: 300e6 },
  { pid: 25, name: 'logd', path: '/usr/libexec/logd', cpuUsage: 0.5, memoryUsage: 30e6 },
  { pid: 36, name: 'configd', path: '/usr/libexec/configd', cpuUsage: 0, memoryUsage: 10e6 },
  { pid: 979, name: 'loginwindow', path: '/System/Library/CoreServices/loginwindow.app/Contents/MacOS/loginwindow', cpuUsage: 0, memoryUsage: 55e6 },
  { pid: 1200, name: 'Finder', path: '/System/Library/CoreServices/Finder.app/Contents/MacOS/Finder', cpuUsage: 0.3, memoryUsage: 120e6 },
  { pid: 410, name: 'sshd', path: '/usr/sbin/sshd', cpuUsage: 0, memoryUsage: 5e6 },
  { pid: 5001, name: 'Calculator', path: '/System/Applications/Calculator.app/Contents/MacOS/Calculator', cpuUsage: 0, memoryUsage: 40e6 },
  { pid: 5002, name: 'Safari', path: '/System/Volumes/Preboot/Cryptexes/App/System/Applications/Safari.app/Contents/MacOS/Safari', cpuUsage: 3, memoryUsage: 200e6 },
  { pid: 5003, name: 'Google Chrome', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', cpuUsage: 80, memoryUsage: 400e6 },
  { pid: 5004, name: 'claude', path: '', cpuUsage: 120, memoryUsage: 600e6 }
]

function installMacHost({ cpuTotal = 31, cores = 8, list = MAC_PROCESSES } = {}) {
  host.reset()
  const killed = []
  host.ipc.process_list = async () => list
  host.ipc.system_get_memory_usage = async () => ({ total: 16e9, used: 9e9, available: 7e9, percent: 56 })
  host.ipc.system_get_hardware_summary = async () => ({ logicalCpuCount: cores, totalMemory: 16e9 })
  if (cpuTotal !== null) host.ipc.system_get_cpu_usage = async () => ({ total: cpuTotal })
  host.ipc.process_info = async ({ pid }) => {
    const p = list.find((x) => x.pid === pid)
    if (!p) throw Object.assign(new Error('进程不存在'), { code: 'PROCESS_NOT_FOUND' })
    return { pid, name: p.name, path: p.path, cpuUsage: p.cpuUsage, memoryUsage: p.memoryUsage }
  }
  // 宿主 process_terminate_pid（前端按插件注入的 terminateProcess）；旧的 process_kill 只能结束本窗口子进程，不应再被调用
  getDeclarativeBridge().terminateProcess = async (pid, options) => {
    killed.push(pid)
    return { pid, mode: options.mode, tree: !!options.tree, terminated: [pid] }
  }
  host.ipc.process_kill = async () => {
    throw Object.assign(new Error('只能管理当前窗口启动的进程'), { code: 'PERMISSION_DENIED' })
  }
  return { killed }
}

const summary = (view) => view.tree().props.filterBar.summaryText
const itemByName = (view, name) => view.item((it) => it.props.title.startsWith(`${name} [`))
const tagOf = (item) => item.props.accessories.find((a) => a.tag)?.tag.value
const ipcMethods = () => host.ipcCalls.map(([m]) => m)

// ---------- process-monitor-3：线程数 ----------

test('pm-3 macOS process_list 不带线程数时副标题不显示「线程 1」之类的假值', async () => {
  installMacHost()
  const view = await mount(ProcessMonitorCommand, host)
  await tick(10)
  const items = view.items()
  assert.equal(items.length, MAC_PROCESSES.length)
  for (const it of items) {
    assert.doesNotMatch(it.props.subtitle, /线程/, `${it.props.title} 不应显示线程数`)
  }
  assert.match(itemByName(view, 'logd').props.subtitle, /^PID: 25 · \/usr\/libexec\/logd$/)
  view.unmount()
})

test('pm-3 宿主给出真实线程数时照常显示；0、负数、非数字一律视为缺失', async () => {
  installMacHost({
    list: [
      { pid: 700, name: 'real', path: '/usr/bin/real', cpuUsage: 0, memoryUsage: 1e6, threadCount: 5 },
      { pid: 701, name: 'zero', path: '/usr/bin/zero', cpuUsage: 0, memoryUsage: 1e6, threadCount: 0 },
      { pid: 702, name: 'neg', path: '/usr/bin/neg', cpuUsage: 0, memoryUsage: 1e6, threadCount: -3 },
      { pid: 703, name: 'nan', path: '/usr/bin/nan', cpuUsage: 0, memoryUsage: 1e6, threadCount: 'abc' }
    ]
  })
  const view = await mount(ProcessMonitorCommand, host)
  await tick(10)
  assert.match(itemByName(view, 'real').props.subtitle, /PID: 700 · 线程 5 · /)
  for (const n of ['zero', 'neg', 'nan']) assert.doesNotMatch(itemByName(view, n).props.subtitle, /线程/)
  assert.equal(normalizeProcessItem({ pid: 9, name: 'x' }).threadCount, undefined)
  view.unmount()
})

// ---------- process-monitor-4：CPU 负载 ----------

test('pm-4 状态条用宿主的整机 CPU 占用，不再把各进程单核百分比相加（总和 216% 也只显示 31%）', async () => {
  installMacHost({ cpuTotal: 31 })
  const view = await mount(ProcessMonitorCommand, host)
  await tick(10)
  assert.match(summary(view), /^CPU 负载 31% · /)
  view.unmount()
})

test('pm-4 宿主 CPU 接口失败时按逻辑核数归一化进程占用之和，而不是封顶 100%', async () => {
  installMacHost({ cpuTotal: null, cores: 8 })
  const view = await mount(ProcessMonitorCommand, host)
  await tick(10)
  // 216.4 / 8 = 27
  assert.match(summary(view), /^CPU 负载 27% · /)
  assert.ok(ipcMethods().includes('system_get_cpu_usage'))
  view.unmount()
})

test('pm-4 resolveCpuLoadPercent 边界：NaN/负数/空列表、超 100 封顶、核数缺失时退回 hardwareConcurrency', () => {
  assert.equal(resolveCpuLoadPercent({ cpuUsagePercent: 17.6, cpuCoreCount: 8 }, [{ cpuPercent: 500 }]), 18)
  assert.equal(resolveCpuLoadPercent({ cpuUsagePercent: 250, cpuCoreCount: 8 }, []), 100)
  assert.equal(resolveCpuLoadPercent({ cpuUsagePercent: NaN, cpuCoreCount: 4 }, [{ cpuPercent: 200 }, { cpuPercent: NaN }, { cpuPercent: -50 }]), 50)
  assert.equal(resolveCpuLoadPercent({ cpuUsagePercent: 0, cpuCoreCount: 2 }, [{ cpuPercent: 900 }]), 100)
  assert.equal(resolveCpuLoadPercent(null, []), 0)
  assert.equal(resolveCpuLoadPercent(undefined, undefined), 0)
  const cores = Number(globalThis.navigator?.hardwareConcurrency) || 1
  assert.equal(resolveCpuLoadPercent({ cpuUsagePercent: 0, cpuCoreCount: 0 }, [{ cpuPercent: 40 }]), Math.min(100, Math.round(40 / cores)))
})

// ---------- process-monitor-5：系统 / 用户分类 ----------

test('pm-5 macOS 系统目录下的守护进程归为系统，/System 下的 Applications 与普通应用归为用户', async () => {
  installMacHost()
  const view = await mount(ProcessMonitorCommand, host)
  await tick(10)
  await view.dropdown('system')
  const sys = view.items().map((it) => it.props.title.split(' [')[0]).sort()
  assert.deepEqual(sys, ['Finder', 'WindowServer', 'configd', 'launchd', 'loginwindow', 'logd', 'sshd'].sort())
  assert.equal(tagOf(itemByName(view, 'sshd')), '系统服务')
  await view.dropdown('user')
  const user = view.items().map((it) => it.props.title.split(' [')[0]).sort()
  assert.deepEqual(user, ['Calculator', 'Google Chrome', 'Safari', 'claude'].sort())
  // macOS 系统进程不能被填成 Microsoft 发布者，否则搜「microsoft」会命中苹果进程
  await view.dropdown('memory')
  await view.search('microsoft')
  assert.equal(view.items().length, 0)
  view.unmount()
})

test('pm-5 Windows 分类规则保持不变，宿主显式给 isSystem 时以宿主为准', () => {
  assert.equal(normalizeProcessItem({ pid: 1044, name: 'svchost.exe', path: 'C:\\Windows\\System32\\svchost.exe' }).isSystem, true)
  assert.equal(normalizeProcessItem({ pid: 1044, name: 'svchost.exe' }).companyName, 'Microsoft Corporation')
  assert.equal(normalizeProcessItem({ pid: 2000, name: 'chrome.exe', path: 'C:\\Program Files\\chrome.exe' }).isSystem, false)
  assert.equal(normalizeProcessItem({ pid: 25, name: 'logd', path: '/usr/libexec/logd' }).companyName, '')
  assert.equal(normalizeProcessItem({ pid: 25, name: 'logd', path: '/usr/libexec/logd', isSystem: false }).isSystem, false)
  // 只是名字像系统路径前缀的用户目录不算系统
  assert.equal(normalizeProcessItem({ pid: 3000, name: 'tool', path: '/Users/me/System/tool' }).isSystem, false)
  assert.equal(normalizeProcessItem({ pid: 3001, name: 'kernel_task', path: '' }).isSystem, true)
})

// ---------- process-monitor-7：数字签名与托管服务 ----------

test('pm-7 macOS 上拿不到签名与服务时明确失败提示，不弹成功、不进详情页', async () => {
  installMacHost()
  const view = await mount(ProcessMonitorCommand, host)
  await tick(10)
  await view.run(itemByName(view, 'WindowServer'), '查看数字签名与托管服务')
  await tick(10)
  assert.equal(host.pushed.length, 0)
  const t = host.lastToast()
  assert.equal(t.style, 'FAILURE')
  assert.equal(t.title, '未读取到签名与托管服务信息')
  assert.ok(!host.toasts.some((x) => /已加载进程深度画像/.test(x.title)))
  assert.ok(ipcMethods().includes('process_info'))
  view.unmount()
})

test('pm-7 process_info 也失败（进程已退出）时同样是失败提示', async () => {
  installMacHost()
  host.ipc.process_info = async () => {
    throw Object.assign(new Error('进程不存在'), { code: 'PROCESS_NOT_FOUND' })
  }
  const view = await mount(ProcessMonitorCommand, host)
  await tick(10)
  await view.run(itemByName(view, 'logd'), '查看数字签名与托管服务')
  await tick(10)
  assert.equal(host.pushed.length, 0)
  assert.equal(host.lastToast().style, 'FAILURE')
  view.unmount()
})

test('pm-7 宿主给出真实签名与服务时进入详情页，只展示有值的字段', async () => {
  installMacHost({
    list: [{ pid: 1044, name: 'svchost.exe', path: 'C:\\Windows\\System32\\svchost.exe', cpuUsage: 1, memoryUsage: 9e7 }]
  })
  host.ipc.dllplugin_call = async ({ func, params }) => {
    if (func === 'GetProcessDetail') {
      return { pid: params.pid, name: 'svchost.exe', path: 'C:\\Windows\\System32\\svchost.exe', signerName: 'Microsoft Windows Publisher', companyName: 'Microsoft Corporation', fileVersion: '10.0.26100.1', fileDescription: 'svchost.exe', productName: '' }
    }
    if (func === 'GetServicesByPID') {
      return { services: [{ serviceName: 'DcomLaunch', displayName: 'DCOM Server Process Launcher', status: 'Running' }, { serviceName: '' }] }
    }
    throw Object.assign(new Error('不支持'), { code: 'NOT_SUPPORTED' })
  }
  const view = await mount(ProcessMonitorCommand, host)
  await tick(10)
  await view.run(view.item('1044'), '查看数字签名与托管服务')
  await tick(10)
  assert.equal(host.pushed.length, 1)
  const detail = await mountPushed(host)
  const text = detail.text()
  assert.match(text, /Microsoft Windows Publisher/)
  assert.match(text, /10\.0\.26100\.1/)
  assert.match(text, /托管服务 DcomLaunch/)
  assert.match(text, /DCOM Server Process Launcher · Running/)
  assert.doesNotMatch(text, /产品名称|文件描述/)
  detail.unmount()
  view.unmount()
})

test('pm-7 describeProcessProfile 对空值、null 与和进程名相同的描述返回空', () => {
  assert.deepEqual(describeProcessProfile({ name: 'logd' }, null, null), [])
  assert.deepEqual(
    describeProcessProfile({ name: 'logd' }, { signerName: ' ', companyName: '', productName: '', fileDescription: 'logd', fileVersion: '' }, [{ name: '' }]),
    []
  )
})

// ---------- process-monitor-8：macOS 关键进程保护 ----------

test('pm-8 结束 launchd / WindowServer / loginwindow 直接拦截：不弹确认、不调用 process_kill', async () => {
  const { killed } = installMacHost()
  const view = await mount(ProcessMonitorCommand, host)
  await tick(10)
  for (const [name, action] of [
    ['launchd', '结束进程'],
    ['WindowServer', '强制结束进程树'],
    ['loginwindow', '平缓关闭进程 (Graceful)'],
    ['logd', '结束进程']
  ]) {
    await view.run(itemByName(view, name), action)
    await tick(5)
    const t = host.lastToast()
    assert.equal(t.style, 'FAILURE', name)
    assert.match(t.title, new RegExp(`已拦截：${name}`))
    assert.equal(t.message, FORBIDDEN_REASON)
    assert.equal(tagOf(itemByName(view, name)), '系统关键')
  }
  assert.equal(host.confirms.length, 0)
  assert.deepEqual(killed, [])
  assert.ok(!ipcMethods().includes('process_kill'))
  view.unmount()
})

test('pm-8 Finder 等系统界面进程走高危确认：取消不结束，确认后才结束', async () => {
  const { killed } = installMacHost()
  const view = await mount(ProcessMonitorCommand, host)
  await tick(10)
  host.setConfirm(false)
  await view.run(itemByName(view, 'Finder'), '结束进程')
  await tick(5)
  assert.match(host.confirms.at(-1).title, /^高危操作：结束系统界面进程 \[Finder\]/)
  assert.deepEqual(killed, [])
  host.setConfirm(true)
  await view.run(itemByName(view, 'Finder'), '结束进程')
  await tick(10)
  assert.deepEqual(killed, [1200])
  // 普通进程仍是普通确认
  await view.run(itemByName(view, 'Google Chrome'), '结束进程')
  await tick(10)
  assert.match(host.confirms.at(-1).title, /^确认结束进程/)
  assert.deepEqual(killed, [1200, 5003])
  assert.ok(!ipcMethods().includes('process_kill'), '走宿主结束进程接口，不再调用 process_kill')
  view.unmount()
})

test('pm-8 绕过界面直接调用 terminateProcess 也会拦截（大小写不敏感，含 kernel_task 与 PID 0/1/4）', async () => {
  installMacHost()
  for (const [pid, name] of [[98, 'windowserver'], [979, 'LoginWindow'], [0, 'kernel_task'], [1, 'whatever'], [4, 'System'], [612, 'csrss.exe']]) {
    const res = await terminateProcess(pid, name, 'force')
    assert.equal(res.ok, false, `${pid} ${name}`)
    assert.equal(res.error, FORBIDDEN_REASON)
  }
  assert.ok(!ipcMethods().includes('process_kill'))
  assert.equal(getTerminationRisk(1200, 'finder'), 'high-risk')
  assert.equal(getTerminationRisk(5003, 'Google Chrome'), 'normal')
  assert.equal(getTerminationRisk(5003, ''), 'normal')
})
