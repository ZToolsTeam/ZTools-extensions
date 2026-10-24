import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getCommandForAction,
  formatRemainingTime,
  calculateTargetTime,
  getQuickScheduleOptions
} from '../dist/logic.js'

test('ShutdownTimer 指令映射与参数测试', () => {
  assert.equal(getCommandForAction('shutdown', 600), 'shutdown.exe /s /t 600')
  assert.equal(getCommandForAction('reboot', 1800), 'shutdown.exe /r /t 1800')
  assert.equal(getCommandForAction('cancel'), 'shutdown.exe /a')
  assert.equal(getCommandForAction('lock'), 'rundll32.exe user32.dll,LockWorkStation')
  assert.equal(getCommandForAction('sleep'), 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0')
})

test('ShutdownTimer 边界与异常输入测试', () => {
  // 1. 负数秒数自动纠正为 0
  assert.equal(getCommandForAction('shutdown', -100), 'shutdown.exe /s /t 0')
  // 2. 浮点数向下取整
  assert.equal(getCommandForAction('shutdown', 60.9), 'shutdown.exe /s /t 60')
  // 3. 未知动作报错拦截
  // @ts-ignore
  assert.throws(() => getCommandForAction('unknown_action'), /未知电源动作/)
})

test('ShutdownTimer 时间格式化边界测试', () => {
  assert.equal(formatRemainingTime(0), '00:00:00')
  assert.equal(formatRemainingTime(-50), '00:00:00')
  assert.equal(formatRemainingTime(65), '00:01:05')
  assert.equal(formatRemainingTime(3665), '01:01:05')

  const target = calculateTargetTime(60)
  assert.match(target, /^\d{2}:\d{2}:\d{2}$/)
})

test('ShutdownTimer 预设任务列表完整性测试', () => {
  const options = getQuickScheduleOptions()
  assert.ok(options.length >= 7)
  assert.ok(options.some(o => o.action === 'cancel'))
  assert.ok(options.some(o => o.action === 'shutdown' && o.seconds === 600))
  assert.ok(options.some(o => o.action === 'lock'))
})
