/**
 * 图片识字业务逻辑
 * 扫描本机“图片”“桌面”“下载”文件夹中的图片，通过客户端调用 Windows 系统文字识别 (Windows.Media.Ocr) 识别文字。
 * 不在客户端中运行时不提供任何示例数据，所有失败都如实返回原因。
 */

import {
  callHostTransport,
  formatBytes,
  getRealSystemPath,
  invokePluginService,
  scanRealDirectoryTree,
  showRealItemInFolder,
  writeRealClipboardText
} from './native-ipc.js'

export { formatBytes }

/** 宿主桥接对象与返回数据结构不固定，按 JSON 动态数据处理 */
type DynamicBridge = ReturnType<typeof JSON.parse>

/** 文字识别服务返回的数据 */
interface OcrHostData {
  ok?: boolean
  success?: boolean
  error?: string
  text?: unknown
  lines?: unknown
}

export const NOT_IN_CLIENT_MESSAGE = '需要在 ZTools 客户端中使用'

export interface OcrLanguagePreset {
  id: string
  title: string
  /** 传给客户端文字识别服务的语言代码 */
  engineCode: string
}

export type OcrItemStatus = 'pending' | 'recognized' | 'failed'

export interface OcrQueueItem {
  id: string
  name: string
  path: string
  parentDir: string
  extension: string
  sizeBytes: number
  /** 识别出的文字；未识别或识别失败时为空字符串 */
  recognizedText: string
  status: OcrItemStatus
  /** 识别失败的原因 */
  error?: string
}

export type OcrLayoutStrategy = 'natural_paragraph' | 'single_line' | 'markdown_table'
export type OcrPostAction = 'copy_clipboard' | 'export_file' | 'copy_and_export'

export interface OcrBatchConfig {
  languageModelId?: string
  layoutStrategy?: OcrLayoutStrategy
  postAction?: OcrPostAction
  filterStampNoise?: boolean
}

export interface OcrExportFailure {
  path: string
  error: string
}

export interface OcrBatchResult {
  /** 至少一张图片识别出了文字 */
  ok: boolean
  recognizedCount: number
  failedCount: number
  /** 本次处理过的全部图片（含识别结果或失败原因） */
  items: OcrQueueItem[]
  combinedText: string
  /** 是否写入了剪贴板；未要求复制时为 undefined */
  copied?: boolean
  copyError?: string
  exportedFiles: string[]
  exportFailures: OcrExportFailure[]
  /** 用户取消了选择导出文件夹 */
  exportCanceled?: boolean
  exportError?: string
  error?: string
}

export interface OcrWorkspaceSnapshot {
  items: OcrQueueItem[]
  scannedDirs: string[]
  error?: string
}

/** Windows.Media.Ocr 按语言创建识别引擎，所选语言的 OCR 语言包需要已安装 */
export const OCR_LANGUAGE_MODELS: OcrLanguagePreset[] = [
  { id: 'zh-hans', title: '简体中文', engineCode: 'zh-Hans-CN' },
  { id: 'en', title: '英文', engineCode: 'en-US' },
  { id: 'ja', title: '日文', engineCode: 'ja-JP' },
  { id: 'ko', title: '韩文', engineCode: 'ko-KR' }
]

export function resolveOcrLanguage(languageModelId?: string): OcrLanguagePreset {
  return OCR_LANGUAGE_MODELS.find(m => m.id === languageModelId) || OCR_LANGUAGE_MODELS[0]
}

const OCR_IMG_REGEX = /\.(?:png|jpg|jpeg|webp|bmp)$/i
const STAMP_NOISE_LINE_REGEX = /(?:^[\s\-—_=]*第?\s*\d+\s*[\/／]\s*\d+\s*页?[\s\-—_=]*$|^[\s\-—_=]*Page\s+\d+(?:\s+of\s+\d+)?[\s\-—_=]*$|合同专用章|发票专用章|财务专用章|骑缝章|业务专用章|保密水印|内部资料\s*严禁外传)/i

export function cleanOcrStampNoise(text: string, enableFilter = true): string {
  const raw = String(text || '').trim()
  if (!raw || !enableFilter) return raw
  const lines = raw
    .split(/\r?\n/)
    .map(line =>
      line
        .replace(/【[^】]*(?:专用章|公章|骑缝章|水印)[^】]*】/g, '')
        .replace(/\[[^\]]*(?:专用章|公章|骑缝章|水印)[^\]]*\]/g, '')
        .trim()
    )
    .filter(line => line.length > 0 && !STAMP_NOISE_LINE_REGEX.test(line))
  return lines.join('\n').trim()
}

export function formatOcrOutputByStrategy(
  items: OcrQueueItem[],
  strategy: OcrLayoutStrategy = 'natural_paragraph'
): string {
  if (!Array.isArray(items) || items.length === 0) return ''
  if (strategy === 'single_line') {
    return items
      .map(i => String(i.recognizedText || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' ')
  }
  if (strategy === 'markdown_table') {
    const rows = items.map(
      (i, idx) =>
        `| ${idx + 1} | ${i.name.replace(/\|/g, '/')} | ${String(i.recognizedText || '').replace(/\|/g, '/').replace(/\r?\n/g, ' ')} |`
    )
    return ['| 序号 | 文件名 | 识别内容 |', '| :--- | :--- | :--- |', ...rows].join('\n')
  }
  if (items.length === 1) {
    return String(items[0].recognizedText || '').trim()
  }
  return items.map(i => `### ${i.name}\n${i.recognizedText}`).join('\n\n')
}

/** 扫描“图片”“桌面”“下载”文件夹（各取体积最大的 20 张），拿不到任何文件夹路径时返回错误 */
export async function fetchOcrQueueSnapshot(hostOverride?: DynamicBridge): Promise<OcrWorkspaceSnapshot> {
  const [picturesDir, desktopDir, downloadsDir] = await Promise.all([
    getRealSystemPath('pictures', hostOverride),
    getRealSystemPath('desktop', hostOverride),
    getRealSystemPath('downloads', hostOverride)
  ])

  const scannedDirs = [picturesDir, desktopDir, downloadsDir].filter(Boolean)
  if (scannedDirs.length === 0) {
    return { items: [], scannedDirs, error: '无法获取“图片”“桌面”“下载”文件夹的位置' }
  }
  const discovered: OcrQueueItem[] = []
  const seenPaths = new Set<string>()

  for (const dir of scannedDirs) {
    const scanRes = await scanRealDirectoryTree(dir, {
      maxDepth: 2,
      maxFiles: 180,
      collectTopN: 20,
      filterExt: OCR_IMG_REGEX,
      hostOverride
    })
    for (const f of scanRes.files) {
      if (f.isDir || f.sizeBytes <= 0 || !f.path || seenPaths.has(f.path)) continue
      seenPaths.add(f.path)
      const dot = f.name.lastIndexOf('.')
      discovered.push({
        id: `ocr-${discovered.length}-${f.path}`,
        name: f.name,
        path: f.path,
        parentDir: dir,
        extension: dot > 0 ? f.name.slice(dot).toLowerCase() : '',
        sizeBytes: f.sizeBytes,
        recognizedText: '',
        status: 'pending'
      })
    }
  }

  discovered.sort((a, b) => b.sizeBytes - a.sizeBytes)
  return { items: discovered, scannedDirs }
}

export const fetchOcrWorkspace = fetchOcrQueueSnapshot

/** 占位文本（如“[图像已加载]”）不是识别结果，按没有识别到文字处理 */
function isPlaceholderOcrText(text: string): boolean {
  return text.includes('[图像已加载') || text.includes('[OCR 预提取就绪]')
}

function extractRecognizedText(data: OcrHostData | string | undefined): string {
  if (!data) return ''
  let raw = ''
  if (typeof data === 'string') raw = data.trim()
  else if (typeof data.text === 'string') raw = data.text.trim()
  else if (Array.isArray(data.lines)) {
    raw = data.lines
      .map((l: unknown) => (typeof l === 'string' ? l : String((l as { text?: unknown } | null)?.text || '')))
      .filter(Boolean)
      .join('\n')
      .trim()
  }
  return isPlaceholderOcrText(raw) ? '' : raw
}

function baseNameWithoutExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

function joinFolderPath(folder: string, fileName: string): string {
  const sep = folder.includes('\\') || /^[A-Za-z]:/.test(folder) ? '\\' : '/'
  return `${folder.replace(/[\\/]+$/, '')}${sep}${fileName}`
}

/**
 * 导出识别结果：先让用户选择保存文件夹（同时授权写入），每张图片写一个同名 .txt / .md 文件。
 * 同一批里重名的自动加序号；文件夹里已有同名文件时不覆盖，记为失败。
 */
async function exportOcrResults(
  items: OcrQueueItem[],
  combinedText: string,
  config: OcrBatchConfig,
  hostOverride?: DynamicBridge
): Promise<Pick<OcrBatchResult, 'exportedFiles' | 'exportFailures' | 'exportCanceled' | 'exportError'>> {
  const ext = config?.layoutStrategy === 'markdown_table' ? '.md' : '.txt'
  const picked = await callHostTransport<{ canceled?: boolean; folderPath?: string }>(
    'window_show_select_folder_dialog',
    { title: '选择保存识别结果的文件夹', defaultPath: items[0]?.parentDir || '' },
    hostOverride
  )
  if (!picked.ok) {
    return { exportedFiles: [], exportFailures: [], exportError: picked.error || '无法打开选择文件夹窗口' }
  }
  if (picked.data?.canceled) return { exportedFiles: [], exportFailures: [], exportCanceled: true }
  const folder = String(picked.data?.folderPath || '').trim()
  if (!folder) {
    return { exportedFiles: [], exportFailures: [], exportError: '选择文件夹窗口没有返回路径' }
  }

  const exportedFiles: string[] = []
  const exportFailures: OcrExportFailure[] = []
  const usedNames = new Set<string>()
  for (const item of items) {
    const base = baseNameWithoutExtension(item.name) || 'ocr'
    let fileName = `${base}${ext}`
    for (let n = 2; usedNames.has(fileName.toLowerCase()); n++) fileName = `${base} (${n})${ext}`
    usedNames.add(fileName.toLowerCase())
    const outPath = joinFolderPath(folder, fileName)
    const content =
      items.length === 1
        ? combinedText
        : formatOcrOutputByStrategy([item], config?.layoutStrategy || 'natural_paragraph')
    const res = await callHostTransport<{ success?: boolean }>(
      'filesystem_write_file',
      { path: outPath, content, encoding: 'utf8', overwrite: false },
      hostOverride
    )
    if (res.ok && res.data?.success === true) {
      exportedFiles.push(outPath)
    } else {
      exportFailures.push({ path: outPath, error: res.error || '客户端没有确认写入成功' })
    }
  }
  return { exportedFiles, exportFailures }
}

export async function executeBatchOcr(
  items: OcrQueueItem[],
  config: OcrBatchConfig = {},
  hostOverride?: DynamicBridge
): Promise<OcrBatchResult> {
  const empty: OcrBatchResult = {
    ok: false,
    recognizedCount: 0,
    failedCount: 0,
    items: [],
    combinedText: '',
    exportedFiles: [],
    exportFailures: []
  }
  if (!Array.isArray(items) || items.length === 0) {
    return { ...empty, error: '请先勾选至少一张待识别图片' }
  }

  const language = resolveOcrLanguage(config?.languageModelId)
  const shouldFilterNoise = Boolean(config?.filterStampNoise)
  const processed: OcrQueueItem[] = []

  for (const item of items) {
    const ocrRes = await invokePluginService<OcrHostData>(
      'OcrPlugin',
      'recognizeImage',
      { path: item.path, lang: language.engineCode },
      hostOverride
    )
    const validRes = ocrRes.ok && ocrRes.data?.ok !== false && ocrRes.data?.success !== false
    const rawText = validRes ? extractRecognizedText(ocrRes.data) : ''
    const text = cleanOcrStampNoise(rawText, shouldFilterNoise)
    if (validRes && text.length > 0) {
      processed.push({ ...item, recognizedText: text, status: 'recognized', error: undefined })
      continue
    }
    const error = !validRes
      ? String(ocrRes.error || ocrRes.data?.error || '识别失败')
      : rawText.length > 0
        ? '过滤页码和印章行后没有剩余文字'
        : '没有识别到文字'
    processed.push({ ...item, recognizedText: '', status: 'failed', error })
  }

  const recognized = processed.filter(i => i.status === 'recognized')
  const failedCount = processed.length - recognized.length
  if (recognized.length === 0) {
    const firstError = processed.find(i => i.error)?.error || '没有识别到文字'
    return { ...empty, failedCount, items: processed, error: firstError }
  }

  const combinedText = formatOcrOutputByStrategy(recognized, config?.layoutStrategy || 'natural_paragraph')
  const postAction = config?.postAction || 'copy_clipboard'
  const result: OcrBatchResult = {
    ...empty,
    ok: true,
    recognizedCount: recognized.length,
    failedCount,
    items: processed,
    combinedText
  }

  if (postAction === 'copy_clipboard' || postAction === 'copy_and_export') {
    result.copied = await writeRealClipboardText(combinedText, hostOverride)
    if (!result.copied) result.copyError = '写入剪贴板失败'
  }
  if (postAction === 'export_file' || postAction === 'copy_and_export') {
    Object.assign(result, await exportOcrResults(recognized, combinedText, config, hostOverride))
  }
  return result
}

/**
 * 截取主屏幕整屏并识别文字（由客户端截图、识别后删除临时截图），识别出的文字写入剪贴板。
 * 截图时 ZTools 窗口不会隐藏，窗口里的文字也会被识别。
 */
export async function captureScreenAreaOcr(
  languageModelId?: string,
  hostOverride?: DynamicBridge
): Promise<{
  ok: boolean
  text: string
  copied: boolean
  error?: string
}> {
  const language = resolveOcrLanguage(languageModelId)
  const res = await invokePluginService<OcrHostData>(
    'OcrPlugin',
    'captureAndRecognize',
    { lang: language.engineCode },
    hostOverride
  )
  const valid = res.ok && res.data?.ok !== false && res.data?.success !== false
  const text = valid ? extractRecognizedText(res.data) : ''
  if (!valid) {
    return { ok: false, text: '', copied: false, error: String(res.error || res.data?.error || '截屏识别失败') }
  }
  if (!text) {
    return { ok: false, text: '', copied: false, error: '截图中没有识别到文字' }
  }
  const copied = await writeRealClipboardText(text, hostOverride)
  return copied
    ? { ok: true, text, copied: true }
    : { ok: true, text, copied: false, error: '已识别文字，但写入剪贴板失败' }
}

export async function openOcrFileLocation(fullPath: string, hostOverride?: DynamicBridge): Promise<boolean> {
  if (!fullPath) return false
  return showRealItemInFolder(fullPath, hostOverride)
}
