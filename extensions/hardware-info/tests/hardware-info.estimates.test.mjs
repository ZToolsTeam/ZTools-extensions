import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import HardwareInfoCommand from '../dist/index.js'
import { evaluateHardwareScenarios, fetchHardwareTelemetrySnapshot, exportHardwareReport, CPU_SAMPLE_INTERVAL_MS } from '../dist/logic.js'

const GB = 1024 ** 3
function installHost(host, cpu = 20, memory = 60) {
  host.ipc.system_get_hardware_summary = () => ({ cpuModel: '测试处理器', logicalCpuCount: 8, totalMemory: 16 * GB })
  host.ipc.system_get_cpu_usage = () => ({ total: cpu })
  host.ipc.system_get_memory_usage = () => ({ total: 16 * GB, used: memory / 100 * 16 * GB, available: (100 - memory) / 100 * 16 * GB, percent: memory })
  host.ipc.get_system_info = () => ({ platform: 'macos', osName: 'macOS', osVersion: '26.0', kernelRelease: '25.0', osArch: 'arm64' })
  host.ipc.system_get_battery_status = () => ({ percent: 80, isCharging: true })
  host.ipc.screen_get_all_displays = () => []
  host.ipc.system_list_volumes = () => ({ volumes: [{ path: '/', label: '测试卷', fileSystem: 'APFS', totalBytes: 100 * GB, usedBytes: 60 * GB, availableBytes: 40 * GB, capacityGroup: 'fixture' }], partial: false })
}

test('缺失、非数字或非法规格不能被补成8线程16GB再评分', () => {
  for (const snapshot of [{}, { logicalCpuCount: 8 }, { totalMemoryBytes: 16 * GB },
    { logicalCpuCount: 0, totalMemoryBytes: 16 * GB }, { logicalCpuCount: 1.5, totalMemoryBytes: 16 * GB },
    { logicalCpuCount: 8, totalMemoryBytes: Infinity }, { logicalCpuCount: '8', totalMemoryBytes: 16 * GB }]) {
    assert.deepEqual(evaluateHardwareScenarios(snapshot), [], JSON.stringify(snapshot))
  }
  assert.deepEqual(evaluateHardwareScenarios(8), [])
  assert.deepEqual(evaluateHardwareScenarios(NaN, 16 * GB), [])
})

test('未知磁盘不补128GB，零剩余空间仍作为真实值处理', () => {
  for (const snapshot of [{ logicalCpuCount: 8, totalMemoryBytes: 16 * GB },
    { logicalCpuCount: 8, totalMemoryBytes: 16 * GB, availableDiskBytes: NaN },
    { logicalCpuCount: 8, totalMemoryBytes: 16 * GB, availableDiskBytes: 40 * GB, failures: ['磁盘容量'] }]) {
    const media = evaluateHardwareScenarios(snapshot).find(s => s.id === 'sc-4k-media')
    assert.match(media.bottleneckHint, /读取失败/)
    assert.doesNotMatch(JSON.stringify(media), /128\.0 GB|高速存储|吞吐表现良好/)
  }
  assert.match(evaluateHardwareScenarios(8, 16 * GB, 0)[1].bottleneckHint, /空间偏紧/)
})

test('空闲余量显示真实边界，满负载不能再给健康高分', async () => {
  const host = createHost()
  for (const [cpu, memory, expected] of [[0, 0, 100], [100, 100, 0], [20, 60, 40], [90, 10, 10]]) {
    installHost(host, cpu, memory)
    const snap = await fetchHardwareTelemetrySnapshot()
    assert.equal(snap.loadHeadroomPercent, expected)
    assert.equal('healthScore' in snap, false)
    const report = JSON.parse(exportHardwareReport(snap, 'json'))
    assert.equal(report.loadHeadroomPercent, expected)
    assert.equal(report.assessment.scenarios, 'spec-estimate')
    assert.equal(report.assessment.performanceMeasured, false)
  }
  host.ipc.system_get_cpu_usage = () => { throw new Error('读取失败') }
  assert.equal((await fetchHardwareTelemetrySnapshot()).loadHeadroomPercent, null)
})

test('越界负载与未知磁盘不冒充真实100%或零容量', async () => {
  const host = createHost()
  for (const bad of [180, -1, NaN, Infinity, '20']) {
    installHost(host, bad, bad)
    const snap = await fetchHardwareTelemetrySnapshot()
    assert.equal(snap.cpuUsagePercent, null)
    assert.equal(snap.memoryUsagePercent, null)
    assert.equal(snap.loadHeadroomPercent, null)
    assert.ok(snap.failures.includes('CPU 负载'))
    assert.ok(snap.failures.includes('内存占用'))
  }
  installHost(host)
  for (const response of [{ volumes: [], partial: false }, { volumes: [], partial: true, errors: ['拒绝访问'] }]) {
    host.ipc.system_list_volumes = () => response
    const snap = await fetchHardwareTelemetrySnapshot()
    const report = JSON.parse(exportHardwareReport(snap, 'json'))
    assert.deepEqual(report.storage, { readFailed: true, driveCount: null, totalBytes: null, availableBytes: null, drives: [] })
    assert.doesNotMatch(exportHardwareReport(snap, 'markdown'), /0 个挂载卷|共 0 B/)
  }
})

test('列表详情和复制报告都标明估算，不承诺游戏帧率、大模型速度或硬件健康', async () => {
  const host = createHost(); installHost(host)
  const view = await mount(HardwareInfoCommand, host)
  try {
    await new Promise((r) => setTimeout(r, CPU_SAMPLE_INTERVAL_MS + 80))
    await tick(20)
    await view.dropdown('benchmark')
    assert.equal(view.items().length, 4)
    for (const item of view.items()) {
      assert.match(item.props.detail.props.markdown, /估算/)
      assert.match(item.props.detail.props.markdown, /线程数.*内存容量/)
      assert.match(JSON.stringify(item.props.accessories), /估算/)
      assert.doesNotMatch(item.props.detail.props.markdown, /实测兼容性|极致流畅|轻松承载|零延迟直连|流畅运行|高画质纹理加载需求/)
    }
    await view.dropdown('report')
    await view.run(view.item('report-md'), '复制 Markdown 硬件报告到剪贴板')
    assert.match(host.clipboard.text, /规格估算/)
    assert.match(host.clipboard.text, /未运行性能测试/)
    assert.doesNotMatch(host.clipboard.text, /实测兼容性|健康度|性能评测报告/)
    const snap = await fetchHardwareTelemetrySnapshot()
    assert.match(exportHardwareReport(snap, 'txt'), /空闲余量/)
    assert.doesNotMatch(exportHardwareReport(snap, 'txt'), /健康度|综合健康评分/)
  } finally { view.unmount() }
})

test('状态条不再紧挨 CPU 负载显示“余量”，下拉与按钮不带英文括注，CPU 详情不用 [!TIP] 写法', async () => {
  const host = createHost()
  installHost(host, 29, 63)
  const view = await mount(HardwareInfoCommand, host)
  try {
    for (let i = 0; i < 20 && view.tree().props.isLoading; i++) await tick()
    await new Promise(r => setTimeout(r, CPU_SAMPLE_INTERVAL_MS + 50)); await tick()
    const tree = view.tree()
    assert.match(tree.props.filterBar.summaryText, /^CPU 8 线程/)
    assert.doesNotMatch(tree.props.filterBar.summaryText, /余量/)
    const titles = tree.props.searchBarAccessory.children.map(c => c.props.title)
    assert.ok(titles.includes('全部硬件模块'))
    assert.ok(titles.every(t => !/[A-Za-z]{3,}\)/.test(t)), titles.join(','))
    assert.ok(tree.props.filterBar.actions.some(a => a.title === '复制 Markdown 报告'))
    const md = view.item('hw-cpu-spec').props.detail.props.markdown
    assert.doesNotMatch(md, /\[!TIP\]/)
    assert.match(md, /^# 中央处理器\n/)
  } finally { view.unmount() }
  // 报告里仍给出空闲余量，读取失败时不计算
  const snap = await fetchHardwareTelemetrySnapshot()
  assert.match(exportHardwareReport(snap, 'markdown'), /空闲余量/)
})

test('场景估算只给档位不给分数，档位与阈值一致，场景名不带英文括注', async () => {
  // 12 线程 + 16 GB：旧版“3A 游戏”是“规格参考一般”而分数却低于“4K 剪辑”，互相矛盾
  for (const [cores, ram] of [[8, 16], [12, 16], [16, 32], [4, 8]]) {
    const list = evaluateHardwareScenarios(cores, ram * GB, 100 * GB)
    assert.equal(list.length, 4)
    for (const sc of list) {
      assert.equal('score' in sc, false, sc.id)
      assert.doesNotMatch(sc.scenario, /[(（][A-Za-z /]+[)）]/, sc.scenario)
    }
  }
  const host = createHost(); installHost(host)
  const view = await mount(HardwareInfoCommand, host)
  try {
    await new Promise((r) => setTimeout(r, CPU_SAMPLE_INTERVAL_MS + 80))
    await tick(20)
    await view.dropdown('benchmark')
    for (const item of view.items()) {
      const text = JSON.stringify(item.props.accessories) + item.props.detail.props.markdown
      assert.doesNotMatch(text, /\d+\s*分|\/ 100/, item.props.title)
    }
    const snap = await fetchHardwareTelemetrySnapshot()
    for (const format of ['markdown', 'txt']) {
      const report = exportHardwareReport(snap, format)
      assert.doesNotMatch(report, /估算 \d+分|\((CPU|RAM|OS)\)|Ollama/, format)
    }
  } finally { view.unmount() }
})
