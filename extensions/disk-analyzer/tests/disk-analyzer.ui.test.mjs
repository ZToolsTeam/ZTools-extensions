// disk-analyzer 界面集成测试：真实声明式运行时 + 按宿主 dir: 扫描语义模拟的 macOS 宿主
// 覆盖：分类名称不再被清空、macOS 系统文件保护、右侧列表完整渲染与全选范围、进行中提示的收尾与重新扫描互斥
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import { getDeclarativeBridge } from '@ztools/declarative-ui'
import DiskAnalyzerCommand from '../dist/index.js'
import { OFFICIAL_FILE_TYPE_GROUPS, FORBIDDEN_TARGET_PATTERN, deleteDiskFileItem } from '../dist/logic.js'

const host = createHost()
const MB = 1024 * 1024
const HOME = '/Users/tester'

// 记录每个 Toast 句柄是否被 hide（测试工具自带的 showToast 不跟踪 hide）
const toastLog = []
const bridge = getDeclarativeBridge()
const baseShowToast = bridge.showToast
bridge.showToast = (options) => {
  const entry = { ...options, hidden: false }
  toastLog.push(entry)
  const handle = baseShowToast.call(bridge, options)
  return { ...handle, hide() { entry.hidden = true; handle.hide() } }
}

const SYSTEM_FILES = [
  '/usr/bin/ex',
  '/bin/ksh',
  '/sbin/launchd',
  '/System/Library/Kernels/kernel',
  '/Library/Keychains/system-keychain-2.db-wal',
  '/Library/Fonts/Arial Unicode.ttf',
  '/private/etc/services',
  '/private/var/db/dyld/cache.bin',
  '/Applications/Visual Studio Code.app/Contents/Resources/app/node_modules.asar',
  `${HOME}/Library/Mail/V10/mailbox.db`
]
const CLEANABLE_SYSTEM_SIBLINGS = [
  '/usr/local/lib/libbig.dylib',
  `${HOME}/Library/Caches/com.example/cache.db`,
  '/private/var/folders/ab/T/old-download.dmg'
]

function fileRec(p, size) {
  return { name: p.split('/').pop(), path: p, size, is_dir: false, mtime: 1_700_000_000 }
}

/**
 * 模拟 macOS 宿主：
 * - Downloads 下 userCount 个用户大文件（视频 / 压缩包 / 字体 / 无后缀）
 * - Documents 扫描返回系统路径与可清理的同级路径（模拟宿主返回深层文件）
 * - 分区根目录 / 的扫描被截断（文件应被忽略）
 */
function installMacHost({ userCount = 30, scanGate = null } = {}) {
  const calls = { scans: 0, trash: [] }
  host.ipc.system_list_volumes = async () => ({ volumes: [{ path: '/', label: 'Macintosh HD', fileSystem: 'APFS', totalBytes: 500 * 1024 ** 3, usedBytes: 100 * 1024 ** 3, availableBytes: 400 * 1024 ** 3, capacityGroup: 'disk3' }], partial: false, errors: [] })
  host.ipc.system_get_disk_usage = async ({ drive, path }) => {
    if ((drive || path) === '/') return { total: 500 * 1024 * MB, used: 100 * 1024 * MB, available: 400 * 1024 * MB, percent: 20 }
    throw Object.assign(new Error('NOT_A_DRIVE'), { code: 'FILE_ERROR' })
  }
  host.ipc.system_get_path = async ({ name }) => {
    const map = { home: HOME, downloads: `${HOME}/Downloads`, documents: `${HOME}/Documents`, desktop: `${HOME}/Desktop`, videos: `${HOME}/Movies`, temp: '/private/var/folders/ab/T' }
    return { success: true, path: map[name] || `${HOME}/${name}` }
  }
  host.ipc.system_search_files = async ({ query }) => {
    calls.scans++
    if (scanGate) await scanGate.promise
    const dir = String(query).slice(4)
    let files = []
    let truncated = false
    if (dir === `${HOME}/Downloads`) {
      const exts = ['.mp4', '.zip', '.ttf', '']
      files = Array.from({ length: userCount }, (_, i) => fileRec(`${dir}/user-${String(i).padStart(3, '0')}${exts[i % exts.length]}`, (i + 1) * MB))
    } else if (dir === `${HOME}/Documents`) {
      files = [...SYSTEM_FILES, ...CLEANABLE_SYSTEM_SIBLINGS].map((p, i) => fileRec(p, (500 + i) * MB))
    } else if (dir === '/') {
      truncated = true
      files = [fileRec('/usr/bin/zsh', 9 * MB)]
    }
    return { files, count: files.length, total_matches: files.length, total_bytes: files.reduce((s, f) => s + f.size, 0), subdirs: [], truncated, visited_entries: truncated ? 2000 : files.length, max_entries: 2000 }
  }
  host.ipc.shell_trash_item = async ({ fullPath }) => {
    calls.trash.push(fullPath)
    return { success: true }
  }
  return calls
}

function deferred() {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}

async function mountLoaded() {
  const view = await mount(DiskAnalyzerCommand)
  await tick(30)
  return view
}

const subList = (view) => view.tree().props.subList
const subRows = (view) => subList(view).items
const rescanAction = (view) => view.tree().props.filterBar.actions.find((a) => a.id === 'act-rescan')
const findRow = (view, filePath) => subRows(view).find((it) => it.props.subtitle.startsWith(filePath.slice(0, filePath.lastIndexOf('/'))) && it.props.title === filePath.split('/').pop())
const actionTitles = (view, node) => view.actions(node).map((a) => a.props.title)

test.beforeEach(() => {
  host.reset()
  toastLog.length = 0
})

test('分类名称：左栏 10 大分类、右侧行标签、范围标题与分类动作都显示完整名称（不再被前缀正则整段删掉）', async () => {
  installMacHost({ userCount: 12 })
  const view = await mountLoaded()
  const groupItems = view.items().filter((it) => String(it.props.id).startsWith('group-'))
  assert.ok(groupItems.length >= 4, '至少识别出视频 / 压缩包 / 其他 / 系统等分类')
  for (const it of groupItems) {
    const meta = OFFICIAL_FILE_TYPE_GROUPS.find((g) => `group-${g.groupId}` === it.props.id)
    assert.equal(it.props.title, meta.name, `分类 ${it.props.id} 名称不能为空`)
  }

  // 右侧每行标签 = 分类短名，无后缀文件归入「其他文件」
  const mp4 = findRow(view, `${HOME}/Downloads/user-000.mp4`)
  assert.equal(mp4.props.accessories[1].tag.value, '视频文件')
  const noExt = findRow(view, `${HOME}/Downloads/user-003`)
  assert.equal(noExt.props.accessories[1].tag.value, '其他文件')
  for (const row of subRows(view)) assert.ok(row.props.accessories[1].tag.value.length > 0, `${row.props.title} 标签为空`)

  // 点击分类：范围标题与左栏动作标题带分类名
  const video = view.item('group-1')
  video.props.onSelect()
  await tick()
  assert.equal(subList(view).title, '「视频文件」下的大文件')
  assert.deepEqual(actionTitles(view, view.item('group-1')).slice(0, 2), ['查看「视频文件」下的 3 个文件', '全选「视频文件」下所有可清理文件'])
  assert.ok(!view.text().includes('「」'), '界面中不应出现空引号')
  view.unmount()
})

test('macOS 系统保护：/usr /bin /sbin /System /Library /private/etc /private/var、.app 包内与 ~/Library 文件锁定，不可勾选也不进清理队列', async () => {
  const calls = installMacHost({ userCount: 5 })
  const view = await mountLoaded()

  for (const p of SYSTEM_FILES) {
    const row = findRow(view, p)
    assert.ok(row, `系统文件 ${p} 仍应列出（帮助定位空间占用）`)
    assert.equal(row.props.checkable, false, `${p} 不可勾选`)
    assert.equal(row.props.accessories[1].tag.value, '系统保护')
    const titles = actionTitles(view, row)
    assert.equal(titles[0], '在访达中定位', `${p} 主动作退为定位`)
    assert.ok(!titles.includes('移入废纸篓清理') && !titles.includes('勾选加入批量清理队列'), `${p} 没有清理/勾选动作`)
    // 旧闭包或异常事件强行勾选：被拒绝
    row.props.onCheckChange(true)
    await tick()
  }
  assert.ok(!view.tree().props.filterBar.summaryText.includes('已勾选'), '受保护文件强行勾选无效')

  // /usr/local、~/Library/Caches、/private/var/folders 下的用户文件仍可清理
  for (const p of CLEANABLE_SYSTEM_SIBLINGS) {
    const row = findRow(view, p)
    assert.equal(row.props.checkable, true, `${p} 可勾选`)
    assert.equal(actionTitles(view, row)[0], '移入废纸篓清理')
  }

  // 表头全选：只勾可清理文件
  subList(view).onCheckChange(true)
  await tick()
  const selectable = 5 + CLEANABLE_SYSTEM_SIBLINGS.length
  assert.match(view.tree().props.filterBar.summaryText, new RegExp(`已勾选 ${selectable} 项`))

  // 批量清理：确认框只列可清理文件，宿主只收到可清理路径
  const anyRow = findRow(view, CLEANABLE_SYSTEM_SIBLINGS[0])
  const batchTitle = view.actions(anyRow).find((a) => a.props.title.startsWith('批量清理')).props.title
  assert.ok(batchTitle.startsWith(`批量清理已勾选的 ${selectable} 项`))
  await view.run(anyRow, batchTitle)
  await tick(10)
  assert.equal(host.confirms.at(-1).title, `确认批量清理已勾选的 ${selectable} 个文件？`)
  assert.equal(calls.trash.length, selectable)
  for (const p of calls.trash) assert.ok(!FORBIDDEN_TARGET_PATTERN.test(p), `不应清理受保护文件 ${p}`)
  assert.ok(SYSTEM_FILES.every((p) => !calls.trash.includes(p)))
  view.unmount()
})

test('保护规则边界：大小写、/usr/local 前缀伪装、.. 路径穿越与 Windows 路径；逻辑层删除直接拦截不发 IPC', async () => {
  const protectedPaths = [
    '/usr', '/USR/BIN/ls', '/usr/localx/evil', '/usr/local/../bin/ls', '/Users/a/Downloads/../../../usr/bin/ls',
    '/System', '/private/var/vm/sleepimage', '/var/db/x', '/etc/hosts', '/Library', '/library/fonts/a.ttf',
    '/Users/a/Library', '/Users/a/Library/Keychains/login.keychain-db', '/Users/a/Applications/Foo.app/Contents/MacOS/Foo',
    'C:\\Windows\\System32\\kernel32.dll', 'c:\\program files (x86)\\app\\a.exe', 'C:\\System Volume Information\\x'
  ]
  const cleanable = [
    '/usr/local/bin/node', '/Users/a/Library/Caches/x.db', '/Users/a/Downloads/big.iso', '/private/var/folders/x/T/a.tmp',
    '/private/tmp/a.bin', '/Applications/Foo.app.zip', '/Volumes/Data/Library/x.mov', 'D:\\Downloads\\a.iso', 'C:\\Users\\a\\b.zip'
  ]
  for (const p of protectedPaths) assert.equal(FORBIDDEN_TARGET_PATTERN.test(p), true, `应保护 ${p}`)
  for (const p of cleanable) assert.equal(FORBIDDEN_TARGET_PATTERN.test(p), false, `不应误保护 ${p}`)

  const calls = installMacHost()
  for (const p of ['/usr/bin/ex', '/Applications/X.app/Contents/Resources/app.asar', '  /sbin/launchd  ']) {
    const res = await deleteDiskFileItem(p)
    assert.equal(res.ok, false)
    assert.match(res.error, /受保护/)
  }
  assert.equal(calls.trash.length, 0, '受保护路径一律不发起回收站 IPC')
})

test('右侧列表完整渲染全部匹配项（不再截断到 60 行），表头全选数量与可见行一致，取消全选清空', async () => {
  const calls = installMacHost({ userCount: 150 })
  const view = await mountLoaded()
  const total = 150 + SYSTEM_FILES.length + CLEANABLE_SYSTEM_SIBLINGS.length
  assert.equal(subRows(view).length, total, '全部条目都可浏览')
  assert.match(subList(view).subtitle, new RegExp(`^${total} 项`))
  assert.ok(!new RegExp(`(^|\\D)${total} (个|项)`).test(view.tree().props.filterBar.summaryText), '数量只在右侧表头出现一次，摘要不重复')

  subList(view).onCheckChange(true)
  await tick()
  const checkedRows = subRows(view).filter((r) => r.props.checked).length
  assert.equal(checkedRows, 150 + CLEANABLE_SYSTEM_SIBLINGS.length)
  assert.match(view.tree().props.filterBar.summaryText, new RegExp(`已勾选 ${checkedRows} 项`))
  assert.equal(subList(view).checked, true)

  // 搜索缩小范围后全选，只作用于当前可见行
  subList(view).onCheckChange(false)
  await tick()
  assert.equal(subList(view).checked, false)
  await view.search('.mp4')
  const mp4Rows = subRows(view)
  assert.ok(mp4Rows.length > 30 && mp4Rows.every((r) => r.props.title.endsWith('.mp4')))
  subList(view).onCheckChange(true)
  await tick()
  assert.match(view.tree().props.filterBar.summaryText, new RegExp(`已勾选 ${mp4Rows.length} 项`))

  // 用户取消批量确认：不发任何回收站请求
  host.setConfirm(false)
  const row = subRows(view)[0]
  const batchTitle = view.actions(row).find((a) => a.props.title.startsWith('批量清理')).props.title
  await view.run(row, batchTitle)
  assert.equal(calls.trash.length, 0)
  view.unmount()
})

test('重新扫描：进行中提示结束后被 hide，连点 3 次只扫描一轮，扫描中按钮禁用', async () => {
  const gate = deferred()
  const calls = installMacHost({ userCount: 3 })
  const view = await mountLoaded()
  const scansAfterMount = calls.scans
  toastLog.length = 0

  // 让下一轮扫描卡住，模拟耗时扫描
  installMacHost({ userCount: 3, scanGate: gate })
  const fire = rescanAction(view).onAction
  fire(); fire(); fire()
  await tick(10)
  const animated = toastLog.filter((t) => t.style === 'ANIMATED')
  assert.equal(animated.length, 1, '连点只出现一个进行中提示')
  assert.equal(rescanAction(view).disabled, true)
  assert.equal(rescanAction(view).label, '正在扫描...')
  // 扫描中再从最新闭包触发：仍被互斥拦截
  rescanAction(view).onAction()
  await tick(5)
  assert.equal(toastLog.filter((t) => t.style === 'ANIMATED').length, 1)

  gate.resolve()
  await tick(40)
  assert.equal(animated[0].hidden, true, '扫描完成后进行中提示消失')
  assert.equal(toastLog.at(-1).style, 'SUCCESS')
  assert.equal(rescanAction(view).disabled, false)
  assert.equal(rescanAction(view).label, '重新扫描')
  assert.ok(scansAfterMount > 0)

  // 结束后可以再次扫描
  toastLog.length = 0
  rescanAction(view).onAction()
  await tick(40)
  assert.equal(toastLog.filter((t) => t.style === 'ANIMATED').length, 1)
  assert.ok(toastLog.every((t) => t.style !== 'ANIMATED' || t.hidden))
  view.unmount()
})

test('重新扫描异常：preload 桥崩溃导致扫描抛错时，进行中提示被 hide、提示失败、按钮恢复且可重试', async () => {
  installMacHost({ userCount: 3 })
  const view = await mountLoaded()
  toastLog.length = 0
  // 故障注入：preload 桥访问即抛错（IPC 层的 try/catch 之外），扫描整体 reject
  const realBridge = globalThis.__ztoolsElectron
  globalThis.__ztoolsElectron = { get transport() { throw new Error('PAYLOAD_CORRUPTED: preload bridge crashed') } }
  try {
    rescanAction(view).onAction()
    await tick(40)
  } finally {
    globalThis.__ztoolsElectron = realBridge
  }
  const animated = toastLog.filter((t) => t.style === 'ANIMATED')
  assert.equal(animated.length, 1)
  assert.equal(animated[0].hidden, true)
  const failure = toastLog.find((t) => t.style === 'FAILURE')
  assert.ok(failure, '应提示扫描失败')
  assert.equal(failure.title, '磁盘扫描失败')
  assert.match(failure.message, /PAYLOAD_CORRUPTED/)
  assert.equal(rescanAction(view).disabled, false)
  assert.equal(view.tree().props.isLoading, false)

  installMacHost({ userCount: 3 })
  toastLog.length = 0
  rescanAction(view).onAction()
  await tick(40)
  assert.equal(toastLog.at(-1).style, 'SUCCESS', '故障恢复后可以重新扫描')
  view.unmount()
})

test('批量清理：进行中提示在成功、全部失败与宿主异常时都被 hide；重复触发只执行一次', async () => {
  const calls = installMacHost({ userCount: 4 })
  const view = await mountLoaded()
  const row = () => findRow(view, `${HOME}/Downloads/user-000.mp4`)
  const batchTitle = () => view.actions(row()).find((a) => a.props.title.startsWith('批量清理')).props.title

  // 全部失败（宿主拒绝）
  findRow(view, `${HOME}/Downloads/user-000.mp4`).props.onCheckChange(true)
  findRow(view, `${HOME}/Downloads/user-001.zip`).props.onCheckChange(true)
  await tick()
  host.ipc.shell_trash_item = async () => { throw Object.assign(new Error('路径未由当前窗口授权'), { code: 'PERMISSION_DENIED' }) }
  toastLog.length = 0
  await view.run(row(), batchTitle())
  await tick(10)
  let animated = toastLog.filter((t) => t.style === 'ANIMATED')
  assert.equal(animated.length, 1)
  assert.equal(animated[0].hidden, true, '失败后进行中提示消失')
  assert.equal(toastLog.at(-1).style, 'FAILURE')
  assert.match(toastLog.at(-1).message, /未由当前窗口授权/)

  // 重复触发（确认框尚未返回时再次触发）：只弹一次确认、只清理一次
  host.ipc.shell_trash_item = async ({ fullPath }) => { calls.trash.push(fullPath); return { success: true } }
  const gate = deferred()
  const confirmBefore = host.confirms.length
  const bridgeConfirm = bridge.confirmAlert
  bridge.confirmAlert = async (opts) => { host.confirms.push(opts); await gate.promise; return true }
  toastLog.length = 0
  const action = view.actions(row()).find((a) => a.props.title.startsWith('批量清理'))
  const p1 = action.props.onAction()
  const p2 = action.props.onAction()
  gate.resolve()
  await Promise.all([p1, p2])
  await tick(10)
  bridge.confirmAlert = bridgeConfirm
  assert.equal(host.confirms.length - confirmBefore, 1, '只弹出一次确认')
  assert.equal(calls.trash.length, 2, '两个文件各清理一次')
  animated = toastLog.filter((t) => t.style === 'ANIMATED')
  assert.equal(animated.length, 1)
  assert.equal(animated[0].hidden, true)
  assert.equal(toastLog.at(-1).style, 'SUCCESS')
  assert.equal(subRows(view).some((r) => r.props.title === 'user-000.mp4'), false, '清理成功的文件从列表移除')
  view.unmount()
})
