import test from 'node:test'
import assert from 'node:assert/strict'
import { setDeclarativeBridge } from '@ztools/declarative-ui'
import * as mod from '../dist/index.js'

// 测试专用的进程样本，只在测试里使用
const FIXTURE_PROCESSES = [
  { pid: 14220, name: 'chrome.exe', cpuPercent: 14.5, memoryMB: 1845.2, user: '', threads: 48, path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', commandLine: '', status: 'running', isSystemCritical: false },
  { pid: 8940, name: 'Code.exe', cpuPercent: 8.2, memoryMB: 1220.8, user: '', threads: 36, path: 'C:\\Apps\\Code.exe', commandLine: '', status: 'running', isSystemCritical: false },
  { pid: 18904, name: 'python.exe', cpuPercent: null, memoryMB: 512.3, user: '', threads: null, path: '', commandLine: '', status: 'running', isSystemCritical: false },
  { pid: 3108, name: 'explorer.exe', cpuPercent: 1.2, memoryMB: 320, user: '', threads: 72, path: 'C:\\Windows\\explorer.exe', commandLine: '', status: 'running', isSystemCritical: true }
]

function withBridge(bridge, fn) {
  setDeclarativeBridge(bridge)
  return Promise.resolve()
    .then(fn)
    .finally(() => setDeclarativeBridge(null))
}

function hostError(code, message, details) {
  return Object.assign(new Error(message), { name: 'ZToolsHostError', code, details })
}

test('不在客户端里运行时显示空状态，不显示示例进程', () => {
  const view = mod.default()
  assert.equal(view.type, 'List')
  assert.equal(view.props.filterBar.summaryText, mod.NOT_IN_CLIENT_MESSAGE)
  const section = view.children[0]
  assert.equal(section.children.length, 0)
  assert.equal(mod.SAMPLE_PROCESSES, undefined, '运行时代码不再导出示例数据')
})

test('按内存、CPU 排序，CPU 未知的排在最后；空列表与无匹配', () => {
  const cpu = mod.filterAndSortProcesses(FIXTURE_PROCESSES, '', 'cpu')
  assert.equal(cpu[0].name, 'chrome.exe')
  assert.equal(cpu[cpu.length - 1].name, 'python.exe')
  const mem = mod.filterAndSortProcesses(FIXTURE_PROCESSES, '', 'memory')
  assert.ok(mem[0].memoryMB >= mem[mem.length - 1].memoryMB)
  assert.deepEqual(mod.filterAndSortProcesses([], 'chrome', 'memory'), [])
  assert.deepEqual(mod.filterAndSortProcesses(FIXTURE_PROCESSES, '__NO_SUCH_PROC_999__', 'memory'), [])
})

test('读取进程：优先完整快照，字段按客户端返回映射', async () => {
  const calls = []
  const host = {
    dllplugin_call: async (params) => {
      calls.push(params)
      return {
        success: true,
        data: {
          processes: [
            { pid: 31337, name: 'worker.exe', cpuPercent: 32.5, workingSetBytes: 512 * 1024 * 1024, threadCount: 24, path: 'C:\\Tools\\worker.exe', commandLine: 'C:\\Tools\\worker.exe --daemon' }
          ]
        }
      }
    },
    process_list: async () => {
      throw new Error('不应调用基础列表')
    }
  }
  const res = await mod.loadProcesses(host)
  assert.equal(res.ok, true)
  assert.equal(calls[0].func, 'GetProcessList')
  const p = res.processes[0]
  assert.equal(p.pid, 31337)
  assert.equal(p.cpuPercent, 32.5)
  assert.equal(p.memoryMB, 512)
  assert.equal(p.threads, 24)
  assert.equal(p.path, 'C:\\Tools\\worker.exe')
  assert.equal(p.user, '', '客户端没给用户就留空，不写 User')
  assert.equal(p.arch, undefined, '客户端没给架构就留空，不写 x64')
})

test('读取进程：完整快照失败时退回基础列表，不可用字段留空而不是填默认值', async () => {
  const host = {
    dllplugin_call: async () => ({ success: true, data: { error: 'UNSUPPORTED' } }),
    process_list: async () => ({
      success: true,
      data: [
        { pid: 200, name: 'notepad.exe', path: '', cpuUsage: 0, memoryUsage: 10 * 1024 * 1024, fieldAvailability: { path: false, cpuUsage: false, memoryUsage: true } }
      ]
    })
  }
  const res = await mod.loadProcesses(host)
  assert.equal(res.ok, true)
  const p = res.processes[0]
  assert.equal(p.cpuPercent, null)
  assert.equal(p.threads, null)
  assert.equal(p.path, '', '没有路径时不再用进程名冒充路径')
  assert.equal(p.memoryMB, 10)
})

test('读取进程：两路都失败时如实返回错误，不回退示例数据', async () => {
  const host = {
    dllplugin_call: async () => { throw new Error('IPC_CHANNEL_BROKEN') },
    process_list: async () => ({ success: false, error: { code: 'PROCESS_ERROR', message: '读取进程列表失败' } })
  }
  const res = await mod.loadProcesses(host)
  assert.equal(res.ok, false)
  assert.deepEqual(res.processes, [])
  assert.match(res.error, /读取进程列表失败/)
  assert.match(res.error, /IPC_CHANNEL_BROKEN/)

  const outside = await mod.loadProcesses()
  assert.equal(outside.ok, false)
  assert.equal(outside.error, mod.NOT_IN_CLIENT_MESSAGE)
})

test('结束进程：走客户端结束进程接口，传入模式、进程树与进程名校验', async () => {
  const seen = []
  await withBridge({
    terminateProcess: async (pid, options) => {
      seen.push({ pid, options })
      return { pid, mode: options.mode, tree: options.tree === true, terminated: [pid] }
    }
  }, async () => {
    const force = await mod.terminateProcess({ pid: 31337, name: 'worker.exe' }, 'force')
    assert.equal(force.success, true)
    assert.equal(force.command, mod.getKillCommandLine(31337, 'force'), '命令行按当前系统生成')
    const tree = await mod.terminateProcess({ pid: 31337, name: 'worker.exe' }, 'tree')
    assert.equal(tree.success, true)
    const graceful = await mod.terminateProcess({ pid: 31337, name: 'worker.exe' }, 'graceful')
    assert.equal(graceful.success, true)
    const unnamed = await mod.terminateProcess({ pid: 4242, name: 'PID-4242' }, 'force')
    assert.equal(unnamed.success, true)
  })
  assert.deepEqual(seen[0].options, { mode: 'force', tree: false, expectedName: 'worker.exe' })
  assert.deepEqual(seen[1].options, { mode: 'force', tree: true, expectedName: 'worker.exe' })
  assert.deepEqual(seen[2].options, { mode: 'graceful', tree: false, expectedName: 'worker.exe' })
  assert.equal(seen[3].options.expectedName, undefined, '没有真实进程名时不做名称校验')
})

test('结束进程：客户端报错时如实失败，各类错误给出可理解的原因', async () => {
  const cases = [
    ['PROCESS_ACCESS_DENIED', 'force', /管理员/],
    ['PROCESS_IDENTITY_MISMATCH', 'force', /复用/],
    ['PROCESS_TERMINATE_TIMEOUT', 'graceful', /强制结束/],
    ['PLUGIN_PERMISSION_REQUIRED', 'force', /权限/],
    ['PROCESS_PROTECTED', 'force', /受保护/]
  ]
  for (const [code, mode, pattern] of cases) {
    await withBridge({
      terminateProcess: async () => { throw hostError(code, code === 'PROCESS_PROTECTED' ? '系统关键进程受保护，禁止结束' : code) }
    }, async () => {
      const res = await mod.terminateProcess({ pid: 5000, name: 'locked.exe' }, mode)
      assert.equal(res.success, false, code)
      assert.equal(res.error, code)
      assert.match(res.message, pattern)
    })
  }

  await withBridge({
    terminateProcess: async () => { throw hostError('PROCESS_NOT_FOUND', '进程已不存在') }
  }, async () => {
    const res = await mod.terminateProcess({ pid: 5001, name: 'gone.exe' }, 'force')
    assert.equal(res.success, true)
    assert.equal(res.alreadyExited, true)
    assert.match(res.message, /已经退出/)
  })
})

test('结束进程：旧版客户端接口失败时返回成功外壳也要识别为失败', async () => {
  // 没有结束进程接口（旧版客户端）时退回旧接口，旧接口失败也返回 success: true，错误放在 data.error
  const legacyFail = { dllplugin_call: async () => ({ success: true, data: { error: 'PROCESS_ACCESS_DENIED: 没有权限' } }) }
  const failed = await mod.terminateProcess({ pid: 99999, name: 'locked.exe' }, 'force', false, legacyFail)
  assert.equal(failed.success, false)
  assert.match(failed.message, /没有权限/)

  const legacyOk = { dllplugin_call: async (p) => ({ success: true, data: { terminated: true, pid: p.params.pid, mode: p.params.mode } }) }
  const ok = await mod.terminateProcess({ pid: 99998, name: 'app.exe' }, 'tree', false, legacyOk)
  assert.equal(ok.success, true)

  const legacyUnknown = { dllplugin_call: async () => ({ success: true, data: {} }) }
  const unknown = await mod.terminateProcess({ pid: 99997, name: 'app.exe' }, 'force', false, legacyUnknown)
  assert.equal(unknown.success, false, '客户端没有确认结束时不能报成功')
  assert.equal(unknown.error, 'RESULT_UNCONFIRMED')

  const broken = { dllplugin_call: async () => { throw new Error('IPC_CHANNEL_BROKEN') } }
  const brokenRes = await mod.terminateProcess({ pid: 99996, name: 'app.exe' }, 'force', false, broken)
  assert.equal(brokenRes.success, false)
  assert.match(brokenRes.message, /IPC_CHANNEL_BROKEN/)

  const outside = await mod.terminateProcess({ pid: 99995, name: 'app.exe' }, 'force')
  assert.equal(outside.success, false)
  assert.equal(outside.message, mod.NOT_IN_CLIENT_MESSAGE)
})

test('系统关键进程直接拒绝，不调用客户端', async () => {
  let called = 0
  await withBridge({
    terminateProcess: async () => { called += 1; return {} },
    confirmAlert: async () => { called += 1; return true }
  }, async () => {
    const blocked = await mod.terminateProcess({ pid: 4, name: 'System' }, 'force')
    assert.equal(blocked.success, false)
    assert.equal(blocked.error, 'PROTECTED_CRITICAL_PROCESS')
    const explorer = await mod.confirmAndTerminate({ pid: 3108, name: 'explorer.exe' }, 'tree')
    assert.equal(explorer.success, false)
    assert.equal(explorer.error, 'PROTECTED_CRITICAL_PROCESS')
  })
  assert.equal(called, 0)
})

test('结束前必须确认：取消时不结束，确认后才结束', async () => {
  const terminated = []
  let confirmOptions
  await withBridge({
    confirmAlert: async (options) => { confirmOptions = options; return false },
    terminateProcess: async (pid) => { terminated.push(pid); return { pid, terminated: [pid] } }
  }, async () => {
    const res = await mod.confirmAndTerminate({ pid: 7000, name: 'editor.exe' }, 'force')
    assert.equal(res, null)
  })
  assert.deepEqual(terminated, [])
  assert.equal(confirmOptions.primaryAction.style, 'destructive')
  assert.match(confirmOptions.message, /未保存的内容会丢失/)

  await withBridge({
    confirmAlert: async () => true,
    terminateProcess: async (pid) => { terminated.push(pid); return { pid, terminated: [pid] } }
  }, async () => {
    const res = await mod.confirmAndTerminate({ pid: 7001, name: 'editor.exe' }, 'graceful')
    assert.equal(res.success, true)
  })
  assert.deepEqual(terminated, [7001])

  // 没有确认框（不在客户端里）时按取消处理
  const noBridge = await mod.confirmAndTerminate({ pid: 7002, name: 'editor.exe' }, 'force')
  assert.equal(noBridge, null)
})

test('定位程序：不在客户端里或客户端失败时返回 false', async () => {
  assert.equal(await mod.revealProcessInExplorer('C:\\Tools\\worker.exe'), false)
  assert.equal(await mod.revealProcessInExplorer(''), false)
  const failing = {
    shell_show_item_in_folder: async () => ({ success: false, error: { message: '未授权' } }),
    shell_open_path: async () => ({ success: false, error: { message: '未授权' } })
  }
  assert.equal(await mod.revealProcessInExplorer('C:\\Tools\\worker.exe', failing), false)
  const ok = { shell_show_item_in_folder: async () => ({ success: true }) }
  assert.equal(await mod.revealProcessInExplorer('C:\\Tools\\worker.exe', ok), true)
})

test('终止命令行：Windows 与 macOS 两套写法', () => {
  assert.equal(mod.getKillCommandLine(31337, 'force', false), 'taskkill /F /PID 31337')
  assert.equal(mod.getKillCommandLine(31337, 'tree', false), 'taskkill /F /T /PID 31337')
  assert.equal(mod.getKillCommandLine(31337, 'graceful', false), 'taskkill /PID 31337')
  assert.equal(mod.getKillCommandLine(31337, 'force', true), 'kill -9 31337')
  assert.equal(mod.getKillCommandLine(31337, 'tree', true), 'pkill -9 -P 31337')
  assert.equal(mod.getKillCommandLine(31337, 'graceful', true), 'kill -15 31337')
})
