import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { getComponentFactory } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import { commands, validateLockState } from '../dist/index.js'
const host = createHost(), views = []
let current
function response(p, status = current?.status || 'unlocked') {
  return { success: true, operationId: p.operationId, status, remainingSeconds: status === 'locked' ? 15 : 0, blockedEvents: 0, lockPointer: p.lockPointer ?? current?.lockPointer ?? false, reason: '' }
}
test.beforeEach(() => {
  host.reset(); current = null
  host.ipc.keyboard_lock = async p => current = response(p, p.action === 'start' ? 'locked' : p.action === 'unlock' ? 'unlocked' : undefined)
})
test.afterEach(async () => { views.splice(0).forEach(v => v.unmount()); await tick() })
async function open() { const view = await mount(commands['clean-keyboard']); views.push(view); return view }
test('只有时长和范围选择，系统确认后才显示锁定，手动解除恢复列表', async () => {
  const view = await open(); assert.equal(view.tree().props.isShowingDetail, false); assert.equal(view.items().length, 5)
  assert.doesNotMatch(view.text(), /统计|无限期|24 小时/)
  await view.dropdown('all'); await view.run(view.item('duration-15'), '开始清洁')
  assert.equal(current.lockPointer, true); assert.equal(view.items().length, 1); assert.match(view.item('active').props.title, /键盘与鼠标已锁定/)
  await view.run(view.item('active'), '立即解除'); assert.equal(view.items().length, 5)
  assert.ok(host.ipcCalls.every(([method]) => method === 'keyboard_lock'))
})
test('权限失败、宿主拒绝及伪成功不显示已锁定', async () => {
  const view = await open()
  host.ipc.keyboard_lock = async p => { if (p.action === 'start') throw new Error('需要辅助功能权限'); return response(p) }
  await view.run(view.item('duration-15'), '开始清洁')
  assert.match(host.lastToast().message, /辅助功能/); assert.equal(view.items().length, 5); assert.doesNotMatch(view.text(), /键盘已锁定/)
  host.ipc.keyboard_lock = async p => response(p, 'unlocked')
  await view.run(view.item('duration-15'), '开始清洁'); assert.match(host.lastToast().message, /系统未确认/)
})
test('查询失败保留解除入口但明确状态未知，恢复后显示真实状态', async () => {
  const view = await open(); await view.run(view.item('duration-15'), '开始清洁')
  host.ipc.keyboard_lock = async () => { throw new Error('通信失败') }
  await delay(550); await tick()
  assert.match(view.item('active').props.title, /未确认/); assert.doesNotMatch(view.item('active').props.title, /已锁定/)
  host.ipc.keyboard_lock = async p => response(p, 'unlocked')
  await delay(550); await tick(); assert.equal(view.items().length, 5)
})
test('轮询不重入，手动解锁后旧locked结果不会覆盖新状态', async () => {
  const view = await open(); await view.run(view.item('duration-15'), '开始清洁')
  let finish, pending = 0
  host.ipc.keyboard_lock = p => p.action === 'status' ? new Promise(resolve => { pending++; finish = () => resolve(response(p, 'locked')) }) : Promise.resolve(response(p, 'unlocked'))
  await delay(1050); assert.equal(pending, 1)
  await view.run(view.item('active'), '立即解除'); finish(); await tick()
  assert.equal(view.items().length, 5); assert.doesNotMatch(view.text(), /系统输入锁已启用/)
})
test('重复启动被互斥，离开插件请求解除，迟到启动确认再次解除', async () => {
  const view = await open(); let finish, starts = 0
  host.ipc.keyboard_lock = p => p.action === 'start' ? new Promise(resolve => { starts++; finish = () => resolve(response(p, 'locked')) }) : Promise.resolve(response(p, 'unlocked'))
  const item = view.item('duration-15'), first = view.run(item, '开始清洁')
  await tick(); await view.run(item, '开始清洁'); assert.equal(starts, 1)
  view.unmount(); views.splice(views.indexOf(view), 1); await tick()
  assert.equal(host.ipcCalls.filter(([, p]) => p.action === 'unlock').length, 1)
  finish(); await first
  assert.equal(host.ipcCalls.filter(([, p]) => p.action === 'unlock').length, 2)
  assert.equal(host.toasts.length, 0)
})
test('严格校验状态信封与操作编号，初始失败无可用启动动作', async () => {
  const valid = response({ operationId: 'test' })
  for (const value of [{}, { ...valid, status: ['locked'] }, { ...valid, operationId: 'other' }, { ...valid, remainingSeconds: -1 }, { ...valid, remainingSeconds: 1 }, { ...valid, blockedEvents: NaN }, { ...valid, lockPointer: 'true' }]) assert.throws(() => validateLockState(value, 'test'))
  host.ipc.keyboard_lock = async () => { throw new Error('组件未安装') }
  const view = await open(); assert.equal(view.items().length, 1); assert.equal(view.item('unavailable').props.title, '无法连接系统输入锁')
  assert.deepEqual(view.actions(view.item('unavailable')).map(a => a.props.title), ['重新检查'])
})
test('自定义时长只接受5至300整数，验证失败不会调用系统锁定', async () => {
  const view = await open(), target = view.actions(view.item('duration-15'))[1].props.target
  const form = await mount(getComponentFactory(target)); views.push(form)
  const submit = form.actions()[0].props.onSubmit
  for (const seconds of ['', '4', '301', 'Infinity', '5.5', '任意文本']) await submit({ seconds })
  assert.equal(host.ipcCalls.filter(([, p]) => p.action === 'start').length, 0)
  await submit({ seconds: '45' })
  assert.equal(host.ipcCalls.find(([, p]) => p.action === 'start')[1].durationSeconds, 45)
})
