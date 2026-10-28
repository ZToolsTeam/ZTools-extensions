// context-menu 界面集成测试：真实声明式运行时 + 按宿主 dllplugin_call 返回结构模拟的 Windows 宿主
// 覆盖：扫描失败显示错误而不是空列表、重新扫描失败保留旧结果、写入失败如实提示、状态未识别不可切换、Win11 菜单模式未识别与显式切换
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import { Toast } from '@ztools/declarative-ui'
import ContextMenuCommand from '../dist/index.js'

const host = createHost()
const HKCU_FILE = 'HKEY_CURRENT_USER\\Software\\Classes\\*\\shell'
const HKLM_DIR = 'HKEY_LOCAL_MACHINE\\Software\\Classes\\Directory\\shell'

/** 与 dllplugin_call 路由一致：处理器结果没有 data 字段时补 data: { ...结果 }（测试工具再包一层 IPC 成功响应） */
function routed(hostResult) {
  return hostResult.data === undefined ? { ...hostResult, data: { ...hostResult } } : hostResult
}

function hostEntry(parent, keyName, extra = {}) {
  const keyPath = `${parent}\\${keyName}`
  return { id: keyPath, name: keyName, keyName, scope: parent.includes('Directory') ? 'directory' : 'file', regPath: keyPath, keyPath, command: '', enabled: true, ...extra }
}

const ENTRIES = [
  hostEntry(HKCU_FILE, 'VSCode', { name: 'Open with Code', command: '"Code.exe" "%1"' }),
  hostEntry(HKLM_DIR, 'git_shell', { name: 'Open Git Bash here' }),
  hostEntry(HKCU_FILE, 'Legacy', { name: '旧菜单', enabled: false }),
  hostEntry(HKCU_FILE, 'NoState', { name: '状态缺失', enabled: undefined })
]

/**
 * 安装宿主：scan 为扫描结果（函数或固定值），toggle / classic 记录调用并按真实处理器返回
 */
function installHost({ scan, toggleFailures = {}, classicFailure = null } = {}) {
  host.reset()
  const calls = { scan: 0, toggle: [], classic: [] }
  host.ipc.dllplugin_call = async ({ plugin, func, params }) => {
    assert.equal(plugin, 'ContextMenuPlugin')
    if (func === 'scanEntries') {
      calls.scan++
      const res = typeof scan === 'function' ? scan(calls.scan) : scan
      return routed(res)
    }
    if (func === 'toggleEntry') {
      calls.toggle.push(params)
      const base = { regPath: params.regPath, keyPath: params.regPath, enabled: params.enabled }
      const failure = toggleFailures[params.regPath]
      return routed(failure ? { ok: false, success: false, ...base, ...failure } : { ok: true, success: true, ...base })
    }
    if (func === 'switchWin11Classic') {
      calls.classic.push(params)
      if (classicFailure) return routed({ ok: false, success: false, classic: params.classic, output: '', error: classicFailure })
      return routed({ ok: true, success: true, classic: params.classic, output: '操作成功完成。' })
    }
    return routed({ ok: false, success: false, error: `Unsupported ContextMenuPlugin function: ${func}` })
  }
  return calls
}

const okScan = (entries = ENTRIES) => ({ ok: true, success: true, items: entries, entries })
const failedScan = { ok: false, success: false, errorCode: 'SCAN_FAILED', error: 'SCAN_FAILED: 读取右键菜单失败：PowerShell 退出码 1' }

function summary(view) {
  return view.tree().props.filterBar.summaryText
}

function accessoryText(item) {
  return item.props.accessories.map((a) => a.text ?? a.tag?.value).join('|')
}

test('首次扫描返回 SCAN_FAILED：显示错误行与失败提示，不显示成空列表', async () => {
  installHost({ scan: failedScan })
  const view = await mount(ContextMenuCommand)
  const errorRow = view.item('ctx-scan-error')
  assert.equal(errorRow.props.title, '读取右键菜单失败')
  assert.match(errorRow.props.subtitle, /SCAN_FAILED/)
  assert.match(summary(view), /读取失败，不能判断有哪些右键菜单项/)
  assert.doesNotMatch(summary(view), /共 0 项/)
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.match(host.lastToast().message, /SCAN_FAILED/)
  // 只有错误行与 Win11 设置行，没有菜单项
  assert.deepEqual(view.items().map((i) => i.props.id), ['ctx-scan-error', 'ctx-win11-classic'])
  assert.equal(view.tree().props.isLoading, false)
  view.unmount()
})

test('错误行的重新扫描成功后清除错误并显示真实结果', async () => {
  const calls = installHost({ scan: (n) => (n === 1 ? failedScan : okScan()) })
  const view = await mount(ContextMenuCommand)
  await view.run(view.item('ctx-scan-error'), '重新扫描')
  assert.equal(calls.scan, 2)
  assert.equal(view.items().some((i) => i.props.id === 'ctx-scan-error'), false)
  assert.match(summary(view), /共 4 项 · 已启用 2 项 · 已禁用 1 项 · 状态未识别 1 项/)
  assert.equal(host.lastToast().style, Toast.Style.Success)
  view.unmount()
})

test('重新扫描失败：保留上次结果并标明是旧结果', async () => {
  const calls = installHost({ scan: (n) => (n === 1 ? okScan() : failedScan) })
  const view = await mount(ContextMenuCommand)
  assert.equal(view.items().length, 5)
  await view.tree().props.filterBar.actions[0].onAction()
  await tick()
  assert.equal(calls.scan, 2)
  assert.equal(view.item('ctx-scan-error').props.title, '重新扫描失败')
  assert.match(summary(view), /重新扫描失败，下方是上次的结果/)
  assert.ok(view.item(`${HKCU_FILE}\\VSCode`))
  view.unmount()
})

test('禁用菜单项：需要管理员权限时如实提示失败并保持已启用；HKCU 项禁用成功后状态更新', async () => {
  const calls = installHost({
    scan: okScan(),
    toggleFailures: {
      [`${HKLM_DIR}\\git_shell`]: {
        errorCode: 'ADMIN_REQUIRED',
        error: 'ADMIN_REQUIRED: 修改该右键菜单项需要管理员权限，请以管理员身份运行 ZTools 后重试'
      }
    }
  })
  const view = await mount(ContextMenuCommand)

  await view.run(view.item(`${HKLM_DIR}\\git_shell`), '禁用该菜单项')
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.equal(host.lastToast().title, '修改右键菜单项失败')
  assert.match(host.lastToast().message, /ADMIN_REQUIRED/)
  assert.match(accessoryText(view.item(`${HKLM_DIR}\\git_shell`)), /已启用/)

  await view.run(view.item(`${HKCU_FILE}\\VSCode`), '禁用该菜单项')
  assert.equal(host.lastToast().style, Toast.Style.Success)
  assert.match(accessoryText(view.item(`${HKCU_FILE}\\VSCode`)), /已禁用/)
  assert.deepEqual(calls.toggle.map((p) => [p.regPath, p.enabled]), [
    [`${HKLM_DIR}\\git_shell`, false],
    [`${HKCU_FILE}\\VSCode`, false]
  ])
  view.unmount()
})

test('状态未识别的项不提供启用 / 禁用；没有命令的项不提供复制命令', async () => {
  installHost({ scan: okScan() })
  const view = await mount(ContextMenuCommand)
  const noState = view.item(`${HKCU_FILE}\\NoState`)
  assert.match(accessoryText(noState), /状态未识别/)
  assert.deepEqual(view.actions(noState).map((a) => a.props.title), ['复制注册表路径'])
  const withCommand = view.item(`${HKCU_FILE}\\VSCode`)
  assert.deepEqual(view.actions(withCommand).map((a) => a.props.title), ['禁用该菜单项', '复制注册表路径', '复制执行命令'])
  await view.run(withCommand, '复制执行命令')
  assert.equal(host.clipboard.text, '"Code.exe" "%1"')
  view.unmount()
})

test('“已禁用”筛选只列出宿主确认已禁用的项，并隐藏 Win11 设置行', async () => {
  installHost({ scan: okScan() })
  const view = await mount(ContextMenuCommand)
  await view.dropdown('disabled')
  assert.deepEqual(view.items().map((i) => i.props.title), ['旧菜单'])
  view.unmount()
})

test('Win11 菜单模式：初始为未识别并提供两个方向；显式切换成功后更新，写入失败如实提示', async () => {
  const calls = installHost({ scan: okScan() })
  const view = await mount(ContextMenuCommand)
  const row = () => view.item('ctx-win11-classic')
  assert.equal(accessoryText(row()), '未识别')
  assert.deepEqual(view.actions(row()).map((a) => a.props.title), ['切换为经典完整右键菜单', '恢复 Windows 11 默认右键菜单'])

  await view.run(row(), '切换为经典完整右键菜单')
  assert.deepEqual(calls.classic.map((p) => p.classic), [true])
  assert.equal(accessoryText(row()), '经典完整')
  assert.match(host.lastToast().title, /重启资源管理器/)
  assert.deepEqual(view.actions(row()).map((a) => a.props.title), ['恢复 Windows 11 默认右键菜单'])
  view.unmount()

  const failCalls = installHost({ scan: okScan(), classicFailure: '错误: 拒绝访问。' })
  const view2 = await mount(ContextMenuCommand)
  await view2.run(view2.item('ctx-win11-classic'), '恢复 Windows 11 默认右键菜单')
  assert.deepEqual(failCalls.classic.map((p) => p.classic), [false])
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.match(host.lastToast().message, /拒绝访问/)
  assert.equal(accessoryText(view2.item('ctx-win11-classic')), '未识别')
  view2.unmount()
})

test('某个位置达到宿主扫描上限时在状态条提示可能未列全', async () => {
  const many = Array.from({ length: 40 }, (_, i) => hostEntry(HKCU_FILE, `item${i}`))
  installHost({ scan: okScan(many) })
  const view = await mount(ContextMenuCommand)
  assert.match(summary(view), /1 个位置达到扫描上限，可能未列全/)
  view.unmount()
})
