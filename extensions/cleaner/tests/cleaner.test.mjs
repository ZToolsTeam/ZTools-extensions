import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Command = require('../dist/index.js').default
const {
  DLL_PLUGIN_NAME,
  FORBIDDEN_TARGET_PATTERN,
  FORBIDDEN_REASON,
  formatBytes,
  getMockCleanGroups,
  getMockCleanSummary,
  validateCleanPayload,
  invokeNativeCapability,
  fetchCleanRulesAndScan,
  executeCleanGroups,
  emptyRecycleBin,
  filterCleanGroups
} = require('../dist/logic.js')

test('1. cleaner 声明式 2.0 视图渲染与 Native 桥接集成测试', async () => {
  const view = Command()
  assert.ok(view, '应成功生成声明式虚拟视图描述符')
  assert.equal(view.type, 'List')
  assert.equal(view.props.isShowingDetail, true, '必须开启双栏 Master-Detail 布局')

  // 1. 验证 MetricGrid 四列大盘看板
  assert.ok(view.props.metricGrid, '必须挂载 MetricGrid 大盘看板')
  assert.equal(view.props.metricGrid.props.columns, 4)
  assert.equal(view.props.metricGrid.props.items.length, 4)
  const metricIds = view.props.metricGrid.props.items.map((i) => i.id)
  assert.deepEqual(metricIds, ['metric-clean-space', 'metric-junk-files', 'metric-disk-free', 'metric-recycle-bin'])

  // 2. 验证 SegmentedControl 维度过滤切换
  assert.ok(view.props.segmentedControl, '必须挂载 SegmentedControl 分段切换')
  assert.equal(view.props.segmentedControl.props.options.length, 4)
  assert.deepEqual(
    view.props.segmentedControl.props.options.map((o) => o.value),
    ['all', 'system', 'browser', 'app']
  )

  // 3. 验证列表与右侧 Detail 全景画像
  assert.ok(Array.isArray(view.children) && view.children.length === 1)
  const section = view.children[0]
  assert.equal(section.type, 'List.Section')
  assert.ok(section.children.length >= 8, '应渲染包含系统临时、更新、浏览器等至少 8 个清理组')

  const firstItem = section.children[0]
  assert.equal(firstItem.type, 'List.Item')
  assert.ok(firstItem.props.title, '列表项必须具备主标题')
  assert.ok(firstItem.props.actions, '列表项必须挂载 ActionPanel')
  assert.ok(firstItem.props.detail, '列表项必须挂载 Detail 深度画像')
  assert.match(firstItem.props.detail.props.markdown, /### 📊 空间与规则画像/u)

  // 4. 模拟 NativeHost 原生桥接全链路闭环
  const calls = []
  const mockHost = {
    dllplugin: {
      call: async (plugin, fn, payload) => {
        calls.push({ plugin, fn, payload })
        if (fn === 'GetDiskSpace') {
          return JSON.stringify({ success: true, freeSpace: 75 * 1024 * 1024 * 1024, totalSpace: 512 * 1024 * 1024 * 1024 })
        }
        if (fn === 'GetRecycleBinInfo') {
          return JSON.stringify({ success: true, size: 850 * 1024 * 1024 })
        }
        return JSON.stringify({ success: true, executedMethod: fn })
      }
    }
  }

  const res = await invokeNativeCapability('GetDiskSpace', { drive: 'C:\\' }, mockHost)
  assert.equal(res.ok, true)
  assert.equal(res.pluginName, DLL_PLUGIN_NAME)
  assert.equal(res.fromFallback, false)
  assert.equal(calls[0].fn, 'GetDiskSpace')
})

test('2. cleaner 搜索过滤、分段分类与极值/空值防御测试 (Beyond Happy Path)', () => {
  const groups = getMockCleanGroups()
  assert.ok(groups.length >= 8)

  // 正常搜索与空值搜索
  assert.equal(filterCleanGroups(groups, '', 'all').length, groups.length)
  assert.equal(filterCleanGroups(groups, '   ', 'all').length, groups.length)
  assert.ok(filterCleanGroups(groups, '临时文件', 'all').length >= 1)
  assert.ok(filterCleanGroups(groups, 'chrome', 'all').length >= 1)
  assert.equal(filterCleanGroups(groups, '__NON_EXISTENT_9999__', 'all').length, 0)

  // 分类分段过滤
  const systemGroups = filterCleanGroups(groups, '', 'system')
  const browserGroups = filterCleanGroups(groups, '', 'browser')
  const appGroups = filterCleanGroups(groups, '', 'app')
  assert.ok(systemGroups.length >= 4)
  assert.ok(browserGroups.length >= 1)
  assert.ok(appGroups.length >= 2)
  assert.equal(systemGroups.length + browserGroups.length + appGroups.length, groups.length)

  // 畸形入参防御
  assert.deepEqual(filterCleanGroups(null, 'test', 'all'), [])
  assert.deepEqual(filterCleanGroups(undefined, 'test', 'all'), [])
  assert.equal(validateCleanPayload('', {}).valid, false)
  assert.equal(validateCleanPayload('bad-method!', {}).valid, false)
  assert.equal(validateCleanPayload('ValidMethod', null).valid, false)
  assert.equal(validateCleanPayload('ValidMethod', 'string_params').valid, false)
  assert.equal(validateCleanPayload('ValidMethod', { badKey: 'x'.repeat(5000) }).valid, false)

  // 格式化边界测试
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(-100), '0 B')
  assert.equal(formatBytes(Number.NaN), '0 B')
  assert.equal(formatBytes(1024), '1.0 KB')
  assert.equal(formatBytes(1024 * 1024 * 1.5), '1.5 MB')
  assert.equal(formatBytes(1024 * 1024 * 1024 * 2.45), '2.5 GB')
})

test('3. cleaner 勾选状态动态切换、总体积重新计算与清理执行闭环测试', async () => {
  const groups = getMockCleanGroups()
  const initialSummary = getMockCleanSummary(groups)
  assert.ok(initialSummary.totalSizeBytes > 0)
  assert.ok(initialSummary.checkedSizeBytes > 0)

  // 1. 全部勾选
  const allChecked = groups.map(g => ({ ...g, checked: true }))
  const fullSummary = getMockCleanSummary(allChecked)
  assert.equal(fullSummary.checkedSizeBytes, fullSummary.totalSizeBytes)
  assert.equal(fullSummary.checkedFileCount, fullSummary.totalFileCount)

  // 2. 全部取消勾选
  const noneChecked = groups.map(g => ({ ...g, checked: false }))
  const emptySummary = getMockCleanSummary(noneChecked)
  assert.equal(emptySummary.checkedSizeBytes, 0)
  assert.equal(emptySummary.checkedFileCount, 0)

  // 3. 执行清理操作
  const mockCleanHost = {
    dllplugin: {
      call: async (plugin, fn, payload) => {
        return JSON.stringify({
          success: true,
          deletedCount: 1500,
          freedSize: 1024 * 1024 * 800
        })
      }
    }
  }

  const cleanResult = await executeCleanGroups(groups.slice(0, 2))
  assert.equal(cleanResult.ok, true)
  assert.ok(cleanResult.deletedSizeBytes > 0)
  assert.ok(cleanResult.deletedCount > 0)

  // 4. 清空回收站
  const emptyBinResult = await emptyRecycleBin()
  assert.equal(emptyBinResult.ok, true)
})

test('4. cleaner 安全红线拦截与底层 DLL 崩溃/超时故障注入测试', async () => {
  // 1. 业务安全边界拦截（禁止清理注册表配置库或用户个人核心文档）
  await assert.rejects(
    () => invokeNativeCapability('CleanPath', { path: "C:\\Windows\\System32\\config" }),
    /SECURITY_INTERCEPTED/u
  )
  await assert.rejects(
    () => invokeNativeCapability('CleanPath', { path: "C:\\Users\\Admin\\Documents" }),
    /SECURITY_INTERCEPTED/u
  )

  // 2. 注入 DLL 子进程崩溃异常
  const crashHost = {
    dllplugin: {
      call: async () => {
        throw new Error('NativeHost32 subprocess terminated unexpectedly (SIGKILL -9)')
      }
    }
  }
  const crashRes = await invokeNativeCapability('StartCleanAsync', {}, crashHost)
  assert.equal(crashRes.ok, false)
  assert.match(crashRes.error, /^NATIVE_CALL_FAILED:/u)

  // 3. 注入 DLL 业务错误返回
  const errHost = {
    dllplugin: {
      call: async () => ({ error: 'E_ACCESS_DENIED_FILE_LOCKED' })
    }
  }
  const errRes = await invokeNativeCapability('StartCleanAsync', {}, errHost)
  assert.equal(errRes.ok, false)
  assert.match(errRes.error, /^DLL_ERROR: E_ACCESS_DENIED_FILE_LOCKED/u)

  // 4. 注入截断/损坏的 JSON 报文
  const corruptHost = {
    dllplugin: {
      call: async () => '{"broken_json": [1, 2,'
    }
  }
  await assert.rejects(
    () => invokeNativeCapability('StartCleanAsync', {}, corruptHost),
    /MALFORMED_DLL_RESPONSE/u
  )
})
