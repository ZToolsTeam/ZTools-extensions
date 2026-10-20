import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const mod = require('../dist/index.js')
const Command = mod.default

test('kill-process 声明式视图渲染与进程内存/CPU过滤排序集成测试', () => {
  const view = Command()
  assert.ok(view && view.type === 'List')
  const list = mod.filterAndSortProcesses(mod.SAMPLE_PROCESSES, '', 'cpu')
  assert.ok(list.length > 0)
  assert.ok(list[0].cpuPercent >= list[list.length - 1].cpuPercent)
  const memList = mod.filterAndSortProcesses(mod.SAMPLE_PROCESSES, '', 'memory')
  assert.ok(memList[0].memoryMB >= memList[memList.length - 1].memoryMB)
})

test('kill-process 空列表与不存在的 PID 检索边界测试 (Beyond Happy Path)', () => {
  assert.deepEqual(mod.filterAndSortProcesses([], 'chrome', 'memory'), [])
  assert.deepEqual(mod.filterAndSortProcesses(mod.SAMPLE_PROCESSES, '__NO_SUCH_PROC_999__', 'memory'), [])
})

test('kill-process 真实宿主快照桥接、三种终结模式与系统进程保护护盾集成与故障注入测试', async () => {
  // 1. 验证从宿主 ProcessMonitorPlugin 获取真实进程快照并映射字段
  const mockHost = {
    dllplugin: {
      call: async (plugin, func, params) => {
        if (func === 'GetProcessList') {
          return JSON.stringify({
            processes: [
              {
                pid: 31337,
                name: 'geek-worker.exe',
                cpuPercent: 32.5,
                workingSetBytes: 512 * 1024 * 1024,
                threadCount: 24,
                path: 'C:\\Tools\\geek-worker.exe',
                commandLine: 'C:\\Tools\\geek-worker.exe --daemon',
                isSystem: false
              }
            ]
          })
        }
        if (func === 'TerminateProcessByPID') {
          if (params.pid === 99999) {
            return { success: false, error: 'ACCESS_DENIED' }
          }
          return { success: true, pid: params.pid, mode: params.mode }
        }
        return {}
      }
    }
  }

  const fetched = await mod.fetchRealProcesses(mockHost)
  assert.equal(fetched.length, 1)
  assert.equal(fetched[0].pid, 31337)
  assert.equal(fetched[0].name, 'geek-worker.exe')
  assert.equal(fetched[0].cpuPercent, 32.5)
  assert.equal(fetched[0].memoryMB, 512)
  assert.equal(fetched[0].threads, 24)

  // 2. 验证关键系统进程防误杀护盾
  const blocked = await mod.terminateProcess({ pid: 4, name: 'System' }, 'force', false, mockHost)
  assert.equal(blocked.success, false)
  assert.equal(blocked.error, 'PROTECTED_CRITICAL_PROCESS')

  const blockedExplorer = await mod.terminateProcess({ pid: 3108, name: 'explorer.exe' }, 'tree', false, mockHost)
  assert.equal(blockedExplorer.success, false)
  assert.equal(blockedExplorer.error, 'PROTECTED_CRITICAL_PROCESS')

  // 3. 验证三种终结模式 (force / tree / graceful)
  const okForce = await mod.terminateProcess({ pid: 31337, name: 'geek-worker.exe' }, 'force', false, mockHost)
  assert.equal(okForce.success, true)
  assert.equal(okForce.command, mod.getKillCommandLine(31337, 'force'), '命令行按当前系统生成')

  const okTree = await mod.terminateProcess({ pid: 31337, name: 'geek-worker.exe' }, 'tree', false, mockHost)
  assert.equal(okTree.success, true)
  assert.equal(okTree.command, mod.getKillCommandLine(31337, 'tree'), '命令行按当前系统生成')

  const okGraceful = await mod.terminateProcess({ pid: 31337, name: 'geek-worker.exe' }, 'graceful', false, mockHost)
  assert.equal(okGraceful.success, true)
  assert.equal(okGraceful.command, mod.getKillCommandLine(31337, 'graceful'), '命令行按当前系统生成')

  // 4. 故障注入：宿主拒绝终止进程 (ACCESS_DENIED)
  const denied = await mod.terminateProcess({ pid: 99999, name: 'locked.exe' }, 'force', false, mockHost)
  assert.equal(denied.success, false)
  assert.equal(denied.error, 'EXECUTION_FAILED')
  assert.match(denied.message, /ACCESS_DENIED/)

  // 5. 故障注入：宿主抛出异常时 fetchRealProcesses 安全回退至 SAMPLE_PROCESSES
  const brokenHost = {
    dllplugin: {
      call: async () => {
        throw new Error('IPC_CHANNEL_BROKEN')
      }
    }
  }
  const fallbackProcs = await mod.fetchRealProcesses(brokenHost)
  assert.equal(fallbackProcs.length, mod.SAMPLE_PROCESSES.length)
})


test('kill-process 终止命令行：Windows 与 macOS 两套写法', () => {
  assert.equal(mod.getKillCommandLine(31337, 'force', false), 'taskkill /F /PID 31337')
  assert.equal(mod.getKillCommandLine(31337, 'tree', false), 'taskkill /F /T /PID 31337')
  assert.equal(mod.getKillCommandLine(31337, 'graceful', false), 'taskkill /PID 31337')
  assert.equal(mod.getKillCommandLine(31337, 'force', true), 'kill -9 31337')
  assert.equal(mod.getKillCommandLine(31337, 'tree', true), 'pkill -9 -P 31337')
  assert.equal(mod.getKillCommandLine(31337, 'graceful', true), 'kill -15 31337')
})
