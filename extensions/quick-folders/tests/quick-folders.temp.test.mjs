import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import QuickFoldersCommand from '../dist/index.js'
import { buildFolders, systemTempPath } from '../dist/logic.js'

const host = createHost()
test.beforeEach(() => host.reset())

// 与真实宿主一致：'temp' 返回 ZTools 自己的隔离缓存目录，而不是系统临时目录
function installPathHost(home, { scopedTemp, failNames = [] } = {}) {
  const windows = !home.startsWith('/')
  const sep = windows ? '\\' : '/'
  host.ipc.system_get_path = async ({ name }) => {
    if (failNames.includes(name)) throw Object.assign(new Error('读取失败'), { code: 'FILE_ERROR' })
    if (name === 'home') return { success: true, path: home }
    if (name === 'temp') return { success: true, path: scopedTemp }
    const child = { desktop: 'Desktop', downloads: 'Downloads', documents: 'Documents', pictures: 'Pictures', videos: windows ? 'Videos' : 'Movies', music: 'Music', appData: windows ? 'AppData\\Roaming' : 'Library/Application Support' }[name]
    return { success: true, path: home + sep + child }
  }
}

test('macOS：临时文件夹指向系统 /tmp，不是 ZTools 的 Cache/main/Temp，也不再向宿主要 temp', async () => {
  const scoped = '/Users/bob/Library/Application Support/ZTools/Cache/main/Temp'
  installPathHost('/Users/bob', { scopedTemp: scoped })
  const opened = []
  host.ipc.shell_open_path = async ({ fullPath }) => { opened.push(fullPath); return { success: true } }
  const view = await mount(QuickFoldersCommand)
  await tick(10)

  const temp = view.item('temp')
  assert.equal(temp.props.subtitle, '/tmp')
  assert.ok(!view.text().includes('ZTools/Cache'), '列表里不能出现 ZTools 自己的缓存目录')
  assert.ok(!host.ipcCalls.some(([m, p]) => m === 'system_get_path' && p?.name === 'temp'), '不应再读取宿主的 temp')

  await view.run(temp, '打开目录')
  assert.deepEqual(opened, ['/tmp'])
  assert.equal(host.lastToast().title, '已打开目录')
  assert.equal(host.lastToast().message, '/tmp')

  await view.search('temp')
  assert.deepEqual(view.items().map((i) => i.props.id), ['temp'])
  view.unmount()
})

test('Windows：临时文件夹为当前用户的 AppData\\Local\\Temp，跟随主目录所在盘符', async () => {
  installPathHost('D:\\Users\\alice', { scopedTemp: 'D:\\Users\\alice\\AppData\\Roaming\\ZTools\\Cache\\main\\Temp' })
  const view = await mount(QuickFoldersCommand)
  await tick(10)
  assert.equal(view.item('temp').props.subtitle, 'D:\\Users\\alice\\AppData\\Local\\Temp')
  assert.ok(!view.text().includes('ZTools'), '列表里不能出现 ZTools 自己的目录')
  view.unmount()
})

test('异常：宿主拒绝打开临时文件夹时提示失败，不能显示“已打开”', async () => {
  installPathHost('/Users/bob', { scopedTemp: '/Users/bob/Library/Application Support/ZTools/Cache/main/Temp' })
  host.ipc.shell_open_path = async () => { throw Object.assign(new Error('路径未由当前窗口授权'), { code: 'PERMISSION_DENIED' }) }
  const view = await mount(QuickFoldersCommand)
  await tick(10)
  await view.run(view.item('temp'), '打开目录')
  assert.equal(host.lastToast().title, '打开目录失败')
  assert.equal(host.lastToast().message, '/tmp')
  view.unmount()
})

test('异常：宿主读不到主目录时列表为空并提示读取失败，不编造临时目录', async () => {
  installPathHost('/Users/bob', { failNames: ['home', 'desktop', 'downloads', 'documents', 'pictures', 'videos', 'music', 'appData'] })
  const view = await mount(QuickFoldersCommand)
  await tick(10)
  assert.equal(view.items().length, 0)
  assert.ok(host.toasts.some((t) => t.title === '读取系统目录失败'))
  view.unmount()
})

test('边界：即使调用方仍传入宿主的 temp，也只按系统约定生成；主目录尾部分隔符被规整', () => {
  const mac = buildFolders({ home: '/Users/bob/', temp: '/Users/bob/Library/Application Support/ZTools/Cache/main/Temp' })
  assert.equal(mac.find((f) => f.id === 'temp').path, '/tmp')
  const win = buildFolders({ home: 'C:\\Users\\alice\\', temp: 'C:\\Users\\alice\\AppData\\Roaming\\ZTools\\Cache\\main\\Temp' })
  assert.equal(win.find((f) => f.id === 'temp').path, 'C:\\Users\\alice\\AppData\\Local\\Temp')
  assert.equal(systemTempPath('C:\\Users\\x', true), 'C:\\Users\\x\\AppData\\Local\\Temp')
  assert.equal(systemTempPath('/Users/x', false), '/tmp')
})
