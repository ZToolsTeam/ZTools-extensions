import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import AiImageCommand from '../dist/index.js'

const COLORFUL_EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u

// 与客户端一致：dllplugin_call 走内置图片处理时，结果对象会再带一份 data 副本（外层 { success, data } 由测试宿主包装）
function hostResult(record) {
  return { ...record, data: { ...record } }
}

function installImageHost(host, { files } = {}) {
  host.ipc.system_get_path = async ({ name }) => (name === 'pictures' ? 'D:\\Pics' : '')
  host.ipc.system_search_files = async ({ query }) => {
    if (query !== 'dir:D:\\Pics') return { files: [] }
    return {
      files: files ?? [
        { name: 'photo.png', path: 'D:\\Pics\\photo.png', is_dir: false, size: 600000, mtime: 1700000000 },
        { name: 'scan.jpg', path: 'D:\\Pics\\Docs\\scan.jpg', is_dir: false, size: 300000, mtime: 1700000000 }
      ]
    }
  }
  host.ipc.filesystem_file_exists = async () => ({ success: true, exists: false })
  host.ipc.dllplugin_call = async ({ params }) =>
    hostResult({
      ok: true,
      success: true,
      processedCount: 1,
      outputPath: params.outputPath,
      outputBytes: 2048000,
      sizeBytes: 2048000,
      width: 2400,
      height: 1600,
      results: [
        { sourcePath: params.inputPath, outputPath: params.outputPath, width: 2400, height: 1600, outputBytes: 2048000 }
      ],
      errors: []
    })
}

const dllCalls = host => host.ipcCalls.filter(([method]) => method === 'dllplugin_call')
const summary = view => view.tree().props.filterBar.props.summaryText
const metric = (view, label) => view.tree().props.workbenchPanel.previewCard.metrics.find(m => m.label === label).value

test('ai-image UI: 只显示真实扫描结果与客户端做得到的选项，无彩色 Emoji 与虚构模型', async () => {
  const host = createHost()
  installImageHost(host)
  const view = await mount(AiImageCommand, host)

  const tree = view.tree()
  const queue = tree.props.subList.items
  assert.deepEqual(
    queue.map(i => i.props.title),
    ['photo.png', 'scan.jpg']
  )
  assert.equal(queue[1].props.subtitle, 'D:\\Pics\\Docs')
  const text = view.text()
  assert.ok(!COLORFUL_EMOJI.test(text), '界面不能有彩色 Emoji')
  for (const fake of ['Real-ESRGAN', 'ONNX', 'Vulkan', 'CUDA', 'RMBG', 'CodeFormer', 'WebP', '无损', '1x']) {
    assert.ok(!text.includes(fake), `界面不应出现客户端做不到的说法：${fake}`)
  }
  const dropdownTitles = tree.props.searchBarAccessory.children.map(c => c.props.title)
  assert.deepEqual(dropdownTitles, [
    '普通放大（非 AI）',
    'AI 超分辨率（暂不可用）',
    'AI 去背景（暂不可用）',
    'AI 人像修复（暂不可用）'
  ])
  const fieldIds = tree.props.workbenchPanel.fields.map(f => f.id)
  assert.deepEqual(fieldIds, ['wb-scale-factor', 'wb-output-format', 'wb-outdir'], '去掉客户端不支持的降噪与 GPU 选项')
  assert.equal(metric(view, '输出分辨率'), '原尺寸 ×2')
  assert.equal(metric(view, '上次处理'), '尚未处理')
  view.unmount()
})

test('ai-image UI: 处理成功后行内显示真实输出，失败显示错误状态', async () => {
  const host = createHost()
  installImageHost(host)
  const view = await mount(AiImageCommand, host)

  await view.run(view.item('ai-img-D:\\Pics\\photo.png'), '仅处理这张图片')
  await tick()
  const calls = dllCalls(host)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][1].params.mode, 'upscale')
  assert.match(calls[0][1].params.outputPath, /^D:\\Pics\\photo_2x_\d{8}-\d{6}\.png$/)
  assert.equal(host.lastToast().style, 'SUCCESS')
  assert.equal(host.lastToast().title, '已放大 1 张图片')
  assert.match(host.lastToast().message, /2400×1600/)
  const okItem = view.item('ai-img-D:\\Pics\\photo.png')
  assert.ok(okItem.props.accessories.some(a => a.tag?.value === '已输出 2400×1600'))
  assert.match(okItem.props.subtitle, /photo_2x_\d{8}-\d{6}\.png$/)

  host.ipc.dllplugin_call = async () => {
    throw Object.assign(new Error('图像处理失败: scan.jpg'), { code: 'FAILED' })
  }
  await view.run(view.item('ai-img-D:\\Pics\\Docs\\scan.jpg'), '仅处理这张图片')
  await tick()
  assert.equal(host.lastToast().style, 'FAILURE')
  assert.equal(host.lastToast().title, '1 张图片处理失败')
  assert.match(host.lastToast().message, /图像处理失败/)
  const failItem = view.item('ai-img-D:\\Pics\\Docs\\scan.jpg')
  assert.ok(failItem.props.accessories.some(a => a.tag?.value === '处理失败'))
  assert.match(failItem.props.subtitle, /失败：.*图像处理失败/)
  assert.equal(metric(view, '上次处理'), '1 张全部失败')
  view.unmount()
})

test('ai-image UI: 批量处理需确认，取消则不处理；部分失败如实提示', async () => {
  const host = createHost()
  installImageHost(host)
  const view = await mount(AiImageCommand, host)
  const item = view.item('ai-img-D:\\Pics\\photo.png')

  host.setConfirm(false)
  await view.run(item, '开始处理已勾选的 2 张')
  assert.equal(host.confirms.length, 1)
  assert.match(host.confirms[0].message, /不覆盖已有文件/)
  assert.equal(dllCalls(host).length, 0, '取消确认后不调用客户端')

  host.setConfirm(true)
  const okHandler = host.ipc.dllplugin_call
  host.ipc.dllplugin_call = async req => {
    if (req.params.inputPath.endsWith('scan.jpg')) throw new Error('文件被占用')
    return okHandler(req)
  }
  await view.run(view.item('ai-img-D:\\Pics\\photo.png'), '开始处理已勾选的 2 张')
  await tick()
  assert.equal(dllCalls(host).length, 2)
  assert.equal(host.lastToast().style, 'FAILURE')
  assert.equal(host.lastToast().title, '完成 1 张，失败 1 张')
  assert.match(host.lastToast().message, /文件被占用/)
  assert.equal(metric(view, '上次处理'), '成功 1 张，失败 1 张')
  view.unmount()
})

test('ai-image UI: 选择不可用的 AI 功能时状态条说明原因，执行只提示不可用', async () => {
  const host = createHost()
  installImageHost(host)
  const view = await mount(AiImageCommand, host)

  await view.dropdown('ai-background-removal')
  assert.match(summary(view), /AI 去背景暂不可用/)
  assert.equal(view.tree().props.workbenchPanel.previewCard.badge, '暂不可用')
  await view.run(view.item('ai-img-D:\\Pics\\photo.png'), '仅处理这张图片')
  assert.equal(host.lastToast().style, 'FAILURE')
  assert.equal(host.lastToast().title, 'AI 去背景暂不可用')
  assert.equal(dllCalls(host).length, 0)
  view.unmount()
})

test('ai-image UI: 扫描失败显示错误状态，不显示示例图片', async () => {
  const host = createHost()
  // 测试宿主未实现 system_get_path：拿不到任何系统目录
  const view = await mount(AiImageCommand, host)
  await tick()
  assert.equal(view.tree().props.subList.items.length, 0)
  assert.match(summary(view), /读取图片队列失败/)
  assert.match(view.tree().props.subList.emptyText, /读取失败/)
  assert.ok(host.toasts.some(t => t.style === 'FAILURE' && t.title === '读取图片队列失败'))
  view.unmount()
})

test('ai-image UI: 定位失败时提示，处理进行中不重复提交', async () => {
  const host = createHost()
  installImageHost(host)
  const view = await mount(AiImageCommand, host)
  const item = view.item('ai-img-D:\\Pics\\photo.png')

  await view.run(item, '在资源管理器中显示')
  assert.equal(host.lastToast().style, 'FAILURE')
  assert.equal(host.lastToast().title, '无法在资源管理器中显示')

  let release
  const okHandler = host.ipc.dllplugin_call
  host.ipc.dllplugin_call = req => new Promise(resolve => {
    release = () => resolve(okHandler(req))
  })
  const runAction = title => {
    const found = view.actions(view.item('ai-img-D:\\Pics\\photo.png')).find(a => a.props.title === title)
    return found.props.onAction()
  }
  const pending = runAction('仅处理这张图片')
  await tick()
  await runAction('仅处理这张图片')
  assert.equal(host.lastToast().title, '正在处理，请等当前任务完成')
  release()
  await pending
  await tick()
  assert.equal(dllCalls(host).length, 1)
  assert.equal(host.lastToast().title, '已放大 1 张图片')
  view.unmount()
})
