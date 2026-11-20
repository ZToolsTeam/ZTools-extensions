import React, { Action, ActionPanel, Clipboard, Detail, Form, Icon, List, Toast, showToast, useEffect, useLocale, useMemo, useNavigation, useRef, useState } from '@ztools/declarative-ui'
import { AudioDeviceManager, transportLabel } from './audio-service.js'
import type { AudioDevice, IOType } from './types.js'
import { t } from './i18n.js'
export * from './types.js'
export * from './audio-service.js'

const message = (error: unknown) => error instanceof Error ? error.message : String(error)
function volumeText(device: AudioDevice): string {
  if (device.isMuted) return t('muted')
  return device.volume === undefined ? t('volumeUnsupported') : t('volumePercent', { volume: device.volume })
}
export function AudioVolumeForm({ device, manager, onSaved }: { device: AudioDevice; manager: AudioDeviceManager; onSaved: () => void }) {
  useLocale()
  const [volume, setVolume] = useState(String(device.volume ?? ''))
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const mounted = useRef(true)
  const { pop } = useNavigation()
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const submit = async () => {
    if (pending.current) return
    if (!volume.trim()) { await showToast(Toast.Style.Failure, t('enterVolumePrompt')); return }
    pending.current = true; setBusy(true)
    try {
      const actual = await manager.setDeviceVolume(device.id, Number(volume))
      if (mounted.current) { onSaved(); await showToast(Toast.Style.Success, t('volumeSetToast', { volume: actual.volume ?? 0 })); pop() }
    } catch (error) { if (mounted.current) await showToast(Toast.Style.Failure, t('volumeSetFailed'), message(error)) }
    finally { pending.current = false; if (mounted.current) setBusy(false) }
  }
  return <Form navigationTitle={t('volumeFormNavTitle', { name: device.name })} isLoading={busy} actions={<ActionPanel><Action.SubmitForm title={t('applyVolumeAction')} onSubmit={submit} /></ActionPanel>}>
    <Form.TextField id="volume" title={t('volumeFieldTitle')} value={volume} onChange={value => { if (!pending.current) setVolume(value) }} />
  </Form>
}
export function AudioDeviceDetailView({ device }: { device: AudioDevice }) {
  useLocale()
  const markdown = [
    t('detailTypeLine', { type: device.type === 'output' ? t('detailTypeOutput') : t('detailTypeInput') }),
    t('detailVolumeLine', { support: device.canSetVolume ? t('detailSupported') : t('detailUnsupported') }),
    t('detailMuteLine', { support: device.canMute ? t('detailSupported') : t('detailUnsupported') }),
    ...(transportLabel(device.transportType) ? [t('detailTransportLine', { transport: transportLabel(device.transportType) })] : []),
    ...(device.sampleRate ? [t('detailSampleRateLine', { rate: device.sampleRate })] : []),
    ...(device.channels ? [t('detailChannelsLine', { channels: device.channels })] : [])
  ].join('\n')
  return <Detail navigationTitle={t('detailNavTitle', { name: device.name })} markdown={markdown} actions={<ActionPanel><Action title={t('copyUidAction')} icon={Icon.CopyClipboard} onAction={async () => {
    try { await Clipboard.copy(device.uid); await showToast(Toast.Style.Success, t('copiedUidToast')) }
    catch (error) { await showToast(Toast.Style.Failure, t('copyFailedToast'), message(error)) }
  }} /></ActionPanel>} />
}

export function AudioDeviceCommand(props?: { featureCode?: string; hostOverride?: unknown }) {
  const locale = useLocale()
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
      if (notify) await showToast(Toast.Style.Success, t('loadedDevicesToast', { count: devices.length }))
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
      if (mounted.current && request === generation.current) { refresh(); await showToast(Toast.Style.Failure, t('actionFailedToast'), message(failure)) }
    } finally { busy.current = false; if (mounted.current && request === generation.current) setLoading(false) }
  }
  useEffect(() => {
    mounted.current = true
    setFilter(props?.featureCode === 'audio-input' ? 'input' : 'all')
    void reload(false)
    return () => { mounted.current = false; generation.current++ }
  }, [manager, props?.featureCode])
  const devices = useMemo(() => manager.filterDevices({ ioType: filter, query }), [manager, filter, query, version, locale])
  const defaultOutput = manager.getDefaultOutputDevice()
  const defaultInput = manager.getDefaultInputDevice()
  const summary = error ? t('summaryLoadFailed') : loading ? t('summaryLoading') : manager.preferenceWarning || t('summaryDefaults', { output: defaultOutput?.name || t('noneLabel'), input: defaultInput?.name || t('noneLabel') })
  return <List navigationTitle={t('navTitle')} isLoading={loading} isShowingDetail={false} searchBarPlaceholder={t('searchPlaceholder')} onSearchTextChange={setQuery}
    filterBar={{ summaryText: summary, actions: [{ id: 'refresh-audio', title: t('rescanAction'), onAction: () => reload() }] }}
    searchBarAccessory={<List.Dropdown tooltip={t('filterTooltip')} value={filter} onChange={value => setFilter(value as typeof filter)}>
      <List.Dropdown.Item value="all" title={t('filterAll')} /><List.Dropdown.Item value="output" title={t('filterOutput')} /><List.Dropdown.Item value="input" title={t('filterInput')} /><List.Dropdown.Item value="favourites" title={t('filterFavourites')} />
    </List.Dropdown>}
  >
    {error ? <List.Item id="error" title={t('loadErrorTitle')} subtitle={error} icon={Icon.ExclamationMark} /> : devices.length === 0 ? <List.Item id="empty" title={loading ? t('loadingItemTitle') : t('emptyItemTitle')} icon={Icon.SpeakerOff} /> : devices.map(device => <List.Item key={device.id} id={device.id} title={device.name} subtitle={[device.type === 'input' ? t('detailTypeInput') : t('detailTypeOutput'), transportLabel(device.transportType), volumeText(device)].filter(Boolean).join(' · ')} icon={device.type === 'input' ? Icon.Microphone : device.isMuted ? Icon.SpeakerOff : Icon.SpeakerHigh}
      accessories={[...(device.isDefault ? [{ text: t('defaultTag') }] : []), ...(device.isFavourite ? [{ icon: Icon.Star }] : [])]}
      actions={<ActionPanel>
        {device.canSetDefault && !device.isDefault && <Action title={t('setDefaultAction', { type: device.type === 'output' ? t('detailTypeOutput') : t('detailTypeInput') })} icon={Icon.Checkmark} onAction={() => run(() => manager.setDefaultDevice(device.id), t('switchedDefaultToast'))} />}
        {device.canMute && <Action title={device.isMuted ? t('unmuteAction') : t('muteAction')} icon={Icon.SpeakerOff} onAction={() => run(() => manager.toggleDeviceMute(device.id), t('muteUpdatedToast'))} />}
        {device.canSetVolume && <Action title={t('setVolumeAction')} icon={Icon.SpeakerHigh} onAction={() => push(<AudioVolumeForm device={device} manager={manager} onSaved={refresh} />)} />}
        {device.canSetVolume && <Action title={t('volumeUpAction')} icon={Icon.Plus} onAction={() => run(() => manager.stepDeviceVolume(device.id, 10), t('volumeUpdatedToast'))} />}
        {device.canSetVolume && <Action title={t('volumeDownAction')} icon={Icon.Minus} onAction={() => run(() => manager.stepDeviceVolume(device.id, -10), t('volumeUpdatedToast'))} />}
        {!manager.preferenceWarning && <Action title={device.isFavourite ? t('unfavouriteAction') : t('favouriteAction')} icon={Icon.Star} onAction={() => run(() => manager.toggleFavourite(device.id), t('favouriteUpdatedToast'))} />}
        <Action title={t('viewDetailsAction')} icon={Icon.Info} onAction={() => push(<AudioDeviceDetailView device={device} />)} />
      </ActionPanel>}
    />)}
  </List>
}
let muteCommandPending = false
export async function AudioMuteToggleCommand(props?: { hostOverride?: unknown }): Promise<string> {
  if (muteCommandPending) throw new Error(t('muteBusyError'))
  muteCommandPending = true
  try {
    const manager = new AudioDeviceManager(props?.hostOverride)
    await manager.syncDevicesFromHost()
    const target = manager.getDefaultOutputDevice()
    if (!target) throw new Error(t('noDefaultOutputError'))
    const actual = await manager.toggleDeviceMute(target.id)
    return actual.isMuted ? t('defaultOutputMuted') : t('defaultOutputUnmuted')
  } finally { muteCommandPending = false }
}
export const commands = {
  'audio-switch': () => <AudioDeviceCommand />,
  'audio-input': () => <AudioDeviceCommand featureCode="audio-input" />,
  'audio-mute-toggle': AudioMuteToggleCommand
}
export default AudioDeviceCommand
