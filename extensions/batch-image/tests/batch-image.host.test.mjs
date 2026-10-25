import test from 'node:test'
import assert from 'node:assert/strict'
import * as batchImage from '../dist/index.js'

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

test('batch-image host integration: 真实扫描过滤非图片与已压缩 _min 派生件，且零负优化防线生效', async () => {
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
              { name: 'already_compressed_min.png', path: 'D:\\Media\\Pictures\\already_compressed_min.png', is_dir: false, size: 120000, mtime: 1700000000 },
              { name: 'zero_byte.png', path: 'D:\\Media\\Pictures\\zero_byte.png', is_dir: false, size: 0, mtime: 1700000000 },
              { name: 'banner_4k.png', path: 'D:\\Media\\Pictures\\banner_4k.png', is_dir: false, size: 2048000, mtime: 1700000000 }
            ]
          }
        }
        return { files: [] }
      },
      dllplugin_call: ({ plugin, func, params }) => {
        return {
          ok: true,
          plugin,
          func,
          processedCount: params.files?.length || 1,
          savedText: '1.2 MB',
          savePercent: 62
        }
      }
    },
    async () => {
      const ws = await batchImage.fetchRealImageWorkspace()
      assert.equal(ws.files.length, 1, '应仅保留真实非 0 字节且非 _min 派生件的图片')
      assert.equal(ws.files[0].name, 'banner_4k.png')
      assert.ok(ws.files[0].estimatedCompressedBytes < ws.files[0].sizeBytes)

      // 零负优化防线：即使传入 >1 的膨胀系数，在 keep + source 下也绝不大于原图体积
      const guarded = batchImage.estimateCompressedBytes(100_000, 1.45, 'keep', 'source')
      assert.equal(guarded, 100_000)

      const res = await batchImage.invokeNativeCapability('BatchCompressImage', {
        files: [ws.files[0].path],
        qualityTier: '85L',
        format: 'keep'
      })
      assert.equal(res.ok, true)
      assert.equal(res.pluginName, 'BatchImagePlugin')
      assert.equal(res.fromFallback, false)
    }
  )
})

test('batch-image beyond happy path: 参数异常、路径穿越拦截、损坏 JSON 与宿主故障注入', async () => {
  // 1. 空方法名与非法字符拦截
  await assert.rejects(
    () => batchImage.invokeNativeCapability('', { qualityTier: '85L' }),
    /INVALID_METHOD/
  )
  await assert.rejects(
    () => batchImage.invokeNativeCapability('BatchCompress;rm -rf', { qualityTier: '85L' }),
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
        qualityTier: '85L'
      })
      assert.equal(failRes.ok, false)
      assert.match(String(failRes.error), /ENOSPC/)
      assert.equal(failRes.data?.simulated, undefined)
    }
  )
})
