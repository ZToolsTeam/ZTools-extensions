import { LocalStorage } from '@ztools/declarative-ui'
import { callHostTransport } from './native-ipc.js'
import { t } from './i18n.js'
import type { AudioDevice, AudioFilterOptions } from './types.js'

const FAVOURITES_KEY = 'audio-device-favourites-v1'
// macOS 音频组件返回的连接方式代号；unknown 与未识别的值不展示，避免把不确定的信息当成事实。
const TRANSPORT_LABEL_KEYS = {
  builtin: 'transportBuiltin',
  usb: 'transportUsb',
  bluetooth: 'transportBluetooth',
  bluetoothle: 'transportBluetoothLe',
  hdmi: 'transportHdmi',
  displayport: 'transportDisplayPort',
  airplay: 'transportAirplay',
  virtual: 'transportVirtual',
  aggregate: 'transportAggregate'
} as const
type TransportKey = keyof typeof TRANSPORT_LABEL_KEYS
export function transportLabel(transport?: string): string | undefined {
  if (!transport || !Object.prototype.hasOwnProperty.call(TRANSPORT_LABEL_KEYS, transport)) return undefined
  return t(TRANSPORT_LABEL_KEYS[transport as TransportKey])
}
export function parseAudioDevice(value: unknown): AudioDevice {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(t('errInvalidDeviceData'))
  const item = value as Record<string, unknown>
  if (typeof item.id !== 'string' || !item.id || typeof item.uid !== 'string' || !item.uid || typeof item.name !== 'string' || !item.name || (item.type !== 'input' && item.type !== 'output') || typeof item.isDefault !== 'boolean') throw new Error(t('errIncompleteDeviceInfo'))
  if (item.volume !== undefined && (typeof item.volume !== 'number' || !Number.isFinite(item.volume) || item.volume < 0 || item.volume > 100)) throw new Error(t('errInvalidVolume'))
  if (item.muted !== undefined && typeof item.muted !== 'boolean') throw new Error(t('errInvalidMuteState'))
  return {
    id: item.id, uid: item.uid, name: item.name, type: item.type, isDefault: item.isDefault,
    canSetDefault: item.canSetDefault === true,
    canSetVolume: item.canSetVolume === true && item.volume !== undefined,
    canMute: item.canMute === true && item.muted !== undefined,
    volume: item.volume as number | undefined, isMuted: item.muted as boolean | undefined,
    transportType: typeof item.transport === 'string' ? item.transport : undefined,
    sampleRate: typeof item.sampleRate === 'number' && item.sampleRate > 0 ? item.sampleRate : undefined,
    channels: typeof item.channels === 'number' && item.channels > 0 ? item.channels : undefined
  }
}

export class AudioDeviceManager {
  private devices: AudioDevice[] = []
  private favourites = new Set<string>()
  private reading = 0
  private changing = false
  public preferenceWarning = ''
  constructor(private readonly hostOverride?: unknown) {}

  async syncDevicesFromHost(): Promise<AudioDevice[]> {
    const generation = ++this.reading
    const response = await callHostTransport<unknown>('audio_get_devices', {}, this.hostOverride)
    if (!response.ok) throw new Error(response.error || t('errLoadDevicesFailed'))
    const list = Array.isArray(response.data) ? response.data : response.data && typeof response.data === 'object' ? (response.data as Record<string, unknown>).devices : undefined
    if (!Array.isArray(list)) throw new Error(t('errInvalidDeviceList'))
    const devices = list.map(parseAudioDevice)
    if (new Set(devices.map(device => device.id)).size !== devices.length) throw new Error(t('errDuplicateDeviceId'))
    if (generation !== this.reading) return this.getAllDevices()
    this.devices = devices
    try {
      const value = await LocalStorage.getItem(FAVOURITES_KEY)
      const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value
      if (parsed !== undefined && (!Array.isArray(parsed) || parsed.some(id => typeof id !== 'string'))) throw new Error(t('errInvalidFavouritesFormat'))
      if (generation === this.reading) { this.favourites = new Set((parsed || []) as string[]); this.preferenceWarning = '' }
    } catch (error) {
      if (generation === this.reading) this.preferenceWarning = t('errLoadFavouritesFailed', { error: error instanceof Error ? error.message : String(error) })
    }
    return this.getAllDevices()
  }
  getAllDevices(): AudioDevice[] { return this.devices.map(device => ({ ...device, isFavourite: this.favourites.has(device.id) })) }
  getDefaultOutputDevice(): AudioDevice | undefined { return this.getAllDevices().find(device => device.type === 'output' && device.isDefault) }
  getDefaultInputDevice(): AudioDevice | undefined { return this.getAllDevices().find(device => device.type === 'input' && device.isDefault) }
  filterDevices(options: AudioFilterOptions = {}): AudioDevice[] {
    const query = (options.query || '').trim().toLowerCase()
    return this.getAllDevices().filter(device => (!options.ioType || options.ioType === 'all' || (options.ioType === 'favourites' ? device.isFavourite : device.type === options.ioType)) && `${device.name} ${device.transportType || ''} ${transportLabel(device.transportType) || ''}`.toLowerCase().includes(query))
  }
  private find(id: string): AudioDevice {
    const device = this.devices.find(item => item.id === id)
    if (!device) throw new Error(t('errDeviceNotFound'))
    return device
  }
  private async change(id: string, method: string, params: Record<string, unknown>): Promise<AudioDevice> {
    if (this.changing) throw new Error(t('errAudioOpBusy'))
    const target = this.find(id)
    this.changing = true
    try {
      const response = await callHostTransport<Record<string, unknown>>(method, { id: target.id, type: target.type, ...params }, this.hostOverride)
      if (!response.ok || response.data?.success !== true) throw new Error(response.error || String(response.data?.error || response.data?.message || t('errAudioOpFailed')))
      const actual = parseAudioDevice(response.data.details)
      if (actual.id !== target.id || actual.type !== target.type) throw new Error(t('errDeviceMismatch'))
      if (method === 'audio_set_default_device' && !actual.isDefault) throw new Error(t('errDefaultNotSwitched'))
      if (method === 'audio_set_volume' && (actual.volume === undefined || Math.abs(actual.volume - Number(params.volume)) > 1)) throw new Error(t('errVolumeNotApplied'))
      if (method === 'audio_toggle_mute' && actual.isMuted !== params.muted) throw new Error(t('errMuteNotChanged'))
      this.reading++ // 已完成写入后，之前发出的列表请求不能覆盖确认过的状态。
      this.devices = this.devices.map(device => device.id === actual.id ? actual : method === 'audio_set_default_device' && device.type === actual.type ? { ...device, isDefault: false } : device)
      return { ...actual }
    } finally { this.changing = false }
  }
  async setDefaultDevice(id: string): Promise<AudioDevice> {
    if (!this.find(id).canSetDefault) throw new Error(t('errCannotSetDefault'))
    return this.change(id, 'audio_set_default_device', {})
  }
  async setDeviceVolume(id: string, volume: number): Promise<AudioDevice> {
    if (!Number.isFinite(volume) || volume < 0 || volume > 100) throw new Error(t('errVolumeRange'))
    if (!this.find(id).canSetVolume) throw new Error(t('errVolumeNotSupported'))
    return this.change(id, 'audio_set_volume', { volume: Math.round(volume) })
  }
  async stepDeviceVolume(id: string, delta: number): Promise<AudioDevice> {
    const device = this.find(id)
    if (device.volume === undefined || !Number.isFinite(delta)) throw new Error(t('errCannotReadVolume'))
    return this.setDeviceVolume(id, Math.max(0, Math.min(100, device.volume + delta)))
  }
  async toggleDeviceMute(id: string): Promise<AudioDevice> {
    const device = this.find(id)
    if (!device.canMute || device.isMuted === undefined) throw new Error(t('errMuteNotSupported'))
    return this.change(id, 'audio_toggle_mute', { muted: !device.isMuted })
  }
  async toggleFavourite(id: string): Promise<void> {
    this.find(id)
    if (this.preferenceWarning) throw new Error(this.preferenceWarning)
    const next = new Set(this.favourites)
    if (next.has(id)) next.delete(id); else next.add(id)
    await LocalStorage.setItem(FAVOURITES_KEY, JSON.stringify([...next]))
    this.favourites = next
  }
}
