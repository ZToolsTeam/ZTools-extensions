import test from 'node:test'
import assert from 'node:assert/strict'

import {
  formatBytes,
  getMockSoftwareList,
  getMockSoftwareSummary,
  fetchSoftwareList,
  fetchSoftwareSummary,
  mapRecordToSoftwareItem,
  filterSoftwareList,
  uninstallSoftware,
  openSoftwareLocation,
  launchSoftware,
  invokeNativeCapability,
  FORBIDDEN_SOFTWARE_PATTERN,
  FORBIDDEN_UNINSTALL_REASON,
  PROTECTED_SYSTEM_SOFTWARE_PATTERN
} from '../dist/logic.js'

test('software-manager 声明式视图数据与端到端 Native 调用集成测试', async () => {
  const list = getMockSoftwareList()
  assert.ok(Array.isArray(list), '软件列表应为数组')
  assert.ok(list.length >= 5, 'Mock 软件列表应至少包含 5 款代表性软件')

  const chrome = list.find(s => s.name.includes('Chrome'))
  assert.ok(chrome, '应包含 Chrome 软件')
  assert.equal(chrome.category, 'desktop', 'Chrome 应归类为桌面程序')
  assert.ok(chrome.estimatedSize > 1024 * 1024 * 1024, 'Chrome 估算体积应大于 1GB')

  const summary = getMockSoftwareSummary(list)
  assert.equal(summary.totalCount, list.length)
  assert.ok(summary.totalSizeBytes > 0, '总空间占用应大于 0')
  assert.ok(summary.silentSupportedCount > 0, '支持静默卸载的软件数应大于 0')

  // 测试 Native 桥接调用 (Mock 回退模式)
  const invokeRes = await invokeNativeCapability('GetAllSoftware', {})
  assert.equal(invokeRes.ok, true, '离线调用应平滑降级并成功')
  assert.equal(invokeRes.fromFallback, true, '无 Native 宿主时应标记为 fallback')
})

test('software-manager 搜索过滤与空值/畸形输入防御测试 (Beyond Happy Path)', () => {
  const list = getMockSoftwareList()

  // 1. 空输入 / 全空格防御
  assert.equal(filterSoftwareList(list, '', 'all').length, list.length)
  assert.equal(filterSoftwareList(list, '   ', 'all').length, list.length)

  // 2. 畸形入参防御
  assert.deepEqual(filterSoftwareList(null, 'chrome', 'all'), [])
  assert.deepEqual(filterSoftwareList(undefined, 'chrome', 'all'), [])

  // 3. 分类过滤
  const desktopApps = filterSoftwareList(list, '', 'desktop')
  assert.ok(desktopApps.every(s => s.category === 'desktop'), '桌面应用分段内应全是 desktop')

  const storeApps = filterSoftwareList(list, '', 'store')
  assert.ok(storeApps.every(s => s.category === 'store'), '应用商店分段内应全是 store')

  const runtimeApps = filterSoftwareList(list, '', 'runtime')
  assert.ok(runtimeApps.every(s => s.category === 'runtime' || s.isSystem), '运行库分段内应全是 runtime 或系统库')

  // 4. 不区分大小写与拼写检索
  const searchVscode = filterSoftwareList(list, 'vscode', 'all')
  assert.ok(searchVscode.length >= 1, '应模糊匹配到 Visual Studio Code')
  assert.equal(searchVscode[0].name, 'Visual Studio Code')

  // 5. 格式化极端值防御
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(-100), '0 B')
  assert.equal(formatBytes(NaN), '0 B')
  assert.equal(formatBytes(1024), '1.0 KB')
  assert.equal(formatBytes(1024 * 1024 * 1024 * 2.5), '2.5 GB')
})

test('software-manager 安全规则拦截与核心组件防护测试', async () => {
  // 1. 尝试卸载核心 Windows 操作系统
  const forbiddenItem = {
    id: 'windows-os-core',
    name: 'Microsoft Windows',
    version: '11.0.22631',
    publisher: 'Microsoft Corporation',
    installDate: '2026-01-01',
    estimatedSize: 20 * 1024 * 1024 * 1024,
    installLocation: 'C:\\Windows',
    uninstallString: 'setup.exe /clean',
    category: 'runtime',
    isSystem: true
  }

  assert.ok(FORBIDDEN_SOFTWARE_PATTERN.test(forbiddenItem.name), '应命中受禁卸载软件名单')
  const result = await uninstallSoftware(forbiddenItem, false)
  assert.equal(result.ok, false, '卸载核心操作系统必须被拦截')
  assert.equal(result.error, FORBIDDEN_UNINSTALL_REASON, '应返回保护原因提示')

  // 2. 检查运行库保护判定
  const vcRedist = {
    id: 'vc-redist',
    name: 'Microsoft Visual C++ 2015-2022 Redistributable (x64)',
    version: '14.40.33810',
    publisher: 'Microsoft Corporation',
    installDate: '2026-01-10',
    estimatedSize: 34 * 1024 * 1024,
    installLocation: 'C:\\Windows\\System32',
    uninstallString: 'VC_redist.x64.exe /uninstall',
    category: 'runtime',
    isSystem: true
  }
  assert.ok(PROTECTED_SYSTEM_SOFTWARE_PATTERN.test(vcRedist.name), 'VC++ 运行库应命中系统关键依赖保护模式')

  // 3. 缺少卸载命令行时防御
  const invalidItem = {
    id: 'broken-app',
    name: 'Broken App',
    version: '1.0',
    publisher: 'Unknown',
    installDate: '2026-01-01',
    estimatedSize: 1024,
    installLocation: '',
    uninstallString: '',
    category: 'desktop',
    isSystem: false
  }
  const invalidRes = await uninstallSoftware(invalidItem, false)
  assert.equal(invalidRes.ok, false)
  assert.equal(invalidRes.error, '未找到可用的卸载程序命令行')
})

test('software-manager 底层 DLL 故障注入与异常恢复测试', async () => {
  // 模拟 Native 宿主崩溃返回 error
  const mockCrashingHost = {
    invokePlugin: async () => {
      throw new Error('Native Host RPC pipe severed (STATUS_ACCESS_VIOLATION)')
    }
  }

  const listAfterCrash = await invokeNativeCapability('GetAllSoftware', {}, mockCrashingHost)
  assert.equal(listAfterCrash.ok, false, '遇到崩溃应标记 ok: false')
  assert.ok(listAfterCrash.error.includes('STATUS_ACCESS_VIOLATION'), '应捕获底层具体错误信息')

  // 模拟空安装路径调用打开目录
  const emptyLocation = await openSoftwareLocation('', mockCrashingHost)
  assert.equal(emptyLocation, false, '空路径不应发起调用且返回 false')

  // 模拟启动软件空路径
  const emptyLaunch = await launchSoftware('', mockCrashingHost)
  assert.equal(emptyLaunch, false, '空执行路径不应发起调用且返回 false')
})

test('software-manager 注册表扫描数据映射与真实宿主 Preload Transport 联动测试', async () => {
  // 1. 模拟 Electron Preload 暴露的真实 Windows 扫描记录
  const mockScannedRecords = [
    {
      id: 'app-0-wechat',
      name: '微信 (WeChat)',
      version: '3.9.12.17',
      publisher: 'Tencent Technology',
      installDate: '20260401',
      installLocation: 'C:\\Program Files\\Tencent\\WeChat',
      uninstallString: '"C:\\Program Files\\Tencent\\WeChat\\Uninstall.exe"',
      quietUninstallString: '"C:\\Program Files\\Tencent\\WeChat\\Uninstall.exe" /S',
      estimatedSizeKb: 450000,
      isSystemComponent: false
    },
    {
      id: 'app-1-vcredist',
      name: 'Microsoft Visual C++ 2015-2022 Redistributable (x64)',
      version: '14.38.33135',
      publisher: 'Microsoft Corporation',
      installDate: '20260110',
      installLocation: '',
      uninstallString: 'MsiExec.exe /X{B2509927-4352-457B-BE3B-57D68132316E}',
      estimatedSizeKb: 24000,
      isSystemComponent: true
    },
    {
      id: 'app-2-storeapp',
      name: 'Windows Store Package Example',
      version: '1.0.0',
      publisher: 'Store Vendor',
      installDate: '',
      installLocation: 'C:\\Program Files\\WindowsApps\\Package_1.0',
      uninstallString: 'cmd.exe /c remove-appx',
      estimatedSizeKb: 12000,
      isSystemComponent: false
    }
  ]

  let uninstallCalls = []
  let openPathCalls = []

  globalThis.window = {
    __ztoolsElectron: {
      transport: {
        methods: {
          applications_list: async (params) => {
            return {
              messageId: 'test-1',
              success: true,
              data: mockScannedRecords
            }
          },
          applications_uninstall: async (params) => {
            uninstallCalls.push(params)
            return { messageId: 'test-2', success: true, data: { success: true } }
          },
          shell_open_path: async (params) => {
            openPathCalls.push(params)
            return { messageId: 'test-3', success: true }
          },
          shell_exec: async (params) => {
            return { messageId: 'test-4', success: true }
          }
        }
      }
    }
  }

  // 2. 测试拉取与映射
  const list = await fetchSoftwareList(undefined, true)
  assert.equal(list.length, 3, '应成功拉取并映射 3 款已装软件')
  
  // 校验微信字段
  const wechat = list.find(s => s.name.includes('微信'))
  assert.ok(wechat, '应包含微信')
  assert.equal(wechat.category, 'desktop', '普通应用分类应为 desktop')
  assert.equal(wechat.estimatedSize, 450000 * 1024, '应将 estimatedSizeKb 换算为字节')
  assert.equal(wechat.quietUninstallString, '"C:\\Program Files\\Tencent\\WeChat\\Uninstall.exe" /S')

  // 校验 VC++ 运行库
  const vcredist = list.find(s => s.name.includes('Visual C++'))
  assert.ok(vcredist, '应包含 VC++ 运行库')
  assert.equal(vcredist.category, 'runtime', '系统核心运行库分类应为 runtime')
  assert.equal(vcredist.isSystem, true)

  // 校验 WindowsApps 商店应用
  const storeApp = list.find(s => s.name.includes('Store Package'))
  assert.ok(storeApp, '应包含商店应用')
  assert.equal(storeApp.category, 'store', 'WindowsApps 目录应用分类应为 store')

  // 3. 测试统计数据聚合
  const summary = await fetchSoftwareSummary(undefined, list)
  assert.equal(summary.totalCount, 3)
  assert.equal(summary.silentSupportedCount, 1)
  assert.ok(summary.totalSizeBytes > 0)

  // 4. 测试卸载与联动
  const uninstallRes = await uninstallSoftware(wechat, true)
  assert.equal(uninstallRes.ok, true)
  assert.equal(uninstallCalls.length, 1)
  assert.equal(uninstallCalls[0].command, wechat.id)

  // 5. 测试目录打开与启动联动
  const openRes = await openSoftwareLocation(wechat.installLocation)
  assert.equal(openRes, true)
  assert.equal(openPathCalls.length, 1)
  assert.equal(openPathCalls[0].fullPath, wechat.installLocation)

  // 6. 异常注入：Preload Transport 抛错时平滑降级到 Mock 数据
  globalThis.window.__ztoolsElectron.transport.methods.applications_list = async () => {
    throw new Error('IPC Bridge disconnected')
  }
  const fallbackList = await fetchSoftwareList(undefined, true)
  assert.ok(Array.isArray(fallbackList) && fallbackList.length > 0, 'Transport 异常时应平滑回退 Mock 数据')

  // 清理全局变量
  delete globalThis.window
})

