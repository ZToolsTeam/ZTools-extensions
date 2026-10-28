// 清理范围与结果提示：只清理用户看得到并勾选的文件，失败如实提示，聊天图片、视频、语音默认不勾选
import test from 'node:test'
import assert from 'node:assert/strict'
import { Toast } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import QQCleanerCommand from '../dist/index.js'
import * as logic from '../dist/logic.js'

const HOME = 'C:\\Users\\tester'
const DOCS = `${HOME}\\Documents`
const TF = `${DOCS}\\Tencent Files`

function fileEntry(path, size) {
  return { name: path.split('\\').pop(), path, is_dir: false, size, mtime: 1725000000 }
}

// 70 个账号网页缓存（默认勾选分组）+ 体积最大的聊天视频、聊天图片、语音（默认不勾选）+ 聊天数据库
function buildFixture() {
  const files = []
  for (let i = 0; i < 70; i++) files.push(fileEntry(`${TF}\\10001\\AppWebCache\\cache_${i}.bin`, 10_000 + i))
  files.push(fileEntry(`${TF}\\10001\\Video\\v1.mp4`, 900_000))
  files.push(fileEntry(`${TF}\\10001\\Image\\Group\\pic.png`, 880_000))
  files.push(fileEntry(`${TF}\\10001\\Audio\\voice.amr`, 870_000))
  files.push(fileEntry(`${TF}\\10001\\Msg3.0.db`, 800_000))
  files.push(fileEntry(`${TF}\\10001\\SomeUnknownDir\\keep.bin`, 700_000))
  return files.sort((a, b) => b.size - a.size)
}

function installQQHost(host, files) {
  host.ipc.system_get_path = async ({ name }) => {
    const map = { home: HOME, documents: DOCS, appData: `${HOME}\\AppData\\Roaming` }
    if (!map[name]) throw new Error(`未知目录 ${name}`)
    return { path: map[name] }
  }
  host.ipc.system_search_files = async ({ query }) => {
    if (query === `dir:${TF}`) {
      return {
        files: files.slice(),
        subdirs: [{ name: '10001', path: `${TF}\\10001`, file_count: files.length, total_bytes: 0 }],
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

const subItems = view => view.tree().props.subList.items
const cleanAction = (view, item) => view.actions(item).find(a => a.props.title.startsWith('清理已勾选'))
const loaded = t => t.props.isLoading === false && t.props.subList.items.length > 0

test('默认勾选只覆盖显示出来的文件，聊天视频、图片、语音与数据库不勾选；清理只交给宿主这些文件', async () => {
  const host = createHost()
  const files = buildFixture()
  installQQHost(host, files)
  const view = await mount(QQCleanerCommand)
  await waitFor(view, loaded)

  const items = subItems(view)
  assert.equal(items.length, logic.QQ_FILE_DISPLAY_LIMIT)
  const checked = items.filter(it => it.props.checked === true)
  assert.ok(checked.length > 0)
  for (const name of ['v1.mp4', 'pic.png', 'voice.amr', 'Msg3.0.db', 'keep.bin']) {
    const it = items.find(i => i.props.title === name)
    assert.notEqual(it.props.checked, true, `${name} 不应默认勾选`)
  }
  const db = items.find(i => i.props.title === 'Msg3.0.db')
  assert.equal(db.props.checkable, false)
  assert.match(db.props.subtitle, /受保护，不会被清理/)
  assert.doesNotMatch(view.text(), /硬件级/)
  assert.equal(items.find(i => i.props.title === 'keep.bin').props.accessories[1].tag.value, '用途未识别')

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
    assert.match(p, /AppWebCache/)
  }
  assert.equal(host.lastToast().style, Toast.Style.Success)
})

test('部分或全部文件移入回收站失败时提示失败，不显示“清理完成”', async () => {
  const host = createHost()
  installQQHost(host, buildFixture())
  const view = await mount(QQCleanerCommand)
  await waitFor(view, loaded)
  host.ipc.shell_trash_item = async ({ fullPath }) => {
    if (fullPath.endsWith('cache_69.bin')) throw Object.assign(new Error('文件被占用'), { code: 'SHELL_ERROR' })
    return { success: true }
  }
  await cleanAction(view, subItems(view)[0]).props.onAction()
  await tick(20)
  const toast = host.toasts.find(t => t.style !== Toast.Style.Animated && /回收站|失败/.test(t.title))
  assert.equal(toast.style, Toast.Style.Failure)
  assert.match(toast.title, /1 个文件未能移入回收站/)
  assert.match(toast.message, /文件被占用/)

  // 全部失败
  host.ipc.shell_trash_item = async () => {
    throw Object.assign(new Error('拒绝访问'), { code: 'SHELL_ERROR' })
  }
  await cleanAction(view, subItems(view)[0]).props.onAction()
  await tick(20)
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.equal(host.lastToast().title, '清理失败')
  assert.equal(host.toasts.some(t => /清理完成/.test(t.title)), false)
})

test('取消确认不删除任何文件；没有勾选时不弹确认也不调用宿主', async () => {
  const host = createHost()
  installQQHost(host, buildFixture())
  const view = await mount(QQCleanerCommand)
  await waitFor(view, loaded)
  const trashed = []
  host.ipc.shell_trash_item = async ({ fullPath }) => {
    trashed.push(fullPath)
    return { success: true }
  }
  host.setConfirm(false)
  await cleanAction(view, subItems(view)[0]).props.onAction()
  await tick(10)
  assert.deepEqual(trashed, [])

  view.tree().props.subList.onCheckChange(true)
  await tick(5)
  assert.equal(subItems(view).filter(it => it.props.checked === true).length, logic.QQ_FILE_DISPLAY_LIMIT - 1)
  view.tree().props.subList.onCheckChange(false)
  await tick(5)
  assert.equal(subItems(view).filter(it => it.props.checked === true).length, 0)
  const confirmsBefore = host.confirms.length
  await cleanAction(view, subItems(view)[0]).props.onAction()
  await tick(10)
  assert.equal(host.confirms.length, confirmsBefore)
  assert.equal(host.lastToast().title, '没有勾选任何文件')
  assert.deepEqual(trashed, [])
})

test('不在客户端中运行时只显示空状态，不显示示例数据', async () => {
  createHost()
  const saved = globalThis.__ztoolsElectron
  delete globalThis.__ztoolsElectron
  try {
    const view = await mount(QQCleanerCommand)
    const text = view.text()
    assert.match(text, /需要在 ZTools 客户端中使用/)
    assert.doesNotMatch(text, /10086001|Msg3\.0\.db|GB/)
    assert.equal(view.items().length, 1)
  } finally {
    globalThis.__ztoolsElectron = saved
  }
})

test('在资源管理器定位、用默认程序打开失败时提示失败', async () => {
  const host = createHost()
  installQQHost(host, buildFixture())
  const view = await mount(QQCleanerCommand)
  await waitFor(view, loaded)
  const item = subItems(view)[0]
  await view.run(item, '在资源管理器定位')
  assert.equal(host.lastToast().title, '无法在资源管理器中定位')
  await view.run(item, '使用默认程序打开文件')
  assert.equal(host.lastToast().title, '无法打开文件')
})

test('executeQQCleanup：只处理传入路径，空列表、受保护路径与宿主失败都如实返回', async () => {
  const calls = []
  const host = {
    shell_trash_item: async ({ fullPath }) => {
      calls.push(fullPath)
      if (fullPath.endsWith('bad.bin')) return { success: false, error: { code: 'SHELL_ERROR', message: '拒绝访问' } }
      return { success: true }
    }
  }
  const empty = await logic.executeQQCleanup([], [], host)
  assert.equal(empty.ok, false)
  assert.equal(empty.error, '没有勾选任何文件')
  assert.deepEqual(calls, [])

  const mixed = await logic.executeQQCleanup(
    [`${TF}\\1\\Temp\\good.bin`, `${TF}\\1\\Temp\\bad.bin`, `${TF}\\1\\Msg3.0.db`, `${TF}\\1\\nt_qq\\nt_db\\x.dat`],
    [{ path: `${TF}\\1\\Temp\\good.bin`, sizeBytes: 42 }],
    host
  )
  assert.equal(mixed.ok, false)
  assert.equal(mixed.deletedCount, 1)
  assert.equal(mixed.freedBytes, 42)
  assert.equal(mixed.failedCount, 1)
  assert.equal(mixed.skippedProtected, 2)
  assert.match(mixed.error, /1 个文件未能移入回收站：拒绝访问/)
  assert.equal(calls.some(p => /Msg3\.0\.db|nt_db/.test(p)), false)

  const summaryPartial = logic.summarizeQQCleanup(mixed)
  assert.equal(summaryPartial.success, false)
  const ok = await logic.executeQQCleanup([`${TF}\\1\\Temp\\good.bin`], [], host)
  assert.equal(ok.ok, true)
  assert.equal(logic.summarizeQQCleanup(ok).success, true)
})

test('pickDefaultCheckedPaths 与分组默认值：聊天媒体、收藏表情、接收文件、登录会话默认不勾选', () => {
  const rules = logic.OFFICIAL_QQ_GROUP_RULES
  for (const id of [201, 204, 205, 206, 212, 213]) {
    assert.equal(rules.find(r => r.groupId === id).defaultChecked, false, `分组 ${id} 应默认不勾选`)
  }
  assert.equal(logic.FORBIDDEN_REASON.includes('硬件'), false)
  const categories = rules.map(r => ({ groupId: r.groupId, checked: r.defaultChecked }))
  const visible = [
    { path: 'log', groupId: 203, isProtected: false },
    { path: 'video', groupId: 205, isProtected: false },
    { path: 'db', groupId: 999, isProtected: true }
  ]
  assert.deepEqual(logic.pickDefaultCheckedPaths(visible, categories), ['log'])
})

test('classifyQQFilePath：无法识别用途的文件标记为未识别，不默认勾选', () => {
  const unknown = logic.classifyQQFilePath(`${TF}\\10001\\SomeUnknownDir\\keep.bin`)
  assert.equal(unknown.groupId, 202)
  assert.equal(unknown.unrecognized, true)
  const cache = logic.classifyQQFilePath(`${TF}\\10001\\AppWebCache\\a.bin`)
  assert.equal(cache.groupId, 202)
  assert.equal(cache.unrecognized, undefined)
  const categories = logic.OFFICIAL_QQ_GROUP_RULES.map(r => ({ groupId: r.groupId, checked: r.defaultChecked }))
  assert.deepEqual(
    logic.pickDefaultCheckedPaths([{ path: 'u', groupId: 202, isProtected: false, unrecognized: true }], categories),
    []
  )
})
