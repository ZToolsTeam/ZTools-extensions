export interface ConvertOptions {
  preset: 'official' | 'business' | 'academic'
  fontSize: 'size-3' | 'size-s4' | 'size-5'
  firstLineIndent: boolean
}
export interface DocSummary { title: string; characters: number; blocks: number; warnings: string[] }
export const DEFAULT_OPTIONS: ConvertOptions = { preset: 'official', fontSize: 'size-3', firstLineIndent: true }
