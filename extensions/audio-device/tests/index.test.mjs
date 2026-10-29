import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import Command, { AudioDeviceManager, AudioMuteToggleCommand, commands } from '../dist/index.js'

const host = createHost()
const views = []
const track = view => { views.push(view); return view }
const open = async (command = Command) => track(await mount(command))
const child = async () => track(await mountPushed(host))
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const output = { id: 'output:speaker', uid: 'speaker', name: '测试扬声器', type: 'output', isDefault: true, canSetDefault: true, canSetVolume: true, canMute: true, volume: 40, muted: false }
const input = { ...output, id: 'input:microphone', uid: 'microphone', name: '测试麦克风', type: 'input', volume: 80 }
const hdmi = { id: 'output:hdmi', uid: 'hdmi', name: '测试显示器', type: 'output', isDefault: false, canSetDefault: true, canSetVolume: false, canMute: false }
let devices
const writes = () => host.ipcCalls.filter(([method]) => method !== 'audio_get_devices')
const manager = async () => { const value = new AudioDeviceManager(); await value.syncDevicesFromHost(); return value }
test.beforeEach(() => {
  host.reset(); devices = structuredClone([output, input, hdmi])
  host.ipc.audio_get_devices = async () => structuredClone(devices)
  for (const method of ['audio_set_default_device', 'audio_set_volume', 'audio_toggle_mute']) {
    host.ipc[method] = async params => {
      const device = devices.find(item => item.id === params.id && item.type === params.type)
      assert.ok(device)
      assert.deepEqual(Object.keys(params).sort(), (method === 'audio_set_volume' ? ['id', 'type', 'volume'] : method === 'audio_toggle_mute' ? ['id', 'muted', 'type'] : ['id', 'type']))
      if (method === 'audio_set_default_device') for (const item of devices) { if (item.type === device.type) item.isDefault = item.id === device.id }
      if (method === 'audio_set_volume') device.volume = params.volume
      if (method === 'audio_toggle_mute') device.muted = params.muted
      return { success: true, details: { ...device } }
    }
  }
})
test.afterEach(() => { for (const view of views.splice(0)) view.unmount() })

test('正常打开只读真实设备；不支持的控制不出现，也不编造音量和组合', async () => {
  const view = await open(commands['audio-switch'])
  assert.equal(view.items().length, 3)
  assert.equal(writes().length, 0)
  assert.match(view.item(hdmi.id).props.subtitle, /不提供音量/)
  assert.deepEqual(view.actions(view.item(hdmi.id)).map(a => a.props.title), ['设为默认输出', '设为常用', '查看设备信息'])
  assert.doesNotMatch(view.text(), /48.*kHz|组合|场景|70%/)
  assert.equal(view.tree().props.isShowingDetail, false)
  assert.equal(view.tree().props.filterBar.actions.length, 1)
})

test('清单命令都有显式入口，麦克风入口与搜索不会改掉实际默认设备摘要', async () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../plugin.json', import.meta.url)))
  assert.deepEqual(Object.keys(commands).sort(), manifest.features.map(f => f.code).sort())
  assert.equal(manifest.features.find(f => f.code === 'audio-mute-toggle').mode, 'no-view')
  const view = await open(commands['audio-input'])
  assert.deepEqual(view.items().map(i => i.props.id), [input.id])
  const summary = view.tree().props.filterBar.summaryText
  assert.match(summary, /默认输出：测试扬声器/)
  await view.search('没有这个设备')
  assert.equal(view.items()[0].props.id, 'empty')
  assert.equal(view.tree().props.filterBar.summaryText, summary)
  assert.equal(writes().length, 0)
})

test('Enter 等待真实结果，失败不改默认设备，重试成功后再更新', async () => {
  const pending = deferred(); host.ipc.audio_set_default_device = () => pending.promise
  const view = await open(); const action = view.actions(view.item(hdmi.id))[0]
  assert.equal(action.props.title, '设为默认输出')
  const request = action.props.onAction()
  await tick()
  assert.equal(host.toasts.length, 0)
  assert.match(view.text(), /正在读取或设置/)
  pending.resolve({ success: false, error: '设备已断开' }); await request
  assert.equal(host.lastToast().style, 'FAILURE')
  assert.match(view.tree().props.filterBar.summaryText, /默认输出：测试扬声器/)
  host.ipc.audio_set_default_device = async () => ({ success: true, details: { ...hdmi, isDefault: true } })
  await view.run(view.item(hdmi.id), '设为默认输出')
  assert.match(view.tree().props.filterBar.summaryText, /默认输出：测试显示器/)
  assert.equal(view.item(output.id).props.accessories.length, 0)
})

test('麦克风静音精确传入输入方向与设备标识，不改变扬声器', async () => {
  const view = await open(commands['audio-input'])
  await view.run(view.item(input.id), '静音设备')
  assert.deepEqual(writes()[0], ['audio_toggle_mute', { id: input.id, type: 'input', muted: true }])
  assert.equal(devices[0].muted, false)
  assert.match(view.item(input.id).props.subtitle, /已静音/)
})

test('快速连按与进行中的刷新只执行一次写入，退出后不弹迟到的成功提示', async () => {
  const pending = deferred(); host.ipc.audio_toggle_mute = () => pending.promise
  const view = await open(); const action = view.actions(view.item(output.id)).find(a => a.props.title === '静音设备').props.onAction
  const first = action(); const second = action()
  await view.tree().props.filterBar.actions[0].onAction()
  assert.equal(writes().length, 1)
  view.unmount()
  pending.resolve({ success: true, details: { ...output, muted: true } })
  await Promise.all([first, second]); assert.equal(host.toasts.length, 0)
})

test('音量表单保留注入宿主，拒绝空值和非法值，零音量有效且不擅自取消静音', async () => {
  const injectedCalls = []
  const injected = { audio_get_devices: async () => [{ ...output, muted: true }], audio_set_volume: async params => {
    injectedCalls.push(params); return { success: true, details: { ...output, muted: true, volume: params.volume } }
  } }
  const view = await open(() => Command({ hostOverride: injected }))
  await view.run(view.item(output.id), '设置音量…'); const form = await child()
  for (const value of ['', '  ', '-1', '101', 'NaN', 'Infinity']) {
    await form.fill('volume', value); await form.run(null, '应用音量')
    assert.equal(injectedCalls.length, 0); assert.equal(host.lastToast().style, 'FAILURE')
  }
  await form.fill('volume', '0'); await form.run(null, '应用音量')
  assert.deepEqual(injectedCalls, [{ id: output.id, type: 'output', volume: 0 }])
  assert.equal(host.pushed.length, 0)
  assert.match(view.item(output.id).props.subtitle, /已静音/)
  assert.equal(writes().length, 0)
})

test('音量表单重复提交只写一次；失败保留表单和旧状态，恢复后可以重试', async () => {
  const pending = deferred(); host.ipc.audio_set_volume = () => pending.promise
  const view = await open(); await view.run(view.item(output.id), '设置音量…'); const form = await child()
  await form.fill('volume', '20'); const submit = form.actions(null)[0].props.onSubmit
  const first = submit(); const second = submit(); await form.fill('volume', '90')
  assert.equal(writes().length, 1); assert.equal(form.field('volume').props.value, '20')
  pending.resolve({ success: false, error: 'REQUEST_TIMEOUT' }); await Promise.all([first, second]); await tick()
  assert.equal(host.pushed.length, 1); assert.match(view.item(output.id).props.subtitle, /40%/)
  host.ipc.audio_set_volume = async () => ({ success: true, details: { ...output, volume: 20 } })
  await form.run(null, '应用音量'); assert.equal(host.pushed.length, 0)
  assert.match(view.item(output.id).props.subtitle, /20%/)
})

test('步进音量等待确认并限制在 0 到 100；无效 delta 与不支持设备不会写入', async () => {
  const service = await manager()
  assert.equal((await service.stepDeviceVolume(output.id, -100)).volume, 0)
  assert.equal((await service.stepDeviceVolume(output.id, 110)).volume, 100)
  const count = writes().length
  await assert.rejects(service.stepDeviceVolume(output.id, NaN))
  await assert.rejects(service.setDeviceVolume(hdmi.id, 20), /不支持/)
  await assert.rejects(service.toggleDeviceMute(hdmi.id), /不支持/)
  assert.equal(writes().length, count)
})

test('列表读取失败显示原错误；重试后恢复真实空列表', async () => {
  host.ipc.audio_get_devices = () => { throw new Error('组件未构建') }
  const view = await open(); assert.match(view.item('error').props.subtitle, /组件未构建/)
  host.ipc.audio_get_devices = async () => []
  await view.tree().props.filterBar.actions[0].onAction(); await tick()
  assert.equal(view.items()[0].props.id, 'empty')
  assert.match(view.tree().props.filterBar.summaryText, /默认输出：无 · 默认输入：无/)
})

test('缺少真实默认设备时不拿首项冒充；一键静音不写入', async () => {
  devices.forEach(device => { device.isDefault = false })
  const service = await manager(); assert.equal(service.getDefaultOutputDevice(), undefined)
  await assert.rejects(commands['audio-mute-toggle'](), /没有默认输出设备/)
  assert.equal(writes().length, 0)
})

test('畸形、重复列表与错误设备读回不会被当成成功', async () => {
  for (const payload of [null, {}, [{}], [output, output], [{ ...output, volume: NaN }], [{ ...output, muted: 'false' }]]) {
    host.ipc.audio_get_devices = async () => payload
    await assert.rejects(new AudioDeviceManager().syncDevicesFromHost())
  }
  host.ipc.audio_get_devices = async () => [output]
  const service = await manager()
  for (const details of [{ ...input, volume: 20 }, { ...output, volume: 40 }, {}]) {
    host.ipc.audio_set_volume = async () => ({ success: true, details })
    await assert.rejects(service.setDeviceVolume(output.id, 20))
    assert.equal(service.getDefaultOutputDevice().volume, 40)
  }
})

test('先发后到的旧扫描不能覆盖新扫描或已经确认的写入', async () => {
  const service = await manager(); const pending = deferred()
  host.ipc.audio_get_devices = () => pending.promise
  const old = service.syncDevicesFromHost()
  await service.setDeviceVolume(output.id, 20)
  pending.resolve([output]); await old
  assert.equal(service.getDefaultOutputDevice().volume, 20)
  const late = deferred(); host.ipc.audio_get_devices = () => late.promise
  const view = await open()
  host.ipc.audio_get_devices = async () => [hdmi]
  await view.tree().props.filterBar.actions[0].onAction()
  late.resolve([output]); await tick()
  assert.deepEqual(view.items().map(item => item.props.id), [hdmi.id])
})

test('收藏持久化成功后才更新；存储读取或写入失败保留原数据', async () => {
  const service = await manager(); await service.toggleFavourite(output.id)
  assert.equal((await manager()).getDefaultOutputDevice().isFavourite, true)
  const snapshot = new Map(host.storage)
  host.faults.storageWrite = new Error('磁盘只读')
  await assert.rejects(service.toggleFavourite(output.id), /磁盘只读/)
  assert.equal(service.getDefaultOutputDevice().isFavourite, true)
  assert.deepEqual(host.storage, snapshot)
  host.faults.storageWrite = null; host.faults.storageRead = new Error('读取失败')
  const failed = await manager(); assert.match(failed.preferenceWarning, /读取失败/)
  await assert.rejects(failed.toggleFavourite(input.id), /读取失败/)
  assert.deepEqual(host.storage, snapshot)
  host.faults.storageRead = null; host.storage.set('audio-device-favourites-v1', JSON.stringify('{invalid'))
  const corrupt = await manager(); await assert.rejects(corrupt.toggleFavourite(input.id), /收藏读取失败/)
})

test('无界面静音入口只切换真实默认输出；重复调用受阻，失败后允许重试', async () => {
  const pending = deferred(); host.ipc.audio_toggle_mute = () => pending.promise
  const first = AudioMuteToggleCommand(); await tick()
  await assert.rejects(AudioMuteToggleCommand(), /正在执行/)
  assert.equal(writes().length, 1); assert.equal(host.pushed.length, 0)
  pending.resolve({ success: false, error: '设备断开' }); await assert.rejects(first, /设备断开/)
  host.ipc.audio_toggle_mute = async params => ({ success: true, details: { ...output, muted: params.muted } })
  assert.match(await commands['audio-mute-toggle'](), /已静音/)
  assert.deepEqual(writes().at(-1)[1], { id: output.id, type: 'output', muted: true })
})

test('连接方式显示为中文并可按中文搜索；未知连接方式不展示', async () => {
  devices = [{ ...output, transport: 'bluetooth' }, { ...hdmi, transport: 'hdmi' }, { ...input, transport: 'unknown' }]
  const view = await open(commands['audio-switch'])
  assert.match(view.item(output.id).props.subtitle, /输出 · 蓝牙 · 音量 40%/)
  assert.doesNotMatch(view.item(input.id).props.subtitle, /unknown/)
  await view.search('蓝牙')
  assert.deepEqual(view.items().map(i => i.props.id), [output.id])
  await view.search('hdmi')
  assert.deepEqual(view.items().map(i => i.props.id), [hdmi.id])
  const value = await manager()
  assert.equal(value.getAllDevices().find(d => d.id === input.id).transportType, 'unknown')
  assert.equal(writes().length, 0)
})

test('清单不声明未使用的 shell 权限', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../plugin.json', import.meta.url)))
  assert.ok(!manifest.permissions.includes('shell'))
})

test('已是默认的设备不再主推“设为默认”，静音成为主动作；非默认设备仍以设为默认为主动作', async () => {
  const view = await open(commands['audio-switch'])
  const outputTitles = view.actions(view.item(output.id)).map(a => a.props.title)
  assert.ok(!outputTitles.some(title => title.startsWith('设为默认')))
  assert.equal(outputTitles[0], '静音设备')
  assert.equal(view.actions(view.item(input.id)).map(a => a.props.title)[0], '静音设备')
  assert.equal(view.actions(view.item(hdmi.id))[0].props.title, '设为默认输出')
  await view.run(view.item(hdmi.id), '设为默认输出'); await tick()
  assert.equal(view.actions(view.item(hdmi.id))[0].props.title, '设为常用')
  assert.equal(view.actions(view.item(output.id))[0].props.title, '设为默认输出')
})

test('默认设备不支持静音时，设置音量成为主动作', async () => {
  devices[0].canMute = false
  const view = await open(commands['audio-switch'])
  assert.equal(view.actions(view.item(output.id))[0].props.title, '设置音量…')
})
