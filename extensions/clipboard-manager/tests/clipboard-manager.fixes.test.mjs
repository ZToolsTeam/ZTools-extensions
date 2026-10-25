// macOS 真机复测问题的集成用例：宿主历史库与插件存储不再互相隐藏/覆盖、详情页置顶只切换一次、
// HSL 换算、敏感内容误判与泄露、纯文本预览按原文展示。用共享测试宿主渲染插件 dist/，模拟宿主历史库 IPC。
import test from 'node:test'
import assert from 'node:assert/strict'
import { getComponentFactory } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import ClipboardHistoryCommand, {
  parseColorDetails,
  rgbToHsl,
  maskSensitiveContent,
  getClipboardMarkdown,
  fencedBlock,
  getClipboardHistory,
  saveEditedClipboardItem,
  syncCurrentSystemClipboard
} from '../dist/index.js'

const KEY = 'ztools:clipboard:history'
const host = createHost()

/**
 * 模拟宿主剪贴板历史库：
 * - query 时像宿主采集器一样把“变化后的系统剪贴板文本”记进库（同内容只更新 updated_at）
 * - 可注入：采集器不记录、query 抛错、query 返回畸形数据、toggle 失败
 */
function installHistoryHost(rows = []) {
  let clock = 1000
  let seq = 0
  let lastRecorded = host.clipboard.text
  const db = {
    rows: rows.map((r) => ({ format_type: 'text', is_pinned: 0, created_at: ++clock, updated_at: clock, ...r })),
    record: true,
    queryFault: null,
    malformed: false,
    toggleFails: false,
    calls: { toggle: [], delete: [] }
  }
  host.ipc.clipboard_read_text = async () => ({ text: host.clipboard.text })
  host.ipc.clipboard_history_query = async () => {
    if (db.queryFault) throw db.queryFault
    if (db.malformed) return { weird: true }
    const text = host.clipboard.text
    if (db.record && text && text !== lastRecorded) {
      lastRecorded = text
      const ex = db.rows.find((r) => r.content === text)
      if (ex) ex.updated_at = ++clock
      else db.rows.push({ id: `h-${++seq}`, content: text, format_type: 'text', is_pinned: 0, created_at: ++clock, updated_at: clock })
    }
    return [...db.rows].sort((a, b) => b.is_pinned - a.is_pinned || b.updated_at - a.updated_at)
  }
  host.ipc.clipboard_history_toggle_pin = async ({ id }) => {
    db.calls.toggle.push(id)
    if (db.toggleFails) return { success: false }
    const row = db.rows.find((r) => r.id === id)
    if (!row) return { success: false }
    row.is_pinned = row.is_pinned ? 0 : 1
    return { success: true }
  }
  host.ipc.clipboard_history_delete = async ({ id }) => {
    db.calls.delete.push(id)
    const before = db.rows.length
    db.rows = db.rows.filter((r) => r.id !== id)
    return { success: db.rows.length < before }
  }
  host.ipc.clipboard_history_restore = async ({ id }) => {
    const row = db.rows.find((r) => r.id === id)
    if (!row) return { success: false, error: '记录已不存在' }
    host.clipboard.text = row.content
    return { success: true }
  }
  host.ipc.clipboard_history_clear_unpinned = async () => {
    const before = db.rows.length
    db.rows = db.rows.filter((r) => r.is_pinned)
    return { success: true, count: before - db.rows.length }
  }
  return db
}

function readStored() {
  if (!host.storage.has(KEY)) return null
  let v = JSON.parse(host.storage.get(KEY))
  if (typeof v === 'string') v = JSON.parse(v)
  return v
}

function writeStored(items) {
  host.storage.set(KEY, JSON.stringify(JSON.stringify(items)))
}

const localRec = (id, content, extra = {}) => ({ id, type: 'text', content, preview: content, copiedAt: 500, pinned: false, ...extra })
const FAST = { attempts: 2, intervalMs: 0 }

async function openPushed(view, item, title) {
  const action = view.actions(item).find((a) => a.props.title === title)
  if (!action) throw new Error(`找不到动作「${title}」`)
  // 与宿主导航栈一致：用 JSX 组件工厂重新渲染被 push 的视图，组件内的 Hooks 状态才会生效
  const factory = getComponentFactory(action.props.target)
  return mount(typeof factory === 'function' ? factory : () => action.props.target)
}

test.beforeEach(() => {
  host.reset()
})

// ---------------- clipboard-manager-3：宿主历史库与插件存储 ----------------

test('[3] 宿主库有记录时，插件自己存的旧记录照常显示；旧版本误存进插件存储的宿主记录不重复显示', async () => {
  installHistoryHost([{ id: 'h-a', content: 'SENTINEL2' }])
  writeStored([
    localRec('clip-1790000000001', 'LOCAL-ONE'),
    localRec('clip-live-1790000000002', 'LOCAL-TWO', { pinned: true }),
    localRec('9b5c1c96-0b9f-4c3a-9a1e-000000000000', 'SENTINEL2'), // 旧版本把宿主记录整表写进来
    localRec('9b5c1c96-0b9f-4c3a-9a1e-000000000001', 'HOST-DELETED-LATER'),
    localRec('clip-1', '示例数据')
  ])
  const view = await mount(ClipboardHistoryCommand)
  await tick(20)
  const contents = view.items().map((i) => i.props.title)
  assert.deepEqual(contents.sort(), ['LOCAL-ONE', 'LOCAL-TWO', 'SENTINEL2'].sort())
})

test('[3] 同步剪贴板：宿主已记录时以宿主为准、不产生重复，插件存储不被宿主整表覆盖；重开后仍在', async () => {
  const db = installHistoryHost([{ id: 'h-a', content: 'SENTINEL2' }])
  writeStored([localRec('clip-1790000000001', 'LOCAL-ONE')])
  const view = await mount(ClipboardHistoryCommand)
  await tick(20)

  host.clipboard.text = 'FIX3-sync-A'
  await view.run(null, '读取并同步当前系统剪贴板')
  await tick(20)
  const titles = view.items().map((i) => i.props.title)
  assert.equal(titles.filter((t) => t === 'FIX3-sync-A').length, 1, '同一内容只出现一次')
  assert.ok(titles.includes('LOCAL-ONE') && titles.includes('SENTINEL2'))
  assert.ok(db.rows.some((r) => r.content === 'FIX3-sync-A'))
  assert.deepEqual(readStored().map((i) => i.content), ['LOCAL-ONE'], '插件存储里只有插件自己的记录')
  assert.match(host.lastToast().title, /已同步/)

  view.unmount()
  const reopened = await mount(ClipboardHistoryCommand)
  await tick(20)
  assert.deepEqual(reopened.items().map((i) => i.props.title).sort(), ['FIX3-sync-A', 'LOCAL-ONE', 'SENTINEL2'].sort())
})

test('[3] 新建记录（勾选置顶）：宿主记下后置顶写进宿主库；编辑宿主记录会替换旧记录，重开后是新内容', async () => {
  const db = installHistoryHost([{ id: 'h-a', content: 'SENTINEL2' }])
  const view = await mount(ClipboardHistoryCommand)
  await tick(20)

  const form = await openPushed(view, null, '新建剪贴板记录...')
  form.tree().children.find((c) => c.props.id === 'content').props.onChange('NEW-RECORD')
  form.tree().children.find((c) => c.props.id === 'pinned').props.onChange(true)
  await tick()
  await form.run(null, '创建并写入剪贴板')
  await tick(40)
  const created = db.rows.find((r) => r.content === 'NEW-RECORD')
  assert.ok(created, '宿主库里有新记录')
  assert.equal(created.is_pinned, 1, '置顶写进宿主库')
  assert.equal(host.lastToast().title, '已保存并同步至系统剪贴板')
  assert.equal(readStored(), null, '宿主记下了，就不往插件存储写')

  const sentinel = view.item('h-a')
  const edit = await openPushed(view, sentinel, '编辑该剪贴板内容...')
  edit.tree().children.find((c) => c.props.id === 'content').props.onChange('SENTINEL2-EDITED')
  await tick()
  await edit.run(null, '保存并写入剪贴板')
  await tick(40)
  assert.deepEqual(db.calls.delete, ['h-a'], '旧记录被替换')
  view.unmount()
  const reopened = await mount(ClipboardHistoryCommand)
  await tick(20)
  const titles = reopened.items().map((i) => i.props.title)
  assert.ok(titles.includes('SENTINEL2-EDITED'))
  assert.ok(!titles.includes('SENTINEL2'))
})

test('[3][故障注入] 宿主采集器没记下：存进插件存储并提示已保存，重开后仍在；编辑插件记录保持同一条', async () => {
  const db = installHistoryHost([{ id: 'h-a', content: 'SENTINEL2' }])
  db.record = false
  const res = await saveEditedClipboardItem({ content: 'NOT-RECORDED', pinned: true }, undefined, undefined, FAST)
  assert.equal(res.persisted, true)
  assert.equal(res.where, 'local')
  const stored = readStored()
  assert.equal(stored.length, 1)
  assert.equal(stored[0].content, 'NOT-RECORDED')
  assert.equal(stored[0].pinned, true)
  assert.ok(!stored.some((i) => i.id === 'h-a'), '宿主记录不会被复制进插件存储')

  const again = await saveEditedClipboardItem({ content: 'NOT-RECORDED v2', pinned: false }, stored[0], undefined, FAST)
  assert.equal(again.persisted, true)
  const stored2 = readStored()
  assert.equal(stored2.length, 1, '编辑替换原条目，不新增')
  assert.equal(stored2[0].id, stored[0].id)
  assert.equal(stored2[0].content, 'NOT-RECORDED v2')

  const list = await getClipboardHistory()
  assert.deepEqual(list.map((i) => i.content).sort(), ['NOT-RECORDED v2', 'SENTINEL2'].sort())
})

test('[3][故障注入] 宿主没记下且插件存储写入失败：表单提示失败、不关闭，不谎报已保存', async () => {
  const db = installHistoryHost([])
  db.record = false
  const view = await mount(ClipboardHistoryCommand)
  await tick(20)
  const form = await openPushed(view, null, '新建剪贴板记录...')
  form.tree().children.find((c) => c.props.id === 'content').props.onChange('WILL-FAIL')
  await tick()
  host.faults.storageWrite = new Error('磁盘已满')
  host.pushed.push('form-marker') // 表单 pop() 会弹掉它
  await form.run(null, '创建并写入剪贴板')
  await tick(40)
  const last = host.lastToast()
  assert.match(last.title, /未能保存到历史/)
  assert.match(String(last.message), /磁盘已满/)
  assert.deepEqual(host.pushed, ['form-marker'], '失败时表单不关闭')
})

test('[3][故障注入] 写系统剪贴板失败（超过 8 MiB 被宿主拒绝）：不保存、提示失败', async () => {
  installHistoryHost([])
  const view = await mount(ClipboardHistoryCommand)
  await tick(20)
  const form = await openPushed(view, null, '新建剪贴板记录...')
  form.tree().children.find((c) => c.props.id === 'content').props.onChange('x'.repeat(8 * 1024 * 1024 + 1))
  await tick()
  await form.run(null, '创建并写入剪贴板')
  await tick(10)
  assert.match(host.lastToast().title, /写入系统剪贴板失败/)
  assert.equal(readStored(), null)
})

test('[3][故障注入] 宿主历史库 IPC 抛错或返回畸形数据：退回插件存储模式，不崩溃、不丢插件记录', async () => {
  const db = installHistoryHost([{ id: 'h-a', content: 'SENTINEL2' }])
  writeStored([localRec('clip-1790000000001', 'LOCAL-ONE')])
  db.queryFault = new Error('IPC 管道断开')
  let list = await getClipboardHistory()
  assert.ok(list.some((i) => i.content === 'LOCAL-ONE'))
  assert.ok(!list.some((i) => i.content === 'SENTINEL2'))

  db.queryFault = null
  db.malformed = true
  list = await getClipboardHistory()
  assert.ok(list.some((i) => i.content === 'LOCAL-ONE'))

  // 插件存储内容损坏也不能崩
  host.storage.set(KEY, JSON.stringify('{broken json'))
  db.malformed = false
  list = await getClipboardHistory()
  assert.deepEqual(list.map((i) => i.content), ['SENTINEL2'])
})

test('[3] 宿主库为空也按宿主模式：同步写进宿主库，插件存储不写入宿主记录', async () => {
  const db = installHistoryHost([])
  host.clipboard.text = 'FIRST'
  const res = await syncCurrentSystemClipboard([], undefined, FAST)
  assert.equal(res.added, true)
  assert.equal(res.item.id, db.rows[0].id)
  assert.equal(readStored(), null)
})

test('[3] 清空非置顶：宿主库和插件存储都清，置顶的保留', async () => {
  const db = installHistoryHost([{ id: 'h-a', content: 'A' }, { id: 'h-b', content: 'B', is_pinned: 1 }])
  writeStored([localRec('clip-1790000000001', 'L1'), localRec('clip-1790000000002', 'L2', { pinned: true })])
  const view = await mount(ClipboardHistoryCommand)
  await tick(20)
  await view.run(view.item('h-a'), '清空所有未置顶记录')
  await tick(20)
  assert.deepEqual(db.rows.map((r) => r.content), ['B'])
  assert.deepEqual(readStored().map((i) => i.content), ['L2'])
  assert.deepEqual(view.items().map((i) => i.props.title).sort(), ['B', 'L2'])
})

// ---------------- clipboard-manager-4：详情页置顶 ----------------

test('[4] 全屏详情里取消置顶只切换一次，宿主库与界面一致；再次置顶也一致', async () => {
  const db = installHistoryHost([{ id: 'h-p', content: 'PINNED-ROW', is_pinned: 1 }])
  const view = await mount(ClipboardHistoryCommand)
  await tick(20)
  const detail = await openPushed(view, view.item('h-p'), '全屏查看详情')
  assert.ok(detail.text().includes('已置顶'))
  await detail.run(null, '取消置顶')
  await tick(20)
  assert.deepEqual(db.calls.toggle, ['h-p'], '只调用一次宿主切换')
  assert.equal(db.rows[0].is_pinned, 0)
  assert.equal(host.lastToast().title, '已取消置顶')
  assert.ok(detail.text().includes('未置顶'), '详情页显示真实状态')
  assert.ok(detail.actions(null).some((a) => a.props.title === '置顶条目'))
  const row = view.item('h-p')
  assert.ok(!JSON.stringify(row.props.accessories).includes('置顶'), '列表同步为未置顶')

  await detail.run(null, '置顶条目')
  await tick(20)
  assert.deepEqual(db.calls.toggle, ['h-p', 'h-p'])
  assert.equal(db.rows[0].is_pinned, 1)
  assert.equal(host.lastToast().title, '已置顶')

  // 列表上的 ⌘P 也只切换一次，按宿主结果显示
  await view.run(view.item('h-p'), '取消置顶')
  await tick(20)
  assert.equal(db.rows[0].is_pinned, 0)
  assert.ok(view.actions(view.item('h-p')).some((a) => a.props.title === '置顶条目'))
})

test('[4][故障注入] 宿主切换失败或记录已被删除：提示失败，详情页状态不变', async () => {
  const db = installHistoryHost([{ id: 'h-p', content: 'PINNED-ROW', is_pinned: 1 }])
  const view = await mount(ClipboardHistoryCommand)
  await tick(20)
  const detail = await openPushed(view, view.item('h-p'), '全屏查看详情')
  db.toggleFails = true
  await detail.run(null, '取消置顶')
  await tick(20)
  assert.match(host.toasts.map((t) => t.title).join('|'), /失败/)
  assert.ok(detail.text().includes('已置顶'))
  assert.equal(db.rows[0].is_pinned, 1)

  db.toggleFails = false
  db.rows = []
  await detail.run(null, '取消置顶')
  await tick(20)
  assert.match(host.lastToast().title, /失败/)

  // 详情页删除：只删一次，失败时不返回
  const db2 = installHistoryHost([{ id: 'h-x', content: 'X' }])
  const v2 = await mount(ClipboardHistoryCommand)
  await tick(20)
  const d2 = await openPushed(v2, v2.item('h-x'), '全屏查看详情')
  await d2.run(null, '删除该记录')
  await tick(20)
  assert.deepEqual(db2.calls.delete, ['h-x'])
  assert.equal(host.lastToast().title, '条目已删除')
  await d2.run(null, '删除该记录')
  await tick(20)
  assert.equal(host.lastToast().title, '删除失败')
})

// ---------------- clipboard-manager-5：HSL ----------------

test('[5] HEX / RGB / HSL 标准换算', () => {
  assert.equal(parseColorDetails('#0A84FF').hsl, 'hsl(210, 100%, 52%)')
  assert.equal(parseColorDetails('#3B82F6').hsl, 'hsl(217, 91%, 60%)')
  assert.equal(parseColorDetails('#fff').hsl, 'hsl(0, 0%, 100%)')
  assert.equal(parseColorDetails('#000000').hsl, 'hsl(0, 0%, 0%)')
  assert.equal(parseColorDetails('#FF0000').hsl, 'hsl(0, 100%, 50%)')
  assert.equal(parseColorDetails('#00FF00').hsl, 'hsl(120, 100%, 50%)')
  assert.equal(parseColorDetails('#FF00FF').hsl, 'hsl(300, 100%, 50%)')
  assert.deepEqual(rgbToHsl(128, 128, 128), { h: 0, s: 0, l: 50 })
  assert.deepEqual(parseColorDetails('rgb(59, 130, 246)'), { hex: '#3B82F6', rgb: 'rgb(59, 130, 246)', hsl: 'hsl(217, 91%, 60%)' })
  assert.equal(parseColorDetails('hsl(210, 100%, 52%)').hex, '#0A85FF')
  assert.deepEqual(parseColorDetails('#3B82F680'), { hex: '#3B82F680', rgb: 'rgba(59, 130, 246, 0.5)', hsl: 'hsla(217, 91%, 60%, 0.5)' })
  assert.equal(parseColorDetails('rgba(255, 0, 0, 0.25)').hsl, 'hsla(0, 100%, 50%, 0.25)')
  assert.equal(parseColorDetails('#f00a').rgb, 'rgba(255, 0, 0, 0.67)')
})

test('[5][边界] 非法颜色返回 null，不抛错', () => {
  for (const bad of ['', '#12', '#12345', '#GGGGGG', 'rgb(1, 2)', 'rgb(a, b, c)', 'hsl(1, 2, 3, 4, 5)', 'red', null, undefined, 42]) {
    assert.equal(parseColorDetails(bad), null, String(bad))
  }
  assert.equal(parseColorDetails('rgb(300, -5, 128)').rgb, 'rgb(255, 0, 128)', '超范围通道被夹到 0~255')
})

test('[5] 列表与全屏详情里的「复制 HSL 颜色值」和展示值都正确', async () => {
  installHistoryHost([{ id: 'h-c', content: '#0A84FF' }])
  const view = await mount(ClipboardHistoryCommand)
  await tick(20)
  const item = view.item('h-c')
  await view.run(item, '复制 HSL 颜色值')
  assert.equal(host.clipboard.text, 'hsl(210, 100%, 52%)')
  const detail = await openPushed(view, item, '全屏查看详情')
  assert.ok(detail.text().includes('hsl(210, 100%, 52%)'))
  assert.ok(!detail.text().includes('hsl(14,'))
})

// ---------------- clipboard-manager-6：敏感内容误判 ----------------

test('[6] 普通链接、JSON、路径、邮箱、域名不再被当成高熵密钥', () => {
  const plain = [
    'https://example.com/ztcm?a=1&b=中文',
    'https://www.apple.com/cn/',
    '{"name":"ZTCM","list":[1,2,3],"nested":{"k":"v"}}',
    '/Users/bin/Documents/report.txt',
    'C:\\Users\\bin\\Documents\\report2024.txt',
    '~/Library/Logs/ZTools/main-2026.log',
    'someone.name2024@example.com',
    'docs.ztools.cn/plugins/v2/catalog.json',
    'ZTools-Declarative-UI-Engine',
    'FX3-LEGACY-PINNED',
    'report2024-final-v3',
    'v1.2.3-beta.4+build.5678',
    '#3B82F6'
  ]
  for (const text of plain) {
    const r = maskSensitiveContent(text)
    assert.equal(r.isSensitive, false, text)
    assert.equal(r.masked, text)
  }
})

test('[6] 真正的密钥仍然识别并遮罩', () => {
  const secrets = [
    'aB3dE5fG7hJ9kL1mN3pQ',
    'sk-proj1234567890abcdefghijklmnop9876',
    'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'AKIAIOSFODNN7EXAMPLE',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    '{"apiKey":"sk-proj1234567890abcdefghijklmnop9876"}',
    'https://api.example.com/v1?key=sk-proj1234567890abcdefghijklmnop9876'
  ]
  for (const text of secrets) {
    const r = maskSensitiveContent(text)
    assert.equal(r.isSensitive, true, text)
    assert.ok(r.masked.includes('••••'), text)
  }
})

test('[6] 列表标题显示原文，没有「敏感」标签；宿主把带数字的链接误判后给的遮罩预览也按原文显示', async () => {
  const HOST_MASK = '•••••••••••••••• [高熵敏感机密已脱敏]'
  installHistoryHost([
    { id: 'h-1', content: 'https://www.apple.com/cn/' },
    { id: 'h-2', content: '/Users/bin/Documents/report.txt' },
    { id: 'h-3', content: 'https://vc.feishu.cn/j/912345678', text_preview: HOST_MASK },
    { id: 'h-4', content: 'Password2024!Secure', text_preview: HOST_MASK }
  ])
  const view = await mount(ClipboardHistoryCommand)
  await tick(20)
  assert.equal(view.item('h-3').props.title, 'https://vc.feishu.cn/j/912345678')
  assert.equal(view.item('h-4').props.title, HOST_MASK, '纯文本仍保留宿主的遮罩，不放宽')
  for (const id of ['h-1', 'h-2', 'h-3']) {
    const it = view.item(id)
    assert.ok(!it.props.title.includes('••'), it.props.title)
    assert.ok(!JSON.stringify(it.props.accessories).includes('敏感'))
    assert.ok(!JSON.stringify(it.props.detail).includes('敏感凭据'))
  }
})

// ---------------- clipboard-manager-7：敏感内容泄露 ----------------

const SECRET = 'sk-proj1234567890abcdefghijklmnop9876'

test('[7] JSON 中的密钥：右侧详情与全屏详情只显示遮罩值，复制仍是原文', async () => {
  installHistoryHost([{ id: 'h-s', content: `{"apiKey":"${SECRET}","user":"bin"}` }])
  const view = await mount(ClipboardHistoryCommand)
  await tick(20)
  const it = view.item('h-s')
  assert.ok(!it.props.title.includes(SECRET))
  const sideDetail = JSON.stringify(it.props.detail)
  assert.ok(!sideDetail.includes(SECRET), '右侧详情不含完整密钥')
  assert.ok(sideDetail.includes('••••••••'))
  assert.ok(it.props.detail.props.markdown.includes('"user": "bin"'), '非敏感字段照常显示')
  const full = await openPushed(view, it, '全屏查看详情')
  // 动作里的 content 是复制/粘贴用的原文，只检查页面展示的内容（Markdown 与元数据）
  const fullTree = full.tree()
  assert.ok(!fullTree.props.markdown.includes(SECRET))
  assert.ok(!JSON.stringify(fullTree.props.metadata).includes(SECRET))
  assert.ok(fullTree.props.markdown.includes('已遮罩'))
  await view.run(it, '仅复制到剪贴板')
  assert.ok(host.clipboard.text.includes(SECRET), '复制动作仍使用原文')
})

test('[7] 同步含密钥的剪贴板：提示里只显示遮罩值', async () => {
  installHistoryHost([])
  const view = await mount(ClipboardHistoryCommand)
  await tick(20)
  host.clipboard.text = `OPENAI_API_KEY=${SECRET}`
  await view.run(null, '读取并同步当前系统剪贴板')
  await tick(20)
  const toast = host.lastToast()
  assert.match(toast.title, /已同步/)
  assert.ok(!String(toast.message).includes(SECRET), String(toast.message))
  assert.ok(String(toast.message).includes('••••••••'))
})

test('[7][边界] 各类型敏感内容的详情都不含原文；高熵单词也遮罩', () => {
  const cases = [
    { type: 'text', content: 'aB3dE5fG7hJ9kL1mN3pQ' },
    { type: 'code', content: `const key = "${SECRET}";\nconsole.log(key)` },
    { type: 'link', content: `https://api.example.com/v1?key=${SECRET}` },
    { type: 'json', content: `{"apiKey": "${SECRET}"` } // 非法 JSON
  ]
  for (const c of cases) {
    const md = getClipboardMarkdown({ id: 'x', preview: '', copiedAt: 1, pinned: false, ...c })
    assert.ok(!md.includes(SECRET) && !md.includes('aB3dE5fG7hJ9kL1mN3pQ'), c.type)
    assert.ok(md.includes('已遮罩'), c.type)
  }
})

// ---------------- clipboard-manager-8：纯文本预览 ----------------

test('[8] 纯文本预览按原文展示：放进 text 代码块，换行、** 、- 、# 与 emoji 都保留', () => {
  const content = '多行纯文本第一行\n第二行 **加粗?** 与 # 井号\n- 列表项\n✅ 完成 ★ 星标 😀'
  const md = getClipboardMarkdown({ id: 'x', type: 'text', content, preview: '', copiedAt: 1, pinned: false })
  assert.ok(md.includes('```text\n' + content + '\n```'), md)
})

test('[8][边界] 内容里有 ``` 时围栏自动加长，代码块不会被提前结束', () => {
  const content = 'before\n```js\nalert(1)\n```\nafter ```` four'
  const block = fencedBlock(content)
  assert.ok(block.startsWith('`````text\n'))
  assert.ok(block.endsWith('\n`````'))
  const md = getClipboardMarkdown({ id: 'x', type: 'text', content, preview: '', copiedAt: 1, pinned: false })
  assert.ok(md.includes(block))
  assert.equal(fencedBlock(''), '```text\n\n```')
})

test('[8] 列表右侧详情对纯文本记录同样按原文展示', async () => {
  const content = 'VR6多行第一行\n第二行 **加粗?**\n- 列表项'
  installHistoryHost([{ id: 'h-t', content }])
  const view = await mount(ClipboardHistoryCommand)
  await tick(20)
  const md = view.item('h-t').props.detail.props.markdown
  assert.ok(md.includes('```text\n' + content + '\n```'))
})
