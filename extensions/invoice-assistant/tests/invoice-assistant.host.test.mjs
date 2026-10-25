import test from 'node:test'
import assert from 'node:assert/strict'
import * as invoiceAssistant from '../dist/index.js'

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

test('invoice-assistant host integration: 电子发票四要素解析、查重与抬头预检、重命名模板与 Excel TSV 生成', async () => {
  const sampleItems = [
    {
      id: 'inv-1',
      path: 'D:\\Invoices\\didi_1.pdf',
      fileName: 'didi_1.pdf',
      extension: '.pdf',
      sizeBytes: 120000,
      invoiceNo: '24112000000088192011',
      issueDate: '2026-10-18',
      sellerName: '滴滴出行科技有限公司',
      buyerName: '上海极客效率科技有限公司',
      buyerTaxId: '91310000MA1FL8890X',
      totalAmount: 126.5,
      taxAmount: 3.68,
      netAmount: 122.82,
      category: '交通出行',
      isDuplicate: false,
      isHeaderAbnormal: false
    },
    {
      id: 'inv-2',
      path: 'D:\\Invoices\\didi_1_copy.pdf',
      fileName: 'didi_1_copy.pdf',
      extension: '.pdf',
      sizeBytes: 120000,
      invoiceNo: '24112000000088192011',
      issueDate: '2026-10-18',
      sellerName: '滴滴出行科技有限公司',
      buyerName: '个人（张三）',
      buyerTaxId: '',
      totalAmount: 126.5,
      taxAmount: 3.68,
      netAmount: 122.82,
      category: '交通出行',
      isDuplicate: false,
      isHeaderAbnormal: false
    }
  ]

  // 1. 查重与个人抬头异常预检
  const audited = invoiceAssistant.detectInvoiceAnomalies(sampleItems, '上海极客效率科技有限公司')
  assert.equal(audited[0].isDuplicate, false)
  assert.equal(audited[0].isHeaderAbnormal, false)
  assert.equal(audited[1].isDuplicate, true, '相同发票号的第二张发票必须标记为重复')
  assert.equal(audited[1].isHeaderAbnormal, true, '个人抬头或与期望企业抬头不符时必须标记为抬头异常')

  // 2. 4 套规范化重命名模板生成
  const nameStd = invoiceAssistant.buildTargetInvoiceFileName(audited[0], 'tpl-standard')
  assert.equal(nameStd, '[交通出行]_2026-10-18_滴滴出行科技有限公司_126.50元_2011.pdf')
  const nameDate = invoiceAssistant.buildTargetInvoiceFileName(audited[0], 'tpl-date-first')
  assert.equal(nameDate, '2026-10-18_[交通出行]_126.50元_滴滴出行科技有限公司.pdf')

  // 3. Excel TSV 制表符报销明细生成
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
      invoiceAssistant.invokeNativeCapability('ExportReimbursementBundle', {
        outputDir: 'C:\\Windows\\System32\\spool'
      }),
    /SECURITY_INTERCEPTED/
  )
  await assert.rejects(
    () =>
      invoiceAssistant.invokeNativeCapability('ExportReimbursementBundle', {
        outputDir: 'D:\\Invoices\\..\\..\\Windows\\System32'
      }),
    /SECURITY_INTERCEPTED/
  )

  await withRealElectronWindow(
    {
      dllplugin_call: () => ({
        ok: false,
        error: 'CSV_WRITE_LOCKED: 财务报销台账.csv 正被 Excel 占用无法覆盖'
      })
    },
    async () => {
      const res = await invoiceAssistant.invokeNativeCapability('ExportReimbursementBundle', {
        files: ['D:\\Invoices\\a.pdf']
      })
      assert.equal(res.ok, false)
      assert.match(String(res.error), /CSV_WRITE_LOCKED/)
    }
  )
})
