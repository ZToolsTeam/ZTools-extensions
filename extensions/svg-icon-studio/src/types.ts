export interface SvgOptimizeMetrics {
  originalBytes: number
  optimizedBytes: number
  savedBytes: number
  savedPercentage: number
  viewBox: string
  pathCount: number
  removedItems: number
}

export interface SvgProcessResult {
  originalSvg: string
  optimizedSvg: string
  reactTsxCode: string
  vueSfcCode: string
  dataUri: string
  base64DataUri: string
  warnings: string[]
  metrics: SvgOptimizeMetrics
}
