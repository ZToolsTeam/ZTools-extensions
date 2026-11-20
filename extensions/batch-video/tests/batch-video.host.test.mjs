// 本插件现行代码的宿主集成测试
import test from 'node:test'
import assert from 'node:assert/strict'
import { setRuntimeLocale } from '@ztools/declarative-ui'

setRuntimeLocale('zh-CN')
const batchVideo = await import('../dist/index.js')

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

test('batch-video 导入规则、selectVideoFiles 过滤串修复与 dllplugin_call 宿主集成', async () => {
  await withRealElectronWindow(
    {
      window_show_open_dialog: () => ({
        canceled: false,
        filePaths: ['D:\\Media\\a.mp4', 'D:\\Media\\a_ztools.mp4', 'D:\\Media\\anim.gif']
      }),
      filesystem_get_file_size: () => ({ success: true, size: 123456 }),
      dllplugin_call: ({ plugin, func, params }) => {
        return { executed: true, plugin, func, inputPath: params.inputPath }
      }
    },
    async calls => {
      const selected = await batchVideo.selectVideoFiles()
      const dialogCall = calls.find(c => c.channel === 'window_show_open_dialog')
      assert.equal(typeof dialogCall.payload.filters, 'string', 'filters 必须是字符串，不能再是对象数组')
      assert.equal(dialogCall.payload.filters, '视频文件|mp4;mkv;mov;avi;flv;webm;wmv;ts;m4v')
      assert.deepEqual(selected.files.map(f => f.name), ['a.mp4'])
      assert.equal(selected.ignored, 2, '应排除 _ztools 派生输出与 .gif 输入')

      const vRes = await batchVideo.invokeNativeCapability('BatchCompressVideo', { crf: 23, inputPath: 'D:\\Media\\a.mp4' })
      assert.equal(vRes.ok, true)
      assert.equal(vRes.fromFallback, false)
      assert.equal(vRes.data.plugin, 'BatchVideoPlugin')
    }
  )

  await withRealElectronWindow(
    {
      dllplugin_call: () => {
        throw new Error('FFMPEG_BINARY_MISSING')
      }
    },
    async () => {
      const vFail = await batchVideo.invokeNativeCapability('BatchCompressVideo', { crf: 23 })
      assert.equal(vFail.ok, false)
      assert.equal(vFail.data?.simulated, undefined)
    }
  )
})
