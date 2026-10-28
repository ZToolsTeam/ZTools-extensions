import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import BatchImageCommand from '../dist/index.js'

const POSTER = 'D:\\TestMedia\\pictures\\design_poster_4k.png'
const RECEIPT = 'D:\\TestMedia\\pictures\\receipt_scan.jpg'

function installScanHost(host) {
  host.ipc.system_get_path = async ({ name }) => `D:\\TestMedia\\${name}`
  host.ipc.system_search_files = async ({ query }) => {
    if (String(query).includes('pictures')) {
      return {
        files: [
          { name: 'design_poster_4k.png', path: POSTER, is_dir: false, size: 3145728, mtime: 1710000000 },
          { name: 'receipt_scan.jpg', path: RECEIPT, is_dir: false, size: 1048576, mtime: 1710000000 }
        ]
      }
    }
    return { files: [] }
  }
}

/** 与宿主单张成功时的返回结构一致（路由层会再包一层 data） */
function hostSuccess(params, { outputBytes = 380000, originalBytes = 1048576, width = 1920, height = 1080 } = {}) {
  const record = {
    ok: true,
    success: true,
    processedCount: 1,
    outputPath: params.outputPath,
    outputBytes,
    results: [
      {
        sourcePath: params.files[0],
        outputPath: params.outputPath,
        width,
        height,
        originalBytes,
        sizeBytes: outputBytes,
        outputBytes,
        savedBytes: Math.max(0, originalBytes - outputBytes)
      }
    ],
    errors: []
  }
  return { ...record, data: { ...record } }
}

function hostFailure(params, message) {
  return { ok: false, success: false, processedCount: 0, results: [], errors: [{ file: params.files[0], error: message }], error: message }
}

function tagOf(item) {
  return item.props.accessories.find((a) => a.tag)?.tag?.value
}

function filterBarActions(view) {
  const fb = view.tree().props.filterBar
  return fb?.props?.actions ?? fb?.actions ?? []
}

test('batch-image UI integration: 布局三渲染、无编造数据、逐张处理与避开同名文件', async () => {
  const host = createHost()
  installScanHost(host)
  const existing = new Set([POSTER.replace('.png', '_opt.png').toLowerCase()])
  host.ipc.filesystem_file_exists = async ({ path }) => ({ success: true, exists: existing.has(path.toLowerCase()) })
  const dllCalls = []
  host.ipc.dllplugin_call = async ({ plugin, func, params }) => {
    dllCalls.push({ plugin, func, params })
    await new Promise((r) => setTimeout(r, 10))
    return hostSuccess(params)
  }

  const view = await mount(BatchImageCommand, host)
  await tick(10)

  const tree = view.tree()
  assert.equal(tree.type, 'List')
  assert.equal(tree.props.isShowingDetail, false, '布局三必须关闭右侧 Detail 以留出参数工作台与队列')
  assert.ok(tree.props.workbenchPanel, '必须包含左侧 workbenchPanel 参数工作台')
  assert.ok(tree.props.subList, '必须包含右侧 subList 待处理图片队列')
  assert.equal(/[\u{1F300}-\u{1FAFF}]/u.test(view.text()), false, 'UI 文本严禁包含彩色 Emoji')

  // 宿主做不到的选项已去掉
  const fields = tree.props.workbenchPanel.fields
  assert.equal(fields.some((f) => f.id === 'wb-exif'), false, '宿主不支持清除 EXIF，不能提供开关')
  assert.deepEqual(fields.find((f) => f.id === 'wb-format').options.map((o) => o.value), ['keep', 'jpg', 'png'])
  assert.deepEqual(fields.find((f) => f.id === 'wb-scale').options.map((o) => o.value), ['source', 'max1920', 'max1280'])
  assert.equal(/PDF|预计/.test(view.text()), false, '不再提供合并 PDF，也不显示按固定比例估算的体积')
  assert.equal(tree.props.workbenchPanel.previewCard.badge, '未处理')

  const poster = view.item((it) => it.props.title === 'design_poster_4k.png')
  assert.equal(tagOf(poster), '待处理')
  assert.equal(poster.props.subtitle.includes('×'), false, '处理前读不到尺寸，不能编造分辨率')
  const titlesBefore = view.actions(poster).map((a) => a.props.title)
  assert.equal(titlesBefore.includes('复制输出文件路径'), false, '尚未生成输出文件时不能提供输出路径')
  assert.equal(titlesBefore.some((t) => /PDF|剪贴板/.test(t)), false)

  // 并发锁：连续触发两次只执行一批（2 张图 → 2 次宿主调用）
  await Promise.all([
    view.run(poster, '开始处理已选图片 (2 张)'),
    view.run(poster, '开始处理已选图片 (2 张)')
  ])
  await tick(10)
  assert.equal(dllCalls.length, 2, '重复触发不能并发执行第二批')
  for (const call of dllCalls) {
    assert.equal(call.plugin, 'BatchImagePlugin')
    assert.equal(call.params.files.length, 1)
    assert.equal(call.params.qualityTier, 'q85')
    assert.equal(call.params.resizePreset, 'source')
    assert.equal(call.params.outputFormat, 'keep')
  }
  const byFile = new Map(dllCalls.map((c) => [c.params.files[0], c.params.outputPath]))
  assert.equal(byFile.get(POSTER), 'D:\\TestMedia\\pictures\\design_poster_4k_opt_2.png', '已有 _opt 文件时自动换名')
  assert.equal(byFile.get(RECEIPT), 'D:\\TestMedia\\pictures\\receipt_scan_opt.jpg')
  assert.equal(host.lastToast()?.title, '已处理 2 张图片')
  assert.match(String(host.lastToast()?.message), /原图未改动/)

  const posterDone = view.item((it) => it.props.title === 'design_poster_4k.png')
  assert.match(String(tagOf(posterDone)), /^已输出 371 KB/)
  assert.match(posterDone.props.subtitle, /design_poster_4k_opt_2\.png · 1920×1080/)
  assert.equal(view.tree().props.workbenchPanel.previewCard.badge, '已输出 2 张')

  // 处理后才提供复制输出路径，复制的是宿主返回的真实路径
  await view.run(posterDone, '复制输出文件路径')
  assert.equal(host.clipboard.text, 'D:\\TestMedia\\pictures\\design_poster_4k_opt_2.png')

  // 在资源管理器中显示失败时如实提示
  await view.run(posterDone, '在资源管理器中显示输出文件')
  assert.equal(String(host.lastToast()?.style).toLowerCase(), 'failure')
  assert.equal(host.lastToast()?.title, '无法在资源管理器中显示')

  view.unmount()
})

test('batch-image UI 失败路径：全部失败、部分失败与超过 300KB 都不报成功', async () => {
  const host = createHost()
  installScanHost(host)
  host.ipc.filesystem_file_exists = async () => ({ success: true, exists: false })
  host.ipc.dllplugin_call = async ({ params }) => hostFailure(params, 'DECODE_FAILED: 图片文件头损坏')

  const view = await mount(BatchImageCommand, host)
  await tick(10)

  // 1. 全部失败
  await view.run(view.item((it) => it.props.title === 'design_poster_4k.png'), '开始处理已选图片 (2 张)')
  assert.equal(String(host.lastToast()?.style).toLowerCase(), 'failure')
  assert.equal(host.lastToast()?.title, '2 张图片全部处理失败')
  assert.match(String(host.lastToast()?.message), /图片文件头损坏/)
  const failed = view.item((it) => it.props.title === 'design_poster_4k.png')
  assert.equal(tagOf(failed), '失败')
  assert.match(failed.props.subtitle, /^失败原因：DECODE_FAILED/)

  // 2. 部分失败
  host.ipc.dllplugin_call = async ({ params }) =>
    params.files[0] === POSTER ? hostSuccess(params) : hostFailure(params, '图片编码转换失败: receipt_scan.jpg')
  await view.run(view.item((it) => it.props.title === 'design_poster_4k.png'), '开始处理已选图片 (2 张)')
  assert.equal(String(host.lastToast()?.style).toLowerCase(), 'failure')
  assert.equal(host.lastToast()?.title, '已处理 1 张，1 张失败')
  assert.match(String(host.lastToast()?.message), /receipt_scan/)

  // 3. 报销方案：参数切换到宿主真实取值，超过 300KB 如实标出
  const calls = []
  host.ipc.dllplugin_call = async ({ params }) => {
    calls.push(params)
    return hostSuccess(params, { outputBytes: params.files[0] === POSTER ? 400 * 1024 : 200 * 1024, originalBytes: 3145728 })
  }
  await view.dropdown('preset-extreme-300k')
  await view.run(view.item((it) => it.props.title === 'design_poster_4k.png'), '开始处理已选图片 (2 张)')
  assert.equal(calls.length, 2)
  assert.ok(calls.every((p) => p.qualityTier === 'q70' && p.resizePreset === 'max1280' && p.outputFormat === 'jpg'))
  assert.ok(calls.every((p) => p.outputPath.endsWith('_opt.jpg')))
  assert.equal(String(host.lastToast()?.style).toLowerCase(), 'failure')
  assert.equal(host.lastToast()?.title, '已处理 2 张，1 张仍超过 300 KB')
  assert.equal(tagOf(view.item((it) => it.props.title === 'design_poster_4k.png')), '超过 300 KB')
  assert.match(String(tagOf(view.item((it) => it.props.title === 'receipt_scan.jpg'))), /^已输出 200 KB/)

  view.unmount()
})

test('batch-image UI 剪贴板添加与扫描失败：读不到的大小标为未识别，失败如实提示', async () => {
  const host = createHost()
  installScanHost(host)
  const view = await mount(BatchImageCommand, host)
  await tick(10)

  const addAction = filterBarActions(view).find((a) => a.id === 'paste-clipboard-image')
  assert.ok(addAction)

  // 剪贴板里不是图片路径
  host.clipboard.text = '一段普通文字'
  await addAction.onAction()
  await tick()
  assert.equal(host.lastToast()?.title, '剪贴板中没有图片文件路径')

  // 宿主未授权读取文件大小：标为未识别，不填默认值
  host.clipboard.text = '"D:\\Shots\\new_shot.png"\r\nD:\\Shots\\readme.txt'
  await filterBarActions(view).find((a) => a.id === 'paste-clipboard-image').onAction()
  await tick()
  assert.equal(host.lastToast()?.title, '已从剪贴板添加 1 张图片')
  assert.match(String(host.lastToast()?.message), /1 张大小未识别/)
  const added = view.item((it) => it.props.title === 'new_shot.png')
  assert.equal(added.props.checked, true)
  assert.ok(added.props.accessories.some((a) => a.text === '大小未识别'))
  assert.match(String(view.tree().props.filterBar.props?.summaryText ?? view.tree().props.filterBar.summaryText), /1 张大小未识别/)

  // 重复添加
  await filterBarActions(view).find((a) => a.id === 'paste-clipboard-image').onAction()
  await tick()
  assert.equal(host.lastToast()?.title, '这些图片已在队列中')

  // 宿主能读大小时显示真实大小
  host.ipc.filesystem_get_file_size = async () => ({ success: true, size: 2048 })
  host.clipboard.text = 'D:\\Shots\\second.jpg'
  await filterBarActions(view).find((a) => a.id === 'paste-clipboard-image').onAction()
  await tick()
  const second = view.item((it) => it.props.title === 'second.jpg')
  assert.ok(second.props.accessories.some((a) => a.text === '2.0 KB'))
  view.unmount()

  // 扫描失败：拿不到系统目录时提示失败，不显示"找到 0 张"
  const broken = createHost()
  const brokenView = await mount(BatchImageCommand, broken)
  await tick(10)
  assert.equal(String(broken.lastToast()?.style).toLowerCase(), 'failure')
  assert.equal(broken.lastToast()?.title, '扫描图片失败')
  brokenView.unmount()
})
