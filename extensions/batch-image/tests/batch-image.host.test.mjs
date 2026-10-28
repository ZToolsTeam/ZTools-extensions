import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as batchImage from '../dist/index.js'

const pluginDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GOV_PRESET = batchImage.IMAGE_WORKSHOP_PRESETS.find((p) => p.id === 'preset-extreme-300k')
const DEFAULT_PRESET = batchImage.IMAGE_WORKSHOP_PRESETS[0]

function settingsOf(preset) {
  return {
    method: preset.method,
    outputFormat: preset.defaultFormat,
    qualityTier: preset.defaultQuality,
    resizePreset: preset.defaultResize,
    grayscale: preset.grayscale,
    sizeLimitBytes: preset.sizeLimitBytes
  }
}

async function withRealElectronWindow(handlers, fn) {
  const prevWindow = globalThis.window
  const calls = []
  const transportMethods = {}

  for (const [channel, impl] of Object.entries(handlers)) {
    transportMethods[channel] = async (envelope) => {
      const actualParams =
        envelope && typeof envelope === 'object' && 'params' in envelope && 'messageId' in envelope
          ? envelope.params
          : envelope
      calls.push({ channel, payload: actualParams })
      return impl(actualParams)
    }
  }

  globalThis.window = {
    __ztoolsElectron: {
      transport: {
        methods: transportMethods
      }
    }
  }

  try {
    return await fn(calls)
  } finally {
    if (prevWindow === undefined) {
      delete globalThis.window
    } else {
      globalThis.window = prevWindow
    }
  }
}

/** 与宿主 BatchImagePlugin 单张成功时的返回结构一致（路由层会再包一层 data） */
function hostSuccess(call, { outputBytes = 120000, originalBytes = 400000, width = 1280, height = 720 } = {}) {
  const record = {
    ok: true,
    success: true,
    processedCount: 1,
    outputPath: call.params.outputPath,
    sizeBytes: outputBytes,
    outputBytes,
    savedBytes: Math.max(0, originalBytes - outputBytes),
    results: [
      {
        sourcePath: call.params.files[0],
        outputPath: call.params.outputPath,
        width,
        height,
        originalBytes,
        sizeBytes: outputBytes,
        outputBytes,
        savedBytes: Math.max(0, originalBytes - outputBytes)
      }
    ],
    errors: []
  }
  return { ...record, data: { ...record } }
}

/** 与宿主单张失败时的返回结构一致 */
function hostFailure(call, message) {
  return {
    ok: false,
    success: false,
    processedCount: 0,
    results: [],
    errors: [{ file: call.params.files[0], error: message }],
    error: message
  }
}

function makeHost({ existing = [], exists = 'answer', process }) {
  const calls = []
  const existingSet = new Set(existing.map((p) => p.toLowerCase()))
  const host = {
    dllplugin_call: async (call) => {
      calls.push(call)
      return process(call, calls.length)
    }
  }
  if (exists === 'answer') {
    host.filesystem_file_exists = async ({ path: p }) => ({ success: true, exists: existingSet.has(p.toLowerCase()) })
  } else if (exists === 'denied') {
    host.filesystem_file_exists = async () => {
      throw Object.assign(new Error('路径未由当前窗口授权'), { code: 'PERMISSION_DENIED' })
    }
  }
  return { host, calls }
}

test('batch-image host integration: 真实扫描过滤非图片与本插件输出件，不估算尺寸与压缩体积', async () => {
  await withRealElectronWindow(
    {
      system_get_path: ({ name }) => {
        if (name === 'pictures') return 'D:\\Media\\Pictures'
        if (name === 'downloads') return 'D:\\Media\\Downloads'
        if (name === 'desktop') return 'D:\\Media\\Desktop'
        return ''
      },
      system_search_files: ({ query }) => {
        if (query === 'dir:D:\\Media\\Pictures') {
          return {
            files: [
              { name: 'readme.txt', path: 'D:\\Media\\Pictures\\readme.txt', is_dir: false, size: 4096, mtime: 1700000000 },
              { name: 'banner_opt.png', path: 'D:\\Media\\Pictures\\banner_opt.png', is_dir: false, size: 120000, mtime: 1700000000 },
              { name: 'banner_opt_2.png', path: 'D:\\Media\\Pictures\\banner_opt_2.png', is_dir: false, size: 110000, mtime: 1700000000 },
              { name: 'banner_opt_20261028120000.jpg', path: 'D:\\Media\\Pictures\\banner_opt_20261028120000.jpg', is_dir: false, size: 90000, mtime: 1700000000 },
              { name: 'zero_byte.png', path: 'D:\\Media\\Pictures\\zero_byte.png', is_dir: false, size: 0, mtime: 1700000000 },
              { name: 'banner_4k.png', path: 'D:\\Media\\Pictures\\banner_4k.png', is_dir: false, size: 2048000, mtime: 1700000000 }
            ]
          }
        }
        return { files: [] }
      }
    },
    async () => {
      const ws = await batchImage.fetchRealImageWorkspace()
      assert.equal(ws.files.length, 1, '应仅保留非 0 字节且不是 *_opt 输出件的图片')
      assert.equal(ws.files[0].name, 'banner_4k.png')
      assert.equal(ws.files[0].sizeBytes, 2048000)
      assert.equal(ws.files[0].extension, '.png')
      assert.equal('dimensionsText' in ws.files[0], false, '扫描阶段读不到尺寸，不能按文件大小编造分辨率')
      assert.equal('estimatedCompressedBytes' in ws.files[0], false, '不再用固定比例估算压缩后体积')
      assert.equal(ws.truncated, false)
    }
  )
})

test('batch-image 扫描：拿不到任何系统目录时如实报错，不当作"找到 0 张"', async () => {
  const host = { system_get_path: async () => '' }
  await assert.rejects(() => batchImage.fetchRealImageWorkspace(host), /无法获取图片、下载、桌面目录/)
})

test('batch-image beyond happy path: 参数异常、路径穿越拦截、损坏 JSON 与宿主故障注入', async () => {
  // 1. 空方法名与非法字符拦截
  await assert.rejects(
    () => batchImage.invokeNativeCapability('', { qualityTier: 'q85' }),
    /INVALID_METHOD/
  )
  await assert.rejects(
    () => batchImage.invokeNativeCapability('BatchCompress;rm -rf', { qualityTier: 'q85' }),
    /INVALID_METHOD_FORMAT/
  )

  // 2. 空值与数组参数拦截
  await assert.rejects(
    () => batchImage.invokeNativeCapability('BatchCompressImage', null),
    /INVALID_PARAMS/
  )
  await assert.rejects(
    () => batchImage.invokeNativeCapability('BatchCompressImage', []),
    /INVALID_PARAMS/
  )

  // 3. 系统受保护路径与路径穿越拦截
  await assert.rejects(
    () =>
      batchImage.invokeNativeCapability('BatchCompressImage', {
        outputDir: 'C:\\Windows\\System32\\drivers'
      }),
    /SECURITY_INTERCEPTED/
  )
  await assert.rejects(
    () =>
      batchImage.invokeNativeCapability('BatchCompressImage', {
        outputDir: 'D:\\Pictures\\..\\..\\Windows\\System32'
      }),
    /SECURITY_INTERCEPTED/
  )

  // 4. 负数与越界极值拦截
  await assert.rejects(
    () => batchImage.invokeNativeCapability('BatchCompressImage', { maxEdge: -100 }),
    /PARAM_OUT_OF_RANGE/
  )
  await assert.rejects(
    () => batchImage.invokeNativeCapability('BatchCompressImage', { path: 'x'.repeat(5000) }),
    /PARAM_TOO_LONG/
  )

  // 5. 宿主 IPC 抛出磁盘满或解码失败时，严禁伪造成功或返回 simulated: true
  await withRealElectronWindow(
    {
      dllplugin_call: () => {
        throw new Error('ENOSPC: 磁盘空间不足，无法写入压缩图片')
      }
    },
    async () => {
      const failRes = await batchImage.invokeNativeCapability('BatchCompressImage', {
        qualityTier: 'q85'
      })
      assert.equal(failRes.ok, false)
      assert.match(String(failRes.error), /ENOSPC/)
      assert.equal(failRes.data?.simulated, undefined)
    }
  )
})

test('batch-image 逐张处理：参数映射到宿主真实取值，输出前避开已存在与同批次重名的文件', async () => {
  const { host, calls } = makeHost({
    existing: ['D:\\Pics\\photo_opt.jpg'],
    process: (call, n) => hostSuccess(call, { outputBytes: n === 1 ? 120000 : 350000, originalBytes: 400000 })
  })
  const files = [
    { id: 'a', path: 'D:\\Pics\\photo.png', sizeBytes: 400000 },
    { id: 'b', path: 'D:\\Pics\\photo.jpg', sizeBytes: 400000 }
  ]
  const seen = []
  const outcomes = await batchImage.processImageBatch(files, settingsOf(GOV_PRESET), {
    hostOverride: host,
    onItem: (id) => seen.push(id)
  })

  assert.deepEqual(seen, ['a', 'b'], '每张完成后回调一次')
  assert.equal(calls.length, 2, '每张图片单独调用一次宿主')
  for (const call of calls) {
    assert.equal(call.plugin, 'BatchImagePlugin')
    assert.equal(call.params.files.length, 1)
    assert.equal(call.params.qualityTier, 'q70', '画质档位必须是宿主识别的 q70 / q85 / q95')
    assert.equal(call.params.resizePreset, 'max1280', '尺寸约束必须是宿主识别的缩放预设')
    assert.equal(call.params.outputFormat, 'jpg')
    assert.equal('stripExif' in call.params, false, '宿主不支持的参数不再发送')
    assert.equal('maxEdge' in call.params, false)
  }
  assert.equal(calls[0].params.outputPath, 'D:\\Pics\\photo_opt_2.jpg', '已存在 photo_opt.jpg 时换名')
  assert.equal(calls[1].params.outputPath, 'D:\\Pics\\photo_opt_3.jpg', '同一批次已分配的名称不再复用')

  const first = outcomes.get('a')
  assert.equal(first.status, 'done')
  assert.equal(first.outputPath, 'D:\\Pics\\photo_opt_2.jpg')
  assert.equal(first.outputBytes, 120000)
  assert.equal(first.overLimitBytes, null)
  assert.equal(batchImage.describeOutcomeTag(first), '已输出 117 KB (-70%)')

  const second = outcomes.get('b')
  assert.equal(second.status, 'done')
  assert.equal(second.overLimitBytes, 300 * 1024, '超过 300KB 的输出必须如实标出')
  assert.equal(batchImage.describeOutcomeTag(second), '超过 300 KB')

  const summary = batchImage.summarizeOutcomes(outcomes.values())
  assert.equal(summary.done, 2)
  assert.equal(summary.failed, 0)
  assert.equal(summary.overLimit, 1)
  assert.equal(summary.outputBytes, 470000)
  assert.equal(summary.savedBytes, 330000)
})

test('batch-image 输出命名：宿主无法确认同名文件时改用带批次时间的名称，绝不使用可能已存在的 _opt 名称', async () => {
  for (const mode of ['denied', 'missing']) {
    const { host, calls } = makeHost({ exists: mode, process: (call) => hostSuccess(call) })
    const outcomes = await batchImage.processImageBatch(
      [
        { id: 'a', path: 'D:\\Pics\\scan.png', sizeBytes: 400000 },
        { id: 'b', path: 'D:\\Pics\\scan.PNG.bak.png', sizeBytes: 400000 }
      ],
      settingsOf(DEFAULT_PRESET),
      { hostOverride: host, batchTag: '20261028120000' }
    )
    assert.equal(calls[0].params.outputPath, 'D:\\Pics\\scan_opt_20261028120000.png', `${mode}: 应使用带时间标记的名称`)
    assert.equal(calls[1].params.outputPath, 'D:\\Pics\\scan.PNG.bak_opt_20261028120000.png')
    assert.equal(calls[0].params.qualityTier, 'q85')
    assert.equal(calls[0].params.resizePreset, 'source')
    assert.equal(calls[0].params.outputFormat, 'keep')
    assert.equal(outcomes.get('a').status, 'done')
  }

  // 同一批次两张图映射到同一个带时间标记的名称时追加序号
  const reserved = new Set()
  const p1 = await batchImage.chooseOutputPath('D:\\x\\a.png', '.jpg', reserved, 'T1', {})
  const p2 = await batchImage.chooseOutputPath('D:\\x\\a.jpg', '.jpg', reserved, 'T1', {})
  assert.equal(p1, 'D:\\x\\a_opt_T1.jpg')
  assert.equal(p2, 'D:\\x\\a_opt_T1_2.jpg')
})

test('batch-image 失败路径：单张失败如实记录并继续处理其余图片，宿主"成功"但无结果时不报成功', async () => {
  const { host, calls } = makeHost({
    process: (call, n) => {
      if (n === 1) return hostFailure(call, '图片编码转换失败: a.webp（GDI+：不支持编码 .webp 格式；ffmpeg：本机未检测到 ffmpeg）')
      if (n === 2) return { ok: true, success: true, processedCount: 1, results: [], errors: [] }
      if (n === 3) return { ok: true, success: true, results: [{ sourcePath: call.params.files[0], outputPath: '', outputBytes: 0 }] }
      if (n === 4) throw new Error('ENOSPC: 磁盘空间不足')
      return hostSuccess(call, { outputBytes: 500000, originalBytes: 500000, width: 0, height: 0 })
    }
  })
  const files = ['a.webp', 'b.png', 'c.png', 'd.png', 'e.png'].map((name, i) => ({
    id: `f${i}`,
    path: `D:\\Pics\\${name}`,
    sizeBytes: 500000
  }))
  const outcomes = await batchImage.processImageBatch(files, settingsOf(DEFAULT_PRESET), { hostOverride: host })
  assert.equal(calls.length, 5, '单张失败不能中断整批')

  const a = outcomes.get('f0')
  assert.equal(a.status, 'failed')
  assert.match(a.error, /本机未检测到 ffmpeg/)
  assert.equal(batchImage.describeOutcomeTag(a), '失败')
  assert.match(batchImage.describeOutcomeDetail(a, 'D:\\Pics'), /^失败原因：.*ffmpeg/)

  assert.equal(outcomes.get('f1').status, 'failed')
  assert.match(outcomes.get('f1').error, /未返回处理结果/)
  assert.equal(outcomes.get('f2').status, 'failed')
  assert.match(outcomes.get('f2').error, /缺少输出文件路径或大小/)
  assert.equal(outcomes.get('f3').status, 'failed')
  assert.match(outcomes.get('f3').error, /ENOSPC/)

  const e = outcomes.get('f4')
  assert.equal(e.status, 'done')
  assert.equal(e.notSmaller, true, '输出不小于原图时标为未变小')
  assert.match(batchImage.describeOutcomeTag(e), /^未变小/)
  assert.match(batchImage.describeOutcomeDetail(e, 'D:\\Pics'), /尺寸未识别/, '宿主读不到尺寸时显示未识别，不填默认分辨率')

  const summary = batchImage.summarizeOutcomes(outcomes.values())
  assert.equal(summary.done, 1)
  assert.equal(summary.failed, 4)
  assert.equal(summary.notSmaller, 1)
  assert.match(summary.firstError, /ffmpeg/)
  assert.equal(summary.savedBytes, 0)
})

test('batch-image 扩展名识别不到时不调用宿主，直接如实失败', async () => {
  const { host, calls } = makeHost({ process: (call) => hostSuccess(call) })
  const outcome = await batchImage.processImageFile(
    { path: 'D:\\Pics\\noext', sizeBytes: 100 },
    settingsOf(DEFAULT_PRESET),
    new Set(),
    'T',
    host
  )
  assert.equal(outcome.status, 'failed')
  assert.match(outcome.error, /无法识别图片扩展名/)
  assert.equal(calls.length, 0)
  assert.equal(batchImage.resolveTargetExtension('D:\\a\\b.JPEG', 'keep'), '.jpeg')
  assert.equal(batchImage.resolveTargetExtension('D:\\a\\b.JPEG', 'png'), '.png')
})

test('batch-image 剪贴板路径解析与文件大小读取：只认绝对路径图片，读不到大小标为 null', async () => {
  const parsed = batchImage.parseClipboardImagePaths(
    '"D:\\Shots\\a.png"\r\nrelative\\b.png\nD:\\Docs\\notes.txt\n  \'E:\\c.JPG\'  \n"D:\\Shots\\a.png"\n/Users/x/d.webp'
  )
  assert.deepEqual(parsed, ['D:\\Shots\\a.png', 'E:\\c.JPG', '/Users/x/d.webp'])
  assert.deepEqual(batchImage.parseClipboardImagePaths(''), [])
  assert.deepEqual(batchImage.parseClipboardImagePaths('hello world'), [])

  assert.equal(await batchImage.readImageFileSize('D:\\a.png', { filesystem_get_file_size: async () => ({ success: true, size: 2048 }) }), 2048)
  assert.equal(await batchImage.readImageFileSize('D:\\a.png', { filesystem_get_file_size: async () => 4096 }), 4096)
  assert.equal(
    await batchImage.readImageFileSize('D:\\a.png', {
      filesystem_get_file_size: async () => {
        throw new Error('路径未由当前窗口授权')
      }
    }),
    null
  )
  assert.equal(await batchImage.readImageFileSize('D:\\a.png', { filesystem_get_file_size: async () => ({ success: true }) }), null)
})

test('batch-image 能力声明：去掉宿主做不到的合并 PDF 与清除 EXIF，界面选项只含宿主支持的取值', () => {
  const methods = batchImage.IMAGE_WORKSHOP_PRESETS.map((p) => p.method)
  assert.equal(methods.includes('MergeImagesToPdf'), false)
  const ids = batchImage.IMAGE_WORKSHOP_PRESETS.map((p) => p.id)
  assert.equal(ids.includes('preset-merge-pdf'), false)
  assert.equal(ids.includes('preset-strip-exif'), false)
  assert.deepEqual(batchImage.FORMAT_OPTIONS.map((o) => o.value), ['keep', 'jpg', 'png'])
  assert.deepEqual(batchImage.QUALITY_OPTIONS.map((o) => o.value).sort(), ['q70', 'q85', 'q95'])
  assert.deepEqual(batchImage.RESIZE_OPTIONS.map((o) => o.value), ['source', 'max1920', 'max1280'])

  const presetText = JSON.stringify(batchImage.IMAGE_WORKSHOP_PRESETS)
  assert.equal(/无损瘦身|视觉无损|EXIF|PDF|去除.*阴影/.test(presetText), false, '方案说明不能保留做不到的说法')

  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'plugin.json'), 'utf8'))
  const codes = manifest.features.map((f) => f.code)
  assert.equal(codes.includes('preset-merge-pdf'), false)
  assert.equal(codes.includes('preset-strip-exif'), false)
  assert.equal(/无损|PDF|隐私|EXIF|HEIC/i.test(manifest.description), false)
  for (const f of manifest.features) {
    assert.equal(/无损|pdf|exif|heic/i.test(`${f.explain} ${f.cmds.join(' ')}`), false, `${f.code} 不能声明做不到的能力`)
  }
  assert.equal(manifest.draft, undefined, '内置插件不能标草稿')
})
