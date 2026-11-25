// 本插件现行代码的宿主集成测试
import test from 'node:test'
import assert from 'node:assert/strict'
import { setRuntimeLocale } from '@ztools/declarative-ui'

setRuntimeLocale('zh-CN')
const batchAudio = await import('../dist/index.js')

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

test('batch-audio 对接 dllplugin_call，真实宿主拒绝 simulated:true 与超限合并预检', async () => {
  await withRealElectronWindow(
    {
      dllplugin_call: ({ plugin, func, params }) => {
        return { executed: true, plugin, func, files: params.files }
      }
    },
    async calls => {
      assert.deepEqual(
        [...batchAudio.AUDIO_IMPORT_EXTENSIONS],
        ['.mp3', '.flac', '.wav', '.aac', '.m4a', '.ogg', '.wma', '.opus', '.aiff']
      )
      assert.equal(batchAudio.AUDIO_IMPORT_RULES.forbiddenPath?.test('C:\\Windows\\System32\\a.mp3'), true)

      const aRes = await batchAudio.invokeNativeCapability('BatchLoudnorm', {
        targetI: -16,
        inputPath: 'D:\\Media\\song.flac'
      })
      assert.equal(aRes.ok, true)
      assert.equal(aRes.fromFallback, false)
      assert.equal(aRes.data.plugin, 'BatchAudioPlugin')
      assert.equal(calls.length, 1)
    }
  )

  await withRealElectronWindow(
    {
      dllplugin_call: () => {
        throw new Error('FFMPEG_BINARY_MISSING')
      }
    },
    async () => {
      const aFail = await batchAudio.invokeNativeCapability('BatchLoudnorm', {
        targetI: -16,
        inputPath: 'D:\\Media\\song.flac'
      })
      assert.equal(aFail.ok, false)
      assert.equal(aFail.data?.simulated, undefined)
    }
  )
})

test('batch-audio 合并模式预检：单次最多 100 个文件、总计 2 GiB；未知大小计入数量不计入总量，超限不调用宿主', async () => {
  const GIB = 1024 * 1024 * 1024
  let dllCalled = 0
  const host = {
    dllplugin_call: async () => {
      dllCalled++
      return { ok: true, results: [{ outputPath: 'D:\\Audio\\merged.mp3', sizeBytes: 1024 }] }
    }
  }

  const makeList = (count, sizeBytes) =>
    Array.from({ length: count }, (_, i) => ({
      id: `f-${i}`,
      name: `track_${i}.mp3`,
      path: `D:\\Audio\\track_${i}.mp3`,
      parentDir: 'D:\\Audio',
      extension: '.mp3',
      sizeBytes
    }))

  // 1. 超过 100 个文件（全部未知大小也应拦下，因为未知大小计入数量）
  const over100 = await batchAudio.processAudioSelection('BatchMergeAudio', { format: 'mp3' }, makeList(101, null), host)
  assert.equal(over100.completed, 0)
  assert.equal(over100.errors[0], '合并最多支持 100 个文件、总大小 2 GiB，请减少勾选')
  assert.equal(dllCalled, 0)

  // 2. 总大小超过 2 GiB（2 GiB + 1 B）
  const over2G = await batchAudio.processAudioSelection(
    'BatchMergeAudio',
    { format: 'mp3' },
    [
      { id: '1', name: 'a.wav', path: 'D:\\Audio\\a.wav', parentDir: 'D:\\Audio', extension: '.wav', sizeBytes: GIB },
      { id: '2', name: 'b.wav', path: 'D:\\Audio\\b.wav', parentDir: 'D:\\Audio', extension: '.wav', sizeBytes: GIB + 1 }
    ],
    host
  )
  assert.equal(over2G.completed, 0)
  assert.equal(over2G.errors[0], '合并最多支持 100 个文件、总大小 2 GiB，请减少勾选')
  assert.equal(dllCalled, 0)

  // 3. 恰好 2 GiB + 1 个未知大小（总数 3 <= 100，已知总量 2 GiB <= 2 GiB）：允许调用宿主
  const exact2GPlusUnknown = await batchAudio.processAudioSelection(
    'BatchMergeAudio',
    { format: 'mp3' },
    [
      { id: '1', name: 'a.wav', path: 'D:\\Audio\\a.wav', parentDir: 'D:\\Audio', extension: '.wav', sizeBytes: GIB },
      { id: '2', name: 'b.wav', path: 'D:\\Audio\\b.wav', parentDir: 'D:\\Audio', extension: '.wav', sizeBytes: GIB },
      { id: '3', name: 'c.wav', path: 'D:\\Audio\\c.wav', parentDir: 'D:\\Audio', extension: '.wav', sizeBytes: null }
    ],
    host
  )
  assert.equal(exact2GPlusUnknown.completed, 3)
  assert.equal(dllCalled, 1)

  // 4. 恰好 100 个文件：允许调用宿主
  const exact100 = await batchAudio.processAudioSelection('BatchMergeAudio', { format: 'mp3' }, makeList(100, 1024), host)
  assert.equal(exact100.completed, 100)
  assert.equal(dllCalled, 2)
})
