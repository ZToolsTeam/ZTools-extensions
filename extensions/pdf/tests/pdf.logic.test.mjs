// PDF 文字导出流程：扫描 → 选不覆盖的输出名 → 调用客户端 → 校验返回 → 汇总提示（含失败路径）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as pdf from '../dist/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function pdfFile(p, sizeBytes = 4096) {
  const parts = pdf.splitFilePath(p)
  return {
    id: `pdf:${p.toLowerCase()}`,
    name: p.split(/[\\/]/).pop(),
    path: p,
    parentDir: parts.dir,
    extension: parts.ext.toLowerCase(),
    docType: parts.ext.toLowerCase() === '.pdf' ? 'pdf' : 'other',
    sizeBytes
  }
}

/** 测试宿主：按方法名提供实现（与 callHostTransport 的 hostOverride 约定一致），记录全部调用 */
function makeHost({ existing = [], exists, dll } = {}) {
  const calls = []
  const existingSet = new Set(existing.map(p => p.toLowerCase()))
  const host = {
    filesystem_file_exists: async params => {
      calls.push(['filesystem_file_exists', params])
      if (exists) return exists(params)
      return { success: true, exists: existingSet.has(params.path.toLowerCase()) }
    },
    dllplugin_call: async params => {
      calls.push(['dllplugin_call', params])
      if (dll) return dll(params)
      const record = {
        ok: true,
        success: true,
        operation: params.func,
        outputPath: params.params.outputPath,
        text: 'Quarterly report\nRevenue grew'
      }
      // 与客户端路由返回结构一致：结果外再套一层 data
      return { success: true, data: { ...record, data: { ...record } } }
    }
  }
  return { host, calls, dllCalls: () => calls.filter(c => c[0] === 'dllplugin_call') }
}

test('路径拆分与输出候选名：Windows / POSIX / 根目录，不能推导时返回 null', () => {
  assert.deepEqual(pdf.splitFilePath('D:\\Docs\\sub\\Report.PDF'), {
    dirWithSep: 'D:\\Docs\\sub\\',
    dir: 'D:\\Docs\\sub',
    stem: 'Report',
    ext: '.PDF'
  })
  assert.equal(pdf.splitFilePath('C:\\a.pdf').dir, 'C:\\')
  assert.equal(pdf.splitFilePath('/a.pdf').dir, '/')
  assert.equal(pdf.splitFilePath('/home/u/Docs/a.b.pdf').stem, 'a.b')
  assert.equal(pdf.splitFilePath('no-separator.pdf'), null)
  assert.equal(pdf.splitFilePath('D:\\Docs\\'), null)
  assert.equal(pdf.splitFilePath(undefined), null)

  assert.equal(pdf.buildOutputCandidate('D:\\Docs\\a.pdf', '.txt', 0), 'D:\\Docs\\a.txt')
  assert.equal(pdf.buildOutputCandidate('D:\\Docs\\a.pdf', '.txt', 3), 'D:\\Docs\\a (3).txt')
  assert.equal(pdf.buildOutputCandidate('/home/u/a.pdf', '.html', 1), '/home/u/a (1).html')
  assert.equal(pdf.buildOutputCandidate('a.pdf', '.txt', 0), null)
})

test('乱码判定：控制字符占比过高才算乱码，空白内容字符数为 0', () => {
  assert.deepEqual(pdf.assessExtractedText('Hello World'), { chars: 10, garbled: false })
  assert.deepEqual(pdf.assessExtractedText('  \n\t '), { chars: 0, garbled: false })
  assert.deepEqual(pdf.assessExtractedText(undefined), { chars: 0, garbled: false })
  // 双字节字形编号按单字节解出时充满 \u0000 一类控制字符
  assert.equal(pdf.assessExtractedText('\u0000\u0024\u0000\u0031\u0000\u0042AB').garbled, true)
  assert.equal(pdf.assessExtractedText('Café résumé naïve').garbled, false)
  // 解码失败留下的替换字符同样算乱码
  assert.equal(pdf.assessExtractedText(`${String.fromCharCode(0xfffd).repeat(3)}ab`).garbled, true)
})

test('工具清单：界面只给出客户端能如实完成的文字导出；其余工具标为不可用并写明原因', () => {
  const available = pdf.getAvailableTools()
  assert.deepEqual(available.map(t => t.method), ['PdfToTxt', 'PdfToHtml'])
  const unsupported = pdf.getCapabilityItems().filter(t => !t.supported)
  for (const method of ['PdfToWord', 'PdfToExcel', 'PdfToPpt', 'PdfToImage', 'WordToPdf', 'ExcelToPdf', 'ImageToPdf', 'MergePdf', 'SplitPdf', 'CompressPdf']) {
    const tool = unsupported.find(t => t.method === method)
    assert.ok(tool, `${method} 应标为不可用`)
    assert.ok(tool.unsupportedReason && tool.unsupportedReason.length > 4)
  }
  // 宣传性的说法不能再出现在工具文案里
  const text = JSON.stringify(pdf.getCapabilityItems())
  assert.doesNotMatch(text, /无损|300DPI|精准保留|PRD\s*\d|缩减 40%/)
})

test('不可用或未知的方法：直接返回失败，不请求客户端', async () => {
  const { host, calls } = makeHost()
  for (const method of ['MergePdf', 'SplitPdf', 'CompressPdf', 'PdfToWord', 'PdfToImage', 'WordToPdf', 'ImageToPdf']) {
    const res = await pdf.invokeNativeCapability(method, { inputPath: 'D:\\Docs\\a.pdf' }, host)
    assert.equal(res.ok, false, method)
    assert.match(res.error, /^UNSUPPORTED: /)
  }
  const unknown = await pdf.invokeNativeCapability('InspectPdf', { inputPath: 'D:\\Docs\\a.pdf' }, host)
  assert.equal(unknown.ok, false)
  assert.match(unknown.error, /UNSUPPORTED_METHOD/)
  assert.equal(calls.length, 0)
  await assert.rejects(() => pdf.invokeNativeCapability('PdfToTxt', null, host), /INVALID_PARAMS/)
})

test('导出成功：输出写在 PDF 所在目录，发送给客户端的插件名为 pdf，带输出路径与源路径', async () => {
  const { host, dllCalls } = makeHost()
  const file = pdfFile('D:\\Docs\\sub\\Report.pdf')
  const result = await pdf.runPdfTool('pdf-to-txt', [file], host)
  assert.equal(result.error, undefined)
  assert.equal(result.failed.length, 0)
  assert.equal(result.succeeded.length, 1)
  assert.equal(result.succeeded[0].outputPath, 'D:\\Docs\\sub\\Report.txt')
  assert.equal(result.succeeded[0].chars, 'QuarterlyreportRevenuegrew'.length)
  const [, payload] = dllCalls()[0]
  assert.equal(payload.plugin, 'pdf')
  assert.equal(payload.func, 'PdfToTxt')
  assert.deepEqual(payload.params, { inputPath: 'D:\\Docs\\sub\\Report.pdf', outputPath: 'D:\\Docs\\sub\\Report.txt' })

  const summary = pdf.describeBatchResult(result)
  assert.equal(summary.ok, true)
  assert.equal(summary.title, '已导出 1 个文件')
  assert.equal(summary.message, 'D:\\Docs\\sub\\Report.txt')

  const html = await pdf.runPdfTool('pdf-to-html', [file], host)
  assert.equal(html.succeeded[0].outputPath, 'D:\\Docs\\sub\\Report.html')
})

test('同名文件已存在：依次加序号，绝不把已有文件路径交给客户端', async () => {
  const { host, dllCalls } = makeHost({ existing: ['D:\\Docs\\Report.txt', 'D:\\Docs\\Report (1).txt'] })
  const result = await pdf.runPdfTool('pdf-to-txt', [pdfFile('D:\\Docs\\Report.pdf')], host)
  assert.equal(result.succeeded[0].outputPath, 'D:\\Docs\\Report (2).txt')
  assert.equal(dllCalls()[0][1].params.outputPath, 'D:\\Docs\\Report (2).txt')
})

test('同名序号用尽：停止导出并说明原因', async () => {
  const { host, calls, dllCalls } = makeHost({ exists: () => ({ success: true, exists: true }) })
  const result = await pdf.runPdfTool('pdf-to-txt', [pdfFile('D:\\Docs\\Report.pdf')], host)
  assert.equal(result.succeeded.length, 0)
  assert.match(result.failed[0].error, /OUTPUT_NAME_EXHAUSTED/)
  assert.equal(calls.filter(c => c[0] === 'filesystem_file_exists').length, pdf.MAX_OUTPUT_NAME_ATTEMPTS)
  assert.equal(dllCalls().length, 0)
})

test('无法确认输出文件是否存在（查询报错 / 返回结构异常）：停止导出，不调用客户端写文件', async () => {
  const thrown = makeHost({
    exists: () => {
      throw new Error('PERMISSION_DENIED: 路径未授权')
    }
  })
  const r1 = await pdf.runPdfTool('pdf-to-txt', [pdfFile('D:\\Docs\\a.pdf')], thrown.host)
  assert.match(r1.failed[0].error, /OUTPUT_CHECK_FAILED.*PERMISSION_DENIED/)
  assert.equal(thrown.dllCalls().length, 0)

  const failed = makeHost({ exists: () => ({ success: false, error: { code: 'FILE_ERROR', message: '磁盘不可读' } }) })
  const r2 = await pdf.runPdfTool('pdf-to-txt', [pdfFile('D:\\Docs\\a.pdf')], failed.host)
  assert.match(r2.failed[0].error, /OUTPUT_CHECK_FAILED.*磁盘不可读/)
  assert.equal(failed.dllCalls().length, 0)

  const malformed = makeHost({ exists: () => ({ success: true }) })
  const r3 = await pdf.runPdfTool('pdf-to-txt', [pdfFile('D:\\Docs\\a.pdf')], malformed.host)
  assert.match(r3.failed[0].error, /MALFORMED_EXISTS_RESPONSE/)
  assert.equal(malformed.dllCalls().length, 0)
})

test('客户端失败如实记为失败；部分成功时按失败提示并给出第一条原因', async () => {
  const { host } = makeHost({
    dll: ({ params }) =>
      params.inputPath.endsWith('scan.pdf')
        ? { ok: false, success: false, error: '未能从 PDF 中提取到文字：可能是扫描件' }
        : { ok: true, success: true, outputPath: params.outputPath, text: 'Plain text' }
  })
  const result = await pdf.runPdfTool(
    'pdf-to-txt',
    [pdfFile('D:\\Docs\\good.pdf'), pdfFile('D:\\Docs\\scan.pdf')],
    host
  )
  assert.equal(result.succeeded.length, 1)
  assert.equal(result.failed.length, 1)
  assert.match(result.failed[0].error, /扫描件/)
  const summary = pdf.describeBatchResult(result)
  assert.equal(summary.ok, false)
  assert.equal(summary.title, '1 个已导出，1 个失败')
  assert.match(summary.message, /^scan\.pdf：.*扫描件/)

  const allFail = makeHost({ dll: () => { throw new Error('IPC_CLOSED') } })
  const r2 = await pdf.runPdfTool('pdf-to-txt', [pdfFile('D:\\Docs\\a.pdf')], allFail.host)
  const s2 = pdf.describeBatchResult(r2)
  assert.equal(s2.ok, false)
  assert.equal(s2.title, '导出失败（1 个）')
  assert.match(s2.message, /IPC_CLOSED/)
})

test('客户端报告成功却没有输出路径 / 文字为空白 / 文字为乱码：都不能算成功', async () => {
  const noPath = makeHost({ dll: () => ({ ok: true, success: true, text: 'abc' }) })
  const r1 = await pdf.runPdfTool('pdf-to-txt', [pdfFile('D:\\Docs\\a.pdf')], noPath.host)
  assert.match(r1.failed[0].error, /HOST_NO_OUTPUT/)

  const blank = makeHost({ dll: ({ params }) => ({ ok: true, success: true, outputPath: params.outputPath, text: '\n\n  \n' }) })
  const r2 = await pdf.runPdfTool('pdf-to-txt', [pdfFile('D:\\Docs\\a.pdf')], blank.host)
  assert.equal(r2.succeeded.length, 0)
  assert.match(r2.failed[0].error, /没有提取到可读文字/)
  assert.equal(r2.failed[0].outputPath, 'D:\\Docs\\a.txt')

  const garbled = makeHost({
    dll: ({ params }) => ({ ok: true, success: true, outputPath: params.outputPath, text: '\u0000\u0021\u0000\u0035\u0000\u0047\u0000\u0013' })
  })
  const r3 = await pdf.runPdfTool('pdf-to-txt', [pdfFile('D:\\Docs\\a.pdf')], garbled.host)
  assert.equal(r3.succeeded.length, 0)
  assert.match(r3.failed[0].error, /疑似乱码/)
  assert.match(r3.failed[0].error, /D:\\Docs\\a\.txt/)
})

test('类型不符的文件跳过并如实说明；不可用 / 未知工具整批拒绝且不请求客户端', async () => {
  const { host, calls } = makeHost()
  const docx = { ...pdfFile('D:\\Docs\\spec.docx'), docType: 'word' }
  const skipped = await pdf.runPdfTool('pdf-to-txt', [docx], host)
  assert.equal(skipped.skipped.length, 1)
  const s = pdf.describeBatchResult(skipped)
  assert.equal(s.ok, false)
  assert.match(s.message, /都不是 PDF/)

  const merge = await pdf.runPdfTool('pdf-merge', [pdfFile('D:\\Docs\\a.pdf'), pdfFile('D:\\Docs\\b.pdf')], host)
  assert.match(merge.error, /PDF合并暂不可用/)
  assert.equal(pdf.describeBatchResult(merge).ok, false)
  const unknown = await pdf.runPdfTool('nope', [pdfFile('D:\\Docs\\a.pdf')], host)
  assert.match(unknown.error, /UNKNOWN_TOOL/)
  assert.equal(calls.length, 0)

  const empty = pdf.describeBatchResult(await pdf.runPdfTool('pdf-to-txt', [], host))
  assert.equal(empty.ok, false)
  assert.match(empty.message, /请先勾选/)
})

test('源路径不能推导输出位置或被安全规则拦截：记为失败，不调用客户端', async () => {
  const { host, dllCalls } = makeHost()
  const bad = { ...pdfFile('D:\\Docs\\a.pdf'), path: 'a.pdf' }
  const r1 = await pdf.runPdfTool('pdf-to-txt', [bad], host)
  assert.match(r1.failed[0].error, /INVALID_INPUT_PATH/)

  const traversal = { ...pdfFile('D:\\Docs\\a.pdf'), path: 'D:\\Docs\\..\\Windows\\a.pdf' }
  const r2 = await pdf.runPdfTool('pdf-to-txt', [traversal], host)
  assert.match(r2.failed[0].error, /SECURITY_INTERCEPTED/)
  assert.equal(dllCalls().length, 0)
})

test('扫描：只列出 PDF，所在目录取文件真实目录，不估算页数；拿不到任何系统目录时报错', async () => {
  const host = {
    system_get_path: ({ name }) => (name === 'documents' ? 'D:\\Docs' : ''),
    system_search_files: ({ query }) => {
      if (query === 'dir:D:\\Docs') {
        return {
          files: [
            { name: 'big.pdf', path: 'D:\\Docs\\Reports\\big.pdf', is_dir: false, size: 900000, mtime: 1700000000 },
            { name: 'spec.docx', path: 'D:\\Docs\\spec.docx', is_dir: false, size: 800000, mtime: 1700000000 },
            { name: 'photo.png', path: 'D:\\Docs\\photo.png', is_dir: false, size: 700000, mtime: 1700000000 },
            { name: 'small.PDF', path: 'D:\\Docs\\small.PDF', is_dir: false, size: 1000, mtime: 1700000000 },
            { name: 'empty.pdf', path: 'D:\\Docs\\empty.pdf', is_dir: false, size: 0, mtime: 1700000000 }
          ]
        }
      }
      return { files: [] }
    }
  }
  const ws = await pdf.fetchRealPdfWorkspace(host)
  assert.deepEqual(ws.files.map(f => f.name), ['big.pdf', 'small.PDF'])
  assert.equal(ws.files[0].parentDir, 'D:\\Docs\\Reports')
  assert.equal(ws.files[1].docType, 'pdf')
  assert.equal('estimatedPages' in ws.files[0], false)

  await assert.rejects(
    () => pdf.fetchRealPdfWorkspace({ system_get_path: () => { throw new Error('IPC down') } }),
    /SYSTEM_PATHS_UNAVAILABLE/
  )
})

test('源码不含需求编号、示例假数据与估算页数', () => {
  for (const file of ['logic.ts', 'index.ts']) {
    const src = fs.readFileSync(path.resolve(__dirname, '../src', file), 'utf8')
    assert.doesNotMatch(src, /PRD\s*\d/, file)
    assert.doesNotMatch(src, /estimatedPages|INITIAL_SAMPLE|D:\\\\Workspace/, file)
  }
})
