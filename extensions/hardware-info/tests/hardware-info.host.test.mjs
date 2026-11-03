// 本插件的宿主集成测试（导入本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import * as logic from '../dist/logic.js'
import {
  fetchHardwareTelemetrySnapshot,
  exportHardwareReport
} from '../dist/logic.js'

async function withSimulatedRealElectronWindow(methodsMap, fn) {
  const prevWindow = globalThis.window
  globalThis.window = {
    __ztoolsElectron: {
      transport: {
        methods: Object.keys(methodsMap),
        call: async (method, payload) => {
          const handler = methodsMap[method]
          if (!handler) {
            throw new Error(`IPC method not registered: ${method}`)
          }
          return await handler(payload)
        }
      }
    }
  }
  try {
    return await fn()
  } finally {
    if (prevWindow === undefined) {
      delete globalThis.window
    } else {
      globalThis.window = prevWindow
    }
  }
}

test("hardware-info: 插件不再保留旧 DLL 调用入口（宿主旧接口已停用）", async () => {
  // 旧版宿主的 HardwareInfoPlugin 处理器现在只返回「请更新插件」，插件不能再有经 dllplugin_call 的路径
  assert.equal(logic.invokeNativeCapability, undefined)
  assert.equal(logic.DLL_PLUGIN_NAME, undefined)
  const calls = []
  await withSimulatedRealElectronWindow(
    {
      dllplugin_call: async () => { calls.push('dllplugin_call'); throw new Error('不应调用旧 DLL 接口') }
    },
    async () => {
      await fetchHardwareTelemetrySnapshot()
    }
  )
  assert.deepEqual(calls, [])
  const hwSnap = await fetchHardwareTelemetrySnapshot({
    system_get_hardware_summary: async () => ({
      cpuModel: 'AMD Ryzen 9 7950X',
      logicalCpuCount: 32,
      totalMemory: 64 * 1024 * 1024 * 1024,
      osVersion: '10.0.26100'
    }),
    get_system_info: async () => ({
      osName: 'Windows 11 Pro',
      osVersion: '24H2',
      osBuild: 26100,
      osArch: 'x64',
      platform: 'win32',
      appVersion: '2.0.0'
    }),
    system_get_cpu_usage: async () => ({ total: 18, perCore: [18] }),
    system_get_memory_usage: async () => ({
      total: 64 * 1024 * 1024 * 1024,
      used: 20 * 1024 * 1024 * 1024,
      available: 44 * 1024 * 1024 * 1024,
      percent: 31
    }),
    system_get_battery_status: async () => ({ percent: 100, isCharging: true, timeRemaining: 0 }),
    screen_get_all_displays: async () => [{ id: 1, label: '4K Primary', bounds: { x: 0, y: 0, width: 3840, height: 2160 }, scaleFactor: 1.5, displayFrequency: 144 }],
    fs_stat: async () => ({ size: 0, isDirectory: true })
  })
  assert.equal(hwSnap.cpuModel, 'AMD Ryzen 9 7950X')
  assert.equal(hwSnap.logicalCpuCount, 32)
})

// ---- 电源状态：宿主「无电池/未知」约定值 255 不能被改写成 100% ----
function makeHardwareHost(batteryHandler) {
  return {
    system_get_hardware_summary: async () => ({ cpuModel: 'Apple M2', logicalCpuCount: 8, totalMemory: 16 * 1024 ** 3 }),
    get_system_info: async () => ({ osName: 'macOS', osVersion: '15.0', osBuild: 1, osArch: 'arm64' }),
    system_get_cpu_usage: async () => ({ total: 10, perCore: [10] }),
    system_get_memory_usage: async () => ({ total: 16 * 1024 ** 3, used: 8 * 1024 ** 3, available: 8 * 1024 ** 3, percent: 50 }),
    system_get_battery_status: batteryHandler,
    screen_get_all_displays: async () => [{ id: 1, label: 'Studio Display' }]
  }
}

function systemRowMarkdown(snap) {
  return snap.entries.map((e) => e.detailMarkdown || '').find((md) => md.includes('电源/电池状态')) || ''
}

test('hardware-info: 旧版宿主返回 percent 255 时显示「电池状态未知」，不当成无电池，也不出现 100%/放电', async () => {
  // 旧版宿主把「没有电池」「电量未知」「读取失败」都报成 255，插件判断不了，只能写未知
  const snap = await fetchHardwareTelemetrySnapshot(
    makeHardwareHost(async () => ({ success: true, data: { percent: 255, isCharging: false, timeRemaining: -1 } }))
  )
  assert.equal(snap.batteryPercent, null)
  assert.equal(snap.batteryState, 'unknown')
  assert.equal(snap.powerReadFailed, false)
  const md = systemRowMarkdown(snap)
  assert.match(md, /电池状态未知/)
  assert.doesNotMatch(md, /无电池|100%|放电/)
  const txt = exportHardwareReport(snap, 'txt')
  assert.match(txt, /电池状态未知/)
  assert.doesNotMatch(txt, /无电池|电量 100%|电池放电/)
  assert.match(exportHardwareReport(snap, 'markdown'), /电池状态未知/)
  const json = JSON.parse(exportHardwareReport(snap, 'json'))
  assert.equal(json.power.batteryPercent, null)
  assert.equal(json.power.batteryState, 'unknown')
})

test('hardware-info: 新版宿主明确报告没有电池（台式机）才显示「无电池」', async () => {
  const snap = await fetchHardwareTelemetrySnapshot(makeHardwareHost(async () => ({
    success: true, percent: 255, isCharging: true, timeRemaining: -1, batteryState: 'absent', powerSource: 'ac'
  })))
  assert.equal(snap.batteryState, 'absent')
  assert.equal(snap.batteryPercent, null)
  assert.match(systemRowMarkdown(snap), /无电池（交流供电）/)
  assert.deepEqual(snap.failures, ['磁盘容量']) // 本 host 没有提供卷接口
  // 供电来源未知时不补「交流供电」
  const noSource = await fetchHardwareTelemetrySnapshot(makeHardwareHost(async () => ({ percent: 255, isCharging: false, batteryState: 'absent', powerSource: 'unknown' })))
  assert.match(systemRowMarkdown(noSource), /电源\/电池状态\*\*: `无电池`/)
})

test('hardware-info: 新版宿主有电池但电量未知（255）显示「电量未知」，供电来源未知不写成放电', async () => {
  const snap = await fetchHardwareTelemetrySnapshot(makeHardwareHost(async () => ({ percent: 255, isCharging: false, timeRemaining: -1, batteryState: 'present', powerSource: 'unknown' })))
  assert.equal(snap.batteryState, 'present')
  assert.equal(snap.batteryPercent, null)
  assert.match(systemRowMarkdown(snap), /电量未知 \(供电状态未知\)/)
  assert.doesNotMatch(systemRowMarkdown(snap), /无电池|放电|100%/)
  const unknown = await fetchHardwareTelemetrySnapshot(makeHardwareHost(async () => ({ percent: 255, isCharging: false, batteryState: 'unknown', powerSource: 'unknown' })))
  assert.match(systemRowMarkdown(unknown), /电池状态未知/)
})

test('hardware-info: 宿主报告电源读取失败（readError）时标「电源状态读取失败」并给出原因', async () => {
  const snap = await fetchHardwareTelemetrySnapshot(makeHardwareHost(async () => ({
    success: true, percent: 255, isCharging: false, timeRemaining: -1, batteryState: 'unknown', powerSource: 'unknown', readError: '电源状态读取超时'
  })))
  assert.equal(snap.powerReadFailed, true)
  assert.ok(snap.failures.includes('电源状态'))
  assert.ok(snap.warnings.includes('电源状态：读取超时'))
  assert.match(systemRowMarkdown(snap), /电源状态读取失败/)
  assert.match(exportHardwareReport(snap, 'txt'), /失败原因: .*电源状态：读取超时/)
  assert.deepEqual(JSON.parse(exportHardwareReport(snap, 'json')).readWarnings.filter((w) => w.startsWith('电源状态')), ['电源状态：读取超时'])
})

test('hardware-info: 负数 / 非数字 / 小数电量按「电量未知」处理；调用失败标读取失败，都不伪造 100% 或无电池', async () => {
  for (const handler of [
    async () => ({ percent: -1, isCharging: false }),
    async () => ({ percent: 'abc', isCharging: true }),
    async () => ({ percent: 50.5, isCharging: true }),
    async () => ({ isCharging: false })
  ]) {
    const snap = await fetchHardwareTelemetrySnapshot(makeHardwareHost(handler))
    assert.equal(snap.batteryPercent, null)
    assert.equal(snap.powerReadFailed, false)
    assert.doesNotMatch(systemRowMarkdown(snap), /100%|无电池/)
    assert.match(systemRowMarkdown(snap), /电池状态未知/)
  }
  for (const [handler, reason] of [
    [async () => { throw new Error('pmset 超时') }, /pmset 超时/],
    [async () => ({ success: false, error: { code: 'PROCESS_ERROR' } }), /PROCESS_ERROR/],
    [async () => 'garbage', /返回数据无效/]
  ]) {
    const snap = await fetchHardwareTelemetrySnapshot(makeHardwareHost(handler))
    assert.equal(snap.batteryPercent, null)
    assert.equal(snap.powerReadFailed, true)
    assert.match(snap.warnings.join('\n'), reason)
    assert.doesNotMatch(systemRowMarkdown(snap), /100%|无电池/)
  }
})

test('hardware-info: 真实电量（含 0% 与 100% 边界）原样展示并区分供电状态', async () => {
  const low = await fetchHardwareTelemetrySnapshot(makeHardwareHost(async () => ({ percent: 0, isCharging: false })))
  assert.equal(low.batteryPercent, 0)
  assert.match(systemRowMarkdown(low), /电量 0% \(电池放电中\)/)
  const full = await fetchHardwareTelemetrySnapshot(makeHardwareHost(async () => ({ percent: 100, isCharging: true })))
  assert.equal(full.batteryPercent, 100)
  assert.match(exportHardwareReport(full, 'txt'), /电量 100% \(AC 交流供电\)/)
  const mid = await fetchHardwareTelemetrySnapshot(makeHardwareHost(async () => ({ percent: 57, isCharging: false })))
  assert.match(systemRowMarkdown(mid), /电量 57% \(电池放电中\)/)
  const newHost = await fetchHardwareTelemetrySnapshot(makeHardwareHost(async () => ({ percent: 64, isCharging: true, batteryState: 'present', powerSource: 'ac' })))
  assert.match(systemRowMarkdown(newHost), /电量 64% \(AC 交流供电\)/)
})

// ---- 显示器：刷新率 / 色深用宿主真实值，拿不到时显示「未知」，不再用 60Hz / 24-bit / 1920×1080 冒充 ----
function displayEntries(snap) {
  return snap.entries.filter((e) => e.category === 'display')
}

test('hardware-info: 显示器行显示宿主真实刷新率与色深（ProMotion 120Hz / 30-bit）', async () => {
  const host = makeHardwareHost(async () => ({ percent: 80, isCharging: true }))
  host.screen_get_all_displays = async () => ({
    success: true,
    displays: [{ id: 1, name: '内建视网膜显示器', bounds: { x: 0, y: 0, width: 1800, height: 1169 }, workArea: { x: 0, y: 38, width: 1800, height: 1131 }, scaleFactor: 2, displayFrequency: 120, colorDepth: 30, depthPerComponent: 10 }]
  })
  const [row] = displayEntries(await fetchHardwareTelemetrySnapshot(host))
  assert.equal(row.subtitle, '缩放比例 200% · 刷新率 120Hz · 色深 30-bit')
  assert.equal(row.value, '1800×1169 @120Hz')
  assert.match(row.detailMarkdown, /垂直刷新率\*\*: `120 Hz`/)
  assert.match(row.detailMarkdown, /色深\*\*: `30-bit`/)
  assert.doesNotMatch(row.detailMarkdown, /60 Hz|24-bit/)
})

test('hardware-info: 宿主缺少 / 返回异常的显示参数时显示「未知」而不是默认值', async () => {
  for (const display of [
    { id: 1, label: 'Studio Display' },
    { id: 2, label: 'Broken', bounds: { width: 0, height: Number.NaN }, displayFrequency: null, colorDepth: 0 },
    { id: 3, label: 'Garbage', bounds: { width: '1920', height: -1 }, displayFrequency: 'fast', colorDepth: -24 }
  ]) {
    const host = makeHardwareHost(async () => ({ percent: 80, isCharging: true }))
    host.screen_get_all_displays = async () => [display]
    const [row] = displayEntries(await fetchHardwareTelemetrySnapshot(host))
    assert.equal(row.subtitle, '缩放比例 未知 · 刷新率 未知 · 色深 未知', display.label)
    assert.equal(row.tag, '缩放未知')
    assert.equal(row.value, '分辨率未知')
    assert.doesNotMatch(row.detailMarkdown + row.subtitle + row.value, /60Hz|60 Hz|24-bit|1920|1080|100%/)
    assert.match(row.detailMarkdown, /逻辑分辨率\*\*: `未知`/)
  }
})
