import { LocalStorage } from '@ztools/declarative-ui'
import { callHostTransport } from './native-ipc.js'
import type { AudioDevice, AudioFilterOptions } from './types.js'

const FAVOURITES_KEY = 'audio-device-favourites-v1'
// macOS 音频组件返回的连接方式代号；unknown 与未识别的值不展示，避免把不确定的信息当成事实。
const TRANSPORT_LABELS: Record<string, string> = {
  builtin: '内置', usb: 'USB', bluetooth: '蓝牙', bluetoothle: '蓝牙低功耗', hdmi: 'HDMI 显示器',
  displayport: 'DisplayPort 显示器', airplay: 'AirPlay', virtual: '虚拟设备', aggregate: '聚合设备'
}
export function transportLabel(transport?: string): string | undefined {
  return transport ? TRANSPORT_LABELS[transport] : undefined
}
export function parseAudioDevice(value: unknown): AudioDevice {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('音频设备数据无效')
  const item = value as Record<string, unknown>
  if (typeof item.id !== 'string' || !item.id || typeof item.uid !== 'string' || !item.uid || typeof item.name !== 'string' || !item.name || (item.type !== 'input' && item.type !== 'output') || typeof item.isDefault !== 'boolean') throw new Error('音频设备信息不完整')
  if (item.volume !== undefined && (typeof item.volume !== 'number' || !Number.isFinite(item.volume) || item.volume < 0 || item.volume > 100)) throw new Error('音频设备返回了无效音量')
  if (item.muted !== undefined && typeof item.muted !== 'boolean') throw new Error('音频设备返回了无效静音状态')
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
    if (!response.ok) throw new Error(response.error || '读取音频设备失败')
    const list = Array.isArray(response.data) ? response.data : response.data && typeof response.data === 'object' ? (response.data as Record<string, unknown>).devices : undefined
    if (!Array.isArray(list)) throw new Error('宿主没有返回有效的音频设备列表')
    const devices = list.map(parseAudioDevice)
    if (new Set(devices.map(device => device.id)).size !== devices.length) throw new Error('音频设备标识重复')
    if (generation !== this.reading) return this.getAllDevices()
    this.devices = devices
    try {
      const value = await LocalStorage.getItem(FAVOURITES_KEY)
      const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value
      if (parsed !== undefined && (!Array.isArray(parsed) || parsed.some(id => typeof id !== 'string'))) throw new Error('收藏数据格式无效')
      if (generation === this.reading) { this.favourites = new Set((parsed || []) as string[]); this.preferenceWarning = '' }
    } catch (error) {
      if (generation === this.reading) this.preferenceWarning = `收藏读取失败：${error instanceof Error ? error.message : String(error)}`
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
    if (!device) throw new Error('设备已不在列表中，请重新扫描')
    return device
  }
  private async change(id: string, method: string, params: Record<string, unknown>): Promise<AudioDevice> {
    if (this.changing) throw new Error('音频操作正在执行，请稍后重试')
    const target = this.find(id)
    this.changing = true
    try {
      const response = await callHostTransport<Record<string, unknown>>(method, { id: target.id, type: target.type, ...params }, this.hostOverride)
      if (!response.ok || response.data?.success !== true) throw new Error(response.error || String(response.data?.error || response.data?.message || '音频操作未成功'))
      const actual = parseAudioDevice(response.data.details)
      if (actual.id !== target.id || actual.type !== target.type) throw new Error('返回的设备与选择不一致，请刷新确认')
      if (method === 'audio_set_default_device' && !actual.isDefault) throw new Error('系统未切换到所选设备')
      if (method === 'audio_set_volume' && (actual.volume === undefined || Math.abs(actual.volume - Number(params.volume)) > 1)) throw new Error('设备音量未达到请求值')
      if (method === 'audio_toggle_mute' && actual.isMuted !== params.muted) throw new Error('设备静音状态没有改变')
      this.reading++ // 已完成写入后，之前发出的列表请求不能覆盖确认过的状态。
      this.devices = this.devices.map(device => device.id === actual.id ? actual : method === 'audio_set_default_device' && device.type === actual.type ? { ...device, isDefault: false } : device)
      return { ...actual }
    } finally { this.changing = false }
  }
  async setDefaultDevice(id: string): Promise<AudioDevice> {
    if (!this.find(id).canSetDefault) throw new Error('此设备不能设为系统默认设备')
    return this.change(id, 'audio_set_default_device', {})
  }
  async setDeviceVolume(id: string, volume: number): Promise<AudioDevice> {
    if (!Number.isFinite(volume) || volume < 0 || volume > 100) throw new Error('请输入 0 到 100 之间的音量')
    if (!this.find(id).canSetVolume) throw new Error('此设备不支持软件调节音量')
    return this.change(id, 'audio_set_volume', { volume: Math.round(volume) })
  }
  async stepDeviceVolume(id: string, delta: number): Promise<AudioDevice> {
    const device = this.find(id)
    if (device.volume === undefined || !Number.isFinite(delta)) throw new Error('无法读取设备当前音量')
    return this.setDeviceVolume(id, Math.max(0, Math.min(100, device.volume + delta)))
  }
  async toggleDeviceMute(id: string): Promise<AudioDevice> {
    const device = this.find(id)
    if (!device.canMute || device.isMuted === undefined) throw new Error('此设备不支持软件静音')
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
