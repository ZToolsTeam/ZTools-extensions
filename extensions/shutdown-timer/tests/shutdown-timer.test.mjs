import test from 'node:test'
import assert from 'node:assert/strict'
import { setDeclarativeBridge } from '@ztools/declarative-ui'
import {
  CANCEL_COMMAND,
  HOST_REQUIRED_MESSAGE,
  MAX_SHUTDOWN_SECONDS,
  calculateTargetTime,
  executePowerAction,
  formatRemainingTime,
  getCommandForAction,
  getQuickScheduleOptions
} from '../dist/logic.js'

const NOW = new Date(2026, 0, 1, 22, 0, 0).getTime()
const preset = (id) => getQuickScheduleOptions().find((o) => o.id === id)

/** 记录调用的客户端通道替身；fail 为要抛出的错误 */
function fakeTransport(fail) {
  const calls = []
  return {
    calls,
    call: async (method, params) => {
      calls.push([method, params])
      if (fail) throw fail
      return { success: true, action: method }
    }
  }
}

function withConfirm(answer) {
  const confirms = []
  setDeclarativeBridge({ confirmAlert: async (opts) => { confirms.push(opts); return answer } })
  return confirms
}

test.afterEach(() => setDeclarativeBridge(null))

test('命令映射：倒计时关机与取消关机有等价命令，其余动作没有', () => {
  assert.equal(getCommandForAction('shutdown', 600), 'shutdown.exe /s /t 600')
  assert.equal(getCommandForAction('cancel'), CANCEL_COMMAND)
  assert.equal(getCommandForAction('shutdown', -100), 'shutdown.exe /s /t 0')
  assert.equal(getCommandForAction('shutdown', 60.9), 'shutdown.exe /s /t 60')
  assert.equal(getCommandForAction('shutdown', 999999), `shutdown.exe /s /t ${MAX_SHUTDOWN_SECONDS}`)
  assert.throws(() => getCommandForAction('lock'), /没有对应的命令/)
  // @ts-ignore
  assert.throws(() => getCommandForAction('unknown_action'), /没有对应的命令/)
})

test('时间格式化与目标时刻', () => {
  assert.equal(formatRemainingTime(0), '00:00:00')
  assert.equal(formatRemainingTime(-50), '00:00:00')
  assert.equal(formatRemainingTime(3665), '01:01:05')
  assert.equal(calculateTargetTime(600, NOW), '22:10:00')
})

test('预设只包含客户端能执行的动作，倒计时在客户端允许范围内', () => {
  const options = getQuickScheduleOptions()
  assert.deepEqual(options.filter((o) => o.action === 'shutdown').map((o) => o.seconds), [600, 1800, 3600, 7200])
  assert.ok(options.every((o) => o.action !== 'shutdown' || (o.seconds >= 1 && o.seconds <= MAX_SHUTDOWN_SECONDS)))
  assert.equal(options.some((o) => /重启/.test(o.title)), false, '客户端没有定时重启接口')
  assert.ok(options.some((o) => o.action === 'cancel'))
  assert.ok(options.some((o) => o.action === 'lock'))
  assert.ok(options.some((o) => o.action === 'sleep'))
})

test('定时关机：确认后调用 system_shutdown 并带上倒计时', async () => {
  const confirms = withConfirm(true)
  const transport = fakeTransport()
  const res = await executePowerAction(preset('shutdown-10m'), { transport, now: NOW })
  assert.equal(res.ok, true)
  assert.equal(res.message, '已设定 10 分钟后关机')
  assert.match(res.detail, /22:10:00/)
  assert.deepEqual(transport.calls, [['system_shutdown', { force: false, timeout: 600 }]])
  assert.equal(confirms.length, 1)
  assert.match(confirms[0].message, /关闭所有程序/)
  assert.match(confirms[0].message, /shutdown\.exe \/a/)
})

test('[边界] 定时关机：用户取消或没有确认框时不调用客户端', async () => {
  withConfirm(false)
  const transport = fakeTransport()
  const canceled = await executePowerAction(preset('shutdown-30m'), { transport })
  assert.equal(canceled.canceled, true)
  assert.equal(transport.calls.length, 0)

  setDeclarativeBridge(null)
  const noBridge = await executePowerAction(preset('shutdown-30m'), { transport })
  assert.equal(noBridge.canceled, true)
  assert.equal(transport.calls.length, 0)
})

test('[故障] 定时关机：客户端报错时如实返回原因并提示可能已有计划', async () => {
  withConfirm(true)
  const err = Object.assign(new Error('系统电源操作失败'), { code: 'PROCESS_ERROR' })
  const res = await executePowerAction(preset('shutdown-60m'), { transport: fakeTransport(err) })
  assert.equal(res.ok, false)
  assert.equal(res.message, '系统电源操作失败')
  assert.match(res.detail, /shutdown\.exe \/a/)
})

test('[故障] 不在客户端里运行、客户端不支持该方法时提示需要在客户端中使用', async () => {
  const noHost = await executePowerAction(preset('immediate-lock'), { transport: null })
  assert.equal(noHost.ok, false)
  assert.equal(noHost.message, HOST_REQUIRED_MESSAGE)

  const unsupported = Object.assign(new Error('宿主未提供 system_sleep'), { code: 'HOST_FEATURE_UNAVAILABLE' })
  const res = await executePowerAction(preset('immediate-sleep'), { transport: fakeTransport(unsupported) })
  assert.equal(res.ok, false)
  assert.equal(res.message, HOST_REQUIRED_MESSAGE)
})

test('锁屏、睡眠调用对应的客户端方法，不弹确认', async () => {
  const confirms = withConfirm(true)
  const transport = fakeTransport()
  assert.equal((await executePowerAction(preset('immediate-lock'), { transport })).ok, true)
  assert.equal((await executePowerAction(preset('immediate-sleep'), { transport })).ok, true)
  assert.deepEqual(transport.calls, [['system_lock', {}], ['system_sleep', {}]])
  assert.equal(confirms.length, 0)
})

test('[边界] 取消关机计划不调用客户端，返回需要自行运行的命令', async () => {
  const transport = fakeTransport()
  const res = await executePowerAction(preset('cancel-task'), { transport })
  assert.equal(res.ok, false)
  assert.match(res.message, /shutdown\.exe \/a/)
  assert.equal(transport.calls.length, 0)
})

test('[边界] 倒计时超出客户端允许范围时不执行', async () => {
  withConfirm(true)
  const transport = fakeTransport()
  const res = await executePowerAction({ ...preset('shutdown-10m'), seconds: MAX_SHUTDOWN_SECONDS + 1 }, { transport })
  assert.equal(res.ok, false)
  assert.equal(transport.calls.length, 0)
})
