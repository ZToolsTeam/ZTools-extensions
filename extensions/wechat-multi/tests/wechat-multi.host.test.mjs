// 本插件与客户端接口的对接测试（导入本插件的 dist/，用注入的客户端替身）
// 覆盖：只显示客户端返回的进程；读取 / 启动失败如实报错；客户端成功但没有新进程时不报成功；不在客户端里运行时不显示示例数据
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HOST_REQUIRED_MESSAGE,
  fetchWeChatMultiSnapshot,
  launchWechatAgain,
  filterWechatInstances
} from '../dist/logic.js'

const statusHost = (status) => ({
  dllplugin_call: async ({ plugin, func }) => {
    assert.equal(plugin, 'WeChatMultiPlugin')
    assert.equal(func, 'getStatus')
    return status
  }
})

test('读取运行中的微信：只用客户端返回的进程与字段', async () => {
  const snap = await fetchWeChatMultiSnapshot(statusHost({
    ok: true,
    success: true,
    installed: true,
    installPath: 'C:\\Program Files\\Tencent\\WeChat\\WeChat.exe',
    instances: [
      { pid: 4321, name: 'WeChat', memoryBytes: 300 * 1024 * 1024, workingSetBytes: 300 * 1024 * 1024, startTime: '09:15:02' },
      { pid: 0, name: 'WeChat' },
      null
    ]
  }))
  assert.equal(snap.ok, true)
  assert.equal(snap.installed, true)
  assert.equal(snap.instances.length, 1)
  assert.deepEqual(snap.instances[0], {
    id: 'wx-proc-4321', pid: 4321, name: 'WeChat', memoryBytes: 300 * 1024 * 1024, startTime: '09:15:02'
  })
  assert.equal('cpuPercent' in snap.instances[0], false, '客户端不返回 CPU，不能显示')
})

test('未安装、未运行微信时没有任何进程，部分读取失败时带上提示', async () => {
  const snap = await fetchWeChatMultiSnapshot(statusHost({
    ok: true, success: true, installed: false, installPath: '', instances: [], partial: true, warning: '读取微信安装路径失败：超时'
  }))
  assert.equal(snap.ok, true)
  assert.equal(snap.installed, false)
  assert.deepEqual(snap.instances, [])
  assert.equal(snap.warning, '读取微信安装路径失败：超时')
})

test('[故障] 客户端读取进程失败或调用抛错时 ok 为 false 并带原因', async () => {
  const failed = await fetchWeChatMultiSnapshot(statusHost({
    ok: false, success: false, errorCode: 'DETECT_FAILED', error: 'DETECT_FAILED: 读取微信进程失败，不能判断运行实例数'
  }))
  assert.equal(failed.ok, false)
  assert.match(failed.error, /不能判断运行实例数/)
  assert.deepEqual(failed.instances, [])

  const thrown = await fetchWeChatMultiSnapshot({ dllplugin_call: async () => { throw new Error('IPC 通道已关闭') } })
  assert.equal(thrown.ok, false)
  assert.equal(thrown.error, 'IPC 通道已关闭')
})

test('[边界] 不在客户端里运行时不显示示例进程，启动也如实失败', async () => {
  const snap = await fetchWeChatMultiSnapshot()
  assert.equal(snap.ok, false)
  assert.equal(snap.error, HOST_REQUIRED_MESSAGE)
  assert.deepEqual(snap.instances, [])

  const launch = await launchWechatAgain()
  assert.equal(launch.ok, false)
  assert.equal(launch.message, HOST_REQUIRED_MESSAGE)
})

test('再运行一次微信：只调用客户端 launchInstance，成功说法不含解除单实例限制', async () => {
  const calls = []
  const res = await launchWechatAgain({
    dllplugin_call: async (payload) => {
      calls.push(payload)
      return { ok: true, success: true, launchedCount: 1, pids: [5555], wechatPath: 'C:\\WeChat\\WeChat.exe' }
    }
  })
  assert.equal(res.ok, true)
  assert.deepEqual(res.pids, [5555])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].func, 'launchInstance')
  assert.deepEqual(calls[0].params, { count: 1 })
  assert.equal(/互斥|突破|破解|解锁/.test(res.message), false)
})

test('[故障] 未找到微信、客户端没有返回新进程时启动失败，不尝试其他路径', async () => {
  const calls = []
  const notFound = await launchWechatAgain({
    dllplugin_call: async (payload) => {
      calls.push(payload.func)
      return { ok: false, success: false, errorCode: 'WECHAT_NOT_FOUND', error: '未检测到本地微信安装路径 (WeChat.exe)' }
    },
    process_start: async () => { calls.push('process_start'); return { pid: 1 } },
    shell_open_path: async () => { calls.push('shell_open_path'); return { success: true } }
  })
  assert.equal(notFound.ok, false)
  assert.match(notFound.message, /未检测到本地微信安装路径/)
  assert.deepEqual(calls, ['launchInstance'])

  const noPid = await launchWechatAgain({
    dllplugin_call: async () => ({ ok: true, success: true, launchedCount: 0, pids: [] })
  })
  assert.equal(noPid.ok, false)
  assert.match(noPid.message, /没有返回新进程/)
})

test('按进程名或 PID 搜索', () => {
  const items = [
    { id: 'a', pid: 100, name: 'WeChat', memoryBytes: 0, startTime: '' },
    { id: 'b', pid: 2048, name: 'Weixin', memoryBytes: 0, startTime: '' }
  ]
  assert.deepEqual(filterWechatInstances(items, '2048').map((i) => i.id), ['b'])
  assert.deepEqual(filterWechatInstances(items, 'wechat').map((i) => i.id), ['a'])
  assert.equal(filterWechatInstances(items, '').length, 2)
})
