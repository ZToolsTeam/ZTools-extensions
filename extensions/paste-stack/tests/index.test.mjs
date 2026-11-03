import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { getDeclarativeBridge } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import Stack, { commands, CleanClipboardCommand, STACK_STORAGE_KEY, stackItem, parseStackState } from '../dist/index.js'
let host, views, handlers, released, subscribeFailure
const storageValue = items => ({ version: 1, items: items.map(stackItem), isListening: true })
const write = value => host.storage.set(STACK_STORAGE_KEY, JSON.stringify(JSON.stringify(value)))
const read = () => JSON.parse(JSON.parse(host.storage.get(STACK_STORAGE_KEY)))
const emit = text => { for (const handler of [...handlers]) handler({ type: 'clipboard_change', payload: { type: 'text', hasData: true, text } }) }
const action = (view, id) => view.tree().props.filterBar.actions.find(action => action.id === id).onAction()
const open = async (command = Stack) => { const view = await mount(command, host); views.push(view); await tick(); return view }
beforeEach(() => {
  host = createHost(); views = []; handlers = new Set(); released = 0; subscribeFailure = null
  globalThis.ztools = { events: { async subscribeConfirmed(type, handler) {
    assert.equal(type, 'clipboard_change'); if (subscribeFailure) throw subscribeFailure
    handlers.add(handler); return async () => { handlers.delete(handler); released++ }
  } } }
})
afterEach(async () => { for (const view of views) view.unmount(); await tick(); delete globalThis.ztools })

test('全部清单入口可运行；FIFO与LIFO实际列表顺序一致，打开会读取和订阅', async () => {
  const value = storageValue(['first', 'second']); write(value)
  for (const [command, expected] of [['paste-stack-fifo', ['first','second']], ['paste-stack-lifo', ['second','first']]]) {
    const view = await open(commands[command]); assert.deepEqual(view.items().map(item => item.props.title), expected)
    assert.match(view.tree().props.filterBar.summaryText, /监听中/); view.unmount()
  }
  assert.equal(handlers.size, 0)
  assert.equal(typeof commands['paste-clean-text'], 'function')
})

test('纯文本清格式保留路径、代码、实体、空格和换行，空文本不假成功', async () => {
  const raw = '  C:\\temp\\report.txt\n  <tag>literal</tag> &amp;\n\n\nend  '
  host.clipboard.text = raw; await CleanClipboardCommand(); assert.equal(host.clipboard.text, raw)
  host.clipboard.text = ''; await assert.rejects(CleanClipboardCommand(), /无可用文本/)
})

test('主动作真实调用SDK粘贴，成功才出栈并保存，重开不丢剩余条目', async () => {
  const value = storageValue(['first', 'second']); write(value); const view = await open()
  await view.run(view.item(value.items[0].id), '发送到原输入位置')
  assert.deepEqual(host.clipboard.pasted, ['first']); assert.deepEqual(read().items.map(item => item.text), ['second'])
  view.unmount(); const reopened = await open(); assert.deepEqual(reopened.items().map(item => item.props.title), ['second'])
})

test('[回归] 发送后宿主写剪贴板触发的变化事件不会把刚出栈的条目加回；之后真实复制同样内容仍会入栈', async () => {
  const value = storageValue(['first', 'second']); write(value); const view = await open()
  getDeclarativeBridge().pasteToActive = async text => { emit(text) }
  await view.run(view.item(value.items[0].id), '发送到原输入位置'); await tick()
  assert.deepEqual(read().items.map(item => item.text), ['second'])
  emit('first'); await tick()
  assert.deepEqual(read().items.map(item => item.text), ['second', 'first'])
})

test('粘贴失败保留全部队列，不增加成功提示；暂停和重开状态保留', async () => {
  const value = storageValue(['first']); write(value); const view = await open(), before = host.storage.get(STACK_STORAGE_KEY)
  getDeclarativeBridge().pasteToActive = async () => { throw Error('辅助功能未授权') }
  await view.run(view.item(value.items[0].id), '发送到原输入位置')
  assert.equal(host.storage.get(STACK_STORAGE_KEY), before); assert.match(host.lastToast().title, /粘贴失败/)
  await action(view, 'listen'); await tick(); assert.equal(handlers.size, 0); assert.equal(read().isListening, false)
  view.unmount(); const reopened = await open(); assert.match(reopened.tree().props.filterBar.summaryText, /已暂停/)
})

test('重复Enter只粘贴一次；粘贴过程中到来的新内容在出栈后继续保存', async () => {
  const value = storageValue(['first','second']); write(value); const view = await open(); let resume, started = false, calls = 0
  getDeclarativeBridge().pasteToActive = async () => { calls++; started = true; await new Promise(resolve => { resume = resolve }) }
  const pending = view.run(view.item(value.items[0].id), '发送到原输入位置')
  for(let i=0;i<40&&!started;i++)await tick(1)
  assert.ok(started); await view.run(view.item(value.items[0].id), '发送到原输入位置'); emit('new while pasting')
  resume(); await pending; await tick(10)
  assert.equal(calls,1); assert.deepEqual(read().items.map(item=>item.text), ['second','new while pasting'])
})

test('监听使用确认后的事件，保留原文且不读取当前敏感剪贴板；离页注销', async () => {
  host.clipboard.text = 'fake-sensitive-content'; const view = await open()
  assert.deepEqual(view.items().map(item => item.props.id),['empty-state']); const raw = '  code <x>\n  '
  emit(raw); emit(raw); await tick(10); assert.equal(read().items.length,1); assert.equal(read().items[0].text,raw)
  const before=host.storage.get(STACK_STORAGE_KEY);view.unmount();emit('after-unmount');await tick();assert.equal(host.storage.get(STACK_STORAGE_KEY),before);assert.equal(handlers.size,0)
})

test('监听失败明确提示，不回退轮询，也不保存空队列覆盖存储', async () => {
  subscribeFailure=Error('监听未获确认');const value=storageValue(['existing']);write(value);const before=host.storage.get(STACK_STORAGE_KEY),view=await open()
  assert.match(view.tree().props.filterBar.summaryText,/未获确认/);assert.equal(host.storage.get(STACK_STORAGE_KEY),before)
  assert.equal(handlers.size,0)
})

test('读取失败或损坏时只允许重读，原始数据不被初始化覆盖', async () => {
  host.storage.set(STACK_STORAGE_KEY,JSON.stringify('broken'));const before=host.storage.get(STACK_STORAGE_KEY),view=await open()
  assert.equal(host.storage.get(STACK_STORAGE_KEY),before);assert.equal(handlers.size,0);assert.equal(view.tree().props.filterBar.actions[0].id,'retry')
  write(storageValue(['recovered']));await action(view,'retry');await tick(10);assert.equal(view.items()[0].props.title,'recovered')
})

test('跨窗口CAS冲突不覆盖另一窗口数据，已粘贴但无法保存时明确区分', async () => {
  const value=storageValue(['first']);write(value);const view=await open()
  write(storageValue(['other-window']));const before=host.storage.get(STACK_STORAGE_KEY)
  await view.run(view.item(value.items[0].id),'发送到原输入位置')
  assert.equal(host.storage.get(STACK_STORAGE_KEY),before);assert.match(host.lastToast().title,/已发送请求，但队列未保存/)
  assert.match(view.tree().props.filterBar.summaryText,/另一窗口/);assert.equal(handlers.size,0)
})

test('筛选后移动只交换选中ID，不误动其他行；LIFO位置以显示顺序为准', async () => {
  const value=storageValue(['match-a','untouched','match-b']);write(value);const view=await open(commands['paste-stack-lifo'])
  await view.search('match');await view.run(view.item(value.items[2].id),'下移一位')
  assert.deepEqual(read().items.map(item=>item.text),['match-b','untouched','match-a'])
})

test('保存失败时保留队列与监听错误，过期订阅回执会注销', async () => {
  const view=await open();host.faults.storageWrite=Error('disk full');emit('cannot-save');await tick(10)
  assert.equal(host.storage.has(STACK_STORAGE_KEY),false);assert.match(view.tree().props.filterBar.summaryText,/disk full/)
  view.unmount();let resume
  globalThis.ztools.events.subscribeConfirmed=()=>new Promise(resolve=>{resume=resolve})
  const late=await open();late.unmount();resume(async()=>{released++});await tick();assert.ok(released>=2)
  assert.throws(()=>parseStackState({version:1,isListening:true,items:[{id:'broken'}]}),/条目无效/)
})

test('发送请求后原文保留为可恢复记录，重开后恢复到原队列位置且不再次发送', async () => {
  const value = storageValue(['first','second']); write(value); const view = await open()
  const row = view.item(value.items[0].id)
  await view.run(row, view.actions(row)[0].props.title)
  assert.equal(read().sent?.[0]?.item.text, 'first')
  assert.equal(read().sent[0].index, 0)
  assert.match(host.lastToast().title, /已发送粘贴请求/)
  view.unmount(); const reopened = await open(); await reopened.dropdown('sent')
  assert.deepEqual(reopened.items().map(item => item.props.title), ['first'])
  await reopened.run(reopened.item(value.items[0].id), '恢复到待发送队列')
  assert.deepEqual(read().items.map(item => item.text), ['first','second'])
  assert.equal(read().sent.length, 0)
  assert.deepEqual(host.clipboard.pasted, ['first'])
})

test('发送结果未确认时不移出原队列，损坏或重复的恢复记录拒绝读取', async () => {
  const value = storageValue(['original']); write(value); const view = await open()
  const before = host.storage.get(STACK_STORAGE_KEY)
  getDeclarativeBridge().pasteToActive = async () => { throw Error('发送结果未确认，请检查目标文档') }
  await view.run(view.item(value.items[0].id), '发送到原输入位置')
  assert.equal(host.storage.get(STACK_STORAGE_KEY), before)
  assert.match(host.lastToast().message, /结果未确认/)
  assert.throws(() => parseStackState({ ...value, sent: [{ item: value.items[0], index: 0 }] }), /条目无效/)
  assert.throws(() => parseStackState({ ...value, sent: [{ item: stackItem('saved'), index: -1 }] }), /记录无效/)
})

test('[故障注入] 剪贴板里是复制的文件时清除格式拒绝改写，不把文件替换成文件名', async () => {
  host.clipboard.text = 'report.pdf'
  host.ipc.clipboard_read_files = async () => ({ success: true, files: ['/Users/a/report.pdf'] })
  await assert.rejects(CleanClipboardCommand(), /复制的文件/)
  assert.equal(host.clipboard.text, 'report.pdf')
  // 没有文件（或宿主查询失败）时照常清除格式
  host.ipc.clipboard_read_files = async () => ({ success: true, files: [] })
  assert.match(await CleanClipboardCommand(), /已移除富文本格式/)
  host.ipc.clipboard_read_files = async () => { throw new Error('剪贴板被占用') }
  assert.match(await CleanClipboardCommand(), /已移除富文本格式/)
})

test('空队列显示引导条目，回车主动作是切换监听，清除格式只在动作面板里', async () => {
  write(storageValue([])); const view = await open()
  assert.deepEqual(view.items().map(item => item.props.id), ['empty-state'])
  assert.match(view.item('empty-state').props.title, /复制文字后会自动加入队列/)
  const titles = view.actions(null).map(action => action.props.title)
  assert.deepEqual(titles, ['暂停监听', '清除剪贴板格式'])
  assert.deepEqual(view.tree().props.filterBar.actions.map(action => action.id), ['clear'], '空状态底栏已有监听开关，工具栏不重复')
  await view.run(null, '暂停监听'); await tick()
  assert.equal(read().isListening, false)
  assert.match(view.item('empty-state').props.title, /监听已暂停/)
  emit('new text'); await tick()
  assert.deepEqual(read().items, [])
})

test('有条目时不显示空状态；搜索无结果显示无匹配', async () => {
  write(storageValue(['first'])); const view = await open()
  assert.deepEqual(view.items().map(item => item.props.title), ['first'])
  view.tree().props.onSearchTextChange('不存在'); await tick()
  assert.equal(view.item('empty-state').props.title, '没有匹配的条目')
})

test('有条目时监听开关回到工具栏，并真实切换持久化状态', async () => {
  write(storageValue(['first'])); const view = await open()
  assert.deepEqual(view.tree().props.filterBar.actions.map(action => action.id), ['listen', 'clear'])
  await action(view, 'listen'); await tick(); assert.equal(read().isListening, false)
  assert.equal(view.tree().props.filterBar.actions.find(item => item.id === 'listen').title, '开启监听')
})
