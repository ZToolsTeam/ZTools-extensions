// 系统操作与客户端接口的对接测试（导入本插件的 dist/，不加载模拟客户端界面）
// 覆盖：每项操作调用的是客户端真实存在的方法与参数；客户端失败、返回失败结果、不在客户端里运行时都如实报错；
// 需要确认的操作在没有确认框时不执行
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SYSTEM_ACTIONS,
  HOST_REQUIRED_MESSAGE,
  executeSystemAction,
  filterSystemActions
} from '../dist/system-actions.js'

// 宿主内置系统操作处理器能识别的动作（宿主把名字转小写并去掉 - _ 空格后比对）
const HOST_SYSTEM_ACTIONS = new Set([
  'lockscreen', 'emptytrash', 'sleep', 'togglemute', 'volumeup', 'volumedown',
  'togglehiddenfiles', 'togglefileextensions', 'toggledarkmode', 'flushdns'
])
// 直接调用的宿主方法及其允许的参数（宿主会拒绝未知参数）
const HOST_METHOD_PARAMS = {
  system_lock: [],
  system_sleep: [],
  system_hibernate: [],
  system_restart: ['force'],
  system_logout: ['force'],
  system_shutdown: ['force', 'timeout']
}
const EXECUTE_ACTION_KEYS = ['actionKey', 'action', 'volume', 'level', 'muted', 'params']
const normalize = (name) => name.toLowerCase().replace(/[-_\s]/g, '')

test('每项操作都对应客户端真实存在的方法和参数', () => {
  assert.ok(SYSTEM_ACTIONS.length > 0)
  for (const item of SYSTEM_ACTIONS) {
    const inv = item.invoke
    if (inv.kind === 'system-actions') {
      assert.ok(HOST_SYSTEM_ACTIONS.has(normalize(inv.func)), `${item.id}: 宿主不认识 ${inv.func}`)
    } else if (inv.kind === 'method') {
      assert.ok(inv.method in HOST_METHOD_PARAMS, `${item.id}: 宿主没有 ${inv.method}`)
      for (const key of Object.keys(inv.params)) {
        assert.ok(HOST_METHOD_PARAMS[inv.method].includes(key), `${item.id}: ${inv.method} 不接受参数 ${key}`)
      }
    } else {
      assert.equal(inv.kind, 'execute-action')
      assert.equal(inv.actionKey, 'toggle-caffeinate')
    }
  }
  // 宿主没有实现的操作不能出现在列表里
  for (const removed of ['sleep-displays', 'toggle-appearance', 'toggle-desktop-icons', 'quit-all-applications', 'eject-all-disks', 'volume-mixer', 'toggle-bluetooth']) {
    assert.equal(SYSTEM_ACTIONS.some((a) => a.id === removed), false, `${removed} 不应出现`)
  }
})

test('调高 / 调低音量与休眠接到客户端真实存在的方法', async () => {
  const calls = []
  const hostOverride = {
    dllplugin_call: async (payload) => {
      calls.push(payload)
      return { ok: true, success: true, action: payload.func }
    },
    system_hibernate: async (payload) => {
      calls.push({ method: 'system_hibernate', payload })
      return { success: true, action: 'hibernate' }
    }
  }
  const up = await executeSystemAction('volume-up', { hostOverride })
  assert.equal(up.success, true)
  assert.equal(calls[0].plugin, 'SystemActionsPlugin')
  assert.equal(normalize(calls[0].func), 'volumeup')
  const down = await executeSystemAction('volume-down', { hostOverride })
  assert.equal(down.success, true)
  assert.equal(normalize(calls[1].func), 'volumedown')
  const hib = await executeSystemAction('hibernate', { hostOverride })
  assert.equal(hib.success, true)
  assert.equal(hib.message, '已发送休眠指令')
  assert.deepEqual(calls[2], { method: 'system_hibernate', payload: {} })
})

test('锁屏调用 system_lock，防止熄屏只传宿主接受的参数并按返回状态提示', async () => {
  let lockParams = null
  let executeParams = null
  const hostOverride = {
    system_lock: async (p) => {
      lockParams = p
      return { success: true, action: 'lock' }
    },
    system_execute_action: async (p) => {
      executeParams = p
      return { success: true, action: 'toggle-caffeinate', message: 'x', state: { caffeinated: true } }
    }
  }
  const lock = await executeSystemAction('lock-screen', { hostOverride })
  assert.equal(lock.success, true)
  assert.deepEqual(lockParams, {})

  const on = await executeSystemAction('toggle-caffeinate', { hostOverride })
  assert.equal(on.success, true)
  assert.deepEqual(executeParams, { actionKey: 'toggle-caffeinate' })
  assert.ok(Object.keys(executeParams).every((k) => EXECUTE_ACTION_KEYS.includes(k)))
  assert.match(on.message, /已开启防止熄屏/)
})

test('切换隐藏文件按宿主返回的状态提示（回收站见界面测试）', async () => {
  const hidden = await executeSystemAction('toggle-hidden-files', {
    hostOverride: { dllplugin_call: async () => ({ ok: true, success: true, showHiddenFiles: false }) }
  })
  assert.equal(hidden.success, true)
  assert.match(hidden.message, /不显示隐藏的文件/)
})

test('[故障] 客户端调用抛错、返回失败结果时如实报错，不报成功', async () => {
  const thrown = await executeSystemAction('volume-up', {
    hostOverride: { dllplugin_call: async () => { throw new Error('IPC 通道已关闭') } }
  })
  assert.equal(thrown.success, false)
  assert.equal(thrown.executed, false)
  assert.equal(thrown.message, 'IPC 通道已关闭')

  const failed = await executeSystemAction('toggle-mute', {
    hostOverride: {
      dllplugin_call: async () => ({ ok: false, success: false, errorCode: 'ACTION_FAILED', error: 'ACTION_FAILED: 发送音量按键未得到确认' })
    }
  })
  assert.equal(failed.success, false)
  assert.match(failed.message, /发送音量按键未得到确认/)

  const rejected = await executeSystemAction('sleep', {
    hostOverride: {
      system_sleep: async () => ({ success: false, error: { code: 'PROCESS_ERROR', message: '系统电源操作失败' } })
    }
  })
  assert.equal(rejected.success, false)
  assert.equal(rejected.message, '系统电源操作失败')
})

test('[边界] 未知操作、不在客户端里运行时如实报错', async () => {
  const unknown = await executeSystemAction('non-existent-system-cmd', {})
  assert.equal(unknown.success, false)
  assert.equal(unknown.executed, false)

  // 没有 window，也没有注入的客户端
  const noHost = await executeSystemAction('lock-screen')
  assert.equal(noHost.success, false)
  assert.equal(noHost.message, HOST_REQUIRED_MESSAGE)
})

test('[边界] 需要确认的操作在没有确认框时按取消处理，不调用客户端', async () => {
  for (const id of ['restart', 'shut-down', 'log-out', 'empty-trash']) {
    let called = false
    const res = await executeSystemAction(id, {
      hostOverride: {
        system_restart: async () => { called = true; return { success: true } },
        system_shutdown: async () => { called = true; return { success: true } },
        system_logout: async () => { called = true; return { success: true } },
        dllplugin_call: async () => { called = true; return { ok: true } }
      }
    })
    assert.equal(res.canceled, true, id)
    assert.equal(res.executed, false, id)
    assert.equal(called, false, `${id} 未确认就调用了客户端`)
  }
})

test('按分类与关键字过滤', () => {
  assert.ok(filterSystemActions('', 'audio').every((a) => a.category === 'audio'))
  assert.deepEqual(filterSystemActions('回收站').map((a) => a.id), ['empty-trash'])
  assert.deepEqual(filterSystemActions('hibernate').map((a) => a.id), ['hibernate'])
  assert.equal(filterSystemActions('不存在的操作').length, 0)
})
