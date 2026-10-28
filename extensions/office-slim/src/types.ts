export interface FileReference { path: string; displayName: string }
export interface OfficeDocSummary {
  name: string
  type: 'docx' | 'pptx' | 'xlsx'
  size: number
  digest: string
  images: { name: string; size: number }[]
  hasAuthor: boolean
  hasComments: boolean
}
export interface OfficeResult {
  success: true
  status: 'committed'
  name: string
  size: number
  originalSize: number
  imageCount: number
}
