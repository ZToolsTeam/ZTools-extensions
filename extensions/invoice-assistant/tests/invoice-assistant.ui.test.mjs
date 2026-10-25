import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import InvoiceAssistantCommand from '../dist/index.js'

test('invoice-assistant UI integration: 布局二左科目树+右发票列表、重复票自动取消勾选、分类手动修正与 Excel TSV 复制', async () => {
  const host = createHost()
  host.ipc.system_get_path = async ({ name }) => `D:\\TestInvoices\\${name}`
  host.ipc.system_search_files = async ({ query }) => {
    if (String(query).includes('downloads')) {
      return {
        files: [
          {
            name: '电子发票_星巴克_01.pdf',
            path: 'D:\\TestInvoices\\downloads\\电子发票_星巴克_01.pdf',
            is_dir: false,
            size: 150000,
            mtime: 1728000000
          },
          {
            name: '电子发票_星巴克_重复副本.pdf',
            path: 'D:\\TestInvoices\\downloads\\电子发票_星巴克_重复副本.pdf',
            is_dir: false,
            size: 150000,
            mtime: 1728000001
          }
        ]
      }
    }
    return { files: [] }
  }

  let exportedBundlePayload = null
  host.ipc.dllplugin_call = async ({ func, params }) => {
    if (func === 'ParseInvoices') {
      return {
        ok: true,
        invoices: [
          {
            id: 'inv-real-1',
            path: 'D:\\TestInvoices\\downloads\\电子发票_星巴克_01.pdf',
            fileName: '电子发票_星巴克_01.pdf',
            sizeBytes: 150000,
            invoiceNo: '24312000000099887766',
            issueDate: '2026-10-20',
            sellerName: '星巴克咖啡',
            buyerName: '上海极客效率科技有限公司',
            buyerTaxId: '91310000MA1FL8890X',
            totalAmount: 88.0,
            taxAmount: 4.98,
            netAmount: 83.02,
            category: '餐饮招待',
            isDuplicate: false,
            isHeaderAbnormal: false
          },
          {
            id: 'inv-real-2',
            path: 'D:\\TestInvoices\\downloads\\电子发票_星巴克_重复副本.pdf',
            fileName: '电子发票_星巴克_重复副本.pdf',
            sizeBytes: 150000,
            invoiceNo: '24312000000099887766',
            issueDate: '2026-10-20',
            sellerName: '星巴克咖啡',
            buyerName: '上海极客效率科技有限公司',
            buyerTaxId: '91310000MA1FL8890X',
            totalAmount: 88.0,
            taxAmount: 4.98,
            netAmount: 83.02,
            category: '餐饮招待',
            isDuplicate: true,
            isHeaderAbnormal: false
          }
        ]
      }
    }
    if (func === 'ExportReimbursementBundle') {
      exportedBundlePayload = params
      return {
        ok: true,
        outputDir: 'D:\\TestInvoices\\downloads\\ZTools_报销归档_2026-10-20',
        processedCount: params.invoices.length
      }
    }
    return { ok: true }
  }

  const view = await mount(InvoiceAssistantCommand, host)
  await tick(10)

  const tree = view.tree()
  assert.equal(tree.type, 'List')
  assert.equal(tree.props.isShowingDetail, false)
  assert.ok(tree.props.subList)

  // 零彩色 Emoji 污染校验
  const serialized = view.text()
  assert.equal(/[\u{1F300}-\u{1FAFF}]/u.test(serialized), false, 'UI 严禁包含彩色 Emoji')

  // 1. 验证第一张合规发票默认勾选，而第二张重复发票号自动取消勾选且标红
  const validItem = view.item('inv-real-1')
  const dupItem = view.item('inv-real-2')
  assert.equal(validItem.props.checked, true)
  assert.equal(dupItem.props.checked, false, '重复发票默认必须不勾选，防止误报销')

  // 2. 验证手动修正费用科目动作
  await view.run(validItem, '手动切换当前发票费用分类 (当前: 餐饮招待)')
  const cycledItem = view.item('inv-real-1')
  assert.ok(cycledItem.props.title.startsWith('[交通出行]_'), '切换分类后重命名预览必须立即同步更新')

  // 3. 验证复制 Excel TSV 报销明细
  await view.run(cycledItem, '复制报销明细表 (Excel TSV 直接粘贴)')
  assert.ok(host.clipboard.text.includes('24312000000099887766\t2026-10-20\t交通出行'))

  // 4. 验证一键生成报销归档包只打包已勾选的 1 张合规发票
  await view.run(cycledItem, '一键生成报销归档包 (1张 · ¥88.00)')
  assert.equal(exportedBundlePayload?.invoices?.length, 1)
  assert.match(String(host.lastToast()?.title), /已生成 1 张发票报销归档包/)

  view.unmount()
})
