// 本插件的宿主集成测试（导入本插件的 dist/）
// 宿主替身按真实链路返回：内置处理器结果 → dllplugin_call 路由（无 data 时补一层 data）→ IPC 外层 { success, data }
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchContextMenuEntries,
  toggleContextMenuEntry,
  switchWin11ClassicMenu,
  filterContextMenuEntries,
  findTruncatedLocations,
  buildSummaryText,
  win11ModeLabel,
  HOST_SCAN_LIMIT_PER_LOCATION
} from '../dist/logic.js'

const HKCU_FILE = 'HKEY_CURRENT_USER\\Software\\Classes\\*\\shell'
const HKLM_DIR = 'HKEY_LOCAL_MACHINE\\Software\\Classes\\Directory\\shell'
const HKCU_BG = 'HKEY_CURRENT_USER\\Software\\Classes\\Directory\\Background\\shell'

/** 与 dllplugin_call 路由一致：处理器结果没有 data 字段时补 data: { ...结果 }，再包一层 IPC 成功响应 */
function routerResponse(hostResult) {
  const isRecord = hostResult && typeof hostResult === 'object' && !Array.isArray(hostResult)
  const data = isRecord && hostResult.data === undefined ? { ...hostResult, data: { ...hostResult } } : hostResult
  return { messageId: 'm1', success: true, data }
}

/** 与宿主扫描脚本输出一致的菜单项（没有 publisher 字段） */
function hostEntry(parent, keyName, { name = keyName, command = '', enabled = true, scope } = {}) {
  const keyPath = `${parent}\\${keyName}`
  const inferred = parent.includes('Background') ? 'background' : parent.includes('Directory') ? 'directory' : 'file'
  return { id: keyPath, name, keyName, scope: scope ?? inferred, scopeLabel: '', regPath: keyPath, keyPath, command, icon: '', enabled }
}

function createHost(handlers) {
  const calls = []
  return {
    calls,
    async dllplugin_call({ plugin, func, params }) {
      calls.push({ plugin, func, params })
      const handler = handlers[func]
      if (!handler) return routerResponse({ ok: false, success: false, error: `Unsupported ContextMenuPlugin function: ${func}` })
      return handler(params)
    }
  }
}

test('扫描成功：按宿主真实字段映射，不编造发布者，Win11 经典菜单状态未返回时为未识别', async () => {
  const host = createHost({
    scanEntries: () => {
      const items = [
        hostEntry(HKCU_FILE, 'VSCode', { name: 'Open with Code', command: '"Code.exe" "%1"' }),
        hostEntry(HKLM_DIR, 'git_shell', { name: 'Open Git Bash here', enabled: false }),
        hostEntry(HKCU_BG, 'wt', { name: '在终端中打开' })
      ]
      return routerResponse({ ok: true, success: true, items, entries: items })
    }
  })
  const snap = await fetchContextMenuEntries(host)
  assert.equal(snap.ok, true)
  assert.deepEqual(snap.entries.map((e) => [e.title, e.scope, e.scopeLabel, e.enabled]), [
    ['Open with Code', 'file', '所有文件', true],
    ['Open Git Bash here', 'directory', '文件夹', false],
    ['在终端中打开', 'background', '文件夹空白处', true]
  ])
  assert.equal(snap.entries[0].registryKey, `${HKCU_FILE}\\VSCode`)
  assert.equal(snap.entries[0].command, '"Code.exe" "%1"')
  assert.equal('publisher' in snap.entries[0], false)
  assert.equal(snap.enabledCount, 2)
  assert.equal(snap.disabledCount, 1)
  assert.equal(snap.unknownCount, 0)
  assert.equal(snap.win11ClassicEnabled, null)
  assert.deepEqual(snap.truncatedLocations, [])
  assert.deepEqual(host.calls.map((c) => [c.plugin, c.func]), [['ContextMenuPlugin', 'scanEntries']])
})

test('扫描失败：宿主返回 SCAN_FAILED / SCAN_TIMEOUT 时如实返回失败，不当成没有菜单项', async () => {
  for (const code of ['SCAN_FAILED', 'SCAN_TIMEOUT']) {
    const host = createHost({
      scanEntries: () =>
        routerResponse({ ok: false, success: false, errorCode: code, error: `${code}: 读取右键菜单失败：PowerShell 退出码 1` })
    })
    const snap = await fetchContextMenuEntries(host)
    assert.equal(snap.ok, false, code)
    assert.match(snap.error, new RegExp(code))
    assert.deepEqual(snap.entries, [])
    assert.equal(snap.win11ClassicEnabled, null)
  }
})

test('扫描失败：IPC 层失败、结果格式无法识别、调用抛错都返回失败', async () => {
  const platformDenied = await fetchContextMenuEntries({
    async dllplugin_call() {
      return { messageId: 'm1', success: false, error: { code: 'PLATFORM_NOT_SUPPORTED', message: '当前操作系统 (darwin) 不支持方法: dllplugin_call' } }
    }
  })
  assert.equal(platformDenied.ok, false)
  assert.match(platformDenied.error, /不支持方法/)

  const malformed = await fetchContextMenuEntries(createHost({ scanEntries: () => routerResponse({ ok: true, success: true }) }))
  assert.equal(malformed.ok, false)
  assert.match(malformed.error, /格式无法识别/)

  const thrown = await fetchContextMenuEntries({
    async dllplugin_call() {
      throw new Error('IPC 通道已关闭')
    }
  })
  assert.equal(thrown.ok, false)
  assert.match(thrown.error, /IPC 通道已关闭/)
})

test('宿主缺字段：启用状态标为未识别，位置按注册表路径判断，判断不了标未识别', async () => {
  const host = createHost({
    scanEntries: () => {
      const items = [
        { regPath: `${HKCU_FILE}\\NoState` },
        { regPath: 'HKEY_CURRENT_USER\\Software\\Classes\\Drive\\shell\\Odd', name: 'Drive 菜单', enabled: true },
        { name: '无路径项', enabled: false }
      ]
      return routerResponse({ ok: true, success: true, items, entries: items })
    }
  })
  const snap = await fetchContextMenuEntries(host)
  assert.equal(snap.ok, true)
  const [noState, drive, noPath] = snap.entries
  assert.equal(noState.title, 'NoState')
  assert.equal(noState.enabled, null)
  assert.equal(noState.scope, 'file')
  assert.equal(drive.scope, null)
  assert.equal(drive.scopeLabel, '位置未识别')
  assert.equal(noPath.registryKey, '')
  assert.equal(snap.unknownCount, 1)
  assert.equal(snap.enabledCount, 1)
  assert.equal(snap.disabledCount, 1)
  // “已禁用”筛选不包含状态未识别的项
  assert.deepEqual(filterContextMenuEntries(snap.entries, '', 'disabled').map((e) => e.title), ['无路径项'])
})

test('扫描上限：某个位置达到宿主每个位置的条数上限时标为可能未列全', async () => {
  const full = Array.from({ length: HOST_SCAN_LIMIT_PER_LOCATION }, (_, i) => hostEntry(HKCU_FILE, `item${i}`))
  const partial = Array.from({ length: HOST_SCAN_LIMIT_PER_LOCATION - 1 }, (_, i) => hostEntry(HKLM_DIR, `dir${i}`))
  const host = createHost({
    scanEntries: () => {
      const items = [...full, ...partial]
      return routerResponse({ ok: true, success: true, items, entries: items })
    }
  })
  const snap = await fetchContextMenuEntries(host)
  assert.deepEqual(snap.truncatedLocations, [HKCU_FILE])
  assert.deepEqual(findTruncatedLocations([]), [])
})

test('没有宿主：读取、启用禁用、切换 Win11 菜单都返回失败，不返回示例数据或假成功', async () => {
  assert.equal(globalThis.window, undefined)
  const snap = await fetchContextMenuEntries()
  assert.equal(snap.ok, false)
  assert.match(snap.error, /NO_HOST/)
  assert.deepEqual(snap.entries, [])

  const toggle = await toggleContextMenuEntry(`${HKCU_FILE}\\VSCode`, false, undefined, `${HKCU_FILE}\\VSCode`)
  assert.equal(toggle.ok, false)
  assert.equal(toggle.enabled, true)
  assert.match(toggle.message, /NO_HOST/)

  const classic = await switchWin11ClassicMenu(true)
  assert.equal(classic.ok, false)
  assert.equal(classic.classicMode, null)
  assert.match(classic.message, /NO_HOST/)
})

test('启用 / 禁用：成功时按宿主确认返回；ADMIN_REQUIRED、ITEM_NOT_FOUND、VERIFY_FAILED 如实返回失败并保持原状态', async () => {
  const failures = {
    [`${HKLM_DIR}\\git_shell`]: { errorCode: 'ADMIN_REQUIRED', error: 'ADMIN_REQUIRED: 修改该右键菜单项需要管理员权限，请以管理员身份运行 ZTools 后重试' },
    [`${HKCU_FILE}\\Gone`]: { errorCode: 'ITEM_NOT_FOUND', error: 'ITEM_NOT_FOUND: 右键菜单项不存在，可能已被删除' },
    [`${HKCU_FILE}\\Sticky`]: { errorCode: 'VERIFY_FAILED', error: 'VERIFY_FAILED: 已执行修改，但读回的启用状态与预期不符' }
  }
  const host = createHost({
    toggleEntry: (params) => {
      const base = { regPath: params.regPath, keyPath: params.regPath, enabled: params.enabled }
      const failure = failures[params.regPath]
      if (failure) return routerResponse({ ok: false, success: false, ...base, ...failure })
      return routerResponse({ ok: true, success: true, ...base })
    }
  })

  const ok = await toggleContextMenuEntry(`${HKCU_FILE}\\VSCode`, false, host, `${HKCU_FILE}\\VSCode`, 'Open with Code')
  assert.equal(ok.ok, true)
  assert.equal(ok.enabled, false)
  assert.match(ok.message, /已禁用.*Open with Code/)
  assert.deepEqual(host.calls[0].params, {
    id: `${HKCU_FILE}\\VSCode`,
    regPath: `${HKCU_FILE}\\VSCode`,
    registryKey: `${HKCU_FILE}\\VSCode`,
    enabled: false
  })

  for (const [regPath, failure] of Object.entries(failures)) {
    const res = await toggleContextMenuEntry(regPath, false, host, regPath)
    assert.equal(res.ok, false, regPath)
    assert.equal(res.enabled, true, '失败时保持原来的启用状态')
    assert.match(res.message, new RegExp(failure.errorCode))
  }
  // 每次只调用一次宿主，没有再去调用不存在的旧方法
  assert.equal(host.calls.length, 4)
  assert.ok(host.calls.every((c) => c.func === 'toggleEntry'))
})

test('启用 / 禁用：IPC 失败、宿主返回状态与请求不符、参数缺失、敏感注册表路径都不报成功', async () => {
  const regPath = `${HKCU_FILE}\\VSCode`
  const ipcFail = await toggleContextMenuEntry(regPath, true, {
    async dllplugin_call() {
      return { messageId: 'm1', success: false, error: { code: 'PERMISSION_DENIED', message: '第三方插件无权调用特权方法' } }
    }
  }, regPath)
  assert.equal(ipcFail.ok, false)
  assert.equal(ipcFail.enabled, false)
  assert.match(ipcFail.message, /无权调用/)

  const mismatch = await toggleContextMenuEntry(regPath, false, createHost({
    toggleEntry: (params) => routerResponse({ ok: true, success: true, regPath: params.regPath, enabled: true })
  }), regPath)
  assert.equal(mismatch.ok, false)
  assert.match(mismatch.message, /STATE_MISMATCH/)

  const host = createHost({ toggleEntry: () => routerResponse({ ok: true, success: true }) })
  const noState = await toggleContextMenuEntry(regPath, undefined, host, regPath)
  assert.equal(noState.ok, false)
  assert.match(noState.message, /INVALID_PARAMS/)
  const noId = await toggleContextMenuEntry('  ', false, host)
  assert.equal(noId.ok, false)
  const sam = await toggleContextMenuEntry('HKLM\\SAM', false, host, 'HKLM\\SAM')
  assert.equal(sam.ok, false)
  assert.match(sam.message, /禁止/)
  assert.equal(host.calls.length, 0, '参数无效或被拦截时不调用宿主')
})

test('Win11 经典菜单：显式传目标模式，成功提示需要重启资源管理器；宿主执行的模式不符或写入失败时报失败', async () => {
  // 按宿主真实逻辑：有 classic / enabled 参数时按参数执行，否则按当前注册表状态反转
  let classicKeyExists = true
  const host = createHost({
    switchWin11Classic: (params) => {
      const enableClassic = typeof params.classic === 'boolean' ? params.classic : typeof params.enabled === 'boolean' ? params.enabled : !classicKeyExists
      classicKeyExists = enableClassic
      return routerResponse({ ok: true, success: true, classic: enableClassic, output: '操作成功完成。' })
    }
  })
  const res = await switchWin11ClassicMenu(true, host)
  assert.equal(res.ok, true)
  assert.equal(res.classicMode, true)
  assert.match(res.message, /重启资源管理器/)
  assert.equal(host.calls[0].params.classic, true)
  assert.equal(classicKeyExists, true, '已是经典模式时再次请求经典模式不能被反转成默认模式')

  const restore = await switchWin11ClassicMenu(false, host)
  assert.equal(restore.ok, true)
  assert.equal(restore.classicMode, false)
  assert.equal(classicKeyExists, false)

  // 宿主忽略参数并反转了模式：不能报告为请求的模式
  const ignoring = createHost({ switchWin11Classic: () => routerResponse({ ok: true, success: true, classic: false }) })
  const mismatch = await switchWin11ClassicMenu(true, ignoring)
  assert.equal(mismatch.ok, false)
  assert.equal(mismatch.classicMode, null)
  assert.match(mismatch.message, /STATE_MISMATCH/)

  const regFail = createHost({
    switchWin11Classic: () => routerResponse({ ok: false, success: false, classic: true, output: '', error: '错误: 拒绝访问。' })
  })
  const failed = await switchWin11ClassicMenu(true, regFail)
  assert.equal(failed.ok, false)
  assert.match(failed.message, /拒绝访问/)

  const invalid = await switchWin11ClassicMenu(undefined, host)
  assert.equal(invalid.ok, false)
  assert.match(invalid.message, /INVALID_PARAMS/)
})

test('状态条文字：读取失败、重新扫描失败、扫描中、成功各自如实描述，Win11 模式未知时为未识别', () => {
  const entry = { id: 'a', title: 'A', scope: 'file', scopeLabel: '所有文件', registryKey: `${HKCU_FILE}\\A`, command: '', enabled: true }
  assert.match(buildSummaryText({ entries: [], scanError: 'SCAN_FAILED: x', isLoading: false, truncatedLocations: [] }), /^读取失败，不能判断/)
  assert.match(buildSummaryText({ entries: [entry], scanError: 'SCAN_TIMEOUT: x', isLoading: false, truncatedLocations: [] }), /^重新扫描失败，下方是上次的结果：SCAN_TIMEOUT/)
  assert.equal(buildSummaryText({ entries: [], scanError: '', isLoading: true, truncatedLocations: [] }), '正在扫描右键菜单...')
  assert.equal(buildSummaryText({ entries: [], scanError: '', isLoading: false, truncatedLocations: [] }), '共 0 项 · 已启用 0 项 · 已禁用 0 项')
  assert.equal(
    buildSummaryText({ entries: [entry, { ...entry, id: 'b', enabled: null }], scanError: '', isLoading: false, truncatedLocations: [HKCU_FILE] }),
    '共 2 项 · 已启用 1 项 · 已禁用 0 项 · 状态未识别 1 项 · 1 个位置达到扫描上限，可能未列全'
  )
  assert.deepEqual([null, true, false].map(win11ModeLabel), ['未识别', '经典完整', '默认折叠'])
})
