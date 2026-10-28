export type LineEndingType = 'CRLF' | 'LF' | 'CR' | 'Mixed' | 'None'
export type TargetEncodingType = 'utf-8-bom' | 'utf-8' | 'gbk'

export interface DecodedPreviewLine {
  lineNumber: number
  text: string
}

export interface FileDiagnosticResult {
  filePath: string
  fileName: string
  fileSize: number
  currentExtension: string
  realMimeType: string
  realExtension: string
  extensionMismatch: boolean
  isText: boolean
  detectedEncoding: string
  /** 编码判断的依据（BOM、合法 UTF-8 或按 GBK 推测），不是概率 */
  detectionBasis: string
  hasBom: boolean
  lineEnding: LineEndingType
  hexHeaderPreview: string
  previewLines: DecodedPreviewLine[]
}
