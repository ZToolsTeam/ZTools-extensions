export type CleaningMode = 'location' | 'metadata'
export interface MediaMetadataSummary {
  name: string
  size: number
  digest: string
  type: string
  canClean: boolean
  hasLocation: boolean
  fields: { key: string; value: string }[]
}
export interface SavedMedia { success: true; status: 'committed'; name: string; size: number }
