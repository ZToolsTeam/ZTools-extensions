// 界面集成：真实 SDK 渲染 dist/，经模拟的 preload IPC 走完扫描、导出、失败提示与重复触发防护
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import PdfCommand from '../dist/index.js'

function installScan(host, files) {
  host.ipc.system_get_path = async ({ name }) => (name === 'documents' ? 'D:\\Docs' : '')
  host.ipc.system_search_files = async ({ query }) =>
    query === 'dir:D:\\Docs'
      ? { files: files.map(([name, p, size]) => ({ name, path: p, is_dir: false, size, mtime: 1700000000 })) }
      : { files: [] }
}

const SAMPLE = [
  ['report.pdf', 'D:\\Docs\\report.pdf', 500000],
  ['scan.pdf', 'D:\\Docs\\Scans\\scan.pdf', 300000],
  ['notes.docx', 'D:\\Docs\\notes.docx', 900000]
]

const subItems = view => view.tree().props.subList.items

test('界面只展示可用的导出格式与真实扫描到的 PDF，没有做不到的参数选项', async () => {
  const host = createHost()
  installScan(host, SAMPLE)
  const view = await mount(PdfCommand)
  await tick(10)
  const tree = view.tree()
  assert.deepEqual(subItems(view).map(i => i.props.title), ['report.pdf', 'scan.pdf'])
  assert.equal(subItems(view)[1].props.subtitle, 'D:\\Docs\\Scans')
  const dd = tree.props.searchBarAccessory
  const dropdownValues = (dd.children ?? dd.props.children).map(c => c.props.value)
  assert.deepEqual(dropdownValues, ['pdf-to-txt', 'pdf-to-html'])
  const fieldIds = tree.props.workbenchPanel.fields.map(f => f.id)
  assert.deepEqual(fieldIds, ['wb-format', 'wb-outdir', 'wb-limit', 'wb-unavailable'])
  const text = view.text()
  assert.doesNotMatch(text, /DPI|无损|书签|压缩等级|页码范围|约 \d+ 页/)
  assert.match(tree.props.filterBar.props.summaryText, /已选 0\/2 个 PDF/)
  view.unmount()
})

test('未勾选时主动作导出当前 PDF：先查重名再调用客户端，成功提示给出输出路径', async () => {
  const host = createHost()
  installScan(host, SAMPLE)
  host.ipc.filesystem_file_exists = async ({ path }) => ({ success: true, exists: path === 'D:\\Docs\\report.txt' })
  host.ipc.dllplugin_call = async ({ plugin, func, params }) => ({
    ok: true,
    success: true,
    plugin,
    operation: func,
    outputPath: params.outputPath,
    text: 'Annual report text'
  })
  const view = await mount(PdfCommand)
  await tick(10)
  const item = subItems(view)[0]
  await view.run(item, '导出当前 PDF')
  await tick(10)
  const dll = host.ipcCalls.filter(([m]) => m === 'dllplugin_call')
  assert.equal(dll.length, 1)
  assert.equal(dll[0][1].plugin, 'pdf')
  assert.equal(dll[0][1].params.outputPath, 'D:\\Docs\\report (1).txt')
  const toast = host.lastToast()
  assert.equal(toast.style, 'SUCCESS')
  assert.equal(toast.title, '已导出 1 个文件')
  assert.equal(toast.message, 'D:\\Docs\\report (1).txt')
  const after = subItems(view)[0]
  assert.ok(after.props.accessories.some(a => a.tag?.value === '已导出'))
  assert.ok(view.actions(after).some(a => a.props.title === '在文件夹中显示上次输出'))
  view.unmount()
})

test('勾选多个后批量导出：部分失败按失败提示并给出原因，失败行标出状态', async () => {
  const host = createHost()
  installScan(host, SAMPLE)
  host.ipc.filesystem_file_exists = async () => ({ success: true, exists: false })
  host.ipc.dllplugin_call = async ({ params }) =>
    params.inputPath.endsWith('scan.pdf')
      ? { ok: false, success: false, error: '未能从 PDF 中提取到文字：可能是扫描件' }
      : { ok: true, success: true, outputPath: params.outputPath, text: 'ok text' }
  const view = await mount(PdfCommand)
  await tick(10)
  view.tree().props.subList.onCheckChange(true)
  await tick()
  const first = subItems(view)[0]
  await view.run(first, '导出已勾选的 2 个 PDF')
  await tick(10)
  const toast = host.lastToast()
  assert.equal(toast.style, 'FAILURE')
  assert.equal(toast.title, '1 个已导出，1 个失败')
  assert.match(toast.message, /scan\.pdf：.*扫描件/)
  const scanRow = subItems(view).find(i => i.props.title === 'scan.pdf')
  assert.ok(scanRow.props.accessories.some(a => a.tag?.value === '导出失败'))
  assert.match(view.tree().props.workbenchPanel.previewCard.subtitle, /成功 1 个 · 失败 1 个/)
  view.unmount()
})

test('导出进行中再次触发：提示稍候，不重复调用客户端', async () => {
  const host = createHost()
  installScan(host, SAMPLE.slice(0, 1))
  host.ipc.filesystem_file_exists = async () => ({ success: true, exists: false })
  let release
  const gate = new Promise(r => (release = r))
  host.ipc.dllplugin_call = async ({ params }) => {
    await gate
    return { ok: true, success: true, outputPath: params.outputPath, text: 'slow text' }
  }
  const view = await mount(PdfCommand)
  await tick(10)
  const item = subItems(view)[0]
  const action = view.actions(item).find(a => a.props.title === '导出当前 PDF')
  const firstRun = action.props.onAction()
  await tick(5)
  await action.props.onAction()
  assert.equal(host.lastToast().title, '上一批还在导出，请稍候')
  release()
  await firstRun
  await tick(10)
  assert.equal(host.ipcCalls.filter(([m]) => m === 'dllplugin_call').length, 1)
  assert.equal(host.lastToast().title, '已导出 1 个文件')
  view.unmount()
})

test('扫描失败：提示失败并在状态条与空列表说明原因，不显示示例数据', async () => {
  const host = createHost()
  host.ipc.system_get_path = async () => {
    throw new Error('IPC down')
  }
  const view = await mount(PdfCommand)
  await tick(10)
  const failure = host.toasts.find(t => t.title === '扫描 PDF 失败')
  assert.ok(failure)
  assert.equal(failure.style, 'FAILURE')
  assert.match(view.tree().props.filterBar.props.summaryText, /扫描失败：SYSTEM_PATHS_UNAVAILABLE/)
  assert.equal(subItems(view).length, 0)
  assert.match(view.tree().props.subList.emptyText, /扫描失败/)
  view.unmount()
})

test('打开文件失败时如实提示', async () => {
  const host = createHost()
  installScan(host, SAMPLE.slice(0, 1))
  const view = await mount(PdfCommand)
  await tick(10)
  await view.run(subItems(view)[0], '用默认程序打开 PDF')
  assert.equal(host.lastToast().title, '无法打开文件')
  assert.equal(host.lastToast().style, 'FAILURE')
  view.unmount()
})
