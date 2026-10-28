import assert from 'node:assert/strict'
import test from 'node:test'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import { CaffeineCommand, commands, startCaffeineSession } from '../dist/index.js'

async function waitUntil(check) {
  for (let i = 0; i < 40 && !check(); i++) await tick()
  assert.ok(check(), '界面应完成异步状态更新')
}
const host = createHost()
const state = active => ({ success: true, active, mode: 'display', durationMinutes: 15, startedAtMs: active ? Date.now() : null, expiresAtMs: active ? Date.now() + 900000 : null, remainingMs: active ? 900000 : null, sessionId: active ? 1 : 0 })
test.beforeEach(() => host.reset())

test('真实声明式操作走跨平台入口；非法时长不调用宿主', async () => {
  let current = state(false)
  host.ipc.system_power_session = p => {
    if (p.action === 'start') current = { ...state(true), mode: p.mode, durationMinutes: p.durationMinutes }
    if (p.action === 'stop') current = state(false)
    return current
  }
  const view = await mount(CaffeineCommand)
  try {
    await waitUntil(() => !view.tree().props.isLoading)
    await view.dropdown('system')
    await view.run(view.item('caffeine-15'), '开启：防休眠 15 分钟')
    assert.match(view.text(), /系统保活/)
    assert.deepEqual(host.ipcCalls.at(-1), ['system_power_session', { action: 'start', durationMinutes: 15, mode: 'system' }])
    await view.tree().props.filterBar.actions.find(a => a.id === 'stop').onAction()
    await tick()
    assert.match(view.text(), /未开启/)
    const calls = host.ipcCalls.length
    for (const minutes of [-1, 0.5, 10081, NaN]) assert.equal((await startCaffeineSession(minutes)).ok, false)
    assert.equal(host.ipcCalls.length, calls)
    assert.ok(host.ipcCalls.every(([method]) => method !== 'dllplugin_call'))
  } finally { view.unmount() }
})

test('查询失败显示未知，重复点击只发一次操作，操作失败不能显示成功', async () => {
  host.ipc.system_power_session = () => { throw new Error('宿主拒绝') }
  const view = await mount(CaffeineCommand)
  try {
    await waitUntil(() => !view.tree().props.isLoading)
    assert.match(view.text(), /状态无法确认.*宿主拒绝/)
    assert.doesNotMatch(view.text(), /未开启 · 系统/)
    let finish
    host.ipc.system_power_session = () => new Promise(resolve => { finish = resolve })
    const operation = view.run(view.item('caffeine-15'), '开启：防休眠 15 分钟')
    await tick()
    const calls = host.ipcCalls.length
    await view.run(view.item('caffeine-15'), '开启：防休眠 15 分钟')
    assert.equal(host.ipcCalls.length, calls)
    finish({ success: false, error: '创建断言失败' })
    await operation
    assert.match(host.lastToast().title, /失败/)
    assert.match(view.text(), /状态无法确认/)
  } finally { view.unmount() }
})

test('慢状态查询只保留一个在途请求，停止操作后迟到的活动状态不能回写', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  host.ipc.system_power_session = () => state(true)
  const view = await mount(CaffeineCommand)
  try {
    await waitUntil(() => !view.tree().props.isLoading)
    let finish
    host.ipc.system_power_session = p => p.action === 'status' ? new Promise(resolve => { finish = resolve }) : state(false)
    const before = host.ipcCalls.length
    t.mock.timers.tick(3000)
    await tick()
    assert.equal(host.ipcCalls.length, before + 1)
    finish(state(true))
    await tick()
    assert.match(view.text(), /已开启/)
    t.mock.timers.tick(1000)
    await tick()
    await view.tree().props.filterBar.actions.find(a => a.id === 'stop').onAction()
    finish(state(true))
    await tick()
    assert.match(view.text(), /未开启/)
  } finally { view.unmount() }
})

test('功能码切换入口只触发一次真实切换，失败会显示错误', async () => {
  host.ipc.system_power_session = () => { throw new Error('不能切换') }
  const view = await mount(commands['caffeine-toggle'])
  try {
    await waitUntil(() => !view.tree().props.isLoading)
    assert.deepEqual(host.ipcCalls.map(([,p]) => p.action), ['toggle'])
    assert.match(view.text(), /不能切换/)
  } finally { view.unmount() }
})
