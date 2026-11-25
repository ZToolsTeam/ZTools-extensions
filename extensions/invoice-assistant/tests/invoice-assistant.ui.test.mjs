import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHost, installDirectoryHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import InvoiceAssistantCommand from '../dist/index.js'

const settle = () => tick(30)

function localDateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function makeTempTree(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-invoice-ui-'))
  for (const [rel, content] of Object.entries(spec)) {
    const full = path.join(root, rel)
    if (rel.endsWith('/')) {
      fs.mkdirSync(full, { recursive: true })
      continue
    }
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return root
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

/** 构造基于交互导入的宿主桩（绝不预置启动目录扫描） */
function installInvoiceHost({ parseMap = {}, parse, exportImpl = {}, trashImpl } = {}) {
  const host = createHost()
  const dllCalls = []
  host.ipc.filesystem_get_file_size = async ({ path: p }) => ({
    success: true,
    size: fs.existsSync(p) && fs.statSync(p).isFile() ? fs.statSync(p).size : 128000
  })
  host.ipc.shell_trash_item = async (params) => {
    if (trashImpl) return trashImpl(params)
    return { success: true }
  }
  host.ipc.dllplugin_call = async ({ func, params }) => {
    dllCalls.push({ func, params })
    if (func === 'ParseInvoices') {
      if (parse) return parse(params)
      const files = params.files || []
      const invoices = []
      const errors = []
      for (const p of files) {
        const mapped = parseMap[p]
        if (mapped instanceof Error) {
          errors.push({ file: p, error: mapped.message })
        } else if (mapped) {
          invoices.push(mapped)
        } else {
          invoices.push(
            starbucks({
              path: p,
              fileName: path.basename(p),
              invoiceNo: `243120000000${String(invoices.length + 10000000).slice(0, 8)}`
            })
          )
        }
      }
      return { ok: true, invoices, errors }
    }
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

function parseCalls(dllCalls) {
  return dllCalls.filter((c) => c.func === 'ParseInvoices')
}

const subItems = (view) => view.tree().props.subList.items
const rowByPath = (view, p) => subItems(view).find((i) => i.props.id.endsWith(`-${p}`))
const fbActions = (view) => view.tree().props.filterBar.props.actions

const FORBIDDEN_MOUNT_METHODS = new Set([
  'system_get_path',
  'system_list_common_folders',
  'system_search_files',
  'filesystem_get_directory_contents',
  'dllplugin_call'
])

test('挂载零扫盘：不调用任何目录扫描或系统路径接口，顶栏恰为「选择文件」「选择文件夹」2 个按钮', async () => {
  const { host } = installInvoiceHost()
  const view = await mount(InvoiceAssistantCommand, host)
  await settle()

  const mountCalls = host.ipcCalls.map(([m]) => m)
  assert.equal(mountCalls.some((m) => FORBIDDEN_MOUNT_METHODS.has(m)), false, `挂载不应扫盘，实际：${mountCalls.join(', ')}`)
  assert.equal(subItems(view).length, 0)

  const tree = view.tree()
  assert.equal(tree.type, 'List')
  assert.equal(tree.props.isShowingDetail, false)
  assert.equal(/[\u{1F300}-\u{1FAFF}]/u.test(view.text()), false, 'UI 严禁包含彩色 Emoji')

  assert.deepEqual(
    fbActions(view).map((a) => a.id),
    ['pick-files', 'pick-folder']
  )
  assert.deepEqual(
    fbActions(view).map((a) => a.label),
    ['选择文件', '选择文件夹']
  )
  assert.match(tree.props.filterBar.props.summaryText, /尚未添加电子发票/)
  assert.match(tree.props.subList.emptyText, /尚未添加电子发票/)
  assert.deepEqual(
    view.actions().map((a) => a.props.title),
    ['选择文件…', '选择文件夹…']
  )
  assert.equal('extensions' in (tree.props.fileInput || {}), false, '不把扩展名交给宿主过滤')
  assert.equal(tree.props.fileInput?.allowDirectories, true)

  view.unmount()

  // 非 ZTools 客户端环境中如实提示
  const prevElectron = globalThis.__ztoolsElectron
  const prevWindow = globalThis.window
  try {
    delete globalThis.__ztoolsElectron
    if (globalThis.window) delete globalThis.window.ztools
    const bareView = await mount(InvoiceAssistantCommand)
    await settle()
    assert.match(bareView.tree().props.filterBar.props.summaryText, /需要在 ZTools 客户端中使用/)
    assert.match(bareView.tree().props.subList.emptyText, /需要在 ZTools 客户端中使用/)
    bareView.unmount()
  } finally {
    globalThis.__ztoolsElectron = prevElectron
    globalThis.window = prevWindow
  }
})

test('选择文件、选择文件夹与拖入文件夹（含新旧客户端与导出目录排除、50 个分批解析、去重与不改已有勾选）', async () => {
  const root = makeTempTree({
    'invoice_a.pdf': 'pdf-a',
    'sub/invoice_b.ofd': 'ofd-b',
    'sub/invoice_c.xml': 'xml-c',
    'v2.1_pics/receipt.jpg': 'jpg-d',
    'note.txt': 'txt',
    'empty.pdf': '',
    'ZTools_Reimbursement_Export/old/副本.pdf': 'old',
    '报销发票明细汇总表.xml': 'exported-xml'
  })
  const invA = path.join(root, 'invoice_a.pdf')
  const invB = path.join(root, 'sub/invoice_b.ofd')
  const invC = path.join(root, 'sub/invoice_c.xml')
  const picD = path.join(root, 'v2.1_pics/receipt.jpg')
  const dottedDir = path.join(root, 'v2.1_pics')

  try {
    const { host, dllCalls } = installInvoiceHost({
      parseMap: {
        [invA]: starbucks({ path: invA, fileName: 'invoice_a.pdf', invoiceNo: '24312000000010000001', category: '餐饮招待' }),
        [invB]: starbucks({ path: invB, fileName: 'invoice_b.ofd', invoiceNo: '24312000000010000002', category: '交通出行' }),
        [invC]: starbucks({ path: invC, fileName: 'invoice_c.xml', invoiceNo: '24312000000010000001', category: '办公采购' }), // 与 A 同号重复
        [picD]: starbucks({ path: picD, fileName: 'receipt.jpg', invoiceNo: '24312000000010000003', category: '差旅住宿' })
      }
    })
    await installDirectoryHost(host, { authorized: [root] })

    // 1. 选择文件导入 invA（对话框 filters 含全部 6 种格式）
    host.ipc.window_show_open_dialog = async () => ({
      canceled: false,
      filePaths: [invA, path.join(root, 'note.txt'), path.join(root, 'ZTools_Reimbursement_Export/old/副本.pdf')]
    })
    const view = await mount(InvoiceAssistantCommand, host)
    await settle()

    await fbActions(view)[0].onAction()
    await settle()

    const dialogCall = host.ipcCalls.find(([m]) => m === 'window_show_open_dialog')
    assert.equal(dialogCall[1].filters, '电子发票|pdf;ofd;xml;jpg;jpeg;png')
    assert.equal(parseCalls(dllCalls).length, 1)
    assert.deepEqual(parseCalls(dllCalls)[0].params.files, [invA])
    assert.equal(subItems(view).length, 1)
    assert.equal(rowByPath(view, invA).props.checked, true)
    assert.match(view.tree().props.filterBar.props.summaryText, /清空列表 Ctrl\+Shift\+Backspace/)

    // 用户手动取消勾选 invA
    rowByPath(view, invA).props.onCheckChange(false)
    await settle()
    assert.equal(rowByPath(view, invA).props.checked, false)

    // 2. 选择文件夹导入 root（含 invA, invB, invC, picD，自动跳过导出目录与汇总产物）
    host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: root })
    await fbActions(view)[1].onAction()
    await settle()

    // 仅对新增的 3 个文件调用 ParseInvoices（已存在的 invA 绝不重新解析，且不恢复 invA 的手动取消勾选）
    assert.equal(parseCalls(dllCalls).length, 2)
    assert.deepEqual(parseCalls(dllCalls)[1].params.files.sort(), [invB, invC, picD].sort())
    assert.equal(subItems(view).length, 4)
    assert.equal(rowByPath(view, invA).props.checked, false, '已有项勾选状态绝不能被重新导入改动')
    assert.equal(rowByPath(view, invA).props.accessories.some((a) => a.tag?.value === '重复发票号'), false, '已有发票在前，不能被后导入重复票反标为重复')
    assert.equal(rowByPath(view, invB).props.checked, true)
    assert.equal(rowByPath(view, invC).props.checked, false, '与已有票重号的新导入发票不能默认勾选')
    assert.equal(rowByPath(view, invC).props.accessories.some((a) => a.tag?.value === '重复发票号'), true)
    assert.equal(rowByPath(view, picD).props.checked, true)

    // 3. 再次拖入文件夹（含带点的文件夹名）与已存在文件：全部去重不发 ParseInvoices
    await view.dropFiles([dottedDir, invA], { directories: [dottedDir] })
    await settle()
    assert.equal(parseCalls(dllCalls).length, 2)
    assert.equal(host.lastToast()?.style, 'FAILURE')
    assert.equal(host.lastToast()?.title, '这些文件已在列表中')

    // 4. 取消弹窗与令牌超限报错
    const beforeToasts = host.toasts.length
    host.ipc.window_show_open_dialog = async () => ({ canceled: true })
    await fbActions(view)[0].onAction()
    await settle()
    assert.equal(host.toasts.length, beforeToasts)

    host.ipc.window_show_open_dialog = async () => {
      throw new Error('当前窗口的文件 capability 数量超过上限')
    }
    await fbActions(view)[0].onAction()
    await settle()
    assert.equal(host.lastToast()?.style, 'FAILURE')
    assert.match(String(host.lastToast()?.message), /改用「选择文件夹」/)

    view.unmount()

    // 5. 旧版客户端（无 directories 且 fileInput: false 时走 plugin_files_dropped）与超过 500 个截断 + 50 批解析
    const legacyHost = installInvoiceHost().host
    await installDirectoryHost(legacyHost, { authorized: [root] })
    legacyHost.ipc.filesystem_directory_exists = async ({ path: p }) => ({
      success: true,
      exists: fs.existsSync(p) && fs.statSync(p).isDirectory()
    })
    const legacyView = await mount(InvoiceAssistantCommand, legacyHost)
    await settle()
    await legacyView.dropFiles([dottedDir])
    await settle()
    assert.equal(subItems(legacyView).length, 1)
    assert.equal(legacyHost.ipcCalls.some(([m]) => m === 'filesystem_directory_exists'), true)
    legacyView.unmount()

    const { host: oldHost } = installInvoiceHost()
    await installDirectoryHost(oldHost, { authorized: [root] })
    oldHost.ipc.filesystem_directory_exists = async ({ path: p }) => ({
      success: true,
      exists: fs.existsSync(p) && fs.statSync(p).isDirectory()
    })
    globalThis.window.__ztoolsDeclarativeFeatures = { fileInput: false }
    const oldView = await mount(InvoiceAssistantCommand, oldHost)
    await settle()
    oldHost.emitEvent('plugin_files_dropped', { payload: { files: [dottedDir] } })
    await settle()
    assert.equal(subItems(oldView).length, 1)
    oldView.unmount()
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('大文件夹超过 500 个截断并按每批 50 个分批解析；单批失败不阻断其他批次并如实汇报', async () => {
  const { host, dllCalls } = installInvoiceHost({
    parse: (params) => {
      // 第 2 批模拟失败
      if (parseCalls(dllCalls).length === 2) {
        return { ok: false, error: '路径未由当前窗口授权' }
      }
      return {
        ok: true,
        invoices: params.files.map((p, idx) =>
          starbucks({
            path: p,
            fileName: path.basename(p),
            invoiceNo: `24312000${String(parseCalls(dllCalls).length).padStart(2, '0')}${String(idx).padStart(10, '0')}`
          })
        )
      }
    }
  })
  host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: 'D:\\BigInvoices' })
  host.ipc.filesystem_get_directory_contents = async () => ({
    success: true,
    files: Array.from({ length: 120 }, (_, i) => ({
      name: `fp_${String(i + 1).padStart(3, '0')}.pdf`,
      size: 2048,
      isDirectory: false,
      lastModified: '2026-10-01T00:00:00Z'
    }))
  })

  const view = await mount(InvoiceAssistantCommand, host)
  await settle()
  await fbActions(view)[1].onAction()
  await tick(50)

  const batches = parseCalls(dllCalls)
  assert.deepEqual(batches.map((b) => b.params.files.length), [50, 50, 20])
  // 第 1、3 批共 70 张成功入列，第 2 批 50 个进入 parseErrors
  assert.equal(subItems(view).length, 70)
  assert.equal(host.lastToast()?.style, 'FAILURE')
  assert.match(String(host.lastToast()?.title), /已添加 70 张，50 个文件读取或识别失败/)
  assert.match(String(host.lastToast()?.message), /文件授权已过期或未授权/)
  const errItem = view.item('audit-parse-errors')
  await view.run(errItem, '复制失败文件与原因')
  assert.equal(host.clipboard.text.split('\n').length, 50)

  // 超过 500 个文件触发截断并提示，同时按每批 50 个共分 10 批调用 ParseInvoices
  dllCalls.length = 0
  host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: 'D:\\HugeInvoices' })
  host.ipc.filesystem_get_directory_contents = async () => ({
    success: true,
    files: Array.from({ length: 505 }, (_, i) => ({
      name: `huge_${String(i + 1).padStart(3, '0')}.pdf`,
      size: 2048,
      isDirectory: false,
      lastModified: '2026-10-01T00:00:00Z'
    }))
  })
  host.ipc.dllplugin_call = async ({ func, params }) => {
    dllCalls.push({ func, params })
    return {
      ok: true,
      invoices: params.files.map((p, idx) =>
        starbucks({
          path: p,
          fileName: path.basename(p),
          invoiceNo: `24312099${String(dllCalls.length).padStart(2, '0')}${String(idx).padStart(10, '0')}`
        })
      )
    }
  }
  await fbActions(view)[1].onAction()
  await tick(80)
  assert.equal(parseCalls(dllCalls).length, 10)
  assert.equal(subItems(view).length, 570)
  assert.equal(host.lastToast()?.style, 'SUCCESS')
  assert.match(String(host.lastToast()?.message), /文件较多，只导入了一部分/)

  // 选中盘符根目录确认取消时不遍历目录
  host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: 'Z:\\' })
  host.setConfirm(false)
  const beforeDirCalls = host.ipcCalls.filter(([m]) => m === 'filesystem_get_directory_contents').length
  await fbActions(view)[1].onAction()
  await settle()
  assert.equal(host.confirms.length, 1)
  assert.equal(host.ipcCalls.filter(([m]) => m === 'filesystem_get_directory_contents').length, beforeDirCalls)

  view.unmount()
})

test('从列表移除（不删原件）、移入回收站、清空列表、导出中防清空与导入途中清空丢弃过期结果', async () => {
  const root = makeTempTree({
    'one.pdf': 'pdf-1',
    'two.pdf': 'pdf-2'
  })
  const p1 = path.join(root, 'one.pdf')
  const p2 = path.join(root, 'two.pdf')

  try {
    let releaseExport
    const exportGate = new Promise((r) => (releaseExport = r))
    const { host } = installInvoiceHost({
      parseMap: {
        [p1]: starbucks({ path: p1, fileName: 'one.pdf', invoiceNo: '24312000000011111111' }),
        [p2]: starbucks({ path: p2, fileName: 'two.pdf', invoiceNo: '24312000000011111111' }) // 与 p1 同号重复
      },
      exportImpl: {
        BatchRenameInvoices: async (params) => {
          await exportGate
          return {
            ok: true,
            outputDir: params.outputDir,
            renamedFiles: params.invoices.map((i) => `${params.outputDir}\\${i.targetFileName}`)
          }
        }
      }
    })
    await installDirectoryHost(host, { authorized: [root] })
    host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: root })

    const view = await mount(InvoiceAssistantCommand, host)
    await settle()
    await fbActions(view)[1].onAction()
    await settle()

    assert.equal(subItems(view).length, 2)
    assert.equal(rowByPath(view, p2).props.accessories.some((a) => a.tag?.value === '重复发票号'), true)

    // 从列表移除 p1（不删磁盘原件），p2 解除重复标记
    await view.run(rowByPath(view, p1), '从列表移除（不删原件）')
    await settle()
    assert.equal(subItems(view).length, 1)
    assert.equal(fs.existsSync(p1), true, '从列表移除绝不能删除原件')
    assert.equal(rowByPath(view, p2).props.accessories.some((a) => a.tag?.value === '重复发票号'), false)

    // 勾选 p2 并触发导出；导出途中隐藏「从列表移除（不删原件）」，点「清空列表」被拒绝
    rowByPath(view, p2).props.onCheckChange(true)
    await settle()
    const exportAction = view.actions(rowByPath(view, p2)).find((a) => a.props.title.startsWith('生成报销归档'))
    const exportingPromise = exportAction.props.onAction()
    await tick(5)
    assert.equal(view.actions(rowByPath(view, p2)).some((a) => a.props.title === '从列表移除（不删原件）'), false)
    await view.run(rowByPath(view, p2), '清空列表')
    assert.equal(host.lastToast()?.title, '正在处理，完成后再清空')
    assert.equal(subItems(view).length, 1)

    releaseExport()
    await exportingPromise
    await settle()

    // 空闲时清空列表，不碰磁盘文件
    await view.run(rowByPath(view, p2), '清空列表')
    await settle()
    assert.equal(subItems(view).length, 0)
    assert.equal(fs.existsSync(p2), true)

    // 导入途中点清空列表：先放入 p1，再发起慢导入 -> 途中点清空 -> 过期导入返回被丢弃
    await view.dropFiles([p1])
    await settle()
    assert.equal(subItems(view).length, 1)

    let releaseSlowDir
    const slowDirGate = new Promise((r) => (releaseSlowDir = r))
    host.ipc.window_show_select_folder_dialog = async () => ({ canceled: false, folderPath: 'D:\\SlowInvoices' })
    host.ipc.filesystem_get_directory_contents = async () => {
      await slowDirGate
      return {
        success: true,
        files: [{ name: 'stale.pdf', size: 1024, isDirectory: false, lastModified: '2026-10-01T00:00:00Z' }]
      }
    }
    const slowImportPromise = fbActions(view)[1].onAction()
    await tick(5)
    assert.match(view.tree().props.filterBar.props.summaryText, /正在导入/)
    const toastCountBeforeClear = host.toasts.length
    await view.run(rowByPath(view, p1), '清空列表')
    await settle()
    assert.equal(subItems(view).length, 0)

    releaseSlowDir()
    await slowImportPromise
    await settle()
    assert.equal(subItems(view).length, 0, '导入途中清空后过期结果必须丢弃')
    assert.equal(host.toasts.length, toastCountBeforeClear, '过期导入结果不应弹 Toast')

    // ParseInvoices 解析途中点清空列表：过期解析结果同样被丢弃
    await view.dropFiles([p1])
    await settle()
    assert.equal(subItems(view).length, 1)
    let releaseSlowParse
    const slowParseGate = new Promise((r) => (releaseSlowParse = r))
    const origDll = host.ipc.dllplugin_call
    host.ipc.dllplugin_call = async (req) => {
      if (req.func === 'ParseInvoices') await slowParseGate
      return origDll(req)
    }
    const slowParsePromise = view.dropFiles([p2])
    await tick(5)
    assert.match(view.tree().props.filterBar.props.summaryText, /正在导入.*正在识别/)
    const toastCountAtParse = host.toasts.length
    await view.run(rowByPath(view, p1), '清空列表')
    await settle()
    assert.equal(subItems(view).length, 0)
    releaseSlowParse()
    await slowParsePromise
    await settle()
    host.ipc.dllplugin_call = origDll
    assert.equal(subItems(view).length, 0, '解析途中清空后过期解析回写必须丢弃')
    assert.equal(host.toasts.length, toastCountAtParse, '过期解析回写不应弹 Toast')

    // 区分「将当前发票原件移入系统回收站」（确实调用 shell_trash_item）
    await view.dropFiles([p1])
    await settle()
    host.setConfirm(true)
    await view.run(rowByPath(view, p1), '将当前发票原件移入系统回收站')
    await settle()
    assert.equal(host.ipcCalls.some(([m]) => m === 'shell_trash_item'), true)
    assert.equal(subItems(view).length, 0)

    view.unmount()
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('invoice-assistant 核心业务：左科目树+右发票列表、重复票拦截、切换分类、Excel TSV、归档导出、补全表单与灰阶配色', async () => {
  const { Color } = await import('@ztools/declarative-ui')
  const validPath = 'D:\\TestInvoices\\downloads\\电子发票_星巴克_01.pdf'
  const dupPath = 'D:\\TestInvoices\\downloads\\电子发票_星巴克_重复副本.pdf'
  const scanPath = 'D:\\TestInvoices\\downloads\\扫描件_发票.pdf'
  const personalPath = 'D:\\TestInvoices\\downloads\\个人抬头.pdf'

  const { host, dllCalls } = installInvoiceHost({
    parseMap: {
      [validPath]: starbucks({ path: validPath }),
      [dupPath]: starbucks({ path: dupPath, fileName: '电子发票_星巴克_重复副本.pdf' }),
      [scanPath]: unreadable({ path: scanPath }),
      [personalPath]: starbucks({
        path: personalPath,
        fileName: '个人抬头.pdf',
        invoiceNo: '24312000000011112222',
        buyerName: '个人'
      })
    }
  })
  host.ipc.window_show_open_dialog = async () => ({
    canceled: false,
    filePaths: [validPath, dupPath, scanPath, personalPath]
  })

  const view = await mount(InvoiceAssistantCommand, host)
  await settle()
  await fbActions(view)[0].onAction()
  await settle()

  const validItem = rowByPath(view, validPath)
  const dupItem = rowByPath(view, dupPath)
  const scanItem = rowByPath(view, scanPath)
  const personalItem = rowByPath(view, personalPath)

  assert.equal(validItem.props.checked, true)
  assert.equal(dupItem.props.checked, false)
  assert.equal(scanItem.props.checked, false)
  assert.equal(personalItem.props.checked, false)

  // 重复票禁止勾选
  dupItem.props.onCheckChange(true)
  await settle()
  assert.equal(rowByPath(view, dupPath).props.checked, false)
  assert.match(String(host.lastToast()?.title), /发票号码与其他发票重复/)

  // 信息不全禁止勾选
  scanItem.props.onCheckChange(true)
  await settle()
  assert.equal(rowByPath(view, scanPath).props.checked, false)
  assert.match(String(host.lastToast()?.title), /有未识别的字段，补全后才能勾选/)

  // 灰阶配色：只有重复发票号用红色
  const tagOf = (item) => item.props.accessories.find((a) => a.tag)?.tag
  assert.equal(tagOf(rowByPath(view, dupPath)).color, Color.Red)
  assert.equal(tagOf(rowByPath(view, scanPath)).color, undefined)
  assert.equal(tagOf(rowByPath(view, personalPath)).color, undefined)
  assert.equal(view.item('audit-duplicate').props.accessories[0].tag.color, Color.Red)
  assert.equal(view.item('audit-header').props.accessories[0].tag.color, undefined)
  assert.equal(view.item('audit-incomplete').props.accessories[0].tag.color, undefined)

  // 切换费用分类、复制 Excel TSV、生成报销归档
  await view.run(validItem, '切换费用分类 (当前: 餐饮招待)')
  assert.ok(rowByPath(view, validPath).props.title.startsWith('[交通出行]_'))
  await view.run(rowByPath(view, validPath), '复制已选发票的报销明细 (Excel TSV)')
  assert.ok(host.clipboard.text.includes('24312000000099887766\t2026-10-20\t交通出行'))

  await view.run(rowByPath(view, validPath), '生成报销归档：规范命名副本 + 明细 CSV (1张 · ¥88.00)')
  const calls = exportCalls(dllCalls)
  assert.deepEqual(calls.map((c) => c.func), ['BatchRenameInvoices', 'ExportInvoicesCsv'])

  // 打开补全表单并保存
  await view.run(rowByPath(view, scanPath), '补全未识别的发票信息')
  const form = await mountPushed(host)
  await form.run(undefined, '保存发票信息')
  assert.equal(host.lastToast()?.title, '请先修正标红的字段')
  await form.fill('invoiceNo', '24312000000033334444')
  await form.fill('issueDate', '2026-10-15')
  await form.fill('sellerName', '某某餐饮管理有限公司')
  await form.fill('buyerName', '上海某某科技有限公司')
  await form.fill('totalAmount', '56.00')
  await form.fill('taxAmount', '3.17')
  await form.run(undefined, '保存发票信息')
  await settle()
  form.unmount()

  const fixed = rowByPath(view, scanPath)
  assert.equal(fixed.props.title, '[其他费用]_2026-10-15_某某餐饮管理有限公司_56.00元_4444.pdf')
  assert.equal(fixed.props.checked, true)

  // 仅导出 CSV
  dllCalls.length = 0
  await view.run(fixed, '仅导出已选发票的报销明细 (.csv)')
  assert.deepEqual(exportCalls(dllCalls).map((c) => c.func), ['ExportInvoicesCsv'])

  view.unmount()
})

test('从「差旅发票」进入：导入不同分类后仅显示交通与住宿发票', async () => {
  const taxi = 'D:\\TestInvoices\\downloads\\发票_taxi.pdf'
  const hotel = 'D:\\TestInvoices\\downloads\\发票_hotel.pdf'
  const meal = 'D:\\TestInvoices\\downloads\\发票_meal.pdf'

  const { host } = installInvoiceHost({
    parseMap: {
      [taxi]: starbucks({ path: taxi, fileName: '发票_taxi.pdf', invoiceNo: '24312000000000000001', category: '差旅交通' }),
      [hotel]: starbucks({ path: hotel, fileName: '发票_hotel.pdf', invoiceNo: '24312000000000000002', category: '酒店住宿' }),
      [meal]: starbucks({ path: meal, fileName: '发票_meal.pdf', invoiceNo: '24312000000000000003', category: '餐饮招待' })
    }
  })

  globalThis.__ztoolsLaunchContext = { pluginId: 'invoice-assistant', featureCode: 'invoice-travel' }
  try {
    const view = await mount(InvoiceAssistantCommand, host)
    await settle()
    await view.dropFiles([taxi, hotel, meal])
    await settle()
    const titles = subItems(view).map((i) => i.props.title)
    assert.equal(titles.length, 2)
    assert.ok(titles.some((t) => t.startsWith('[交通出行]_')))
    assert.ok(titles.some((t) => t.startsWith('[差旅住宿]_')))
    view.unmount()
  } finally {
    delete globalThis.__ztoolsLaunchContext
  }
})
