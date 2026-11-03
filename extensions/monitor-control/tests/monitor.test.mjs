import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import Command, { commands, SleepMonitorsCommand } from '../dist/index.js'
import { scanDisplays, setDisplays } from '../dist/mac-service.js'

const id = 'mac:12345678-1234-1234-1234-123456789abc'
const second = 'mac:12345678-1234-1234-1234-123456789def'
const display = { id, name: '内置测试屏', width: 3024, height: 1964, isPrimary: true, builtIn: true, protocol: 'apple', canBrightness: true, canContrast: false, brightness: 45.458230376243591 }
let host, views, displays
const calls = action => host.ipcCalls.filter(([m, p]) => m === 'monitor_control' && p.action === action)
const snapshot = () => ({ success: true, displays: structuredClone(displays), topology: `${id}/1/0` })
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
beforeEach(() => {
  host = createHost(); views = []; displays = [structuredClone(display)]
  host.ipc.system_get_platform = async () => ({ success: true, platform: 'macos' })
  host.ipc.monitor_control = async p => {
    if (p.action === 'list') return snapshot()
    if (p.action === 'sleep') return { success: true, requested: true }
    const changed = p.changes.map(c => { const d = displays.find(d => d.id === c.id); assert.equal(c.expected, d[c.control]); d[c.control] = Math.fround(c.value / 100) * 100; return { id: c.id, control: c.control, value: d[c.control], maximum: 0 } })
    return { success: true, changed }
  }
})
afterEach(async () => { for (const v of views) v.unmount(); await tick() })
async function open() { const v = await mount(Command, host); views.push(v); await tick(); return v }
async function form() { const v = await mountPushed(host); views.push(v); return v }
const button = (v, id) => v.tree().props.filterBar.actions.find(a => a.id === id).onAction()

test('入口先识别 Mac，再真实读取；布局一不伪造亮度或暴露不支持的对比度', async () => {
  const v = await open(); assert.equal(v.tree().props.isShowingDetail, false); assert.equal(v.items().length, 1)
  assert.match(v.text(), /亮度 45%/); assert.deepEqual(v.actions(v.item(id)).map(a => a.props.title), ['亮度增加 10%', '亮度降低 10%', '设置亮度…'])
  assert.equal(calls('set').length, 0); assert.ok(!host.ipcCalls.some(([m]) => m === 'dllplugin_call'))
  assert.deepEqual(v.tree().props.filterBar.actions.map(a => a.id), ['refresh', 'all'])
})
test('Enter 主动作成功后重读实际值，失败清除旧状态并明确提示', async () => {
  const v = await open(); await v.run(v.item(id), '亮度增加 10%')
  assert.equal(calls('set')[0][1].changes[0].expected, display.brightness); assert.equal(calls('set')[0][1].changes[0].value, 55)
  assert.match(v.text(), /亮度 55%/); assert.equal(host.lastToast().style, 'SUCCESS')
  host.ipc.monitor_control = async () => { throw new Error('调节未完成，已核验恢复原值') }
  await v.run(v.item(id), '亮度降低 10%'); assert.match(v.text(), /已核验恢复原值/); assert.match(v.item('empty').props.title, /未确认/); assert.equal(host.lastToast().style, 'FAILURE')
})
test('读取失败与空列表区别展示，平台失败不会调用旧接口', async () => {
  host.ipc.monitor_control = async () => { throw new Error('组件未构建') }
  const v = await open(); assert.match(v.text(), /组件未构建/); assert.match(v.text(), /状态未确认/)
  host.ipc.monitor_control = async () => ({ success: true, topology: '', displays: [] }); await button(v, 'refresh'); assert.match(v.text(), /已连接 0 台/)
  host.ipc.system_get_platform = async () => { throw new Error('平台读取失败') }
  const fail = await open(); assert.match(fail.text(), /平台读取失败/); assert.ok(!host.ipcCalls.some(([m]) => m === 'dllplugin_call'))
})
test('亮度表单保留真实小数；非法值不写，精确恢复值进入请求', async () => {
  const v = await open(); await v.run(v.item(id), '设置亮度…'); const f = await form()
  assert.equal(f.field('level').props.value, String(display.brightness))
  for (const value of ['', '-1', '101', 'Infinity', '3x']) { await f.fill('level', value); await f.run(null, '应用并核验'); assert.equal(calls('set').length, 0) }
  await f.fill('level', String(display.brightness)); await f.run(null, '应用并核验'); assert.equal(calls('set')[0][1].changes[0].value, display.brightness); assert.equal(host.pushed.length, 0)
})
test('表单操作失败保留输入并说明返回重扫，不默默停留', async () => {
  const v = await open(); await v.run(v.item(id), '设置亮度…'); const f = await form(); await f.fill('level', '46')
  host.ipc.monitor_control = async () => { throw new Error('结果未知，请重新扫描') }
  await f.run(null, '应用并核验'); assert.equal(host.pushed.length, 1); assert.equal(f.field('level').props.value, '46'); assert.match(f.text(), /返回显示器列表，重新扫描/)
})
test('全屏统一只包含支持亮度的设备，独立对比度按独立能力开放', async () => {
  displays.push({ ...display, id: second, name: '外接测试屏', builtIn: false, protocol: 'ddcci', canBrightness: false, brightness: undefined, canContrast: true, contrast: 40 })
  const v = await open(); assert.deepEqual(v.actions(v.item(second)).map(a => a.props.title), ['设置对比度…'])
  await button(v, 'all'); const f = await form(); await f.fill('level', '48'); await f.run(null, '应用并核验'); assert.deepEqual(calls('set')[0][1].changes.map(c => c.id), [id])
  await v.dropdown('external'); assert.deepEqual(v.items().map(i => i.props.id), [second]); await v.search('不匹配'); assert.equal(v.items()[0].props.id, 'empty')
})
test('重复点击只写一次，关闭后不弹迟到成功消息', async () => {
  const v = await open(), pending = defer(); host.ipc.monitor_control = () => pending.promise
  const action = v.actions(v.item(id))[0].props.onAction, first = action(); await action(); await button(v, 'refresh'); assert.equal(calls('set').length, 1)
  const toastCount = host.toasts.length; v.unmount(); pending.resolve({ success: true, changed: [{ id, control: 'brightness', value: Math.fround(.55) * 100, maximum: 0 }] }); await first; assert.equal(host.toasts.length, toastCount)
})
test('显示器能力与回执严格校验，不把畸形数据或未改变的细微目标当成功', async () => {
  for (const bad of [{ ...display, brightness: undefined }, { ...display, canContrast: true }, { ...display, brightness: 101 }]) {
    host.ipc.monitor_control = async () => ({ success: true, topology: 'test', displays: [bad] }); await assert.rejects(scanDisplays())
  }
  const state = snapshot()
  for (const changed of [[], [{ id, control: 'brightness', value: display.brightness, maximum: 0 }], [{ id: 'other', control: 'brightness', value: 46, maximum: 0 }]]) {
    host.ipc.monitor_control = async () => ({ success: true, changed }); await assert.rejects(setDisplays(state, [id], 'brightness', 46))
  }
  host.ipc.monitor_control = async () => ({ success: true, changed: [{ id, control: 'brightness', value: 50, maximum: 10 }] })
  await setDisplays(state, [id], 'brightness', 46)
})
test('入口清单齐全，熄屏为 no-view 固定请求；失败和重复调用均不能假成功', async () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../plugin.json', import.meta.url)))
  assert.deepEqual(Object.keys(commands).sort(), manifest.features.map(f => f.code).sort()); assert.equal(manifest.features.find(f => f.code === 'monitor-sleep').mode, 'no-view')
  assert.match(await SleepMonitorsCommand(), /已向系统发送熄屏请求/); assert.equal(calls('sleep').length, 1)
  host.ipc.monitor_control = async () => ({ success: true, requested: false }); await assert.rejects(SleepMonitorsCommand(), /未确认/)
  const pending = defer(); host.ipc.monitor_control = () => pending.promise; const first = SleepMonitorsCommand(); await tick(); await assert.rejects(SleepMonitorsCommand(), /正在执行/)
  pending.resolve({ success: true, requested: true }); await first
})
test('Windows 与 Mac 共用新接口：内屏 WMI 背光与外接 DDC/CI 逐屏读回，熄屏需系统确认，不再调用旧处理器', async () => {
  host.ipc.system_get_platform = async () => ({ success: true, platform: 'windows' })
  const panel = 'win:12345678-1234-1234-1234-123456789abc', ddc = 'win:12345678-1234-1234-1234-123456789def'
  displays = [
    { id: panel, name: '内置屏', width: 1920, height: 1200, isPrimary: true, builtIn: true, protocol: 'wmi', canBrightness: true, canContrast: false, brightness: 60 },
    { id: ddc, name: 'DELL U2720Q', width: 3840, height: 2160, isPrimary: false, builtIn: false, protocol: 'ddcci', canBrightness: true, canContrast: true, brightness: 30, contrast: 75 }
  ]
  const v = await open(); assert.equal(v.items().length, 2); assert.match(v.text(), /亮度 60%/); assert.match(v.text(), /对比度 75%/)
  await v.run(v.item(ddc), '亮度增加 10%'); assert.deepEqual(calls('set')[0][1].changes, [{ id: ddc, control: 'brightness', value: 40, expected: 30 }])
  assert.equal(host.lastToast().style, 'SUCCESS')
  assert.equal(await SleepMonitorsCommand(), '已向系统发送熄屏请求；是否锁屏由系统设置决定'); assert.equal(calls('sleep').length, 1)
  host.ipc.monitor_control = async () => ({ success: true })
  await assert.rejects(SleepMonitorsCommand(), /熄屏请求未确认/)
  assert.ok(!host.ipcCalls.some(([m]) => m === 'dllplugin_call'))
})
test('等待宿主回执的时限：列表与熄屏 30 秒，调节按显示器数放宽并比宿主组件时限多留 5 秒；宿主超时如实报错', async () => {
  host.ipc.system_get_platform = async () => ({ success: true, platform: 'windows' })
  const ids = Array.from({ length: 16 }, (_, n) => `win:12345678-1234-1234-1234-${n.toString(16).padStart(12, '0')}`)
  displays = ids.map((id, n) => ({ id, name: `屏 ${n}`, width: 1920, height: 1080, isPrimary: n === 0, builtIn: false, protocol: 'ddcci', canBrightness: true, canContrast: false, brightness: 40 }))
  // 包装测试宿主的传输层，记录插件每次请求带的 timeoutMs
  const seen = [], methods = globalThis.__ztoolsElectron.transport.methods
  globalThis.__ztoolsElectron.transport = { methods: new Proxy({}, { get: (_t, method) => async req => { seen.push([req.params?.action ?? method, req.timeoutMs]); return methods[method](req) } }) }
  const snap = await scanDisplays()
  await setDisplays(snap, ids.slice(0, 1), 'brightness', 50)
  await setDisplays(await scanDisplays(), ids.slice(0, 4), 'brightness', 60)
  await setDisplays(await scanDisplays(), ids, 'brightness', 70)
  await SleepMonitorsCommand()
  assert.deepEqual(seen.filter(([a]) => a !== 'system_get_platform'), [['list', 30000], ['set', 31000], ['list', 30000], ['set', 49000], ['list', 30000], ['set', 121000], ['sleep', 30000]])
  // 宿主侧超时（或组件被结束）时不声称成功
  host.ipc.monitor_control = async () => { throw Object.assign(new Error('请求超时'), { code: 'REQUEST_TIMEOUT' }) }
  await assert.rejects(setDisplays(snap, ids.slice(0, 2), 'brightness', 80), /请求超时/)
})
test('清单只声明用到的 screen 与 system 权限，列表命令说明不宣称列表内能熄屏', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../plugin.json', import.meta.url)))
  assert.deepEqual(manifest.permissions, ['screen', 'system'])
  assert.doesNotMatch(manifest.features.find(f => f.code === 'monitor-brightness').explain, /一键熄屏/)
})
