import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import Command, { commands } from '../dist/index.js'
import { MarkdownClient } from '../dist/md-to-office-service.js'

let host, views
const summary = text => ({ title: text.split('\n')[0].replace(/^#+\s*/, ''), characters: text.length, blocks: 2, warnings: [] })
const calls = action => host.ipcCalls.filter(([method, p]) => method === 'markdown_document' && p.action === action)
beforeEach(() => {
  host = createHost(); views = []; host.clipboard.text = '# 测试文档\n\n**正文**'
  host.ipc.clipboard_read_text = async () => ({ success: true, text: host.clipboard.text })
  host.ipc.window_show_save_dialog = async () => ({ canceled: false, filePath: '/tmp/new.docx' })
  host.ipc.window_show_open_dialog = async () => ({ canceled: false, filePaths: [{ path: '/tmp/input.md' }] })
  host.ipc.markdown_document = async p => p.action === 'cancel' ? { success: true, cancelRequested: true } : p.action === 'read' ? { success: true, markdown: '# 文件内容\n\n载入正文' } : ({ success: true, summary: summary(p.markdown), ...(p.action === 'export' ? { status: 'committed', size: 10240, name: 'new.docx' } : p.action === 'copy' ? { copied: true } : {}) })
})
afterEach(async () => { for (const v of views) v.unmount(); await tick() })
async function open(c = Command) { const v = await mount(c, host); views.push(v); await tick(); return v }
const button = (v, id) => v.tree().props.filterBar.actions.find(a => a.id === id).onAction()

test('真实 SDK 主入口按布局三展示当前文档，Enter 另存、次动作复制，参数进入请求', async () => {
  const v = await open(); assert.ok(v.tree().props.workbenchPanel); assert.ok(v.tree().props.subList); assert.match(v.text(), /测试文档/)
  assert.equal(calls('export').length, 0); assert.equal(calls('copy').length, 0)
  v.tree().props.workbenchPanel.fields.find(f => f.id === 'preset').onChange('business'); await tick()
  v.tree().props.workbenchPanel.fields.find(f => f.id === 'indent').onChange(false); await tick()
  await v.run(v.item('document'), '另存 Word 新副本'); assert.equal(calls('export')[0][1].options.preset, 'business'); assert.equal(calls('export')[0][1].options.firstLineIndent, false)
  assert.match(v.text(), /已另存 new.docx/)
  await v.run(v.item('document'), '复制为富文本'); assert.equal(calls('copy').length, 1)
  assert.deepEqual(v.tree().props.filterBar.actions.map(a => a.id), ['clipboard', 'open']); assert.ok(!host.ipcCalls.some(([m]) => /dllplugin_call|md_to_office$/.test(m)))
})
test('真正 commands 快捷入口只读取一次并执行复制；失败不报成功', async () => {
  const v = await open(commands['md-to-office-clipboard-fast']); assert.equal(calls('copy').length, 1); assert.match(v.text(), /已复制/)
  host.ipc.markdown_document = async () => { throw new Error('复制失败') }
  const failed = await open(commands['md-to-office-clipboard-fast']); assert.match(failed.text(), /复制失败/); assert.equal(host.lastToast().style, 'FAILURE')
})
test('取消保存和打开均无后续转换；保存失败保留当前文档且无成功提示', async () => {
  const v = await open(), count = host.toasts.length
  host.ipc.window_show_save_dialog = async () => ({ canceled: true }); await v.run(v.item('document'), '另存 Word 新副本'); assert.equal(calls('export').length, 0); assert.equal(host.toasts.length, count)
  host.ipc.window_show_open_dialog = async () => ({ canceled: true }); await button(v, 'open'); assert.equal(calls('read').length, 0)
  host.ipc.window_show_save_dialog = async () => ({ canceled: false, filePath: '/tmp/existing.docx' }); host.ipc.markdown_document = async () => { throw new Error('目标已存在') }
  await v.run(v.item('document'), '另存 Word 新副本'); assert.match(v.text(), /测试文档/); assert.match(v.text(), /目标已存在/); assert.equal(host.lastToast().style, 'FAILURE')
})
test('用户打开与保存对话框沿用宿主等待用户的契约，不被文档计算时限截断', async () => {
  const methods = globalThis.__ztoolsElectron.transport.methods, requests = []
  globalThis.__ztoolsElectron.transport.methods = new Proxy(methods, { get(target, method) { return request => { requests.push([method, request]); return target[method](request) } } })
  const client = new MarkdownClient()
  await client.choose('open'); await client.choose('save')
  await client.inspect('正文', { preset: 'official', fontSize: 'size-3', firstLineIndent: false })
  assert.equal(Object.hasOwn(requests[0][1], 'timeoutMs'), false); assert.equal(Object.hasOwn(requests[1][1], 'timeoutMs'), false)
  assert.equal(requests[2][1].timeoutMs, 120000)
})
test('文件读取、表单编辑与空输入：导入失败不覆盖原文，编辑成功返回文档', async () => {
  const v = await open(); await button(v, 'open'); assert.match(v.text(), /文件内容/)
  await v.run(v.item('document'), '编辑 Markdown'); const form = await mountPushed(host); views.push(form); await form.fill('markdown', '# 编辑后的文档\n\n正文'); await form.run(null, '载入文档'); assert.match(v.text(), /编辑后的文档/); assert.equal(host.pushed.length, 0)
  host.ipc.clipboard_read_text = async () => ({ success: true, text: '' }); await button(v, 'clipboard'); assert.match(v.text(), /编辑后的文档/); assert.equal(host.lastToast().style, 'FAILURE')
  const empty = await open(); assert.equal(empty.item('empty').props.title, '输入 Markdown 文本')
  await empty.run(empty.item('empty'), '输入 Markdown'); const newForm = await mountPushed(host); views.push(newForm); await newForm.fill('markdown', '# 新建'); await newForm.run(null, '载入文档'); assert.match(empty.text(), /新建/)
})
test('无有效回执时拒绝假成功，取消、复制、文件选择均严格验证', async () => {
  const client = new MarkdownClient()
  for (const bad of [{ success: true }, { success: true, status: 'committed', size: 0, name: 'x', summary: summary('x') }, { success: false }, { success: true, status: 'committed', size: 1, name: 'x', summary: {} }]) {
    host.ipc.markdown_document = async () => bad; await assert.rejects(client.export('正文', { preset: 'official', fontSize: 'size-3', firstLineIndent: false }, '/tmp/new.docx'))
  }
  host.ipc.window_show_save_dialog = async () => ({ filePath: '/tmp/a.docx' }); await assert.rejects(client.choose('save'), /选择结果无效/)
  host.ipc.markdown_document = async () => ({ success: true, copied: false }); await assert.rejects(client.copy('正文', { preset: 'official', fontSize: 'size-3', firstLineIndent: false }), /复制未确认/)
})
test('重复点击互斥；文件对话框返回前退出不导出，处理中卸载请求取消且不回写UI', async () => {
  const v = await open(); let choose
  host.ipc.window_show_save_dialog = () => new Promise(resolve => { choose = resolve })
  const first = v.run(v.item('document'), '另存 Word 新副本'); await tick(); await v.run(v.item('document'), '另存 Word 新副本'); assert.equal(host.ipcCalls.filter(([m]) => m === 'window_show_save_dialog').length, 1)
  v.unmount(); choose({ canceled: false, filePath: '/tmp/late.docx' }); await first; assert.equal(calls('export').length, 0)
  let finish
  host.ipc.markdown_document = p => p.action === 'cancel' ? { success: true, cancelRequested: true } : new Promise(resolve => { finish = resolve })
  const late = await open(); const count = host.toasts.length; late.unmount(); await tick(); assert.equal(calls('cancel').length, 1)
  finish({ success: true, summary: summary('迟到') }); await tick(); assert.equal(host.toasts.length, count)
})
test('编辑页等分析时 Esc 返回，迟到的新文本不会替换当前文档', async () => {
  const v = await open(); await v.run(v.item('document'), '编辑 Markdown'); const form = await mountPushed(host); views.push(form); await form.fill('markdown', '# 迟到修改')
  let finish; host.ipc.markdown_document = () => new Promise(resolve => { finish = resolve })
  const saving = form.run(null, '载入文档'); await tick(); form.unmount(); finish({ success: true, summary: summary('迟到修改') }); await saving; assert.match(v.text(), /测试文档/); assert.doesNotMatch(v.text(), /迟到修改/)
})
