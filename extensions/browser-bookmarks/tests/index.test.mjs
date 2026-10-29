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
  // 从来没有读成功过时，不能说“保留上次结果”
  assert.doesNotMatch(failed.text(), /保留上次结果/); assert.match(failed.tree().props.filterBar.summaryText, /^读取失败/)
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
test('筛选项按平台列出：macOS 不出现 360 安全浏览器，Windows 不出现 Safari，识别不出时全部列出', async () => {
  const { default: BrowserBookmarks, browserOptions, detectPlatform, domesticLabel } = await import('../dist/index.js')
  assert.equal(detectPlatform({ platform: 'MacIntel' }), 'mac'); assert.equal(detectPlatform({ platform: 'Win32' }), 'windows'); assert.equal(detectPlatform({}), 'unknown')
  const ids = platform => browserOptions(platform).map(([value]) => value)
  assert.ok(!ids('mac').includes('360se') && ids('mac').includes('safari'))
  assert.ok(!ids('windows').includes('safari') && ids('windows').includes('360se'))
  assert.equal(ids('unknown').length, 8)
  assert.equal(domesticLabel('mac'), '国内浏览器（QQ / 360极速）')
  for (const [platform, absent, present] of [['mac', '360安全', '国内浏览器（QQ / 360极速）'], ['windows', 'Safari', '国内浏览器（360 / QQ）']]) {
    const view = await mount(() => BrowserBookmarks({ initialFilter: 'domestic', platform })); views.push(view)
    const dropdown = JSON.stringify(view.tree().props.searchBarAccessory)
    assert.ok(!dropdown.includes(absent) && dropdown.includes(present), platform)
  }
})
test('空状态说明真实原因：所选浏览器没有书签、读取失败、平台不支持与搜索无结果各不相同', async () => {
  const { emptyState } = await import('../dist/index.js')
  const base = { items: [item()], warnings: [], sources: 1, error: '', query: '', filter: 'edge', platform: 'mac' }
  assert.equal(emptyState(base).title, '未发现 Edge 书签')
  assert.equal(emptyState({ ...base, warnings: ['Edge / Default：没有读取权限'] }).title, '未能读取 Edge 书签')
  assert.equal(emptyState({ ...base, warnings: ['Chrome / Default：没有读取权限'] }).title, '未发现 Edge 书签')
  assert.equal(emptyState({ ...base, filter: '360se' }).title, '360安全 只在 Windows 上读取')
  assert.equal(emptyState({ ...base, filter: 'safari', platform: 'windows' }).title, 'Safari 只在 macOS 上读取')
  assert.equal(emptyState({ ...base, filter: 'domestic' }).title, '未发现 QQ 浏览器与 360 极速浏览器 书签')
  assert.equal(emptyState({ ...base, filter: 'domestic', warnings: ['QQ浏览器 / Default：文件损坏'] }).title, '未能读取 QQ 浏览器与 360 极速浏览器 书签')
  assert.equal(emptyState({ ...base, query: 'abc' }).title, '没有匹配的书签')
  assert.equal(emptyState({ ...base, items: [], error: 'IPC timeout' }).subtitle, 'IPC timeout')
  assert.equal(emptyState({ ...base, items: [], sources: 0, filter: 'all', warnings: ['Safari / 默认：没有读取权限'] }).title, '未能读取浏览器书签')
  // 命令界面：只有 Chrome 书签时打开 Edge 命令，不能显示成“没有匹配的书签”
  const view = await open('bookmarks-edge')
  assert.equal(view.items()[0].props.id, 'empty'); assert.equal(view.items()[0].props.title, '未发现 Edge 书签')
})
test('带用户名或密码的书签不提供“打开网页”（客户端会拒绝打开），只提供复制', async () => {
  const secret = { ...item('secret'), url: 'https://user:pw@example.com/x' }
  host.ipc.browser_bookmarks_scan = async () => reply([secret, item()])
  const view = await open()
  const actions = view.actions(view.item('secret'))
  assert.ok(actions.every(action => action.type !== 'Action.OpenInBrowser'))
  assert.match(actions[0].props.title, /含登录信息/)
  await view.run(view.item('secret'), actions[0].props.title); assert.equal(host.clipboard.text, secret.url)
  assert.equal(view.actions(view.item('one'))[0].type, 'Action.OpenInBrowser')
})

test('全部来源都读不了（只有 Safari 没权限）时，按浏览器筛选给出该浏览器自己的结论，Safari 原因放进读取详情', async () => {
  const { UnreadableSourcesError, FULL_DISK_ACCESS_GUIDE } = await import('../dist/index.js')
  const safariOnly = { success: true, bookmarks: [], warnings: ['Safari / 默认：没有读取权限'], sourcesRead: 0 }
  assert.throws(() => validateScan(safariOnly), error => error instanceof UnreadableSourcesError && error.warnings[0].startsWith('Safari'))
  host.ipc.browser_bookmarks_scan = async () => structuredClone(safariOnly)
  for (const [code, title] of [['bookmarks-chrome', '未发现 Chrome 书签'], ['bookmarks-edge', '未发现 Edge 书签'], ['bookmarks-firefox', '未发现 Firefox 书签']]) {
    const view = await open(code)
    const empty = view.items()[0]
    assert.equal(empty.props.title, title)
    assert.doesNotMatch(JSON.stringify(empty.props), /Safari|书签读取失败/)
    assert.doesNotMatch(view.tree().props.filterBar.summaryText, /个配置|读取失败/)
    assert.equal(host.toasts?.length ?? 0, 0)
    // 空状态行自带刷新与读取详情，顶部状态条不再重复
    assert.deepEqual(view.tree().props.filterBar.actions, [])
    assert.deepEqual(view.actions(empty).map(a => a.props.title), ['刷新书签', '读取详情'])
    // 读取详情里仍能看到 Safari 原因与设置路径
    await view.run(empty, '读取详情')
    assert.match(JSON.stringify(host.pushed), /Safari \/ 默认：没有读取权限/)
    assert.match(JSON.stringify(host.pushed), /完全磁盘访问权限/)
  }
  const all = await open('bookmarks-all')
  const empty = all.items()[0]
  assert.equal(empty.props.title, '未能读取浏览器书签')
  assert.match(all.tree().props.filterBar.summaryText, /^没有可读取的浏览器/)
  const titles = all.actions(empty).map(a => a.props.title)
  assert.deepEqual(titles, ['复制完全磁盘访问设置路径', '刷新书签', '读取详情'])
  assert.equal(all.actions(empty)[0].props.content, FULL_DISK_ACCESS_GUIDE)
  // 处理权限后刷新成功，空状态与提示都消失
  host.ipc.browser_bookmarks_scan = async () => reply([item('s1', 'safari')])
  await all.run(empty, '刷新书签'); await tick()
  assert.equal(all.item('s1').props.title, '测试文档')
  assert.ok(all.tree().props.filterBar.actions.some(a => a.id === 'refresh'))
  assert.match(all.tree().props.filterBar.summaryText, /^来自 1 个浏览器/)
})

test('客户端调用整体失败时，所选浏览器下也如实显示读取失败原因，不说成“未发现”', async () => {
  host.ipc.browser_bookmarks_scan = async () => { throw new Error('IPC timeout') }
  const view = await open('bookmarks-chrome')
  assert.equal(view.items()[0].props.title, '未能读取 Chrome 书签')
  assert.equal(view.items()[0].props.subtitle, 'IPC timeout')
  assert.ok(view.actions(view.items()[0]).some(a => a.props.title === '刷新书签'))
  assert.ok(!view.actions(view.items()[0]).some(a => a.props.title === '复制完全磁盘访问设置路径'))
})

test('国内浏览器命令说明如实写出平台差异，摘要不出现“配置”这种内部说法', async () => {
  const fs = await import('node:fs')
  const manifest = JSON.parse(fs.readFileSync(new URL('../plugin.json', import.meta.url)))
  assert.match(manifest.features.find(f => f.code === 'bookmarks-domestic').explain, /Windows 上另含 360 安全浏览器/)
  const view = await open()
  assert.equal(view.tree().props.filterBar.summaryText, '来自 1 个浏览器 · 显示 1 / 1 条')
})

test('客户端整体报错“未能读取任何浏览器书签：Safari …”时，筛选 Chrome 显示未发现，Safari 原因只在读取详情', async () => {
  host.ipc.browser_bookmarks_scan = async () => { throw new Error('未能读取任何浏览器书签：Safari / 默认：没有读取权限') }
  const view = await open('bookmarks-chrome')
  const empty = view.items()[0]
  assert.equal(empty.props.title, '未发现 Chrome 书签')
  assert.match(empty.props.subtitle, /本机未安装该浏览器或没有书签文件/)
  assert.doesNotMatch(`${empty.props.title} ${empty.props.subtitle}`, /Safari|默认|未能读取任何/)
  assert.deepEqual(view.tree().props.filterBar.actions, [])
  await view.run(empty, '读取详情')
  assert.match(JSON.stringify(host.pushed), /Safari \/ 默认：没有读取权限/)
  // 整体错误里列出了所选浏览器：如实显示读取失败
  host.ipc.browser_bookmarks_scan = async () => { throw new Error('未能读取任何浏览器书签：Chrome / Default：文件损坏；Safari / 默认：没有读取权限') }
  const chrome = await open('bookmarks-chrome')
  assert.equal(chrome.items()[0].props.title, '未能读取 Chrome 书签')
})

test('整体错误里原因已满 5 条（可能被截断）时，不断言所选浏览器“未发现”', async () => {
  const { parseUnreadableSourcesError, emptyState } = await import('../dist/index.js')
  const five = ['Safari / 默认：没有读取权限', 'Edge / Default：损坏', 'Brave / Default：损坏', 'Firefox / a：损坏', 'QQ浏览器 / Default：损坏']
  const parsed = parseUnreadableSourcesError(`未能读取任何浏览器书签：${five.join('；')}`)
  assert.equal(parsed.partial, true)
  assert.deepEqual(parsed.warnings, five)
  assert.equal(parseUnreadableSourcesError('IPC timeout'), null)
  assert.equal(parseUnreadableSourcesError('未能读取任何浏览器书签：'), null)
  assert.equal(parseUnreadableSourcesError('未能读取任何浏览器书签：Safari / 默认：没有读取权限').partial, false)
  const state = emptyState({ items: [], warnings: five, sources: 0, error: '', query: '', filter: 'chrome', platform: 'mac', warningsPartial: true })
  assert.equal(state.title, '未能确认 Chrome 书签')
  host.ipc.browser_bookmarks_scan = async () => { throw new Error(`未能读取任何浏览器书签：${five.join('；')}`) }
  const view = await open('bookmarks-chrome')
  assert.equal(view.items()[0].props.title, '未能确认 Chrome 书签')
})
