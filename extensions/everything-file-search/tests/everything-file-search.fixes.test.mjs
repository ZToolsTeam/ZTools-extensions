// macOS 复测问题的集成测试：用真实 @ztools/declarative-ui 运行时渲染 dist/，模拟宿主 IPC，覆盖正常与异常路径
// - 打开 / 定位 / Quick Look 以宿主真实返回为准，失败时不能提示成功（-1、-17）
// - 即时预览读取真实文本 / 图片字节，读取失败如实显示，不冒充二进制、不用 file://（-4、-5）
// - 删除编造内容的详情卡片、全宽列表不再重复信息（-7、-8）
// - ⌘↵ 与动作面板标注一致，删除假的「打开方式」（-9、-16）
// - 不劫持 ⌘⌫ / ⌘C，移入废纸篓需要确认（-10）
// - 快速输入时旧请求不能覆盖新结果（-13）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import * as mod from '../dist/index.js'
import { getFileQuickLook, openFile, revealFile, quickLookFile } from '../dist/search-service.js'

const Command = mod.default
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'efs-fixes-'))
test.after(() => fs.rmSync(root, { recursive: true, force: true }))

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)
function put(name, data) {
  const p = path.join(root, name)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, data)
  return p
}
const notesTxt = put('notes.txt', '第一行 hello\nsecond line\n')
const readmeMd = put('readme.md', '# 标题\n\n- 列表项\n')
const codeTs = put('code.ts', 'export const answer = 42\n')
const imagePng = put('pic.png', PNG_1x1)
const fakeTxt = put('fake.txt', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x11]))
const longTxt = put('long.txt', Array.from({ length: 500 }, (_, i) => `line-${i}`).join('\n'))
// 64KB 边界恰好切在一个 3 字节汉字中间
const cutTxt = put('cut.txt', Buffer.concat([Buffer.alloc(64 * 1024 - 1, 'a'), Buffer.from('中文')]))
const psd = put('art.psd', Buffer.alloc(32, 1))

const rec = (p, extra = {}) => {
  const st = fs.existsSync(p) ? fs.statSync(p) : { size: 10, mtimeMs: Date.now(), isDirectory: () => false }
  return { name: path.basename(p), path: p, isDir: st.isDirectory(), size: st.size, mtime: st.mtimeMs, ...extra }
}

/** 按宿主 FileSystemService.readFileChunk 的真实行为：返回 base64 分块；denied 中的路径抛 PERMISSION_DENIED */
function installChunkReader(host, { denied = [] } = {}) {
  host.ipc.filesystem_read_file_chunk = async ({ path: p, offset, length }) => {
    if (denied.includes(p)) throw Object.assign(new Error('路径未由当前窗口授权'), { code: 'PERMISSION_DENIED' })
    if (!fs.existsSync(p)) throw Object.assign(new Error('文件不存在'), { code: 'FILE_ERROR' })
    const data = fs.readFileSync(p)
    const chunk = data.subarray(offset, offset + Math.min(length, 2 * 1024 * 1024))
    return { success: true, content: chunk.toString('base64'), offset, size: chunk.length, totalSize: data.length }
  }
}

function setupHost(files = [notesTxt, readmeMd, codeTs, imagePng]) {
  const host = createHost()
  host.reset()
  host.ipc.filesearch_query = async () => ({ files: files.map((p) => rec(p)) })
  return host
}

const waitSearch = async (ms = mod.SEARCH_DEBOUNCE_MS + 30) => {
  await new Promise((r) => setTimeout(r, ms))
  await tick(10)
}

async function mountList(host) {
  const view = await mount(Command, host)
  await waitSearch(20)
  return view
}

// ---------------- -1 打开 / 定位 ----------------

test('-1 打开文件：宿主 filesearch_open 返回 success:false 时提示失败并带上真实原因，不再调 shell_open_path', async () => {
  const host = setupHost()
  host.ipc.filesearch_open = async ({ path: p }) => ({ success: false, path: p, error: '文件不存在' })
  const view = await mountList(host)
  const item = view.item(notesTxt)
  await view.run(item, '打开文件')
  const t = host.lastToast()
  assert.equal(t.style, 'FAILURE')
  assert.match(t.title, /打开失败: 文件不存在/)
  assert.deepEqual(host.ipcCalls.filter(([m]) => m === 'filesearch_open').map(([, p]) => p.path), [notesTxt])
  assert.equal(host.ipcCalls.some(([m]) => m === 'shell_open_path'), false)
  view.unmount()
})

test('-1 打开文件：宿主成功时提示成功；宿主抛异常（崩溃）时提示失败', async () => {
  const host = setupHost()
  host.ipc.filesearch_open = async ({ path: p }) => ({ success: true, path: p })
  assert.equal((await openFile(notesTxt)).success, true)
  host.ipc.filesearch_open = async () => {
    throw new Error('service crashed')
  }
  const res = await openFile(notesTxt)
  assert.equal(res.success, false)
  assert.match(res.message, /service crashed/)
  assert.equal((await openFile('')).error, 'INVALID_PATH')
  assert.equal((await openFile('/' + 'a'.repeat(1100))).error, 'PATH_TOO_LONG')
})

test('-1 在 Finder 中定位：以 filesearch_reveal 的真实结果为准（列表与即时预览页一致）', async () => {
  const host = setupHost()
  host.ipc.filesearch_reveal = async ({ path: p }) => ({ success: false, path: p, error: '文件或目录不存在' })
  const view = await mountList(host)
  await view.run(view.item(codeTs), '在 Finder / 资源管理器中定位 (Show in Finder)')
  assert.equal(host.lastToast().style, 'FAILURE')
  assert.match(host.lastToast().title, /文件或目录不存在/)
  host.ipc.filesearch_reveal = async ({ path: p }) => ({ success: true, path: p })
  await view.run(view.item(codeTs), '在 Finder / 资源管理器中定位 (Show in Finder)')
  assert.equal(host.lastToast().style, 'SUCCESS')
  assert.equal(host.ipcCalls.some(([m]) => m === 'shell_show_item_in_folder'), false)
  view.unmount()
  assert.equal((await revealFile('')).success, false)
})

// ---------------- -17 Quick Look ----------------

test('-17 Quick Look：宿主返回失败时显示失败提示（列表与即时预览页），成功时才显示成功', async () => {
  const host = setupHost()
  installChunkReader(host)
  host.ipc.filesearch_sha256 = async () => ({ success: false, error: '文件不存在' })
  host.ipc.filesearch_quick_look = async ({ path: p }) => ({ success: false, path: p, error: '文件不存在' })
  const view = await mountList(host)
  await view.run(view.item(notesTxt), 'Quick Look 快速预览')
  assert.equal(host.lastToast().style, 'FAILURE')
  assert.match(host.lastToast().title, /^快速预览失败: 文件不存在（文件可能已被移动或删除，请重新搜索）$/)

  const detail = await mount(() => mod.FileQuickLookDetailView({ file: rec(notesTxt) }), host)
  await tick(10)
  await detail.run(null, 'Quick Look 快速预览')
  assert.equal(host.lastToast().style, 'FAILURE')
  host.ipc.filesearch_quick_look = async ({ path: p }) => ({ success: true, path: p })
  await detail.run(null, 'Quick Look 快速预览')
  assert.equal(host.lastToast().style, 'SUCCESS')
  detail.unmount()
  view.unmount()

  host.ipc.filesearch_quick_look = async () => {
    throw new Error('qlmanage missing')
  }
  const res = await quickLookFile(notesTxt)
  assert.equal(res.success, false)
  assert.match(res.message, /qlmanage missing/)
})

// ---------------- -4 文本预览 ----------------

test('-4 即时预览：txt / md / ts 读出真实内容（代码带语言标注）', async () => {
  const host = setupHost()
  installChunkReader(host)
  const txt = await getFileQuickLook(rec(notesTxt))
  assert.equal(txt.previewType, 'code')
  assert.match(txt.content, /第一行 hello/)
  const md = await getFileQuickLook(rec(readmeMd))
  assert.equal(md.previewType, 'markdown')
  assert.match(md.content, /# 标题/)
  const ts = await getFileQuickLook(rec(codeTs))
  assert.equal(ts.previewType, 'code')
  assert.equal(ts.codeLanguage, 'typescript')
  assert.match(ts.content, /export const answer = 42/)
  const calls = host.ipcCalls.filter(([m]) => m === 'filesystem_read_file_chunk')
  assert.ok(calls.every(([, p]) => p.offset === 0 && p.length === 64 * 1024), '只读文件头 64KB')
  assert.equal(host.ipcCalls.some(([m]) => m === 'filesystem_read_text_file'), false)

  const detail = await mount(() => mod.FileQuickLookDetailView({ file: rec(codeTs) }), host)
  await tick(10)
  const markdown = detail.tree().props.markdown
  assert.match(markdown, /```typescript\nexport const answer = 42/)
  assert.doesNotMatch(markdown, /二进制/)
  detail.unmount()
})

test('-4 即时预览：超过 200 行或超过 64KB 时截断并标注；64KB 边界切断汉字不出现乱码', async () => {
  const host = setupHost()
  installChunkReader(host)
  const long = await getFileQuickLook(rec(longTxt))
  assert.equal(long.truncated, true)
  assert.equal(long.content.split('\n').length, 200)
  const cut = await getFileQuickLook(rec(cutTxt))
  assert.equal(cut.truncated, true)
  assert.equal(cut.content.includes('�'), false)
})

test('-4 即时预览异常路径：未授权 / 文件已删除 / 返回结构错误 / 非法 base64 都显示读取异常，不冒充二进制', async () => {
  const host = setupHost()
  installChunkReader(host, { denied: [notesTxt] })
  const denied = await getFileQuickLook(rec(notesTxt))
  assert.equal(denied.previewType, 'error')
  assert.match(denied.error, /未由当前窗口授权/)

  const gone = await getFileQuickLook(rec(path.join(root, 'vanished.md'), { size: 12 }))
  assert.equal(gone.previewType, 'error')
  assert.match(gone.error, /文件不存在/)

  host.ipc.filesystem_read_file_chunk = async () => ({ success: true, size: 3 })
  assert.equal((await getFileQuickLook(rec(codeTs))).previewType, 'error')
  host.ipc.filesystem_read_file_chunk = async () => ({ success: true, content: '%%%not-base64%%%', totalSize: 9 })
  const bad = await getFileQuickLook(rec(codeTs))
  assert.equal(bad.previewType, 'error')
  assert.match(bad.error, /base64/)

  // 读取异常时详情页显示「读取异常」，不出现「二进制」
  installChunkReader(host, { denied: [notesTxt] })
  const detail = await mount(() => mod.FileQuickLookDetailView({ file: rec(notesTxt) }), host)
  await tick(10)
  assert.match(detail.tree().props.markdown, /读取异常.*未由当前窗口授权/)
  assert.doesNotMatch(detail.tree().props.markdown, /二进制/)
  detail.unmount()
})

test('-4 即时预览：扩展名是 .txt 但内容含 NUL 字节时按非文本处理', async () => {
  const host = setupHost()
  installChunkReader(host)
  const ql = await getFileQuickLook(rec(fakeTxt))
  assert.equal(ql.previewType, 'binary')
  assert.match(ql.content, /不是文本/)
})

// ---------------- -5 图片预览 ----------------

test('-5 图片即时预览：用宿主读出的真实字节生成 data:image URL，不再使用 file:// 地址', async () => {
  const host = setupHost()
  installChunkReader(host)
  const ql = await getFileQuickLook(rec(imagePng))
  assert.equal(ql.previewType, 'image')
  assert.equal(ql.content, `data:image/png;base64,${PNG_1x1.toString('base64')}`)
  const detail = await mount(() => mod.FileQuickLookDetailView({ file: rec(imagePng) }), host)
  await tick(10)
  const markdown = detail.tree().props.markdown
  assert.ok(markdown.includes(`![图片预览](data:image/png;base64,${PNG_1x1.toString('base64')})`))
  assert.doesNotMatch(markdown, /file:\/\//)
  detail.unmount()
})

test('-5 图片即时预览异常路径：未授权显示读取异常；超过 2MB 或实际比列表记录大时不在应用内预览；psd 不读取', async () => {
  const host = setupHost()
  installChunkReader(host, { denied: [imagePng] })
  const denied = await getFileQuickLook(rec(imagePng))
  assert.equal(denied.previewType, 'error')
  assert.match(denied.error, /未由当前窗口授权/)

  installChunkReader(host)
  host.ipcCalls.length = 0
  const huge = await getFileQuickLook(rec(imagePng, { size: 3 * 1024 * 1024 }))
  assert.equal(huge.previewType, 'binary')
  assert.equal(host.ipcCalls.length, 0, '超限图片不读取')

  // 列表里记录的大小过期：实际文件更大，只读到一块，不能显示半张图片
  host.ipc.filesystem_read_file_chunk = async () => ({ success: true, content: PNG_1x1.toString('base64'), totalSize: 5 * 1024 * 1024 })
  assert.equal((await getFileQuickLook(rec(imagePng))).previewType, 'binary')

  host.ipcCalls.length = 0
  const art = await getFileQuickLook(rec(psd))
  assert.equal(art.previewType, 'binary')
  assert.equal(host.ipcCalls.length, 0)
})

// ---------------- -7 / -8 详情卡片与详情栏 ----------------

test('-7 删除编造「源代码预览」的详情卡片：不再导出 FileDetailView，动作面板没有「查看完整详情卡片」', async () => {
  assert.equal(mod.FileDetailView, undefined)
  const host = setupHost()
  const view = await mountList(host)
  const titles = view.actions(view.item(codeTs)).map((a) => a.props.title)
  assert.equal(titles.includes('查看完整详情卡片'), false)
  assert.doesNotMatch(view.text(), /已建立索引/)
  view.unmount()
})

test('-8 全宽列表：不开右侧详情栏、条目没有 detail，副标题与右侧大小在单行内展示，没有静态说明文案', async () => {
  const host = setupHost()
  const view = await mountList(host)
  const tree = view.tree()
  assert.equal(tree.props.isShowingDetail, false)
  for (const item of view.items()) {
    assert.equal(item.props.detail, undefined)
    assert.ok(item.props.subtitle, '全宽列表显示路径副标题')
    assert.ok(Array.isArray(item.props.accessories) && item.props.accessories[0].text)
  }
  const titles = view.actions(view.item(notesTxt)).map((a) => a.props.title)
  assert.equal(titles.some((t) => /详情分栏/.test(t)), false)
  assert.doesNotMatch(view.text(), /系统关联|NTFS MFT 关联应用/)
  view.unmount()
})

// ---------------- -9 / -16 动作顺序 ----------------

test('-9 / -16 第 2 个动作就是标着 ⌘↵ 的「在 Finder 中定位」；没有假的「打开方式」', async () => {
  assert.equal(mod.openWith, undefined)
  const host = setupHost()
  const view = await mountList(host)
  const acts = view.actions(view.item(notesTxt))
  assert.equal(acts[0].props.title, '打开文件')
  assert.equal(acts[1].props.title, '在 Finder / 资源管理器中定位 (Show in Finder)')
  assert.deepEqual(acts[1].props.shortcut, { modifiers: ['ctrl'], key: 'enter' })
  const enterBound = acts.filter((a) => a.props.shortcut?.key === 'enter')
  assert.equal(enterBound.length, 1, '⌘↵ 只能标在第 2 个动作上')
  assert.equal(acts.some((a) => /Open With|关联打开程序/.test(a.props.title)), false)
  view.unmount()
})

// ---------------- -10 快捷键与确认 ----------------

const isPlain = (sc, key) => sc && sc.key === key && sc.modifiers.length === 1 && ['ctrl', 'cmd'].includes(sc.modifiers[0])

test('-10 不占用 ⌘⌫ / ⌘C 等输入框编辑键（列表与即时预览页）', async () => {
  const host = setupHost()
  installChunkReader(host)
  const view = await mountList(host)
  const acts = view.actions(view.item(notesTxt))
  assert.equal(acts.some((a) => isPlain(a.props.shortcut, 'backspace')), false)
  assert.equal(acts.some((a) => isPlain(a.props.shortcut, 'c')), false)
  const nameAct = acts.find((a) => a.props.title === '复制文件名')
  assert.deepEqual(nameAct.props.shortcut, { modifiers: ['ctrl', 'shift'], key: 'n' })
  // 同一组合键不能绑定到两个动作（以前「Quick Look 快速预览」和「即时预览」都绑了 ⌘Y）
  const combos = acts.filter((a) => a.props.shortcut).map((a) => JSON.stringify(a.props.shortcut))
  assert.equal(new Set(combos).size, combos.length)
  view.unmount()

  const detail = await mount(() => mod.FileQuickLookDetailView({ file: rec(notesTxt) }), host)
  await tick(10)
  const dActs = detail.actions()
  assert.equal(dActs.some((a) => isPlain(a.props.shortcut, 'c')), false)
  detail.unmount()
})

test('-10 移入废纸篓必须确认：取消时不调用宿主；确认后才删除并从列表移除；宿主失败时保留条目并提示失败', async () => {
  const trashMe = put('trash-me.txt', 'x')
  const host = setupHost([trashMe, notesTxt])
  const trashed = []
  host.ipc.shell_trash_item = async ({ fullPath }) => {
    trashed.push(fullPath)
    return { success: true }
  }
  const view = await mountList(host)
  host.setConfirm(false)
  await view.run(view.item(trashMe), '移入回收站 (Move to Trash)')
  assert.equal(host.confirms.length, 1)
  assert.match(host.confirms[0].title, /trash-me\.txt/)
  assert.equal(host.confirms[0].primaryAction.style, 'destructive')
  assert.deepEqual(trashed, [])
  assert.ok(view.items().some((i) => i.props.id === trashMe))

  host.ipc.shell_trash_item = async () => {
    throw Object.assign(new Error('路径未由当前窗口授权'), { code: 'PERMISSION_DENIED' })
  }
  host.setConfirm(true)
  await view.run(view.item(trashMe), '移入回收站 (Move to Trash)')
  assert.equal(host.lastToast().style, 'FAILURE')
  assert.match(host.lastToast().title, /未由当前窗口授权/)
  assert.ok(view.items().some((i) => i.props.id === trashMe))

  host.ipc.shell_trash_item = async ({ fullPath }) => {
    trashed.push(fullPath)
    return { success: true }
  }
  await view.run(view.item(trashMe), '移入回收站 (Move to Trash)')
  assert.deepEqual(trashed, [trashMe])
  assert.equal(host.lastToast().style, 'SUCCESS')
  assert.equal(view.items().some((i) => i.props.id === trashMe), false)
  view.unmount()
})

// ---------------- -13 检索竞态 ----------------

function installTimedSearch(host, delays) {
  host.ipc.filesearch_query = async ({ query }) => {
    await new Promise((r) => setTimeout(r, delays[query] ?? 5))
    return { files: [rec(path.join(root, `hit-${query || 'empty'}.txt`), { size: 1 })] }
  }
}
const queriesSent = (host) => host.ipcCalls.filter(([m]) => m === 'filesearch_query').map(([, p]) => p.query)

test('-13 慢的旧请求晚返回时不覆盖新关键词的结果', async () => {
  const host = createHost()
  host.reset()
  installTimedSearch(host, { d: 400, dtv: 10 })
  const view = await mountList(host)
  await view.search('d')
  await waitSearch() // 防抖结束，d 的请求已发出（400ms 才返回）
  await view.search('dtv')
  await waitSearch(600) // d 与 dtv 都已返回，d 最后返回
  assert.deepEqual(view.items().map((i) => i.props.title), ['hit-dtv.txt'])
  assert.equal(view.tree().props.isLoading, false)
  assert.ok(queriesSent(host).includes('d') && queriesSent(host).includes('dtv'))
  view.unmount()
})

test('-13 连续快速输入只在停顿后检索最后一个关键词；最新请求失败时清空列表并结束加载', async () => {
  const host = createHost()
  host.reset()
  installTimedSearch(host, {})
  const view = await mountList(host)
  host.ipcCalls.length = 0
  for (const q of ['a', 'au', 'aut', 'auth.j']) {
    await view.search(q)
    await new Promise((r) => setTimeout(r, 20))
  }
  assert.equal(view.tree().props.isLoading, true)
  await waitSearch(250)
  assert.deepEqual(queriesSent(host), ['auth.j'])
  assert.deepEqual(view.items().map((i) => i.props.title), ['hit-auth.j.txt'])

  host.ipc.filesearch_query = async () => {
    throw new Error('indexer crashed')
  }
  host.ipc.system_search_files = async () => {
    throw new Error('indexer crashed')
  }
  await view.search('boom')
  await waitSearch(250)
  assert.equal(view.tree().props.isLoading, false)
  assert.equal(view.items().some((i) => i.props.title === 'hit-auth.j.txt'), false)
  view.unmount()
})

test('-13 检索进行中卸载视图不抛错，结果被丢弃', async () => {
  const host = createHost()
  host.reset()
  installTimedSearch(host, { slow: 200 })
  const view = await mountList(host)
  await view.search('slow')
  await waitSearch()
  view.unmount()
  await new Promise((r) => setTimeout(r, 260))
  // 卸载后定时器与在途请求都已作废，不应再发起新的检索
  assert.equal(queriesSent(host).filter((q) => q === 'slow').length, 1)
})

// ---------------- 平台差异、示例数据与未知时间 ----------------

function withPlatform(platform, fn) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { value: { platform }, configurable: true, writable: true })
  return Promise.resolve()
    .then(fn)
    .finally(() => Object.defineProperty(globalThis, 'navigator', saved))
}

test('即时预览与系统快速预览各用各的快捷键（⌘⇧P / ⌘Y）', async () => {
  const host = setupHost()
  const view = await mountList(host)
  await withPlatform('MacIntel', () => {
    const acts = view.actions(view.item(notesTxt))
    assert.deepEqual(acts.find((a) => a.props.title === 'Quick Look 快速预览').props.shortcut, { modifiers: ['ctrl'], key: 'y' })
    assert.deepEqual(acts.find((a) => a.props.title === '即时预览').props.shortcut, { modifiers: ['ctrl', 'shift'], key: 'p' })
  })
  view.unmount()
})

test('Windows 上不提供系统快速预览（宿主只会改为定位），直接调用也报不支持且不调宿主', async () => {
  const host = setupHost()
  installChunkReader(host)
  let called = 0
  host.ipc.filesearch_quick_look = async ({ path: p }) => {
    called++
    return { success: true, path: p }
  }
  await withPlatform('Win32', async () => {
    const view = await mountList(host)
    const titles = view.actions(view.item(notesTxt)).map((a) => a.props.title)
    assert.equal(titles.includes('Quick Look 快速预览'), false)
    assert.ok(titles.includes('即时预览'))
    view.unmount()

    const detail = await mount(() => mod.FileQuickLookDetailView({ file: rec(notesTxt) }), host)
    await tick(10)
    assert.equal(detail.actions().some((a) => a.props.title === 'Quick Look 快速预览'), false)
    detail.unmount()

    const res = await quickLookFile(notesTxt)
    assert.equal(res.success, false)
    assert.equal(res.error, 'QUICK_LOOK_UNSUPPORTED')
  })
  assert.equal(called, 0)
})

test('不在客户端里运行：列表为空并提示「需要在 ZTools 客户端中使用」，不显示示例文件', async () => {
  const host = setupHost()
  const saved = globalThis.__ztoolsElectron
  delete globalThis.__ztoolsElectron
  try {
    const view = await mount(Command, host)
    await waitSearch(20)
    const items = view.items()
    assert.deepEqual(items.map((i) => i.props.id), ['search-error'])
    assert.equal(items[0].props.title, '需要在 ZTools 客户端中使用')
    assert.match(view.tree().props.filterBar.summaryText, /需要在 ZTools 客户端中使用/)
    await view.search('md')
    await waitSearch()
    assert.deepEqual(view.items().map((i) => i.props.id), ['search-error'])
    view.unmount()
  } finally {
    globalThis.__ztoolsElectron = saved
  }
  assert.equal(host.ipcCalls.length, 0)
})

test('宿主没有返回修改时间时显示「未知」，不用当前时间冒充', async () => {
  const host = setupHost()
  host.ipc.filesearch_query = async () => ({ files: [{ name: 'no-time.txt', path: notesTxt, size: 3 }] })
  const files = await mod.searchLocalFiles('no-time')
  assert.equal(files[0].mtime, 0)
  installChunkReader(host)
  host.ipc.filesearch_sha256 = async () => ({ success: false, error: '文件不存在' })
  const detail = await mount(() => mod.FileQuickLookDetailView({ file: files[0] }), host)
  await tick(10)
  assert.match(detail.text(), /"title":"修改时间","text":"未知"/)
  detail.unmount()
})
