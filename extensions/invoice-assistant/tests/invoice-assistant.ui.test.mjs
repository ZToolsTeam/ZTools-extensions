import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import InvoiceAssistantCommand from '../dist/index.js'

const settle = () => tick(30)

function localDateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function starbucks(overrides = {}) {
  return {
    id: 'inv-real-1',
    path: 'D:\\TestInvoices\\downloads\\电子发票_星巴克_01.pdf',
    fileName: '电子发票_星巴克_01.pdf',
    sizeBytes: 150000,
    invoiceNo: '24312000000099887766',
    issueDate: '2026-10-20',
    sellerName: '星巴克咖啡',
    buyerName: '上海某某科技有限公司',
    buyerTaxId: '91310000XXXXXXXX0X',
    totalAmount: 88.0,
    taxAmount: 4.98,
    netAmount: 83.02,
    category: '餐饮招待',
    isDuplicate: false,
    isHeaderAbnormal: false,
    ...overrides
  }
}

/** 宿主当前识别不到字段时返回的结果 */
function unreadable(overrides = {}) {
  return {
    id: 'inv-scan',
    path: 'D:\\TestInvoices\\downloads\\扫描件_发票.pdf',
    fileName: '扫描件_发票.pdf',
    sizeBytes: 90000,
    invoiceNo: '',
    issueDate: localDateKey(),
    sellerName: '未知销售商户',
    buyerName: '',
    buyerTaxId: '',
    totalAmount: 0,
    taxAmount: 0,
    netAmount: 0,
    category: '其他费用',
    isDuplicate: false,
    isHeaderAbnormal: false,
    ...overrides
  }
}

/**
 * 测试宿主：三个系统目录 + downloads 下的发票文件 + 发票插件接口。
 * parse 返回 ParseInvoices 的结果（或抛错），exports 记录导出调用，可按方法注入返回值。
 */
function installInvoiceHost({ files, parse, exportImpl = {} }) {
  const host = createHost()
  const dllCalls = []
  host.ipc.system_get_path = async ({ name }) => `D:\\TestInvoices\\${name}`
  host.ipc.system_search_files = async ({ query }) => {
    if (String(query) === 'dir:D:\\TestInvoices\\downloads') {
      return {
        files: files.map((f) => ({ name: f.fileName, path: f.path, is_dir: false, size: f.sizeBytes || 1000, mtime: 1728000000 }))
      }
    }
    return { files: [] }
  }
  host.ipc.dllplugin_call = async ({ func, params }) => {
    dllCalls.push({ func, params })
    if (func === 'ParseInvoices') return parse(params)
    if (exportImpl[func]) return exportImpl[func](params)
    if (func === 'BatchRenameInvoices') {
      return {
        ok: true,
        outputDir: params.outputDir,
        renamedFiles: params.invoices.map((i) => `${params.outputDir}\\${i.targetFileName}`)
      }
    }
    if (func === 'ExportInvoicesCsv') {
      return { ok: true, outputDir: params.outputDir, csvOutputPath: `${params.outputDir}\\报销发票明细汇总表.csv` }
    }
    throw new Error(`未预期的调用 ${func}`)
  }
  return { host, dllCalls }
}

function exportCalls(dllCalls) {
  return dllCalls.filter((c) => c.func !== 'ParseInvoices')
}

test('invoice-assistant UI integration: 布局二左科目树+右发票列表、重复票自动取消勾选、分类手动修正与 Excel TSV 复制', async () => {
  const dup = starbucks({
    id: 'inv-real-2',
    path: 'D:\\TestInvoices\\downloads\\电子发票_星巴克_重复副本.pdf',
    fileName: '电子发票_星巴克_重复副本.pdf'
  })
  const { host, dllCalls } = installInvoiceHost({
    files: [starbucks(), dup],
    parse: () => ({ ok: true, invoices: [starbucks(), { ...dup, isDuplicate: true }] })
  })

  const view = await mount(InvoiceAssistantCommand, host)
  await settle()

  const tree = view.tree()
  assert.equal(tree.type, 'List')
  assert.equal(tree.props.isShowingDetail, false)
  assert.ok(tree.props.subList)

  // 零彩色 Emoji 污染校验
  const serialized = view.text()
  assert.equal(/[\u{1F300}-\u{1FAFF}]/u.test(serialized), false, 'UI 严禁包含彩色 Emoji')

  // 1. 第一张合规发票默认勾选，重复发票号默认不勾选且不能手动勾选
  const validItem = view.item('inv-real-1')
  const dupItem = view.item('inv-real-2')
  assert.equal(validItem.props.checked, true)
  assert.equal(dupItem.props.checked, false, '重复发票默认必须不勾选，防止误报销')
  dupItem.props.onCheckChange(true)
  await settle()
  assert.equal(view.item('inv-real-2').props.checked, false)
  assert.match(String(host.lastToast()?.title), /发票号码与其他发票重复/)

  // 宿主做不到的合并打印 PDF 不再出现在动作里
  assert.ok(!view.actions(validItem).some((a) => /PDF|合并/.test(a.props.title)), '不提供合并打印 PDF')

  // 2. 手动修正费用科目
  await view.run(validItem, '切换费用分类 (当前: 餐饮招待)')
  const cycledItem = view.item('inv-real-1')
  assert.ok(cycledItem.props.title.startsWith('[交通出行]_'), '切换分类后重命名预览必须立即同步更新')

  // 3. 复制 Excel TSV 报销明细（只含已勾选的发票）
  await view.run(cycledItem, '复制已选发票的报销明细 (Excel TSV)')
  const tsvLines = host.clipboard.text.split('\n')
  assert.equal(tsvLines.length, 2)
  assert.ok(tsvLines[1].includes('24312000000099887766\t2026-10-20\t交通出行'))

  // 4. 生成报销归档：只处理已勾选的 1 张，复制副本 + CSV 写入本次新建的目录
  await view.run(cycledItem, '生成报销归档：规范命名副本 + 明细 CSV (1张 · ¥88.00)')
  const calls = exportCalls(dllCalls)
  assert.deepEqual(calls.map((c) => c.func), ['BatchRenameInvoices', 'ExportInvoicesCsv'])
  assert.equal(calls[0].params.invoices.length, 1)
  assert.match(calls[0].params.outputDir, /^D:\\TestInvoices\\downloads\\ZTools_Reimbursement_Export\\报销归档_\d{8}_\d{6}_\d{3}$/)
  assert.equal(calls[1].params.outputDir, calls[0].params.outputDir)
  assert.match(String(host.lastToast()?.title), /已复制 1 份规范命名副本并生成报销明细 CSV/)
  assert.equal(host.lastToast()?.message, `输出目录: ${calls[0].params.outputDir}`)

  view.unmount()
})

test('识别不到字段的发票：标「信息不全」、不能勾选、不进明细，补全后才可导出；重新扫描保留补全结果', async () => {
  const { host, dllCalls } = installInvoiceHost({
    files: [starbucks(), unreadable()],
    parse: () => ({ ok: true, invoices: [starbucks(), unreadable()] })
  })
  const view = await mount(InvoiceAssistantCommand, host)
  await settle()

  const item = view.item('inv-scan')
  assert.equal(item.props.title, '扫描件_发票.pdf', '不能用占位值拼出归档文件名')
  assert.equal(item.props.subtitle, '未识别：发票号码、销售方、购买方、价税合计、税额；开票日期待核对')
  assert.equal(item.props.checked, false)
  assert.ok(item.props.accessories.some((a) => a.tag?.value === '信息不全'))
  assert.ok(item.props.accessories.some((a) => a.text === '金额未识别'))
  assert.ok(!item.props.accessories.some((a) => a.progress), '金额未识别时不画金额比例条')
  assert.match(view.tree().props.filterBar.props?.summaryText ?? view.tree().props.filterBar.summaryText, /信息不全 1 张/)
  assert.equal(view.actions(item)[0].props.title, '补全未识别的发票信息', '回车先补全')

  // 手动勾选被拒绝
  item.props.onCheckChange(true)
  await settle()
  assert.equal(view.item('inv-scan').props.checked, false)
  assert.match(String(host.lastToast()?.title), /有未识别的字段，补全后才能勾选/)

  // 全选也跳过信息不全的发票
  view.tree().props.subList.onCheckChange(true)
  await settle()
  assert.equal(view.item('inv-scan').props.checked, false)
  assert.equal(view.item('inv-real-1').props.checked, true)

  // 复制明细只含字段完整的已选发票
  await view.run(view.item('inv-real-1'), '复制已选发票的报销明细 (Excel TSV)')
  assert.equal(host.clipboard.text.split('\n').length, 2)
  assert.ok(!host.clipboard.text.includes('扫描件_发票'))

  // 打开补全表单：已识别的值预填，未识别的留空，今天的日期提示核对
  await view.run(view.item('inv-scan'), '补全未识别的发票信息')
  assert.equal(host.pushed.length, 1)
  const form = await mountPushed(host)
  assert.equal(form.field('invoiceNo').props.value, '')
  assert.equal(form.field('totalAmount').props.value, '')
  assert.equal(form.field('issueDate').props.value, localDateKey())
  assert.match(String(form.field('issueDate').props.info), /请对照发票核对/)

  // 直接保存：逐项报错，不写回
  await form.run(undefined, '保存发票信息')
  assert.equal(host.lastToast()?.title, '请先修正标红的字段')
  assert.ok(form.field('invoiceNo').props.error)
  assert.ok(form.field('sellerName').props.error)
  assert.equal(host.pushed.length, 1)
  assert.equal(view.item('inv-scan').props.checked, false)

  await form.fill('invoiceNo', '24312000000011112222')
  await form.fill('issueDate', '2026-10-15')
  await form.fill('sellerName', '某某餐饮管理有限公司')
  await form.fill('buyerName', '上海某某科技有限公司')
  await form.fill('totalAmount', '56.00')
  await form.fill('taxAmount', '3.17')
  assert.equal(form.field('invoiceNo').props.error, undefined, '修改后清除该字段的错误')
  await form.run(undefined, '保存发票信息')
  await settle()
  assert.equal(host.lastToast()?.title, '已保存发票信息')
  assert.equal(host.pushed.length, 0, '保存成功后返回列表')
  form.unmount()

  const fixed = view.item('inv-scan')
  assert.equal(fixed.props.title, '[其他费用]_2026-10-15_某某餐饮管理有限公司_56.00元_2222.pdf')
  assert.equal(fixed.props.checked, true, '补全且抬头正常后自动勾选')
  assert.doesNotMatch(view.tree().props.filterBar.props?.summaryText ?? view.tree().props.filterBar.summaryText, /信息不全/)

  // 补全后的发票随已选一起导出，写入用户填写的值
  await view.run(fixed, '生成报销归档：规范命名副本 + 明细 CSV (2张 · ¥144.00)')
  const csvCall = exportCalls(dllCalls).find((c) => c.func === 'ExportInvoicesCsv')
  const sent = csvCall.params.invoices.find((i) => i.path.endsWith('扫描件_发票.pdf'))
  assert.equal(sent.invoiceNo, '24312000000011112222')
  assert.equal(sent.issueDate, '2026-10-15')
  assert.equal(sent.totalAmount, 56)

  // 重新扫描后保留手动补全的字段
  const rescan = view.tree().props.filterBar
  const actions = rescan.props?.actions ?? rescan.actions
  await actions.find((a) => a.id === 'rescan-invoices-btn').onAction()
  await settle()
  assert.equal(view.item('inv-scan').props.title, '[其他费用]_2026-10-15_某某餐饮管理有限公司_56.00元_2222.pdf')

  view.unmount()
})

test('扫描失败：显示失败提示与错误状态，不显示示例数据或空成功', async () => {
  const { host } = installInvoiceHost({
    files: [starbucks()],
    parse: () => {
      throw new Error('原生组件崩溃')
    }
  })
  const view = await mount(InvoiceAssistantCommand, host)
  await settle()
  const tree = view.tree()
  assert.equal(tree.props.subList.items.length, 0)
  assert.match(tree.props.subList.emptyText, /^扫描失败：.*原生组件崩溃/)
  assert.ok(host.toasts.some((t) => t.title === '扫描电子发票失败' && /原生组件崩溃/.test(t.message)))
  assert.ok(!host.toasts.some((t) => t.style === 'SUCCESS' || /已扫描/.test(String(t.title))), '不能报扫描成功')
  view.unmount()

  // 拿不到系统目录（例如不在客户端里运行）：如实报错，不拿示例发票充数
  const bare = createHost()
  const view2 = await mount(InvoiceAssistantCommand, bare)
  await settle()
  assert.equal(view2.tree().props.subList.items.length, 0)
  assert.match(view2.tree().props.subList.emptyText, /扫描失败：无法获取下载、桌面、文档目录/)
  view2.unmount()
})

test('部分文件读取失败：提示失败数量，左侧列出失败项并可复制原因', async () => {
  const { host } = installInvoiceHost({
    files: [starbucks()],
    parse: () => ({
      ok: true,
      invoices: [starbucks()],
      errors: [{ file: 'D:\\TestInvoices\\downloads\\坏文件.pdf', error: '文件被占用' }]
    })
  })
  const view = await mount(InvoiceAssistantCommand, host)
  await settle()
  assert.ok(host.toasts.some((t) => t.title === '1 个文件读取或识别失败' && /坏文件\.pdf：文件被占用/.test(t.message)))
  const fb = view.tree().props.filterBar
  assert.match(fb.props?.summaryText ?? fb.summaryText, /读取失败 1 个文件/)
  const errItem = view.item('audit-parse-errors')
  await view.run(errItem, '复制失败文件与原因')
  assert.equal(host.clipboard.text, 'D:\\TestInvoices\\downloads\\坏文件.pdf\t文件被占用')
  view.unmount()
})

test('导出失败如实报错；只导出 CSV 时只调用 CSV 接口', async () => {
  const { host, dllCalls } = installInvoiceHost({
    files: [starbucks()],
    parse: () => ({ ok: true, invoices: [starbucks()] }),
    exportImpl: {
      BatchRenameInvoices: () => ({ ok: false, error: 'ACCESS_DENIED: 目录只读' })
    }
  })
  const view = await mount(InvoiceAssistantCommand, host)
  await settle()
  await view.run(view.item('inv-real-1'), '生成报销归档：规范命名副本 + 明细 CSV (1张 · ¥88.00)')
  assert.equal(host.lastToast()?.title, '生成报销归档失败')
  assert.match(String(host.lastToast()?.message), /ACCESS_DENIED/)
  assert.deepEqual(exportCalls(dllCalls).map((c) => c.func), ['BatchRenameInvoices'], '复制失败后不再生成 CSV')

  dllCalls.length = 0
  await view.run(view.item('inv-real-1'), '仅导出已选发票的报销明细 (.csv)')
  assert.deepEqual(exportCalls(dllCalls).map((c) => c.func), ['ExportInvoicesCsv'])
  assert.match(String(host.lastToast()?.title), /已导出 1 张发票的报销明细 CSV/)

  // 什么都没勾选时不调用宿主
  dllCalls.length = 0
  view.item('inv-real-1').props.onCheckChange(false)
  await settle()
  await view.run(view.item('inv-real-1'), '仅导出已选发票的报销明细 (.csv)')
  assert.equal(exportCalls(dllCalls).length, 0)
  assert.equal(host.lastToast()?.title, '请先勾选至少 1 张需要报销的电子发票')
  view.unmount()
})

test('从「差旅发票」进入：同时列出交通与住宿发票（宿主分类名已换成插件分类）', async () => {
  const taxi = starbucks({ id: 'taxi', path: 'D:\\TestInvoices\\downloads\\发票_taxi.pdf', fileName: '发票_taxi.pdf', invoiceNo: '24312000000000000001', category: '差旅交通' })
  const hotel = starbucks({ id: 'hotel', path: 'D:\\TestInvoices\\downloads\\发票_hotel.pdf', fileName: '发票_hotel.pdf', invoiceNo: '24312000000000000002', category: '酒店住宿' })
  const meal = starbucks({ id: 'meal', path: 'D:\\TestInvoices\\downloads\\发票_meal.pdf', fileName: '发票_meal.pdf', invoiceNo: '24312000000000000003' })
  const { host } = installInvoiceHost({
    files: [taxi, hotel, meal],
    parse: () => ({ ok: true, invoices: [taxi, hotel, meal] })
  })
  globalThis.__ztoolsLaunchContext = { pluginId: 'invoice-assistant', featureCode: 'invoice-travel' }
  try {
    const view = await mount(InvoiceAssistantCommand, host)
    await settle()
    const ids = view.tree().props.subList.items.map((i) => i.props.id)
    assert.deepEqual(ids.sort(), ['hotel', 'taxi'])
    assert.ok(view.item('taxi').props.title.startsWith('[交通出行]_'))
    assert.ok(view.item('hotel').props.title.startsWith('[差旅住宿]_'))
    view.unmount()
  } finally {
    delete globalThis.__ztoolsLaunchContext
  }
})

test('界面配色：只有重复发票号与读取失败用红色，信息不全、抬头异常和图标保持灰阶', async () => {
  const { Color } = await import('@ztools/declarative-ui')
  const dup = starbucks({ id: 'inv-real-2', path: 'D:\\TestInvoices\\downloads\\重复.pdf', fileName: '重复.pdf' })
  const personal = starbucks({
    id: 'inv-personal',
    path: 'D:\\TestInvoices\\downloads\\个人抬头.pdf',
    fileName: '个人抬头.pdf',
    invoiceNo: '24312000000011112222',
    buyerName: '个人',
    isHeaderAbnormal: true
  })
  const { host } = installInvoiceHost({
    files: [starbucks(), dup, unreadable(), personal],
    parse: () => ({ ok: true, invoices: [starbucks(), { ...dup, isDuplicate: true }, unreadable(), personal] })
  })
  const view = await mount(InvoiceAssistantCommand, host)
  await settle()
  const tagOf = (id) => view.item(id).props.accessories.find((a) => a.tag)?.tag
  assert.equal(tagOf('inv-real-2').value, '重复发票号')
  assert.equal(tagOf('inv-real-2').color, Color.Red)
  assert.equal(tagOf('inv-scan').value, '信息不全')
  assert.equal(tagOf('inv-scan').color, undefined)
  assert.equal(tagOf('inv-personal').value, '抬头异常')
  assert.equal(tagOf('inv-personal').color, undefined)
  for (const id of ['inv-real-2', 'inv-scan', 'inv-personal', 'audit-duplicate', 'audit-header', 'audit-incomplete']) {
    assert.notEqual(view.item(id).props.icon?.tintColor, Color.Red, `${id} 的图标不能是红色`)
  }
  assert.equal(view.item('audit-header').props.accessories[0].tag.color, undefined)
  assert.equal(view.item('audit-incomplete').props.accessories[0].tag.color, undefined)
  assert.equal(view.item('audit-duplicate').props.accessories[0].tag.color, Color.Red)
  view.unmount()
})
