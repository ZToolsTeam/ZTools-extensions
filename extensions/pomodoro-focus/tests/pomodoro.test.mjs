import test, { beforeEach, afterEach } from 'node:test'
import { getDeclarativeBridge } from '@ztools/declarative-ui'
import assert from 'node:assert/strict'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import Command, { commands, localDay } from '../dist/index.js'
import { COUNTDOWN_STORAGE_KEY, loadCountdowns, changeCountdown } from '../dist/countdown-storage.js'
import { calculateDaysLeft, validateCountdownInput } from '../dist/pomodoro-service.js'
let host, views, state
const fresh = () => ({ id: 'session-1', title: '25 分钟深度专注', status: 'running', mode: 'pomodoro', phase: 'focus', totalDurationMs: 1_500_000, remainingMs: 1_500_000, completedCycles: 0 })
beforeEach(() => {
  host = createHost(); views = []; state = null
  host.ipc.focus_get_current = async () => state
  host.ipc.focus_start = async () => { if (state && ['running', 'paused'].includes(state.status)) throw new Error('已有计时'); return state = fresh() }
  for (const [method, status] of [['focus_pause','paused'], ['focus_resume','running'], ['focus_cancel','cancelled']]) host.ipc[method] = async () => state = { ...state, status }
})
afterEach(async () => { for (const v of views) v.unmount(); await tick() })
const open = async (command = Command) => { const v = await mount(command, host); views.push(v); return v }
const refresh = async v => { await v.tree().props.filterBar.actions[0].onAction(); await tick() }
const save = async form => { await form.run(null, '保存倒数日') }
const item = () => ({ id: 'a', title: '工作上线', targetDate: '2028-02-29', category: 'work', isRecurring: false, createdAt: 1000 })

test('真实 SDK 首屏无假日程和假完成数，主次动作及暂停继续均以宿主回执为准', async () => {
  const v = await open(); assert.equal(v.tree().props.isShowingDetail, false); assert.match(v.text(), /累计完成 0/); assert.match(v.text(), /还没有倒数日/); assert.doesNotMatch(v.text(), /ZTools 2.0|发薪日与绩效/)
  await v.run(v.item('pomodoro-timer'), '开始 25 分钟专注'); assert.equal(state.status, 'running'); assert.equal(host.ipcCalls.find(([m]) => m === 'focus_start')[1].mode, 'pomodoro')
  await v.run(v.item('pomodoro-timer'), '暂停专注'); assert.match(v.text(), /专注已暂停/)
  await v.run(v.item('pomodoro-timer'), '继续专注'); assert.match(v.text(), /专注进行中/)
  await v.run(v.item('pomodoro-timer'), '取消当前计时'); assert.match(v.text(), /番茄钟已就绪/)
  assert.ok(!v.tree().props.filterBar.actions.some(a => /专注/.test(a.title)))
})
test('开始快捷入口真实调用宿主；离开重进保留宿主状态，不重建计时；新建入口直接打开表单', async () => {
  const v = await open(commands['pomodoro-start']); assert.equal(host.ipcCalls.filter(([m]) => m === 'focus_start').length, 1)
  v.unmount(); state.remainingMs = 1200000
  const reopened = await open(); assert.match(reopened.text(), /20:00/); assert.equal(host.ipcCalls.filter(([m]) => m === 'focus_start').length, 1)
  const again = await open(commands['pomodoro-start']); assert.match(again.text(), /20:00/); assert.equal(host.ipcCalls.filter(([m]) => m === 'focus_start').length, 1)
  const root = await open(commands['pomodoro-new-countdown']); assert.equal(root.tree().type, 'List'); const form = await mountPushed(host); views.push(form); assert.equal(form.tree().type, 'Form'); assert.match(form.text(), new RegExp(localDay())); await form.fill('title','快捷创建'); await save(form); assert.equal(host.pushed.length,0); assert.match(root.text(),/快捷创建/)
})
test('倒数日完整创建、编辑、筛选、复制、确认删除与空列表持久化', async () => {
  const v = await open(); await v.tree().props.filterBar.actions[1].onAction(); const form = await mountPushed(host); views.push(form)
  await form.fill('title', '项目上线'); await form.fill('targetDate','2028-02-29'); await save(form)
  let saved = await loadCountdowns(); assert.equal(saved.length, 1); assert.equal(saved[0].title, '项目上线'); assert.match(v.text(), /项目上线/)
  await v.search('不匹配'); assert.match(v.text(), /没有匹配/); await v.search(''); await v.run(v.item(saved[0].id), '复制天数摘要'); assert.match(host.clipboard.text, /项目上线/)
  await v.run(v.item(saved[0].id), '编辑倒数日'); const edit = await mountPushed(host); views.push(edit); await edit.fill('title','新的上线'); await save(edit); saved = await loadCountdowns(); assert.equal(saved[0].title,'新的上线')
  host.setConfirm(false); await v.run(v.item(saved[0].id), '删除倒数日'); assert.equal((await loadCountdowns()).length,1)
  host.setConfirm(true); await v.run(v.item(saved[0].id), '删除倒数日'); assert.deepEqual(await loadCountdowns(),[])
  const reopened = await open(); assert.match(reopened.text(), /还没有倒数日/); assert.equal(host.storage.get(COUNTDOWN_STORAGE_KEY),'[]')
})
test('损坏数据、读取或保存失败不重置存储，也不报保存成功', async () => {
  host.storage.set(COUNTDOWN_STORAGE_KEY,'{"broken":true}'); const v = await open(); assert.match(v.text(), /存储损坏/); const original = host.storage.get(COUNTDOWN_STORAGE_KEY)
  await assert.rejects(changeCountdown(item()),/损坏/); assert.equal(host.storage.get(COUNTDOWN_STORAGE_KEY),original)
  host.storage.set(COUNTDOWN_STORAGE_KEY,JSON.stringify([item()])); host.faults.storageWrite = new Error('磁盘已满')
  await assert.rejects(changeCountdown({...item(),title:'覆盖'},item()),/磁盘已满/); assert.equal(JSON.parse(host.storage.get(COUNTDOWN_STORAGE_KEY))[0].title,'工作上线')
  host.faults.storageWrite=null; host.faults.storageRead=new Error('读取失败'); await refresh(v); assert.match(v.text(),/读取失败/); assert.equal(JSON.parse(host.storage.get(COUNTDOWN_STORAGE_KEY)).length,1)
})
test('多窗口修改冲突被拒绝，先保存的修改不会被旧表单覆盖；读取到空数组不复活默认数据', async () => {
  await changeCountdown(item()); const old = (await loadCountdowns())[0]
  await changeCountdown({...old,title:'别的窗口'},old)
  await assert.rejects(changeCountdown({...old,title:'迟到'},old),/其他窗口/); await assert.rejects(changeCountdown(null,old),/其他窗口/)
  assert.equal((await loadCountdowns())[0].title,'别的窗口')
})
test('宿主失败、畸形响应和迟到结果不会变成成功；重复点击只发送一次', async () => {
  const v = await open(); let finish
  host.ipc.focus_start = () => new Promise(resolve => {finish=resolve})
  const action = v.actions(v.item('pomodoro-timer'))[0]; const job = action.props.onAction(); await tick(); await action.props.onAction(); assert.equal(host.ipcCalls.filter(([m])=>m==='focus_start').length,1)
  const count=host.toasts.length; v.unmount(); finish(fresh()); await job; assert.equal(host.toasts.length,count)
  host.ipc.focus_get_current = async () => ({...fresh(),status:['running']}); const invalid = await open(); assert.match(invalid.text(),/状态无效/)
  host.ipc.focus_get_current = async () => {throw new Error('宿主不可用')}; await refresh(invalid); assert.match(invalid.text(),/宿主不可用/)
})
test('倒数日用本地日期，月末和闰年正确，拒绝超长标题与不存在日期', () => {
  assert.equal(calculateDaysLeft('2027-01-01',false,new Date(2026,11,31,23,59)).days,1)
  assert.equal(calculateDaysLeft('2026-01-31',true,'2026-02-01').resolvedDate,'2026-02-28')
  assert.equal(calculateDaysLeft('2028-01-31',true,'2028-02-01').resolvedDate,'2028-02-29')
  assert.equal(validateCountdownInput({title:'a',targetDate:'2026-02-29'}).valid,false)
  assert.equal(validateCountdownInput({title:'x'.repeat(201),targetDate:'2028-02-29'}).valid,false)
})

test('等待读取或删除确认时离开页面，迟到结果不再修改倒数日', async () => {
  const v = await open(); await v.tree().props.filterBar.actions[1].onAction(); const form = await mountPushed(host); views.push(form); await form.fill('title','迟到新增')
  const bridge = getDeclarativeBridge(), originalRead = bridge.storageGetItem; let releaseRead
  bridge.storageGetItem = () => new Promise(resolve => { releaseRead = resolve })
  const saving = save(form); await tick(); form.unmount(); releaseRead(undefined); await saving; bridge.storageGetItem = originalRead
  assert.equal(host.storage.size,0)
  await changeCountdown(item()); await refresh(v); let releaseConfirm
  bridge.confirmAlert = () => new Promise(resolve => {releaseConfirm=resolve})
  const deleting = v.run(v.item('a'),'删除倒数日'); await tick(); v.unmount(); releaseConfirm(true); await deleting
  assert.equal((await loadCountdowns()).length,1)
})

test('[并发] 每秒轮询进行中时按键不被吞掉；操作前发出的轮询结果迟到也不覆盖操作回执', async () => {
  state = fresh()
  const v = await open()
  let releasePoll
  host.ipc.focus_get_current = () => new Promise(resolve => { releasePoll = () => resolve({ ...fresh(), remainingMs: 1_400_000 }) })
  await new Promise(resolve => setTimeout(resolve, 1100))
  assert.equal(typeof releasePoll, 'function', '轮询已发出且未返回')
  await v.run(v.item('pomodoro-timer'), '暂停专注')
  assert.equal(host.ipcCalls.filter(([m]) => m === 'focus_pause').length, 1, '轮询期间的暂停仍然发给宿主')
  assert.match(v.text(), /专注已暂停/)
  releasePoll(); await tick()
  assert.match(v.text(), /专注已暂停/, '迟到的旧轮询结果没有把状态改回进行中')
  host.ipc.focus_get_current = async () => state
})

test('宿主状态冲突的英文错误转成中文原因', async () => {
  state = fresh()
  const v = await open()
  host.ipc.focus_pause = async () => { throw new Error('No active running focus session to pause') }
  await v.run(v.item('pomodoro-timer'), '暂停专注')
  assert.match(host.lastToast().message, /当前没有进行中的计时/)
  assert.doesNotMatch(v.text(), /No active/)
})

test('短休息中打开“立即开始专注”给出提示，回车结束休息并真正开始专注', async () => {
  state = { ...fresh(), id: 'break-1', title: '5 分钟短休息', phase: 'short_break', totalDurationMs: 300_000, remainingMs: 200_000, completedCycles: 1 }
  const v = await open(commands['pomodoro-start'])
  assert.equal(host.ipcCalls.filter(([m]) => m === 'focus_start').length, 0)
  assert.match(host.lastToast().title, /正在短休息，未开始新的专注/)
  assert.equal(v.actions(v.item('pomodoro-timer'))[0].props.title, '结束休息并开始专注')
  await v.run(v.item('pomodoro-timer'), '结束休息并开始专注')
  assert.deepEqual(host.ipcCalls.filter(([m]) => /focus_(cancel|start)/.test(m)).map(([m]) => m), ['focus_cancel', 'focus_start'])
  assert.equal(state.phase, 'focus'); assert.match(v.text(), /专注进行中/)
  assert.ok(!v.actions(v.item('pomodoro-timer')).some(a => a.props.title === '结束休息并开始专注'))
})

test('[故障注入] 结束休息后开始专注失败，不冒充已开始，提示失败并可重新读取', async () => {
  state = { ...fresh(), phase: 'long_break', title: '15 分钟长休息', totalDurationMs: 900_000, remainingMs: 600_000 }
  const v = await open(commands['pomodoro-start'])
  assert.match(host.lastToast().title, /正在长休息/)
  host.ipc.focus_start = async () => { throw new Error('通知权限未授予') }
  await v.run(v.item('pomodoro-timer'), '结束休息并开始专注')
  assert.equal(host.lastToast().title, '未能开始专注，请刷新状态')
  assert.doesNotMatch(v.text(), /专注进行中/); assert.equal(state.status, 'cancelled')
  await v.run(v.item('load-error'), '重新读取'); assert.match(v.text(), /番茄钟已就绪/)
})

test('普通入口在休息中只把“结束休息并开始专注”作为次动作；专注进行中再次快捷开始只提示不重复开始', async () => {
  state = { ...fresh(), phase: 'short_break', title: '5 分钟短休息', totalDurationMs: 300_000, remainingMs: 100_000 }
  const v = await open()
  assert.deepEqual(v.actions(v.item('pomodoro-timer')).slice(0, 2).map(a => a.props.title), ['暂停短休息', '结束休息并开始专注'])
  state = fresh(); v.unmount()
  await open(commands['pomodoro-start'])
  assert.match(host.lastToast().title, /已有进行中的专注/)
  assert.equal(host.ipcCalls.filter(([m]) => m === 'focus_start').length, 0)
})
