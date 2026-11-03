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
    await view.run(view.item('caffeine-15'), '开启防休眠')
    assert.match(view.text(), /系统保活/)
    assert.deepEqual(host.ipcCalls.at(-1), ['system_power_session', { action: 'start', durationMinutes: 15, mode: 'system' }])
    await view.run(view.item('caffeine-15'), '停止防休眠')
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
    const operation = view.run(view.item('caffeine-15'), '开启防休眠')
    await tick()
    const calls = host.ipcCalls.length
    await view.run(view.item('caffeine-15'), '开启防休眠')
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
    await view.run(view.item('caffeine-15'), '停止防休眠')
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

test('清单只声明实际用到的 system 权限，不再申请未使用的 shell', async () => {
  const { readFileSync } = await import('node:fs')
  const manifest = JSON.parse(readFileSync(new URL('../plugin.json', import.meta.url), 'utf8'))
  assert.deepEqual(manifest.permissions, ['system'])
})

test('正在生效的那一档主动作是停止，不再重复开启', async () => {
  let current = state(false)
  host.ipc.system_power_session = p => {
    if (p.action === 'start') current = { ...state(true), mode: p.mode, durationMinutes: p.durationMinutes }
    if (p.action === 'stop') current = state(false)
    return current
  }
  const view = await mount(CaffeineCommand)
  try {
    await waitUntil(() => !view.tree().props.isLoading)
    await view.run(view.item('caffeine-15'), '开启防休眠')
    await tick()
    await view.run(view.item('caffeine-15'), '停止防休眠')
    await tick()
    assert.equal(host.ipcCalls.at(-1)[1].action, 'stop')
    assert.match(view.text(), /未开启/)
  } finally { view.unmount() }
})

test('生效项只标“生效中”，剩余时间只在顶部显示一次；无限期写“直到手动关闭”，未生效项不带重复标签', async () => {
  let current = state(false)
  host.ipc.system_power_session = p => {
    if (p.action === 'start') current = p.durationMinutes === 0
      ? { ...state(true), durationMinutes: 0, expiresAtMs: null, remainingMs: null }
      : { ...state(true), durationMinutes: p.durationMinutes }
    if (p.action === 'stop') current = state(false)
    return current
  }
  const view = await mount(CaffeineCommand)
  try {
    await waitUntil(() => !view.tree().props.isLoading)
    for (const item of view.items()) assert.deepEqual(item.props.accessories, [])
    await view.run(view.item('caffeine-0'), '开启防休眠')
    await waitUntil(() => /已开启/.test(view.tree().props.filterBar.summaryText))
    assert.equal(view.tree().props.filterBar.summaryText, '已开启屏幕常亮 · 直到手动关闭')
    assert.deepEqual(view.item('caffeine-0').props.accessories, [{ tag: '生效中' }])
    assert.doesNotMatch(view.text(), /剩余 无限期|到期自动停止|手动停止"/)
    for (const item of view.items().filter(i => i.props.id !== 'caffeine-0')) assert.deepEqual(item.props.accessories, [])
    await view.run(view.item('caffeine-0'), '停止防休眠'); await tick()
    await view.run(view.item('caffeine-15'), '开启防休眠')
    await waitUntil(() => /剩余/.test(view.tree().props.filterBar.summaryText))
    assert.match(view.tree().props.filterBar.summaryText, /^已开启屏幕常亮 · 剩余 15 分/)
    assert.deepEqual(view.item('caffeine-15').props.accessories, [{ tag: '生效中' }])
  } finally { view.unmount() }
})

test('停止防休眠只出现一次：生效项可见时只在该项主动作，被搜索过滤掉时才放到顶部；其它档动作名简短', async () => {
  let current = state(false)
  host.ipc.system_power_session = p => {
    if (p.action === 'start') current = { ...state(true), durationMinutes: p.durationMinutes }
    if (p.action === 'stop') current = state(false)
    return current
  }
  const view = await mount(commands['caffeine-panel'])
  try {
    await waitUntil(() => !view.tree().props.isLoading)
    for (const item of view.items()) {
      const titles = view.actions(item).map(a => a.props.title)
      assert.deepEqual(titles, ['开启防休眠'])
    }
    assert.deepEqual(view.tree().props.filterBar.actions, [])
    await view.run(view.item('caffeine-0'), '开启防休眠')
    await waitUntil(() => /已开启/.test(view.tree().props.filterBar.summaryText))
    assert.deepEqual(view.actions(view.item('caffeine-0')).map(a => a.props.title), ['停止防休眠'])
    assert.deepEqual(view.actions(view.item('caffeine-15')).map(a => a.props.title), ['改为此时长'])
    assert.equal(view.tree().props.filterBar.actions.some(a => a.id === 'stop'), false)
    const stopCount = JSON.stringify(view.tree(), (k, v) => typeof v === 'function' ? undefined : v).match(/停止防休眠/g).length
    assert.equal(stopCount, 1)
    // 搜索把生效项过滤掉后，顶部提供停止入口，且能真正停止
    await view.search('15')
    assert.equal(view.items().some(i => i.props.id === 'caffeine-0'), false)
    const stop = view.tree().props.filterBar.actions.find(a => a.id === 'stop')
    assert.ok(stop)
    await stop.onAction(); await tick()
    assert.match(view.tree().props.filterBar.summaryText, /未开启/)
    assert.equal(host.ipcCalls.at(-1)[1].action, 'stop')
  } finally { view.unmount() }
})

test('caffeine-toggle 开启后，停止防休眠不在顶部与主动作重复出现', async () => {
  let current = state(false)
  host.ipc.system_power_session = p => {
    if (p.action === 'start') current = { ...state(true), durationMinutes: p.durationMinutes }
    if (p.action === 'toggle') current = current.active ? state(false) : { ...state(true), durationMinutes: 0, expiresAtMs: null, remainingMs: null }
    if (p.action === 'stop') current = state(false)
    return current
  }
  const view = await mount(commands['caffeine-toggle'])
  try {
    await waitUntil(() => /已开启/.test(view.tree().props.filterBar.summaryText))
    const text = JSON.stringify(view.tree(), (k, v) => typeof v === 'function' ? undefined : v)
    assert.equal(text.match(/停止防休眠/g).length, 1)
  } finally { view.unmount() }
})
