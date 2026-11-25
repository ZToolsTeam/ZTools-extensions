import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setRuntimeLocale } from '@ztools/declarative-ui'
import {
  adaptPreloadTransport,
  collectFolderFiles,
  createImportInputProps,
  expandInputPaths,
  friendlyFileError,
  isVolumeRoot,
  mergeByPath,
  normalizeExtensions,
  normalizeFileInput,
  pathKey,
  pickFiles,
  pickFolder,
  pickFolderFiles,
  pickFolderWithConfirm,
  runControlledImport,
  summarizeImport
} from '../file-import.ts'

/** 在临时目录建立测试文件树；内容为 '' 表示空文件 */
function makeTree(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-file-import-'))
  for (const [rel, content] of Object.entries(spec)) {
    const full = path.join(root, rel)
    if (rel.endsWith('/')) {
      fs.mkdirSync(full, { recursive: true })
      continue
    }
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return root
}

/** 与宿主一致：列目录返回文件名，符号链接不当作文件夹；可注入故障 */
function makeTransport({ failDirs = [], payloadOverride, extra = {} } = {}) {
  const calls = []
  const transport = async (method, params) => {
    calls.push([method, params])
    if (extra[method]) return extra[method](params)
    if (method === 'filesystem_get_directory_contents') {
      if (failDirs.includes(params.path)) return { ok: false, error: '文件操作权限不足' }
      if (payloadOverride) return { ok: true, data: payloadOverride }
      const files = fs.readdirSync(params.path, { withFileTypes: true }).map((ent) => {
        const st = fs.lstatSync(path.join(params.path, ent.name))
        return { name: ent.name, size: ent.isDirectory() ? 0 : st.size, isDirectory: ent.isDirectory(), lastModified: st.mtime.toISOString() }
      })
      return { ok: true, data: { success: true, files } }
    }
    if (method === 'filesystem_get_file_size') {
      try {
        return { ok: true, data: { success: true, size: fs.statSync(params.path).size } }
      } catch {
        return { ok: false, error: '路径未由当前窗口授权' }
      }
    }
    if (method === 'filesystem_directory_exists') {
      return { ok: true, data: { success: true, exists: fs.existsSync(params.path) && fs.statSync(params.path).isDirectory() } }
    }
    return { ok: false, error: `METHOD_NOT_AVAILABLE: ${method}` }
  }
  return { transport, calls }
}

const rel = (root, files) => files.map((f) => path.relative(root, f.path).split(path.sep).join('/'))

beforeEach(() => {
  setRuntimeLocale('zh-CN')
})

test('选择文件夹递归收集：按扩展名过滤，跳过隐藏、系统、空文件与依赖目录，层级由浅到深且按名称自然排序', async () => {
  const root = makeTree({
    'b.PNG': 'b',
    'a10.jpg': 'a',
    'a2.jpg': 'a',
    'note.txt': 't',
    'empty.png': '',
    '.hidden.png': 'h',
    'desktop.ini': 'x',
    '~$temp.png': 't',
    '2026.11_截图/inner.png': 'i',
    'node_modules/pkg/logo.png': 'n',
    '.git/x.png': 'g'
  })
  const { transport } = makeTransport()
  const result = await collectFolderFiles(transport, root, { extensions: ['png', '.JPG'] })
  assert.equal(result.error, undefined)
  assert.deepEqual(rel(root, result.files), ['a2.jpg', 'a10.jpg', 'b.PNG', '2026.11_截图/inner.png'])
  assert.equal(result.ignored, 5)
  assert.equal(result.truncated, false)
  assert.equal(result.files[0].extension, '.jpg')
  assert.equal(result.files[0].sizeBytes, 1)
  assert.equal(result.files[3].parentDir, path.join(root, '2026.11_截图'))
})

test('maxDepth 为 1 时只取所选文件夹里的直接子文件（批量重命名场景）', async () => {
  const root = makeTree({ 'a.txt': 'a', 'sub/b.txt': 'b' })
  const { transport, calls } = makeTransport()
  const result = await collectFolderFiles(transport, root, { maxDepth: 1 })
  assert.deepEqual(rel(root, result.files), ['a.txt'])
  assert.equal(calls.filter(([m]) => m === 'filesystem_get_directory_contents').length, 1)
})

test('达到文件数或目录数上限时截断并如实标记', async () => {
  const root = makeTree({ '1.txt': '1', '2.txt': '2', '3.txt': '3', 'd1/x.txt': 'x', 'd2/y.txt': 'y' })
  const { transport } = makeTransport()
  const byFiles = await collectFolderFiles(transport, root, { maxFiles: 2 })
  assert.deepEqual(rel(root, byFiles.files), ['1.txt', '2.txt'])
  assert.equal(byFiles.truncated, true)
  const byDirs = await collectFolderFiles(transport, root, { maxVisitedDirs: 1 })
  assert.deepEqual(rel(root, byDirs.files), ['1.txt', '2.txt', '3.txt'])
  assert.equal(byDirs.truncated, true)
})

test('子文件夹读取失败只记录不中断；所选根文件夹读取失败整体报错', async () => {
  const root = makeTree({ 'ok.txt': 'o', 'locked/secret.txt': 's' })
  const locked = path.join(root, 'locked')
  const partial = await collectFolderFiles(makeTransport({ failDirs: [locked] }).transport, root)
  assert.deepEqual(rel(root, partial.files), ['ok.txt'])
  assert.deepEqual(partial.failedDirs.map((d) => d.path), [locked])
  const fatal = await collectFolderFiles(makeTransport({ failDirs: [root] }).transport, root)
  assert.deepEqual(fatal.files, [])
  assert.equal(fatal.error, '文件操作权限不足')
})

test('宿主返回畸形目录内容时如实报错，不当作空文件夹', async () => {
  const root = makeTree({ 'a.txt': 'a' })
  const result = await collectFolderFiles(makeTransport({ payloadOverride: { success: true, files: 'oops' } }).transport, root)
  assert.equal(result.error, '宿主返回的目录内容格式无效')
})

test('受保护根目录直接拒绝，受保护子目录与文件被跳过；空路径报错', async () => {
  const root = makeTree({ 'a.txt': 'a', 'System32/b.txt': 'b' })
  const { transport } = makeTransport()
  const guarded = await collectFolderFiles(transport, root, { forbiddenPath: /System32/i })
  assert.deepEqual(rel(root, guarded.files), ['a.txt'])
  const refused = await collectFolderFiles(transport, path.join(root, 'System32'), { forbiddenPath: /System32/i })
  assert.match(refused.error, /受保护/)
  assert.equal((await collectFolderFiles(transport, '  ')).error, '没有选择文件夹')
})

test('插件排除规则生效（例如跳过本插件生成的输出文件）', async () => {
  const root = makeTree({ 'photo.png': 'p', 'photo_opt.png': 'o' })
  const result = await collectFolderFiles(makeTransport().transport, root, { excludeFile: (name) => /_opt\./.test(name) })
  assert.deepEqual(rel(root, result.files), ['photo.png'])
  assert.equal(result.ignored, 1)
})

test('导入过程中取消：返回 canceled 且不带部分结果', async () => {
  const root = makeTree({ 'a.txt': 'a', 'sub/b.txt': 'b' })
  const controller = new AbortController()
  const result = await collectFolderFiles(makeTransport().transport, root, {}, {
    signal: controller.signal,
    onProgress: () => controller.abort()
  })
  assert.equal(result.canceled, true)
  assert.deepEqual(result.files, [])
})

test('选择文件：按宿主要求的字符串格式传类型过滤，过滤不支持与空文件并读取大小', async () => {
  const root = makeTree({ 'a.png': 'aa', 'b.gif': 'b', 'c.png': '' })
  const picked = [path.join(root, 'a.png'), path.join(root, 'b.gif'), path.join(root, 'c.png')]
  const { transport, calls } = makeTransport({
    extra: { window_show_open_dialog: async () => ({ ok: true, data: { canceled: false, filePaths: picked.map((p) => ({ path: p })) } }) }
  })
  const result = await pickFiles(transport, { extensions: ['.png', 'jpg', 'bad ext'] }, { title: '选择图片', filterName: '图片文件' })
  assert.deepEqual(calls[0], ['window_show_open_dialog', { title: '选择图片', properties: ['openFile', 'multiSelections'], filters: '图片文件|png;jpg' }])
  assert.deepEqual(result.files.map((f) => f.name), ['a.png'])
  assert.equal(result.files[0].sizeBytes, 2)
  assert.equal(result.ignored, 2)
})

test('选择文件：单选结构、取消、宿主令牌超限与没有返回路径都如实处理', async () => {
  const root = makeTree({ 'x.txt': 'x' })
  const single = await pickFiles(makeTransport({ extra: { window_show_open_dialog: async () => ({ ok: true, data: { filePath: path.join(root, 'x.txt') } }) } }).transport, {}, { title: 't', multiple: false })
  assert.deepEqual(single.files.map((f) => f.name), ['x.txt'])
  const canceled = await pickFiles(makeTransport({ extra: { window_show_open_dialog: async () => ({ ok: true, data: { canceled: true } }) } }).transport, {}, { title: 't' })
  assert.equal(canceled.canceled, true)
  const limited = await pickFiles(makeTransport({ extra: { window_show_open_dialog: async () => ({ ok: false, error: '当前窗口的文件 capability 数量超过上限' }) } }).transport, {}, { title: 't' })
  assert.match(limited.error, /改用「选择文件夹」/)
  const empty = await pickFiles(makeTransport({ extra: { window_show_open_dialog: async () => ({ ok: true, data: { canceled: false } }) } }).transport, {}, { title: 't' })
  assert.equal(empty.error, '文件选择框没有返回文件路径')
})

test('选择文件：读不到大小时为 null，不填默认值', async () => {
  const ghost = path.join(os.tmpdir(), 'ztools-file-import-missing', 'ghost.txt')
  const { transport } = makeTransport({ extra: { window_show_open_dialog: async () => ({ ok: true, data: { filePaths: [ghost] } }) } })
  const result = await pickFiles(transport, {}, { title: 't' })
  assert.equal(result.files.length, 1)
  assert.equal(result.files[0].sizeBytes, null)
})

test('选择文件夹只调用 select_folder_dialog（读写授权），不使用只读的 open_dialog', async () => {
  const root = makeTree({ 'a.txt': 'a' })
  const { transport, calls } = makeTransport({
    extra: { window_show_select_folder_dialog: async () => ({ ok: true, data: { canceled: false, folderPath: root } }) }
  })
  const result = await pickFolderFiles(transport, {}, { title: '选择文件夹', defaultPath: 'D:\\docs' })
  assert.deepEqual(calls[0], ['window_show_select_folder_dialog', { title: '选择文件夹', defaultPath: 'D:\\docs' }])
  assert.equal(calls.some(([m]) => m === 'window_show_open_dialog'), false)
  assert.equal(result.folderPath, root)
  assert.deepEqual(rel(root, result.files), ['a.txt'])
})

test('选择文件夹：取消、旧版客户端缺少接口与没有返回路径', async () => {
  const canceled = await pickFolder(makeTransport({ extra: { window_show_select_folder_dialog: async () => ({ ok: true, data: { canceled: true } }) } }).transport, { title: 't' })
  assert.deepEqual(canceled, { canceled: true })
  const outdated = await pickFolder(makeTransport().transport, { title: 't' })
  assert.equal(outdated.error, '当前 ZTools 版本过低，请升级到最新版本后再试')
  const blank = await pickFolderFiles(makeTransport({ extra: { window_show_select_folder_dialog: async () => ({ ok: true, data: {} }) } }).transport, {}, { title: 't' })
  assert.equal(blank.error, '选择文件夹对话框没有返回路径')
})

test('展开拖入路径：使用宿主确认的文件夹列表时不再逐个查询，名称带点的文件夹也能展开', async () => {
  const root = makeTree({ 'v1.2_assets/a.png': 'a', 'single.png': 's', 'readme.md': 'r' })
  const dotted = path.join(root, 'v1.2_assets')
  const { transport, calls } = makeTransport()
  const result = await expandInputPaths(transport, [dotted, path.join(root, 'single.png'), path.join(root, 'readme.md')], { extensions: ['.png'] }, { knownDirectories: [dotted.toUpperCase()] })
  assert.deepEqual(rel(root, result.files), ['v1.2_assets/a.png', 'single.png'])
  assert.equal(result.ignored, 1)
  assert.equal(calls.some(([m]) => m === 'filesystem_directory_exists'), false)
})

test('展开拖入路径：旧版客户端没有文件夹列表时逐个查询；结果去重并遵守总数上限', async () => {
  const root = makeTree({ 'dir/a.txt': 'a', 'dir/b.txt': 'b', 'c.txt': 'c' })
  const dir = path.join(root, 'dir')
  const { transport, calls } = makeTransport()
  const result = await expandInputPaths(transport, [dir, path.join(dir, 'a.txt'), path.join(root, 'c.txt')], { maxFiles: 2 })
  assert.equal(calls.filter(([m]) => m === 'filesystem_directory_exists').length, 3)
  assert.deepEqual(rel(root, result.files), ['dir/a.txt', 'dir/b.txt'])
  assert.equal(result.truncated, true)
})

test('展开拖入路径：文件夹读取失败计入 failedDirs，其余照常导入；空输入返回空结果', async () => {
  const root = makeTree({ 'bad/x.txt': 'x', 'ok.txt': 'o' })
  const bad = path.join(root, 'bad')
  const result = await expandInputPaths(makeTransport({ failDirs: [bad] }).transport, [bad, path.join(root, 'ok.txt')], {}, { knownDirectories: [bad] })
  assert.deepEqual(rel(root, result.files), ['ok.txt'])
  assert.deepEqual(result.failedDirs.map((d) => d.path), [bad])
  const nothing = await expandInputPaths(makeTransport().transport, null)
  assert.deepEqual(nothing.files, [])
})

test('拖入属性：接收文件夹且不把扩展名交给宿主过滤；载荷统一解析', async () => {
  const received = []
  const props = createImportInputProps((input) => { received.push(input) }, { allowClipboardImage: true })
  assert.deepEqual(props.fileInput, { allowClipboardImage: true, allowDirectories: true })
  assert.equal('extensions' in props.fileInput, false)
  await props.onFileInput({ files: ['D:\\a', ' '], directories: ['D:\\a'], source: 'paste', targetFieldId: 'src' })
  await props.onFileInput({ files: [] })
  assert.deepEqual(received, [{ paths: ['D:\\a'], directories: ['D:\\a'], source: 'paste', targetFieldId: 'src' }])
  assert.deepEqual(normalizeFileInput({ payload: { files: [{ path: '/x' }] } }), { paths: ['/x'], source: 'drop' })
  assert.deepEqual(normalizeFileInput(['/y']), { paths: ['/y'], source: 'drop' })
  assert.deepEqual(normalizeFileInput(null), { paths: [], source: 'drop' })
})

test('按路径去重追加：Windows 路径不区分大小写，不改动已有条目', () => {
  const existing = [{ path: 'D:\\Pics\\A.png', result: 'done' }]
  const { merged, added, duplicates } = mergeByPath(existing, [{ path: 'd:/pics/a.png' }, { path: 'D:\\Pics\\b.png' }, { path: 'D:\\Pics\\B.PNG' }], (i) => i.path)
  assert.equal(duplicates, 2)
  assert.deepEqual(added, [{ path: 'D:\\Pics\\b.png' }])
  assert.equal(merged[0], existing[0])
  assert.equal(pathKey('/Users/Me/a.png'), '/Users/Me/a.png')
})

test('导入结果提示覆盖成功、全部重复、没有可导入文件、失败与取消', () => {
  const base = { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: false }
  assert.deepEqual(summarizeImport({ ...base, files: [{}], ignored: 2, truncated: true, failedDirs: [{}] }, { added: 1, duplicates: 1 }), {
    ok: true,
    title: '已添加 1 个文件',
    message: '1 个已在列表中；忽略 2 个不支持的文件；文件较多，只导入了一部分；1 个子文件夹无法读取'
  })
  assert.deepEqual(summarizeImport({ ...base, files: [{}] }, { added: 0, duplicates: 1 }), { ok: false, title: '这些文件已在列表中', message: '1 个已在列表中' })
  assert.deepEqual(summarizeImport({ ...base, ignored: 3 }, { added: 0 }, 'PNG / JPG'), { ok: false, title: '没有找到可导入的文件', message: '支持 PNG / JPG；忽略 3 个不支持的文件' })
  assert.deepEqual(summarizeImport({ ...base, error: '读取失败' }, { added: 0 }), { ok: false, title: '导入失败', message: '读取失败' })
  assert.equal(summarizeImport({ ...base, canceled: true }, { added: 0 }), null)
})

test('错误翻译、整盘判断与扩展名规范化', () => {
  assert.equal(friendlyFileError(new Error('路径未由当前窗口授权')), '文件授权已过期或未授权，请重新选择文件或文件夹')
  assert.equal(friendlyFileError('目录条目超过 10000 上限'), '文件夹内条目超过 10000 个，请选择更具体的子文件夹')
  assert.equal(friendlyFileError(''), '文件操作失败')
  assert.equal(friendlyFileError('磁盘已满'), '磁盘已满')
  assert.equal(isVolumeRoot('D:\\'), true)
  assert.equal(isVolumeRoot('D:'), true)
  assert.equal(isVolumeRoot('/'), true)
  assert.equal(isVolumeRoot('D:\\Pics'), false)
  assert.deepEqual(normalizeExtensions(['PNG', '.jpg', '*.webp', '', 'a b', 'png']), ['.png', '.jpg', '.webp'])
  assert.deepEqual(normalizeExtensions(undefined), [])
})

test('adaptPreloadTransport：解包原始标量与嵌套错误，并转换不支持的方法名', async () => {
  const missing = adaptPreloadTransport(undefined, { notInClientMessage: '仅在客户端中可用' })
  assert.deepEqual(await missing('any', {}), { ok: false, error: '仅在客户端中可用' })

  const adapted = adaptPreloadTransport(async (method) => {
    if (method === 'scalar') return { success: true, data: 128 }
    if (method === 'nested_err') return { success: true, data: { success: false, error: { message: '权限拒绝' } } }
    if (method === 'unsupported') throw new Error('客户端不支持 unsupported')
    return { success: true, data: { folderPath: 'D:\\docs' } }
  }, { notInClientMessage: '仅在客户端中可用' })

  assert.deepEqual(await adapted('scalar', {}), { ok: true, data: 128 })
  assert.deepEqual(await adapted('nested_err', {}), { ok: false, error: '权限拒绝' })
  assert.deepEqual(await adapted('unsupported', {}), { ok: false, error: 'METHOD_NOT_AVAILABLE: unsupported' })
  assert.deepEqual(await adapted('window_show_select_folder_dialog', {}), { ok: true, data: { folderPath: 'D:\\docs' } })
})

test('pickFolderWithConfirm 与 runControlledImport：盘符确认拒绝取消与批次作废', async () => {
  const root = makeTree({ 'a.png': 'a' })
  const { transport } = makeTransport({
    extra: { window_show_select_folder_dialog: async () => ({ ok: true, data: { folderPath: 'D:\\' } }) }
  })
  const denied = await pickFolderWithConfirm(transport, {}, { title: 't', confirmVolume: async () => false })
  assert.equal(denied.canceled, true)

  const hooks = {
    seqRef: { current: 0 },
    abortRef: { current: null },
    importingRef: { current: false },
    unmountedRef: { current: false },
    onStateChange: () => {},
    onError: () => {}
  }
  const stale = await runControlledImport(hooks, async () => {
    hooks.seqRef.current += 1
    return { files: [{ path: path.join(root, 'a.png'), name: 'a.png', parentDir: root, extension: '.png', sizeBytes: 1, lastModifiedMs: null }], ignored: 0, truncated: false, failedDirs: [], canceled: false }
  })
  assert.equal(stale, null)
})

test('i18n en-US: file-import 错误提示、对话框文案与导入汇总实时切换为英文且无中文残留', async () => {
  setRuntimeLocale('en-US')
  try {
    // 1. friendlyFileError 全部分支
    const eCap = friendlyFileError('当前窗口的文件 capability 数量超过上限')
    const eAuth = friendlyFileError(new Error('路径未由当前窗口授权'))
    const eLimit = friendlyFileError('目录条目超过 10000 上限')
    const eOld = friendlyFileError('METHOD_NOT_AVAILABLE: window_show_select_folder_dialog')
    const eFallback = friendlyFileError('')
    for (const msg of [eCap, eAuth, eLimit, eOld, eFallback]) {
      assert.ok(msg.length > 0 && !/[\u4e00-\u9fa5]/.test(msg), `en-US friendlyFileError should not contain CJK: ${msg}`)
    }
    assert.match(eCap, /Select Folder/)
    assert.match(eAuth, /authorization/i)
    assert.match(eLimit, /10,000/)
    assert.match(eOld, /upgrade/i)
    assert.equal(eFallback, 'File operation failed')

    // 2. collectFolderFiles / pickFiles / pickFolder 错误与默认过滤器名称
    const root = makeTree({ 'a.png': 'a', 'System32/b.png': 'b' })
    const { transport } = makeTransport()
    assert.equal((await collectFolderFiles(transport, '  ')).error, 'No folder selected')
    assert.match((await collectFolderFiles(transport, path.join(root, 'System32'), { forbiddenPath: /System32/i })).error, /protected system directory/i)
    assert.equal(
      (await collectFolderFiles(makeTransport({ payloadOverride: { success: true, files: 'oops' } }).transport, root)).error,
      'Host returned an invalid directory listing format'
    )

    const { transport: pickTransport, calls } = makeTransport({
      extra: { window_show_open_dialog: async () => ({ ok: true, data: { canceled: false } }) }
    })
    const emptyPick = await pickFiles(pickTransport, { extensions: ['.png'] }, { title: 'Pick Images' })
    assert.equal(calls[0][1].filters, 'Supported Files|png')
    assert.equal(emptyPick.error, 'File picker dialog returned no file paths')

    const failedFolder = await pickFolder(makeTransport({ extra: { window_show_select_folder_dialog: async () => ({ ok: false }) } }).transport, { title: 'Pick Folder' })
    assert.equal(failedFolder.error, 'Unable to open folder picker dialog')
    const noFolderPath = await pickFolder(makeTransport({ extra: { window_show_select_folder_dialog: async () => ({ ok: true, data: {} }) } }).transport, { title: 'Pick Folder' })
    assert.equal(noFolderPath.error, 'Folder picker dialog returned no folder path')

    // 3. adaptPreloadTransport 英文错误
    const adapted = adaptPreloadTransport(async (method) => {
      if (method === 'bad') return null
      if (method === 'fail') return { success: false, error: {} }
      throw new Error('Client does not support custom_op')
    }, { notInClientMessage: 'Client only' })
    assert.deepEqual(await adapted('bad', {}), { ok: false, error: 'Client returned an invalid result' })
    assert.deepEqual(await adapted('fail', {}), { ok: false, error: 'Client call failed' })
    assert.deepEqual(await adapted('custom_op', {}), { ok: false, error: 'METHOD_NOT_AVAILABLE: custom_op' })

    // 3.5 R7：优先按 errorCode / details.hostCode 分支，且 en-US 下过滤老宿主未识别中文错误
    assert.match(friendlyFileError({ errorCode: 'CAPABILITY_LIMIT_EXCEEDED', error: 'unknown' }), /Select Folder/)
    assert.match(friendlyFileError({ errorDetails: { hostCode: 'PATH_NOT_AUTHORIZED' }, error: 'raw' }), /authorization/i)
    assert.match(friendlyFileError({ errorDetails: { hostCode: 'DIRECTORY_ENTRIES_LIMIT_EXCEEDED' }, error: 'raw' }), /10,000/)
    assert.match(friendlyFileError({ errorCode: 'METHOD_NOT_FOUND', error: 'raw' }), /upgrade/i)
    assert.equal(friendlyFileError({ error: '未知底层中文异常' }, 'Fallback English'), 'Fallback English')

    // 4. summarizeImport 全部场景
    const base = { files: [], ignored: 0, truncated: false, failedDirs: [], canceled: false }
    const sOk = summarizeImport({ ...base, files: [{}], ignored: 2, truncated: true, failedDirs: [{}] }, { added: 3, duplicates: 1 })
    assert.deepEqual(sOk, {
      ok: true,
      title: 'Added 3 files',
      message: '1 already in list; ignored 2 unsupported files; too many files, only partially imported; 1 subfolder could not be read'
    })
    const sDup = summarizeImport({ ...base, files: [{}] }, { added: 0, duplicates: 2 })
    assert.deepEqual(sDup, { ok: false, title: 'These files are already in the list', message: '2 already in list' })
    const sEmpty = summarizeImport({ ...base, ignored: 1 }, { added: 0 }, 'PNG / JPG')
    assert.deepEqual(sEmpty, { ok: false, title: 'No importable files found', message: 'Supports PNG / JPG; ignored 1 unsupported file' })
    const sErr = summarizeImport({ ...base, error: 'Read failed' }, { added: 0 })
    assert.deepEqual(sErr, { ok: false, title: 'Import Failed', message: 'Read failed' })
    for (const s of [sOk, sDup, sEmpty, sErr]) {
      assert.ok(!/[\u4e00-\u9fa5]/.test(`${s.title} ${s.message || ''}`), `en-US summary should not contain CJK: ${JSON.stringify(s)}`)
    }
  } finally {
    setRuntimeLocale('zh-CN')
  }
})
