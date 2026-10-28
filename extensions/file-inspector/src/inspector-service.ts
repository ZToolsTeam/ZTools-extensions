import { callHostTransport } from './native-ipc.js'
import type {
  DecodedPreviewLine,
  FileDiagnosticResult,
  LineEndingType,
  TargetEncodingType
} from './types.js'

export function toHexHeaderPreview(bytes: Uint8Array, maxBytes = 16): string {
  const slice = bytes.subarray(0, Math.min(bytes.byteLength, maxBytes))
  return Array.from(slice)
    .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
    .join(' ')
}

function asciiAt(bytes: Uint8Array, offset: number, length = 4): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

/** 读取开头的 ftyp 盒：主品牌（第 8~11 字节）或兼容品牌列表里出现 avif / avis 即为 AVIF */
function isAvifFileTypeBox(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 16 || asciiAt(bytes, 4) !== 'ftyp') return false
  const boxSize = ((bytes[0]! << 24) >>> 0) + (bytes[1]! << 16) + (bytes[2]! << 8) + bytes[3]!
  const end = Math.min(bytes.byteLength, boxSize >= 16 ? boxSize : 16)
  const brands = [asciiAt(bytes, 8)]
  for (let offset = 16; offset + 4 <= end; offset += 4) brands.push(asciiAt(bytes, offset))
  return brands.some((brand) => brand === 'avif' || brand === 'avis')
}

export function detectMagicSignature(
  bytes: Uint8Array,
  currentExtension: string
): {
  realMimeType: string
  realExtension: string
  isKnownBinary: boolean
} {
  if (!bytes || bytes.byteLength === 0) {
    return {
      realMimeType: 'text/plain',
      realExtension: currentExtension || 'txt',
      isKnownBinary: false
    }
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { realMimeType: 'image/png', realExtension: 'png', isKnownBinary: true }
  }

  // JPEG: FF D8 FF
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { realMimeType: 'image/jpeg', realExtension: 'jpg', isKnownBinary: true }
  }

  // WEBP: RIFF....WEBP (52 49 46 46 ... 57 45 42 50)
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
    return { realMimeType: 'image/webp', realExtension: 'webp', isKnownBinary: true }
  }

  // AVIF: ISO BMFF 容器，第 4~7 字节为 ftyp，主品牌或兼容品牌含 avif / avis
  if (isAvifFileTypeBox(bytes)) {
    return { realMimeType: 'image/avif', realExtension: 'avif', isKnownBinary: true }
  }

  // GIF: 47 49 46 38
  if (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return { realMimeType: 'image/gif', realExtension: 'gif', isKnownBinary: true }
  }

  // PDF: 25 50 44 46 (%PDF)
  if (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  ) {
    return { realMimeType: 'application/pdf', realExtension: 'pdf', isKnownBinary: true }
  }

  // ZIP / OOXML: 50 4B 03 04
  if (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  ) {
    const ooxmlExts = new Set(['docx', 'pptx', 'xlsx', 'jar', 'apk'])
    const ext = ooxmlExts.has(currentExtension) ? currentExtension : 'zip'
    return { realMimeType: 'application/zip', realExtension: ext, isKnownBinary: true }
  }

  return {
    realMimeType: '',
    realExtension: currentExtension,
    isKnownBinary: false
  }
}

export function detectTextEncodingAndBom(bytes: Uint8Array): {
  isText: boolean
  detectedEncoding: string
  detectionBasis: string
  hasBom: boolean
} {
  if (!bytes || bytes.byteLength === 0) {
    return {
      isText: false,
      detectedEncoding: 'Empty',
      detectionBasis: '空文件',
      hasBom: false
    }
  }

  // UTF-8 BOM: EF BB BF
  if (bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return {
      isText: true,
      detectedEncoding: 'UTF-8-BOM',
      detectionBasis: '按文件开头的 BOM 判断',
      hasBom: true
    }
  }

  // UTF-16 LE BOM: FF FE
  if (bytes.byteLength >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return {
      isText: true,
      detectedEncoding: 'UTF-16LE',
      detectionBasis: '按文件开头的 BOM 判断',
      hasBom: true
    }
  }

  // UTF-16 BE BOM: FE FF
  if (bytes.byteLength >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return {
      isText: true,
      detectedEncoding: 'UTF-16BE',
      detectionBasis: '按文件开头的 BOM 判断',
      hasBom: true
    }
  }

  // Check null bytes or high non-printable ratio -> binary
  const sampleLen = Math.min(bytes.byteLength, 4096)
  let nullCount = 0
  let controlCount = 0
  for (let i = 0; i < sampleLen; i++) {
    const b = bytes[i]!
    if (b === 0) nullCount++
    else if (b < 9 || (b > 13 && b < 32)) controlCount++
  }
  if (nullCount > 0 || controlCount > sampleLen * 0.12) {
    return {
      isText: false,
      detectedEncoding: 'Binary',
      detectionBasis: '含空字节或较多控制字符，按二进制文件处理',
      hasBom: false
    }
  }

  // Try strict UTF-8 decode first
  try {
    const strictUtf8 = new TextDecoder('utf-8', { fatal: true })
    strictUtf8.decode(bytes)
    return {
      isText: true,
      detectedEncoding: 'UTF-8',
      detectionBasis: '全文是合法的 UTF-8',
      hasBom: false
    }
  } catch {
    // 不是合法 UTF-8 时只能推测，这里一律按 GBK / GB18030 处理，界面如实写明是推测
    return {
      isText: true,
      detectedEncoding: 'GBK',
      detectionBasis: '不是合法的 UTF-8，按 GBK / GB18030 推测',
      hasBom: false
    }
  }
}

export function detectLineEndingStyle(text: string): LineEndingType {
  if (!text) return 'None'
  const crlfCount = (text.match(/\r\n/g) ?? []).length
  const cleanLf = text.replace(/\r\n/g, '')
  const lfCount = (cleanLf.match(/\n/g) ?? []).length
  const crCount = (cleanLf.match(/\r/g) ?? []).length

  if (crlfCount > 0 && lfCount === 0 && crCount === 0) return 'CRLF'
  if (lfCount > 0 && crlfCount === 0 && crCount === 0) return 'LF'
  if (crCount > 0 && crlfCount === 0 && lfCount === 0) return 'CR'
  if (crlfCount === 0 && lfCount === 0 && crCount === 0) return 'None'
  return 'Mixed'
}

export function decodeTextBufferWithEncoding(bytes: Uint8Array, encoding: string): string {
  if (!bytes || bytes.byteLength === 0) return ''
  const norm = (encoding || 'utf-8').toLowerCase()
  try {
    if (norm === 'utf-8-bom' || norm === 'utf-8') {
      const start =
        bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(start))
    }
    if (norm === 'gbk' || norm === 'gb2312' || norm === 'gb18030') {
      return new TextDecoder('gb18030', { fatal: false }).decode(bytes)
    }
    if (norm === 'big5') {
      return new TextDecoder('big5', { fatal: false }).decode(bytes)
    }
    if (norm === 'utf-16le') {
      return new TextDecoder('utf-16le', { fatal: false }).decode(bytes)
    }
    if (norm === 'utf-16be') {
      return new TextDecoder('utf-16be', { fatal: false }).decode(bytes)
    }
  } catch {
    // Fallback to utf-8 non-fatal
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

export function inspectFileFromBuffer(
  bytes: Uint8Array,
  filePath = 'unknown',
  overridePreviewEncoding?: string
): FileDiagnosticResult {
  const fileName = filePath.split(/[\\/]/).pop() || filePath
  const extMatch = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)
  const currentExtension = extMatch?.[1] || ''

  const magic = detectMagicSignature(bytes, currentExtension)
  const encInfo = magic.isKnownBinary
    ? {
        isText: false,
        detectedEncoding: 'Binary',
        detectionBasis: `按文件头识别为 ${magic.realMimeType}`,
        hasBom: false
      }
    : detectTextEncodingAndBom(bytes)

  let realMimeType = magic.realMimeType
  let realExtension = magic.realExtension

  if (!realMimeType) {
    if (encInfo.isText) {
      const previewHead = decodeTextBufferWithEncoding(
        bytes.subarray(0, Math.min(bytes.byteLength, 512)),
        encInfo.detectedEncoding
      )
        .trim()
        .toLowerCase()
      if (previewHead.startsWith('<!doctype html') || previewHead.startsWith('<html')) {
        realMimeType = 'text/html'
        realExtension = 'html'
      } else if (currentExtension === 'csv') {
        realMimeType = 'text/csv'
        realExtension = 'csv'
      } else {
        realMimeType = 'text/plain'
        realExtension = currentExtension || 'txt'
      }
    } else if (bytes.byteLength === 0) {
      realMimeType = 'application/x-empty'
      realExtension = currentExtension || 'txt'
    } else {
      realMimeType = 'application/octet-stream'
      realExtension = currentExtension || 'bin'
    }
  }

  const normalizedCur = currentExtension === 'jpeg' ? 'jpg' : currentExtension
  const normalizedReal = realExtension === 'jpeg' ? 'jpg' : realExtension
  const extensionMismatch =
    Boolean(normalizedCur) &&
    Boolean(normalizedReal) &&
    normalizedCur !== normalizedReal &&
    realMimeType !== 'application/octet-stream'

  let lineEnding: LineEndingType = 'None'
  const previewLines: DecodedPreviewLine[] = []

  if (encInfo.isText) {
    const activeEncoding = overridePreviewEncoding || encInfo.detectedEncoding
    const decodedText = decodeTextBufferWithEncoding(bytes, activeEncoding)
    lineEnding = detectLineEndingStyle(decodedText)
    const rawLines = decodedText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').slice(0, 100)
    for (let i = 0; i < rawLines.length; i++) {
      previewLines.push({
        lineNumber: i + 1,
        text: rawLines[i]!
      })
    }
  } else if (bytes.byteLength > 0) {
    previewLines.push({
      lineNumber: 1,
      text: `[HEX] ${toHexHeaderPreview(bytes, 32)}`
    })
  }

  return {
    filePath,
    fileName,
    fileSize: bytes.byteLength,
    currentExtension,
    realMimeType,
    realExtension,
    extensionMismatch,
    isText: encInfo.isText,
    detectedEncoding: encInfo.detectedEncoding,
    detectionBasis: encInfo.detectionBasis,
    hasBom: encInfo.hasBom,
    lineEnding,
    hexHeaderPreview: toHexHeaderPreview(bytes, 16),
    previewLines
  }
}

export function convertTextBufferEncoding(
  bytes: Uint8Array,
  sourceEncoding: string,
  targetEncoding: TargetEncodingType,
  targetLineEnding?: 'CRLF' | 'LF'
): Uint8Array {
  if (!bytes || bytes.byteLength === 0) {
    throw new Error('EMPTY_FILE_BUFFER: 空文件无法执行字符集转码')
  }
  if (targetEncoding !== 'utf-8' && targetEncoding !== 'utf-8-bom') {
    throw new Error('不支持的目标编码，请选择 UTF-8 或 UTF-8-BOM')
  }
  const source = sourceEncoding.toLowerCase().replace('utf-8-bom', 'utf-8')
  // 保存时严格解码，避免把替换字符写入文件，造成不可逆的数据丢失。
  let text = new TextDecoder(source === 'gbk' ? 'gb18030' : source, { fatal: true }).decode(bytes)
  if (targetLineEnding === 'CRLF') {
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n')
  } else if (targetLineEnding === 'LF') {
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  }

  const utf8Body = new TextEncoder().encode(text)
  if (targetEncoding === 'utf-8-bom') {
    const out = new Uint8Array(3 + utf8Body.byteLength)
    out[0] = 0xef
    out[1] = 0xbb
    out[2] = 0xbf
    out.set(utf8Body, 3)
    return out
  }
  return utf8Body
}

interface FileOperationResult {
  ok: boolean
  canceled?: boolean
  error?: string
}

export async function fixFileExtension(
  filePath: string,
  correctExt: string,
  hostOverride?: unknown
): Promise<FileOperationResult & { newPath?: string }> {
  if (!/^[a-z0-9]{1,16}$/i.test(correctExt)) {
    return { ok: false, error: '目标扩展名无效' }
  }
  const split = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')) + 1
  const name = filePath.slice(split)
  if (!name || filePath.split(/[\\/]/).some(part => part === '..' || part === '.')) {
    return { ok: false, error: '文件路径无效' }
  }
  const directory = filePath.slice(0, split) || '.'
  // 打开文件仅授予读权限；改名需要用户明确选择其所在目录，不能扩大宿主授权。
  const grant = await callHostTransport<{ canceled?: boolean; folderPath?: string }>(
    'window_show_select_folder_dialog',
    { title: '选择文件所在文件夹以允许修正后缀', defaultPath: directory }, hostOverride
  )
  if (!grant.ok) return { ok: false, error: grant.error || '无法选择文件夹' }
  if (grant.data?.canceled) return { ok: false, canceled: true }
  const normalize = (value: string) => {
    const path = value.replace(/[\\/]+$/, '')
    return /^[a-z]:/i.test(filePath) ? path.replace(/\\/g, '/').toLowerCase() : path
  }
  if (!grant.data?.folderPath || normalize(grant.data.folderPath) !== normalize(directory)) {
    return { ok: false, error: '请选择当前文件所在的文件夹，文件尚未改名' }
  }
  const dot = name.lastIndexOf('.')
  const newPath = filePath.slice(0, split) + (dot > 0 ? name.slice(0, dot) : name) + '.' + correctExt
  const res = await callHostTransport<{ success?: boolean }>(
    'filesystem_move_file_no_replace', { sourcePath: filePath, destPath: newPath }, hostOverride
  )
  return res.ok && res.data?.success === true
    ? { ok: true, newPath }
    : { ok: false, error: res.error || '修正文件后缀失败，未确认文件已移动' }
}

export async function saveConvertedTextFile(
  filePath: string,
  encodedBytes: Uint8Array,
  hostOverride?: unknown
): Promise<FileOperationResult & { outputPath?: string }> {
  if (encodedBytes.byteLength > 16 * 1024 * 1024) {
    return { ok: false, error: '转码结果超过 16 MiB，请拆分文件后再保存' }
  }
  const name = filePath.split(/[\\/]/).pop() || 'text.txt'
  const dot = name.lastIndexOf('.')
  const defaultName = dot > 0 ? `${name.slice(0, dot)}_utf8bom${name.slice(dot)}` : `${name}_utf8bom.txt`
  const picked = await callHostTransport<{ canceled?: boolean; filePath?: string }>(
    'window_show_save_dialog', { title: '另存为 UTF-8-BOM 文件', defaultName }, hostOverride
  )
  if (!picked.ok) return { ok: false, error: picked.error || '打开保存窗口失败' }
  if (picked.data?.canceled) return { ok: false, canceled: true }
  if (!picked.data?.filePath) return { ok: false, error: '保存窗口未返回文件路径' }
  // 分块处理，避免较大文件触发函数参数数量上限；浏览器插件无需 Buffer。
  const chunks: string[] = []
  for (let i = 0; i < encodedBytes.length; i += 8192) {
    chunks.push(String.fromCharCode(...encodedBytes.subarray(i, i + 8192)))
  }
  const res = await callHostTransport<{ success?: boolean; size?: number }>(
    'filesystem_write_file',
    { path: picked.data.filePath, content: btoa(chunks.join('')), encoding: 'base64' },
    hostOverride
  )
  return res.ok && res.data?.success === true && res.data.size === encodedBytes.byteLength
    ? { ok: true, outputPath: picked.data.filePath }
    : { ok: false, error: res.error || '未确认完整写入文件，请检查保存结果' }
}

export async function pickAndReadLocalFile(
  hostOverride?: unknown
): Promise<FileOperationResult & { filePath?: string; bytes?: Uint8Array }> {
  const picked = await callHostTransport<{ canceled?: boolean; filePath?: string }>(
    'window_show_open_dialog', { title: '选择需要透视或转码的文件', properties: ['openFile'] }, hostOverride
  )
  if (!picked.ok) return { ok: false, error: picked.error || '打开选择文件窗口失败' }
  if (picked.data?.canceled) return { ok: false, canceled: true }
  const filePath = picked.data?.filePath
  if (!filePath) return { ok: false, error: '选择窗口未返回文件路径' }
  const read = await callHostTransport<{ content?: string; size?: number }>(
    'filesystem_read_file', { path: filePath, encoding: 'base64' }, hostOverride
  )
  if (!read.ok || typeof read.data?.content !== 'string') {
    return { ok: false, error: read.error || '读取文件字节失败' }
  }
  try {
    const bytes = Uint8Array.from(atob(read.data.content), c => c.charCodeAt(0))
    if (read.data.size !== bytes.byteLength) return { ok: false, error: '文件数据不完整，请重新选择文件' }
    return { ok: true, filePath, bytes }
  } catch (error) {
    return { ok: false, error: `读取文件字节失败：${error instanceof Error ? error.message : String(error)}` }
  }
}
