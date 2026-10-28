import React, { Action, ActionPanel, Clipboard, Detail, Form, Icon, List, Toast, showToast, useEffect, useMemo, useNavigation, useRef, useState } from '@ztools/declarative-ui'
import { AudioDeviceManager } from './audio-service.js'
import type { AudioDevice, IOType } from './types.js'
export * from './types.js'
export * from './audio-service.js'

const message = (error: unknown) => error instanceof Error ? error.message : String(error)
function volumeText(device: AudioDevice): string {
  if (device.isMuted) return '已静音'
  return device.volume === undefined ? '设备不提供音量状态' : `音量 ${device.volume}%`
}
export function AudioVolumeForm({ device, manager, onSaved }: { device: AudioDevice; manager: AudioDeviceManager; onSaved: () => void }) {
  const [volume, setVolume] = useState(String(device.volume ?? ''))
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const mounted = useRef(true)
  const { pop } = useNavigation()
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const submit = async () => {
    if (pending.current) return
    if (!volume.trim()) { await showToast(Toast.Style.Failure, '请输入音量'); return }
    pending.current = true; setBusy(true)
    try {
      const actual = await manager.setDeviceVolume(device.id, Number(volume))
      if (mounted.current) { onSaved(); await showToast(Toast.Style.Success, `音量已设为 ${actual.volume}%`); pop() }
    } catch (error) { if (mounted.current) await showToast(Toast.Style.Failure, '音量设置失败', message(error)) }
    finally { pending.current = false; if (mounted.current) setBusy(false) }
  }
  return <Form navigationTitle={`调节音量：${device.name}`} isLoading={busy} actions={<ActionPanel><Action.SubmitForm title="应用音量" onSubmit={submit} /></ActionPanel>}>
    <Form.TextField id="volume" title="音量（0—100）" value={volume} onChange={value => { if (!pending.current) setVolume(value) }} />
  </Form>
}
export function AudioDeviceDetailView({ device }: { device: AudioDevice }) {
  const markdown = [
    `- 类型：${device.type === 'output' ? '输出' : '输入'}`,
    `- 软件音量控制：${device.canSetVolume ? '支持' : '不支持'}`,
    `- 软件静音：${device.canMute ? '支持' : '不支持'}`,
    ...(device.transportType ? [`- 连接方式：${device.transportType}`] : []),
    ...(device.sampleRate ? [`- 采样率：${device.sampleRate} Hz`] : []),
    ...(device.channels ? [`- 声道：${device.channels}`] : [])
  ].join('\n')
  return <Detail navigationTitle={`设备信息：${device.name}`} markdown={markdown} actions={<ActionPanel><Action title="复制设备标识" icon={Icon.CopyClipboard} onAction={async () => {
    try { await Clipboard.copy(device.uid); await showToast(Toast.Style.Success, '已复制设备标识') }
    catch (error) { await showToast(Toast.Style.Failure, '复制失败', message(error)) }
  }} /></ActionPanel>} />
}

export function AudioDeviceCommand(props?: { featureCode?: string; hostOverride?: unknown }) {
  const manager = useMemo(() => new AudioDeviceManager(props?.hostOverride), [props?.hostOverride])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<IOType | 'all' | 'favourites'>(props?.featureCode === 'audio-input' ? 'input' : 'all')
  const [version, setVersion] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const mounted = useRef(true)
  const generation = useRef(0)
  const { push } = useNavigation()
  const refresh = () => setVersion(value => value + 1)
  const reload = async (notify = true) => {
    if (busy.current) return false
    const request = ++generation.current
    setLoading(true); setError('')
    try {
      const devices = await manager.syncDevicesFromHost()
      if (!mounted.current || request !== generation.current) return false
      refresh()
      if (notify) await showToast(Toast.Style.Success, `已读取 ${devices.length} 个音频设备`)
      return true
    } catch (failure) {
      if (mounted.current && request === generation.current) setError(message(failure))
      return false
    } finally { if (mounted.current && request === generation.current) setLoading(false) }
  }
  const run = async (operation: () => Promise<unknown>, title: string) => {
    if (busy.current || loading) return
    busy.current = true; setLoading(true)
    const request = generation.current
    try {
      await operation()
      if (mounted.current && request === generation.current) { refresh(); await showToast(Toast.Style.Success, title) }
    } catch (failure) {
      if (mounted.current && request === generation.current) { refresh(); await showToast(Toast.Style.Failure, '操作失败', message(failure)) }
    } finally { busy.current = false; if (mounted.current && request === generation.current) setLoading(false) }
  }
  useEffect(() => {
    mounted.current = true
    setFilter(props?.featureCode === 'audio-input' ? 'input' : 'all')
    void reload(false)
    return () => { mounted.current = false; generation.current++ }
  }, [manager, props?.featureCode])
  const devices = useMemo(() => manager.filterDevices({ ioType: filter, query }), [manager, filter, query, version])
  const defaultOutput = manager.getDefaultOutputDevice()
  const defaultInput = manager.getDefaultInputDevice()
  const summary = error ? '设备读取失败，可重试' : loading ? '正在读取或设置音频设备…' : manager.preferenceWarning || `默认输出：${defaultOutput?.name || '无'} · 默认输入：${defaultInput?.name || '无'}`
  return <List navigationTitle="音频设备切换" isLoading={loading} isShowingDetail={false} searchBarPlaceholder="搜索扬声器、耳机或麦克风…" onSearchTextChange={setQuery}
    filterBar={{ summaryText: summary, actions: [{ id: 'refresh-audio', title: '重新扫描', onAction: () => reload() }] }}
    searchBarAccessory={<List.Dropdown tooltip="设备类型" value={filter} onChange={value => setFilter(value as typeof filter)}>
      <List.Dropdown.Item value="all" title="全部设备" /><List.Dropdown.Item value="output" title="输出设备" /><List.Dropdown.Item value="input" title="输入设备" /><List.Dropdown.Item value="favourites" title="常用设备" />
    </List.Dropdown>}
  >
    {error ? <List.Item id="error" title="无法读取音频设备" subtitle={error} icon={Icon.ExclamationMark} /> : devices.length === 0 ? <List.Item id="empty" title={loading ? '正在读取…' : '没有符合条件的音频设备'} icon={Icon.SpeakerOff} /> : devices.map(device => <List.Item key={device.id} id={device.id} title={device.name} subtitle={`${device.type === 'input' ? '输入' : '输出'} · ${volumeText(device)}`} icon={device.type === 'input' ? Icon.Microphone : device.isMuted ? Icon.SpeakerOff : Icon.SpeakerHigh}
      accessories={[...(device.isDefault ? [{ text: '当前默认' }] : []), ...(device.isFavourite ? [{ icon: Icon.Star }] : [])]}
      actions={<ActionPanel>
        {device.canSetDefault && <Action title={`设为默认${device.type === 'output' ? '输出' : '输入'}`} icon={Icon.Checkmark} onAction={() => run(() => manager.setDefaultDevice(device.id), '已切换默认设备')} />}
        {device.canMute && <Action title={device.isMuted ? '取消静音' : '静音设备'} icon={Icon.SpeakerOff} onAction={() => run(() => manager.toggleDeviceMute(device.id), '已更新静音状态')} />}
        {device.canSetVolume && <Action title="设置音量…" icon={Icon.SpeakerHigh} onAction={() => push(<AudioVolumeForm device={device} manager={manager} onSaved={refresh} />)} />}
        {device.canSetVolume && <Action title="音量增加 10%" icon={Icon.Plus} onAction={() => run(() => manager.stepDeviceVolume(device.id, 10), '已更新设备音量')} />}
        {device.canSetVolume && <Action title="音量降低 10%" icon={Icon.Minus} onAction={() => run(() => manager.stepDeviceVolume(device.id, -10), '已更新设备音量')} />}
        {!manager.preferenceWarning && <Action title={device.isFavourite ? '取消常用' : '设为常用'} icon={Icon.Star} onAction={() => run(() => manager.toggleFavourite(device.id), '已更新常用设备')} />}
        <Action title="查看设备信息" icon={Icon.Info} onAction={() => push(<AudioDeviceDetailView device={device} />)} />
      </ActionPanel>}
    />)}
  </List>
}
let muteCommandPending = false
export async function AudioMuteToggleCommand(props?: { hostOverride?: unknown }): Promise<string> {
  if (muteCommandPending) throw new Error('静音切换正在执行，请稍后重试')
  muteCommandPending = true
  try {
    const manager = new AudioDeviceManager(props?.hostOverride)
    await manager.syncDevicesFromHost()
    const target = manager.getDefaultOutputDevice()
    if (!target) throw new Error('当前没有默认输出设备')
    const actual = await manager.toggleDeviceMute(target.id)
    return actual.isMuted ? '默认输出设备已静音' : '默认输出设备已取消静音'
  } finally { muteCommandPending = false }
}
export const commands = {
  'audio-switch': () => <AudioDeviceCommand />,
  'audio-input': () => <AudioDeviceCommand featureCode="audio-input" />,
  'audio-mute-toggle': AudioMuteToggleCommand
}
export default AudioDeviceCommand
