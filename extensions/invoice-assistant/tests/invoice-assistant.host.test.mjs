import test from 'node:test'
import assert from 'node:assert/strict'
import { setRuntimeLocale } from '@ztools/declarative-ui'
setRuntimeLocale('zh-CN')
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as invoiceAssistant from '../dist/index.js'
import { pickFiles } from '../dist/file-import.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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

// 固定「现在」，让日期相关断言不随运行日期变化
const NOW = new Date(2026, 9, 28, 15, 0, 0)
const TODAY = '2026-10-28'

function completeInvoice(overrides = {}) {
  return {
    id: 'inv-1',
    path: 'D:\\Invoices\\didi_1.pdf',
    fileName: 'didi_1.pdf',
    extension: '.pdf',
    sizeBytes: 120000,
    invoiceNo: '24112000000088192011',
    issueDate: '2026-10-18',
    issueDateNeedsReview: false,
    sellerName: '滴滴出行科技有限公司',
    buyerName: '上海某某科技有限公司',
    buyerTaxId: '91310000XXXXXXXX0X',
    totalAmount: 126.5,
    taxAmount: 3.68,
    netAmount: 122.82,
    category: '交通出行',
    isDuplicate: false,
    isHeaderAbnormal: false,
    ...overrides
  }
}

/** 宿主当前识别不到字段时返回的结果：日期填当天、金额填 0、销售方填占位文字、发票号可能是 PDF 内部偏移量 */
function hostFallbackRaw(overrides = {}) {
  return {
    path: 'D:\\Invoices\\scan_001.pdf',
    fileName: 'scan_001.pdf',
    extension: '.pdf',
    sizeBytes: 98000,
    invoiceNo: '0000000000',
    issueDate: TODAY,
    sellerName: '未知销售商户',
    buyerName: '',
    buyerTaxId: '',
    totalAmount: 0,
    taxAmount: 0,
    netAmount: 0,
    category: '其他费用',
    isHeaderAbnormal: false,
    ...overrides
  }
}

test('invoice-assistant host integration: 电子发票四要素解析、查重与抬头预检、重命名模板与 Excel TSV 生成', async () => {
  const sampleItems = [
    completeInvoice(),
    completeInvoice({
      id: 'inv-2',
      path: 'D:\\Invoices\\didi_1_copy.pdf',
      fileName: 'didi_1_copy.pdf',
      buyerName: '个人（张三）',
      buyerTaxId: ''
    })
  ]

  const audited = invoiceAssistant.detectInvoiceAnomalies(sampleItems, '上海某某科技有限公司')
  assert.equal(audited[0].isDuplicate, false)
  assert.equal(audited[0].isHeaderAbnormal, false)
  assert.equal(audited[1].isDuplicate, true, '相同发票号的第二张发票必须标记为重复')
  assert.equal(audited[1].isHeaderAbnormal, true, '个人抬头或与期望企业抬头不符时必须标记为抬头异常')

  const nameStd = invoiceAssistant.buildTargetInvoiceFileName(audited[0], 'tpl-standard')
  assert.equal(nameStd, '[交通出行]_2026-10-18_滴滴出行科技有限公司_126.50元_2011.pdf')
  const nameDate = invoiceAssistant.buildTargetInvoiceFileName(audited[0], 'tpl-date-first')
  assert.equal(nameDate, '2026-10-18_[交通出行]_126.50元_滴滴出行科技有限公司.pdf')

  const tsv = invoiceAssistant.buildInvoiceTsvTable([audited[0]], 'tpl-standard')
  const lines = tsv.split('\n')
  assert.equal(lines.length, 2)
  assert.ok(lines[0].includes('发票号码\t开票日期\t费用分类'))
  assert.ok(lines[1].includes('24112000000088192011\t2026-10-18\t交通出行'))
})

test('invoice-assistant beyond happy path: 非法路径拦截、畸形参数校验与宿主导出失败容错', async () => {
  await assert.rejects(
    () => invoiceAssistant.invokeNativeCapability('', {}),
    /INVALID_METHOD/
  )
  await assert.rejects(
    () =>
      invoiceAssistant.invokeNativeCapability('ExportInvoicesCsv', {
        outputDir: 'C:\\Windows\\System32\\spool'
      }),
    /SECURITY_INTERCEPTED/
  )
  await assert.rejects(
    () =>
      invoiceAssistant.invokeNativeCapability('ExportInvoicesCsv', {
        outputDir: 'D:\\Invoices\\..\\..\\Windows\\System32'
      }),
    /SECURITY_INTERCEPTED/
  )

  await withRealElectronWindow(
    {
      dllplugin_call: () => ({
        ok: false,
        error: 'CSV_WRITE_LOCKED: 报销发票明细汇总表.csv 正被 Excel 占用无法覆盖'
      })
    },
    async () => {
      const res = await invoiceAssistant.invokeNativeCapability('ExportInvoicesCsv', {
        files: ['D:\\Invoices\\a.pdf']
      })
      assert.equal(res.ok, false)
      assert.match(String(res.error), /CSV_WRITE_LOCKED/)
    }
  )
})

test('识别不到的字段保持为空并标为未识别：不用当天日期、0 元、占位销售方、全 0 发票号冒充识别结果', () => {
  const item = invoiceAssistant.normalizeParsedInvoice(hostFallbackRaw(), 0, NOW)
  assert.equal(item.invoiceNo, '', '全 0 的数字不是发票号')
  assert.equal(item.issueDate, TODAY)
  assert.equal(item.issueDateNeedsReview, true, '与今天相同的日期可能是宿主填入的默认值，必须要求核对')
  assert.equal(item.sellerName, '', '占位文字不是销售方')
  assert.equal(item.buyerName, '')
  assert.equal(item.totalAmount, null, '0 元不能当作识别出的金额')
  assert.equal(item.taxAmount, null, '价税合计都没识别到时，税额 0 不可信')
  assert.equal(item.netAmount, null)

  const issues = invoiceAssistant.getInvoiceFieldIssues(item)
  assert.deepEqual(issues.missing, ['invoiceNo', 'sellerName', 'buyerName', 'totalAmount', 'taxAmount'])
  assert.deepEqual(issues.needsReview, ['issueDate'])
  assert.equal(invoiceAssistant.isInvoiceComplete(item), false)
  assert.equal(invoiceAssistant.isInvoiceSelectable(item), false)
  assert.equal(
    invoiceAssistant.describeInvoiceIssues(item),
    '未识别：发票号码、销售方、购买方、价税合计、税额；开票日期待核对'
  )

  assert.equal(invoiceAssistant.buildTargetInvoiceFileName(item, 'tpl-standard'), null)
  const row = invoiceAssistant.buildInvoiceTsvTable([item]).split('\n')[1].split('\t')
  assert.deepEqual(row, ['1', '未识别', `${TODAY}(待核对)`, '其他费用', '未识别', '未识别', '未识别', '未识别', '未识别', ''])
  assert.match(invoiceAssistant.buildInvoiceSummaryText(item), /发票号码: 未识别/)
  assert.equal(invoiceAssistant.formatCurrency(item.totalAmount), '未识别')
  assert.equal(invoiceAssistant.formatCurrency(Number.NaN), '未识别')
  assert.deepEqual(invoiceAssistant.defaultCheckedInvoiceIds([item]), [])
  assert.equal(invoiceAssistant.normalizeParsedInvoice(hostFallbackRaw({ path: '' }), 0, NOW), null)
})

test('识别结果规范化：发票号 8 / 20 位、日期合法且不晚于今天、税额不大于价税合计、宿主分类名对应插件分类', () => {
  assert.equal(invoiceAssistant.normalizeInvoiceNo('2431 2000 0000 4829 8921'), '24312000000048298921')
  assert.equal(invoiceAssistant.normalizeInvoiceNo('01234567'), '01234567')
  assert.equal(invoiceAssistant.normalizeInvoiceNo('123456789'), '')
  assert.equal(invoiceAssistant.normalizeInvoiceNo('00000000'), '')
  assert.equal(invoiceAssistant.normalizeInvoiceNo(undefined), '')

  assert.equal(invoiceAssistant.normalizeIssueDate('2026年10月8日', NOW), '2026-10-08')
  assert.equal(invoiceAssistant.normalizeIssueDate('2026/1/5', NOW), '2026-01-05')
  assert.equal(invoiceAssistant.normalizeIssueDate('2026-02-30', NOW), '')
  assert.equal(invoiceAssistant.normalizeIssueDate('2026-10-29', NOW), '')
  assert.equal(invoiceAssistant.normalizeIssueDate('1999-12-31', NOW), '')
  assert.equal(invoiceAssistant.normalizeIssueDate('开票日期', NOW), '')
  assert.equal(invoiceAssistant.isPossibleFallbackDate('2026-10-27', NOW), false)

  const taxTooLarge = invoiceAssistant.normalizeParsedInvoice(
    hostFallbackRaw({ issueDate: '2026-10-01', totalAmount: 50, taxAmount: 80 }),
    0,
    NOW
  )
  assert.equal(taxTooLarge.totalAmount, 50)
  assert.equal(taxTooLarge.taxAmount, null)
  assert.equal(taxTooLarge.issueDateNeedsReview, false)

  assert.equal(invoiceAssistant.normalizeInvoiceCategory('差旅交通'), '交通出行')
  assert.equal(invoiceAssistant.normalizeInvoiceCategory('酒店住宿'), '差旅住宿')
  assert.equal(invoiceAssistant.normalizeInvoiceCategory('办公设备'), '办公采购')
  assert.equal(invoiceAssistant.normalizeInvoiceCategory('技术与云服务'), '办公采购')
  assert.equal(invoiceAssistant.normalizeInvoiceCategory('餐饮招待'), '餐饮招待')
  assert.equal(invoiceAssistant.normalizeInvoiceCategory('火星费用'), '其他费用')

  const train = completeInvoice({ category: '交通出行' })
  const hotel = completeInvoice({ id: 'h', category: '差旅住宿' })
  const meal = completeInvoice({ id: 'm', category: '餐饮招待' })
  assert.deepEqual(
    [train, hotel, meal].filter((i) => invoiceAssistant.matchesInvoiceFilter(i, 'TRAVEL')).map((i) => i.id),
    ['inv-1', 'h']
  )
  const incomplete = invoiceAssistant.normalizeParsedInvoice(hostFallbackRaw(), 0, NOW)
  assert.equal(invoiceAssistant.matchesInvoiceFilter(incomplete, 'INCOMPLETE'), true)
  assert.equal(invoiceAssistant.matchesInvoiceFilter(train, 'INCOMPLETE'), false)
})

test('补全字段校验：格式错误逐项报错，合法输入写回后发票可导出，并重新计算查重', () => {
  const bad = invoiceAssistant.validateInvoiceEdits(
    { invoiceNo: '12345', issueDate: '2026-11-30', sellerName: ' ', buyerName: '', totalAmount: '0', taxAmount: '12.345' },
    NOW
  )
  assert.equal(bad.ok, false)
  assert.deepEqual(Object.keys(bad.errors).sort(), ['buyerName', 'invoiceNo', 'issueDate', 'sellerName', 'taxAmount', 'totalAmount'])

  const taxOver = invoiceAssistant.validateInvoiceEdits(
    { invoiceNo: '01234567', issueDate: '2026-10-01', sellerName: '甲', buyerName: '乙公司', totalAmount: '10', taxAmount: '11' },
    NOW
  )
  assert.equal(taxOver.ok, false)
  assert.match(taxOver.errors.taxAmount, /不能大于价税合计/)

  const good = invoiceAssistant.validateInvoiceEdits(
    {
      invoiceNo: '24112000000088192011',
      issueDate: '2026/10/18',
      sellerName: '  某某酒店管理有限公司 ',
      buyerName: '上海某某科技有限公司',
      totalAmount: '¥1,280.00',
      taxAmount: '72.45'
    },
    NOW
  )
  assert.equal(good.ok, true)
  assert.deepEqual(good.values, {
    invoiceNo: '24112000000088192011',
    issueDate: '2026-10-18',
    sellerName: '某某酒店管理有限公司',
    buyerName: '上海某某科技有限公司',
    totalAmount: 1280,
    taxAmount: 72.45,
    netAmount: 1207.55
  })

  const today = invoiceAssistant.validateInvoiceEdits(
    { invoiceNo: '01234567', issueDate: TODAY, sellerName: '甲', buyerName: '乙公司', totalAmount: '10', taxAmount: '0' },
    NOW
  )
  assert.equal(today.ok, true)

  const existing = completeInvoice()
  const incomplete = invoiceAssistant.normalizeParsedInvoice(hostFallbackRaw(), 1, NOW)
  const after = invoiceAssistant.applyInvoiceEdits([existing, incomplete], incomplete.id, good.values)
  const edited = after.find((i) => i.id === incomplete.id)
  assert.equal(invoiceAssistant.isInvoiceComplete(edited), true)
  assert.equal(edited.issueDateNeedsReview, false)
  assert.equal(edited.isDuplicate, true)
  assert.equal(invoiceAssistant.isInvoiceSelectable(edited), false)
})

test('同一批发票的归档文件名互不重名（不区分大小写），避免复制副本时互相覆盖', () => {
  const a = completeInvoice({ id: 'a', path: 'D:\\Invoices\\a.pdf', fileName: 'a.pdf' })
  const b = completeInvoice({ id: 'b', path: 'D:\\Invoices\\b.PDF', fileName: 'b.PDF', extension: '.PDF', invoiceNo: '24112000000088199999' })
  const c = completeInvoice({ id: 'c', path: 'D:\\Invoices\\c.pdf', fileName: 'c.pdf', invoiceNo: '24112000000088190000' })
  const incomplete = invoiceAssistant.normalizeParsedInvoice(hostFallbackRaw(), 3, NOW)
  const names = invoiceAssistant.buildUniqueTargetNames([a, b, c, incomplete], 'tpl-date-first')
  assert.equal(names.get('a'), '2026-10-18_[交通出行]_126.50元_滴滴出行科技有限公司.pdf')
  assert.equal(names.get('b'), '2026-10-18_[交通出行]_126.50元_滴滴出行科技有限公司_2.PDF')
  assert.equal(names.get('c'), '2026-10-18_[交通出行]_126.50元_滴滴出行科技有限公司_3.pdf')
  assert.equal(names.has(incomplete.id), false)
})

function exportHost(handlers) {
  const calls = []
  const host = {
    async dllplugin_call({ plugin, func, params }) {
      calls.push({ plugin, func, params })
      const impl = handlers[func]
      if (!impl) throw new Error(`未预期的调用 ${func}`)
      return impl(params)
    }
  }
  return { host, calls }
}

test('导出报销归档：复制副本 + 生成 CSV 写入本次新建的目录', async () => {
  const a = completeInvoice({ id: 'a', path: 'D:\\Invoices\\a.pdf', fileName: 'a.pdf' })
  const b = completeInvoice({ id: 'b', path: 'D:\\Invoices\\b.pdf', fileName: 'b.pdf', invoiceNo: '24112000000088199999' })
  const { host, calls } = exportHost({
    BatchRenameInvoices: (params) => ({ ok: true, outputDir: params.outputDir, renamedFiles: params.invoices.map((i) => `${params.outputDir}\\${i.targetFileName}`) }),
    ExportInvoicesCsv: (params) => ({ ok: true, outputDir: params.outputDir, csvOutputPath: `${params.outputDir}\\报销发票明细汇总表.csv` })
  })
  const res = await invoiceAssistant.exportInvoices('bundle', [a, b], 'tpl-standard', host, NOW)
  assert.equal(res.ok, true, res.error)
  assert.deepEqual(calls.map((c) => c.func), ['BatchRenameInvoices', 'ExportInvoicesCsv'])
  assert.equal(res.outputDir, 'D:\\Invoices\\ZTools_Reimbursement_Export\\报销归档_20261028_150000_000')
  assert.equal(res.copiedCount, 2)
  assert.match(res.csvPath, /报销发票明细汇总表\.csv$/)

  calls.length = 0
  const csvOnly = await invoiceAssistant.exportInvoices('csv', [a], 'tpl-standard', host, NOW)
  assert.equal(csvOnly.ok, true)
  assert.deepEqual(calls.map((c) => c.func), ['ExportInvoicesCsv'])
  assert.equal(csvOnly.copiedCount, 0)

  const later = invoiceAssistant.buildExportOutputDir('D:\\Invoices\\a.pdf', new Date(2026, 9, 28, 15, 0, 1, 7))
  assert.notEqual(later, res.outputDir)
  assert.equal(invoiceAssistant.buildExportOutputDir('/home/u/Downloads/a.pdf', NOW), '/home/u/Downloads/ZTools_Reimbursement_Export/报销归档_20261028_150000_000')
  assert.throws(() => invoiceAssistant.buildExportOutputDir('a.pdf', NOW), /无法确定发票所在目录/)
})

test('导出报销归档的失败路径：信息不全 / 重复发票拒绝导出，宿主部分成功、报错、结果无法确认与授权过期均如实报失败', async () => {
  const a = completeInvoice({ id: 'a', path: 'D:\\Invoices\\a.pdf', fileName: 'a.pdf' })
  const b = completeInvoice({ id: 'b', path: 'D:\\Invoices\\b.pdf', fileName: 'b.pdf', invoiceNo: '24112000000088199999' })
  const incomplete = invoiceAssistant.normalizeParsedInvoice(hostFallbackRaw(), 2, NOW)

  const untouched = exportHost({})
  const r1 = await invoiceAssistant.exportInvoices('bundle', [a, incomplete], 'tpl-standard', untouched.host, NOW)
  assert.equal(r1.ok, false)
  assert.match(r1.error, /未识别或待核对的字段.*scan_001\.pdf/)
  const r2 = await invoiceAssistant.exportInvoices('csv', [a, { ...b, isDuplicate: true }], 'tpl-standard', untouched.host, NOW)
  assert.equal(r2.ok, false)
  assert.match(r2.error, /重复/)
  const r3 = await invoiceAssistant.exportInvoices('csv', [], 'tpl-standard', untouched.host, NOW)
  assert.equal(r3.ok, false)
  assert.equal(untouched.calls.length, 0)

  const partial = exportHost({
    BatchRenameInvoices: () => ({ ok: true, renamedFiles: ['D:\\x\\only-one.pdf'] }),
    ExportInvoicesCsv: () => ({ ok: true, csvOutputPath: 'D:\\x\\a.csv' })
  })
  const r4 = await invoiceAssistant.exportInvoices('bundle', [a, b], 'tpl-standard', partial.host, NOW)
  assert.equal(r4.ok, false)
  assert.match(r4.error, /只复制了 1\/2 份副本/)

  const noList = exportHost({ BatchRenameInvoices: () => ({ ok: true }) })
  const r5 = await invoiceAssistant.exportInvoices('bundle', [a], 'tpl-standard', noList.host, NOW)
  assert.equal(r5.ok, false)
  assert.match(r5.error, /无法确认副本已生成/)

  const copyFail = exportHost({ BatchRenameInvoices: () => ({ ok: false, error: 'ACCESS_DENIED: 目录只读' }) })
  const r6 = await invoiceAssistant.exportInvoices('bundle', [a], 'tpl-standard', copyFail.host, NOW)
  assert.equal(r6.ok, false)
  assert.match(r6.error, /复制规范命名副本失败.*ACCESS_DENIED/)

  const csvFail = exportHost({
    BatchRenameInvoices: (params) => ({ ok: true, renamedFiles: params.invoices.map((i) => i.targetFileName) }),
    ExportInvoicesCsv: () => {
      throw new Error('磁盘已满')
    }
  })
  const r7 = await invoiceAssistant.exportInvoices('bundle', [a, b], 'tpl-standard', csvFail.host, NOW)
  assert.equal(r7.ok, false)
  assert.match(r7.error, /已复制 2 份副本，但生成报销明细 CSV 失败：.*磁盘已满/)

  const noCsvPath = exportHost({ ExportInvoicesCsv: () => ({ ok: true, csvOutputPath: '' }) })
  const r8 = await invoiceAssistant.exportInvoices('csv', [a], 'tpl-standard', noCsvPath.host, NOW)
  assert.equal(r8.ok, false)
  assert.match(r8.error, /无法确认报销明细已生成/)

  const expiredAuth = exportHost({ ExportInvoicesCsv: () => ({ ok: false, error: '路径未由当前窗口授权' }) })
  const r9 = await invoiceAssistant.exportInvoices('csv', [a], 'tpl-standard', expiredAuth.host, NOW)
  assert.equal(r9.ok, false)
  assert.match(r9.error, /文件授权已过期或未授权/)
})

test('导入规则与自动扫盘清理：跳过历史导出目录与汇总文件，对话框补全 6 种格式过滤器', async () => {
  assert.equal(invoiceAssistant.fetchRealInvoicesWorkspace, undefined)
  assert.equal(invoiceAssistant.pickInvoiceFilesFromDialog, undefined)
  assert.equal(invoiceAssistant.extractDroppedInvoicePaths, undefined)
  assert.equal(invoiceAssistant.SCAN_FILES_PER_DIR, undefined)

  assert.deepEqual([...invoiceAssistant.INVOICE_IMPORT_EXTENSIONS], ['.pdf', '.ofd', '.xml', '.jpg', '.jpeg', '.png'])
  assert.deepEqual(invoiceAssistant.INVOICE_IMPORT_RULES.excludeDirNames, [invoiceAssistant.EXPORT_ROOT_DIR_NAME])

  await withRealElectronWindow(
    {
      window_show_open_dialog: () => ({
        canceled: false,
        filePaths: [
          'D:\\Users\\u\\downloads\\电子发票_出租车.pdf',
          'D:\\Users\\u\\downloads\\数电票.ofd',
          'D:\\Users\\u\\downloads\\ZTools_Reimbursement_Export\\报销归档_20261020\\副本.pdf',
          'D:\\Users\\u\\downloads\\报销发票明细汇总表.xml',
          'D:\\Users\\u\\downloads\\说明.txt'
        ]
      }),
      filesystem_get_file_size: () => ({ success: true, size: 1200 })
    },
    async (calls) => {
      const res = await pickFiles(
        invoiceAssistant.createInvoiceImportTransport(),
        invoiceAssistant.INVOICE_IMPORT_RULES,
        { title: '选择电子发票文件', filterName: '电子发票' }
      )
      const dialogCall = calls.find((c) => c.channel === 'window_show_open_dialog')
      assert.equal(dialogCall.payload.filters, '电子发票|pdf;ofd;xml;jpg;jpeg;png')
      assert.deepEqual(res.files.map((f) => f.name), ['电子发票_出租车.pdf', '数电票.ofd'])
      assert.equal(res.ignored, 3)
    }
  )
})

test('分批调用 ParseInvoices：每批最多 50 个，单批失败不阻断后续批次并如实记录失败与授权过期翻译', async () => {
  const paths = Array.from({ length: 120 }, (_, i) => `D:\\Invoices\\inv_${String(i + 1).padStart(3, '0')}.pdf`)
  const batchSizes = []

  const allOkHost = {
    async dllplugin_call({ func, params }) {
      assert.equal(func, 'ParseInvoices')
      batchSizes.push(params.files.length)
      return {
        ok: true,
        invoices: params.files.map((p, idx) => ({
          path: p,
          fileName: path.basename(p),
          invoiceNo: `243120000000${String(batchSizes.length * 100 + idx).padStart(8, '0')}`,
          issueDate: '2026-10-18',
          sellerName: '某某出租汽车有限公司',
          buyerName: '上海某某科技有限公司',
          totalAmount: 30,
          taxAmount: 0.87,
          category: '差旅交通'
        }))
      }
    }
  }

  const progressLog = []
  const okRes = await invoiceAssistant.parseInvoiceFiles(paths, '', allOkHost, NOW, {
    onProgress: (prog) => progressLog.push(prog)
  })
  assert.equal(okRes.ok, true)
  assert.deepEqual(batchSizes, [50, 50, 20])
  assert.equal(okRes.invoices.length, 120)
  assert.equal(okRes.invoices[0].category, '交通出行')
  assert.deepEqual(progressLog, [
    { done: 50, total: 120 },
    { done: 100, total: 120 },
    { done: 120, total: 120 }
  ])

  // 第 1 批抛异常、第 2 批授权过期失败、第 3 批成功：第 3 批仍可进入结果，第 1、2 批全部记入 parseErrors
  let callIndex = 0
  const partialFailHost = {
    async dllplugin_call({ params }) {
      callIndex++
      if (callIndex === 1) throw new Error('原生组件超时')
      if (callIndex === 2) return { ok: false, error: '路径未由当前窗口授权' }
      return {
        ok: true,
        invoices: params.files.map((p, idx) => ({
          path: p,
          fileName: path.basename(p),
          invoiceNo: `243120000000999900${String(idx).padStart(2, '0')}`,
          issueDate: '2026-10-18',
          sellerName: '星巴克咖啡',
          buyerName: '上海某某科技有限公司',
          totalAmount: 60,
          taxAmount: 3.4,
          category: '餐饮招待'
        }))
      }
    }
  }
  const partial = await invoiceAssistant.parseInvoiceFiles(paths, '', partialFailHost, NOW)
  assert.equal(partial.ok, true)
  assert.equal(partial.invoices.length, 20)
  assert.equal(partial.batchErrors.length, 2)
  assert.equal(partial.parseErrors.length, 100)
  assert.match(partial.parseErrors[0].error, /原生组件超时/)
  assert.match(partial.parseErrors[50].error, /文件授权已过期或未授权/)

  // 全部批次失败时 ok=false，但不因第 1 批失败中断第 2、3 批
  let allFailCount = 0
  const allFailHost = {
    async dllplugin_call() {
      allFailCount++
      throw new Error('原生组件崩溃')
    }
  }
  const failAll = await invoiceAssistant.parseInvoiceFiles(paths, '', allFailHost, NOW)
  assert.equal(allFailCount, 3)
  assert.equal(failAll.ok, false)
  assert.match(failAll.error, /原生组件崩溃/)
  assert.equal(failAll.parseErrors.length, 120)

  // 中止信号中断后续批次
  const controller = new AbortController()
  let abortCalls = 0
  const abortHost = {
    async dllplugin_call({ params }) {
      abortCalls++
      controller.abort()
      return { ok: true, invoices: params.files.map((p) => ({ path: p })) }
    }
  }
  const aborted = await invoiceAssistant.parseInvoiceFiles(paths, '', abortHost, NOW, { signal: controller.signal })
  assert.equal(aborted.canceled, true)
  assert.equal(abortCalls, 1)
})

test('源码不含自动扫盘函数与旧限流常量', () => {
  for (const file of ['logic.ts', 'index.ts']) {
    const src = fs.readFileSync(path.resolve(__dirname, '../src', file), 'utf8')
    assert.doesNotMatch(
      src,
      /fetchRealInvoicesWorkspace|SCAN_FILES_PER_DIR|SCAN_INVOICE_FILE_REGEX|INVOICE_NAME_HINT|getRealSystemPath|createDirectoryScanner|scanRealDirectoryTree/,
      file
    )
  }
})

test('i18n en-US: 归档文件名金额格式使用 CNY 前缀，绝不因空串回退为中文「元」', () => {
  const item = completeInvoice({ sellerName: 'Acme Travel' })
  setRuntimeLocale('en-US')
  try {
    const std = invoiceAssistant.buildTargetInvoiceFileName(item, 'tpl-standard')
    const dateFirst = invoiceAssistant.buildTargetInvoiceFileName(item, 'tpl-date-first')
    const amtFirst = invoiceAssistant.buildTargetInvoiceFileName(item, 'tpl-amount-first')
    const taxAudit = invoiceAssistant.buildTargetInvoiceFileName(item, 'tpl-tax-audit')
    assert.equal(std, '[Transit]_2026-10-18_Acme_Travel_CNY126.50_2011.pdf')
    assert.equal(dateFirst, '2026-10-18_[Transit]_CNY126.50_Acme_Travel.pdf')
    assert.equal(amtFirst, '[Transit]_CNY126.50_Acme_Travel_2011.pdf')
    assert.equal(taxAudit, '24112000000088192011_2026-10-18_Acme_Travel_CNY126.50.pdf')
    for (const name of [std, dateFirst, amtFirst, taxAudit]) {
      assert.ok(!name.includes('元') && !/[\u4e00-\u9fa5]/.test(name), `en-US filename should not contain CJK: ${name}`)
    }
  } finally {
    setRuntimeLocale('zh-CN')
  }
  const zhStd = invoiceAssistant.buildTargetInvoiceFileName(item, 'tpl-standard')
  assert.equal(zhStd, '[交通出行]_2026-10-18_Acme_Travel_126.50元_2011.pdf')
})
