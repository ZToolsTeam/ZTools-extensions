// 清理范围与结果提示：只清理用户看得到并勾选的文件，失败如实提示，聊天媒体默认不勾选
import test from 'node:test'
import assert from 'node:assert/strict'
import { Toast } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import WechatCleanerCommand from '../dist/index.js'
import * as logic from '../dist/logic.js'

const HOME = 'C:\\Users\\tester'
const DOCS = `${HOME}\\Documents`
const XW = `${DOCS}\\xwechat_files`

function fileEntry(path, size) {
  return { name: path.split('\\').pop(), path, is_dir: false, size, mtime: 1725000000 }
}

// 70 个朋友圈缓存（默认勾选分类）+ 3 个聊天视频（体积最大，默认不勾选）+ 1 个聊天图片 + 1 个聊天数据库
function buildFixture() {
  const files = []
  for (let i = 0; i < 70; i++) files.push(fileEntry(`${XW}\\wxid_a\\cache\\sns_${i}.data`, 10_000 + i))
  for (let i = 0; i < 3; i++) files.push(fileEntry(`${XW}\\wxid_a\\msg\\video\\v${i}.mp4`, 900_000 + i))
  files.push(fileEntry(`${XW}\\wxid_a\\msg\\attach\\img.dat`, 50_000))
  files.push(fileEntry(`${XW}\\wxid_a\\db_storage\\message\\message_0.db`, 800_000))
  files.push(fileEntry(`${XW}\\wxid_a\\business\\favorite\\data\\fav1.bin`, 700_000))
  return files.sort((a, b) => b.size - a.size)
}

function installWechatHost(host, files) {
  host.ipc.system_get_path = async ({ name }) => {
    const map = { home: HOME, documents: DOCS, appData: `${HOME}\\AppData\\Roaming` }
    if (!map[name]) throw new Error(`未知目录 ${name}`)
    return { path: map[name] }
  }
  host.ipc.system_search_files = async ({ query }) => {
    if (query === `dir:${XW}`) {
      return {
        files: files.slice(),
        subdirs: [{ name: 'wxid_a', path: `${XW}\\wxid_a`, file_count: files.length, total_bytes: 0 }],
        total_matches: files.length,
        total_bytes: files.reduce((s, f) => s + f.size, 0)
      }
    }
    return { files: [], subdirs: [], total_matches: 0, total_bytes: 0 }
  }
}

async function waitFor(view, predicate, rounds = 200) {
  for (let i = 0; i < rounds; i++) {
    if (predicate(view.tree())) return
    await tick(2)
  }
  throw new Error('等待界面状态超时')
}

function subItems(view) {
  return view.tree().props.subList.items
}

function cleanAction(view, item) {
  return view.actions(item).find(a => a.props.title.startsWith('清理已勾选'))
}

test('默认勾选只覆盖显示出来的文件，聊天视频、聊天图片与数据库不勾选', async () => {
  const host = createHost()
  const files = buildFixture()
  installWechatHost(host, files)
  const view = await mount(WechatCleanerCommand)
  await waitFor(view, t => t.props.isLoading === false && t.props.subList.items.length > 0)

  const items = subItems(view)
  assert.equal(items.length, logic.WECHAT_FILE_DISPLAY_LIMIT, '右侧最多显示 60 个文件')
  const checked = items.filter(it => it.props.checked === true)
  assert.ok(checked.length > 0)
  for (const it of items) {
    if (/\.(?:mp4|dat|db)$/.test(it.props.title) || it.props.title === 'fav1.bin') {
      assert.notEqual(it.props.checked, true, `${it.props.title} 不应默认勾选`)
    }
  }
  const db = items.find(it => it.props.title === 'message_0.db')
  assert.equal(db.props.checkable, false)
  assert.match(db.props.subtitle, /受保护，不会被清理/)
  assert.doesNotMatch(view.text(), /硬件级/)
  const fav = items.find(it => it.props.title === 'fav1.bin')
  assert.equal(fav.props.accessories[1].tag.value, '用途未识别')

  // 清理时只把显示出来且勾选的文件交给宿主
  const trashed = []
  host.ipc.shell_trash_item = async ({ fullPath }) => {
    trashed.push(fullPath)
    return { success: true }
  }
  await cleanAction(view, items[0]).props.onAction()
  await tick(20)
  assert.equal(host.confirms.length, 1)
  assert.match(host.confirms[0].title, new RegExp(`把 ${checked.length} 个文件移入回收站`))
  const visiblePaths = new Set(items.map(it => files.find(f => f.name === it.props.title)?.path))
  assert.equal(trashed.length, checked.length)
  for (const p of trashed) {
    assert.ok(visiblePaths.has(p), `清理了没显示出来的文件：${p}`)
    assert.doesNotMatch(p, /\.mp4$|\.dat$|\.db$|fav1\.bin$/)
  }
  assert.equal(host.lastToast().style, Toast.Style.Success)
  assert.match(host.lastToast().title, new RegExp(`已移入回收站 ${checked.length} 个文件`))
})

test('部分文件移入回收站失败时提示失败，不显示“清理完成”', async () => {
  const host = createHost()
  const files = buildFixture()
  installWechatHost(host, files)
  const view = await mount(WechatCleanerCommand)
  await waitFor(view, t => t.props.isLoading === false && t.props.subList.items.length > 0)
  const failing = files.find(f => f.name === 'sns_69.data').path
  host.ipc.shell_trash_item = async ({ fullPath }) => {
    if (fullPath === failing) throw Object.assign(new Error('文件被占用'), { code: 'SHELL_ERROR' })
    return { success: true }
  }
  await cleanAction(view, subItems(view)[0]).props.onAction()
  await tick(20)
  const toast = host.toasts.find(t => t.style !== Toast.Style.Animated && /回收站|失败/.test(t.title))
  assert.equal(toast.style, Toast.Style.Failure)
  assert.match(toast.title, /1 个文件未能移入回收站/)
  assert.match(toast.message, /文件被占用/)
  assert.equal(host.toasts.some(t => /清理完成/.test(t.title)), false)
})

test('取消确认不删除任何文件；没有勾选时不弹确认也不调用宿主', async () => {
  const host = createHost()
  const files = buildFixture()
  installWechatHost(host, files)
  const view = await mount(WechatCleanerCommand)
  await waitFor(view, t => t.props.isLoading === false && t.props.subList.items.length > 0)
  const trashed = []
  host.ipc.shell_trash_item = async ({ fullPath }) => {
    trashed.push(fullPath)
    return { success: true }
  }
  host.setConfirm(false)
  await cleanAction(view, subItems(view)[0]).props.onAction()
  await tick(10)
  assert.deepEqual(trashed, [])

  // 表头复选框：部分勾选时第一次点击勾选显示出来的全部可清理文件，第二次全部取消
  view.tree().props.subList.onCheckChange(true)
  await tick(5)
  assert.equal(subItems(view).filter(it => it.props.checked === true).length, logic.WECHAT_FILE_DISPLAY_LIMIT - 1)
  view.tree().props.subList.onCheckChange(false)
  await tick(5)
  assert.equal(subItems(view).filter(it => it.props.checked === true).length, 0)
  const confirmsBefore = host.confirms.length
  await cleanAction(view, subItems(view)[0]).props.onAction()
  await tick(10)
  assert.equal(host.confirms.length, confirmsBefore)
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.equal(host.lastToast().title, '没有勾选任何文件')
  assert.deepEqual(trashed, [])
})

test('不在客户端中运行时只显示空状态，不显示示例数据', async () => {
  createHost()
  const saved = globalThis.__ztoolsElectron
  delete globalThis.__ztoolsElectron
  try {
    const view = await mount(WechatCleanerCommand)
    const text = view.text()
    assert.match(text, /需要在 ZTools 客户端中使用/)
    assert.doesNotMatch(text, /wxid_|message_0\.db|GB/)
    assert.equal(view.items().length, 1)
  } finally {
    globalThis.__ztoolsElectron = saved
  }
})

test('executeWechatCleanup：只处理传入路径，空列表、受保护路径与宿主失败都如实返回', async () => {
  const calls = []
  const host = {
    shell_trash_item: async ({ fullPath }) => {
      calls.push(fullPath)
      if (fullPath.endsWith('bad.data')) return { success: false, error: { code: 'SHELL_ERROR', message: '拒绝访问' } }
      return { success: true }
    }
  }
  const empty = await logic.executeWechatCleanup([], [], host)
  assert.equal(empty.ok, false)
  assert.equal(empty.error, '没有勾选任何文件')
  assert.deepEqual(calls, [])

  const ok = await logic.executeWechatCleanup(
    [`${XW}\\a\\cache\\x.data`, `${XW}\\a\\cache\\x.data`],
    [{ path: `${XW}\\a\\cache\\x.data`, sizeBytes: 100 }],
    host
  )
  assert.equal(ok.ok, true)
  assert.equal(ok.deletedCount, 1, '重复路径只处理一次')
  assert.equal(ok.freedBytes, 100)

  calls.length = 0
  const mixed = await logic.executeWechatCleanup(
    [`${XW}\\a\\cache\\good.data`, `${XW}\\a\\cache\\bad.data`, `${XW}\\a\\db_storage\\contact\\contact.db`, `${XW}\\a\\MicroMsg.db`],
    [],
    host
  )
  assert.equal(mixed.ok, false)
  assert.equal(mixed.deletedCount, 1)
  assert.equal(mixed.failedCount, 1)
  assert.equal(mixed.skippedProtected, 2)
  assert.match(mixed.error, /1 个文件未能移入回收站：拒绝访问/)
  assert.equal(calls.some(p => p.endsWith('.db')), false, '聊天数据库不能交给宿主')

  const onlyProtected = await logic.executeWechatCleanup([`${XW}\\a\\db_storage\\message\\message_0.db`], [], host)
  assert.equal(onlyProtected.ok, false)
  assert.match(onlyProtected.error, /受保护/)

  const allFail = await logic.executeWechatCleanup([`${XW}\\a\\cache\\bad.data`], [], host)
  const summary = logic.summarizeWechatCleanup(allFail)
  assert.equal(summary.success, false)
  assert.equal(summary.title, '清理失败')
})

test('pickDefaultCheckedPaths：只勾选显示出来的、默认勾选分类里的文件', () => {
  const rules = logic.OFFICIAL_WECHAT_OWNER_RULES
  assert.equal(rules.find(r => r.ownerId === 109).defaultChecked, false, '聊天视频与语音默认不勾选')
  assert.equal(rules.find(r => r.ownerId === 108).defaultChecked, false)
  assert.equal(rules.find(r => r.ownerId === 110).defaultChecked, false)
  const categories = rules.map(r => ({ ownerId: r.ownerId, checked: r.defaultChecked }))
  const visible = [
    { path: 'a', ownerId: 107, isProtected: false },
    { path: 'b', ownerId: 109, isProtected: false },
    { path: 'c', ownerId: 999, isProtected: true },
    { path: 'd', ownerId: 113, isProtected: false }
  ]
  assert.deepEqual(logic.pickDefaultCheckedPaths(visible, categories), ['a', 'd'])
  assert.deepEqual(logic.pickDefaultCheckedPaths([], categories), [])
})

test('在资源管理器定位、用默认程序打开失败时提示失败', async () => {
  const host = createHost()
  installWechatHost(host, buildFixture())
  const view = await mount(WechatCleanerCommand)
  await waitFor(view, t => t.props.isLoading === false && t.props.subList.items.length > 0)
  const item = subItems(view)[0]
  await view.run(item, '在资源管理器定位')
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.equal(host.lastToast().title, '无法在资源管理器中定位')
  await view.run(item, '使用默认程序打开文件')
  assert.equal(host.lastToast().title, '无法打开文件')
  host.ipc.shell_show_item_in_folder = async () => ({ success: true })
  const before = host.toasts.length
  await view.run(item, '在资源管理器定位')
  assert.equal(host.toasts.length, before, '定位成功时不提示')
})

test('classifyWechatFilePath：无法识别用途的文件标记为未识别，不默认勾选', () => {
  const unknown = logic.classifyWechatFilePath(`${XW}\\wxid_a\\business\\favorite\\data\\x.bin`, [])
  assert.equal(unknown.ownerId, 107)
  assert.equal(unknown.unrecognized, true)
  const cache = logic.classifyWechatFilePath(`C:\\Users\\t\\AppData\\Roaming\\Tencent\\xwechat\\radium\\web\\a.data`, [])
  assert.equal(cache.ownerId, 107)
  assert.equal(cache.unrecognized, undefined)
  const categories = logic.OFFICIAL_WECHAT_OWNER_RULES.map(r => ({ ownerId: r.ownerId, checked: r.defaultChecked }))
  assert.deepEqual(
    logic.pickDefaultCheckedPaths([{ path: 'u', ownerId: 107, isProtected: false, unrecognized: true }], categories),
    []
  )
})
