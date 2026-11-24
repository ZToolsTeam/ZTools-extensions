// 本插件现行代码的宿主集成测试（导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import * as pdf from '../dist/index.js'
import { collectFolderFiles, pickFiles } from '../dist/file-import.js'

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

test('pdf host integration: 导出不再包含自动扫盘接口，选择文件/文件夹与真实 dllplugin_call 对接完整', async () => {
  assert.equal(pdf.fetchRealPdfWorkspace, undefined)
  assert.equal(pdf.scanLocalPdfQueue, undefined)
  assert.deepEqual(pdf.INPUT_PDF_EXTENSIONS, ['.pdf'])

  await withRealElectronWindow(
    {
      window_show_open_dialog: () => ({
        canceled: false,
        filePaths: ['D:\\Media\\Docs\\arch.pdf', 'D:\\Media\\Docs\\notes.txt']
      }),
      filesystem_get_file_size: ({ path: p }) => ({
        success: true,
        size: p.endsWith('arch.pdf') ? 640000 : 120
      }),
      filesystem_get_directory_contents: () => ({
        success: true,
        files: [
          { name: 'arch.pdf', size: 640000, isDirectory: false, lastModified: '2026-10-01T00:00:00Z' },
          { name: 'notes.docx', size: 1000, isDirectory: false, lastModified: '2026-10-01T00:00:00Z' }
        ]
      }),
      filesystem_file_exists: () => ({ success: true, exists: false }),
      dllplugin_call: ({ plugin, func, params }) => ({
        ok: true,
        success: true,
        plugin,
        operation: func,
        outputPath: params.outputPath,
        text: 'Hello PDF'
      }),
      shell_open_path: () => ({ success: true }),
      shell_show_item_in_folder: () => ({ success: true })
    },
    async calls => {
      const transport = pdf.createPdfImportTransport()
      const picked = await pickFiles(transport, pdf.PDF_IMPORT_RULES, { title: '选择 PDF 文件', filterName: 'PDF 文件' })
      assert.equal(picked.files.length, 1)
      assert.equal(picked.files[0].name, 'arch.pdf')
      assert.equal(picked.ignored, 1)
      const dialogCall = calls.find(c => c.channel === 'window_show_open_dialog')
      assert.equal(dialogCall.payload.filters, 'PDF 文件|pdf')

      const collected = await collectFolderFiles(transport, 'D:\\Media\\Docs', pdf.PDF_IMPORT_RULES)
      assert.equal(collected.files.length, 1)
      assert.equal(collected.ignored, 1)

      const docItem = pdf.toPdfDocItem(collected.files[0])
      const batch = await pdf.runPdfTool('pdf-to-txt', [docItem])
      assert.equal(batch.succeeded.length, 1)
      assert.equal(batch.succeeded[0].outputPath, 'D:\\Media\\Docs\\arch.txt')

      const pRes = await pdf.invokeNativeCapability('PdfToTxt', {
        inputPath: 'D:\\Media\\Docs\\arch.pdf',
        outputPath: 'D:\\Media\\Docs\\arch.txt'
      })
      assert.equal(pRes.ok, true)
      assert.equal(pRes.fromFallback, false)
      assert.equal(pRes.data.plugin, 'pdf')
      assert.equal(pRes.data.outputPath, 'D:\\Media\\Docs\\arch.txt')

      // 客户端做不到的转换（PDF 转 Word）直接拒绝，不能拿到成功结果，也不请求客户端
      const before = calls.filter(c => c.channel === 'dllplugin_call').length
      const wordRes = await pdf.invokeNativeCapability('PdfToWord', { inputPath: 'D:\\Media\\Docs\\arch.pdf' })
      assert.equal(wordRes.ok, false)
      assert.match(wordRes.error, /UNSUPPORTED/)
      assert.equal(calls.filter(c => c.channel === 'dllplugin_call').length, before)

      assert.equal(await pdf.openPdfDocument('D:\\Media\\Docs\\arch.pdf'), true)
      assert.equal(await pdf.openPdfFileLocation('D:\\Media\\Docs\\arch.txt'), true)
    }
  )

  await withRealElectronWindow(
    {
      dllplugin_call: () => {
        throw new Error('FFMPEG_BINARY_MISSING')
      }
    },
    async () => {
      const pFail = await pdf.invokeNativeCapability('PdfToTxt', { inputPath: 'D:\\Media\\Docs\\arch.pdf' })
      assert.equal(pFail.ok, false)
      assert.match(pFail.error, /FFMPEG_BINARY_MISSING/)
      assert.equal(pFail.data?.simulated, undefined)
    }
  )
})
