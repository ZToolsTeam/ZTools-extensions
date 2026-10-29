import { loadImage } from '../dist/image-codec.js'
import { renderWatermarkOnImage, getPresetWatermarkTemplates } from '../dist/watermark-service.js'
import { pickImage, outputImage, readClipboardImage } from '../dist/image-io.js'
import Command, { commands } from '../dist/index.js'
import { renderDeclarativeRoot, setDeclarativeBridge, getComponentFactory } from '@ztools/declarative-ui'

export async function runWatermarkBrowserTests(host) {
  const checks = [], assert = (value, message) => { if (!value) throw new Error(message) }
  const reject = async (fn, pattern) => { try { await fn() } catch (error) { assert(pattern.test(error.message), error.message); return } throw new Error('预期拒绝但操作成功') }
  const canvas = new OffscreenCanvas(640, 480), ctx = canvas.getContext('2d')
  ctx.fillStyle = 'rgb(200, 220, 240)'; ctx.fillRect(0, 0, 640, 480)
  ctx.fillStyle = 'rgb(40, 100, 150)'; ctx.fillRect(80, 80, 220, 130)
  const options = { text: '仅供测试使用 他用无效', opacityPercent: 35, rotateDegree: -30, gapPx: 120, colorMode: 'dark' }
  let pngBytes
  for (const format of ['image/png', 'image/jpeg', 'image/webp']) {
    const blob = await canvas.convertToBlob({ type: format }), bytes = new Uint8Array(await blob.arrayBuffer())
    if (format === 'image/png') pngBytes = bytes
    const input = await loadImage(bytes, '原图.' + format.split('/')[1])
    const before = bytes.slice(), output = await renderWatermarkOnImage(input, options)
    const decoded = await createImageBitmap(output.blob), actual = new OffscreenCanvas(640, 480), actualCtx = actual.getContext('2d')
    actualCtx.drawImage(decoded, 0, 0); decoded.close()
    const baseline = await createImageBitmap(blob), base = new OffscreenCanvas(640, 480), baseCtx = base.getContext('2d'); baseCtx.drawImage(baseline, 0, 0); baseline.close()
    const a = actualCtx.getImageData(0, 0, 640, 480).data, b = baseCtx.getImageData(0, 0, 640, 480).data
    let changed = 0, same = 0
    for (let i = 0; i < a.length; i += 4) { if (a[i] === b[i] && a[i+1] === b[i+1] && a[i+2] === b[i+2] && a[i+3] === b[i+3]) same++; else changed++ }
    assert(output.mimeType === 'image/png' && output.width === 640 && output.height === 480, '输出不是完整PNG')
    assert(changed > 100 && same > 640 * 480 / 2, '未画出水印或破坏了大部分原图')
    assert(bytes.every((v, i) => v === before[i]), '原始字节被修改')
    checks.push({ check: format + '真实解码→合成→PNG再解码', changed, same, passed: true })
  }
  const truncated = pngBytes.slice(0, 33)
  await reject(() => loadImage(truncated, '损坏.png'), /image|decode|source/i)
  const bad = await loadImage(pngBytes, '原图.png')
  await reject(() => renderWatermarkOnImage(bad, { ...options, text: ' '.repeat(3) }), /文字/)
  const savedCanvas = globalThis.OffscreenCanvas
  globalThis.OffscreenCanvas = undefined
  try { await reject(() => renderWatermarkOnImage(bad, options), /本地图像/) } finally { globalThis.OffscreenCanvas = savedCanvas }
  checks.push({ check: '损坏输入/空文字/缺图像能力拒绝，不伪造成功', passed: true })

  await host.prepare(Array.from(pngBytes))
  const signal = new AbortController().signal, calls = []
  let saveMode = 'new', clipboardBytes, chooseCanceled = false, copyFails = false
  globalThis.__ztoolsElectron = { transport: { methods: new Proxy({}, { get: (_, method) => async ({ params }) => {
    calls.push([method, params])
    try {
      let data
      if (method === 'window_show_open_dialog') data = chooseCanceled ? { canceled: true } : { canceled: false, filePath: host.inputPath }
      else if (method === 'window_show_save_dialog') data = saveMode === 'cancel' ? { canceled: true } : { canceled: false, filePath: saveMode === 'original' ? host.inputPath : saveMode === 'original-case' ? host.inputPath.toUpperCase() : host.outputPath }
      else if (method === 'clipboard_copy_image') { if (copyFails) throw new Error('剪贴板写入失败'); clipboardBytes = Uint8Array.from(atob(params.image), c => c.charCodeAt(0)); data = { success: true } }
      else if (method === 'clipboard_read_image') data = { success: true, useTempFile: false, image: btoa(String.fromCharCode(...pngBytes)) }
      else data = await host.fileCall(method, params)
      return { success: true, data }
    } catch (error) { return { success: false, error: { message: error.message } } }
  } }) } }
  const chosen = await pickImage(signal); assert(chosen.width === 640 && chosen.height === 480 && chosen.path === host.inputPath, '选图未使用真实尺寸')
  const saved = await outputImage(chosen, options, false, signal); assert(saved.includes('已保存新副本'), '保存未完成')
  await host.verify(); assert(calls.find(([m]) => m === 'filesystem_write_file')[1].overwrite === true, '另存为对话框已确认替换时应按替换写入')
  assert((await outputImage(chosen, options, false, signal)).includes('已保存新副本'), '在对话框确认替换已有文件后仍保存失败')
  saveMode = 'original'; await reject(() => outputImage(chosen, options, false, signal), /原图/)
  saveMode = 'original-case'; await reject(() => outputImage(chosen, options, false, signal), /原图/)
  saveMode = 'cancel'; const count = calls.filter(([m]) => m === 'filesystem_write_file').length
  assert(await outputImage(chosen, options, false, signal) === null, '取消未返回'); assert(calls.filter(([m]) => m === 'filesystem_write_file').length === count, '取消仍写入')
  await outputImage(chosen, options, true, signal)
  const clip = await loadImage(clipboardBytes, '剪贴板.png'); assert(clip.width === 640, '复制的不是图像')
  assert((await readClipboardImage(signal)).height === 480, '剪贴板读取失败')
  chooseCanceled = true; assert(await pickImage(signal) === null, '取消选图失败')
  copyFails = true; await reject(() => outputImage(chosen, options, true, signal), /剪贴板写入失败/); copyFails = false
  checks.push({ check: '真实文件服务选图/原子另存/输出解码；原图不变、确认替换的已有目标可再次保存、大小写不同的原图路径仍拒绝、取消不写；复制图片而非SVG文本', passed: true })
  const templates = getPresetWatermarkTemplates('测试单位', '2026.10.26')
  assert(templates[0].resolvedText.includes('测试单位'), '模板用途未更新')
  chooseCanceled = false
  const toasts = []
  let pushed, popped = false
  setDeclarativeBridge({ showToast: value => { toasts.push(value); return { id: 'test', hide() {}, update() {} } }, navigation: { push: target => { pushed = target }, pop: () => { popped = true } } })
  const root = renderDeclarativeRoot(() => Command())
  try {
    await root.forceRender().props.filterBar.actions[0].onAction()
    const fields = () => root.forceRender().props.workbenchPanel.fields
    root.forceRender().props.subList.items[0].props.actions.children.flat(Infinity)[2].props.onAction()
    assert(pushed, '没有打开用途表单')
    const factory = getComponentFactory(pushed)
    assert(typeof factory === 'function', '未提供真实表单工厂')
    const form = renderDeclarativeRoot(factory)
    try {
      form.forceRender().children.flat(Infinity).find(node => node.type === 'Form.TextField').props.onChange('$&测试单位')
      form.forceRender().props.actions.children.flat(Infinity)[0].props.onSubmit()
      assert(popped, '保存用途后没有返回')
    } finally { form.unmount() }
    fields().find(f => f.id === 'template').onChange(templates[2].rawText)
    assert(root.forceRender().props.workbenchPanel.previewCard.title.includes('$&测试单位 租赁备案'), '模板或用途没有按当前值更新')
    const row = root.forceRender().props.subList.items[0]
    const actions = row.props.actions.children.flat(Infinity)
    assert(actions[0].props.title === '另存加水印图片…', '主动作不正确')
    const last = clipboardBytes
    await actions[1].props.onAction()
    assert(toasts.at(-1).style === 'SUCCESS' && clipboardBytes.some((v,i) => v !== last[i]), '复制没有使用当前选择模板')
    copyFails = true; await actions[1].props.onAction(); assert(toasts.at(-1).style === 'FAILURE', '复制失败仍提示成功'); copyFails = false
  } finally { root.unmount() }
  const quick = renderDeclarativeRoot(commands['id-watermark-clipboard-fast'])
  try {
    for (let i=0;i<20 && !quick.forceRender().props.subList.items.length;i++) await new Promise(r=>setTimeout(r,5))
    assert(quick.forceRender().props.subList.items[0].props.actions.children.flat(Infinity)[0].props.title === '复制加水印图片', '快入口没有读取剪贴板或主动作错误')
  } finally { quick.unmount() }
  checks.push({ check: '真实SDK挂载/选图/切换模板/副动作复制，快入口读取，复制失败不报成功（非物理键盘验收）', passed: true })
  return checks
}
