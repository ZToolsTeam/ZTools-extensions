// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout1-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchHardwareTelemetrySnapshot,
  exportHardwareReport,
  invokeNativeCapability as invokeHardwareInfoCapability
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

test("P09 & P10 process-monitor / hardware-info: 真实宿主下严禁返回 simulated:true 或假进程详情（hardware-info 部分）", async () => {
  await withSimulatedRealElectronWindow(
    {
      dllplugin_call: async () => {
        throw new Error('Native DLL 调用失败')
      },
      process_list: async () => [],
      process_info: async () => {
        throw new Error('PID 不存在')
      }
    },
    async () => {
    const hwCap = await invokeHardwareInfoCapability('GetHardwareSummary', {})
    assert.equal(hwCap.ok, false)
    assert.equal(hwCap.data?.simulated, undefined)
}
  )
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

test('hardware-info: 宿主返回 percent 255（无电池）时显示「无电池（交流供电）」，详情与三种报告都不出现 100%/放电', async () => {
  // 真实宿主结构：{ success, data: { percent: 255, isCharging: false, timeRemaining: -1 } }
  const snap = await fetchHardwareTelemetrySnapshot(
    makeHardwareHost(async () => ({ success: true, data: { percent: 255, isCharging: false, timeRemaining: -1 } }))
  )
  assert.equal(snap.batteryPercent, null)
  const md = systemRowMarkdown(snap)
  assert.match(md, /无电池（交流供电）/)
  assert.doesNotMatch(md, /100%|放电/)
  const txt = exportHardwareReport(snap, 'txt')
  assert.match(txt, /无电池（交流供电）/)
  assert.doesNotMatch(txt, /电量 100%|电池放电/)
  assert.match(exportHardwareReport(snap, 'markdown'), /无电池（交流供电）/)
  assert.equal(JSON.parse(exportHardwareReport(snap, 'json')).power.batteryPercent, null)
})

test('hardware-info: 负数 / 非数字 / 调用失败的电量都按无电池处理，不伪造 100%', async () => {
  for (const handler of [
    async () => ({ percent: -1, isCharging: false }),
    async () => ({ percent: 'abc', isCharging: true }),
    async () => ({ isCharging: false }),
    async () => { throw new Error('pmset 超时') },
    async () => ({ success: false, error: { code: 'PROCESS_ERROR' } })
  ]) {
    const snap = await fetchHardwareTelemetrySnapshot(makeHardwareHost(handler))
    assert.equal(snap.batteryPercent, null)
    assert.doesNotMatch(systemRowMarkdown(snap), /100%/)
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
  assert.equal(row.subtitle, 'DPI 缩放 200% · 刷新率 120Hz · 色深 30-bit')
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
    assert.equal(row.subtitle, 'DPI 缩放 100% · 刷新率 未知 · 色深 未知', display.label)
    assert.equal(row.value, '分辨率未知')
    assert.doesNotMatch(row.detailMarkdown + row.subtitle + row.value, /60Hz|60 Hz|24-bit|1920|1080/)
    assert.match(row.detailMarkdown, /逻辑分辨率\*\*: `未知`/)
  }
})
