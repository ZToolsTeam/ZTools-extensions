// 常用目录改用宿主 system_list_common_folders 的集成测试：真实声明式运行时 + 模拟宿主（含路径授权语义）
// 覆盖：按宿主 id 映射列表项、不存在的目录隐藏、只打开宿主授权过的目录、旧宿主 / 异常返回回落到 system_get_path、
// 畸形条目过滤、授权失效时提示失败而不是假装打开
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import QuickFoldersCommand from '../dist/index.js'
import { buildFoldersFromHost } from '../dist/logic.js'

const host = createHost()
const rejections = []
process.on('unhandledRejection', (reason) => rejections.push(reason))

test.beforeEach(() => {
  host.reset()
  rejections.length = 0
})

const MAC_FOLDERS = [
  { id: 'home', path: '/Users/bob', exists: true },
  { id: 'desktop', path: '/Users/bob/Desktop', exists: true },
  { id: 'downloads', path: '/Users/bob/Downloads', exists: false },
  { id: 'documents', path: '/Users/bob/Documents', exists: true },
  { id: 'pictures', path: '/Users/bob/Pictures', exists: true },
  { id: 'videos', path: '/Users/bob/Movies', exists: true },
  { id: 'music', path: '/Users/bob/Music', exists: true },
  { id: 'appData', path: '/Users/bob/Library/Application Support', exists: true },
  { id: 'applications', path: '/Applications', exists: true },
  { id: 'library', path: '/Users/bob/Library', exists: true },
  { id: 'libraryCaches', path: '/Users/bob/Library/Caches', exists: true },
  { id: 'temp', path: '/var/folders/xy/abc123/T', exists: true }
]

const WIN_FOLDERS = [
  { id: 'home', path: 'D:\\Users\\alice', exists: true },
  { id: 'desktop', path: 'D:\\Users\\alice\\OneDrive\\桌面', exists: true },
  { id: 'downloads', path: 'D:\\Users\\alice\\Downloads', exists: true },
  { id: 'documents', path: 'D:\\Users\\alice\\Documents', exists: true },
  { id: 'pictures', path: 'D:\\Users\\alice\\Pictures', exists: true },
  { id: 'videos', path: 'D:\\Users\\alice\\Videos', exists: true },
  { id: 'music', path: 'D:\\Users\\alice\\Music', exists: true },
  { id: 'appData', path: 'D:\\Users\\alice\\AppData\\Roaming', exists: true },
  { id: 'localAppData', path: 'D:\\Users\\alice\\AppData\\Local', exists: true },
  { id: 'systemDrive', path: 'D:\\', exists: true },
  { id: 'temp', path: 'D:\\Users\\alice\\AppData\\Local\\Temp', exists: true }
]

/**
 * 与真实宿主一致：system_list_common_folders 把 exists:true 的目录授权给本窗口（只读、不递归），
 * shell_open_path 只放行已授权的路径，其余 PERMISSION_DENIED。返回授权表供用例撤销（模拟 30 分钟过期）。
 */
function installCommonFolderHost(folders) {
  const granted = new Set()
  const opened = []
  host.ipc.system_list_common_folders = async (params) => {
    if (params && Object.keys(params).length > 0) throw Object.assign(new Error('未知参数'), { code: 'INVALID_REQUEST' })
    for (const f of folders) if (f && f.exists === true && typeof f.path === 'string') granted.add(f.path)
    return { success: true, data: { folders } }
  }
  host.ipc.shell_open_path = async ({ fullPath }) => {
    if (!granted.has(fullPath)) throw Object.assign(new Error('路径未由当前窗口授权'), { code: 'PERMISSION_DENIED' })
    opened.push(fullPath)
    return { success: true }
  }
  return { granted, opened }
}

function installLegacyPathHost(home) {
  host.ipc.system_get_path = async ({ name }) => {
    if (name === 'home') return { success: true, path: home }
    const child = { desktop: 'Desktop', downloads: 'Downloads', documents: 'Documents', pictures: 'Pictures', videos: 'Movies', music: 'Music', appData: 'Library/Application Support' }[name]
    return child ? { success: true, path: `${home}/${child}` } : { success: false }
  }
}

test('macOS：列表直接用宿主返回的目录，id 映射到原有列表项，不再逐个读 system_get_path', async () => {
  installCommonFolderHost(MAC_FOLDERS)
  const view = await mount(QuickFoldersCommand)
  await tick(10)

  const ids = view.items().map((i) => i.props.id)
  assert.deepEqual(ids, ['desktop', 'documents', 'pictures', 'videos', 'music', 'userprofile', 'applications', 'app-support', 'library', 'caches', 'temp'])
  assert.equal(view.item('userprofile').props.subtitle, '/Users/bob')
  assert.equal(view.item('app-support').props.subtitle, '/Users/bob/Library/Application Support')
  assert.equal(view.item('caches').props.subtitle, '/Users/bob/Library/Caches')
  assert.equal(view.item('videos').props.title, '影片')
  // macOS 宿主的临时目录是 os.tmpdir()（/var/folders/...），不再是 /tmp
  assert.equal(view.item('temp').props.subtitle, '/var/folders/xy/abc123/T')
  assert.ok(!host.ipcCalls.some(([m]) => m === 'system_get_path'), '新宿主下不应再调用 system_get_path')
  assert.deepEqual(host.ipcCalls.find(([m]) => m === 'system_list_common_folders')[1], {}, '只能传空参数（宿主拒绝未知字段）')
  view.unmount()
})

test('标题只显示中文名，英文目录名放进关键词，按英文仍能搜到', async () => {
  installCommonFolderHost(MAC_FOLDERS)
  const view = await mount(QuickFoldersCommand)
  await tick(10)
  for (const item of view.items()) assert.doesNotMatch(item.props.title, /\([A-Za-z ]+\)/, item.props.title)
  assert.doesNotMatch(view.tree().props.searchBarPlaceholder, /[A-Za-z]/)
  assert.deepEqual(view.item('library').props.keywords, ['Library'])
  await view.search('movies')
  assert.deepEqual(view.items().map((i) => i.props.id), ['videos'])
  await view.search('CACHES')
  assert.deepEqual(view.items().map((i) => i.props.id), ['caches'])
  await view.search('不存在的目录名xyz')
  assert.equal(view.items().length, 0)
  view.unmount()
})

test('macOS：不存在的目录不显示（宿主不会授权打开），搜索也搜不到', async () => {
  installCommonFolderHost(MAC_FOLDERS)
  const view = await mount(QuickFoldersCommand)
  await tick(10)
  assert.ok(!view.items().some((i) => i.props.id === 'downloads'))
  await view.search('download')
  assert.equal(view.items().length, 0)
  view.unmount()
})

test('打开宿主授权过的目录成功并记录真实路径；资源库 / 应用程序都能打开', async () => {
  const { opened } = installCommonFolderHost(MAC_FOLDERS)
  const view = await mount(QuickFoldersCommand)
  await tick(10)
  await view.run(view.item('library'), '打开目录')
  assert.equal(host.lastToast().title, '已打开目录')
  await view.run(view.item('applications'), '打开目录')
  await view.run(view.item('temp'), '打开目录')
  assert.deepEqual(opened, ['/Users/bob/Library', '/Applications', '/var/folders/xy/abc123/T'])
  assert.equal(host.lastToast().message, '/var/folders/xy/abc123/T')
  view.unmount()
})

test('异常：授权已失效（窗口授权过期 / 宿主拒绝）时提示打开失败，不能显示“已打开”', async () => {
  const { granted, opened } = installCommonFolderHost(MAC_FOLDERS)
  const view = await mount(QuickFoldersCommand)
  await tick(10)
  granted.clear()
  await view.run(view.item('documents'), '打开目录')
  assert.equal(host.lastToast().title, '打开目录失败')
  assert.match(host.lastToast().message, /^\/Users\/bob\/Documents/)
  assert.match(host.lastToast().message, /未由当前窗口授权/)
  assert.deepEqual(opened, [])
  assert.equal(rejections.length, 0)
  view.unmount()
})

test('Windows：home / appData / localAppData / systemDrive 映射到原有列表项，系统盘名称跟随宿主盘符', async () => {
  installCommonFolderHost(WIN_FOLDERS)
  const view = await mount(QuickFoldersCommand)
  await tick(10)
  assert.equal(view.item('userprofile').props.subtitle, 'D:\\Users\\alice')
  assert.equal(view.item('desktop').props.subtitle, 'D:\\Users\\alice\\OneDrive\\桌面')
  assert.equal(view.item('appdata-roaming').props.subtitle, 'D:\\Users\\alice\\AppData\\Roaming')
  assert.equal(view.item('appdata-local').props.subtitle, 'D:\\Users\\alice\\AppData\\Local')
  assert.equal(view.item('system-drive').props.subtitle, 'D:\\')
  assert.equal(view.item('system-drive').props.title, '系统盘 (D:)')
  assert.equal(view.item('videos').props.title, '视频')
  assert.ok(!view.items().some((i) => ['applications', 'library', 'caches', 'app-support'].includes(i.props.id)), 'Windows 不出现 macOS 专属目录')
  view.unmount()
})

test('旧宿主：没有 system_list_common_folders 时回落到 system_get_path 拼路径', async () => {
  installLegacyPathHost('/Users/bob')
  const view = await mount(QuickFoldersCommand)
  await tick(10)
  assert.ok(host.ipcCalls.some(([m]) => m === 'system_list_common_folders'), '应先尝试新方法')
  assert.ok(host.ipcCalls.some(([m, p]) => m === 'system_get_path' && p?.name === 'home'))
  assert.equal(view.item('downloads').props.subtitle, '/Users/bob/Downloads')
  assert.equal(view.item('temp').props.subtitle, '/tmp', '旧宿主下临时目录仍按系统约定生成')
  view.unmount()
})

test('异常：新方法报错或返回结构不对时回落，不白屏、不留未处理的 rejection', async () => {
  for (const broken of [
    async () => { throw Object.assign(new Error('内部错误'), { code: 'INTERNAL_ERROR' }) },
    async () => ({ success: true, data: { folders: 'not-an-array' } }),
    async () => ({ success: true, data: null }),
    async () => ({ success: false, error: { code: 'PERMISSION_DENIED', message: '拒绝' } })
  ]) {
    host.reset()
    installLegacyPathHost('/Users/bob')
    host.ipc.system_list_common_folders = broken
    const view = await mount(QuickFoldersCommand)
    await tick(10)
    assert.equal(view.item('userprofile').props.subtitle, '/Users/bob')
    view.unmount()
  }
  assert.equal(rejections.length, 0)
})

test('异常：新方法与 system_get_path 都失败时列表为空并提示读取失败', async () => {
  host.ipc.system_list_common_folders = async () => { throw Object.assign(new Error('断开'), { code: 'IPC_CLOSED' }) }
  host.ipc.system_get_path = async () => { throw Object.assign(new Error('读取失败'), { code: 'FILE_ERROR' }) }
  const view = await mount(QuickFoldersCommand)
  await tick(10)
  assert.equal(view.items().length, 0)
  assert.ok(host.toasts.some((t) => t.title === '读取系统目录失败'))
  view.unmount()
})

test('边界：宿主返回的目录都不存在时列表为空并提示，不回落编造路径', async () => {
  installCommonFolderHost(MAC_FOLDERS.map((f) => ({ ...f, exists: false })))
  installLegacyPathHost('/Users/bob')
  const view = await mount(QuickFoldersCommand)
  await tick(10)
  assert.equal(view.items().length, 0)
  assert.ok(!host.ipcCalls.some(([m]) => m === 'system_get_path'))
  assert.ok(host.toasts.some((t) => t.title === '读取系统目录失败'))
  view.unmount()
})

test('畸形条目：非对象、缺 id / 路径、exists 不是 true、重复 id、未知 id 都被忽略', () => {
  const list = buildFoldersFromHost([
    null,
    'str',
    { id: 'home', path: '/Users/bob', exists: true },
    { id: 'home', path: '/Users/evil', exists: true },
    { id: 'desktop', path: '', exists: true },
    { id: 42, path: '/x', exists: true },
    { id: 'documents', path: '/Users/bob/Documents', exists: 'true' },
    { id: 'pictures', path: '  /Users/bob/Pictures  ', exists: true },
    { id: 'unknownFutureFolder', path: '/opt/x', exists: true }
  ])
  assert.deepEqual(list.map((f) => [f.id, f.path]), [['pictures', '/Users/bob/Pictures'], ['userprofile', '/Users/bob']])
  assert.equal(buildFoldersFromHost(undefined), null)
  assert.equal(buildFoldersFromHost({ folders: [] }), null)
  assert.deepEqual(buildFoldersFromHost([]), [])
})
