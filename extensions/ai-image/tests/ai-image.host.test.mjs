import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setRuntimeLocale } from '@ztools/declarative-ui'

setRuntimeLocale('zh-CN')
const aiImage = await import('../dist/index.js')

async function withRealElectronWindow(handlers, fn) {
  const prevWindow = globalThis.window
  const calls = []
  const transportMethods = {}

  for (const [channel, impl] of Object.entries(handlers)) {
    transportMethods[channel] = async envelope => {
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

// 与客户端一致：内置图片处理结果经 dllplugin_call 返回时外层是 { success, data }，结果对象再带一份 data 副本
const hostWrap = record => ({ success: true, data: { ...record, data: { ...record } } })
const existsReply = exists => ({ success: true, data: { success: true, exists } })

function hostSuccess(params, extra = {}) {
  const result = {
    sourcePath: params.inputPath,
    outputPath: params.outputPath,
    width: 2560,
    height: 1440,
    sizeBytes: 1480000,
    outputBytes: 1480000,
    ...extra
  }
  return hostWrap({
    ok: true,
    success: true,
    processedCount: 1,
    outputPath: result.outputPath,
    sizeBytes: result.outputBytes,
    outputBytes: result.outputBytes,
    width: result.width,
    height: result.height,
    results: [result],
    errors: []
  })
}

const FIXED_NOW = new Date(2026, 9, 28, 15, 30, 12)
const STAMP = '20261028-153012'
const BASIC = { engineId: 'basic-upscale', scaleFactor: '2x', outputFormat: 'png' }

function makeFile(filePath, sizeBytes = 500000) {
  const name = filePath.split(/[\\/]/).pop()
  return {
    id: `ai-img-${filePath}`,
    name,
    path: filePath,
    parentDir: filePath.slice(0, filePath.lastIndexOf('\\')),
    extension: name.slice(name.lastIndexOf('.')).toLowerCase(),
    sizeBytes,
    width: 0,
    height: 0
  }
}

test('ai-image: 已移除挂载扫描接口，选择文件使用字符串过滤器并过滤 WebP，然后完成普通放大', async () => {
  assert.equal(aiImage.fetchAiImageQueue, undefined, '应已删除挂载扫描函数 fetchAiImageQueue')

  const pickedPaths = ['D:\\RealImages\\Sub\\photo.png', 'D:\\RealImages\\banner.webp', 'D:\\RealImages\\shot.jpg']
  const sizeMap = {
    'D:\\RealImages\\Sub\\photo.png': 500000,
    'D:\\RealImages\\shot.jpg': 300000
  }

  await withRealElectronWindow(
    {
      window_show_open_dialog: params => {
        assert.equal(params.filters, '图片文件|png;jpg;jpeg;bmp')
        return { success: true, data: { canceled: false, filePaths: pickedPaths } }
      },
      filesystem_get_file_size: ({ path: filePath }) => ({
        success: true,
        data: { success: true, size: sizeMap[filePath] ?? 0 }
      }),
      filesystem_file_exists: () => existsReply(false),
      dllplugin_call: ({ plugin, func, params }) => {
        assert.equal(plugin, 'AiImagePlugin')
        assert.equal(func, 'processImage')
        assert.deepEqual(Object.keys(params).sort(), ['inputPath', 'mode', 'outputFormat', 'outputPath', 'scale'])
        assert.equal(params.mode, 'upscale', '只请求客户端真实提供的普通放大')
        assert.equal(params.scale, 2)
        assert.equal(params.outputFormat, 'png')
        return hostSuccess(params)
      }
    },
    async calls => {
      const importRes = await aiImage.selectAiImageFiles()
      assert.equal(importRes.error, undefined)
      assert.equal(importRes.ignored, 1, 'WebP 在导入阶段即被统一排除')
      assert.deepEqual(
        importRes.files.map(f => f.name),
        ['photo.png', 'shot.jpg']
      )
      const photo = aiImage.importedFileToAiImageItem(importRes.files[0])
      assert.equal(photo.parentDir, 'D:\\RealImages\\Sub', '输出目录取图片真实所在目录')
      assert.equal(photo.width, 0, '导入阶段没有分辨率信息，不编造')
      assert.equal(photo.height, 0)
      assert.equal(aiImage.estimateTargetResolution(photo.width, photo.height, '2x'), '未识别')

      const callsBeforeBatch = calls.length
      const batchRes = await aiImage.executeAiImageBatch([photo], BASIC, undefined, FIXED_NOW)
      assert.equal(batchRes.ok, true)
      assert.equal(batchRes.processedCount, 1)
      assert.equal(batchRes.failedCount, 0)
      assert.equal(batchRes.totalOutputBytes, 1480000)
      assert.deepEqual(batchRes.outputs[0], {
        inputPath: 'D:\\RealImages\\Sub\\photo.png',
        outputPath: `D:\\RealImages\\Sub\\photo_2x_${STAMP}.png`,
        sizeBytes: 1480000,
        width: 2560,
        height: 1440
      })
      assert.ok(
        !calls.slice(callsBeforeBatch).some(c => c.channel === 'filesystem_get_file_size'),
        '处理输出大小直接取自客户端返回'
      )
    }
  )
})

test('ai-image: 文件夹收集与路径展开支持递归、排除输出图与 WebP、带点目录与跳过受保护子目录', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-ai-image-host-'))
  try {
    const dottedDir = path.join(tmpRoot, '2026.11_素材')
    fs.mkdirSync(path.join(dottedDir, 'nested'), { recursive: true })
    fs.mkdirSync(path.join(tmpRoot, 'Windows', 'System32'), { recursive: true })
    fs.writeFileSync(path.join(dottedDir, 'a.png'), 'png')
    fs.writeFileSync(path.join(dottedDir, 'nested', 'b.jpeg'), 'jpg')
    fs.writeFileSync(path.join(dottedDir, 'ignore.webp'), 'webp')
    fs.writeFileSync(path.join(dottedDir, `a_2x_${STAMP}.png`), 'out')
    fs.writeFileSync(path.join(tmpRoot, 'Windows', 'System32', 'sys.png'), 'sys')

    await withRealElectronWindow(
      {
        filesystem_get_directory_contents: ({ path: dir }) => {
          const files = fs.readdirSync(dir, { withFileTypes: true }).map(ent => {
            const st = fs.statSync(path.join(dir, ent.name))
            return { name: ent.name, size: ent.isDirectory() ? 0 : st.size, isDirectory: ent.isDirectory(), lastModified: st.mtime.toISOString() }
          })
          return { success: true, data: { success: true, files } }
        },
        filesystem_directory_exists: ({ path: target }) => ({
          success: true,
          data: { success: true, exists: fs.existsSync(target) && fs.statSync(target).isDirectory() }
        }),
        filesystem_get_file_size: ({ path: filePath }) => ({
          success: true,
          data: { success: true, size: fs.statSync(filePath).size }
        })
      },
      async () => {
        const folderRes = await aiImage.collectAiImageFolderFiles(tmpRoot)
        assert.equal(folderRes.error, undefined)
        assert.deepEqual(
          folderRes.files.map(f => f.name),
          ['a.png', 'b.jpeg']
        )
        assert.equal(folderRes.ignored, 2, '忽略 webp 与本插件生成的输出文件')

        const expandedLegacy = await aiImage.expandAiImageInputPaths([dottedDir])
        assert.deepEqual(
          expandedLegacy.files.map(f => f.name),
          ['a.png', 'b.jpeg']
        )
      }
    )
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  }
})

test('ai-image: 输出前避开已存在的同名文件，同一批次内也不重名，查询失败时仍用带时间的新文件名', async () => {
  const existing = new Set([`D:\\Img\\photo_2x_${STAMP}.png`])
  const requested = []
  await withRealElectronWindow(
    {
      filesystem_file_exists: ({ path: filePath }) => existsReply(existing.has(filePath)),
      dllplugin_call: ({ params }) => {
        requested.push(params.outputPath)
        return hostSuccess(params)
      }
    },
    async () => {
      const res = await aiImage.executeAiImageBatch(
        [makeFile('D:\\Img\\photo.png'), makeFile('D:\\Img\\photo.jpg')],
        BASIC,
        undefined,
        FIXED_NOW
      )
      assert.equal(res.ok, true)
      assert.deepEqual(requested, [`D:\\Img\\photo_2x_${STAMP}_2.png`, `D:\\Img\\photo_2x_${STAMP}_3.png`])
    }
  )

  requested.length = 0
  await withRealElectronWindow(
    {
      filesystem_file_exists: () => {
        throw new Error('PERMISSION_DENIED: 路径未由当前窗口授权')
      },
      dllplugin_call: ({ params }) => {
        requested.push(params.outputPath)
        return hostSuccess(params)
      }
    },
    async () => {
      const res = await aiImage.executeAiImageBatch([makeFile('D:\\Img\\photo.png')], BASIC, undefined, FIXED_NOW)
      assert.equal(res.ok, true)
      assert.deepEqual(requested, [`D:\\Img\\photo_2x_${STAMP}.png`])
      assert.notEqual(requested[0].toLowerCase(), 'd:\\img\\photo.png', '输出路径永远不等于原图')
    }
  )
})

test('ai-image: 同一秒内连续两次处理同一张图片，即使查不到文件是否存在也不复用输出路径', async () => {
  const requested = []
  await withRealElectronWindow(
    {
      dllplugin_call: ({ params }) => {
        requested.push(params.outputPath)
        return hostSuccess(params)
      }
    },
    async () => {
      const file = [makeFile('D:\\Again\\photo.png')]
      assert.equal((await aiImage.executeAiImageBatch(file, BASIC, undefined, FIXED_NOW)).ok, true)
      assert.equal((await aiImage.executeAiImageBatch(file, BASIC, undefined, FIXED_NOW)).ok, true)
      assert.deepEqual(requested, [`D:\\Again\\photo_2x_${STAMP}.png`, `D:\\Again\\photo_2x_${STAMP}_2.png`])
    }
  )
})

test('ai-image: 候选文件名全部已存在时不调用客户端，如实报失败', async () => {
  await withRealElectronWindow(
    {
      filesystem_file_exists: () => existsReply(true),
      dllplugin_call: () => {
        throw new Error('不应调用客户端处理')
      }
    },
    async calls => {
      const res = await aiImage.executeAiImageBatch([makeFile('D:\\Img\\photo.png')], BASIC, undefined, FIXED_NOW)
      assert.equal(res.ok, false)
      assert.equal(res.processedCount, 0)
      assert.equal(res.failedCount, 1)
      assert.match(res.error, /OUTPUT_NAME_UNAVAILABLE/)
      assert.ok(!calls.some(c => c.channel === 'dllplugin_call'))
    }
  )
})

test('ai-image: 客户端报错、授权失效或抛错时如实翻译并汇报失败原因', async () => {
  await withRealElectronWindow(
    {
      dllplugin_call: () => {
        throw new Error('VULKAN_DEVICE_LOST')
      }
    },
    async () => {
      const failRes = await aiImage.executeAiImageBatch([makeFile('D:\\RealImages\\photo.png')], BASIC)
      assert.equal(failRes.ok, false)
      assert.equal(failRes.processedCount, 0)
      assert.equal(failRes.failedCount, 1)
      assert.match(failRes.error, /VULKAN_DEVICE_LOST/)
      assert.deepEqual(failRes.outputs, [])
    }
  )

  await withRealElectronWindow(
    {
      dllplugin_call: () => {
        throw new Error('路径未由当前窗口授权')
      }
    },
    async () => {
      const authRes = await aiImage.executeAiImageBatch([makeFile('D:\\RealImages\\photo.png')], BASIC)
      assert.equal(authRes.ok, false)
      assert.match(authRes.error, /文件授权已过期或未授权/)
    }
  )

  await withRealElectronWindow(
    {
      dllplugin_call: () =>
        hostWrap({
          ok: false,
          success: false,
          processedCount: 0,
          results: [],
          errors: [{ file: 'D:\\RealImages\\photo.png', error: '图像处理失败，不支持直接复制冒充超分结果: photo.png' }],
          error: '图像处理失败，不支持直接复制冒充超分结果: photo.png'
        })
    },
    async () => {
      const failRes = await aiImage.executeAiImageBatch([makeFile('D:\\RealImages\\photo.png')], BASIC)
      assert.equal(failRes.ok, false)
      assert.match(failRes.error, /图像处理失败/)
    }
  )
})

test('ai-image: 部分失败时成功与失败分别列出，shouldProcess 可跳过已移除条目', async () => {
  await withRealElectronWindow(
    {
      filesystem_file_exists: () => existsReply(false),
      dllplugin_call: ({ params }) => {
        if (params.inputPath.endsWith('broken.jpg')) throw new Error('文件已损坏')
        return hostSuccess(params, { outputBytes: 1000, sizeBytes: 1000 })
      }
    },
    async () => {
      const res = await aiImage.executeAiImageBatch(
        [makeFile('D:\\Img\\good.png'), makeFile('D:\\Img\\broken.jpg')],
        BASIC,
        undefined,
        FIXED_NOW
      )
      assert.equal(res.ok, false)
      assert.equal(res.processedCount, 1)
      assert.equal(res.failedCount, 1)
      assert.equal(res.totalOutputBytes, 1000)
      assert.equal(res.failures[0].inputPath, 'D:\\Img\\broken.jpg')
      assert.match(res.failures[0].error, /文件已损坏/)
      assert.match(res.error, /文件已损坏/)

      const skipRes = await aiImage.executeAiImageBatch(
        [makeFile('D:\\Img\\good.png'), makeFile('D:\\Img\\removed.png')],
        BASIC,
        undefined,
        FIXED_NOW,
        { shouldProcess: item => !item.name.startsWith('removed') }
      )
      assert.equal(skipRes.ok, true)
      assert.equal(skipRes.processedCount, 1)
      assert.equal(skipRes.outputs[0].inputPath, 'D:\\Img\\good.png')
    }
  )
})

test('ai-image: 客户端返回成功但没有输出路径或大小时报“无法确认”，不用原图大小冒充', async () => {
  await withRealElectronWindow(
    {
      filesystem_file_exists: () => existsReply(false),
      dllplugin_call: () => hostWrap({ ok: true, success: true })
    },
    async () => {
      const res = await aiImage.executeAiImageBatch([makeFile('D:\\Img\\photo.png', 777777)], BASIC, undefined, FIXED_NOW)
      assert.equal(res.ok, false)
      assert.equal(res.processedCount, 0)
      assert.equal(res.totalOutputBytes, 0)
      assert.match(res.error, /OUTPUT_UNVERIFIED/)
    }
  )
})

test('ai-image: AI 超分 / 去背景 / 人像修复不可用，选择后直接报原因，不调用客户端', async () => {
  await withRealElectronWindow(
    {
      dllplugin_call: () => {
        throw new Error('不应调用客户端处理')
      }
    },
    async calls => {
      const unavailable = aiImage.getAiImageEngines().filter(e => !e.available)
      assert.deepEqual(
        unavailable.map(e => e.id),
        ['ai-super-resolution', 'ai-background-removal', 'ai-face-restoration']
      )
      for (const engine of unavailable) {
        const res = await aiImage.executeAiImageBatch([makeFile('D:\\Img\\photo.png')], { ...BASIC, engineId: engine.id })
        assert.equal(res.ok, false)
        assert.match(res.error, /ENGINE_UNAVAILABLE/)
        assert.ok(res.error.includes(engine.title))
      }
      assert.equal(calls.length, 0, '不可用功能不触达客户端，也不生成文件')
    }
  )
})

test('ai-image: 客户端做不到的倍率、格式、旧引擎标识与不支持的输入格式一律拒绝', async () => {
  await withRealElectronWindow(
    {
      dllplugin_call: () => {
        throw new Error('不应调用客户端处理')
      }
    },
    async calls => {
      const file = [makeFile('D:\\Img\\photo.png')]
      assert.match((await aiImage.executeAiImageBatch(file, { ...BASIC, scaleFactor: '1x' })).error, /INVALID_SCALE/)
      assert.match((await aiImage.executeAiImageBatch(file, { ...BASIC, outputFormat: 'webp' })).error, /INVALID_FORMAT/)
      assert.match(
        (await aiImage.executeAiImageBatch(file, { ...BASIC, engineId: 'realesrgan-x4plus' })).error,
        /UNKNOWN_ENGINE/
      )
      assert.match((await aiImage.executeAiImageBatch([], BASIC)).error, /EMPTY_QUEUE/)
      assert.match((await aiImage.executeAiImageBatch(file, null)).error, /INVALID_CONFIG/)

      const webp = await aiImage.executeAiImageBatch([makeFile('D:\\Img\\banner.webp')], BASIC)
      assert.equal(webp.ok, false)
      assert.match(webp.error, /UNSUPPORTED_INPUT/)
      assert.equal(calls.length, 0)
    }
  )
})

test('ai-image: 受保护路径拦截', async () => {
  const secRes = await aiImage.executeAiImageBatch([makeFile('C:\\Windows\\System32\\cmd.png')], BASIC)
  assert.equal(secRes.ok, false)
  assert.match(secRes.error, /SECURITY_INTERCEPTED/)
  const traversal = await aiImage.executeAiImageBatch([makeFile('D:\\Img\\..\\..\\photo.png')], BASIC)
  assert.match(traversal.error, /SECURITY_INTERCEPTED/)
})

test('ai-image: 没有客户端时如实提示需要在 ZTools 客户端中使用，不返回假数据或假成功', async () => {
  assert.equal(globalThis.window, undefined)
  const pickRes = await aiImage.selectAiImageFiles()
  assert.deepEqual(pickRes.files, [])
  assert.match(pickRes.error, /需要在 ZTools 客户端中使用/)

  const res = await aiImage.executeAiImageBatch([makeFile('D:\\Img\\photo.png')], BASIC)
  assert.equal(res.ok, false)
  assert.equal(res.processedCount, 0)
  assert.match(res.error, /HOST_UNAVAILABLE/)
})

test('ai-image: 输出文件名规则（Windows / POSIX 路径、无扩展名、序号）与输出文件识别', () => {
  assert.equal(
    aiImage.buildOutputPath('D:\\A\\b.c.jpg', '4x', 'jpg', STAMP),
    `D:\\A\\b.c_4x_${STAMP}.jpg`
  )
  assert.equal(aiImage.buildOutputPath('/home/u/pic.png', '2x', 'png', STAMP, 2), `/home/u/pic_2x_${STAMP}_3.png`)
  assert.equal(aiImage.buildOutputPath('D:\\A\\noext', '2x', 'png', STAMP), `D:\\A\\noext_2x_${STAMP}.png`)
  assert.equal(aiImage.formatOutputStamp(FIXED_NOW), STAMP)
  assert.equal(aiImage.estimateTargetResolution(1280, 720, '4x'), '5120×2880')
  assert.equal(aiImage.isAiImageOutputFile(`photo_2x_${STAMP}.png`), true)
  assert.equal(aiImage.isAiImageOutputFile(`photo_4x_${STAMP}_2.jpg`), true)
  assert.equal(aiImage.isAiImageOutputFile('photo_2x.png'), false)
})
