// 界面集成测试：真实声明式运行时 + 模拟客户端（确认框、提示、preload IPC 可注入结果或故障）
// 覆盖：灰阶标签；需要确认的操作取消时不调用客户端、确认后才执行；执行失败提示原因；没有跳过确认的入口
import test from 'node:test'
import assert from 'node:assert/strict'
import { Toast } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import SystemCommand from '../dist/index.js'

const host = createHost()
const rejections = []
process.on('unhandledRejection', (reason) => rejections.push(reason))

test.beforeEach(() => {
  host.reset()
  rejections.length = 0
})

const dllCalls = () => host.ipcCalls.filter(([m]) => m === 'dllplugin_call')

test('列表只用灰阶标签，没有跳过确认的动作', async () => {
  const view = await mount(SystemCommand)
  const text = view.text()
  assert.equal(/"color"/.test(text), false, '列表里不应设置颜色')
  assert.equal(/跳过/.test(text), false)
  const trash = view.item('empty-trash')
  assert.deepEqual(trash.props.accessories, [{ tag: { value: '执行前确认' } }])
  assert.equal(view.actions(trash).length, 1)
  view.unmount()
})

test('清空回收站：用户取消确认时不调用客户端，提示已取消', async () => {
  host.setConfirm(false)
  host.ipc.dllplugin_call = async () => ({ ok: true, success: true })
  const view = await mount(SystemCommand)
  await view.run(view.item('empty-trash'), '清空回收站（需确认）')
  await tick(10)
  assert.equal(host.confirms.length, 1)
  assert.equal(host.confirms[0].primaryAction.style, 'destructive')
  assert.equal(dllCalls().length, 0)
  assert.equal(host.lastToast().title, '已取消')
  assert.deepEqual(rejections, [])
  view.unmount()
})

test('清空回收站：确认后调用客户端并按结果提示', async () => {
  host.setConfirm(true)
  host.ipc.dllplugin_call = async () => ({ ok: true, success: true, alreadyEmpty: true })
  const view = await mount(SystemCommand)
  await view.run(view.item('empty-trash'), '清空回收站（需确认）')
  await tick(10)
  assert.equal(dllCalls().length, 1)
  assert.deepEqual(dllCalls()[0][1], { plugin: 'SystemActionsPlugin', func: 'emptyTrash', params: {} })
  assert.equal(host.lastToast().style, Toast.Style.Success)
  assert.equal(host.lastToast().title, '回收站本来就是空的')
  view.unmount()
})

test('[故障] 调高音量时客户端返回失败：提示失败原因，不提示成功', async () => {
  host.ipc.dllplugin_call = async () => ({ ok: false, success: false, error: 'ACTION_FAILED: 发送音量按键未得到确认' })
  const view = await mount(SystemCommand)
  await view.run(view.item('volume-up'), '调高系统音量')
  await tick(10)
  assert.equal(host.confirms.length, 0)
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.equal(host.lastToast().title, '调高系统音量失败')
  assert.match(host.lastToast().message, /发送音量按键未得到确认/)
  assert.deepEqual(rejections, [])
  view.unmount()
})

test('[故障] 关机：确认后客户端抛错，提示失败原因', async () => {
  host.setConfirm(true)
  host.ipc.system_shutdown = async (params) => {
    assert.deepEqual(params, { force: false, timeout: 0 })
    throw Object.assign(new Error('系统电源操作失败'), { code: 'PROCESS_ERROR' })
  }
  const view = await mount(SystemCommand)
  await view.run(view.item('shut-down'), '关机（需确认）')
  await tick(10)
  assert.equal(host.confirms.length, 1)
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.equal(host.lastToast().message, '系统电源操作失败')
  view.unmount()
})

test('按分类筛选与搜索', async () => {
  const view = await mount(SystemCommand)
  await view.dropdown('audio')
  assert.deepEqual(view.items().map((i) => i.props.id), ['toggle-mute', 'volume-up', 'volume-down'])
  await view.dropdown('all')
  await view.search('锁屏')
  assert.deepEqual(view.items().map((i) => i.props.id), ['lock-screen'])
  view.unmount()
})
