import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import { commands, bookmarkMarkdown, formatBookmarkDate, searchAndFilterBookmarks, validateScan } from '../dist/index.js'
const host = createHost(), views = []
const item = (id = 'one', browser = 'chrome') => ({ id, browser, browserLabel: browser, profile: 'Default', title: '测试文档', url: 'https://example.com/a?x=a%20b#part', hostname: 'example.com', folderBreadcrumb: '资料 / 研发', dateAdded: null, pinyinFull: 'ceshiwendangziliaoyanfa', pinyinInitials: 'cswdzlyf' })
const reply = (bookmarks = [item()], warnings = []) => ({ success: true, bookmarks, warnings, sourcesRead: 1 })
test.beforeEach(() => { host.reset(); host.ipc.browser_bookmarks_scan = async () => reply(); host.ipc.browser_bookmarks_cancel = async () => ({ success: true, cancelRequested: true }) })
test.afterEach(() => views.splice(0).forEach(view => view.unmount()))
async function open(code = 'bookmarks-all') { const view = await mount(commands[code]); views.push(view); return view }
test('五个命令分别筛选，全宽列表和主次动作保持契约', async () => {
  const items = ['chrome', 'edge', 'firefox', 'qqbrowser', 'safari', 'brave'].map(browser => item(browser, browser))
  host.ipc.browser_bookmarks_scan = async () => reply(items)
  for (const [code, expected] of [['bookmarks-all', 6], ['bookmarks-edge', 1], ['bookmarks-chrome', 1], ['bookmarks-domestic', 1], ['bookmarks-firefox', 1]]) {
    const view = await open(code)
    assert.equal(view.items().length, expected); assert.equal(view.tree().props.isShowingDetail, false)
    const actions = view.actions(view.items()[0]); assert.equal(actions[0].type, 'Action.OpenInBrowser'); assert.equal(actions[1].props.title, '复制链接')
    assert.deepEqual(actions[1].props.shortcut, { modifiers: ['cmd'], key: 'enter' })
    await view.run(view.items()[0], '复制链接'); assert.equal(host.clipboard.text, items[0].url)
  }
  assert.ok(host.ipcCalls.every(([method]) => method !== 'dllplugin_call'))
})
test('分页不丢书签：显示更多可到末尾，搜索检索全部522条', async () => {
  const items = Array.from({ length: 522 }, (_, i) => ({ ...item(`id-${i}`), title: `书签 ${i}`, url: `https://example.com/${i}` }))
  host.ipc.browser_bookmarks_scan = async () => reply(items)
  const view = await open()
  assert.equal(view.items().length, 201); assert.match(view.text(), /200 \/ 522/)
  await view.run(view.item('more'), '显示更多'); assert.equal(view.items().length, 401)
  await view.run(view.item('more'), '显示更多'); assert.equal(view.items().length, 522)
  await view.search('书签 521'); assert.equal(view.items().length, 1); assert.equal(view.items()[0].props.id, 'id-521')
  await view.search('不存在'); assert.equal(view.items()[0].props.id, 'empty')
})
test('中文、全拼、首字母、文件夹、配置及domain检索', () => {
  for (const query of ['测试', 'ceshi', 'cswd', '研发', 'Default', 'domain:example.com']) assert.equal(searchAndFilterBookmarks([item()], query).length, 1, query)
  assert.equal(searchAndFilterBookmarks([item()], 'domain:else.example').length, 0)
  assert.equal(formatBookmarkDate(null), '日期未知')
  assert.equal(formatBookmarkDate(1730000000000).includes('2024'), true)
})
test('Markdown复制转义标题和URL边界，不改变普通链接的原始内容', async () => {
  const value = { ...item(), title: 'A [B] <tag>\nnext', url: 'https://example.com/a(b)?q=a>b' }
  assert.equal(bookmarkMarkdown(value), '[A \\[B\\] \\<tag\\> next](<https://example.com/a(b)?q=a%3Eb>)')
  host.ipc.browser_bookmarks_scan = async () => reply([value])
  const view = await open(); await view.run(view.item('one'), '复制标题'); assert.equal(host.clipboard.text, value.title)
  await view.run(view.item('one'), '复制 Markdown 链接'); assert.equal(host.clipboard.text, bookmarkMarkdown(value))
})
test('部分失败可见且细节能打开；刷新失败保留旧结果并明确标记未更新', async () => {
  host.ipc.browser_bookmarks_scan = async () => reply([item()], ['Safari：没有权限'])
  const view = await open(); assert.match(view.text(), /部分来源未读取/)
  view.tree().props.filterBar.actions.find(a => a.id === 'errors').onAction(); assert.match(JSON.stringify(host.pushed), /Safari：没有权限/)
  host.ipc.browser_bookmarks_scan = async () => { throw new Error('IPC timeout') }
  await view.tree().props.filterBar.actions.find(a => a.id === 'refresh').onAction()
  assert.equal(view.item('one').props.title, '测试文档'); assert.match(view.text(), /刷新失败，保留上次结果/)
  assert.equal(host.lastToast().title, '书签未更新')
  host.ipc.browser_bookmarks_scan = async () => ({ success: true, bookmarks: [], warnings: ['全部来源没有权限'], sourcesRead: 0 })
  await view.tree().props.filterBar.actions.find(a => a.id === 'refresh').onAction()
  assert.equal(view.item('one').props.title, '测试文档'); assert.match(view.text(), /刷新失败，保留上次结果/)
  assert.match(host.lastToast().message, /全部来源没有权限/)
})
test('首次失败与合法空结果不混淆，不拼装示例数据', async () => {
  host.ipc.browser_bookmarks_scan = async () => { throw new Error('读取失败') }
  const failed = await open(); assert.match(failed.text(), /书签读取失败/); assert.equal(failed.items().length, 1)
  host.ipc.browser_bookmarks_scan = async () => ({ success: true, bookmarks: [], warnings: [], sourcesRead: 0 })
  const empty = await open(); assert.match(empty.text(), /未发现本机网页书签/)
  for (const value of [reply([item(), item()]), reply([{ ...item(), url: 'javascript:alert(1)' }]), reply([{ ...item(), dateAdded: 0 }]), { ...reply(), warnings: 'bad' }, { success: true }]) assert.throws(() => validateScan(value))
})
test('重复刷新互斥，离开页面发送取消，迟到结果不触发错误提示', async () => {
  let finish, count = 0
  host.ipc.browser_bookmarks_scan = async () => { count++; return new Promise(resolve => { finish = resolve }) }
  const view = await open()
  await view.tree().props.filterBar.actions.find(a => a.id === 'refresh').onAction(); assert.equal(count, 1)
  view.unmount(); views.splice(views.indexOf(view), 1); await tick()
  assert.equal(host.ipcCalls.filter(([method]) => method === 'browser_bookmarks_cancel').length, 1)
  finish(reply()); await tick(); assert.equal(host.toasts.length, 0)
})
