// hardware-info 本轮修复的集成测试：用 plugins/shared/test-harness.mjs 在 Node 中渲染插件 dist，
// 经 preload IPC 模拟宿主（含故障注入），覆盖「读取失败不伪造数据」「macOS 系统版本 / 内核 / Build」「名称与能力一致」。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import HardwareInfoCommand from '../dist/index.js'
import { exportHardwareReport, fetchHardwareTelemetrySnapshot } from '../dist/logic.js'

const GB = 1024 ** 3

async function settle() {
  await tick(20)
  await new Promise((r) => setTimeout(r, 20))
  await tick(20)
}

/** 与 macOS 真机宿主返回结构一致（get_system_info 没有 osBuild，只有 kernelRelease） */
function installMacHost(host) {
  host.ipc.system_list_volumes = async () => ({ volumes: [{ path: '/', label: 'Macintosh HD', fileSystem: 'APFS', totalBytes: 500 * 1024 ** 3, usedBytes: 100 * 1024 ** 3, availableBytes: 400 * 1024 ** 3, capacityGroup: 'disk3' }], partial: false, errors: [] })
  host.ipc.system_get_hardware_summary = async () => ({ platform: 'macos', osVersion: '26.5.1', cpuModels: ['Apple M1 Pro'], logicalCpuCount: 8, totalMemory: 16 * GB })
  host.ipc.get_system_info = async () => ({ success: true, platform: 'macos', osName: 'macOS', osVersion: '26.5.1', kernelRelease: '25.5.0', osArch: 'arm64' })
  host.ipc.system_get_cpu_usage = async () => ({ total: 12.4, perCore: [] })
  host.ipc.system_get_memory_usage = async () => ({ total: 16 * GB, used: 9 * GB, available: 7 * GB, percent: 56 })
  host.ipc.system_get_battery_status = async () => ({ percent: 80, isCharging: true, timeRemaining: -1 })
  host.ipc.screen_get_all_displays = async () => ({ success: true, displays: [{ id: 1, name: '内建视网膜显示器', bounds: { x: 0, y: 0, width: 1800, height: 1169 }, scaleFactor: 2, displayFrequency: 120, colorDepth: 30 }] })
  host.ipc.system_get_disk_usage = async ({ drive }) => {
    if (!String(drive).startsWith('/')) throw Object.assign(new Error('卷路径必须是 POSIX 绝对路径'), { code: 'INVALID_REQUEST' })
    return { total: 460 * GB, used: 97 * GB, free: 363 * GB, percent: 21 }
  }
}

const FAKE_DEFAULTS = /x86_64 Processor|Windows|X64|\bx64\b|16\.0 GB|8 线程|8 逻辑线程|Build 0|健康度 \d+|0% 已用/

// ---------------- 宿主读取失败时不得用写死的数据冒充，也不得提示成功 ----------------

test('全部宿主接口失败：界面不出现 Windows/x64/16GB/8 线程等假数据，弹失败提示而非「已刷新」', async () => {
  const host = createHost()
  host.reset() // 不注册任何 IPC：测试宿主对每个方法都返回 NOT_SUPPORTED
  const view = await mount(HardwareInfoCommand, host)
  await settle()

  const tree = view.tree()
  assert.equal(tree.props.filterBar.summaryText, '硬件信息读取失败，可点击「刷新」重试')
  const text = view.text()
  assert.doesNotMatch(text, FAKE_DEFAULTS)
  assert.equal(view.item('hw-cpu-spec').props.title, '处理器型号读取失败')
  assert.equal(view.item('hw-mem-spec').props.title, '物理内存容量读取失败')
  assert.equal(view.item('hw-os-spec').props.title, '操作系统读取失败')
  // 负载余量与场景估算在数据缺失时不计算
  assert.equal(view.items().filter((it) => String(it.props.id).startsWith('sc-')).length, 0)
  assert.equal(host.lastToast().style, 'FAILURE')
  assert.equal(host.lastToast().title, '硬件信息读取失败')

  // 用户点「刷新」：仍然失败，必须继续提示失败，绝不弹成功
  host.toasts.length = 0
  await tree.props.filterBar.actions.find((a) => a.id === 'refresh-hw').onAction()
  await settle()
  assert.ok(host.toasts.length > 0)
  assert.ok(host.toasts.every((t) => t.style === 'FAILURE'), JSON.stringify(host.toasts))
  view.unmount()
})

test('全部失败时导出的三种报告如实标注读取失败，JSON 为 null 且列出失败模块', async () => {
  createHost().reset() // 不注册任何 IPC：preload 每个方法都返回 NOT_SUPPORTED
  const snap = await fetchHardwareTelemetrySnapshot({}) // hostOverride 没有任何方法 → 回落到 preload IPC，全部失败
  const fallbackFree = await fetchHardwareTelemetrySnapshot({
    system_get_hardware_summary: async () => { throw new Error('IPC 管道断开') },
    get_system_info: async () => ({ success: false, error: { code: 'TIMEOUT' } }),
    system_get_cpu_usage: async () => null,
    system_get_memory_usage: async () => ({ success: false, error: 'boom' }),
    system_get_battery_status: async () => { throw new Error('pmset 崩溃') },
    screen_get_all_displays: async () => ({ success: false, error: { message: 'screen 不可用' } }),
    system_get_disk_usage: async () => { throw new Error('statfs 失败') }
  })
  for (const s of [snap, fallbackFree]) {
    assert.equal(s.cpuModel, null)
    assert.equal(s.logicalCpuCount, null)
    assert.equal(s.totalMemoryBytes, null)
    assert.equal(s.osName, null)
    assert.equal(s.osBuild, null)
    assert.equal(s.loadHeadroomPercent, null)
    assert.deepEqual(s.scenarios, [])
    assert.equal(s.displayCount, null)
    assert.equal(s.powerReadFailed, true)
    assert.deepEqual(s.failures, ['处理器信息', 'CPU 负载', '内存占用', '系统版本', '电源状态', '显示器', '磁盘容量'])

    const md = exportHardwareReport(s, 'markdown')
    const txt = exportHardwareReport(s, 'txt')
    for (const report of [md, txt]) {
      assert.doesNotMatch(report, FAKE_DEFAULTS)
      assert.match(report, /型号读取失败/)
      assert.match(report, /电源状态读取失败/)
      assert.match(report, /未能读取: 处理器信息、CPU 负载/)
    }
    const json = JSON.parse(exportHardwareReport(s, 'json'))
    assert.equal(json.cpu.model, null)
    assert.equal(json.memory.totalBytes, null)
    assert.equal(json.os.build, null)
    assert.equal(json.loadHeadroomPercent, null)
    assert.equal(json.readFailures.length, 7)
  }
})

test('只有内存接口失败：显示「占用读取失败」而不是 0% 已用，负载余量不计算，失败提示只列内存占用', async () => {
  const host = createHost()
  host.reset()
  installMacHost(host)
  delete host.ipc.system_get_memory_usage
  const view = await mount(HardwareInfoCommand, host)
  await settle()

  const mem = view.item('hw-mem-spec')
  assert.equal(mem.props.title, '物理内存总容量 16.0 GB') // 总量回退到硬件摘要里的真实值
  assert.deepEqual(mem.props.accessories.map((a) => a.text ?? a.tag?.value), ['16.0 GB', '占用读取失败'])
  assert.doesNotMatch(view.text(), /0% 已用|整机健康度/)
  assert.equal(view.item('hw-cpu-spec').props.title, 'Apple M1 Pro')
  assert.equal(host.lastToast().style, 'FAILURE')
  // 失败原因跟在模块名后面，不吞掉宿主的报错
  assert.match(host.lastToast().message, /^未能读取：内存占用。内存占用：\S/)
  view.unmount()
})

test('畸形宿主数据（NaN / 负数 / 字符串 / 公共层占位型号）按读取失败处理，不当真实值展示', async () => {
  const snap = await fetchHardwareTelemetrySnapshot({
    // 宿主成功但没给型号：公共 native-ipc 会填 'x86_64 Processor' 占位，插件必须识别为未读到
    system_get_hardware_summary: async () => ({ logicalCpuCount: Number.NaN, totalMemory: -1 }),
    get_system_info: async () => ({ osName: '  ', osVersion: 42, osBuild: 0, osArch: '' }),
    system_get_cpu_usage: async () => ({ total: 'high' }),
    system_get_memory_usage: async () => ({ total: '16G', used: -5, available: Number.POSITIVE_INFINITY, percent: Number.NaN }),
    system_get_battery_status: async () => ({ percent: 77, isCharging: false }),
    screen_get_all_displays: async () => 'not-an-array',
    system_get_disk_usage: async () => ({ total: 0, used: 0, percent: 0 })
  })
  assert.equal(snap.cpuModel, null)
  assert.equal(snap.logicalCpuCount, null)
  assert.equal(snap.cpuUsagePercent, null)
  assert.equal(snap.totalMemoryBytes, null)
  assert.equal(snap.usedMemoryBytes, null)
  assert.equal(snap.availableMemoryBytes, null)
  assert.equal(snap.memoryUsagePercent, null)
  assert.equal(snap.osName, null)
  assert.equal(snap.osVersion, null)
  assert.equal(snap.osBuild, null)
  assert.equal(snap.displayCount, null)
  assert.equal(snap.batteryPercent, 77) // 合法字段照常使用
  assert.equal(snap.powerReadFailed, false)
  assert.ok(!snap.failures.includes('电源状态'))
  const text = JSON.stringify(snap.entries)
  assert.doesNotMatch(text, /x86_64 Processor|NaN|Infinity|Build 0/)
})

test('CPU 负载 0% 与超过 100% 的边界：0 是真实值，超限值标读取失败', async () => {
  const base = {
    system_get_hardware_summary: async () => ({ cpuModel: 'Apple M2', logicalCpuCount: 8, totalMemory: 8 * GB }),
    get_system_info: async () => ({ platform: 'macos', osName: 'macOS', osVersion: '15.0', kernelRelease: '24.0.0', osArch: 'arm64' }),
    system_get_memory_usage: async () => ({ total: 8 * GB, used: 0, available: 8 * GB, percent: 0 }),
    system_get_battery_status: async () => ({ percent: 50, isCharging: false }),
    screen_get_all_displays: async () => [],
    system_list_volumes: async () => ({ volumes: [{ path: '/', label: 'Macintosh HD', fileSystem: 'APFS', totalBytes: 500 * 1024 ** 3, usedBytes: 100 * 1024 ** 3, availableBytes: 400 * 1024 ** 3, capacityGroup: 'disk3' }], partial: false, errors: [] }),
    system_get_disk_usage: async ({ drive }) => (drive === '/' ? { total: 100 * GB, used: 10 * GB, available: 90 * GB, percent: 10 } : { success: false })
  }
  const idle = await fetchHardwareTelemetrySnapshot({ ...base, system_get_cpu_usage: async () => ({ total: 0 }) })
  assert.equal(idle.cpuUsagePercent, 0)
  assert.equal(idle.memoryUsagePercent, 0)
  assert.equal(idle.usedMemoryBytes, 0)
  assert.equal(typeof idle.loadHeadroomPercent, 'number')
  assert.deepEqual(idle.failures, [])
  assert.equal(idle.displayCount, 0) // 接口成功但没有显示器：0 台，不算读取失败
  const spike = await fetchHardwareTelemetrySnapshot({ ...base, system_get_cpu_usage: async () => ({ total: 180 }) })
  assert.equal(spike.cpuUsagePercent, null)
  assert.equal(spike.loadHeadroomPercent, null)
  assert.ok(spike.failures.includes('CPU 负载'))
})

test('宿主恢复后点「刷新」：数据自愈为真实值并提示「硬件信息已刷新」；连续并发刷新不抛错且结果一致', async () => {
  const host = createHost()
  host.reset()
  const view = await mount(HardwareInfoCommand, host)
  await settle()
  assert.equal(view.item('hw-cpu-spec').props.title, '处理器型号读取失败')

  installMacHost(host)
  host.toasts.length = 0
  const refresh = view.tree().props.filterBar.actions.find((a) => a.id === 'refresh-hw')
  await refresh.onAction()
  await settle()
  assert.equal(view.item('hw-cpu-spec').props.title, 'Apple M1 Pro')
  assert.equal(host.lastToast().style, 'SUCCESS')
  assert.equal(host.lastToast().title, '硬件信息已刷新')
  assert.match(view.tree().props.filterBar.summaryText, /^负载余量 44% · CPU 8 线程 \(负载 12%\)/)

  // 20ms 内连续 5 次刷新（⌘R 连按），最终状态正确、无失败提示
  host.toasts.length = 0
  const cpuItem = view.item('hw-cpu-spec')
  const refreshAction = view.actions(cpuItem).find((a) => a.props.title === '刷新硬件信息')
  await Promise.all(Array.from({ length: 5 }, () => refreshAction.props.onAction()))
  await settle()
  assert.equal(view.item('hw-cpu-spec').props.title, 'Apple M1 Pro')
  assert.ok(host.toasts.every((t) => t.style === 'SUCCESS'))
  view.unmount()
})

test('复制报告：宿主剪贴板拒绝写入时提示「复制失败」，不提示已导出', async () => {
  const host = createHost()
  host.reset()
  installMacHost(host)
  const view = await mount(HardwareInfoCommand, host)
  await settle()
  // 正常复制
  host.toasts.length = 0
  await view.run(view.item('hw-cpu-spec'), '复制 Markdown 整机硬件报告')
  assert.match(host.clipboard.text, /Apple M1 Pro/)
  assert.equal(host.lastToast().style, 'SUCCESS')

  // 构造一个超出宿主 8 MiB 上限的标题，让宿主剪贴板拒绝写入
  host.ipc.system_get_hardware_summary = async () => ({ cpuModel: 'X'.repeat(9 * 1024 * 1024), logicalCpuCount: 8, totalMemory: 16 * GB })
  await view.tree().props.filterBar.actions.find((a) => a.id === 'refresh-hw').onAction()
  await settle()
  host.toasts.length = 0
  await view.run(view.item('hw-cpu-spec'), '复制当前硬件规格摘要')
  assert.equal(host.lastToast().style, 'FAILURE')
  assert.equal(host.lastToast().title, '复制失败')
  view.unmount()
})

// ---------------- macOS 不能把产品版本当内核版本，也不能显示假的 Build 0 ----------------

test('macOS：系统行显示「系统版本 26.5.1 · Darwin 内核 25.5.0」，界面与三种报告都不出现 Build 0', async () => {
  const host = createHost()
  host.reset()
  installMacHost(host)
  const view = await mount(HardwareInfoCommand, host)
  await settle()

  const os = view.item('hw-os-spec')
  assert.equal(os.props.title, 'macOS (arm64)')
  assert.equal(os.props.subtitle, '系统版本 26.5.1 · Darwin 内核 25.5.0')
  assert.deepEqual(os.props.accessories.map((a) => a.text ?? a.tag?.value), ['26.5.1', '内核 25.5.0'])
  const md = os.props.detail.props.markdown
  assert.match(md, /系统版本\*\*: `26\.5\.1`/)
  assert.match(md, /Darwin 内核版本\*\*: `25\.5\.0`/)
  assert.doesNotMatch(view.text(), /Build|内核版本 26\.5\.1/)

  const snap = await fetchHardwareTelemetrySnapshot()
  assert.equal(snap.osBuild, null)
  assert.equal(snap.kernelVersion, '25.5.0')
  const report = exportHardwareReport(snap, 'markdown')
  assert.match(report, /`macOS 26\.5\.1 \(Darwin 内核 25\.5\.0, arm64\)`/)
  assert.match(exportHardwareReport(snap, 'txt'), /操作系统 \(OS\): macOS 26\.5\.1 \(Darwin 内核 25\.5\.0, arm64\)/)
  for (const r of [report, exportHardwareReport(snap, 'txt')]) assert.doesNotMatch(r, /Build/)
  const json = JSON.parse(exportHardwareReport(snap, 'json'))
  assert.deepEqual(json.os, { name: 'macOS', version: '26.5.1', kernel: '25.5.0', build: null, arch: 'arm64' })
  view.unmount()
})

test('Windows：宿主真实提供 osBuild 时显示内核版本与 Build（NT 版本号只显示一次）；Build 为 0/负数时隐藏', async () => {
  const winSys = { success: true, platform: 'windows', osName: 'Windows 11 Pro', osVersion: '10.0.22631', osMajor: 10, osMinor: 0, osBuild: 22631, windowsFamily: 'Windows NT', windowsRelease: '10.0.22631', osArch: 'x64' }
  const host = {
    system_get_hardware_summary: async () => ({ cpuModel: 'AMD Ryzen 9 7950X', logicalCpuCount: 32, totalMemory: 64 * GB }),
    get_system_info: async () => winSys,
    system_get_cpu_usage: async () => ({ total: 5 }),
    system_get_memory_usage: async () => ({ total: 64 * GB, used: 20 * GB, available: 44 * GB, percent: 31 }),
    system_get_battery_status: async () => ({ percent: 255, isCharging: false }),
    screen_get_all_displays: async () => [],
    system_get_disk_usage: async ({ drive }) => (drive === 'C:\\' ? { total: 1000 * GB, used: 400 * GB, free: 600 * GB, percent: 40 } : { success: false, error: 'NOT_FOUND' })
  }
  const snap = await fetchHardwareTelemetrySnapshot(host)
  const os = snap.entries.find((e) => e.id === 'hw-os-spec')
  assert.equal(os.title, 'Windows 11 Pro (x64)')
  assert.equal(os.subtitle, '内核版本 10.0.22631 · Build 22631')
  assert.equal(os.value, 'Build 22631')
  assert.match(exportHardwareReport(snap, 'txt'), /Windows 11 Pro 10\.0\.22631 \(Build 22631, x64\)/)

  for (const badBuild of [0, -3, Number.NaN, '22631']) {
    const s = await fetchHardwareTelemetrySnapshot({ ...host, get_system_info: async () => ({ ...winSys, osBuild: badBuild }) })
    assert.equal(s.osBuild, null, String(badBuild))
    assert.doesNotMatch(JSON.stringify(s.entries) + exportHardwareReport(s, 'markdown'), /Build/)
  }
})

// ---------------- 名称、描述与界面文案不能承诺未实现的温度 / 显卡 / 主板 / SPD / SMART ----------------

const UNIMPLEMENTED = /温度|传感器|显卡|GPU|主板|SPD|SMART|HardwareInfoPlugin\.dll/

test('plugin.json / README 只描述实际提供的能力', () => {
  const manifest = JSON.parse(readFileSync(new URL('../plugin.json', import.meta.url), 'utf8'))
  assert.equal(manifest.name, '硬件信息')
  assert.doesNotMatch(manifest.name + manifest.description, UNIMPLEMENTED)
  assert.match(manifest.description, /CPU/)
  assert.match(manifest.description, /内存/)
  assert.match(manifest.description, /显示器/)
  assert.deepEqual(manifest.nativeComponents, [])
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  assert.doesNotMatch(readme.split('暂不提供')[0], UNIMPLEMENTED)
  assert.doesNotMatch(readme, /\.dll/)
})

test('界面（下拉、状态条按钮、动作、提示）不再出现温度 / 传感器 / 显卡等未实现能力', async () => {
  const host = createHost()
  host.reset()
  installMacHost(host)
  const view = await mount(HardwareInfoCommand, host)
  await settle()
  const tree = view.tree()
  const dropdownTitles = tree.props.searchBarAccessory.children.map((c) => c.props.title)
  assert.ok(dropdownTitles.includes('显示器 (Displays)'))
  assert.deepEqual(tree.props.filterBar.actions.map((a) => a.title), ['刷新', '复制Markdown报告'])
  const actionTitles = view.actions(view.item('hw-cpu-spec')).map((a) => a.props.title)
  assert.ok(actionTitles.includes('刷新硬件信息'))
  await view.dropdown('display')
  assert.equal(view.items().length, 1)
  assert.match(view.items()[0].props.subtitle, /刷新率 120Hz/)
  await view.dropdown('report')
  await tree.props.filterBar.actions[0].onAction()
  await settle()
  const visible = view.text() + JSON.stringify(host.toasts)
  // 详情允许说明未检测的能力；这里检查标题、下拉、按钮、动作与提示没有承诺未实现的检测
  const chrome = JSON.stringify({
    placeholder: tree.props.searchBarPlaceholder,
    dropdownTitles,
    bar: tree.props.filterBar,
    actionTitles,
    toasts: host.toasts
  })
  assert.doesNotMatch(chrome, UNIMPLEMENTED)
  assert.doesNotMatch(visible, /传感器|温度/)
  view.unmount()
})

// ---------------- Windows 走通用系统接口、电源三态、部分卷、失败原因 ----------------

/** 与 Windows 真机宿主返回结构一致（get_system_info 带 osBuild，卷路径是盘符） */
function installWindowsHost(host, overrides = {}) {
  host.ipc.system_get_hardware_summary = async () => ({ platform: 'windows', osVersion: '10.0.22631', cpuModels: ['Intel(R) Core(TM) i7-1260P'], logicalCpuCount: 16, totalMemory: 32 * GB })
  host.ipc.get_system_info = async () => ({ success: true, platform: 'windows', osName: 'Windows 11 Pro', osVersion: '10.0.22631', osBuild: 22631, windowsRelease: '10.0.22631', osArch: 'x64' })
  host.ipc.system_get_cpu_usage = async () => ({ total: 7, perCore: [] })
  host.ipc.system_get_memory_usage = async () => ({ total: 32 * GB, used: 12 * GB, available: 20 * GB, percent: 38 })
  host.ipc.system_get_battery_status = async () => ({ success: true, percent: 255, isCharging: false, timeRemaining: -1, batteryState: 'present', powerSource: 'battery' })
  host.ipc.screen_get_all_displays = async () => ({ success: true, displays: [{ id: 7, name: 'DELL U2723QE', bounds: { x: 0, y: 0, width: 2560, height: 1440 }, scaleFactor: 1.5, displayFrequency: 60, colorDepth: 24 }] })
  host.ipc.system_list_volumes = async () => ({ volumes: [
    { path: 'C:\\', label: '系统', fileSystem: 'NTFS', totalBytes: 512 * GB, usedBytes: 300 * GB, availableBytes: 212 * GB, capacityGroup: 'vol-c' },
    { path: 'Z:\\', label: '资料', fileSystem: 'NTFS', totalBytes: 1000 * GB, usedBytes: 100 * GB, availableBytes: 900 * GB, capacityGroup: 'vol-z' }
  ], partial: true, errors: ['D:\\: 卷容量读取失败'] })
  Object.assign(host.ipc, overrides)
}

test('Windows：只走通用系统接口，不再调用 dllplugin_call；电量 255 显示「电量未知」而不是「无电池」', async () => {
  const host = createHost()
  host.reset()
  installWindowsHost(host)
  let dllCalls = 0
  host.ipc.dllplugin_call = async () => { dllCalls++; return { ok: false, errorCode: 'UNSUPPORTED_ACTION', error: '请更新硬件信息插件' } }
  const view = await mount(HardwareInfoCommand, host)
  await settle()
  assert.equal(dllCalls, 0)
  assert.ok(!host.ipcCalls.some(([m]) => m === 'dllplugin_call'))
  for (const method of ['system_get_hardware_summary', 'get_system_info', 'system_get_cpu_usage', 'system_get_memory_usage', 'system_get_battery_status', 'screen_get_all_displays', 'system_list_volumes']) {
    assert.ok(host.ipcCalls.some(([m]) => m === method), `应调用 ${method}`)
  }
  assert.equal(view.item('hw-cpu-spec').props.title, 'Intel(R) Core(TM) i7-1260P')
  const osMd = view.item('hw-os-spec').props.detail.props.markdown
  assert.match(osMd, /电量未知 \(电池放电中\)/)
  assert.doesNotMatch(view.text(), /无电池/)
  // 卷：C 与 Z 照常显示，D 盘失败如实提示原因
  assert.ok(view.item('hw-drive-C:'))
  assert.ok(view.item('hw-drive-Z:'))
  assert.match(view.tree().props.filterBar.summaryText, /2 个分区，可用 1\.1 TB，部分卷读取失败/)
  assert.equal(host.lastToast().style, 'FAILURE')
  assert.equal(host.lastToast().title, '部分硬件信息读取失败')
  assert.equal(host.lastToast().message, '未能读取：部分磁盘卷。磁盘容量：D:\\: 卷容量读取失败')
  view.unmount()
})

test('Windows：部分卷失败时三种报告保留读到的卷、注明不含失败卷并列出原因', async () => {
  const host = createHost()
  host.reset()
  installWindowsHost(host)
  const snap = await fetchHardwareTelemetrySnapshot()
  assert.deepEqual(snap.failures, ['部分磁盘卷'])
  const md = exportHardwareReport(snap, 'markdown')
  assert.match(md, /2 个挂载卷 · 共 1\.5 TB，不含读取失败的卷/)
  assert.match(md, /失败原因: 磁盘容量：D:\\: 卷容量读取失败/)
  assert.match(exportHardwareReport(snap, 'txt'), /物理存储卷明细（部分卷读取失败，未列出）/)
  const json = JSON.parse(exportHardwareReport(snap, 'json'))
  assert.equal(json.storage.partial, true)
  assert.equal(json.storage.readFailed, false)
  assert.equal(json.storage.driveCount, 2)
  assert.deepEqual(json.readWarnings, ['磁盘容量：D:\\: 卷容量读取失败'])
  assert.equal(json.power.batteryState, 'present')
})

test('Windows：卷列表里的畸形条目逐条跳过并记原因，全部畸形才算磁盘读取失败', async () => {
  const host = createHost()
  host.reset()
  installWindowsHost(host, {
    system_list_volumes: async () => ({ volumes: [
      { path: 'C:\\', totalBytes: 100 * GB, usedBytes: 40 * GB, availableBytes: 60 * GB },
      { path: 'D:\\', totalBytes: 100 * GB, usedBytes: null, availableBytes: 10 },
      { path: 'E:\\', totalBytes: '100', usedBytes: 1, availableBytes: 1 },
      null
    ], partial: false, errors: [] })
  })
  let snap = await fetchHardwareTelemetrySnapshot()
  assert.deepEqual(snap.drives.map((d) => d.drive), ['C:'])
  assert.deepEqual(snap.warnings, ['磁盘容量：D:\\：容量数据无效', '磁盘容量：E:\\：容量数据无效', '磁盘容量：未知卷：容量数据无效'])
  assert.deepEqual(snap.failures, ['部分磁盘卷'])
  host.ipc.system_list_volumes = async () => ({ volumes: [{ path: 'D:\\', totalBytes: 0, usedBytes: 0, availableBytes: 0 }], partial: false })
  snap = await fetchHardwareTelemetrySnapshot()
  assert.deepEqual(snap.failures, ['磁盘容量'])
  assert.equal(snap.driveCount, 0)
  // 宿主直接报错：原因写进 warnings
  host.ipc.system_list_volumes = async () => { throw Object.assign(new Error('Get-CimInstance 超时'), { code: 'TIMEOUT' }) }
  snap = await fetchHardwareTelemetrySnapshot()
  assert.deepEqual(snap.failures, ['磁盘容量'])
  assert.match(snap.warnings.join('\n'), /磁盘容量：.*超时/)
})

test('Windows 台式机：宿主报告没有电池时显示「无电池（交流供电）」；卷接口不可用时如实给出原因，旧客户端提示升级', async () => {
  const host = createHost()
  host.reset()
  installWindowsHost(host, {
    system_get_battery_status: async () => ({ success: true, percent: 255, isCharging: true, timeRemaining: -1, batteryState: 'absent', powerSource: 'ac' })
  })
  delete host.ipc.system_list_volumes
  const snap = await fetchHardwareTelemetrySnapshot()
  assert.match(snap.entries.find((e) => e.id === 'hw-os-spec').detailMarkdown, /无电池（交流供电）/)
  assert.deepEqual(snap.failures, ['磁盘容量'])
  assert.equal(snap.warnings.length, 1)
  assert.match(snap.warnings[0], /^磁盘容量：测试宿主未实现 system_list_volumes/)
  host.ipc.system_list_volumes = async () => { throw Object.assign(new Error('未知方法 system_list_volumes'), { code: 'METHOD_NOT_FOUND' }) }
  const old = await fetchHardwareTelemetrySnapshot()
  assert.match(old.warnings[0], /^磁盘容量：读取磁盘卷列表需要新版 ZTools/)
})
