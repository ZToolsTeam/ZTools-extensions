export type IOType = 'input' | 'output'
export interface AudioDevice {
  id: string
  uid: string
  name: string
  type: IOType
  isDefault: boolean
  canSetDefault: boolean
  canSetVolume: boolean
  canMute: boolean
  volume?: number
  isMuted?: boolean
  transportType?: string
  sampleRate?: number
  channels?: number
  isFavourite?: boolean
}
export interface AudioFilterOptions {
  ioType?: IOType | 'all' | 'favourites'
  query?: string
}
