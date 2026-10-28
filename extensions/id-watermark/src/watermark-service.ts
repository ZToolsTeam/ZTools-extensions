import type {
  ImageMetadata,
  PresetTemplate,
  WatermarkOptions,
  WatermarkRenderResult
} from './types.js'
import { decodeImage, MAX_IMAGE_BYTES } from './image-codec.js'

export function formatWatermarkDate(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}.${m}.${d}`
}

export function resolveTemplate(
  rawText: string,
  businessName = '指定业务',
  fixedDate?: string
): string {
  const dateStr = fixedDate || formatWatermarkDate()
  return String(rawText ?? '')
    .replace(/\{(?:业务名|business|房屋地址|项目\/招投标名称|date)\}/g, token => token === '{date}' ? dateStr : businessName)
    .trim()
}

export function getPresetWatermarkTemplates(
  businessName = '业务审核',
  fixedDate?: string
): PresetTemplate[] {
  const rawPresets = [
    {
      id: 'tpl-general',
      label: '通用政务与银行业务合规水印',
      scenarioTag: '通用业务',
      rawText: '仅供办理 {business} 使用 他用无效 {date}'
    },
    {
      id: 'tpl-onboarding',
      label: '企业入职与社保公积金申报专用',
      scenarioTag: '入职求职',
      rawText: '仅供办理入职与社保申报使用 再次复印无效 {date}'
    },
    {
      id: 'tpl-rental',
      label: '房屋租赁签约与备案专用',
      scenarioTag: '租房签约',
      rawText: '仅供 {房屋地址} 租赁备案使用 挪作他用承担法律责任 {date}'
    },
    {
      id: 'tpl-enterprise',
      label: '营业执照与企业招投标资质审查专用',
      scenarioTag: '企业资质',
      rawText: '仅供办理 {项目/招投标名称} 资质审查使用 复制伪造无效 {date}'
    }
  ]

  return rawPresets.map((item) => ({
    ...item,
    resolvedText: resolveTemplate(item.rawText, businessName, fixedDate)
  }))
}

export function validateImageBufferHeader(bytes: Uint8Array): {
  valid: boolean
  mimeType?: 'image/jpeg' | 'image/png' | 'image/webp'
  error?: string
} {
  if (!bytes || bytes.byteLength < 8) {
    return {
      valid: false,
      error: 'INVALID_IMAGE_FILE: 仅支持有效的 JPG/PNG/WebP 格式图片（文件为空或非图像格式）'
    }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { valid: true, mimeType: 'image/jpeg' }
  }
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { valid: true, mimeType: 'image/png' }
  }
  if (
    bytes.byteLength >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { valid: true, mimeType: 'image/webp' }
  }
  return {
    valid: false,
    error: 'INVALID_IMAGE_FILE: 仅支持有效的 JPG/PNG/WebP 格式图片（检测到非图像文件头）'
  }
}

export function wrapWatermarkLines(text: string, maxCharsPerLine = 24): string[] {
  const clean = String(text ?? '').trim()
  if (!clean) return ['仅供办理指定业务使用 他用无效']
  const chars = Array.from(clean)
  if (chars.length <= maxCharsPerLine) {
    return [clean]
  }
  const lines: string[] = []
  for (let i = 0; i < chars.length; i += maxCharsPerLine) {
    lines.push(chars.slice(i, i + maxCharsPerLine).join(''))
  }
  return lines
}

export function computeAdaptiveWatermarkLayout(
  width: number,
  height: number,
  options: WatermarkOptions
): {
  effectiveFontSizePx: number
  effectiveGapPx: number
  wrappedLines: string[]
  tileCount: number
} {
  const safeW = Math.max(64, Math.round(width))
  const safeH = Math.max(64, Math.round(height))
  const minDim = Math.min(safeW, safeH)

  // 根据图片分辨率自适应字号（防止 200x150 缩略图字号过大糊满全图）
  const baseFontSize = options.fontSizePx ?? Math.round(minDim * 0.036)
  const effectiveFontSizePx = Math.max(8, Math.min(baseFontSize, Math.round(minDim * 0.09)))
  const effectiveGapPx = Math.max(
    effectiveFontSizePx * 3,
    Math.min(options.gapPx || Math.round(minDim * 0.18), Math.round(minDim * 0.45))
  )

  const wrappedLines = wrapWatermarkLines(options.text, 24)
  const cols = Math.max(2, Math.ceil((safeW * 1.4) / effectiveGapPx))
  const rows = Math.max(2, Math.ceil((safeH * 1.4) / effectiveGapPx))

  return {
    effectiveFontSizePx,
    effectiveGapPx,
    wrappedLines,
    tileCount: cols * rows
  }
}

/** 必须以真实原图像素合成；失败不生成替代图片。 */
export async function renderWatermarkOnImage(image: ImageMetadata, options: WatermarkOptions): Promise<WatermarkRenderResult> {
  if (!options.text.trim() || Array.from(options.text).length > 160 || !Number.isFinite(options.opacityPercent) || options.opacityPercent < 10 || options.opacityPercent > 65)
    throw new Error('水印文字需为 1～160 字，不透明度需为 10～65%')
  const bitmap = await decodeImage(image.rawBytes)
  let canvas: OffscreenCanvas | undefined
  try {
    canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const { width, height } = bitmap
    const layout = computeAdaptiveWatermarkLayout(width, height, options)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建图像处理画布')
    ctx.drawImage(bitmap, 0, 0)
    ctx.font = `${layout.effectiveFontSizePx}px sans-serif`
    ctx.fillStyle = options.colorMode === 'light' ? 'rgb(240, 240, 240)' : 'rgb(48, 48, 48)'
    ctx.globalAlpha = options.opacityPercent / 100
    const lineHeight = layout.effectiveFontSizePx * 1.35
    const horizontalStep = Math.max(...layout.wrappedLines.map(line => ctx.measureText(line).width)) + layout.effectiveFontSizePx * 3
    const verticalStep = Math.max(layout.effectiveGapPx, lineHeight * (layout.wrappedLines.length + 2))
    const diagonal = Math.hypot(width, height)
    ctx.translate(width / 2, height / 2); ctx.rotate(-Math.PI / 6)
    let tileCount = 0
    for (let y = -diagonal; y < diagonal; y += verticalStep)
      for (let x = -diagonal; x < diagonal; x += horizontalStep) {
        layout.wrappedLines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight)); tileCount++
      }
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    if (blob.type !== 'image/png' || !blob.size || blob.size > MAX_IMAGE_BYTES) throw new Error('生成图片超过 16 MiB 或格式无效，请缩小原图后重试')
    const verified = await decodeImage(new Uint8Array(await blob.arrayBuffer()))
    try { if (verified.width !== width || verified.height !== height) throw new Error('合成图片尺寸校验失败') } finally { verified.close() }
    return { ...layout, tileCount, width, height, mimeType: 'image/png', blob }
  } finally { bitmap.close(); if (canvas) { canvas.width = 1; canvas.height = 1 } }
}
