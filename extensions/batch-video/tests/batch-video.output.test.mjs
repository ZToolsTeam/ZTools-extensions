// 输出路径防覆盖、宿主结果解析、失败如实上报与界面文案的测试（宿主行为按客户端内置媒体处理接口模拟）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setRuntimeLocale } from '@ztools/declarative-ui'

setRuntimeLocale('zh-CN')
const batchVideo = await import('../dist/index.js')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BATCH_TAG = '20261028120000'
const key = p => String(p).replace(/\//g, '\\').toLowerCase()

/**
 * 模拟客户端：
 * - filesystem_file_exists：answer 模式按磁盘答复；deny 模式按输出位置没有读取授权返回失败（客户端实际情况）
 * - dllplugin_call Probe：文件存在时返回文件信息，不存在时返回「宿主内部错误」
 * - 其余 dllplugin_call：与客户端一样以 -y 写 outputPath，失败时删除 outputPath 上的文件（记录被删掉的已有文件）
 * 返回值套上客户端 IPC 信封（{ success, data }），走插件真实的解包逻辑
 */
async function withHost(options, fn) {
  const prevWindow = globalThis.window
  const disk = new Set((options.existing || []).map(key))
  const envelopes = []
  const deletedExisting = []
  const transcodeCalls = []
  const hostResult = record => ({ success: true, data: { ...record, data: { ...record } } })
  const hostError = message => ({ success: false, error: { code: 'INTERNAL_ERROR', message } })

  const methods = {
    filesystem_file_exists: async envelope => {
      envelopes.push({ method: 'filesystem_file_exists', envelope })
      if (options.fileExists === 'answer') {
        return { success: true, data: { success: true, exists: disk.has(key(envelope.params.path)) } }
      }
      return { success: false, error: { code: 'PERMISSION_DENIED', message: '路径未由当前窗口授权' } }
    },
    dllplugin_call: async envelope => {
      envelopes.push({ method: 'dllplugin_call', envelope })
      const { func, params } = envelope.params
      if (func === 'Probe') {
        const target = params.files[0]
        if (!disk.has(key(target))) return hostError('宿主内部错误')
        return hostResult({ ok: true, success: true, items: [{ path: target, sizeBytes: 1 }] })
      }
      transcodeCalls.push({ func, params, timeoutMs: envelope.timeoutMs })
      const outputPath = params.outputPath
      const behavior = options.transcode ? options.transcode({ func, params }) : { ok: true, bytes: 4096 }
      if (behavior.raw) return behavior.raw
      if (behavior.ok) {
        disk.add(key(outputPath))
        const result = { sourcePath: params.files[0], outputPath, engine: 'ffmpeg', sizeBytes: behavior.bytes, outputBytes: behavior.bytes }
        return hostResult({ ok: true, success: true, processedCount: 1, outputPath, sizeBytes: behavior.bytes, outputBytes: behavior.bytes, results: [result], errors: [] })
      }
      if (disk.has(key(outputPath))) {
        disk.delete(key(outputPath))
        deletedExisting.push(outputPath)
      }
      const errors = [{ file: params.files[0], error: behavior.error }]
      return hostResult({ ok: false, success: false, processedCount: 0, outputPath: '', results: [], errors, error: behavior.error })
    },
    shell_show_item_in_folder: async envelope => {
      envelopes.push({ method: 'shell_show_item_in_folder', envelope })
      const allowed = (options.revealAllowed || []).map(key)
      return allowed.includes(key(envelope.params.fullPath))
        ? { success: true, data: { success: true } }
        : { success: false, error: { code: 'PERMISSION_DENIED', message: '路径未由当前窗口授权' } }
    },
    shell_open_path: async envelope => {
      envelopes.push({ method: 'shell_open_path', envelope })
      return { success: true, data: { success: true } }
    },
    ...(options.extraMethods || {})
  }

  globalThis.window = { __ztoolsElectron: { transport: { methods } } }
  try {
    return await fn({ disk, envelopes, deletedExisting, transcodeCalls })
  } finally {
    if (prevWindow === undefined) delete globalThis.window
    else globalThis.window = prevWindow
  }
}

const convertMp4 = { taskId: 'convert-video', format: 'mp4' }

test('输出路径：宿主能答复时依次换名，避开已存在的 <名>_ztools 与 <名>_ztools_2', async () => {
  await withHost(
    { fileExists: 'answer', existing: ['D:\\v\\clip_ztools.mp4', 'D:\\v\\clip_ztools_2.mp4'] },
    async () => {
      const out = await batchVideo.chooseOutputPath('D:\\v\\clip.mov', 'mp4', new Set(), BATCH_TAG)
      assert.equal(out, 'D:\\v\\clip_ztools_3.mp4')
    }
  )
})

test('输出路径：宿主无法确认时改用批次时间标记文件名，且仍避开读得到的已有文件', async () => {
  await withHost(
    {
      fileExists: 'deny',
      existing: ['D:\\v\\clip_ztools.mp4', `D:\\v\\clip_ztools_${BATCH_TAG}.mp4`]
    },
    async () => {
      const out = await batchVideo.chooseOutputPath('D:\\v\\clip.mov', 'mp4', new Set(), BATCH_TAG)
      assert.equal(out, `D:\\v\\clip_ztools_${BATCH_TAG}_2.mp4`)
    }
  )
})

test('输出路径：所有候选名都已存在时拒绝处理该文件，不退回可能覆盖的名称', async () => {
  const existing = [`D:\\v\\clip_ztools_${BATCH_TAG}.mp4`]
  for (let n = 2; n <= 50; n++) existing.push(`D:\\v\\clip_ztools_${BATCH_TAG}_${n}.mp4`)
  await withHost({ fileExists: 'deny', existing }, async ({ transcodeCalls }) => {
    await assert.rejects(
      batchVideo.chooseOutputPath('D:\\v\\clip.mov', 'mp4', new Set(), BATCH_TAG),
      /无法为输出文件生成不重复的文件名/
    )
    const outcome = await batchVideo.processVideoFile({ path: 'D:\\v\\clip.mov' }, convertMp4, new Set(), BATCH_TAG)
    assert.equal(outcome.status, 'failed')
    assert.match(outcome.error, /不重复的文件名/)
    assert.equal(transcodeCalls.length, 0, '找不到安全的输出路径时不能调用宿主')
  })
})

test('同一批次中同名不同扩展名的源文件不会写到同一个输出文件', async () => {
  await withHost({ fileExists: 'answer' }, async ({ transcodeCalls }) => {
    const outcomes = await batchVideo.processVideoBatch(
      [
        { id: 'a', path: 'D:\\v\\talk.mov' },
        { id: 'b', path: 'D:\\v\\talk.mkv' }
      ],
      convertMp4,
      { batchTag: BATCH_TAG }
    )
    assert.deepEqual(
      transcodeCalls.map(c => c.params.outputPath),
      ['D:\\v\\talk_ztools.mp4', 'D:\\v\\talk_ztools_2.mp4']
    )
    assert.equal(outcomes.get('a').status, 'done')
    assert.equal(outcomes.get('b').status, 'done')
  })
})

test('端到端：宿主 ffmpeg 失败时不会删掉用户已有的同名文件，失败如实上报', async () => {
  const userFile = 'D:\\v\\lecture_ztools.mp4'
  await withHost(
    {
      fileExists: 'deny',
      existing: [userFile],
      transcode: () => ({ ok: false, error: 'ffmpeg version 6.1\nlecture.mov: Invalid data found when processing input' })
    },
    async ({ disk, deletedExisting, transcodeCalls }) => {
      const outcome = await batchVideo.processVideoFile(
        { path: 'D:\\v\\lecture.mov' },
        convertMp4,
        new Set(),
        BATCH_TAG
      )
      assert.equal(outcome.status, 'failed')
      assert.match(outcome.error, /Invalid data found when processing input/)
      assert.equal(transcodeCalls.length, 1)
      const call = transcodeCalls[0]
      assert.equal(call.func, 'BatchConvertFormat')
      assert.deepEqual(call.params.files, ['D:\\v\\lecture.mov'])
      assert.equal(call.params.format, 'mp4')
      assert.notEqual(key(call.params.outputPath), key(userFile), '输出路径不能指向已有文件')
      assert.equal(call.params.outputPath, `D:\\v\\lecture_ztools_${BATCH_TAG}.mp4`)
      assert.equal(call.timeoutMs, batchVideo.TRANSCODE_IPC_TIMEOUT_MS, '转码调用必须显式设置长于默认 10 秒的等待时限')
      assert.deepEqual(deletedExisting, [])
      assert.ok(disk.has(key(userFile)), '用户已有文件必须保留')
    }
  )
})

test('成功时只采用宿主返回的真实输出路径与大小', async () => {
  await withHost({ fileExists: 'answer', transcode: () => ({ ok: true, bytes: 7340032 }) }, async () => {
    const outcome = await batchVideo.processVideoFile({ path: 'D:\\v\\clip.mov' }, convertMp4, new Set(), BATCH_TAG)
    assert.deepEqual(outcome, { status: 'done', outputPath: 'D:\\v\\clip_ztools.mp4', outputBytes: 7340032 })
    assert.equal(batchVideo.describeOutcomeTag(outcome), `已输出 ${batchVideo.formatBytes(7340032)}`)
    assert.equal(
      batchVideo.describeOutcomeSubtitle({ parentDir: 'D:\\v', result: outcome }),
      '输出：clip_ztools.mp4'
    )
  })
})

test('宿主返回成功但没有处理结果（例如没收到输入文件）时按失败处理，不当作成功', async () => {
  const emptySuccess = {
    success: true,
    data: { ok: true, success: true, processedCount: 0, outputPath: '', results: [], data: { ok: true, success: true, processedCount: 0, outputPath: '', results: [] } }
  }
  await withHost({ fileExists: 'answer', transcode: () => ({ raw: emptySuccess }) }, async () => {
    const outcome = await batchVideo.processVideoFile({ path: 'D:\\v\\clip.mov' }, convertMp4, new Set(), BATCH_TAG)
    assert.equal(outcome.status, 'failed')
    assert.match(outcome.error, /宿主未返回处理结果/)
  })
  assert.equal(batchVideo.parseHostVideoResult({ results: [{ outputPath: 'D:\\v\\x.mp4', outputBytes: 0 }] }).status, 'failed')
  assert.equal(batchVideo.parseHostVideoResult(null).status, 'failed')
})

test('超时、缺少 ffmpeg、宿主异常的错误整理成可读提示', async () => {
  await withHost(
    { fileExists: 'answer', transcode: () => ({ ok: false, error: 'frame= 1200 fps=20\n命令执行超时（60000 ms）' }) },
    async () => {
      const outcome = await batchVideo.processVideoFile({ path: 'D:\\v\\long.mp4' }, convertMp4, new Set(), BATCH_TAG)
      assert.equal(outcome.status, 'failed')
      assert.match(outcome.error, /60 秒/)
      assert.match(outcome.error, /ffmpeg 命令/)
    }
  )
  await withHost(
    { fileExists: 'answer', transcode: () => ({ ok: false, error: '本机未检测到 ffmpeg，无法执行音视频转码处理' }) },
    async () => {
      const outcome = await batchVideo.processVideoFile({ path: 'D:\\v\\a.mp4' }, convertMp4, new Set(), BATCH_TAG)
      assert.equal(outcome.status, 'failed')
      assert.match(outcome.error, /安装 ffmpeg/)
    }
  )
  await withHost(
    { fileExists: 'answer', transcode: () => ({ raw: { success: false, error: { code: 'REQUEST_TIMEOUT', message: '调用超时' } } }) },
    async () => {
      const outcome = await batchVideo.processVideoFile({ path: 'D:\\v\\a.mp4' }, convertMp4, new Set(), BATCH_TAG)
      assert.equal(outcome.status, 'failed')
      assert.match(outcome.error, /超过宿主限制/)
    }
  )
  await withHost({ fileExists: 'answer', transcode: () => { throw new Error('IPC_BROKEN') } }, async () => {
    const outcome = await batchVideo.processVideoFile({ path: 'D:\\v\\a.mp4' }, convertMp4, new Set(), BATCH_TAG)
    assert.equal(outcome.status, 'failed')
    assert.match(outcome.error, /IPC_BROKEN/)
  })
  const longErr = `${'x'.repeat(500)}`
  assert.ok(batchVideo.summarizeHostError(longErr).length <= 301)
  assert.equal(batchVideo.summarizeHostError(''), '宿主视频处理返回失败')
})

test('提取音频、转 GIF 使用对应的方法与扩展名；任务不支持的格式不调用宿主', async () => {
  await withHost({ fileExists: 'answer' }, async ({ transcodeCalls }) => {
    const audio = await batchVideo.processVideoFile(
      { path: 'D:\\v\\talk.mp4' },
      { taskId: 'extract-audio', format: 'mp3' },
      new Set(),
      BATCH_TAG
    )
    assert.equal(audio.status, 'done')
    const gif = await batchVideo.processVideoFile(
      { path: 'D:\\v\\talk.mp4' },
      { taskId: 'to-gif', format: 'gif' },
      new Set(),
      BATCH_TAG
    )
    assert.equal(gif.status, 'done')
    assert.deepEqual(
      transcodeCalls.map(c => [c.func, c.params.outputPath, c.params.format]),
      [
        ['BatchExtractAudio', 'D:\\v\\talk_ztools.mp3', 'mp3'],
        ['BatchConvertToGif', 'D:\\v\\talk_ztools.gif', 'gif']
      ]
    )

    const bad = await batchVideo.processVideoFile(
      { path: 'D:\\v\\talk.mp4' },
      { taskId: 'convert-video', format: 'gif' },
      new Set(),
      BATCH_TAG
    )
    assert.equal(bad.status, 'failed')
    assert.match(bad.error, /不支持输出格式/)
    assert.equal(transcodeCalls.length, 2)
  })
})

test('批量处理：单个失败不影响其余文件，请求停止后不再开始下一个', async () => {
  let stop = false
  const seen = []
  await withHost(
    {
      fileExists: 'answer',
      transcode: ({ params }) => (params.files[0].endsWith('bad.mov') ? { ok: false, error: 'Conversion failed!' } : { ok: true, bytes: 2048 })
    },
    async ({ transcodeCalls }) => {
      const outcomes = await batchVideo.processVideoBatch(
        [
          { id: '1', path: 'D:\\v\\bad.mov' },
          { id: '2', path: 'D:\\v\\good.mov' },
          { id: '3', path: 'D:\\v\\later.mov' }
        ],
        convertMp4,
        {
          batchTag: BATCH_TAG,
          shouldStop: () => stop,
          onItem: (id, outcome) => {
            seen.push([id, outcome.status])
            if (id === '2') stop = true
          }
        }
      )
      assert.deepEqual(seen, [['1', 'failed'], ['2', 'done']])
      assert.equal(outcomes.has('3'), false)
      assert.equal(transcodeCalls.length, 2)
      const summary = batchVideo.summarizeOutcomes(outcomes.values())
      assert.deepEqual(summary, { total: 2, done: 1, failed: 1, outputBytes: 2048, firstError: 'Conversion failed!' })
    }
  )
})

test('未连接客户端时处理失败，不会报成功', async () => {
  const prevWindow = globalThis.window
  delete globalThis.window
  try {
    const outcome = await batchVideo.processVideoFile({ path: 'D:\\v\\clip.mov' }, convertMp4, new Set(), BATCH_TAG)
    assert.equal(outcome.status, 'failed')
    assert.match(outcome.error, /未连接 ZTools 客户端/)
  } finally {
    if (prevWindow !== undefined) globalThis.window = prevWindow
  }
})

test('导入规则：支持 9 种视频扩展名，排除本插件 _ztools 输出文件、.gif 与系统保护路径', async () => {
  assert.deepEqual(
    [...batchVideo.INPUT_VIDEO_EXTENSIONS],
    ['.mp4', '.mkv', '.mov', '.avi', '.flv', '.webm', '.wmv', '.ts', '.m4v']
  )
  assert.equal(batchVideo.VIDEO_IMPORT_RULES.excludeFile?.('trip_ztools.mp4', 'D:\\v\\trip_ztools.mp4'), true)
  assert.equal(batchVideo.VIDEO_IMPORT_RULES.excludeFile?.(`talk_ztools_${BATCH_TAG}_2.mkv`, `D:\\v\\talk_ztools_${BATCH_TAG}_2.mkv`), true)
  assert.equal(batchVideo.VIDEO_IMPORT_RULES.excludeFile?.('my_ztools_demo.mov', 'D:\\v\\my_ztools_demo.mov'), false)
  assert.equal(batchVideo.VIDEO_IMPORT_RULES.forbiddenPath?.test('C:\\Windows\\System32\\a.mp4'), true)
})

test('等效 ffmpeg 命令带 -n，目标已存在时不覆盖', () => {
  assert.equal(
    batchVideo.buildFfmpegCommand('D:\\v\\clip.mov', 'mp4'),
    'ffmpeg -n -i "D:\\v\\clip.mov" "D:\\v\\clip_ztools.mp4"'
  )
})

test('定位结果：输出文件没有访问授权时改为显示源文件，不会用默认程序打开文件', async () => {
  const file = { path: 'D:\\v\\clip.mov', result: { status: 'done', outputPath: 'D:\\v\\clip_ztools.mp4', outputBytes: 10 } }
  await withHost({ revealAllowed: ['D:\\v\\clip.mov'] }, async ({ envelopes }) => {
    assert.equal(await batchVideo.revealVideoInFolder(file), 'source')
    assert.equal(envelopes.some(e => e.method === 'shell_open_path'), false)
  })
  await withHost({ revealAllowed: ['D:\\v\\clip_ztools.mp4'] }, async () => {
    assert.equal(await batchVideo.revealVideoInFolder(file), 'output')
  })
  await withHost({ revealAllowed: [] }, async () => {
    assert.equal(await batchVideo.revealVideoInFolder(file), 'failed')
  })
})

function collectStrings(node, out = []) {
  if (typeof node === 'string') out.push(node)
  else if (Array.isArray(node)) node.forEach(n => collectStrings(n, out))
  else if (node && typeof node === 'object') Object.values(node).forEach(v => collectStrings(v, out))
  return out
}

test('界面：不显示体积估算与假示例文件，未连接客户端时初始为空并如实提示', () => {
  const prevWindow = globalThis.window
  delete globalThis.window
  try {
    const view = batchVideo.BatchVideoCommand()
    assert.equal(view.type, 'List')
    const text = collectStrings(view).join('\n')
    for (const banned of ['预计', '节省', 'NVENC', 'CRF', 'HEVC', 'GPU', '画幅裁剪', '水印', '倍速', 'Product_Launch_4K']) {
      assert.equal(text.includes(banned), false, `界面不应出现「${banned}」`)
    }
    const props = view.props || {}
    assert.equal(props.subList.items.length, 0)
    assert.match(props.subList.emptyText, /需要在 ZTools 客户端中使用/)
    const fieldIds = (props.workbenchPanel?.fields || []).map(f => f.id)
    assert.deepEqual(fieldIds, ['wb-format', 'wb-codec', 'wb-outdir', 'wb-limit'])
    const formatField = props.workbenchPanel.fields[0]
    assert.deepEqual(formatField.options.map(o => o.value), ['mp4', 'mkv', 'mov', 'webm'])
  } finally {
    if (prevWindow !== undefined) globalThis.window = prevWindow
  }
})

test('清单：标为草稿并写明原因，描述不再声称压缩与调分辨率', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../plugin.json'), 'utf8'))
  assert.equal(manifest.draft, true)
  assert.ok(typeof manifest.draftReason === 'string' && manifest.draftReason.length > 20)
  assert.equal(/压缩|分辨率/.test(manifest.description), false)
  assert.ok(manifest.permissions.includes('dialog'))
})

test('batch-video UI：挂载零扫盘、选择文件/文件夹、拖入文件夹（含回退）、移除清空与处理中防护', async () => {
  const os = await import('node:os')
  const { createHost, installDirectoryHost, mount, tick } = await import('../../shared/test-harness.mjs')
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-batch-video-'))
  const write = (rel, content) => {
    const p = path.join(tmpRoot, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, content)
    return p
  }

  try {
    const clipA = write('clip_a.mp4', 'aaa')
    write('sub/clip_b.mkv', 'bbb')
    write('sub/clip_a_ztools.mp4', 'derived')
    write('sub/anim.gif', 'gif')
    write('readme.txt', 'txt')
    const subDir = path.join(tmpRoot, 'sub')

    const host = createHost()
    await installDirectoryHost(host, { authorized: [tmpRoot] })
    host.ipc.filesystem_get_file_size = async ({ path: p }) => ({
      success: true,
      size: fs.existsSync(p) ? fs.statSync(p).size : 2048000
    })

    const view = await mount(batchVideo.BatchVideoCommand, host)
    await tick(10)

    const banned = new Set([
      'system_get_path',
      'system_list_common_folders',
      'system_search_files',
      'filesystem_get_directory_contents',
      'dllplugin_call'
    ])
    assert.deepEqual(host.ipcCalls.filter(([m]) => banned.has(m)), [])
    assert.equal(view.tree().props.subList.items.length, 0)
    const fbActions = view.tree().props.filterBar.props?.actions ?? view.tree().props.filterBar.actions
    assert.deepEqual(
      fbActions.map(a => ({ id: a.id, label: a.label })),
      [
        { id: 'pick-files', label: '选择文件' },
        { id: 'pick-folder', label: '选择文件夹' }
      ]
    )

    // 选择文件取消 & 报错翻译 & 成功导入（验证 filters 为字符串）
    host.ipc.window_show_open_dialog = async () => ({ canceled: true })
    await fbActions.find(a => a.id === 'pick-files').onAction()
    await tick(10)
    assert.equal(host.toasts.length, 0)

    let openParams = null
    host.ipc.window_show_open_dialog = async params => {
      openParams = params
      return { canceled: false, filePaths: [clipA] }
    }
    await fbActions.find(a => a.id === 'pick-files').onAction()
    await tick(10)
    assert.equal(openParams.filters, '视频文件|mp4;mkv;mov;avi;flv;webm;wmv;ts;m4v')
    assert.deepEqual(view.tree().props.subList.items.map(i => i.props.title), ['clip_a.mp4'])

    // 选择文件夹（整盘确认 + 递归收集 + 排除 _ztools 与 .gif + 去重 clip_a.mp4）
    host.setConfirm(false)
    host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: 'D:\\' })
    await fbActions.find(a => a.id === 'pick-folder').onAction()
    await tick(10)
    assert.equal(host.confirms.length, 1)

    host.setConfirm(true)
    host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: tmpRoot })
    await fbActions.find(a => a.id === 'pick-folder').onAction()
    await tick(15)
    assert.deepEqual(view.tree().props.subList.items.map(i => i.props.title), ['clip_a.mp4', 'clip_b.mkv'])

    // 拖入文件夹（新版带 directories 与去重）
    await view.dropFiles([subDir], { directories: [subDir] })
    await tick(10)
    assert.equal(host.lastToast()?.title, '这些文件已在列表中')

    // 粘贴导入未知大小文件显示「大小未识别」
    host.ipc.filesystem_get_file_size = async () => {
      throw new Error('路径未由当前窗口授权')
    }
    await view.pasteFiles(['D:\\Videos\\pasted.mov'])
    await tick(15)
    const pasted = view.item(it => it.props.title === 'pasted.mov')
    assert.ok(pasted.props.accessories.some(a => a.text === '大小未识别'))

    // 从列表移除不碰磁盘
    await view.run(pasted, '从列表移除')
    assert.equal(view.tree().props.subList.items.length, 2)
    assert.equal(host.ipcCalls.some(([m]) => /trash|delete|unlink/i.test(m)), false)

    // 处理中移除尚未开始的 clip_b.mkv、拒绝清空列表、跳过已移除项不调宿主
    let releaseFirst
    const firstGate = new Promise(r => (releaseFirst = r))
    const dllFiles = []
    host.ipc.filesystem_file_exists = async () => ({ success: true, exists: false })
    host.ipc.dllplugin_call = async ({ params }) => {
      dllFiles.push(params.files[0])
      if (params.files[0] === clipA) await firstGate
      return {
        ok: true,
        success: true,
        processedCount: 1,
        outputPath: params.outputPath,
        outputBytes: 1024,
        results: [{ sourcePath: params.files[0], outputPath: params.outputPath, outputBytes: 1024 }],
        errors: []
      }
    }
    const batchPromise = view.run(view.tree().props.subList.items[0], '开始处理已选视频 (2 个)')
    await tick(5)
    assert.equal(
      view.actions(view.tree().props.subList.items[0]).some(a => a.props.title === '从列表移除'),
      false
    )
    await view.run(view.tree().props.subList.items[1], '清空列表')
    assert.equal(host.lastToast()?.title, '正在处理，完成后再清空')
    await view.run(view.tree().props.subList.items[1], '从列表移除')
    assert.equal(view.tree().props.subList.items.length, 1)
    releaseFirst()
    await batchPromise
    await tick(10)
    assert.deepEqual(dllFiles, [clipA])
    assert.equal(view.tree().props.subList.items.length, 1)

    // 清空列表 + 导入进行中清空丢弃结果
    await view.run(view.tree().props.subList.items[0], '清空列表')
    assert.equal(view.tree().props.subList.items.length, 0)

    let releaseImport
    const importGate = new Promise(r => (releaseImport = r))
    host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: 'D:\\PendingVid' })
    host.ipc.filesystem_get_directory_contents = async () => {
      await importGate
      return { success: true, files: [{ name: 'late.mp4', size: 1024, isDirectory: false }] }
    }
    await view.pasteFiles([clipA])
    await tick(10)
    const toastBefore = host.toasts.length
    const pendingTask = fbActions.find(a => a.id === 'pick-folder').onAction()
    await tick(5)
    await view.run(view.tree().props.subList.items[0], '清空列表')
    releaseImport()
    await pendingTask
    await tick(10)
    assert.equal(view.tree().props.subList.items.length, 0)
    assert.equal(host.toasts.length, toastBefore)
    view.unmount()

    // 旧版客户端 plugin_files_dropped 回退（含文件夹展开）
    const legacyHost = createHost()
    await installDirectoryHost(legacyHost, { authorized: [tmpRoot] })
    legacyHost.ipc.filesystem_directory_exists = async ({ path: p }) => ({
      success: true,
      exists: p.toLowerCase() === subDir.toLowerCase()
    })
    let droppedListener = null
    globalThis.window.__ztoolsDeclarativeFeatures = { fileInput: false }
    globalThis.window.ztools = {
      ...(globalThis.window.ztools || {}),
      events: {
        on(event, cb) {
          if (event === 'plugin_files_dropped') droppedListener = cb
          return () => {
            if (droppedListener === cb) droppedListener = null
          }
        }
      }
    }
    const legacyView = await mount(batchVideo.BatchVideoCommand, legacyHost)
    try {
      assert.equal(typeof droppedListener, 'function')
      droppedListener({ payload: { files: [subDir] } })
      await tick(20)
      assert.deepEqual(legacyView.tree().props.subList.items.map(i => i.props.title), ['clip_b.mkv'])
    } finally {
      legacyView.unmount()
      globalThis.window.__ztoolsDeclarativeFeatures = { fileInput: true }
    }
    assert.equal(droppedListener, null)
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  }
})
