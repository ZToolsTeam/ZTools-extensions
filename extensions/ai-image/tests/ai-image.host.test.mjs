// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout3-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import * as aiImage from '../dist/index.js'

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

test('ai-image: 真实宿主扫描与普通放大，输出信息取自客户端返回，参数如实传递', async () => {
  await withRealElectronWindow(
    {
      system_get_path: ({ name }) => (name === 'pictures' ? 'D:\\RealImages' : ''),
      system_search_files: ({ query }) => {
        if (query === 'dir:D:\\RealImages') {
          return {
            files: [
              { name: 'photo.png', path: 'D:\\RealImages\\Sub\\photo.png', is_dir: false, size: 500000, mtime: 1700000000 },
              { name: 'banner.webp', path: 'D:\\RealImages\\banner.webp', is_dir: false, size: 900000, mtime: 1700000000 },
              { name: 'shot.jpg', path: 'D:\\RealImages\\shot.jpg', is_dir: false, size: 300000, mtime: 1700000000 }
            ]
          }
        }
        return { files: [] }
      },
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
      const queue = await aiImage.fetchAiImageQueue()
      assert.equal(queue.error, undefined)
      assert.deepEqual(
        queue.files.map(f => f.name),
        ['photo.png', 'shot.jpg'],
        '客户端读取不了的 WebP 不进入队列'
      )
      const photo = queue.files[0]
      assert.equal(photo.parentDir, 'D:\\RealImages\\Sub', '输出目录取图片真实所在目录，不是扫描根目录')
      assert.equal(photo.width, 0, '扫描阶段没有分辨率信息，不编造')
      assert.equal(photo.height, 0)
      assert.equal(aiImage.estimateTargetResolution(photo.width, photo.height, '2x'), '未识别')

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
      assert.ok(!calls.some(c => c.channel === 'filesystem_get_file_size'), '不再用其它接口或原图大小补输出大小')
    }
  )
})

test('ai-image: 输出前避开已存在的同名文件，同一批次内也不重名，查询失败时仍用带时间的新文件名', async () => {
  const existing = new Set([`D:\\Img\\photo_2x_${STAMP}.png`])
  const requested = []
  await withRealElectronWindow(
    {
      filesystem_file_exists: ({ path }) => existsReply(existing.has(path)),
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

test('ai-image: 客户端报错或抛错时如实返回失败与原因', async () => {
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

test('ai-image: 部分失败时成功与失败分别列出，不把整批报成成功', async () => {
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
      const unavailable = aiImage.AI_IMAGE_ENGINES.filter(e => !e.available)
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

test('ai-image: 没有客户端时不返回示例图片，也不报假成功', async () => {
  assert.equal(globalThis.window, undefined)
  const queue = await aiImage.fetchAiImageQueue()
  assert.deepEqual(queue.files, [])
  assert.match(queue.error, /HOST_UNAVAILABLE/)

  const res = await aiImage.executeAiImageBatch([makeFile('D:\\Img\\photo.png')], BASIC)
  assert.equal(res.ok, false)
  assert.equal(res.processedCount, 0)
  assert.match(res.error, /HOST_UNAVAILABLE/)
})

test('ai-image: 拿不到任何系统目录时如实报错', async () => {
  await withRealElectronWindow(
    {
      system_get_path: () => {
        throw new Error('NOT_SUPPORTED')
      }
    },
    async () => {
      const queue = await aiImage.fetchAiImageQueue()
      assert.deepEqual(queue.files, [])
      assert.match(queue.error, /SYSTEM_PATH_UNAVAILABLE/)
    }
  )
})

test('ai-image: 输出文件名规则（Windows / POSIX 路径、无扩展名、序号）', () => {
  assert.equal(
    aiImage.buildOutputPath('D:\\A\\b.c.jpg', '4x', 'jpg', STAMP),
    `D:\\A\\b.c_4x_${STAMP}.jpg`
  )
  assert.equal(aiImage.buildOutputPath('/home/u/pic.png', '2x', 'png', STAMP, 2), `/home/u/pic_2x_${STAMP}_3.png`)
  assert.equal(aiImage.buildOutputPath('D:\\A\\noext', '2x', 'png', STAMP), `D:\\A\\noext_2x_${STAMP}.png`)
  assert.equal(aiImage.formatOutputStamp(FIXED_NOW), STAMP)
  assert.equal(aiImage.estimateTargetResolution(1280, 720, '4x'), '5120×2880')
})
