// macOS 客户端在路由层拒绝 dllplugin_call：第一次被拒后本次运行不再请求原生组件，避免每次刷新都在控制台报错
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost } from '../../shared/test-harness.mjs'
import { fetchProcesses, fetchSystemInfo, resetNativeCapabilitySupport } from '../dist/logic.js'

const host = createHost()

test('宿主回复不支持 dllplugin_call 后不再请求原生组件，进程列表照常走 process_list', async () => {
  host.reset()
  resetNativeCapabilitySupport()
  let dllCalls = 0
  let listCalls = 0
  host.ipc.dllplugin_call = async () => {
    dllCalls++
    throw Object.assign(new Error('当前操作系统 (darwin) 不支持方法: dllplugin_call'), { code: 'PLATFORM_NOT_SUPPORTED' })
  }
  host.ipc.process_list = async () => {
    listCalls++
    return [{ pid: 501, name: 'Finder', path: '/System/Library/CoreServices/Finder.app/Contents/MacOS/Finder', cpuUsage: 1, memoryUsage: 9e7 }]
  }
  const first = await fetchProcesses()
  assert.equal(first[0].name, 'Finder')
  assert.equal(dllCalls, 1)
  const second = await fetchProcesses()
  assert.equal(second[0].name, 'Finder')
  await fetchSystemInfo().catch(() => {})
  assert.equal(dllCalls, 1, '被拒后不再请求原生组件')
  assert.equal(listCalls, 2)
})

test('其他原因的原生组件失败不会被记成「不支持」，下次仍会尝试', async () => {
  host.reset()
  resetNativeCapabilitySupport()
  let dllCalls = 0
  host.ipc.dllplugin_call = async () => { dllCalls++; throw new Error('DLL 加载超时') }
  host.ipc.process_list = async () => [{ pid: 1, name: 'launchd', path: '/sbin/launchd', cpuUsage: 0, memoryUsage: 1e6 }]
  await fetchProcesses()
  await fetchProcesses()
  assert.equal(dllCalls, 2)
})
