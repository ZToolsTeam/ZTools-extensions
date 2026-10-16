import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Command = require('../dist/index.js').default
const {
  DLL_PLUGIN_NAME,
  getCapabilityItems,
  filterCapabilityItems,
  validateInvocationPayload,
  invokeNativeCapability
} = require('../dist/logic.js')

test('process-monitor 声明式视图渲染与端到端 Native 调用集成测试', async () => {
  const view = Command()
  assert.ok(view, '应返回声明式视图描述符')
  assert.equal(view.type, 'List')
  assert.ok(Array.isArray(view.children) && view.children.length === 1)

  const section = view.children[0]
  assert.equal(section.type, 'List.Section')
  assert.ok(section.children.length >= 3, '应渲染预设能力项列表')

  const firstItem = section.children[0]
  assert.equal(firstItem.type, 'List.Item')
  assert.ok(firstItem.props.actions, '每个列表项必须挂载 ActionPanel')

  // 验证模拟宿主桥接全链路调用
  const calls = []
  const mockHost = {
    dllplugin: {
      call: async (plugin, fn, payload) => {
        calls.push({ plugin, fn, payload })
        return JSON.stringify({ status: 'ok', executedMethod: fn })
      }
    }
  }

  const preset = getCapabilityItems()[0]
  const res = await invokeNativeCapability(preset.method, preset.params, mockHost)
  assert.equal(res.ok, true)
  assert.equal(res.pluginName, DLL_PLUGIN_NAME)
  assert.equal(res.fromFallback, false)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].plugin, DLL_PLUGIN_NAME)
  assert.equal(calls[0].fn, preset.method)
})

test('process-monitor 搜索过滤与空值/畸形输入防御测试 (Beyond Happy Path)', () => {
  const items = getCapabilityItems()
  assert.equal(filterCapabilityItems(items, '').length, items.length)
  assert.equal(filterCapabilityItems(items, '   ').length, items.length)
  assert.equal(filterCapabilityItems(items, '__NON_EXISTENT_KEYWORD_999__').length, 0)
  assert.deepEqual(filterCapabilityItems(null, 'test'), [])

  // 非法方法名与空参数校验
  assert.equal(validateInvocationPayload('', {}).valid, false)
  assert.equal(validateInvocationPayload('bad method!', {}).valid, false)
  assert.equal(validateInvocationPayload('ValidMethod', null).valid, false)
  assert.equal(validateInvocationPayload('ValidMethod', []).valid, false)
  assert.equal(validateInvocationPayload('ValidMethod', { num: Number.POSITIVE_INFINITY }).valid, false)
  assert.equal(validateInvocationPayload('ValidMethod', { str: 'a'.repeat(5000) }).valid, false)
})

test('process-monitor 安全规则拦截与底层 DLL 崩溃/乱码故障注入测试', async () => {
  // 1. 业务安全边界拦截
  await assert.rejects(
    () => invokeNativeCapability('TestMethod', { target: "lsass.exe" }),
    /SECURITY_INTERCEPTED/
  )

  // 2. 注入 DLL 子进程崩溃异常
  const crashHost = {
    dllplugin: {
      call: async () => {
        throw new Error('NativeHost32 subprocess terminated unexpectedly (exit code -9)')
      }
    }
  }
  const crashRes = await invokeNativeCapability('GetStatus', {}, crashHost)
  assert.equal(crashRes.ok, false)
  assert.match(crashRes.error, /^NATIVE_CALL_FAILED:/)

  // 3. 注入 DLL 业务错误返回
  const errHost = {
    dllplugin: {
      call: async () => ({ error: 'ACCESS_DENIED_BY_SERVICE' })
    }
  }
  const errRes = await invokeNativeCapability('GetStatus', {}, errHost)
  assert.equal(errRes.ok, false)
  assert.match(errRes.error, /^DLL_ERROR: ACCESS_DENIED_BY_SERVICE/)

  // 4. 注入截断/损坏的 JSON 报文
  const corruptHost = {
    dllplugin: {
      call: async () => '{"corrupted_json": true'
    }
  }
  await assert.rejects(
    () => invokeNativeCapability('GetStatus', {}, corruptHost),
    /MALFORMED_DLL_RESPONSE/
  )
})

test('process-monitor Declarative UI 2.0 顶栏看板与真实进程管控全链路集成测试', async () => {
  const {
    getMockProcesses,
    getMockSystemInfo,
    filterProcesses,
    formatBytes,
    terminateProcess,
    openFileLocation
  } = require('../dist/logic.js')

  const view = Command()
  assert.equal(view.type, 'List')
  assert.equal(view.props.isShowingDetail, true, '必须开启 Master-Detail 左右双栏')

  // 1. 验证顶栏 MetricGrid 看板存在并拥有 4 个核心监控指标
  assert.ok(view.props.metricGrid, '应挂载 MetricGrid 系统指标看板')
  assert.equal(view.props.metricGrid.type, 'MetricGrid')
  assert.equal(view.props.metricGrid.props.items.length, 4, '应包含 CPU、内存、进程数、线程数 4 大指标')
  assert.equal(view.props.metricGrid.props.items[0].id, 'metric-cpu')
  assert.equal(view.props.metricGrid.props.items[1].id, 'metric-mem')

  // 2. 验证顶栏 SegmentedControl 分段选择器
  assert.ok(view.props.segmentedControl, '应挂载 SegmentedControl 顶栏分段导航')
  assert.equal(view.props.segmentedControl.type, 'SegmentedControl')
  assert.equal(view.props.segmentedControl.props.options.length, 3, '应包含 全部/用户/系统 3 个选项')

  // 3. 验证真实进程列表与 Detail 详情画像
  const section = view.children[0]
  assert.ok(section.children.length > 0)
  const firstProcItem = section.children[0]
  assert.ok(firstProcItem.props.detail, '每个进程条目必须配备详细的 Markdown 深度画像')
  assert.ok(firstProcItem.props.accessories.length >= 3, '每个条目必须展示分类 Tag、CPU% 和内存占用')

  // 4. 验证排序与过滤逻辑
  const mockProcs = getMockProcesses()
  const userProcs = filterProcesses(mockProcs, '', 'user')
  assert.ok(userProcs.every(p => !p.isSystem), '用户应用过滤不应包含系统进程')
  const systemProcs = filterProcesses(mockProcs, '', 'system')
  assert.ok(systemProcs.every(p => p.isSystem), '系统进程过滤应全为系统进程')

  // 验证搜索过滤
  const chromeSearch = filterProcesses(mockProcs, 'chrome', 'all')
  assert.equal(chromeSearch.length, 1)
  assert.equal(chromeSearch[0].name, 'chrome.exe')

  // 5. 验证 formatBytes
  assert.equal(formatBytes(1024), '1 KB')
  assert.equal(formatBytes(1024 * 1024 * 50), '50 MB')
  assert.equal(formatBytes(1024 * 1024 * 1024 * 2.5), '2.5 GB')

  // 6. 验证防误杀保护
  const killSystem = await terminateProcess(4, 'System')
  assert.equal(killSystem.ok, false)
  assert.match(killSystem.error, /受保护/)

  const killCsrss = await terminateProcess(612, 'csrss.exe')
  assert.equal(killCsrss.ok, false)
  assert.match(killCsrss.error, /受保护/)
})

test('process-monitor 多维排序、资源焦点、服务穿透与三种终结模式集成与故障注入测试', async () => {
  const {
    getMockProcesses,
    getResourceFocus,
    filterProcesses,
    fetchProcessDetail,
    fetchServicesByPID,
    terminateProcess
  } = require('../dist/logic.js')

  const view = Command()
  // 验证排序下拉框挂载
  assert.ok(view.props.searchBarAccessory, '应挂载排序维度下拉框 searchBarAccessory')
  assert.equal(view.props.searchBarAccessory.type, 'List.Dropdown')
  assert.equal(view.props.searchBarAccessory.children.length, 4)

  const mockProcs = getMockProcesses()

  // 1. 验证多维排序 (cpu / memory / name / pid)
  const byCpu = filterProcesses(mockProcs, '', 'all', 'cpu')
  assert.equal(byCpu[0].name, 'chrome.exe')

  const byMem = filterProcesses(mockProcs, '', 'all', 'memory')
  assert.equal(byMem[0].name, 'chrome.exe')
  assert.ok(byMem[0].workingSetBytes >= byMem[1].workingSetBytes)

  const byName = filterProcesses(mockProcs, '', 'all', 'name')
  assert.ok(byName[0].name.localeCompare(byName[1].name) <= 0)

  const byPid = filterProcesses(mockProcs, '', 'all', 'pid')
  assert.equal(byPid[0].pid, 4)
  assert.ok(byPid[0].pid < byPid[1].pid)

  // 2. 验证全局资源焦点 (Resource Focus)
  const focus = getResourceFocus(mockProcs)
  assert.equal(focus.topCpu?.name, 'chrome.exe')
  assert.equal(focus.topMemory?.name, 'chrome.exe')
  assert.deepEqual(getResourceFocus([]), { topCpu: null, topMemory: null })

  // 3. 验证进程详情与 Windows 服务穿透 (含宿主模拟与异常降级)
  const svchostServices = await fetchServicesByPID(1044)
  assert.ok(svchostServices.length >= 2)
  assert.equal(svchostServices[0].serviceName, 'DcomLaunch')
  assert.deepEqual(await fetchServicesByPID(-1), [])

  const chromeDetail = await fetchProcessDetail(14208)
  assert.ok(chromeDetail)
  assert.equal(chromeDetail.pid, 14208)
  assert.equal(await fetchProcessDetail(0), null)

  // 4. 验证三种终结模式 (force / tree / graceful) 与 dllplugin_call 传输桥接
  const recordedCalls = []
  const transportHost = {
    dllplugin_call: async (payload) => {
      recordedCalls.push(payload)
      return {
        success: true,
        data: { terminated: true, pid: payload.params.pid, mode: payload.params.mode }
      }
    }
  }

  const forceRes = await terminateProcess(14208, 'chrome.exe', 'force', transportHost)
  assert.equal(forceRes.ok, true)
  assert.equal(forceRes.mode, 'force')

  const treeRes = await terminateProcess(19844, 'Code.exe', 'tree', transportHost)
  assert.equal(treeRes.ok, true)
  assert.equal(treeRes.mode, 'tree')

  const gracefulRes = await terminateProcess(28440, 'node.exe', 'graceful', transportHost)
  assert.equal(gracefulRes.ok, true)
  assert.equal(gracefulRes.mode, 'graceful')

  assert.equal(recordedCalls.length, 3)
  assert.equal(recordedCalls[0].params.mode, 'force')
  assert.equal(recordedCalls[1].params.mode, 'tree')
  assert.equal(recordedCalls[1].params.tree, true)
  assert.equal(recordedCalls[2].params.mode, 'graceful')
  assert.equal(recordedCalls[2].params.force, false)

  // 5. 故障注入：非法负数 PID 拦截
  const badPidRes = await terminateProcess(-5, 'unknown.exe', 'force', transportHost)
  assert.equal(badPidRes.ok, false)
  assert.match(badPidRes.error, /INVALID_PID/)
})


