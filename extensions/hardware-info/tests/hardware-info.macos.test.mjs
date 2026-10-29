// hardware-info：macOS 真机行为与刷新时序的回归测试
// 覆盖：CPU 负载两次采样、磁盘容量按访达的 1000 进制显示、卷名、产品版本 unknown、并发刷新与卸载后不更新
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import HardwareInfoCommand from '../dist/index.js'
import { exportHardwareReport, fetchHardwareTelemetrySnapshot, formatStorageBytes, CPU_SAMPLE_INTERVAL_MS } from '../dist/logic.js'

const GB = 1024 ** 3
// 与本机 df -k 一致的 APFS 容器：482797652 KiB ≈ 494.4 GB（访达显示 494.38 GB）
const CONTAINER = 482797652 * 1024
const FREE = 376506500 * 1024

function macHost(overrides = {}) {
  return {
    system_get_hardware_summary: async () => ({ platform: 'macos', osVersion: '26.5.1', cpuModels: ['Apple M1 Pro'], logicalCpuCount: 8, totalMemory: 16 * GB }),
    get_system_info: async () => ({ success: true, platform: 'macos', osName: 'macOS', osVersion: '26.5.1', kernelRelease: '25.5.0', osArch: 'arm64' }),
    system_get_cpu_usage: async () => ({ total: 10, perCore: [] }),
    system_get_memory_usage: async () => ({ total: 16 * GB, used: 8 * GB, available: 8 * GB, percent: 50 }),
    system_get_battery_status: async () => ({ success: true, percent: 100, isCharging: true, timeRemaining: -1, batteryState: 'present', powerSource: 'ac' }),
    screen_get_all_displays: async () => [{ id: 1, label: 'Built-in Retina Display', bounds: { x: 0, y: 0, width: 1512, height: 982 }, scaleFactor: 2, displayFrequency: 120, colorDepth: 30 }],
    system_list_volumes: async () => ({ volumes: [
      { path: '/', label: 'Macintosh HD', fileSystem: 'APFS', totalBytes: CONTAINER, usedBytes: CONTAINER - FREE, availableBytes: FREE, capacityGroup: 'disk3' },
      { path: '/Volumes/外置', label: '外置', fileSystem: 'APFS', totalBytes: 1000 ** 4, usedBytes: 0.5 * 1000 ** 4, availableBytes: 0.5 * 1000 ** 4, capacityGroup: 'disk5' }
    ], partial: false, errors: [] }),
    ...overrides
  }
}

test('CPU 负载取第二次采样：第一次是距上次调用的长期平均值，不能当作当前负载', async () => {
  const samples = [93, 7]
  let calls = 0
  const started = Date.now()
  const snap = await fetchHardwareTelemetrySnapshot(macHost({
    system_get_cpu_usage: async () => ({ total: samples[calls++], perCore: [] })
  }), { cpuSampleIntervalMs: 30 })
  assert.equal(calls, 2)
  assert.equal(snap.cpuUsagePercent, 7)
  assert.ok(Date.now() - started >= 25, '两次采样之间要有间隔')
})

test('CPU 采样：第一次失败直接报失败不再取第二次；第二次失败也如实报失败，不用第一次的值顶替', async () => {
  let calls = 0
  let snap = await fetchHardwareTelemetrySnapshot(macHost({
    system_get_cpu_usage: async () => { calls++; throw new Error('采样被拒绝') }
  }), { cpuSampleIntervalMs: 0 })
  assert.equal(calls, 1)
  assert.equal(snap.cpuUsagePercent, null)
  assert.ok(snap.failures.includes('CPU 负载'))
  assert.ok(snap.warnings.some((w) => w.includes('采样被拒绝')))
  assert.equal(snap.loadHeadroomPercent, null)

  calls = 0
  snap = await fetchHardwareTelemetrySnapshot(macHost({
    system_get_cpu_usage: async () => { if (calls++ === 0) return { total: 40, perCore: [] }; throw new Error('第二次超时') }
  }), { cpuSampleIntervalMs: 0 })
  assert.equal(calls, 2)
  assert.equal(snap.cpuUsagePercent, null)
  assert.ok(snap.warnings.some((w) => w.includes('第二次超时')))
})

test('macOS：磁盘容量按 1000 进制显示（与访达一致），同一容器不重复计算；内存仍按 1024 进制', async () => {
  const snap = await fetchHardwareTelemetrySnapshot(macHost(), { cpuSampleIntervalMs: 0 })
  const root = snap.entries.find((e) => e.id === 'hw-drive-/')
  assert.equal(root.title, '存储卷 Macintosh HD (/)')
  assert.equal(root.tag, '494 GB')
  assert.match(root.detailMarkdown, /1000³ 字节/)
  assert.match(root.detailMarkdown, /文件系统\*\*: `APFS`/)
  const mem = snap.entries.find((e) => e.id === 'hw-mem-spec')
  assert.equal(mem.tag, '16.0 GB')
  for (const report of [exportHardwareReport(snap, 'markdown'), exportHardwareReport(snap, 'txt')]) {
    assert.match(report, /Macintosh HD \(\/\)/)
    assert.match(report, /494 GB/)
    assert.doesNotMatch(report, /460 GB/)
  }
  // JSON 只给字节数，单位换算不影响原始值
  const json = JSON.parse(exportHardwareReport(snap, 'json'))
  assert.equal(json.storage.drives[0].totalBytes, CONTAINER)
  // 场景估算里的可用空间与列表同一单位
  const media = snap.entries.find((e) => e.id === 'sc-4k-media')
  assert.match(media.subtitle, new RegExp(formatStorageBytes(snap.availableDiskBytes, true).replace('.', '\\.')))
})

test('Windows：磁盘容量仍按 1024 进制显示（与资源管理器一致），无卷名时只写盘符', async () => {
  const snap = await fetchHardwareTelemetrySnapshot({
    ...macHost(),
    system_get_hardware_summary: async () => ({ platform: 'windows', cpuModels: ['Intel'], logicalCpuCount: 8, totalMemory: 16 * GB }),
    get_system_info: async () => ({ success: true, platform: 'windows', osName: 'Windows 11 Pro', osVersion: '10.0.22631', osBuild: 22631, windowsRelease: '10.0.22631', osArch: 'x64' }),
    system_list_volumes: async () => ({ volumes: [{ path: 'C:\\', label: 'C:\\', fileSystem: 'NTFS', totalBytes: 512 * GB, usedBytes: 12 * GB, availableBytes: 500 * GB, capacityGroup: 'c' }], partial: false })
  }, { cpuSampleIntervalMs: 0 })
  const c = snap.entries.find((e) => e.id === 'hw-drive-C:')
  assert.equal(c.title, '存储卷 C:')
  assert.equal(c.tag, '512 GB')
  assert.doesNotMatch(c.detailMarkdown, /访达/)
})

test('formatStorageBytes 边界：0 / 负数 / NaN 显示 0 B，1000 进制跨越 TB', () => {
  assert.equal(formatStorageBytes(0, true), '0 B')
  assert.equal(formatStorageBytes(-5, true), '0 B')
  assert.equal(formatStorageBytes(Number.NaN, true), '0 B')
  assert.equal(formatStorageBytes(999, true), '999 B')
  assert.equal(formatStorageBytes(1000, true), '1.0 KB')
  assert.equal(formatStorageBytes(2 * 1000 ** 4, true), '2.0 TB')
})

test('macOS：宿主读不到产品版本返回 unknown 时按读取失败处理，不显示「macOS unknown」；平台回落到硬件摘要', async () => {
  const snap = await fetchHardwareTelemetrySnapshot(macHost({
    get_system_info: async () => ({ success: true, platform: 'macos', osName: 'macOS', osVersion: 'unknown', kernelRelease: '25.5.0', osArch: 'arm64' }),
    system_get_hardware_summary: async () => ({ platform: 'macos', osVersion: '', cpuModels: ['Apple M1 Pro'], logicalCpuCount: 8, totalMemory: 16 * GB })
  }), { cpuSampleIntervalMs: 0 })
  assert.equal(snap.osVersion, null)
  assert.doesNotMatch(exportHardwareReport(snap, 'markdown') + JSON.stringify(snap.entries), /unknown/i)

  // get_system_info 整个失败时，平台取硬件摘要里的 macos，磁盘仍按访达单位显示
  const fallback = await fetchHardwareTelemetrySnapshot(macHost({
    get_system_info: async () => { throw new Error('系统信息读取失败') }
  }), { cpuSampleIntervalMs: 0 })
  assert.equal(fallback.platform, 'macos')
  assert.equal(fallback.entries.find((e) => e.id === 'hw-drive-/').tag, '494 GB')
  assert.ok(!fallback.failures.includes('系统版本'), '硬件摘要给了版本号时不算系统版本读取失败')
})

test('显示器：macOS 缩放写成「缩放比例 200%」，不写 Windows 的 DPI 说法', async () => {
  const snap = await fetchHardwareTelemetrySnapshot(macHost(), { cpuSampleIntervalMs: 0 })
  const disp = snap.entries.find((e) => e.category === 'display')
  assert.equal(disp.subtitle, '缩放比例 200% · 刷新率 120Hz · 色深 30-bit')
  assert.equal(disp.tag, '缩放 200%')
  assert.doesNotMatch(JSON.stringify(disp), /DPI/)
})

function installMountedMacHost(host, handlers = macHost()) {
  for (const [method, fn] of Object.entries(handlers)) host.ipc[method] = fn
}

test('先发出的慢请求晚返回时，不能覆盖后一次刷新的结果，也不弹过期提示', async () => {
  const host = createHost()
  host.reset()
  let releaseSlow
  let firstLoad = true
  installMountedMacHost(host, macHost({
    system_get_hardware_summary: async () => {
      if (firstLoad) {
        firstLoad = false
        await new Promise((r) => { releaseSlow = r })
        return { platform: 'macos', cpuModels: ['旧数据处理器'], logicalCpuCount: 8, totalMemory: 16 * GB }
      }
      return { platform: 'macos', cpuModels: ['Apple M1 Pro'], logicalCpuCount: 8, totalMemory: 16 * GB }
    }
  }))
  const view = await mount(HardwareInfoCommand, host)
  await tick(5)
  await view.tree().props.filterBar.actions.find((a) => a.id === 'refresh-hw').onAction()
  await new Promise((r) => setTimeout(r, CPU_SAMPLE_INTERVAL_MS + 80))
  await tick(20)
  assert.equal(view.item('hw-cpu-spec').props.title, 'Apple M1 Pro')
  const toastsBefore = host.toasts.length
  releaseSlow()
  await new Promise((r) => setTimeout(r, CPU_SAMPLE_INTERVAL_MS + 80))
  await tick(20)
  assert.equal(view.item('hw-cpu-spec').props.title, 'Apple M1 Pro')
  assert.equal(host.toasts.length, toastsBefore)
  view.unmount()
})

test('卸载后读取才完成：不再弹提示（包括失败提示）', async () => {
  const host = createHost()
  host.reset()
  installMountedMacHost(host, macHost({
    system_get_memory_usage: async () => { throw new Error('内存读取失败') }
  }))
  const view = await mount(HardwareInfoCommand, host)
  view.unmount()
  await new Promise((r) => setTimeout(r, CPU_SAMPLE_INTERVAL_MS + 80))
  await tick(20)
  assert.equal(host.toasts.length, 0)
})

test('数据还没读到时复制报告：如实提示尚未读取完成，不静默无反应', async () => {
  const host = createHost()
  host.reset()
  installMountedMacHost(host)
  const view = await mount(HardwareInfoCommand, host)
  await view.tree().props.filterBar.actions.find((a) => a.id === 'export-md').onAction()
  assert.equal(host.lastToast().style, 'FAILURE')
  assert.equal(host.lastToast().title, '硬件信息尚未读取完成')
  assert.equal(host.clipboard.text, '')
  await new Promise((r) => setTimeout(r, CPU_SAMPLE_INTERVAL_MS + 80))
  view.unmount()
})
